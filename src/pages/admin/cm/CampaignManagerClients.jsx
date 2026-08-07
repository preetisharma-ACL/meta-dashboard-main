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
import ClientStatusControl from "../../../components/clientStatus/ClientStatusControl";
import {
  fetchStatusBoard,
  STATUS_FILTERS,
  STATUS_DOT,
  STATUS_UNSET,
  normaliseStatus,
} from "../../../services/clientStatus";

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN · Campaign Manager's Clients  (route: /campaign-manager-clients)
// A card grid: one card per campaign manager showing their active-client count,
// a CPL/Hybrid/Retainer mix bar and the client roster (each tagged with its
// type). A global search + client-type filter + month picker sit above the grid.
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

// Type visuals — shared across the app (CMHierarchy / Clients use the same keys).
const TYPE_CHIP = {
  hybrid: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  cpl: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  retainer: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};
const TYPE_DOT = {
  cpl: "bg-teal-500",
  hybrid: "bg-indigo-500",
  retainer: "bg-amber-400",
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

// How many clients to show before the per-card "Show all" expander.
const PREVIEW_COUNT = 8;

// CPL stays upper-case; the rest are Title-cased by an uppercase utility class.
const tagLabel = (t) => (t === "cpl" ? "CPL" : t);

// Tally a client list into per-type counts (+ total). Unknown types → retainer.
const tallyTypes = (clients) => {
  const c = { cpl: 0, hybrid: 0, retainer: 0, total: 0 };
  for (const cl of clients) {
    const t = c[cl.type] != null ? cl.type : "retainer";
    c[t] += 1;
    c.total += 1;
  }
  return c;
};

// ── Small presentational helpers ────────────────────────────────────────────
// A three-segment proportional bar (CPL · Hybrid · Retainer).
function MixBar(props) {
  const c = () => props.counts || { cpl: 0, hybrid: 0, retainer: 0 };
  return (
    <div
      class={`flex rounded-full overflow-hidden bg-gray-100 dark:bg-gray-800 ${
        props.class || "h-1"
      }`}
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
  const [query, setQuery] = createSignal("");
  // Engagement status (manual active/hold/completed label) — NOT is_active,
  // which this page already uses to decide which clients appear at all.
  const [statusFilter, setStatusFilter] = createSignal("all");

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

  // ── Engagement status ─────────────────────────────────────────────────────
  // The admin client rows carry `engagement_status`, but not the latest change
  // (reason / who / when) and not in a shape keyed for these cards. The status
  // board serves both, keyed by client_nomen — the same key this page already
  // joins its own three sources on — and carries the Client PK the status PATCH
  // needs. One call, loaded alongside the roster.
  const [statusBoard, { mutate: mutateBoard }] = createResource(
    () => (allowed() ? "load" : null),
    async () => {
      try {
        return await fetchStatusBoard();
      } catch (err) {
        console.error("[CMClients] status board failed:", err);
        return { counts: {}, clients: [] };
      }
    },
  );

  // nomen (as string) → { pk, status, change }
  const statusByNomen = createMemo(() => {
    const map = {};
    for (const c of statusBoard()?.clients ?? []) {
      map[String(c.client_nomen)] = {
        pk: c.id,
        status: c.engagement_status ?? null,
        change: c.latest_change ?? null,
      };
    }
    return map;
  });

  // Falls back to the admin roster's own engagement_status when the board has
  // no row for that nomen, so the badge still reads correctly even if the two
  // lists disagree on membership.
  const adminStatusByNomen = createMemo(() => {
    const map = {};
    for (const c of adminClients() ?? []) {
      map[String(c.client_nomen)] = { pk: c.id, status: c.engagement_status ?? null };
    }
    return map;
  });

  const statusEntry = (nomenId) => {
    const key = String(nomenId);
    const board = statusByNomen()[key];
    const admin = adminStatusByNomen()[key];
    return {
      pk: board?.pk ?? admin?.pk ?? null,
      status: board?.status ?? admin?.status ?? null,
      change: board?.change ?? null,
    };
  };

  // Patch the board in place after an inline change, so the badge, the caption
  // and the status filter agree without a refetch.
  const applyStatusChange = (nomenId, pk, { status, change }) => {
    mutateBoard((prev) => {
      const clients = prev?.clients ?? [];
      const hit = clients.some((c) => String(c.client_nomen) === String(nomenId));
      const next = hit
        ? clients.map((c) =>
            String(c.client_nomen) === String(nomenId)
              ? { ...c, engagement_status: status, latest_change: change }
              : c,
          )
        : [
            ...clients,
            {
              id: pk,
              client_nomen: nomenId,
              engagement_status: status,
              latest_change: change,
            },
          ];
      return { counts: prev?.counts ?? {}, clients: next };
    });
  };

  // One card model per manager: their active clients (name + type), de-duped by
  // nomen, sorted A→Z, filtered to the selected client types.
  const cards = createMemo(() => {
    const own = ownLists() ?? {};
    const active = activeNomen();
    const types = clientTypes();
    const filterAll = allTypesSelected();
    const wantStatus = statusFilter();
    return managers().map((m) => {
      const seen = new Set();
      const clients = (own[m.manager_id] ?? [])
        .filter((c) => {
          const key = String(c.client_nomen_id);
          if (!active.has(key) || seen.has(key)) return false;
          if (!filterAll && !types.includes(c.client_type)) return false;
          if (
            wantStatus !== "all" &&
            normaliseStatus(statusEntry(key).status) !== wantStatus
          )
            return false;
          seen.add(key);
          return true;
        })
        .map((c) => {
          const s = statusEntry(c.client_nomen_id);
          return {
            id: c.client_nomen_id,
            name: c.client_name,
            type: c.client_type,
            // Client PK — what the status PATCH is keyed by. Null when the
            // client isn't on either roster; the control disables itself.
            pk: s.pk,
            status: s.status,
            statusChange: s.change,
          };
        })
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      return { manager: m, clients };
    });
  });

  // Full (type-unfiltered) active-client counts per manager — powers the
  // top-bar client-type filter tallies so those read as "everything available".
  const fullByMgr = createMemo(() => {
    const own = ownLists() ?? {};
    const active = activeNomen();
    const map = {};
    for (const m of managers()) {
      const seen = new Set();
      const list = [];
      for (const c of own[m.manager_id] ?? []) {
        const key = String(c.client_nomen_id);
        if (!active.has(key) || seen.has(key)) continue;
        seen.add(key);
        list.push({ type: c.client_type });
      }
      map[m.manager_id] = tallyTypes(list);
    }
    return map;
  });

  // Aggregate counts across every manager (drives the filter-pill tallies).
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

  const grandTotalFull = () => aggCounts().total;

  // Engagement tallies across every manager's active clients, de-duped by nomen
  // (a client can appear under more than one manager) and NOT narrowed by the
  // status filter itself — the pills must read "everything available", the same
  // rule the client-type pills follow.
  const statusCounts = createMemo(() => {
    const own = ownLists() ?? {};
    const active = activeNomen();
    const acc = { active: 0, hold: 0, completed: 0, [STATUS_UNSET]: 0, total: 0 };
    const seen = new Set();
    for (const m of managers()) {
      for (const c of own[m.manager_id] ?? []) {
        const key = String(c.client_nomen_id);
        if (!active.has(key) || seen.has(key)) continue;
        seen.add(key);
        acc[normaliseStatus(statusEntry(key).status)] += 1;
        acc.total += 1;
      }
    }
    return acc;
  });

  // ── Visible cards — apply the search, drop empties, order by client count ──
  // Search matches a client name OR the manager's name; a manager-name match
  // keeps that manager's whole (type-filtered) roster.
  const visibleCards = createMemo(() => {
    const q = query().trim().toLowerCase();
    return cards()
      .map(({ manager, clients }) => {
        const mgrLabel = labelFromEmail(manager.manager_email);
        const shown = q
          ? clients.filter((c) =>
              `${c.name} ${mgrLabel}`.toLowerCase().includes(q),
            )
          : clients;
        return { manager, clients: shown, counts: tallyTypes(shown) };
      })
      .filter((c) => c.clients.length > 0)
      .sort((a, b) => b.counts.total - a.counts.total);
  });

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

  return (
    <div class="min-h-screen bg-[#F6F7FA] dark:bg-gray-900">
      {/* ─────────────── Masthead ─────────────── */}
      <div class="max-w-[1480px] mx-auto px-4 md:px-9 pt-6">
        <header class="relative bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden px-6 md:px-8 py-6">
          <span class="absolute inset-x-0 top-0 h-1 bg-[#AC2334]" />
          <nav
            class="flex items-center gap-2 text-[11px] font-semibold tracking-[0.14em] uppercase text-gray-400 mb-3"
            aria-label="Breadcrumb"
          >
            <span class="text-[#AC2334]">Campaign Managers</span>
          </nav>
          <div class="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <h1 class="font-sans font-bold text-xl text-gray-700 dark:text-white">
                Campaign Manager's Clients
              </h1>
              <p class="mt-2 text-[13.5px] text-gray-500 dark:text-gray-400 max-w-[560px]">
                Active clients grouped by campaign manager — one card per manager,
                each tagged CPL, Hybrid or Retainer.
              </p>
            </div>
            <div class="flex flex-wrap gap-3">
              <StatCard
                value={ready() ? managers().length : "—"}
                label="Managers"
                icon={
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-[18px] h-[18px]">
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-[18px] h-[18px]">
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
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="w-[18px] h-[18px]">
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
        {/* ─────────────── Control bar (search · type filter · month) ─────────────── */}
        <Show when={ready()}>
          <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm px-4 py-3 mb-6 flex items-center gap-4 flex-wrap">
            {/* Search */}
            <div class="relative w-full sm:flex-1 sm:min-w-[220px] sm:max-w-[380px]">
              <svg
                class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
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
                onInput={(e) => setQuery(e.target.value)}
                placeholder="Search clients or managers…"
                aria-label="Search clients or managers"
                class="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 pl-10 pr-3 text-[13.5px] text-gray-800 dark:text-gray-100 placeholder:text-gray-400 focus:outline-none focus:border-[#14233A] focus:bg-white dark:focus:bg-gray-900 focus:ring-2 focus:ring-[#14233A]/10 transition-colors"
              />
            </div>

            {/* Client-type filter */}
            <div class="flex items-center gap-2.5 w-full sm:w-auto min-w-0">
              <span class="hidden sm:inline text-[10.5px] font-bold uppercase tracking-[0.12em] text-gray-400">
                Client type
              </span>
              <div class="flex flex-wrap bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[11px] p-[3px] gap-0.5">
                <FilterPill
                  active={allTypesSelected()}
                  onClick={() => setClientTypes(DEFAULT_CLIENT_TYPES)}
                  label="All"
                  count={aggCounts().total}
                />
                <For each={CLIENT_TYPES}>
                  {(t) => (
                    <FilterPill
                      active={clientTypes().includes(t.key) && !allTypesSelected()}
                      onClick={() => toggleClientType(t.key)}
                      label={t.label}
                      count={aggCounts()[t.key]}
                      dot={TYPE_DOT[t.key]}
                    />
                  )}
                </For>
              </div>
            </div>

            {/* Engagement-status filter */}
            <div class="flex items-center gap-2.5 w-full sm:w-auto min-w-0">
              <span class="hidden sm:inline text-[10.5px] font-bold uppercase tracking-[0.12em] text-gray-400">
                Engagement
              </span>
              <div class="flex flex-wrap bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-[11px] p-[3px] gap-0.5">
                <For each={STATUS_FILTERS}>
                  {(f) => (
                    <FilterPill
                      active={statusFilter() === f.key}
                      onClick={() => setStatusFilter(f.key)}
                      label={f.label}
                      count={
                        f.key === "all"
                          ? statusCounts().total
                          : statusCounts()[f.key]
                      }
                      dot={f.key === "all" ? null : STATUS_DOT[f.key]}
                    />
                  )}
                </For>
              </div>
            </div>

            {/* Month */}
            <div class="relative w-full sm:w-auto sm:ml-auto">
              <svg
                class="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 dark:text-gray-400 pointer-events-none"
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
              <select
                value={month()}
                onChange={(e) => setMonth(e.target.value)}
                aria-label="Reporting month"
                class="appearance-none w-full sm:w-auto h-10 pl-9 pr-9 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-[13px] font-semibold text-gray-800 dark:text-gray-100 cursor-pointer focus:outline-none focus:border-[#14233A] focus:ring-2 focus:ring-[#14233A]/10"
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
        </Show>

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

        {/* Loading skeleton (card-grid shaped) */}
        <Show when={dataLoading() && switchMode() !== "denied"}>
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <For each={Array(4).fill(0)}>
              {() => (
                <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 animate-pulse">
                  <div class="flex items-center gap-3.5 mb-4">
                    <div class="w-11 h-11 rounded-xl bg-gray-200 dark:bg-gray-700" />
                    <div class="flex-1 space-y-2">
                      <div class="h-3.5 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                      <div class="h-2.5 w-44 bg-gray-100 dark:bg-gray-800 rounded" />
                    </div>
                    <div class="h-7 w-8 bg-gray-200 dark:bg-gray-700 rounded" />
                  </div>
                  <div class="h-1.5 w-full bg-gray-100 dark:bg-gray-800 rounded-full mb-4" />
                  <div class="space-y-3">
                    <For each={Array(5).fill(0)}>
                      {() => <div class="h-4 w-full bg-gray-100 dark:bg-gray-800 rounded" />}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* ─────────────── Card grid ─────────────── */}
        <Show when={ready()}>
          <Show
            when={visibleCards().length > 0}
            fallback={
              <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl py-16 px-5 text-center">
                <div class="font-sans font-semibold text-2xl text-gray-500 dark:text-gray-300 mb-1">
                  No matches found
                </div>
                <div class="text-sm text-gray-400 dark:text-gray-500">
                  Try a different name, or adjust the client type filter.
                </div>
              </div>
            }
          >
            <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
              <For each={visibleCards()}>
                {(card) => (
                  <ManagerCard
                    card={card}
                    searching={!!query().trim()}
                    onStatusChanged={applyStatusChange}
                  />
                )}
              </For>
            </div>
            <p class="text-[12px] text-gray-400 dark:text-gray-500 mt-6 text-center">
              {visibleCards().length} manager
              {visibleCards().length !== 1 ? "s" : ""} · {monthLabel()} reporting
              period
            </p>
          </Show>
        </Show>
      </div>
    </div>
  );
}

// ── Manager card ─────────────────────────────────────────────────────────────
function ManagerCard(props) {
  const [expanded, setExpanded] = createSignal(false);
  // While searching, show every match; otherwise cap to the preview window.
  const capped = () => !props.searching && !expanded();
  const shown = () =>
    capped() ? props.card.clients.slice(0, PREVIEW_COUNT) : props.card.clients;
  const hidden = () => props.card.clients.length - PREVIEW_COUNT;
  const mgr = () => props.card.manager;
  const label = () => labelFromEmail(mgr().manager_email);

  return (
    <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden flex flex-col transition-shadow hover:shadow-md">
      {/* Header */}
      <div class="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div class="flex items-center gap-3.5 min-w-0">
          <Avatar
            name={label()}
            size="w-11 h-11"
            textSize="text-base"
            class="rounded-xl"
          />
          <div class="min-w-0">
            <div class="font-sans font-bold text-[15px] text-gray-900 dark:text-white truncate">
              {label()}
            </div>
            <div
              class="text-[13px] text-gray-500 dark:text-gray-400 truncate"
              title={mgr().manager_email}
            >
              {mgr().manager_email}
            </div>
          </div>
        </div>
        <div class="text-right flex-shrink-0">
          <div class="text-[26px] font-bold text-gray-900 dark:text-white leading-none tabular-nums">
            {props.card.counts.total}
          </div>
          <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500 mt-1">
            Clients
          </div>
        </div>
      </div>

      {/* Mix bar + legend */}
      <div class="px-5 pb-3.5">
        <MixBar counts={props.card.counts} class="h-1.5" />
        <div class="flex items-center gap-4 mt-2.5 text-[12px] text-gray-500 dark:text-gray-400 flex-wrap">
          <For each={CLIENT_TYPES}>
            {(t) => (
              <Show when={props.card.counts[t.key] > 0}>
                <span class="inline-flex items-center gap-1.5">
                  <span class={`w-[7px] h-[7px] rounded-[2px] ${TYPE_DOT[t.key]}`} />
                  <b class="text-gray-700 dark:text-gray-300 tabular-nums font-semibold">
                    {props.card.counts[t.key]}
                  </b>
                  {t.label}
                </span>
              </Show>
            )}
          </For>
        </div>
      </div>

      {/* Client roster */}
      <div class="border-t border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        <For each={shown()}>
          {(c) => (
            <div class="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
              <span class="text-[13.5px] font-medium text-gray-800 dark:text-gray-100 truncate">
                {c.name}
              </span>
              <div class="flex items-center gap-2 flex-shrink-0">
                {/* Engagement status — click to change, reason required */}
                <ClientStatusControl
                  compact
                  clientId={c.pk}
                  status={c.status}
                  latestChange={c.statusChange}
                  onChanged={(payload) =>
                    props.onStatusChanged?.(c.id, c.pk, payload)
                  }
                />
                <Show when={c.type}>
                  <TypeTag type={c.type} />
                </Show>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* Expander */}
      <Show when={!props.searching && props.card.clients.length > PREVIEW_COUNT}>
        <button
          onClick={() => setExpanded((v) => !v)}
          class="mt-auto w-full flex items-center gap-1.5 px-5 py-3 border-t border-gray-100 dark:border-gray-800 text-left text-[13px] font-semibold text-[#AC2334] hover:bg-[#AC2334]/[0.04] transition-colors"
        >
          {expanded() ? "Show less" : `Show all ${props.card.clients.length} clients`}
          <svg
            class={`w-3.5 h-3.5 transition-transform ${expanded() ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </Show>
    </div>
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

// ── Client-type filter pill (coloured dot + label + count) ───────────────────
function FilterPill(props) {
  return (
    <button
      onClick={props.onClick}
      aria-pressed={props.active}
      class={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12.5px] font-semibold transition-colors ${
        props.active
          ? "bg-[#14233A] text-white"
          : "text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700"
      }`}
    >
      <Show when={props.dot}>
        <span class={`w-[7px] h-[7px] rounded-full ${props.dot}`} />
      </Show>
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
