import { createSignal, createEffect, on, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import {
  fetchHierarchyClients,
  fetchHierarchyProjects,
  fetchHierarchyCampaigns,
} from "../services/cm";
import { scopeKey } from "../stores/cmScope";

// ─── Formatters ───────────────────────────────────────────────────────────────
const money = (v) => {
  const n = parseFloat(v);
  if (!isFinite(n)) return "₹0";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
const cplFmt = (v) => {
  if (v == null || v === "") return "—";
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const num = (v) => (Number(v) || 0).toLocaleString("en-IN");
// client/project nodes expose avg_cpl; campaign leaves expose cpl.
const cplOf = (g) => (g?.cpl != null ? g.cpl : g?.avg_cpl);

const TYPE_CHIP = {
  hybrid: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  cpl: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  retainer: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

// ─── Leads cell: total, with "+N extra" when synthetic/fed leads exist ────────
function Leads(props) {
  const g = () => props.group ?? {};
  const extra = () => Number(g().extra_leads) || 0;
  return (
    <span>
      {num(g().leads)}
      <Show when={extra() > 0}>
        <span class="text-[10px] text-gray-400 dark:text-gray-500"> +{num(extra())} extra</span>
      </Show>
    </span>
  );
}

// ─── Two number sets side by side: Raw (neutral) | Client-facing (tinted) ─────
function TwoNumbers(props) {
  return (
    <div class="grid grid-cols-2 gap-2 w-full sm:w-auto sm:flex-shrink-0">
      {/* Raw (actual) */}
      <div class="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 min-w-[140px]">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Raw (actual)
        </p>
        <p class="text-sm font-semibold text-gray-800 dark:text-gray-100">{money(props.raw?.spend)}</p>
        <p class="text-[11px] text-gray-500 dark:text-gray-400">
          <Leads group={props.raw} /> leads · {cplFmt(cplOf(props.raw))}
        </p>
      </div>
      {/* Client-facing (billed) */}
      <div class="rounded-lg border border-purple-200 dark:border-purple-900/50 bg-purple-50/60 dark:bg-purple-900/15 px-3 py-1.5 min-w-[140px]">
        <p class="text-[10px] font-semibold uppercase tracking-wide text-purple-500 dark:text-purple-300">
          Client-facing (billed)
        </p>
        <p class="text-sm font-semibold text-purple-700 dark:text-purple-200">{money(props.billed?.spend)}</p>
        <p class="text-[11px] text-purple-600/80 dark:text-purple-300/80">
          <Leads group={props.billed} /> leads · {cplFmt(cplOf(props.billed))}
        </p>
      </div>
    </div>
  );
}

// ─── Coverage badge (client + project levels; only when applicable) ───────────
function CoverageBadge(props) {
  const c = () => props.coverage;
  return (
    <Show when={c() && c().applicable}>
      <span
        title="Client-facing totals exclude unpriced projects."
        class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
          c().is_fully_priced
            ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
            : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
        }`}
      >
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
        {c().projects_priced}/{c().projects_total} priced
      </span>
    </Show>
  );
}

function Chevron(props) {
  return (
    <svg
      class="w-4 h-4 flex-shrink-0 text-gray-400 transition-transform duration-200"
      style={{ transform: props.open ? "rotate(90deg)" : "rotate(0deg)" }}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      stroke-width="2"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function LoadingRow(props) {
  return (
    <div class="flex items-center gap-2 px-3 py-3 text-sm text-gray-400 dark:text-gray-500">
      <span class="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-purple-500 animate-spin" />
      {props.label ?? "Loading…"}
    </div>
  );
}

// ─── Main: lazy clients → projects → campaigns tree ───────────────────────────
// Props: startDate, endDate (values; may be undefined → server 14-day default)
export default function CMHierarchy(props) {
  const [clients, setClients] = createSignal({ loading: true, error: false, data: [] });
  const [openClients, setOpenClients] = createSignal({});
  const [openProjects, setOpenProjects] = createSignal({});
  // id → { loading, error, data }
  const [projectsByClient, setProjectsByClient] = createSignal({});
  const [campaignsByProject, setCampaignsByProject] = createSignal({});

  const dateArgs = () => ({ startDate: props.startDate, endDate: props.endDate });

  const loadClients = async () => {
    setClients({ loading: true, error: false, data: [] });
    try {
      const res = await fetchHierarchyClients(dateArgs());
      setClients({ loading: false, error: false, data: Array.isArray(res?.data) ? res.data : [] });
    } catch (err) {
      console.error("[CMHierarchy] clients failed:", err);
      setClients({ loading: false, error: true, data: [] });
    }
  };

  // Reset and reload whenever the date window or switch scope changes.
  createEffect(
    on(
      [() => props.startDate, () => props.endDate, scopeKey],
      () => {
        setOpenClients({});
        setOpenProjects({});
        setProjectsByClient({});
        setCampaignsByProject({});
        loadClients();
      },
    ),
  );

  const loadProjects = async (clientNomenId) => {
    setProjectsByClient((p) => ({ ...p, [clientNomenId]: { loading: true, error: false, data: [] } }));
    try {
      const res = await fetchHierarchyProjects(clientNomenId, dateArgs());
      setProjectsByClient((p) => ({
        ...p,
        [clientNomenId]: { loading: false, error: false, data: Array.isArray(res?.data) ? res.data : [] },
      }));
    } catch (err) {
      console.error("[CMHierarchy] projects failed:", err);
      setProjectsByClient((p) => ({ ...p, [clientNomenId]: { loading: false, error: true, data: [] } }));
    }
  };

  const loadCampaigns = async (projectId, clientNomenId) => {
    setCampaignsByProject((p) => ({ ...p, [projectId]: { loading: true, error: false, data: [] } }));
    try {
      const res = await fetchHierarchyCampaigns(projectId, clientNomenId, dateArgs());
      setCampaignsByProject((p) => ({
        ...p,
        [projectId]: { loading: false, error: false, data: Array.isArray(res?.data) ? res.data : [] },
      }));
    } catch (err) {
      console.error("[CMHierarchy] campaigns failed:", err);
      setCampaignsByProject((p) => ({ ...p, [projectId]: { loading: false, error: true, data: [] } }));
    }
  };

  const toggleClient = (client) => {
    const id = client.client_nomen_id;
    const isOpen = !!openClients()[id];
    setOpenClients((o) => ({ ...o, [id]: !isOpen }));
    if (!isOpen && !projectsByClient()[id]) loadProjects(id);
  };

  const toggleProject = (project, clientNomenId) => {
    const id = project.project_id;
    const isOpen = !!openProjects()[id];
    setOpenProjects((o) => ({ ...o, [id]: !isOpen }));
    if (!isOpen && !campaignsByProject()[id]) loadCampaigns(id, clientNomenId);
  };

  return (
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
      {/* Column legend */}
      <div class="flex items-center justify-end gap-2 px-4 py-2 border-b border-gray-100 dark:border-gray-800 text-[11px] text-gray-400 dark:text-gray-500">
        <span class="inline-flex items-center gap-1">
          <span class="w-2.5 h-2.5 rounded-sm border border-gray-300 dark:border-gray-600" /> Raw (actual)
        </span>
        <span class="inline-flex items-center gap-1">
          <span class="w-2.5 h-2.5 rounded-sm bg-purple-100 border border-purple-300 dark:bg-purple-900/40 dark:border-purple-700" /> Client-facing (billed)
        </span>
      </div>

      {/* Loading / error / empty */}
      <Show when={clients().loading}>
        <LoadingRow label="Loading clients…" />
      </Show>
      <Show when={clients().error}>
        <div class="px-4 py-3 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          Failed to load clients.
          <button onClick={loadClients} class="underline font-medium">Retry</button>
        </div>
      </Show>
      <Show when={!clients().loading && !clients().error && clients().data.length === 0}>
        <div class="px-4 py-10 text-center text-sm text-gray-400 dark:text-gray-500">
          No data in this range.
        </div>
      </Show>

      {/* Clients */}
      <div class="divide-y divide-gray-100 dark:divide-gray-800">
        <For each={clients().data}>
          {(client) => {
            const id = client.client_nomen_id;
            const projState = () => projectsByClient()[id];
            return (
              <div>
                {/* Client header */}
                <button
                  onClick={() => toggleClient(client)}
                  class="w-full flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                >
                  <div class="flex items-start gap-2 flex-1 min-w-0">
                    <span class="mt-0.5"><Chevron open={!!openClients()[id]} /></span>
                    <div class="min-w-0">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-semibold text-gray-800 dark:text-gray-100 truncate">{client.client_name}</span>
                        <Show when={client.client_type}>
                          <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${TYPE_CHIP[client.client_type] ?? TYPE_CHIP.retainer}`}>
                            {client.client_type}
                          </span>
                        </Show>
                        <Show when={!client.has_client_login}>
                          <span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">no login</span>
                        </Show>
                        <CoverageBadge coverage={client.coverage} />
                      </div>
                      <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                        {num(client.project_count)} projects · {num(client.campaign_count)} campaigns
                      </p>
                    </div>
                  </div>
                  <TwoNumbers raw={client.raw} billed={client.client_facing} />
                </button>

                {/* Projects (lazy) */}
                <Show when={openClients()[id]}>
                  <div class="pl-5 sm:pl-8 border-l-2 border-gray-100 dark:border-gray-800 ml-3 sm:ml-4">
                    <Show when={projState()?.loading}>
                      <LoadingRow label="Loading projects…" />
                    </Show>
                    <Show when={projState()?.error}>
                      <div class="px-3 py-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                        Failed to load projects.
                        <button onClick={() => loadProjects(id)} class="underline font-medium">Retry</button>
                      </div>
                    </Show>
                    <Show when={projState() && !projState().loading && !projState().error && projState().data.length === 0}>
                      <div class="px-3 py-4 text-sm text-gray-400 dark:text-gray-500">No data in this range.</div>
                    </Show>

                    <div class="divide-y divide-gray-100 dark:divide-gray-800">
                      <For each={projState()?.data ?? []}>
                        {(project) => {
                          const pid = project.project_id;
                          const campState = () => campaignsByProject()[pid];
                          return (
                            <div>
                              {/* Project header */}
                              <button
                                onClick={() => toggleProject(project, id)}
                                class="w-full flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                              >
                                <div class="flex items-start gap-2 flex-1 min-w-0">
                                  <span class="mt-0.5"><Chevron open={!!openProjects()[pid]} /></span>
                                  <div class="min-w-0">
                                    <div class="flex items-center gap-2 flex-wrap">
                                      <span class="font-medium text-gray-700 dark:text-gray-200 truncate">{project.project_name}</span>
                                      <CoverageBadge coverage={project.coverage} />
                                    </div>
                                    <p class="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                                      {num(project.campaign_count)} campaigns
                                    </p>
                                  </div>
                                </div>
                                <TwoNumbers raw={project.raw} billed={project.client_facing} />
                              </button>

                              {/* Campaigns (lazy leaf) */}
                              <Show when={openProjects()[pid]}>
                                <div class="pl-5 sm:pl-8 border-l-2 border-gray-100 dark:border-gray-800 ml-3 sm:ml-4">
                                  <Show when={campState()?.loading}>
                                    <LoadingRow label="Loading campaigns…" />
                                  </Show>
                                  <Show when={campState()?.error}>
                                    <div class="px-3 py-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                                      Failed to load campaigns.
                                      <button onClick={() => loadCampaigns(pid, id)} class="underline font-medium">Retry</button>
                                    </div>
                                  </Show>
                                  <Show when={campState() && !campState().loading && !campState().error && campState().data.length === 0}>
                                    <div class="px-3 py-4 text-sm text-gray-400 dark:text-gray-500">No data in this range.</div>
                                  </Show>

                                  <div class="divide-y divide-gray-100 dark:divide-gray-800">
                                    <For each={campState()?.data ?? []}>
                                      {(c) => (
                                        <div class="flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-2.5">
                                          <div class="flex items-center gap-2 flex-1 min-w-0">
                                            <span class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.status === "active" ? "bg-green-500" : "bg-amber-500"}`} />
                                            <A
                                              href={`/campaign/${c.campaign_id}`}
                                              class="text-sm text-purple-700 dark:text-purple-300 hover:underline truncate"
                                              title={c.campaign_name}
                                            >
                                              {c.campaign_name}
                                            </A>
                                          </div>
                                          <TwoNumbers raw={c.raw} billed={c.client_facing} />
                                        </div>
                                      )}
                                    </For>
                                  </div>
                                </div>
                              </Show>
                            </div>
                          );
                        }}
                      </For>
                    </div>
                  </div>
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
