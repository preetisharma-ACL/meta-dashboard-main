import {
  createResource,
  createMemo,
  createSignal,
  createEffect,
  on,
  For,
  Show,
} from "solid-js";
import { fetchManagerPerformance } from "../../../services/performance";
import {
  probeAdminSwitchMode,
  fetchManagerOwnClients,
} from "../../../services/cmAdmin";
import { fetchAllAdminClients } from "../services/fetchClients";
import Avatar from "../../../components/common/Avatar";

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN · Campaign Manager's Clients  (route: /campaign-manager-clients)
// Master-detail: a manager rail (search + per-manager mix) on the left, and a
// client ledger on the right — either the full ledger grouped by manager
// ("All clients") or a single manager's roster. Each client is tagged CPL /
// Hybrid / Retainer.
//
// Data assembly (both patterns already used on the Campaign Managers screen):
//   • Manager roster           ← fetchManagerPerformance()  (manager_id/email)
//   • Ownership + names + type  ← fetchManagerOwnClients(id)  (scope=own hierarchy
//     list per manager; carries client_name, client_type, client_nomen_id — but
//     NOT an active flag).
//   • Authoritative active flag ← fetchAllAdminClients()  (/clients/admin/clients
//     rows carry is_active + client_nomen).
// We keep only own-clients whose nomen is in the admin *active* set. Join key is
// the client nomen id (hierarchy `client_nomen_id` == admin `client_nomen`).
//
// Requires admin switch-mode (as_team_member_id). A one-shot probe gates the
// per-manager calls so they're only issued when they'll succeed.
// ─────────────────────────────────────────────────────────────────────────────

const TYPE_CHIP = {
  hybrid: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  cpl: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  retainer: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

const labelFromEmail = (email) => {
  const local = String(email ?? "").split("@")[0] || "—";
  return local.charAt(0).toUpperCase() + local.slice(1);
};

const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Last 12 months, newest first — the manager roster is month-scoped, so a month
// with no performance data returns no managers; this lets the admin pick one.
const monthOptions = () => {
  const now = new Date();
  const opts = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
    opts.push({ key, label });
  }
  return opts;
};

const CLIENT_TYPES = [
  { key: "cpl", label: "CPL" },
  { key: "hybrid", label: "Hybrid" },
  { key: "retainer", label: "Retainer" },
];
// All three selected by default — show every active client.
const DEFAULT_CLIENT_TYPES = CLIENT_TYPES.map((t) => t.key);

// Chip label — CPL stays upper-case, the rest are Title-cased by the caller's
// uppercase utility class.
const tagLabel = (t) => (t === "cpl" ? "CPL" : t);

// ── Small presentational helpers ────────────────────────────────────────────
// A three-segment proportional bar (CPL · Hybrid · Retainer).
function MixBar(props) {
  const c = () => props.counts || { cpl: 0, hybrid: 0, retainer: 0 };
  return (
    <div
      class={`flex rounded overflow-hidden ${
        props.active ? "bg-white/20" : "bg-gray-100 dark:bg-gray-800"
      } ${props.class || "h-1"}`}
    >
      <span class="bg-teal-500" style={{ "flex-grow": String(c().cpl) }} />
      <span class="bg-indigo-500" style={{ "flex-grow": String(c().hybrid) }} />
      <span class="bg-amber-400" style={{ "flex-grow": String(c().retainer) }} />
    </div>
  );
}

function TypeTag(props) {
  return (
    <span
      class={`inline-block text-[10px] font-bold tracking-[0.08em] uppercase px-2.5 py-[3px] rounded-full whitespace-nowrap ${
        TYPE_CHIP[props.type] ?? TYPE_CHIP.retainer
      }`}
    >
      {tagLabel(props.type)}
    </span>
  );
}

