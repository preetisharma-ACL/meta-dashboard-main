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

// Compact money for the hero sub-labels only (e.g. ₹42.05L). Display-only —
// never used for any figure the roster serves authoritatively.
const compactINR = (v) => {
  const n = Number(v) || 0;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}K`;
  return `₹${n.toFixed(0)}`;
};

// Friendly manager name from the email local-part (presentation only).
const labelFromEmail = (email) => {
  const local = String(email ?? "").split("@")[0] || "—";
  return local.charAt(0).toUpperCase() + local.slice(1);
};

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

  // Derived display aggregates for the hero bar + budget mini-bars. Pure
  // presentation over already-fetched roster fields — no extra fetches.
  const totalAssigned = () => rows().reduce((s, r) => s + assignedCount(r), 0);
  const totalActive = () =>
    rows().reduce((s, r) => s + (Number(r.client_count) || 0), 0);
  const maxBudget = () =>
    Math.max(1, ...rows().map((r) => Number(r.allocated_budget) || 0));

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
        {/* ── Header ── */}
        <div class="flex items-start justify-between flex-wrap gap-4 mb-7">
          <div class="min-w-0">
            <p class="flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.18em] mb-3">
              <span class="inline-flex items-center gap-1.5 text-[#AC2334]">
                <span class="w-1.5 h-1.5 rounded-full bg-[#AC2334]" />
                Admin
              </span>
              <span class="text-gray-300 dark:text-gray-600">·</span>
              <span class="text-gray-400 dark:text-gray-500">Team</span>
            </p>
            <h1 class="cm-serif text-4xl md:text-5xl text-gray-900 dark:text-white leading-[1.04]">
              Campaign Managers
            </h1>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-3 max-w-xl leading-relaxed">
              Every campaign manager on the desk. Open one to see their dashboard —
              clients, drill-down, alerts and AI insights — exactly as they see it.
            </p>
          </div>

          {/* Reporting period — restyled box wrapping the untouched month <select> */}
          <div class="rounded-xl border border-[#AC2334]/50 dark:border-[#AC2334]/45 bg-white dark:bg-gray-900 px-4 py-2 shadow-sm">
            <p class="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">
              Reporting Period
            </p>
            <select
              value={month()}
              onChange={(e) => setMonth(e.target.value)}
              class="mt-0.5 -ml-0.5 bg-transparent text-[15px] font-semibold text-gray-900 dark:text-white focus:outline-none cursor-pointer"
            >
              <For each={monthOptions()}>{(o) => <option value={o.key}>{o.label}</option>}</For>
            </select>
          </div>
        </div>

        {/* Backend-dependency flag — shown only once the probe confirms denial */}
        <Show when={switchMode() === "denied"}>
          <ViewAsBlockedBanner />
        </Show>

        {/* ── Hero stat bar ── */}
        <Show when={!data.loading && summary()}>
          <div class="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#14233A] via-[#1B2E4B] to-[#14233A] shadow-[0_10px_30px_-12px_rgba(16,29,49,.5)] mb-6">
            <div class="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/10">
              {/* Managers */}
              <div class="p-6">
                <p class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45 mb-2.5">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4z" /></svg>
                  Managers
                </p>
                <p class="text-3xl font-bold text-white tabular-nums leading-none">{num(summary().managers)}</p>
                <p class="text-[13px] text-white/45 mt-2">On the roster this period</p>
              </div>
              {/* Total clients */}
              <div class="p-6">
                <p class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45 mb-2.5">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" /></svg>
                  Total Clients
                </p>
                <p class="text-3xl font-bold text-white tabular-nums leading-none">{num(totalAssigned())}</p>
                <p class="text-[13px] text-white/45 mt-2">
                  <span class="font-semibold text-emerald-300/90">{num(totalActive())} active</span>
                  {" · "}{num(Math.max(0, totalAssigned() - totalActive()))} paused
                </p>
              </div>
              {/* Allocated budget */}
              <div class="p-6">
                <p class="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white/45 mb-2.5">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" /></svg>
                  Allocated Budget
                </p>
                <Show
                  when={summary().total_allocated_budget != null}
                  fallback={<p class="text-3xl font-bold text-white/50 tabular-nums leading-none">—</p>}
                >
                  <p class="text-3xl font-bold text-white tabular-nums leading-none">
                    {money2(summary().total_allocated_budget)}<span class="text-base font-semibold text-white/40">/day</span>
                  </p>
                  <p class="text-[13px] text-white/45 mt-2">≈ {compactINR(Number(summary().total_allocated_budget) * 30)} monthly commitment</p>
                </Show>
              </div>
            </div>
          </div>
        </Show>

        {/* Checking view-as access — subtle line */}
        <Show when={switchMode() === "checking"}>
          <div class="flex items-center gap-2 mb-4 text-sm text-gray-500 dark:text-gray-400">
            <span class="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-[#AC2334] animate-spin" />
            Checking view-as access…
          </div>
        </Show>

        {/* Error */}
        <Show when={data.error}>
          <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4 text-sm text-red-600 dark:text-red-400">
            Failed to load campaign managers. Please try again.
          </div>
        </Show>

        {/* ── Search ── */}
        <Show when={!data.loading && rows().length > 0}>
          <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm p-2 pl-4 mb-5 flex items-center gap-3">
            <svg class="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search by manager email…"
              value={search()}
              onInput={(e) => setSearch(e.target.value)}
              class="flex-1 min-w-0 bg-transparent py-2 text-sm text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none"
            />
            <span class="flex-shrink-0 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">
              {visibleRows().length} manager{visibleRows().length !== 1 ? "s" : ""}
            </span>
          </div>
        </Show>

        {/* ── Column labels ── */}
        <Show when={!data.loading && visibleRows().length > 0}>
          <div class="hidden md:grid md:grid-cols-[minmax(0,1fr)_150px_minmax(220px,1.1fr)_160px] items-center gap-4 px-5 mb-2.5 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-400 dark:text-gray-500">
            <span>Manager</span>
            <span>Clients</span>
            <span>Allocated Budget</span>
            <span />
          </div>
        </Show>

        {/* ── Manager list ── */}
        <Show
          when={!data.loading}
          fallback={
            <div class="space-y-3">
              <For each={Array(6).fill(0)}>
                {() => (
                  <div class="flex items-center gap-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-4 animate-pulse">
                    <div class="w-11 h-11 rounded-full bg-gray-200 dark:bg-gray-700 flex-shrink-0" />
                    <div class="flex-1 space-y-2">
                      <div class="h-3 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
                      <div class="h-2.5 w-56 bg-gray-100 dark:bg-gray-800 rounded" />
                    </div>
                    <div class="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div class="h-3 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div class="h-9 w-32 bg-gray-200 dark:bg-gray-700 rounded-xl" />
                  </div>
                )}
              </For>
            </div>
          }
        >
          <div class="space-y-3">
            <For each={visibleRows()}>
              {(r) => (
                <div class="group grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_150px_minmax(220px,1.1fr)_160px] items-center gap-4 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-5 py-4 transition-all hover:border-[#14233A]/30 dark:hover:border-gray-600 hover:shadow-[0_8px_24px_-14px_rgba(16,29,49,.4)]">
                  {/* Manager */}
                  <div class="flex items-center gap-3.5 min-w-0">
                    <Avatar name={r.manager_email} size="w-11 h-11" />
                    <div class="min-w-0">
                      <p class="font-semibold text-gray-900 dark:text-gray-100 truncate">
                        {labelFromEmail(r.manager_email)}
                      </p>
                      <p class="text-[13px] text-gray-500 dark:text-gray-400 truncate" title={r.manager_email}>
                        {r.manager_email}
                      </p>
                    </div>
                  </div>

                  {/* Clients */}
                  <div class="flex items-center gap-2.5">
                    <span class="text-xl font-bold text-gray-900 dark:text-white tabular-nums">{num(assignedCount(r))}</span>
                    <Show when={r.client_count != null}>
                      {(() => {
                        const allActive = Number(r.client_count) >= assignedCount(r);
                        return (
                          <span class={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${allActive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300" : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"}`}>
                            <span class={`w-1.5 h-1.5 rounded-full ${allActive ? "bg-emerald-500" : "bg-amber-500"}`} />
                            {num(r.client_count)} active
                          </span>
                        );
                      })()}
                    </Show>
                  </div>

                  {/* Allocated budget — mini-bar scaled to the roster max */}
                  <div class="min-w-0">
                    <Show
                      when={r.allocated_budget != null}
                      fallback={<span class="text-gray-400 dark:text-gray-500">—</span>}
                    >
                      <div class="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-2">
                        <div
                          class="h-full rounded-full bg-gradient-to-r from-[#14233A] to-[#3B5A86] dark:from-blue-500 dark:to-indigo-500"
                          style={{ width: `${Math.max(4, Math.round(((Number(r.allocated_budget) || 0) / maxBudget()) * 100))}%` }}
                        />
                      </div>
                      <p class="text-sm tabular-nums">
                        <span class="font-bold text-gray-900 dark:text-gray-100">{money2(r.allocated_budget)}</span>
                        <span class="text-gray-400 dark:text-gray-500 text-xs">/day</span>
                      </p>
                    </Show>
                  </div>

                  {/* Action */}
                  <div class="md:text-right">
                    <button
                      onClick={() => openManager(r)}
                      class="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm rounded-xl bg-[#14233A] dark:bg-gray-700 text-white font-semibold hover:bg-[#0E1A2C] dark:hover:bg-gray-600 transition-colors shadow-sm whitespace-nowrap"
                    >
                      View dashboard
                      <svg class="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
                    </button>
                  </div>
                </div>
              )}
            </For>

            <Show when={rows().length > 0 && visibleRows().length === 0}>
              <div class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-16 text-center text-gray-400 dark:text-gray-500">
                No managers match your search.
              </div>
            </Show>
            <Show when={rows().length === 0}>
              <div class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-16 text-center text-gray-400 dark:text-gray-500">
                No campaign managers for this month.
              </div>
            </Show>
          </div>
        </Show>

        <Show when={switchMode() === "denied" && rows().length > 0}>
          <p class="text-xs text-gray-400 dark:text-gray-500 mt-4">
            Per-manager dashboards appear here automatically once admin view-as is enabled on the backend.
          </p>
        </Show>
      </Show>

      {/* ══════════════════ SELECTED-MANAGER VIEW ══════════════════ */}
      <Show when={showManager()}>
        {/* ══════════════════ CONTEXT HEADER ══════════════════ */}
        {/* Back link — a quiet breadcrumb above the identity card. */}
        <button
          onClick={backToRoster}
          class="group inline-flex items-center gap-1.5 mb-3 text-sm font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          <svg class="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          All managers
        </button>

        {/* Identity + controls — one cohesive panel with a subtle gradient rail. */}
        <div class="relative rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-[0_1px_2px_rgba(16,29,49,.06),0_8px_24px_rgba(16,29,49,.05)] overflow-hidden mb-5">
          <span class="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-blue-500 to-indigo-600" />
          <div class="flex flex-col lg:flex-row lg:items-center gap-x-8 gap-y-5 p-5 pl-6">
            {/* Identity */}
            <div class="flex items-center gap-4 min-w-0 flex-1">
              <Avatar name={selected().manager_email} size="w-14 h-14" textSize="text-lg" class="ring-2 ring-white dark:ring-gray-800 shadow-md" />
              <div class="min-w-0">
                <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600 dark:text-blue-400 mb-1">
                  Viewing · Campaign Manager
                </p>
                <h1 class="text-xl font-bold text-gray-900 dark:text-white truncate leading-tight" title={selected().manager_email}>
                  {selected().manager_email}
                </h1>
                <div class="flex items-center gap-2 mt-2 text-xs">
                  <span class="inline-flex items-center gap-1.5 font-semibold text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                    <svg class="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 10-4-4 4 4 0 004 4z" /></svg>
                    {num(assignedCount(selected()))} clients
                  </span>
                  <Show when={selected().client_count != null}>
                    <span class="inline-flex items-center gap-1.5 font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/30 px-2 py-0.5 rounded-full">
                      <span class="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                      {num(selected().client_count)} active
                    </span>
                  </Show>
                </div>
              </div>
            </div>

            {/* Controls — grouped into a single grounded stat bar so the right
                side reads as one solid block, not scattered text. */}
            <div class="flex items-stretch rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-800/40 divide-x divide-gray-200 dark:divide-gray-700 self-start lg:self-auto overflow-hidden">
              {/* Own/team toggle — scopes THIS manager to their own clients or full
                  team. Defaults to Own clients on select. */}
              <Show when={allowed()}>
                <div class="px-4 py-3">
                  <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1.5">Clients</p>
                  <div class="inline-flex p-1 bg-gray-100 dark:bg-gray-900 rounded-lg" role="group" aria-label={`${selected().manager_email} client scope`}>
                    <For each={[{ own: true, label: "Own clients" }, { own: false, label: "Full team" }]}>
                      {(o) => (
                        <button
                          onClick={() => setMemberView(o.own)}
                          class={`px-3.5 py-1.5 rounded-md text-sm font-semibold transition-all ${
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

              {/* Allocated-budget stat — read straight off the roster row. */}
              <div class="px-5 py-3 flex flex-col justify-center text-right whitespace-nowrap">
                <p class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-1">Allocated budget</p>
                <Show
                  when={selected().allocated_budget != null}
                  fallback={<p class="text-2xl font-extrabold text-gray-400 dark:text-gray-500 leading-none">—</p>}
                >
                  <p class="text-2xl font-extrabold text-gray-900 dark:text-white leading-none tabular-nums">
                    {money2(selected().allocated_budget)}<span class="text-sm font-semibold text-gray-400 dark:text-gray-500">/day</span>
                  </p>
                </Show>
                <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1.5">daily allocation</p>
              </div>
            </div>
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
