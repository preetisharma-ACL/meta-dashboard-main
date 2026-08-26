import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import Avatar from "../../../components/common/Avatar";
import { fetchSalesManagers, fetchSalesPayments } from "../../../services/sales";
import {
  fmtMoney,
  fmtNum,
  isMissing,
  TONE_GREEN,
  TONE_NAVY,
  TONE_RED,
  TONE_MUTED,
} from "../../../components/sales/salesFormat";

const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const labelFor = (m) =>
  m?.name?.trim() || (m?.email ? m.email.split("@")[0] : "") || "—";

// Add a money value into a running sum; a missing/non-numeric field contributes
// nothing (never coerced to 0 as a "read"). Same discipline as sumMoney.
const addMoney = (acc, v) => {
  if (isMissing(v)) return acc;
  const n = Number(v);
  return Number.isFinite(n) ? acc + n : acc;
};

// Column definitions — same contract as the payments table: `num` columns sort
// largest-first on the first click, `str` (and Rank, which is already an
// ordering) smallest-first. Missing values always sink to the bottom.
const LB_COLUMNS = [
  { key: "rank", label: "Rank", align: "center", type: "num", primary: "asc", get: (s) => s.rank },
  { key: "manager", label: "Manager", align: "left", type: "str", get: (s) => labelFor(s.manager) },
  { key: "clients", label: "Clients", align: "right", type: "num", get: (s) => s.count },
  { key: "billed", label: "Billed", align: "right", type: "num", get: (s) => s.billed },
  { key: "received", label: "Received", align: "right", type: "num", get: (s) => s.received },
  { key: "rate", label: "Collected %", align: "right", type: "num", get: (s) => s.rate },
];
const LB_COL = Object.fromEntries(LB_COLUMNS.map((c) => [c.key, c]));