export default function CampaignManagerClients() {
  const [month, setMonth] = createSignal(currentMonthKey());
  const [clientTypes, setClientTypes] = createSignal(DEFAULT_CLIENT_TYPES);

  // Master-detail UI state (client-side only — never touches the API layer).
  const [selected, setSelected] = createSignal("all"); // "all" | manager_id
  const [query, setQuery] = createSignal("");

  // Toggle a client-type pill; never allow an empty selection.
  const toggleClientType = (key) => {
    setClientTypes((prev) => {
      const next = prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key];
      return next.length ? next : prev;
    });
  };
  const allTypesSelected = () => clientTypes().length === CLIENT_TYPES.length;

  // ── Manager roster (admin-readable; month-scoped, refetches on change). ──
  const [rosterRes] = createResource(month, async (m) => {
    const res = await fetchManagerPerformance(m);
    return Array.isArray(res?.data) ? res.data : [];
  });
  const managers = () => rosterRes() ?? [];

  // ── Switch-mode probe (role-level, one probe is authoritative) ──
  const [switchMode, setSwitchMode] = createSignal("unknown");
  createEffect(
    on(managers, (list) => {
      if (switchMode() !== "unknown") return;
      if (!list || list.length === 0) return;
      setSwitchMode("checking");
      probeAdminSwitchMode(list[0].manager_id)
        .then((r) => setSwitchMode(r.allowed ? "allowed" : "denied"))
        .catch(() => setSwitchMode("denied"));
    }),
  );
  const allowed = () => switchMode() === "allowed";

  // ── Authoritative active-client set — loaded once when switch-mode allows ──
  const [adminClients] = createResource(
    () => (allowed() ? "load" : null),
    fetchAllAdminClients,
  );

  // ── Per-manager own-client lists — one call per manager, in parallel ──
  const [ownLists] = createResource(
    () => (allowed() && managers().length ? managers() : null),
    async (list) => {
      const entries = await Promise.all(
        list.map(async (m) => [
          m.manager_id,
          await fetchManagerOwnClients(m.manager_id),
        ]),
      );
      return Object.fromEntries(entries);
    },
  );

  // nomen (as string) → true, for clients the admin list marks is_active.
  const activeNomen = createMemo(() => {
    const set = new Set();
    for (const c of adminClients() ?? []) {
      if (c.is_active) set.add(String(c.client_nomen));
    }
    return set;
  });

  // One card model per manager: their active clients (name + type), de-duped by
  // nomen, sorted A→Z. Managers are ordered by active-client count (desc).
  const cards = createMemo(() => {
    const own = ownLists() ?? {};
    const active = activeNomen();
    const types = clientTypes();
    const filterAll = allTypesSelected();
    return managers()
      .map((m) => {
        const seen = new Set();
        const clients = (own[m.manager_id] ?? [])
          .filter((c) => {
            const key = String(c.client_nomen_id);
            if (!active.has(key) || seen.has(key)) return false;
            if (!filterAll && !types.includes(c.client_type)) return false;
            seen.add(key);
            return true;
          })
          .map((c) => ({
            id: c.client_nomen_id,
            name: c.client_name,
            type: c.client_type,
          }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        return { manager: m, clients };
      })
      .sort((a, b) => b.clients.length - a.clients.length);
  });

  // Full (type-unfiltered) active-client counts per manager — powers the rail
  // mix bars, the segment badges and the roster totals, so those read as
  // "everything available" while the ledger below reflects the current filter.
  const fullByMgr = createMemo(() => {
    const own = ownLists() ?? {};
    const active = activeNomen();
    const map = {};
    for (const m of managers()) {
      const seen = new Set();
      const counts = { cpl: 0, hybrid: 0, retainer: 0, total: 0 };
      for (const c of own[m.manager_id] ?? []) {
        const key = String(c.client_nomen_id);
        if (!active.has(key) || seen.has(key)) continue;
        seen.add(key);
        const t = counts[c.client_type] != null ? c.client_type : "retainer";
        counts[t]++;
        counts.total++;
      }
      map[m.manager_id] = counts;
    }
    return map;
  });

  // Aggregate counts across every manager (for "All clients" overview).
  const aggCounts = createMemo(() => {
    const acc = { cpl: 0, hybrid: 0, retainer: 0, total: 0 };
    const m = fullByMgr();
    for (const id in m) {
      acc.cpl += m[id].cpl;
      acc.hybrid += m[id].hybrid;
      acc.retainer += m[id].retainer;
      acc.total += m[id].total;
    }
    return acc;
  });

  // Rail roster — every manager, ordered by full active-client count (desc).
  const railManagers = createMemo(() =>
    managers()
      .map((m) => ({
        manager: m,
        counts: fullByMgr()[m.manager_id] || {
          cpl: 0,
          hybrid: 0,
          retainer: 0,
          total: 0,
        },
      }))
      .sort((a, b) => b.counts.total - a.counts.total),
  );

  // manager_id → type-filtered client list (drives the ledger body).
  const filteredByMgr = createMemo(() =>
    Object.fromEntries(cards().map((c) => [c.manager.manager_id, c.clients])),
  );

  const grandTotalFull = () => aggCounts().total;

  // ── Selection helpers ──
  const activeManager = () =>
    railManagers().find((r) => r.manager.manager_id === selected());
  const mode = () => (selected() === "all" || !activeManager() ? "all" : "single");
  const segCounts = () =>
    mode() === "all"
      ? aggCounts()
      : fullByMgr()[selected()] || { cpl: 0, hybrid: 0, retainer: 0, total: 0 };

  const matchQuery = (client, mgr) => {
    const q = query().trim().toLowerCase();
    if (!q) return true;
    return `${client.name} ${labelFromEmail(mgr.manager_email)}`
      .toLowerCase()
      .includes(q);
  };

  // Grouped ledger for "All clients" mode — groups with at least one match.
  const groups = createMemo(() =>
    railManagers()
      .map((r) => ({
        manager: r.manager,
        counts: r.counts,
        clients: (filteredByMgr()[r.manager.manager_id] || []).filter((c) =>
          matchQuery(c, r.manager),
        ),
      }))
      .filter((g) => g.clients.length > 0),
  );

  // Flat ledger for single-manager mode.
  const singleRows = createMemo(() => {
    const m = activeManager();
    if (!m) return [];
    return (filteredByMgr()[m.manager.manager_id] || []).filter((c) =>
      matchQuery(c, m.manager),
    );
  });

  const shownCount = () =>
    mode() === "all"
      ? groups().reduce((s, g) => s + g.clients.length, 0)
      : singleRows().length;
  const totalCount = () => segCounts().total;

  // A search should widen the view to the full ledger (design behaviour).
  const onSearch = (v) => {
    setQuery(v);
    if (v.trim() && selected() !== "all") setSelected("all");
  };

  // Switching month resets the selection so a stale manager_id can't linger.
  createEffect(on(month, () => setSelected("all"), { defer: true }));

  const monthLabel = () =>
    monthOptions().find((o) => o.key === month())?.label ?? month();

  // The roster must resolve (not error) before the probe can run. Only treat
  // the probe as "loading" when we actually have managers to probe with —
  // otherwise an errored/empty roster would leave switchMode stuck at "unknown"
  // and the skeleton would spin forever.
  const rosterReady = () => !rosterRes.loading && !rosterRes.error;
  const probing = () =>
    switchMode() === "unknown" || switchMode() === "checking";
  const dataLoading = () =>
    rosterRes.loading ||
    (rosterReady() && managers().length > 0 && probing()) ||
    (allowed() && (adminClients.loading || ownLists.loading));
  const failed = () => rosterRes.error || adminClients.error || ownLists.error;
  // Roster came back with zero managers (distinct from "still loading").
  const noManagers = () => rosterReady() && managers().length === 0;
  const ready = () =>
    allowed() && !dataLoading() && !failed() && !noManagers();

  // Icons ------------------------------------------------------------------
  const CalendarIcon = (p) => (
    <svg
      class={p.class}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
    </svg>
  );

  return (
    <div class="min-h-screen bg-[#F6F7FA] dark:bg-gray-900">
      {/* ─────────────── Masthead (light card) ─────────────── */}
      <div class="max-w-[1480px] mx-auto px-4 md:px-9 pt-6">
        <header class="relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden px-6 md:px-8 py-6">
          {/* thin secondary (crimson) accent rule */}
          <span class="absolute inset-x-0 top-0 h-1 bg-[#AC2334]" />
          <nav
            class="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] uppercase text-gray-400 mb-3"
            aria-label="Breadcrumb"
          >
            <span>Admin</span>
            <span class="text-gray-300 dark:text-gray-600">/</span>
            <span>Team</span>
            <span class="text-gray-300 dark:text-gray-600">/</span>
            <span class="text-[#AC2334]">Campaign Managers</span>
          </nav>
          <div class="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <h1 class="font-sans font-bold text-xl   text-gray-700 dark:text-white">
                Campaign Manager's Clients
              </h1>
              <p class="mt-2 text-[13.5px] text-gray-500 dark:text-gray-400 max-w-[560px]">
                Active clients grouped by campaign manager. Select a manager to
                review their roster, or view the full client ledger.
              </p>
            </div>
            <div class="flex flex-wrap gap-3">
              <StatCard
                value={ready() ? managers().length : "—"}
                label="Managers"
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="w-[18px] h-[18px]"
                  >
                    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                }
              />
              <StatCard
                value={ready() ? grandTotalFull() : "—"}
                label="Active clients"
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="w-[18px] h-[18px]"
                  >
                    <rect x="2" y="7" width="20" height="14" rx="2" />
                    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                  </svg>
                }
              />
              <StatCard
                value={
                  ready() && managers().length
                    ? (grandTotalFull() / managers().length).toFixed(1)
                    : "—"
                }
                suffix="avg"
                label="Clients / manager"
                icon={
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    class="w-[18px] h-[18px]"
                  >
                    <line x1="6" y1="20" x2="6" y2="14" />
                    <line x1="12" y1="20" x2="12" y2="4" />
                    <line x1="18" y1="20" x2="18" y2="10" />
                  </svg>
                }
              />
            </div>
          </div>
        </header>
      </div>

      <div class="max-w-[1480px] mx-auto px-4 md:px-9 pt-6 pb-16">
        {/* Needs admin view-as — quiet note if the probe reports denial. */}
        <Show when={switchMode() === "denied"}>
          <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 text-sm text-gray-500 dark:text-gray-400">
            Per-manager client lists appear here once admin view-as is enabled on
            the backend.
          </div>
        </Show>

        {/* Roster resolved but empty for the selected month. */}
        <Show when={noManagers() && !failed() && switchMode() !== "denied"}>
          <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 text-sm text-gray-500 dark:text-gray-400">
            No campaign managers with data for this month. Try an earlier month
            from the selector above.
          </div>
        </Show>

        {/* Error */}
        <Show when={!dataLoading() && failed()}>
          <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
            Couldn't load campaign managers' clients. Please try again.
          </div>
        </Show>

        {/* Loading skeleton (master-detail shaped) */}
        <Show when={dataLoading() && switchMode() !== "denied"}>
          <div class="grid grid-cols-1 lg:grid-cols-[296px_minmax(0,1fr)] gap-6 items-start">
            <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-3.5 animate-pulse">
              <div class="h-9 bg-gray-100 dark:bg-gray-800 rounded-lg mb-3" />
              <div class="space-y-2.5">
                <For each={Array(7).fill(0)}>
                  {() => (
                    <div class="flex items-center gap-3">
                      <div class="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700" />
                      <div class="h-3 flex-1 bg-gray-200 dark:bg-gray-700 rounded" />
                    </div>
                  )}
                </For>
              </div>
            </div>
            <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 animate-pulse">
              <div class="flex items-center gap-3.5 mb-6">
                <div class="w-11 h-11 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div class="h-5 w-48 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
              <div class="space-y-3">
                <For each={Array(8).fill(0)}>
                  {() => (
                    <div class="h-4 w-full bg-gray-100 dark:bg-gray-800 rounded" />
                  )}
                </For>
              </div>
            </div>
          </div>
        </Show>

        {/* ─────────────── Master-detail workspace ─────────────── */}
        <Show when={ready()}>
          <div class="grid grid-cols-1 lg:grid-cols-[296px_minmax(0,1fr)] gap-6 items-start">
            {/* ── Manager rail ── */}
            <aside class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm flex flex-col lg:sticky lg:top-5 lg:max-h-[calc(100vh-40px)]">
              <div class="p-3.5 border-b border-gray-100 dark:border-gray-800">
                <div class="text-[13px] text-gray-400 dark:text-gray-100 font-semibold  text-gray-600 mb-2.5 px-0.5">
                  Campaign Managers
                </div>
                <div class="relative">
                  <svg
                    class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    type="search"
                    value={query()}
                    onInput={(e) => onSearch(e.target.value)}
                    placeholder="Search clients or managers…"
                    aria-label="Search clients or managers"
                    class="w-full h-[35px] rounded-[9px] border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 pl-[33px] pr-3 text-[13px] text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-[#14233A] focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-[#14233A]/10 transition-colors"
                  />
                </div>
              </div>

              <nav class="overflow-y-auto p-2 flex-1">
                {/* All clients */}
                <div class="border-b border-gray-100 dark:border-gray-800 mb-1 pb-1">
                  <RailRow
                    active={selected() === "all"}
                    onClick={() => setSelected("all")}
                    marker={
                      <div class="w-9 h-9 rounded-full grid place-items-center bg-[#AC2334] text-white font-sans font-bold flex-shrink-0">
                        A
                      </div>
                    }
                    name="All clients"
                    count={grandTotalFull()}
                    counts={aggCounts()}
                  />
                </div>

                <For each={railManagers()}>
                  {(r) => (
                    <RailRow
                      active={selected() === r.manager.manager_id}
                      onClick={() => setSelected(r.manager.manager_id)}
                      marker={
                        <Avatar
                          name={labelFromEmail(r.manager.manager_email)}
                          size="w-9 h-9"
                          textSize="text-[13px]"
                        />
                      }
                      name={labelFromEmail(r.manager.manager_email)}
                      count={r.counts.total}
                      counts={r.counts}
                    />
                  )}
                </For>
              </nav>
            </aside>

            {/* ── Detail panel ── */}
            <section class="min-w-0" aria-live="polite">
              {/* Header */}
              <div class="flex items-center justify-between gap-4 flex-wrap mb-3.5">
                <div class="flex items-center gap-3.5 min-w-0">
                  <Show
                    when={mode() === "single"}
                    fallback={
                      <div class="w-[46px] h-[46px] rounded-xl grid place-items-center bg-[#AC2334] text-white font-sans text-xl font-bold flex-shrink-0">
                        A
                      </div>
                    }
                  >
                    <Avatar
                      name={labelFromEmail(activeManager().manager.manager_email)}
                      size="w-[46px] h-[46px]"
                      textSize="text-lg"
                      class="rounded-xl"
                    />
                  </Show>
                  <div class="min-w-0">
                    <div class="font-sans font-bold  text-lg  text-gray-800 dark:text-white truncate">
                      {mode() === "all"
                        ? "All clients"
                        : labelFromEmail(activeManager().manager.manager_email)}
                    </div>
                    <div class="text-[12.5px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">
                      {mode() === "all"
                        ? `Full ledger across ${managers().length} campaign manager${
                            managers().length !== 1 ? "s" : ""
                          }`
                        : activeManager().manager.manager_email}
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-3 flex-wrap">
                  {/* Client-type segment (the multi-select type filter) */}
                  <div class="inline-flex bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[10px] p-[3px] gap-0.5">
                    <SegButton
                      active={allTypesSelected()}
                      onClick={() => setClientTypes(DEFAULT_CLIENT_TYPES)}
                      label="All"
                      count={segCounts().total}
                    />
                    <For each={CLIENT_TYPES}>
                      {(t) => (
                        <SegButton
                          active={clientTypes().includes(t.key)}
                          onClick={() => toggleClientType(t.key)}
                          label={t.label}
                          count={segCounts()[t.key]}
                        />
                      )}
                    </For>
                  </div>

                  {/* Month selector (native select, styled as the design pill) */}
                  <div class="relative">
                    <CalendarIcon class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 dark:text-gray-400 pointer-events-none" />
                    <select
                      value={month()}
                      onChange={(e) => setMonth(e.target.value)}
                      aria-label="Reporting month"
                      class="appearance-none h-9 pl-9 pr-9 rounded-[10px] border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[13px] font-semibold text-gray-800 dark:text-gray-100 cursor-pointer focus:outline-none focus:border-[#14233A] focus:ring-2 focus:ring-[#14233A]/10"
                    >
                      <For each={monthOptions()}>
                        {(o) => <option value={o.key}>{o.label}</option>}
                      </For>
                    </select>
                    <svg
                      class="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 dark:text-gray-400 pointer-events-none"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    >
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Mix summary */}
              <div class="flex items-center gap-4 mb-3.5 text-[12px] text-gray-400 dark:text-gray-500 font-medium flex-wrap">
                <MixBar
                  counts={segCounts()}
                  class="w-[180px] h-1.5 flex-shrink-0"
                />
                <MixKey color="bg-teal-500" n={segCounts().cpl} label="CPL" />
                <MixKey
                  color="bg-indigo-500"
                  n={segCounts().hybrid}
                  label="Hybrid"
                />
                <MixKey
                  color="bg-amber-400"
                  n={segCounts().retainer}
                  label="Retainer"
                />
                <span>
                  <b class="text-gray-600 dark:text-gray-300 tabular-nums font-semibold">
                    {segCounts().total}
                  </b>{" "}
                  total
                </span>
              </div>

              {/* Ledger */}
              <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden shadow-sm">
                <div class="overflow-x-auto">
                  <table class="w-full border-collapse">
                    <thead>
                      <tr>
                        <th class="text-left text-[10.5px] font-bold tracking-[0.12em] uppercase text-gray-400 pl-[22px] pr-4 py-3 bg-[#14233A]/[0.03] dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 w-[52px]">
                          #
                        </th>
                        <th class="text-left text-[10.5px] font-bold tracking-[0.12em] uppercase text-gray-400 px-4 py-3 bg-[#14233A]/[0.03] dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                          Client
                        </th>
                        <th class="text-right text-[10.5px] font-bold tracking-[0.12em] uppercase text-gray-400 px-4 py-3 pr-[22px] bg-[#14233A]/[0.03] dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                          Type
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* All-clients mode: grouped by manager */}
                      <Show when={mode() === "all"}>
                        <For each={groups()}>
                          {(g) => (
                            <>
                              <tr>
                                <td
                                  colspan="3"
                                  class="px-[22px] py-2.5 bg-gray-50 dark:bg-gray-800/50 border-y border-gray-200 dark:border-gray-700"
                                >
                                  <span class="inline-flex items-center gap-2.5 text-[12px] font-bold uppercase tracking-[0.04em] text-[#14233A] dark:text-gray-200">
                                    <Avatar
                                      name={labelFromEmail(
                                        g.manager.manager_email,
                                      )}
                                      size="w-5 h-5"
                                      textSize="text-[10px]"
                                    />
                                    {labelFromEmail(g.manager.manager_email)}
                                    <span class="text-[11.5px] font-medium text-gray-400 normal-case tracking-normal tabular-nums">
                                      {g.clients.length} of {g.counts.total}{" "}
                                      clients
                                    </span>
                                  </span>
                                </td>
                              </tr>
                              <For each={g.clients}>
                                {(c, i) => (
                                  <ClientRow index={i() + 1} client={c} />
                                )}
                              </For>
                            </>
                          )}
                        </For>
                      </Show>

                      {/* Single-manager mode: flat list */}
                      <Show when={mode() === "single"}>
                        <For each={singleRows()}>
                          {(c, i) => (
                            <ClientRow index={i() + 1} client={c} />
                          )}
                        </For>
                      </Show>
                    </tbody>
                  </table>
                </div>

                {/* Empty / footer */}
                <Show
                  when={shownCount() > 0}
                  fallback={
                    <div class="py-16 px-5 text-center">
                      <div class="font-sans font-semibold text-2xl text-gray-500 dark:text-gray-300 mb-1">
                        No matches found
                      </div>
                      <div class="text-sm text-gray-400 dark:text-gray-500">
                        Try a different name, or adjust the client type filter.
                      </div>
                    </div>
                  }
                >
                  <div class="flex items-center justify-between px-[22px] py-3 border-t border-gray-200 dark:border-gray-700 bg-[#14233A]/[0.03] dark:bg-gray-800 text-[12px] text-gray-400 dark:text-gray-500">
                    <span>
                      Showing{" "}
                      <b class="text-gray-600 dark:text-gray-300 tabular-nums font-semibold">
                        {shownCount()}
                      </b>{" "}
                      of{" "}
                      <b class="text-gray-600 dark:text-gray-300 tabular-nums font-semibold">
                        {totalCount()}
                      </b>{" "}
                      clients
                    </span>
                    <span>{monthLabel()} reporting period</span>
                  </div>
                </Show>
              </div>
            </section>
          </div>
        </Show>
      </div>
    </div>
  );
}

