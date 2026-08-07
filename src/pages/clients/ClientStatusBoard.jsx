import { createResource, createSignal, createMemo, For, Show } from "solid-js";
import {
  fetchStatusBoard,
  STATUS_FILTERS,
  STATUS_DOT,
  STATUS_UNSET,
  normaliseStatus,
  statusLabel,
  changedByLabel,
  changedAtLabel,
} from "../../services/clientStatus";
import ClientStatusControl from "../../components/clientStatus/ClientStatusControl";
import ClientStatusHistoryDrawer from "../../components/clientStatus/ClientStatusHistoryDrawer";
import Avatar from "../../components/common/Avatar";

// ─── Client Status board ──────────────────────────────────────────────────────
// GET /clients/status-board/ — every client the caller may see, bucketed by
// engagement status, with the latest change (reason, who, when) on each row.
// Scope is entirely the backend's: an admin gets all clients, a CM only their
// assigned ones. Nothing here filters by role.
//
// The tabs filter CLIENT-SIDE from the single fetched list. The endpoint also
// accepts ?status=, but one round-trip gives us the whole board plus the counts
// that label the tabs, so re-fetching per tab would re-request data we already
// hold — and would make the counts and the list momentarily disagree.

const TYPE_CHIP = {
  hybrid: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  cpl: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  retainer: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};
const typeLabel = (t) => (t === "cpl" ? "CPL" : t ? `${t[0].toUpperCase()}${t.slice(1)}` : "—");

