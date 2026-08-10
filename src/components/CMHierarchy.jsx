import { createSignal, createEffect, on, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import {
  fetchHierarchyClients,
  fetchHierarchyProjects,
  fetchHierarchyCampaigns,
  fetchCampaignsScoped,
} from "../services/cm";
import { scopeKey, ownScope } from "../stores/cmScope";
import { lookupManager, managerColor } from "../stores/cmManagerMap";
import { canWriteCampaigns } from "../stores/currentUser";
import CampaignStatusControl from "./CampaignStatusControl";

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
// The ad account's name off a campaign row, whichever shape it arrives in:
// /campaigns/ flattens it to ad_account_name, and the hierarchy leaf may or may
// not carry it at all (hence the fallback fetch in loadAdAccounts).
const adAccountName = (c) =>
  c?.ad_account_name ?? c?.ad_account?.name ?? c?.account_name ?? null;

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

// A 404 with code "not_found" from the hierarchy endpoints is intentional and
// neutral: the backend returns the SAME 404 whether the client/project genuinely
// doesn't exist OR exists but isn't in the CM's visible set (a deliberate choice
// so it never leaks another CM's client). So this treats it as a distinct,
// calm state — never a hard error, never wording that implies ownership.
const isNotFound = (err) => err?.status === 404 && (err?.code === "not_found" || !err?.code);

// Neutral "not available to you / doesn't exist" panel. Deliberately does NOT
// distinguish the two — the backend hides the difference and the UI must too.
function NotAvailablePanel(props) {
  return (
    <div class="flex items-start gap-3 px-3 py-6 text-gray-500 dark:text-gray-400">
      <svg
        class="w-5 h-5 flex-shrink-0 mt-0.5 text-gray-400 dark:text-gray-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v4M12 16h.01" />
      </svg>
      <div class="min-w-0">
        <p class="text-sm font-semibold text-gray-700 dark:text-gray-200">{props.heading}</p>
        <p class="text-xs mt-0.5 max-w-md leading-relaxed">
          This {props.kind} isn't in your assigned accounts, or doesn't exist. If you
          think you should have access, contact your manager.
        </p>
      </div>
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
  // project_id → { campaign_id → ad account name }. Only populated when the
  // hierarchy leaf itself doesn't carry the name (see loadCampaigns).
  const [adAccountsByProject, setAdAccountsByProject] = createSignal({});

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
        setAdAccountsByProject({});
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
      const notFound = isNotFound(err);
      setProjectsByClient((p) => ({
        ...p,
        [clientNomenId]: { loading: false, error: !notFound, notFound, data: [] },
      }));
    }
  };

  // ── Ad account per campaign ────────────────────────────────────────────────
  // The hierarchy leaf is a numbers payload and doesn't name the ad account, so
  // it comes from the scoped campaign list — one request per expanded project,
  // keyed by campaign id. Deliberately NOT date-windowed: /campaigns/ would then
  // drop campaigns that had no delivery in the window, and the account a
  // campaign belongs to is a fixed attribute, not a per-day value. Failure is
  // silent — the row just loses its subtitle, it never blocks the numbers.
  const loadAdAccounts = async (projectId) => {
    try {
      const res = await fetchCampaignsScoped({ project: projectId });
      const rows = res?.data?.results ?? (Array.isArray(res?.data) ? res.data : []);
      const map = {};
      for (const r of rows) {
        const name = adAccountName(r);
        if (r?.id != null && name) map[String(r.id)] = name;
      }
      setAdAccountsByProject((p) => ({ ...p, [projectId]: map }));
    } catch (err) {
      console.error("[CMHierarchy] ad accounts failed:", err);
      setAdAccountsByProject((p) => ({ ...p, [projectId]: {} }));
    }
  };

  const loadCampaigns = async (projectId, clientNomenId) => {
    setCampaignsByProject((p) => ({ ...p, [projectId]: { loading: true, error: false, data: [] } }));
    try {
      const res = await fetchHierarchyCampaigns(projectId, clientNomenId, dateArgs());
      const data = Array.isArray(res?.data) ? res.data : [];
      setCampaignsByProject((p) => ({
        ...p,
        [projectId]: { loading: false, error: false, data },
      }));
      // Only pay for the extra call when the leaf didn't already answer it —
      // if the backend starts sending the name, this quietly stops firing.
      if (data.length > 0 && !data.some(adAccountName)) loadAdAccounts(projectId);
    } catch (err) {
      console.error("[CMHierarchy] campaigns failed:", err);
      const notFound = isNotFound(err);
      setCampaignsByProject((p) => ({
        ...p,
        [projectId]: { loading: false, error: !notFound, notFound, data: [] },
      }));
    }
  };

  // Reflect a confirmed pause/resume on the campaign leaf without a refetch.
  const updateCampaignStatus = (projectId, campaignId, newStatus) =>
    setCampaignsByProject((p) => {
      const entry = p[projectId];
      if (!entry) return p;
      return {
        ...p,
        [projectId]: {
          ...entry,
          data: entry.data.map((c) =>
            c.campaign_id === campaignId ? { ...c, status: newStatus } : c,
          ),
        },
      };
    });

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
                        {/* Owning campaign manager — shown in the admin Full-team
                            view so clients from different CMs are distinguishable. */}
                        <Show when={!ownScope() && lookupManager(client.client_nomen_id)} keyed>
                          {(mgr) => (
                            <span
                              class={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${managerColor(mgr.id)}`}
                              title={`Campaign Manager: ${mgr.label}`}
                            >
                              <svg class="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                              {mgr.label}
                            </span>
                          )}
                        </Show>
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
                    <Show when={projState()?.notFound}>
                      <NotAvailablePanel heading="Client not available" kind="client" />
                    </Show>
                    <Show when={projState()?.error}>
                      <div class="px-3 py-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                        Failed to load projects.
                        <button onClick={() => loadProjects(id)} class="underline font-medium">Retry</button>
                      </div>
                    </Show>
                    <Show when={projState() && !projState().loading && !projState().error && !projState().notFound && projState().data.length === 0}>
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
                                  <Show when={campState()?.notFound}>
                                    <NotAvailablePanel heading="Project not available" kind="project" />
                                  </Show>
                                  <Show when={campState()?.error}>
                                    <div class="px-3 py-2 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
                                      Failed to load campaigns.
                                      <button onClick={() => loadCampaigns(pid, id)} class="underline font-medium">Retry</button>
                                    </div>
                                  </Show>
                                  <Show when={campState() && !campState().loading && !campState().error && !campState().notFound && campState().data.length === 0}>
                                    <div class="px-3 py-4 text-sm text-gray-400 dark:text-gray-500">No data in this range.</div>
                                  </Show>

                                  <div class="divide-y divide-gray-100 dark:divide-gray-800">
                                    <For each={campState()?.data ?? []}>
                                      {(c) => {
                                        // Leaf field first, list lookup second.
                                        const adAccount = () =>
                                          adAccountName(c) ??
                                          adAccountsByProject()[pid]?.[String(c.campaign_id)] ??
                                          null;
                                        return (
                                        <div class="flex flex-col sm:flex-row sm:items-center gap-3 px-3 py-2.5 hover:bg-gray-50/70 dark:hover:bg-gray-800/40 transition-colors">
                                          <div class="flex items-start gap-2.5 flex-1 min-w-0">
                                            <span
                                              title={c.status === "active" ? "Active" : "Paused"}
                                              class={`mt-[7px] w-2 h-2 rounded-full flex-shrink-0 ring-2 ${
                                                c.status === "active"
                                                  ? "bg-green-500 ring-green-500/20"
                                                  : "bg-amber-500 ring-amber-500/20"
                                              }`}
                                            />
                                            <div class="min-w-0">
                                              <A
                                                href={`/campaign/${c.campaign_id}`}
                                                class="block text-sm font-medium text-gray-800 dark:text-gray-100 hover:text-purple-700 dark:hover:text-purple-300 hover:underline decoration-purple-400/60 underline-offset-2 truncate"
                                                title={c.campaign_name}
                                              >
                                                {c.campaign_name}
                                              </A>
                                              {/* Ad account the spend came out of — a chip rather than
                                                  grey micro-text, because on a 60-row project this is
                                                  the field an operator scans for. */}
                                              <Show when={adAccount()}>
                                                <span
                                                  class="inline-flex items-center gap-1.5 mt-1 max-w-full px-2 py-0.5 rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/70 text-[11px] font-semibold text-gray-600 dark:text-gray-300"
                                                  title={`Ad account: ${adAccount()}`}
                                                >
                                                  <svg class="w-3 h-3 flex-shrink-0 text-gray-400 dark:text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                    <rect x="2" y="5" width="20" height="14" rx="2" />
                                                    <path d="M2 10h20" />
                                                  </svg>
                                                  <span class="truncate">{adAccount()}</span>
                                                </span>
                                              </Show>
                                            </div>
                                          </div>
                                          <Show when={canWriteCampaigns()}>
                                            <CampaignStatusControl
                                              campaignId={c.campaign_id}
                                              campaignName={c.campaign_name}
                                              status={c.status}
                                              size="sm"
                                              onChanged={(s) => updateCampaignStatus(pid, c.campaign_id, s)}
                                            />
                                          </Show>
                                          <TwoNumbers raw={c.raw} billed={c.client_facing} />
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
                </Show>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}