// ── Rail row (avatar + name + count) ─────────────────────────────────────────
function RailRow(props) {
  return (
    <button
      onClick={props.onClick}
      class={`w-full text-left flex items-center gap-3 p-2.5 rounded-[10px] relative transition-colors ${
        props.active
          ? "bg-[#14233A]"
          : "hover:bg-gray-50 dark:hover:bg-gray-800"
      }`}
    >
      <Show when={props.active}>
        <span class="absolute left-0 top-2.5 bottom-2.5 w-[3px] rounded bg-[#AC2334]" />
      </Show>
      {props.marker}
      <div class="min-w-0 flex-1 flex items-center justify-between gap-2">
        <span
          class={`text-[13.5px] font-semibold truncate ${
            props.active ? "text-white" : "text-gray-800 dark:text-gray-100"
          }`}
        >
          {props.name}
        </span>
        <span
          class={`text-[12.5px] font-semibold tabular-nums ${
            props.active ? "text-white/75" : "text-gray-400"
          }`}
        >
          {props.count}
        </span>
      </div>
    </button>
  );
}

// ── Masthead stat card (minimal blue + white) ───────────────────────────────
function StatCard(props) {
  return (
    <div class="flex items-center gap-3 bg-white dark:bg-gray-900 border border-[#14233A]/10 dark:border-gray-700 rounded-xl px-4 py-3 shadow-sm min-w-[136px]">
      <div class="w-9 h-9 rounded-lg grid place-items-center bg-[#14233A]/[0.06] dark:bg-white/10 text-[#14233A] dark:text-white flex-shrink-0">
        {props.icon}
      </div>
      <div class="min-w-0">
        <div class="text-xl font-bold leading-none tabular-nums text-[#14233A] dark:text-white">
          {props.value}
          <Show when={props.suffix}>
            <span class="text-[12px] font-medium text-[#14233A]/45 dark:text-white/45 ml-0.5">
              {props.suffix}
            </span>
          </Show>
        </div>
        <div class="mt-1.5 text-[10px] font-semibold tracking-[0.1em] uppercase text-[#14233A]/50 dark:text-white/50">
          {props.label}
        </div>
      </div>
    </div>
  );
}