export default function SalesLeaderboard() {
  const [month, setMonth] = createSignal(currentMonthStr());
  // Ranking metric — mirrors the CM Manager Performance sort toggle.
  const [sortMode, setSortMode] = createSignal("billed"); // "billed" | "received"
  const [query, setQuery] = createSignal("");
  // Column sort is opt-in and PURELY a view order: null → rows stay in
  // leaderboard order. The medal number on each row comes from the ranking
  // metric above, not the row position, so re-sorting the view never invents a
  // new #1.
  const [sortKey, setSortKey] = createSignal(null);
  const [sortDir, setSortDir] = createSignal("asc");

  // One resource keyed on month composes BOTH endpoints. No new backend.
  const [data] = createResource(month, async (m) => {
    const [managers, paymentsRes] = await Promise.all([
      fetchSalesManagers(),
      fetchSalesPayments(m),
    ]);
    const clients = paymentsRes?.data?.clients ?? [];
    return { managers: managers ?? [], clients };
  });

  const loading = () => data.loading;

  // client_id -> { billed, received } from the payments rows.
  const paymentsMap = createMemo(() => {
    const map = new Map();
    for (const c of data()?.clients ?? []) {
      map.set(String(c.client_id), {
        billed: c.utilized_inc_gst, // spend + service charge + GST
        received: c.received_inc_gst, // payments collected this month
      });
    }
    return map;
  });

  // Per manager: sum billed/received over their client_ids that appear in the
  // payments map (skip unowned/inactive ids). collection_rate = received/billed.
  const managerStats = createMemo(() => {
    const map = paymentsMap();
    return (data()?.managers ?? []).map((m) => {
      let billed = 0;
      let received = 0;
      let count = 0;
      for (const id of m.client_ids ?? []) {
        const row = map.get(String(id));
        if (!row) continue; // not in this month's payments → skip
        count += 1;
        billed = addMoney(billed, row.billed);
        received = addMoney(received, row.received);
      }
      const rate = billed > 0 ? received / billed : null; // guard ÷0 → "—"
      return { manager: m, billed, received, count, rate };
    });
  });

  // Ranking recomputes on toggle. Default: Billed desc. The rank is stamped onto
  // the row here so it survives searching and column sorting.
  const ranked = createMemo(() => {
    const key = sortMode();
    return [...managerStats()]
      .sort((a, b) => b[key] - a[key])
      .map((s, i) => ({ ...s, rank: i + 1 }));
  });

  // Search over the manager identity only (name · email · role) — matching a
  // money column against typed digits would be more noise than help.
  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return ranked();
    return ranked().filter((s) =>
      [s.manager?.name, s.manager?.email, s.manager?.role].some((v) =>
        String(v ?? "").toLowerCase().includes(q),
      ),
    );
  });

  const toggleSort = (key) => {
    const primary = LB_COL[key].primary ?? (LB_COL[key].type === "num" ? "desc" : "asc");
    const secondary = primary === "asc" ? "desc" : "asc";
    if (sortKey() !== key) {
      setSortKey(key);
      setSortDir(primary);
    } else if (sortDir() === primary) {
      setSortDir(secondary);
    } else {
      setSortKey(null); // third click → back to leaderboard order
      setSortDir("asc");
    }
  };

  const sortIcon = (key) => {
    if (sortKey() !== key)
      return <span class="ml-1 text-[#C3CDDB] dark:text-gray-600">⇅</span>;
    return (
      <span class="ml-1 text-[#AC2334] dark:text-red-300">
        {sortDir() === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  const compare = (a, b, col) => {
    if (col.type === "num") {
      const na = isMissing(col.get(a)) ? null : Number(col.get(a));
      const nb = isMissing(col.get(b)) ? null : Number(col.get(b));
      if (na === null && nb === null) return 0;
      if (na === null) return 1;
      if (nb === null) return -1;
      return na - nb;
    }
    const sa = String(col.get(a) ?? "").toLowerCase();
    const sb = String(col.get(b) ?? "").toLowerCase();
    return sa < sb ? -1 : sa > sb ? 1 : 0;
  };

  // What the table actually renders: leaderboard order, searched, then sorted.
  const displayed = createMemo(() => {
    const rows = filtered();
    const key = sortKey();
    if (!key) return rows;
    const col = LB_COL[key];
    const dir = sortDir() === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      // "missing last" stays stable when the direction flips
      if (col.type === "num") {
        const ma = isMissing(col.get(a));
        const mb = isMissing(col.get(b));
        if (ma && !mb) return 1;
        if (!ma && mb) return -1;
      }
      return compare(a, b, col) * dir;
    });
  });

  const rateTone = (rate) =>
    rate == null
      ? TONE_MUTED
      : rate >= 1
        ? TONE_GREEN
        : rate >= 0.5
          ? TONE_NAVY
          : TONE_RED;
  const ratePct = (rate) => (rate == null ? "—" : `${(rate * 100).toFixed(1)}%`);

  const monthLabel = createMemo(() => {
    const [y, mo] = String(month()).split("-");
    if (!y || !mo) return month();
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
  });

  const handleMonthChange = (value) => {
    if (!value) return;
    if (value > currentMonthStr()) value = currentMonthStr();
    setMonth(value);
  };

  const RoleBadge = (props) =>
    props.role === "admin" ? (
      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300">
        Admin
      </span>
    ) : (
      <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-[#ECF2FA] text-[#3E6FB0] dark:bg-blue-900/40 dark:text-blue-300">
        Sales
      </span>
    );

  // Rank medal tint for the top three.
  const rankTone = (i) =>
    i === 0
      ? "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300"
      : i === 1
        ? "bg-[#EEF2F7] text-[#54657E] dark:bg-gray-700 dark:text-gray-200"
        : i === 2
          ? "bg-[#F5EEE7] text-[#9A6A3A] dark:bg-orange-900/30 dark:text-orange-300"
          : "bg-[#F1F4F9] text-[#8593A8] dark:bg-gray-700 dark:text-gray-300";

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-4">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Sales Leaderboard
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Sales Manager Leaderboard
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400">
            Billed vs collected by manager for{" "}
            <span class="font-semibold text-[#14233A] dark:text-gray-200">
              {monthLabel()}
            </span>
            .
          </p>
        </div>
        <input
          type="month"
          value={month()}
          max={currentMonthStr()}
          onInput={(e) => handleMonthChange(e.currentTarget.value)}
          class="self-start border border-[#E2E8F1] dark:border-gray-600 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
        />
      </div>

      {/* Caption */}
      <p class="text-xs text-[#8593A8] dark:text-gray-400 mb-5">
        Billed = spend + service charge + GST; Received = payments collected this
        month.
      </p>

      <Show when={data.error}>
        <div class="mb-6 rounded-xl border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300">
          Could not load the leaderboard. Please try again.
        </div>
      </Show>

      {/* ════════ SEARCH ════════ */}
      <div class="mb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div class="relative w-full sm:max-w-sm">
          <svg
            class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8593A8] dark:text-gray-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          {/* type="text", not "search": the native search input paints its own
              clear button next to ours, so the field showed two crosses. */}
          <input
            type="text"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search manager, email or role…"
            aria-label="Search sales managers"
            class="w-full pl-9 pr-9 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-[#14233A] dark:text-gray-100 placeholder:text-[#8593A8] dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#14233A]/20 focus:border-[#14233A]/40 transition"
          />
          <Show when={query()}>
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 w-5 h-5 inline-flex items-center justify-center rounded-full text-[#8593A8] hover:text-[#AC2334] hover:bg-[#FBEEF0] dark:hover:bg-red-900/30 transition"
            >
              <svg
                class="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </Show>
        </div>

        <Show when={!loading() && query().trim() !== ""}>
          <p class="text-xs text-[#8593A8] dark:text-gray-400">
            Showing{" "}
            <b class="text-[#14233A] dark:text-gray-200">{displayed().length}</b>{" "}
            of {ranked().length} managers · ranks stay leaderboard-wide
          </p>
        </Show>
      </div>

      {/* Sort toggle — mirrors the CM Manager Performance "Rank by" control. */}
      <Show when={!loading() && ranked().length > 0}>
        <div class="flex items-center justify-end gap-2 mb-3">
          <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            Rank by
          </span>
          <div class="inline-flex items-center bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-[10px] p-[3px] gap-0.5">
            <For each={[["billed", "Billed"], ["received", "Received"]]}>
              {([val, label]) => (
                <button
                  onClick={() => setSortMode(val)}
                  aria-pressed={sortMode() === val}
                  class={`px-3.5 py-1.5 rounded-[7px] text-[12.5px] font-semibold transition-colors ${
                    sortMode() === val
                      ? "bg-[#14233A] text-white"
                      : "text-[#54657E] dark:text-gray-300 hover:bg-[#F2F5FA] dark:hover:bg-gray-700"
                  }`}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* ════════ TABLE ════════ */}
      <div class="overflow-x-auto bg-gray-50 dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
        <table class="w-full text-sm table-auto">
          <thead class="bg-[#F8FAFC] dark:bg-gray-800">
            <tr class="[&_th]:whitespace-nowrap [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:font-bold [&_th]:px-4 [&_th]:py-3.5 text-[#54657E] dark:text-gray-300 border-b border-[#D4DDE9] dark:border-gray-700">
              <For each={LB_COLUMNS}>
                {(col) => (
                  <th
                    class={
                      col.align === "right"
                        ? "text-right"
                        : col.align === "center"
                          ? "text-center w-12"
                          : "text-left min-w-[200px]"
                    }
                    aria-sort={
                      sortKey() !== col.key
                        ? "none"
                        : sortDir() === "asc"
                          ? "ascending"
                          : "descending"
                    }
                  >
                    <button
                      onClick={() => toggleSort(col.key)}
                      class="inline-flex items-center uppercase tracking-wider font-bold hover:text-[#AC2334] dark:hover:text-red-300 transition"
                    >
                      {col.label}
                      {sortIcon(col.key)}
                    </button>
                  </th>
                )}
              </For>
            </tr>
          </thead>

          <Show
            when={!loading()}
            fallback={
              <tbody>
                <For each={Array(6).fill(0)}>
                  {() => (
                    <tr class="border-t border-[#E2E8F1] dark:border-gray-700 animate-pulse">
                      <td class="p-3">
                        <div class="h-7 w-7 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto"></div>
                      </td>
                      <td class="p-3">
                        <div class="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded"></div>
                      </td>
                      <For each={Array(4).fill(0)}>
                        {() => (
                          <td class="p-3">
                            <div class="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded ml-auto"></div>
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
              <For each={displayed()}>
                {(s, i) => (
                  <tr
                    class={
                      "border-t border-[#E2E8F1] dark:border-gray-700 " +
                      (i() % 2 === 0
                        ? "bg-gray-50 dark:bg-gray-800"
                        : "bg-[#FAFBFD] dark:bg-gray-800")
                    }
                  >
                    {/* Rank */}
                    <td class="px-4 py-3 text-center">
                      <span class={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${rankTone(s.rank - 1)}`}>
                        {s.rank}
                      </span>
                    </td>
                    {/* Manager */}
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-3 min-w-0">
                        <Avatar name={s.manager.email || s.manager.name} size="w-9 h-9" />
                        <div class="min-w-0">
                          <div class="flex items-center gap-2 flex-wrap">
                            <span class="font-semibold text-blue-900 dark:text-gray-100 truncate">
                              {labelFor(s.manager)}
                            </span>
                            <RoleBadge role={s.manager.role} />
                          </div>
                          <div class="text-xs text-[#8593A8] dark:text-gray-400 truncate" title={s.manager.email}>
                            {s.manager.email}
                          </div>
                        </div>
                      </div>
                    </td>
                    {/* Clients */}
                    <td class="px-4 py-3 text-right tabular-nums text-[#14233A] dark:text-gray-300">
                      {fmtNum(s.count)}
                    </td>
                    {/* Billed */}
                    <td class="px-4 py-3 text-right tabular-nums font-medium text-[#14233A] dark:text-white">
                      {fmtMoney(s.billed, 0)}
                    </td>
                    {/* Received */}
                    <td class="px-4 py-3 text-right tabular-nums font-medium text-[#15966A] dark:text-green-300">
                      {fmtMoney(s.received, 0)}
                    </td>
                    {/* Collected % */}
                    <td class={`px-4 py-3 text-right tabular-nums font-bold ${rateTone(s.rate)}`}>
                      {ratePct(s.rate)}
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </Show>
        </table>

        <Show when={!loading() && displayed().length === 0}>
          <div class="p-8 text-center">
            <p class="text-sm font-semibold text-[#14233A] dark:text-gray-300">
              No sales managers to rank
            </p>
            <p class="mt-1 text-sm text-[#8593A8] dark:text-gray-400">
              {query().trim()
                ? "No manager matches your search."
                : "There is no data for this month yet."}
            </p>
          </div>
        </Show>
      </div>
    </section>
  );
}
