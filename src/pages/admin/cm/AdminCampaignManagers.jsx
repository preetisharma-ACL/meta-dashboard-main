import {
  createSignal,
  createResource,
  createMemo,
  createEffect,
  on,
  onMount,
  For,
  Show,
} from "solid-js";
import { useSearchParams } from "@solidjs/router";
import { fetchManagerPerformance } from "../../../services/performance";
import { probeAdminSwitchMode, fetchManagerOwnClients } from "../../../services/cmAdmin";
import {
  setManagerScope,
  clearScope,
  ownScope,
  viewingAs,
  setViewingAs,
} from "../../../stores/cmScope";
import { clientManagerMap, setClientManagerMap } from "../../../stores/cmManagerMap";
import Avatar from "../../../components/common/Avatar";
import CMDashboard from "../../CMDashboard";
import AlertsPanel from "../../../components/AlertsPanel";

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN · Campaign Managers
// A roster of every campaign manager + the ability to open any one manager's
// full CM dashboard (their clients, drill-down, alerts, AI insights) by scoping
// the existing CM components with ?as_team_member_id=<manager_id>.
//
// Reuse-first: the per-manager dashboard EMBEDS the existing <CMDashboard/> and
// <AlertsPanel/> verbatim — they already react to the global cmScope signal, so
// setting the scope re-renders them as that manager. No dashboard logic is
// re-implemented here.
//
// The one real dependency (verified live): admin switch-mode is currently
// rejected by the backend (`resolve_cm_scope_user` checks a team-lead
// relationship; an admin isn't a team lead → 403). So a runtime probe gates the
// embedded dashboards. Today it reports "denied" → roster + a clear flag. The
// moment the backend permits GLOBAL_READ roles to switch, the probe reports
// "allowed" and the full dashboards + budget light up with zero code changes.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Formatters ───────────────────────────────────────────────────────────────
// 2-decimal money — same null discipline as the rest of the app: null/blank →
// "—", but a genuine "0.00" renders ₹0.00 (never blank). Used for the
// allocated-budget figures which the roster serves as money strings.
const money2 = (v) => {
  if (v == null || v === "") return "—";
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const num = (v) => (Number(v) || 0).toLocaleString("en-IN");

// Roster client count. `assigned_client_count` is the true roster figure (all
// CPL+Hybrid clients assigned to the manager); `client_count` is the active
// subset (clients with spend this month). Prefer assigned, fall back to the
// active count for older backends that don't serve it yet.
const assignedCount = (r) =>
  r?.assigned_client_count != null ? Number(r.assigned_client_count) : Number(r?.client_count) || 0;

const monthOptions = () => {
  const now = new Date();
  const opts = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    opts.push({ key, label });
  }
  return opts;
};
const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// ─── Backend-dependency flag banner (shown while admin switch-mode is off) ────
function ViewAsBlockedBanner(props) {
  return (
    <div class="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 rounded-xl p-4 mb-5">
      <div class="flex items-start gap-3">
        <svg class="w-5 h-5 mt-0.5 flex-shrink-0 text-amber-600 dark:text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
        <div class="min-w-0">
          <p class="text-sm font-semibold text-amber-900 dark:text-amber-200">
            Admin “view-as” isn’t enabled yet — a small backend change is needed.
          </p>
          <p class="text-[13px] text-amber-800/90 dark:text-amber-300/90 mt-1 leading-relaxed">
            The roster below works today. Opening an individual manager’s dashboard
            needs the backend to allow GLOBAL_READ roles (admin / coordination /
            accounts) to use <code class="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-[12px]">?as_team_member_id=</code> for
            any campaign manager — not only a requester’s own team members. The
            switch-mode resolver (<code class="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-[12px]">resolve_cm_scope_user</code>)
            currently returns <b>403 “Invalid team member for switch mode.”</b> for
            admins. The same change unblocks the per-manager allocated-budget total.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function AdminCampaignManagers() {
  // The selected manager lives in the URL (?manager=<id>&view=own|team) instead
  // of local state, so the view survives navigation: clicking a campaign routes
  // to /campaign/:id, and browser Back returns here to the SAME manager's
  // dashboard rather than resetting to the bare roster.
  const [searchParams, setSearchParams] = useSearchParams();
  const [month, setMonth] = createSignal(currentMonthKey());
  const [tab, setTab] = createSignal("dashboard"); // dashboard | alerts
  const [search, setSearch] = createSignal("");

  // Switch-mode capability: "unknown" | "checking" | "allowed" | "denied"
  const [switchMode, setSwitchMode] = createSignal("unknown");

  // ── Roster (admin-readable, works regardless of switch-mode) ──
  const [data] = createResource(month, async (m) => {
    const res = await fetchManagerPerformance(m);
    return {
      rows: Array.isArray(res?.data) ? res.data : [],
      summary: res?.meta?.summary ?? null,
    };
  });

  const rows = () => data()?.rows ?? [];
  const summary = () => data()?.summary ?? null;

  // ── URL-derived selection (?manager=<id>&view=own|team) ──
  // `view` defaults to "own"; anything else means the full-team view. `selected`
  // resolves the roster row for the id in the URL, so it repopulates once the
  // roster loads on a Back-navigation.
  const selectedId = () => {
    const raw = searchParams.manager;
    return raw ? Number(raw) || null : null;
  };
  const ownFromUrl = () => searchParams.view !== "team";
  const selected = createMemo(() => {
    const id = selectedId();
    if (id == null) return null;
    return rows().find((r) => Number(r.manager_id) === id) ?? null;
  });

  // View gating — avoids flashing the roster while the roster reloads on Back:
  //   • roster   → no manager in the URL (or the id isn't in this month's roster)
  //   • loading  → a manager is in the URL but the roster hasn't resolved it yet
  //   • manager  → the roster row is resolved
  const showManager = () => !!selected();
  const showLoading = () => selectedId() != null && !selected() && data.loading;
  const showRoster = () => selectedId() == null || (!selected() && !data.loading);

  const visibleRows = createMemo(() => {
    const q = search().trim().toLowerCase();
    if (!q) return rows();
    return rows().filter((r) => r.manager_email?.toLowerCase().includes(q));
  });

  // ── Probe switch-mode once the roster has at least one manager. Role-level
  // gate, so a single probe is authoritative for every manager. ──
  createEffect(
    on(rows, (list) => {
      if (switchMode() !== "unknown") return;
      if (!list || list.length === 0) return;
      setSwitchMode("checking");
      probeAdminSwitchMode(list[0].manager_id)
        .then((r) => setSwitchMode(r.allowed ? "allowed" : "denied"))
        .catch(() => setSwitchMode("denied"));
    }),
  );

  const allowed = () => switchMode() === "allowed";

  // ── Client → owning-CM map (for the Full-team hierarchy tags) ──
  // The hierarchy response carries no owner field, so we assemble the map by
  // unioning every manager's scope=own client list (one explicit-scope call per
  // manager, NOT via the global signal). Built lazily the first time the admin
  // looks at a Full-team view, then cached in the module-level store for the
  // session. CMHierarchy reads it to tag each client with its CM.
  const labelFromEmail = (email) => {
    const local = String(email ?? "").split("@")[0] || "—";
    return local.charAt(0).toUpperCase() + local.slice(1);
  };
  const [mapBuilt, setMapBuilt] = createSignal(false);

  const buildManagerMap = async (managers) => {
    const lists = await Promise.all(
      managers.map(async (m) => {
        const clients = await fetchManagerOwnClients(m.manager_id);
        const label = labelFromEmail(m.manager_email);
        return clients.map((c) => [String(c.client_nomen_id), { label, id: m.manager_id }]);
      }),
    );
    const map = {};
    for (const list of lists) for (const [k, v] of list) map[k] = v;
    setClientManagerMap(map);
  };

  createEffect(() => {
    if (!allowed() || mapBuilt()) return;
    // Only needed in a Full-team view (own view is a single CM — no ambiguity).
    if (!selected() || ownScope()) return;
    if (!rows().length) return;
    setMapBuilt(true);
    if (Object.keys(clientManagerMap()).length) return; // already built this session
    buildManagerMap(rows());
  });

  // ── Selected-manager scope wiring ──
  // Selecting a manager defaults to that manager's OWN clients
  // (as_team_member_id=<id>&scope=own). The own/team toggle flips scope=own on
  // and off for the SAME manager. The embedded CMDashboard / CMHierarchy react to
  // the global cmScope signal (CMHierarchy keys on scopeKey, so the toggle and a
  // manager change both re-key it). viewingAs is primed so the global CM banner
  // reads the manager's email immediately.
  const applyManagerScope = (m, own) => {
    setManagerScope(m.manager_id, own);
    setViewingAs({ user_id: m.manager_id, email: m.manager_email, tier: null });
  };

  const openManager = (m) => {
    setTab("dashboard");
    // Push the manager into the URL — this becomes the history entry that a Back
    // from a campaign detail returns to.
    setSearchParams({ manager: m.manager_id, view: "own" });
    if (allowed()) applyManagerScope(m, true); // default: Own clients
  };

  // Toggle the selected manager's own/team view. Replace (not push) so the
  // toggle doesn't pile up history entries.
  const setMemberView = (own) => {
    const m = selected();
    if (!m) return;
    setSearchParams({ view: own ? "own" : "team" }, { replace: true });
    if (allowed()) applyManagerScope(m, own);
  };

  const backToRoster = () => {
    clearScope();
    setSearchParams({ manager: null, view: null });
  };

  // Restore scope for a manager that came back via the URL (e.g. Back from a
  // campaign detail), where openManager() never ran this mount. Priming the
  // "viewing as" email waits for the roster row to resolve.
  createEffect(() => {
    const m = selected();
    if (m && allowed() && !viewingAs()) applyManagerScope(m, ownFromUrl());
  });

  // Fresh entry (no manager in the URL) starts at the clean roster and clears any
  // lingering scope. Returning WITH a manager in the URL keeps that manager's
  // scope so the embedded dashboard renders scoped instead of resetting — while
  // "viewing as" a manager, the scope intentionally persists across navigation so
  // their Funding / CPL / Allowed-Budget pages stay scoped and the global CM
  // banner offers "Return".
  onMount(() => {
    const id = selectedId();
    if (id == null) clearScope();
    else setManagerScope(id, ownFromUrl());
  });

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      {/* Restoring a manager's dashboard after a Back-navigation while the
          roster reloads — hold the frame instead of flashing the roster. */}
      <Show when={showLoading()}>
        <div class="min-h-[50vh] flex items-center justify-center">
          <span class="w-7 h-7 rounded-full border-2 border-gray-300 border-t-blue-500 animate-spin" />
        </div>
      </Show>

      {/* ══════════════════ ROSTER VIEW ══════════════════ */}
      <Show when={showRoster()}>
        <div class="flex items-start justify-between flex-wrap gap-3 mb-6">
          <div>
            <p class="text-xs font-bold uppercase tracking-[0.12em] text-blue-600 dark:text-blue-400 mb-1.5">
              Admin · Team
            </p>
            <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
              Campaign Managers
            </h1>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Every campaign manager. Open one to see their dashboard — clients,
              drill-down, alerts and AI insights — exactly as they’d see it.
            </p>
          </div>
          <select
            value={month()}
            onChange={(e) => setMonth(e.target.value)}
            class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer"
          >
            <For each={monthOptions()}>{(o) => <option value={o.key}>{o.label}</option>}</For>
          </select>
        </div>

        {/* Backend-dependency flag — shown only once the probe confirms denial */}
        <Show when={switchMode() === "denied"}>
          <ViewAsBlockedBanner />
        </Show>

        {/* Roster summary chips */}
        <Show when={!data.loading && summary()}>
          <div class="flex flex-wrap gap-3 mb-5">
            <div class="px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Managers</p>
              <p class="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{num(summary().managers)}</p>
            </div>
            <div class="px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Total clients</p>
              <p class="text-xl font-bold text-gray-900 dark:text-white tabular-nums">
                {num(rows().reduce((s, r) => s + assignedCount(r), 0))}
              </p>
            </div>
            {/* Grand total allocated budget — straight from the roster summary. */}
            <Show when={summary().total_allocated_budget != null}>
              <div class="px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Allocated budget</p>
                <p class="text-xl font-bold text-gray-900 dark:text-white tabular-nums">
                  {money2(summary().total_allocated_budget)}<span class="text-sm font-medium text-gray-400 dark:text-gray-500">/day</span>
                </p>
              </div>
            </Show>
            <Show when={switchMode() === "checking"}>
              <div class="px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center gap-2">
                <span class="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-blue-500 animate-spin" />
                <span class="text-sm text-gray-500 dark:text-gray-400">Checking view-as access…</span>
              </div>
            </Show>
          </div>
        </Show>

        {/* Search */}
        <Show when={!data.loading && rows().length > 0}>
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-3.5 mb-4 flex flex-wrap items-center gap-3">
            <div class="relative flex-1 min-w-[220px]">
              <svg class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Search by manager email…"
                value={search()}
                onInput={(e) => setSearch(e.target.value)}
                class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
              {visibleRows().length} manager{visibleRows().length !== 1 ? "s" : ""}
            </span>
          </div>
        </Show>

        {/* Error */}
        <Show when={data.error}>
          <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4 text-sm text-red-600 dark:text-red-400">
            Failed to load campaign managers. Please try again.
          </div>
        </Show>

        {/* Roster table */}
        <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 overflow-auto max-h-[70vh]">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="text-[11px] font-bold uppercase tracking-[0.08em] text-[#54657E] dark:text-gray-300">
                <th class="sticky top-0 z-20 bg-gradient-to-b from-[#F1F4F9] to-[#E9EEF5] dark:from-gray-800 dark:to-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 shadow-[0_3px_6px_-3px_rgba(16,29,49,.18)] p-3.5 text-left whitespace-nowrap min-w-[240px]">Manager</th>
                <th class="sticky top-0 z-20 bg-gradient-to-b from-[#F1F4F9] to-[#E9EEF5] dark:from-gray-800 dark:to-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 shadow-[0_3px_6px_-3px_rgba(16,29,49,.18)] p-3.5 text-right whitespace-nowrap">Clients</th>
                <th class="sticky top-0 z-20 bg-gradient-to-b from-[#F1F4F9] to-[#E9EEF5] dark:from-gray-800 dark:to-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 shadow-[0_3px_6px_-3px_rgba(16,29,49,.18)] p-3.5 text-right whitespace-nowrap text-[#14233A] dark:text-gray-100">Allocated Budget</th>
                <th class="sticky top-0 z-20 bg-gradient-to-b from-[#F1F4F9] to-[#E9EEF5] dark:from-gray-800 dark:to-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 shadow-[0_3px_6px_-3px_rgba(16,29,49,.18)] p-3.5 text-right whitespace-nowrap" />
              </tr>
            </thead>
            <Show
              when={!data.loading}
              fallback={
                <tbody>
                  <For each={Array(8).fill(0)}>
                    {() => (
                      <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                        <For each={Array(4).fill(0)}>
                          {(_, i) => (
                            <td class="p-3.5">
                              <div class={`h-3 bg-gray-200 dark:bg-gray-700 rounded ${i() === 0 ? "w-48" : "w-16 ml-auto"}`} />
                            </td>
                          )}
                        </For>
                      </tr>
                    )}
                  </For>
                </tbody>
              }
            >
              <tbody>
                <For each={visibleRows()}>
                  {(r, i) => (
                    <tr class={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-blue-50/40 dark:hover:bg-gray-800/40 ${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/60 dark:bg-gray-800/30"}`}>
                      <td class="p-3.5">
                        <div class="flex items-center gap-3">
                          <Avatar name={r.manager_email} />
                          <span class="font-medium text-gray-800 dark:text-gray-100">{r.manager_email}</span>
                        </div>
                      </td>
                      <td class="p-3.5 text-right text-gray-700 dark:text-gray-300 tabular-nums">
                        <span class="font-medium">{num(assignedCount(r))}</span>
                        <Show when={r.client_count != null}>
                          <span class="text-gray-400 dark:text-gray-500 text-xs">{" · "}{num(r.client_count)} active</span>
                        </Show>
                      </td>
                      <td class="p-3.5 text-right tabular-nums">
                        {/* Served directly on the roster — no per-manager fetch. */}
                        <Show when={r.allocated_budget != null} fallback={<span class="text-gray-400 dark:text-gray-500">—</span>}>
                          <span class="font-medium text-gray-800 dark:text-gray-100">{money2(r.allocated_budget)}</span>
                          <span class="text-gray-400 dark:text-gray-500 text-xs">/day</span>
                        </Show>
                      </td>
                      <td class="p-3.5 text-right">
                        <button
                          onClick={() => openManager(r)}
                          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-gray-900 dark:bg-gray-700 text-white font-semibold hover:bg-black dark:hover:bg-gray-600 whitespace-nowrap"
                        >
                          View dashboard
                          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
                        </button>
                      </td>
                    </tr>
                  )}
                </For>
                <Show when={rows().length > 0 && visibleRows().length === 0}>
                  <tr><td colspan="4" class="py-16 text-center text-gray-400 dark:text-gray-500">No managers match your search.</td></tr>
                </Show>
                <Show when={rows().length === 0}>
                  <tr><td colspan="4" class="py-16 text-center text-gray-400 dark:text-gray-500">No campaign managers for this month.</td></tr>
                </Show>
              </tbody>
            </Show>
          </table>
        </div>

        <Show when={switchMode() === "denied" && rows().length > 0}>
          <p class="text-xs text-gray-400 dark:text-gray-500 mt-3">
            Per-manager dashboards appear here automatically once admin view-as is enabled on the backend.
          </p>
        </Show>
      </Show>

      {/* ══════════════════ SELECTED-MANAGER VIEW ══════════════════ */}
      <Show when={showManager()}>
        {/* Context header */}
        <div class="flex items-start justify-between flex-wrap gap-3 mb-5">
          <div class="flex items-center gap-3 min-w-0">
            <button
              onClick={backToRoster}
              class="flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 font-medium whitespace-nowrap"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              All managers
            </button>
            <div class="flex items-center gap-3 min-w-0">
              <Avatar name={selected().manager_email} />
              <div class="min-w-0">
                <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Viewing</p>
                <h1 class="text-lg font-semibold text-gray-900 dark:text-white truncate">{selected().manager_email}</h1>
              </div>
            </div>
          </div>

          {/* Own/team toggle — scopes THIS manager's view to their own clients or
              their full team. Defaults to Own clients on select. */}
          <Show when={allowed()}>
            <div class="flex items-center gap-2 self-center">
              <span class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Clients</span>
              <div class="inline-flex p-1 bg-gray-100 dark:bg-gray-800 rounded-xl" role="group" aria-label={`${selected().manager_email} client scope`}>
                <For each={[{ own: true, label: "Own clients" }, { own: false, label: "Full team" }]}>
                  {(o) => (
                    <button
                      onClick={() => setMemberView(o.own)}
                      class={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                        ownScope() === o.own
                          ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                          : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                      }`}
                    >
                      {o.label}
                    </button>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Allocated-budget headline card — read straight off the roster row. */}
          <div class="px-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
            <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">Allocated budget</p>
            <Show
              when={selected().allocated_budget != null}
              fallback={<p class="text-xl font-bold text-gray-400 dark:text-gray-500 mt-0.5">—</p>}
            >
              <p class="text-xl font-bold text-gray-900 dark:text-white mt-0.5">
                {money2(selected().allocated_budget)}<span class="text-sm font-medium text-gray-400 dark:text-gray-500">/day</span>
              </p>
            </Show>
            <p class="text-xs text-gray-400 dark:text-gray-500">
              across {num(assignedCount(selected()))} clients
              <Show when={selected().client_count != null}>{" "}({num(selected().client_count)} active)</Show>
            </p>
          </div>
        </div>

        {/* If admin switch-mode is disabled, the embedded dashboards can't load —
            show the clear, actionable state instead of a broken dashboard. */}
        <Show when={!allowed()}>
          <ViewAsBlockedBanner />
          <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 py-16 px-6 text-center">
            <div class="mx-auto w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
              <svg class="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">Manager dashboard not available yet</h3>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1 max-w-md mx-auto">
              Viewing {selected().manager_email}’s dashboard needs admin view-as enabled
              on the backend (see the note above). The manager roster is fully available now.
            </p>
          </div>
        </Show>

        {/* When switch-mode is permitted, embed the real CM dashboard scoped to
            this manager. Tabs mirror the CM dashboard's surfaces. */}
        <Show when={allowed()}>
          <div class="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit mb-4">
            <For each={[{ k: "dashboard", label: "Dashboard" }, { k: "alerts", label: "Alerts" }]}>
              {(t) => (
                <button
                  onClick={() => setTab(t.k)}
                  class={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                    tab() === t.k
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  {t.label}
                </button>
              )}
            </For>
          </div>

          {/* Embedded, scope-driven CM components — identical to the CM's own
              view. They react to the global cmScope signal we set in
              openManager(), so they render this manager's data. Each is mounted
              fresh per manager (the parent Show unmounts on "All managers"). */}
          <Show when={tab() === "dashboard"}>
            <CMDashboard />
          </Show>
          <Show when={tab() === "alerts"}>
            <AlertsPanel />
          </Show>
        </Show>
      </Show>
    </div>
  );
}
