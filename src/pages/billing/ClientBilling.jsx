import { createSignal, createResource, createMemo, Show } from "solid-js";

import { fetchSalesPayments } from "../../services/sales";
import {
  fmtMoney as fmtMoneyPay,
  remainingTile,
  TONE_GREEN,
  TONE_NAVY,
} from "../../components/sales/salesFormat";
import { MoneyTilesRow, PaymentsTable } from "../../components/sales/salesUI";
import MonthPicker from "../../components/sales/MonthPicker";

// ─── Client Billing · Payments overview ───────────────────────────────────────
// Standalone page behind the sidebar "Client Billing → Client Payments" entry.
// Reuses the exact role-scoped endpoint + shared sales billing components (no
// fork). The backend role-scopes GET /billing/admin/payments-overview/ — a CM
// gets only their tier-aware visible clients; admins get all — so we send no
// scoping params, only month, plus refresh=1 from the explicit Refresh button.

const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function ClientBilling() {
  const [month, setMonth] = createSignal(currentMonthStr());
  const [refreshing, setRefreshing] = createSignal(false);

  // Keyed on month → switching months refetches (cached, no refresh param). The
  // Refresh button calls refetch(true); the fetcher reads info.refetching to
  // append refresh=1 (bypasses the server's 10-min cache).
  const [payload, { refetch }] = createResource(month, async (m, info) => {
    const refresh = info?.refetching === true;
    const res = await fetchSalesPayments(m, refresh);
    return res?.data ?? {};
  });

  const totals = () => payload()?.totals ?? {};
  // Server order (debtors first) preserved — the table handles opt-in sorting.
  const rows = () => payload()?.clients ?? [];
  const loading = () => payload.loading;

  // Three tiles straight off TOTALS. NOTE the key asymmetry: rows use
  // closing_BALANCE_inc_gst, but TOTALS use closing_inc_gst (no "balance").
  // Reading the row-style name here returned undefined → a false "Remaining ₹0
  // healthy". Read the totals name. No money read coerces undefined to 0 —
  // fmtMoneyPay / remainingTile render missing as "—", never ₹0.
  const tiles = createMemo(() => [
    {
      label: "Received",
      value: fmtMoneyPay(totals().received_inc_gst, 0),
      tone: TONE_GREEN,
    },
    {
      label: "Billed (incl. S.C + GST)",
      value: fmtMoneyPay(totals().utilized_inc_gst, 0),
      tone: TONE_NAVY,
    },
    remainingTile("Remaining", totals().closing_inc_gst),
  ]);

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

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Client billing · Payments
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Client Payments
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400">
            Received, billed and remaining balances for your clients in{" "}
            <span class="font-semibold text-[#14233A] dark:text-gray-200">
              {monthLabel()}
            </span>
            .
          </p>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <MonthPicker
            value={month()}
            max={currentMonthStr()}
            onChange={handleMonthChange}
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

      {/* ════════ THREE TILES FROM TOTALS ════════ */}
      <div class="mb-3">
        <MoneyTilesRow tiles={tiles} loading={loading} />
      </div>

      {/* A positive net Remaining can hide clients who owe — surface it. */}
      <Show when={(totals().clients_owing ?? 0) > 0}>
        <div class="mb-6 inline-flex items-start gap-2 rounded-lg border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-3.5 py-2 text-sm font-semibold text-[#AC2334] dark:text-red-300">
          <svg
            class="w-4 h-4 flex-none mt-0.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
          <span>
            <b>{totals().clients_owing}</b> of {totals().client_count} clients
            owe {fmtMoneyPay(totals().total_owed_inc_gst, 0)}
          </span>
        </div>
      </Show>

      {/* ════════ PER-CLIENT TABLE (server order — debtors first) ════════ */}
      <PaymentsTable rows={rows} loading={loading} />
    </section>
  );
}