export default function ClientStatusBoard() {
  const [tab, setTab] = createSignal("all");
  const [query, setQuery] = createSignal("");
  const [historyFor, setHistoryFor] = createSignal(null);

  const [board, { mutate, refetch }] = createResource(fetchStatusBoard);

  const clients = () => board()?.clients ?? [];

  // Counts come from the server's `counts` block. Fall back to a local tally so
  // the tabs still label correctly if that block is ever absent — a tab reading
  // "Hold" with no number is a worse failure than a locally-derived one.
  const counts = createMemo(() => {
    const served = board()?.counts ?? {};
    if (Object.keys(served).length) return served;
    const acc = { active: 0, hold: 0, completed: 0, [STATUS_UNSET]: 0, total: 0 };
    for (const c of clients()) {
      acc[normaliseStatus(c.engagement_status)] += 1;
      acc.total += 1;
    }
    return acc;
  });

  const countFor = (key) =>
    key === "all" ? (counts().total ?? clients().length) : (counts()[key] ?? 0);

  const visible = createMemo(() => {
    const t = tab();
    const q = query().trim().toLowerCase();
    return clients()
      .filter((c) => t === "all" || normaliseStatus(c.engagement_status) === t)
      .filter(
        (c) =>
          !q ||
          String(c.client_nomen ?? "").toLowerCase().includes(q) ||
          String(c.email ?? "").toLowerCase().includes(q),
      )
      .sort((a, b) =>
        String(a.client_nomen ?? a.email ?? "").localeCompare(
          String(b.client_nomen ?? b.email ?? ""),
          undefined,
          { sensitivity: "base" },
        ),
      );
  });

  // Patch the row in place after a successful change, and re-tally the counts,
  // so the tab labels and the row agree without another round-trip.
  const applyChange = (clientId, { status, change }) => {
    mutate((prev) => {
      if (!prev) return prev;
      const nextClients = prev.clients.map((c) =>
        String(c.id) === String(clientId)
          ? { ...c, engagement_status: status, latest_change: change }
          : c,
      );
      const acc = { active: 0, hold: 0, completed: 0, [STATUS_UNSET]: 0 };
      for (const c of nextClients) acc[normaliseStatus(c.engagement_status)] += 1;
      return {
        clients: nextClients,
        counts: { ...acc, total: nextClients.length },
      };
    });
  };

  const TH =
    "p-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap";

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6 lg:p-8">
      {/* ── Header ── */}
      <div class="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-[#AC2334] mb-1">
            Clients
          </p>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
            Client Status
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Where each engagement stands. Separate from a client's active /
            inactive account flag — this is the label your team sets, with a
            reason on every change.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={board.loading}
          class="px-3.5 py-2 text-sm font-semibold rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-[#AC2334]/40 disabled:opacity-50 transition"
        >
          {board.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* ── Tabs ── */}
      <div
        class="flex flex-wrap items-center gap-1.5 mb-4"
        role="tablist"
        aria-label="Filter by engagement status"
      >
        <For each={STATUS_FILTERS}>
          {(f) => {
            const on = () => tab() === f.key;
            return (
              <button
                type="button"
                role="tab"
                aria-selected={on()}
                onClick={() => setTab(f.key)}
                class={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
                  on()
                    ? "bg-[#14233A] text-white border-[#14233A]"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
                }`}
              >
                <Show when={f.key !== "all"}>
                  <span class={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[f.key]}`} />
                </Show>
                {f.label}
                <span
                  class={`text-[11px] font-bold tabular-nums ${
                    on() ? "text-white/70" : "text-gray-400 dark:text-gray-500"
                  }`}
                >
                  ({countFor(f.key)})
                </span>
              </button>
            );
          }}
        </For>
      </div>

      {/* ── Search ── */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex w-full sm:w-[360px]">
          <svg
            class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by client name or email…"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>
        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {visible().length} shown
        </span>
      </div>

      {/* ── Table ── */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <th class={TH}>Client</th>
              <th class={TH}>Type</th>
              <th class={TH}>Status</th>
              <th class={TH}>Latest change</th>
              <th class={`${TH} text-right`}>History</th>
            </tr>
          </thead>

          <Show
            when={!board.loading}
            fallback={
              <tbody>
                <For each={Array(6).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                      <For each={Array(5).fill(0)}>
                        {() => (
                          <td class="p-3">
                            <div class="h-3.5 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <Show
              when={!board.error}
              fallback={
                <tbody>
                  <tr>
                    <td colspan="5" class="p-10 text-center">
                      <p class="text-sm font-medium text-[#AC2334]">
                        {board.error?.message ||
                          "Could not load the status board."}
                      </p>
                      <button
                        onClick={() => refetch()}
                        class="mt-2 text-sm underline text-gray-500"
                      >
                        Retry
                      </button>
                    </td>
                  </tr>
                </tbody>
              }
            >
              <tbody>
                <For each={visible()}>
                  {(c, i) => (
                    <tr
                      class={`border-b border-gray-100 dark:border-gray-800 hover:bg-purple-50/60 dark:hover:bg-gray-800/40 transition-colors ${
                        i() % 2 === 0
                          ? "bg-white dark:bg-gray-900"
                          : "bg-gray-50/60 dark:bg-gray-800/30"
                      }`}
                    >
                      {/* Client */}
                      <td class="p-3">
                        <div class="flex items-center gap-2.5 min-w-0">
                          <Avatar name={c.client_nomen || c.email} />
                          <div class="min-w-0">
                            <p class="font-medium text-gray-800 dark:text-gray-100 truncate">
                              {c.client_nomen || "—"}
                            </p>
                            <p class="text-xs text-gray-500 dark:text-gray-400 truncate">
                              {c.email || "—"}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Client type */}
                      <td class="p-3">
                        <span
                          class={`inline-block text-[10px] font-bold tracking-[0.08em] uppercase px-2.5 py-[3px] rounded-full ${
                            TYPE_CHIP[c.client_type] ??
                            "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                          }`}
                        >
                          {typeLabel(c.client_type)}
                        </span>
                      </td>

                      {/* Status — clickable badge */}
                      <td class="p-3">
                        <ClientStatusControl
                          clientId={c.id}
                          status={c.engagement_status}
                          latestChange={c.latest_change}
                          onChanged={(payload) => applyChange(c.id, payload)}
                        />
                      </td>

                      {/* Latest change — reason, who, when */}
                      <td class="p-3 max-w-[320px]">
                        <Show
                          when={c.latest_change}
                          fallback={
                            <span class="text-gray-300 dark:text-gray-600">
                              —
                            </span>
                          }
                        >
                          <p
                            class="text-gray-700 dark:text-gray-200 truncate"
                            title={c.latest_change.reason || ""}
                          >
                            {c.latest_change.reason || "—"}
                          </p>
                          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                            <Show when={c.latest_change.from_status}>
                              {statusLabel(c.latest_change.from_status)} →{" "}
                            </Show>
                            {statusLabel(c.latest_change.to_status)} ·{" "}
                            {changedByLabel(c.latest_change.changed_by_email)} ·{" "}
                            {changedAtLabel(c.latest_change.changed_at)}
                          </p>
                        </Show>
                      </td>

                      {/* History */}
                      <td class="p-3 text-right whitespace-nowrap">
                        <button
                          onClick={() =>
                            setHistoryFor({
                              id: c.id,
                              label: c.client_nomen || c.email,
                            })
                          }
                          class="text-xs font-semibold text-[#3E6FB0] hover:underline"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  )}
                </For>

                <Show when={visible().length === 0}>
                  <tr>
                    <td
                      colspan="5"
                      class="p-12 text-center text-gray-500 dark:text-gray-400"
                    >
                      <Show
                        when={tab() !== "all" || query()}
                        fallback="No clients to show."
                      >
                        No clients in this bucket.
                      </Show>
                    </td>
                  </tr>
                </Show>
              </tbody>
            </Show>
          </Show>
        </table>
      </div>

      <ClientStatusHistoryDrawer
        open={!!historyFor()}
        clientId={historyFor()?.id}
        clientLabel={historyFor()?.label}
        onClose={() => setHistoryFor(null)}
      />
    </div>
  );
}
