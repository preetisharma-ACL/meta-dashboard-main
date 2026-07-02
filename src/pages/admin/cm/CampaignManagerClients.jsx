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
// One card per campaign manager showing the COUNT and NAMES of their ACTIVE
// clients, each tagged CPL / Hybrid / Retainer.
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

export default function CampaignManagerClients() {
  const [month, setMonth] = createSignal(currentMonthKey());
  const [clientTypes, setClientTypes] = createSignal(DEFAULT_CLIENT_TYPES);

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
  const failed = () =>
    rosterRes.error || adminClients.error || ownLists.error;
  // Roster came back with zero managers (distinct from "still loading").
  const noManagers = () => rosterReady() && managers().length === 0;
  const totalActive = () => cards().reduce((s, c) => s + c.clients.length, 0);

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      {/* ── Page header ── */}
      <div class="flex items-end justify-between flex-wrap gap-2 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-blue-600 dark:text-blue-400 mb-1.5">
            Admin · Team
          </p>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
            Campaign Manager's Clients
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Active clients grouped by campaign manager, tagged CPL / Hybrid /
            Retainer.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <Show when={allowed() && !dataLoading() && !failed()}>
            <span class="text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
              {managers().length} manager{managers().length !== 1 ? "s" : ""} ·{" "}
              {totalActive()} active client{totalActive() !== 1 ? "s" : ""}
            </span>
          </Show>
          <select
            value={month()}
            onChange={(e) => setMonth(e.target.value)}
            class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-400 cursor-pointer"
          >
            <For each={monthOptions()}>
              {(o) => <option value={o.key}>{o.label}</option>}
            </For>
          </select>
        </div>
      </div>

      {/* ════ CLIENT-TYPE FILTER (multi-select pills, all on by default) ════ */}
      <div class="flex flex-wrap items-center gap-2 mb-6">
        <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mr-1">
          Client type
        </span>
        <For each={CLIENT_TYPES}>
          {(t) => {
            const on = () => clientTypes().includes(t.key);
            return (
              <button
                onClick={() => toggleClientType(t.key)}
                aria-pressed={on()}
                class={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
                  on()
                    ? "bg-[#14233A] text-white border-[#14233A]"
                    : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
                }`}
              >
                <svg
                  class="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <Show
                    when={on()}
                    fallback={<circle cx="12" cy="12" r="9" stroke-width="1.6" />}
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </Show>
                </svg>
                {t.label}
              </button>
            );
          }}
        </For>
      </div>

      {/* Needs admin view-as — show a quiet note if the probe reports denial. */}
      <Show when={switchMode() === "denied"}>
        <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 text-sm text-gray-500 dark:text-gray-400">
          Per-manager client lists appear here once admin view-as is enabled on
          the backend.
        </div>
      </Show>

      {/* Roster resolved but empty for the selected month. */}
      <Show when={noManagers() && !failed()}>
        <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-6 text-sm text-gray-500 dark:text-gray-400">
          No campaign managers with data for this month. Try an earlier month
          from the selector above.
        </div>
      </Show>

      {/* Loading skeleton */}
      <Show when={dataLoading() && switchMode() !== "denied"}>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <For each={Array(6).fill(0)}>
            {() => (
              <div class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 animate-pulse">
                <div class="flex items-center gap-3 mb-3">
                  <div class="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700" />
                  <div class="h-3 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>
                <div class="space-y-2">
                  <div class="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded" />
                  <div class="h-3 w-2/3 bg-gray-200 dark:bg-gray-700 rounded" />
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* Error */}
      <Show when={!dataLoading() && failed()}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">
          Couldn't load campaign managers' clients. Please try again.
        </div>
      </Show>

      {/* Cards */}
      <Show when={allowed() && !dataLoading() && !failed()}>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <For each={cards()}>
            {(card) => (
              <div class="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4 flex flex-col">
                {/* Manager header + active count */}
                <div class="flex items-center gap-3 pb-3 border-b border-gray-100 dark:border-gray-800">
                  <Avatar name={card.manager.manager_email} />
                  <div class="min-w-0 flex-1">
                    <p class="font-semibold text-gray-800 dark:text-gray-100 truncate">
                      {labelFromEmail(card.manager.manager_email)}
                    </p>
                    <p class="text-xs text-gray-400 dark:text-gray-500 truncate">
                      {card.manager.manager_email}
                    </p>
                  </div>
                  <span class="flex-shrink-0 inline-flex items-center justify-center min-w-[2rem] px-2 h-7 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-sm font-bold tabular-nums">
                    {card.clients.length}
                  </span>
                </div>

                {/* Active client list */}
                <Show
                  when={card.clients.length > 0}
                  fallback={
                    <p class="text-sm text-gray-400 dark:text-gray-500 py-4">
                      No active clients.
                    </p>
                  }
                >
                  <ul class="mt-3 space-y-2">
                    <For each={card.clients}>
                      {(c) => (
                        <li class="flex items-center justify-between gap-2">
                          <span class="text-sm text-gray-700 dark:text-gray-200 truncate">
                            {c.name}
                          </span>
                          <Show when={c.type}>
                            <span
                              class={`flex-shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${
                                TYPE_CHIP[c.type] ?? TYPE_CHIP.retainer
                              }`}
                            >
                              {c.type}
                            </span>
                          </Show>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
              </div>
            )}
          </For>

          <Show when={cards().length === 0}>
            <p class="col-span-full py-10 text-center text-sm text-gray-400 dark:text-gray-500">
              No campaign managers found.
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
