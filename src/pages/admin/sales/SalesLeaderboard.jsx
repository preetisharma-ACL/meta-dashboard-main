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

export default function SalesLeaderboard() {
  const [month, setMonth] = createSignal(currentMonthStr());
  // Ranking metric — mirrors the CM Manager Performance sort toggle.
  const [sortMode, setSortMode] = createSignal("billed"); // "billed" | "received"

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

  // Ranking recomputes on toggle. Default: Billed desc.
  const ranked = createMemo(() => {
    const key = sortMode();
    return [...managerStats()].sort((a, b) => b[key] - a[key]);
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
            Admin · Sales
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
              <th class="w-12 text-center">Rank</th>
              <th class="text-left min-w-[200px]">Manager</th>
              <th class="text-right">Clients</th>
              <th
                class="text-right cursor-pointer select-none hover:text-[#AC2334] transition-colors"
                onClick={() => setSortMode("billed")}
                aria-sort={sortMode() === "billed" ? "descending" : "none"}
              >
                <span class="inline-flex items-center gap-1 flex-row-reverse">
                  Billed
                  <span class={`text-[10px] leading-none ${sortMode() === "billed" ? "text-[#AC2334]" : "text-[#C3CDDB] dark:text-gray-600"}`}>
                    {sortMode() === "billed" ? "▼" : "⇅"}
                  </span>
                </span>
              </th>
              <th
                class="text-right cursor-pointer select-none hover:text-[#AC2334] transition-colors"
                onClick={() => setSortMode("received")}
                aria-sort={sortMode() === "received" ? "descending" : "none"}
              >
                <span class="inline-flex items-center gap-1 flex-row-reverse">
                  Received
                  <span class={`text-[10px] leading-none ${sortMode() === "received" ? "text-[#AC2334]" : "text-[#C3CDDB] dark:text-gray-600"}`}>
                    {sortMode() === "received" ? "▼" : "⇅"}
                  </span>
                </span>
              </th>
              <th class="text-right">Collected %</th>
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
              <For each={ranked()}>
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
                      <span class={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${rankTone(i())}`}>
                        {i() + 1}
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

        <Show when={!loading() && ranked().length === 0}>
          <div class="p-8 text-center">
            <p class="text-sm font-semibold text-[#14233A] dark:text-gray-300">
              No sales managers to rank
            </p>
            <p class="mt-1 text-sm text-[#8593A8] dark:text-gray-400">
              There is no data for this month yet.
            </p>
          </div>
        </Show>
      </div>
    </section>
  );
}
