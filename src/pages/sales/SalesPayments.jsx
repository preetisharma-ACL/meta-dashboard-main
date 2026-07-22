import { createSignal, createResource, createMemo, Show, For } from "solid-js";

import { fetchSalesPayments } from "../../services/sales";
import {
  fmtMoney,
  remainingTile,
  TONE_GREEN,
  TONE_NAVY,
} from "../../components/sales/salesFormat";
import { MoneyTilesRow, PaymentsTable } from "../../components/sales/salesUI";
import MonthPicker from "../../components/sales/MonthPicker";
import {
  CLIENT_TYPES,
  toggleClientTypeIn,
} from "../../components/funding/ClientTypeFilter";

const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// All type keys (cpl · hybrid · retainer). The payments overview lists every
// client by default, so the toggle starts fully selected.
const ALL_TYPE_KEYS = CLIENT_TYPES.map((t) => t.key);

export default function SalesPayments() {
  const [month, setMonth] = createSignal(currentMonthStr());
  const [refreshing, setRefreshing] = createSignal(false);
  const [search, setSearch] = createSignal("");
  const [clientTypes, setClientTypes] = createSignal(ALL_TYPE_KEYS);

  // Resource keyed on month → switching months refetches automatically (cached,
  // no refresh param). The Refresh button calls refetch(true); the fetcher reads
  // info.refetching to append refresh=1 (bypasses the server's 10-min cache).
  const [payload, { refetch }] = createResource(month, async (m, info) => {
    const refresh = info?.refetching === true;
    const res = await fetchSalesPayments(m, refresh);
    return res?.data ?? {};
  });

  const totals = () => payload()?.totals ?? {};
  // Keep the server's order — debtors first. The table's own headers handle
  // opt-in sorting; here we only narrow by the search box (name / email).
  const allRows = () => payload()?.clients ?? [];
  const rows = createMemo(() => {
    let data = allRows();

    // Type toggle (multi-select). Clients with no type always pass through.
    const types = clientTypes();
    if (types.length < ALL_TYPE_KEYS.length) {
      data = data.filter(
        (c) =>
          !c.client_type || types.includes(String(c.client_type).toLowerCase()),
      );
    }

    // Search — client name or email.
    const q = search().trim().toLowerCase();
    if (q) {
      data = data.filter(
        (c) =>
          c.client_nomen?.toLowerCase().includes(q) ||
          c.client_email?.toLowerCase().includes(q),
      );
    }

    return data;
  });
  const loading = () => payload.loading;

  const hasActiveFilters = () =>
    search().trim() || clientTypes().length < ALL_TYPE_KEYS.length;
  const clearFilters = () => {
    setSearch("");
    setClientTypes(ALL_TYPE_KEYS);
  };

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
    {
      label: "Received",
      value: fmtMoney(totals().received_inc_gst, 0),
      tone: TONE_GREEN,
    },
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

      {/* Type toggle — multi-select pills */}
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mr-1">
          Client type
        </span>
        <For each={CLIENT_TYPES}>
          {(t) => {
            const on = () => clientTypes().includes(t.key);
            return (
              <button
                onClick={() =>
                  setClientTypes((prev) => toggleClientTypeIn(prev, t.key))
                }
                aria-pressed={on()}
                class={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
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
                    fallback={
                      <circle cx="12" cy="12" r="9" stroke-width="1.6" />
                    }
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

      {/* ════════ HERO STRIP — three tiles from totals ════════ */}
      <div class="mb-3 mt-4">
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

      {/* ════════ FILTERS: type toggle · search · clear ════════ */}
      <Show when={!loading() && allRows().length > 0}>
        <div class="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 mb-4">
          {/* Search */}
          <div class="relative w-full sm:w-80">
            <svg
              class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8593A8]"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z"
              />
            </svg>
            <input
              type="text"
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              placeholder="Search client name or email…"
              class="w-full pl-9 pr-9 py-2.5 rounded-lg text-sm bg-white dark:bg-gray-800 text-[#14233A] dark:text-gray-200 border border-[#E2E8F1] dark:border-gray-700 placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
            />
            <Show when={search()}>
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#8593A8] hover:text-[#AC2334]"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </Show>
          </div>
          {/* Clear all filters */}
          <Show when={hasActiveFilters()}>
            <button
              onClick={clearFilters}
              class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-semibold text-[#AC2334] dark:text-red-300 bg-[#FBEEF0] dark:bg-red-900/30 hover:bg-[#F7DDE1] dark:hover:bg-red-900/50 transition-colors whitespace-nowrap"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Clear filters
            </button>
          </Show>

          <Show when={hasActiveFilters()}>
            <p class="text-sm text-[#54657E] dark:text-gray-400 sm:ml-auto">
              Showing{" "}
              <b class="text-[#14233A] dark:text-white">{rows().length}</b> of{" "}
              {allRows().length}
            </p>
          </Show>
        </div>
      </Show>

      {/* ════════ PER-CLIENT TABLE (server order — debtors first) ════════ */}
      <PaymentsTable
        rows={rows}
        loading={loading}
        emptyHint={
          hasActiveFilters()
            ? "No clients match the current filters."
            : undefined
        }
      />
    </section>
  );
}
