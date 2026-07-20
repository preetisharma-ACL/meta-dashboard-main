import { createSignal, createResource, createMemo, Show } from "solid-js";

import { fetchSalesPayments } from "../../services/sales";
import {
  fmtMoney,
  remainingTile,
  TONE_GREEN,
  TONE_NAVY,
} from "../../components/sales/salesFormat";
import { MoneyTilesRow, PaymentsTable } from "../../components/sales/salesUI";

const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function SalesPayments() {
  const [month, setMonth] = createSignal(currentMonthStr());
  const [refreshing, setRefreshing] = createSignal(false);

  // Resource keyed on month → switching months refetches automatically (cached,
  // no refresh param). The Refresh button calls refetch(true); the fetcher reads
  // info.refetching to append refresh=1 (bypasses the server's 10-min cache).
  const [payload, { refetch }] = createResource(month, async (m, info) => {
    const refresh = info?.refetching === true;
    const res = await fetchSalesPayments(m, refresh);
    return res?.data ?? {};
  });

  const totals = () => payload()?.totals ?? {};
  // Keep the server's order — debtors first. No client-side sort.
  const rows = () => payload()?.clients ?? [];
  const loading = () => payload.loading;

  const monthLabel = createMemo(() => {
    const m = payload()?.month || month();
    const [y, mo] = String(m).split("-");
    if (!y || !mo) return m;
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
  });

  const handleMonthChange = (value) => {
    if (!value) return;
    if (value > currentMonthStr()) value = currentMonthStr(); // no future months
    setMonth(value);
  };

  const handleRefresh = async () => {
    if (loading() || refreshing()) return;
    setRefreshing(true);
    try {
      await refetch(true);
    } finally {
      setRefreshing(false);
    }
  };

  // Three tiles straight off the server totals.
  // NOTE the key asymmetry: rows use closing_balance_inc_gst, but TOTALS use
  // closing_inc_gst (no "balance"). Reading the row-style name here returned
  // undefined → 0 → a false "Remaining ₹0 healthy". Read the totals name.
  const tiles = createMemo(() => [
    { label: "Received", value: fmtMoney(totals().received_inc_gst, 0), tone: TONE_GREEN },
    {
      label: "Billed spend (incl. S.C + GST)",
      value: fmtMoney(totals().utilized_inc_gst, 0),
      tone: TONE_NAVY,
    },
    remainingTile("Remaining", totals().closing_inc_gst),
  ]);

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Sales manager · Payments
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Payments Overview
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400">
            Received, billed spend and remaining balances for your clients in{" "}
            <span class="font-semibold text-[#14233A] dark:text-gray-200">
              {monthLabel()}
            </span>
            .
          </p>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <input
            type="month"
            value={month()}
            max={currentMonthStr()}
            onInput={(e) => handleMonthChange(e.currentTarget.value)}
            class="border border-[#E2E8F1] dark:border-gray-600 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
          />
          <button
            onClick={handleRefresh}
            disabled={refreshing()}
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#1d3252] disabled:opacity-60 disabled:cursor-default transition-colors"
          >
            <svg
              class={"w-4 h-4 " + (refreshing() ? "animate-spin" : "")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M4 4v5h5M20 20v-5h-5M5.5 9a7 7 0 0112.9-2M18.5 15a7 7 0 01-12.9 2"
              />
            </svg>
            {refreshing() ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      <Show when={payload.error}>
        <div class="mb-6 rounded-xl border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300">
          Could not load payments overview. Please try again.
        </div>
      </Show>

      {/* ════════ HERO STRIP — three tiles from totals ════════ */}
      <div class="mb-3">
        <MoneyTilesRow tiles={tiles} loading={loading} />
      </div>

      {/* owes / low / healthy count line */}
      <p class="text-sm text-[#54657E] dark:text-gray-400 mb-8 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          <b class="text-[#AC2334]">{totals().clients_owing ?? 0}</b> owing
        </span>
        <span>
          <b class="text-[#B07A14]">{totals().clients_low ?? 0}</b> low
        </span>
        <span>
          <b class="text-[#15966A]">{totals().clients_healthy ?? 0}</b> healthy
        </span>
        <Show when={totals().client_count != null}>
          <span class="text-[#8593A8]">· {totals().client_count} clients</span>
        </Show>
      </p>

      {/* ════════ PER-CLIENT TABLE (server order — debtors first) ════════ */}
      <PaymentsTable rows={rows} loading={loading} />
    </section>
  );
}
