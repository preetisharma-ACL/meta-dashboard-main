import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchCoordinationHome } from "../../services/coordinationHome";
import { inr, count, DASH } from "../../services/commandRules";
import { istDate } from "../../services/deadClients";
import { timeAgo } from "../../services/drive";
import { loadErrorMessage } from "../../utils/apiErrors";
import { openClientPage } from "../../utils/openClientPage";

// ─── Coordination desk ────────────────────────────────────────────────────────
// Coordination's /dashboard: work queues from GET /clients/coordination/home/
// (see services/coordinationHome.js). Read-only: every action is a link to the
// screen where the fix is made.
//
// Rate config data is NOT in coordination's payload (backend 26a3ce0): no
// billing_gaps key, no billing_gaps count, no "no_rate_config" setup gap. So the
// Billing gaps card and section render only when data.billing_gaps is there,
// and coordination sees four cards. Admin reads billing gaps on Project Display
// Config instead (BillingGapsPanel).
//
// Link mapping (the destinations read these params):
//   billing gap      → /project-display-config?client_id=<PK>&project_id=<id>
//                      (only if the payload has billing_gaps AND the viewer can
//                      open that page)
//   no_login         → /edit-clients?client_id=<PK>     (opens that client's drawer)
//   no_cm            → /assignments?client_id=<PK>      (Clients tab, client selected)
//   no_drive_folder, no delivery, drive → the client's page via openClientPage,
//                      the same keys the Clients list writes.

const TYPE_CHIP = {
  hybrid: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  cpl: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  retainer: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};
const typeLabel = (t) =>
  t === "cpl" ? "CPL" : t ? `${t[0].toUpperCase()}${t.slice(1)}` : DASH;

const GAP_LABEL = {
  no_login: "No login",
  no_cm: "No CM",
  no_drive_folder: "No Drive folder",
};
const KIND_LABEL = {
  no_config: "No config",
  not_covered: "Config does not cover these days",
};
const MISSING_LABEL = { city: "City", property_type: "Property type" };
const STATUS_LABEL = { active: "Active", hold: "Hold", completed: "Completed", dead: "Dead" };

const TH =
  "p-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap bg-gray-50 dark:bg-gray-800 sticky top-0 z-10";
const THR = TH.replace("text-left", "text-right");
const TD = "p-3 align-top";
const NUM = "p-3 align-top text-right tabular-nums whitespace-nowrap";
const LINK_BTN =
  "inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ring-1 ring-gray-300 dark:ring-gray-600 text-[#14233A] dark:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 whitespace-nowrap";

const CARDS = [
  { key: "billing_gaps", label: "Billing gaps", sub: "Spend with no rate config" },
  { key: "setup_gaps", label: "Setup gaps", sub: "Incomplete client setup" },
  { key: "no_delivery", label: "No delivery", sub: "Active, not delivering" },
  { key: "project_info", label: "Project info", sub: "Missing city or type" },
  { key: "drive", label: "Drive", sub: "No Drive folder" },
];

// Who may open Project Display Config (its route roles). Read per call.
const canOpenConfigs = () => {
  try {
    const role = JSON.parse(localStorage.getItem("auth") || "{}")?.role;
    return role === "admin" || role === "campaign_manager";
  } catch {
    return false;
  }
};

const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") sp.set(k, String(v));
  return sp.toString();
};

function TypeChip(props) {
  return (
    <Show when={props.type} fallback={<span class="text-gray-300">{DASH}</span>}>
      <span class={`inline-flex px-2 py-[2px] rounded-full text-[11px] font-semibold ${TYPE_CHIP[props.type] ?? "bg-gray-100 text-gray-600"}`}>
        {typeLabel(props.type)}
      </span>
    </Show>
  );
}