// ── Segment button (client-type filter) ──────────────────────────────────────
function SegButton(props) {
  return (
    <button
      onClick={props.onClick}
      aria-pressed={props.active}
      class={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[7px] text-[12.5px] font-semibold transition-colors ${
        props.active
          ? "bg-[#14233A] text-white"
          : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
      }`}
    >
      {props.label}
      <span
        class={`text-[11px] tabular-nums ${
          props.active ? "text-white/65" : "text-gray-400"
        }`}
      >
        {props.count}
      </span>
    </button>
  );
}

// ── Mix summary key (coloured dot + count + label) ───────────────────────────
function MixKey(props) {
  return (
    <span class="inline-flex items-center gap-1.5">
      <span class={`w-[7px] h-[7px] rounded-[2px] ${props.color}`} />
      <b class="text-gray-600 dark:text-gray-300 tabular-nums font-semibold">
        {props.n}
      </b>
      {props.label}
    </span>
  );
}

// ── Ledger client row ────────────────────────────────────────────────────────
function ClientRow(props) {
  return (
    <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
      <td class="pl-[22px] pr-4 py-2.5 text-[11.5px] tabular-nums text-gray-400 border-b border-gray-100 dark:border-gray-800">
        {String(props.index).padStart(2, "0")}
      </td>
      <td class="px-4 py-2.5 text-[13.5px] font-semibold text-gray-900 dark:text-gray-100 border-b border-gray-100 dark:border-gray-800">
        {props.client.name}
      </td>
      <td class="px-4 py-2.5 pr-[22px] text-right border-b border-gray-100 dark:border-gray-800">
        <Show when={props.client.type}>
          <TypeTag type={props.client.type} />
        </Show>
      </td>
    </tr>
  );
}
