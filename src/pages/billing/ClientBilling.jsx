import { createSignal, createResource, createMemo, For, Show } from "solid-js";

import { fetchSalesPayments } from "../../services/sales";
import {
  fmtMoney as fmtMoneyPay,
  remainingTile,
  TONE_GREEN,
  TONE_NAVY,
} from "../../components/sales/salesFormat";
import { PaymentsTable } from "../../components/sales/salesUI";
import MonthPicker from "../../components/sales/MonthPicker";
import ClientTypeFilter, {
  CLIENT_TYPES,
  toggleClientTypeIn,
} from "../../components/funding/ClientTypeFilter";

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

const ALL_CLIENT_TYPES = CLIENT_TYPES.map((t) => t.key);

export default function ClientBilling() {
  const [month, setMonth] = createSignal(currentMonthStr());
  const [refreshing, setRefreshing] = createSignal(false);
  // Search + client-type chips are CLIENT-SIDE only: the payments-overview
  // endpoint takes just month/refresh, and the whole month already ships in one
  // payload. Default is ALL three types — unlike the funding pages, this is a
  // billing ledger, so retainer clients belong in it until you opt them out.
  const [query, setQuery] = createSignal("");
  const [clientTypes, setClientTypes] = createSignal(ALL_CLIENT_TYPES);

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

  // Chips + search applied on top of the server order (filter is order-neutral,
  // so debtors-first survives). A row whose client_type isn't one of the three
  // known keys (blank / something new server-side) is never hidden by the chips
  // — it would silently vanish from a billing ledger with no way to get it back.
  const filteredRows = createMemo(() => {
    const types = clientTypes();
    const q = query().trim().toLowerCase();
    return rows().filter((c) => {
      const t = String(c.client_type ?? "").toLowerCase();
      if (ALL_CLIENT_TYPES.includes(t) && !types.includes(t)) return false;
      if (!q) return true;
      return [c.client_nomen, c.client_email, c.client_type, c.status]
        .some((v) => String(v ?? "").toLowerCase().includes(q));
    });
  });

  const isFiltered = () =>
    query().trim() !== "" || clientTypes().length !== ALL_CLIENT_TYPES.length;

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
      caption: "payments in this month",
    },
    {
      label: "Billed (incl. S.C + GST)",
      value: fmtMoneyPay(totals().utilized_inc_gst, 0),
      tone: TONE_NAVY,
      caption: "service charge + GST included",
      divider: true, // vertical rule before this stat (matches the budget panel)
    },
    {
      ...remainingTile("Remaining", totals().closing_inc_gst),
      caption: "closing balance",
    },
  ]);

  // Collection rate for the focal donut — derived from the two totals already on
  // screen, nothing new fetched. null whenever it can't be computed honestly
  // (missing reads, or nothing billed yet) → the donut renders a "—" instead of
  // a fake 0%. The arc is clamped to 100% but the printed number is not.
  const collectedPct = createMemo(() => {
    const r = Number(totals().received_inc_gst);
    const b = Number(totals().utilized_inc_gst);
    if (!Number.isFinite(r) || !Number.isFinite(b) || b <= 0) return null;
    return (r / b) * 100;
  });

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
            Client Billing
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

      {/* ════════ CLIENT TYPE CHIPS (client-side filter) ════════ */}
      <ClientTypeFilter
        value={clientTypes()}
        onToggle={(key) => setClientTypes((prev) => toggleClientTypeIn(prev, key))}
        hint="Filters the table below; the summary stays month-wide."
        class="mb-5"
      />

      <Show when={payload.error}>
        <div class="mb-6 rounded-xl border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300">
          Could not load payments overview. Please try again.
        </div>
      </Show>

      {/* ════════ SUMMARY PANEL (focal donut + money stats + debtor pill) ═══════
          Same shape as the Allowed Budget summary panel: one card, a focal ring,
          divider-separated stats, and a progress band along the bottom. The
          numbers are the exact same three TOTALS reads as before — only the
          presentation changed. */}
      <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] px-5 sm:px-7 py-5 mb-6">
        <div class="flex flex-wrap items-center gap-x-6 gap-y-4">
          {/* focal — share of billed that has been collected */}
          <div class="flex items-center gap-4 sm:pr-6 sm:border-r border-[#E2E8F1] dark:border-gray-700">
            <div class="relative w-14 h-14 grid place-items-center flex-none">
              <svg viewBox="0 0 56 56" class="absolute inset-0 -rotate-90">
                <circle cx="28" cy="28" r="25" fill="none" stroke="#D8EFE6" stroke-width="5" />
                <circle
                  cx="28"
                  cy="28"
                  r="25"
                  fill="none"
                  stroke="#15966A"
                  stroke-width="5"
                  stroke-linecap="round"
                  stroke-dasharray={2 * Math.PI * 25}
                  stroke-dashoffset={
                    2 *
                    Math.PI *
                    25 *
                    (1 -
                      Math.max(
                        0,
                        Math.min((collectedPct() ?? 0) / 100, 1),
                      ))
                  }
                />
              </svg>
              <span class="text-[15px] font-extrabold text-[#15966A] dark:text-green-300 tabular-nums">
                <Show when={!loading()} fallback="…">
                  <Show when={collectedPct() !== null} fallback="—">
                    {Math.round(collectedPct())}%
                  </Show>
                </Show>
              </span>
            </div>
            <div>
              <p class="text-[15px] font-extrabold text-[#14233A] dark:text-white">
                Collected
              </p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 max-w-[180px]">
                of everything billed in {monthLabel()}
              </p>
            </div>
          </div>

          {/* money stats — same tiles(), laid out as minis */}
          <div class="flex flex-wrap gap-x-7 gap-y-3">
            <For each={tiles()}>
              {(t) => (
                <div
                  class={
                    t.divider
                      ? "sm:pl-7 sm:border-l border-[#E2E8F1] dark:border-gray-700"
                      : ""
                  }
                >
                  <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                    {t.label}
                  </p>
                  <p class={`text-xl font-bold mt-1 tabular-nums ${t.tone}`}>
                    <Show
                      when={!loading()}
                      fallback={
                        <span class="inline-block h-6 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse align-middle" />
                      }
                    >
                      {t.value}
                    </Show>
                  </p>
                  <p class="text-xs text-[#54657E] dark:text-gray-400">
                    {t.caption}
                  </p>
                </div>
              )}
            </For>
          </div>

          {/* A positive net Remaining can hide clients who owe — surface it. */}
          <Show when={(totals().clients_owing ?? 0) > 0}>
            <div class="ml-auto inline-flex items-center gap-3 px-4 py-2.5 rounded-xl bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800">
              <span class="w-8 h-8 flex-none rounded-lg bg-[#AC2334] text-white grid place-items-center font-extrabold text-sm tabular-nums">
                {totals().clients_owing}
              </span>
              <span class="text-left">
                <span class="block text-[13px] font-bold text-[#AC2334] dark:text-red-300">
                  of {totals().client_count} clients owe
                </span>
                <span class="block text-[11.5px] font-semibold text-[#54657E] dark:text-gray-400 tabular-nums">
                  {fmtMoneyPay(totals().total_owed_inc_gst, 0)} outstanding
                </span>
              </span>
            </div>
          </Show>
        </div>

        {/* collection band — the focal ratio, drawn wide */}
        <Show when={!loading() && collectedPct() !== null}>
          <div class="mt-5 pt-4 border-t border-[#E2E8F1] dark:border-gray-700">
            <div class="flex items-center justify-between mb-2.5">
              <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Collection progress
              </span>
              <span class="text-xs font-semibold text-[#54657E] dark:text-gray-400 tabular-nums">
                {fmtMoneyPay(totals().received_inc_gst, 0)} received of{" "}
                {fmtMoneyPay(totals().utilized_inc_gst, 0)} billed
              </span>
            </div>
            <div class="h-1.5 rounded-full overflow-hidden bg-[#E2E8F1] dark:bg-gray-700">
              <div
                class="h-full rounded-full bg-[#15966A]"
                style={`width:${Math.max(0, Math.min(collectedPct(), 100))}%`}
              />
            </div>
          </div>
        </Show>
      </div>

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
          <input
            type="search"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Search client, email, type or status…"
            aria-label="Search clients"
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

        {/* Tiles above are server totals for the whole month — say so whenever a
            filter is on, so a shrunken table never reads as shrunken money. */}
        <Show when={!loading() && isFiltered()}>
          <p class="text-xs text-[#8593A8] dark:text-gray-400">
            Showing <b class="text-[#14233A] dark:text-gray-200">
              {filteredRows().length}
            </b>{" "}
            of {rows().length} clients · summary above covers all clients
          </p>
        </Show>
      </div>

      {/* ════════ PER-CLIENT TABLE (server order — debtors first) ════════ */}
      <PaymentsTable
        rows={filteredRows}
        loading={loading}
        emptyHint={
          isFiltered()
            ? "No clients match the current search or client-type filter."
            : "There is no payments data for this month yet."
        }
      />
    </section>
  );
}