function Section(props) {
  return (
    <section id={`coord-${props.id}`} class="mb-8 scroll-mt-4">
      <div class="mb-3">
        <h2 class="text-base font-bold text-[#14233A] dark:text-white">
          {props.title}{" "}
          <span class="ml-1 text-sm font-semibold text-gray-400 tabular-nums">{count(props.total)}</span>
        </h2>
        <Show when={props.note}>
          <p class="mt-0.5 text-xs text-[#54657E] dark:text-gray-400">{props.note}</p>
        </Show>
      </div>
      <Show
        when={props.rows.length}
        fallback={
          <div class="rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
            All clear
          </div>
        }
      >
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-auto max-h-[60vh]">
          <table class="min-w-full text-sm">{props.children}</table>
        </div>
      </Show>
    </section>
  );
}

export default function CoordinationHome() {
  const navigate = useNavigate();
  const [data, setData] = createSignal(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  const [now, setNow] = createSignal(Date.now());

  const load = async (refresh = false) => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchCoordinationHome({ refresh }));
      setNow(Date.now());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };
  onMount(() => load(false));
  const tick = setInterval(() => setNow(Date.now()), 60_000);
  onCleanup(() => clearInterval(tick));

  const rows = (key) => (Array.isArray(data()?.[key]) ? data()[key] : []);
  // A queue the payload doesn't carry for this role (billing_gaps for
  // coordination) gets no card and no section, not an "All clear".
  const hasQueue = (key) => Array.isArray(data()?.[key]);
  const cards = () => CARDS.filter((c) => hasQueue(c.key));
  const total = (key) => data()?.counts?.[key] ?? rows(key).length;

  const openClient = (r) =>
    openClientPage(navigate, { nomen: r.client_nomen, nomenId: r.nomen_id });
  const go = (path, params) => navigate(`${path}?${qs(params)}`);

  const gapAction = (gap, r) => {
    if (gap === "no_login") return () => go("/edit-clients", { client_id: r.client_id });
    if (gap === "no_cm") return () => go("/assignments", { client_id: r.client_id });
    if (gap === "no_drive_folder") return () => openClient(r);
    return null;
  };

  const scrollTo = (key) =>
    document.getElementById(`coord-${key}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const ClientCell = (p) => (
    <span class="font-medium text-[#14233A] dark:text-gray-100">{p.r.client_nomen || DASH}</span>
  );

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* Header */}
      <div class="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white">Coordination desk</h1>
          <p class="text-sm text-[#54657E] dark:text-gray-400">
            <Show when={data()?.generated_at} fallback={<>&nbsp;</>}>
              <span title={data().generated_at}>Updated {timeAgo(data().generated_at, now())}</span>
            </Show>
          </p>
        </div>
        <button
          type="button"
          disabled={loading()}
          onClick={() => load(true)}
          class="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-[#14233A] text-white hover:bg-[#1d3255] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <svg class={`w-4 h-4 ${loading() ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {loading() ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      <Show when={error()}>
        <div class="mb-6 rounded-xl bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300 ring-1 ring-red-200 dark:ring-red-800">
          {loadErrorMessage(error(), "Couldn't load the coordination desk.")}{" "}
          <button type="button" class="underline font-semibold" onClick={() => load(false)}>
            Try again
          </button>
        </div>
      </Show>

      <Show when={data()} fallback={<Show when={loading()}><p class="text-sm text-gray-400">Loading...</p></Show>}>
        {/* Count cards */}
        <div
          class={`grid grid-cols-2 gap-3 mb-8 ${
            cards().length === 4 ? "lg:grid-cols-4" : "sm:grid-cols-3 lg:grid-cols-5"
          }`}
        >
          <For each={cards()}>
            {(c) => (
              <button
                type="button"
                onClick={() => scrollTo(c.key)}
                class="text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 hover:border-[#AC2334]/40 hover:shadow-sm transition"
              >
                <div class="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">{c.label}</div>
                <Show
                  when={total(c.key) > 0}
                  fallback={<div class="mt-1 text-lg font-bold text-emerald-600 dark:text-emerald-400">All clear</div>}
                >
                  <div class="mt-1 text-2xl font-bold text-[#AC2334] dark:text-red-300 tabular-nums">{count(total(c.key))}</div>
                </Show>
                <div class="text-[11px] text-gray-400 dark:text-gray-500">{c.sub}</div>
              </button>
            )}
          </For>
        </div>

        {/* 1. Billing gaps (absent from coordination's payload) */}
        <Show when={hasQueue("billing_gaps")}>
        <Section
          id="billing_gaps"
          title="Spend with no rate config"
          total={total("billing_gaps")}
          rows={rows("billing_gaps")}
        >
          <thead>
            <tr>
              <th class={TH}>Client</th>
              <th class={TH}>Project</th>
              <th class={TH}>Type</th>
              <th class={TH}>Gap</th>
              <th class={THR}>Uncovered days</th>
              <th class={THR}>Uncovered spend</th>
              <th class={TH}>From – to</th>
              <Show when={canOpenConfigs()}>
                <th class={TH}></th>
              </Show>
            </tr>
          </thead>
          <tbody>
            <For each={rows("billing_gaps")}>
              {(r) => (
                <tr class="border-t border-gray-100 dark:border-gray-800">
                  <td class={TD}><ClientCell r={r} /></td>
                  <td class={`${TD} text-gray-700 dark:text-gray-300`}>{r.project_name || DASH}</td>
                  <td class={TD}><TypeChip type={r.client_type} /></td>
                  <td class={`${TD} text-gray-700 dark:text-gray-300`}>{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td class={NUM}>{count(r.uncovered_days)}</td>
                  <td class={NUM}>{inr(r.uncovered_spend)}</td>
                  <td class={`${TD} whitespace-nowrap text-gray-600 dark:text-gray-400`}>
                    {istDate(r.first_uncovered) ?? DASH} – {istDate(r.last_uncovered) ?? DASH}
                  </td>
                  <Show when={canOpenConfigs()}>
                    <td class={`${TD} text-right`}>
                      <button
                        type="button"
                        class={LINK_BTN}
                        onClick={() => go("/project-display-config", { client_id: r.client_id, project_id: r.project_id })}
                      >
                        Open config
                      </button>
                    </td>
                  </Show>
                </tr>
              )}
            </For>
          </tbody>
        </Section>
        </Show>

        {/* 2. Setup gaps */}
        <Section id="setup_gaps" title="New or incomplete client setup" total={total("setup_gaps")} rows={rows("setup_gaps")}>
          <thead>
            <tr>
              <th class={TH}>Client</th>
              <th class={TH}>Type</th>
              <th class={TH}>Created</th>
              <th class={TH}>Gaps</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows("setup_gaps")}>
              {(r) => (
                <tr class="border-t border-gray-100 dark:border-gray-800">
                  <td class={TD}><ClientCell r={r} /></td>
                  <td class={TD}><TypeChip type={r.client_type} /></td>
                  <td class={`${TD} whitespace-nowrap text-gray-600 dark:text-gray-400`}>{istDate(r.created_at) ?? DASH}</td>
                  <td class={TD}>
                    <div class="flex flex-wrap gap-1.5">
                      <For each={Array.isArray(r.gaps) ? r.gaps : []}>
                        {(g) => {
                          const act = gapAction(g, r);
                          // A gap this page has no screen for: plain chip.
                          if (!act)
                            return (
                              <span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-600 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700">
                                {GAP_LABEL[g] ?? g}
                              </span>
                            );
                          return (
                            <button
                              type="button"
                              onClick={() => act()}
                              title="Open where this is fixed"
                              class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-[#FBEEF0] text-[#AC2334] ring-1 ring-[#AC2334]/20 hover:bg-[#AC2334] hover:text-white disabled:hover:bg-[#FBEEF0] disabled:hover:text-[#AC2334] disabled:cursor-default dark:bg-red-900/30 dark:text-red-300"
                            >
                              {GAP_LABEL[g] ?? g}
                            </button>
                          );
                        }}
                      </For>
                    </div>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </Section>

        {/* 3. No delivery */}
        <Section
          id="no_delivery"
          title="Active clients not delivering"
          note="Nothing running and no spend or leads for 7+ days. Check with the CM, or set the status to Hold/Completed."
          total={total("no_delivery")}
          rows={rows("no_delivery")}
        >
          <thead>
            <tr>
              <th class={TH}>Client</th>
              <th class={TH}>Type</th>
              <th class={TH}>Status</th>
              <th class={TH}>Last delivery</th>
              <th class={THR}>Idle days</th>
              <th class={TH}></th>
            </tr>
          </thead>
          <tbody>
            <For each={rows("no_delivery")}>
              {(r) => (
                <tr class="border-t border-gray-100 dark:border-gray-800">
                  <td class={TD}><ClientCell r={r} /></td>
                  <td class={TD}><TypeChip type={r.client_type} /></td>
                  <td class={`${TD} text-gray-700 dark:text-gray-300`}>
                    {STATUS_LABEL[r.engagement_status] ?? r.engagement_status ?? DASH}
                  </td>
                  <td class={`${TD} whitespace-nowrap text-gray-600 dark:text-gray-400`}>{istDate(r.last_delivery) ?? DASH}</td>
                  <td class={NUM}>{r.idle_days == null ? "Never" : count(r.idle_days)}</td>
                  <td class={`${TD} text-right`}>
                    <button type="button" class={LINK_BTN} onClick={() => openClient(r)}>
                      Open client
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </Section>

        {/* 4. Project info */}
        <Section
          id="project_info"
          title="Projects missing city or type"
          note="Fix in the Nomenclature sheet (Project Nomen tab). It syncs to the dashboard every hour."
          total={total("project_info")}
          rows={rows("project_info")}
        >
          <thead>
            <tr>
              <th class={TH}>Project</th>
              <th class={TH}>Missing</th>
              <th class={THR}>30-day spend</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows("project_info")}>
              {(r) => (
                <tr class="border-t border-gray-100 dark:border-gray-800">
                  <td class={`${TD} font-medium text-[#14233A] dark:text-gray-100`}>
                    {r.project_name || DASH}
                    <Show when={r.location}>
                      <div class="text-xs font-normal text-gray-400">{r.location}</div>
                    </Show>
                  </td>
                  <td class={TD}>
                    <div class="flex flex-wrap gap-1.5">
                      <For each={Array.isArray(r.missing) ? r.missing : []}>
                        {(m) => (
                          <span class="inline-flex px-2 py-[2px] rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-800">
                            {MISSING_LABEL[m] ?? m}
                          </span>
                        )}
                      </For>
                    </div>
                  </td>
                  <td class={NUM}>{inr(r.spend_30d)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </Section>

        {/* 5. Drive */}
        <Section id="drive" title="Clients without a Drive folder" total={total("drive")} rows={rows("drive")}>
          <thead>
            <tr>
              <th class={TH}>Client</th>
              <th class={TH}>Status</th>
              <th class={TH}>Message</th>
              <th class={TH}></th>
            </tr>
          </thead>
          <tbody>
            <For each={rows("drive")}>
              {(r) => (
                <tr class="border-t border-gray-100 dark:border-gray-800">
                  <td class={TD}><ClientCell r={r} /></td>
                  <td class={`${TD} text-gray-700 dark:text-gray-300`}>{r.status || DASH}</td>
                  <td class={`${TD} text-gray-700 dark:text-gray-300 max-w-[420px]`}>{r.message}</td>
                  <td class={`${TD} text-right`}>
                    <button type="button" class={LINK_BTN} onClick={() => openClient(r)}>
                      Open client
                    </button>
                  </td>
                </tr>
              )}
            </For>
          </tbody>
        </Section>
      </Show>
    </section>
  );
}
