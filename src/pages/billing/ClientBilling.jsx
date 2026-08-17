import { createSignal, createResource, createMemo, Show } from "solid-js";

import { fetchSalesPayments } from "../../services/sales";
import {
  fmtMoney,
  isMissing,
  sumMoney,
  remainingTile,
  TONE_GREEN,
  TONE_NAVY,
} from "../../components/sales/salesFormat";
import { MoneyTilesRow, PaymentsTable } from "../../components/sales/salesUI";
import MonthPicker from "../../components/sales/MonthPicker";
import ClientTypeFilter, {
  CLIENT_TYPES,
  toggleClientTypeIn,
} from "../../components/funding/ClientTypeFilter";
import { currentUser } from "../../stores/currentUser";

// ─── Client Payments — the single payments-overview screen ────────────────────
// One page for every role that reads this ledger. It replaces three near-
// identical screens (Client Billing, Sales → Payments, Coordination → Payment &
// Billing) that all called the SAME endpoint, GET /billing/admin/payments-
// overview/, and only differed in chrome.
//
// There is no frontend scoping here and there must not be: the BACKEND scopes
// the response to the caller —
//   sales                          → their onboarded clients
//   campaign_manager               → tier-aware visible clients (tier-1 gets
//                                    their own book + their team's, tier-2 own)
//   admin / coordination / accounts → every client
// and its cache keys are per-scope-per-user, so no role ever sees another's
// rows. Because a CM/sales user genuinely gets a shorter table, those two roles
// see a hint saying so — otherwise a short list reads as missing data.
//
// Columns (per client, straight off the endpoint):
//   opening  = balance carried in from the previous month
//   received = funds added this month (real payments, not the opening balance)
//   utilized = spend + service charge + GST (the full billed amount)
//   closing  = opening + received − utilized   (NEGATIVE = the client owes us)
//   status   = owes (closing<0) · low (closing < 15% of budget) · healthy
// Rows arrive closing-ascending (debtors first) and the table keeps that as its
// default order — "who owes us" works without touching a control.

const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const ALL_CLIENT_TYPES = CLIENT_TYPES.map((t) => t.key);

// Roles whose data is narrowed server-side, and what to tell them. Everyone
// else (admin / coordination / accounts) sees the whole org and needs no note.
const SCOPE_HINTS = {
  campaign_manager: "Showing the clients assigned to you.",
  sales: "Showing the clients you onboarded.",
};

export default function ClientBilling() {
  const [month, setMonth] = createSignal(currentMonthStr());
  const [refreshing, setRefreshing] = createSignal(false);
  // Search, status and the client-type chips are CLIENT-SIDE only: the endpoint
  // takes just month/refresh and ships the whole month in one payload.
  const [query, setQuery] = createSignal("");
  const [status, setStatus] = createSignal("all");
  // ALL three types by default, chips visible. This is a billing ledger:
  // retainer clients owe money like any other, and silently dropping a client
  // type from a ledger is how people end up trusting a wrong total.
  const [clientTypes, setClientTypes] = createSignal(ALL_CLIENT_TYPES);
  // GST view. Including GST is the default — it is the amount actually payable.
  const [incGst, setIncGst] = createSignal(true);

  // Role decides only whether to show the scope hint, never what data to keep.
  // Prefer the loaded /auth/me store; fall back to the role mirrored into
  // localStorage at login so the hint doesn't flicker in on first paint.
  const role = () => {
    if (currentUser.loaded) return currentUser.role;
    try {
      return JSON.parse(localStorage.getItem("auth") || "{}")?.role ?? null;
    } catch {
      return null;
    }
  };
  const scopeHint = () => SCOPE_HINTS[role()] ?? null;

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

  const suffix = () => (incGst() ? "inc_gst" : "ex_gst");

  // A month total for one money column. NOTE the key asymmetry: rows use
  // closing_BALANCE_inc_gst but TOTALS use closing_inc_gst (no "balance") —
  // reading the row-style name here used to return undefined and print a false
  // "Remaining ₹0 healthy". When a totals key is genuinely absent (the ex-GST
  // totals are not all guaranteed in the payload) we sum the matching per-client
  // column instead, and return null — never 0 — if no row carries it either, so
  // a missing number renders "—" rather than looking like money in hand.
  const totalMoney = (totalsBase, rowBase) => {
    const t = totals()[`${totalsBase}_${suffix()}`];
    if (!isMissing(t)) return t;
    const rowKey = `${rowBase}_${suffix()}`;
    const list = rows();
    return list.some((r) => !isMissing(r?.[rowKey]))
      ? sumMoney(list, rowKey)
      : null;
  };

  const gstNote = () => (incGst() ? "incl. GST" : "excl. GST");

  const tiles = createMemo(() => [
    {
      label: "Received",
      value: fmtMoney(totalMoney("received", "received"), 0),
      tone: TONE_GREEN,
    },
    {
      // No per-tile GST note: all three flip on the same toggle, so the basis is
      // stated once in the strip caption below and can't drift between labels.
      label: "Billed · spend + S.C",
      value: fmtMoney(totalMoney("utilized", "utilized"), 0),
      tone: TONE_NAVY,
    },
    remainingTile("Remaining", totalMoney("closing", "closing_balance")),
  ]);

  // Chips, status and search applied on top of the server order (filtering is
  // order-neutral, so debtors-first survives). A row whose client_type isn't one
  // of the three known keys (blank / something new server-side) is never hidden
  // by the chips — it would vanish from a billing ledger with no way back.
  const filteredRows = createMemo(() => {
    const types = clientTypes();
    const st = status();
    const q = query().trim().toLowerCase();
    return rows().filter((c) => {
      const t = String(c.client_type ?? "").toLowerCase();
      if (ALL_CLIENT_TYPES.includes(t) && !types.includes(t)) return false;
      if (st !== "all" && c.status !== st) return false;
      if (!q) return true;
      return [c.client_nomen, c.client_email, c.client_type, c.status].some((v) =>
        String(v ?? "").toLowerCase().includes(q),
      );
    });
  });

  const isFiltered = () =>
    query().trim() !== "" ||
    status() !== "all" ||
    clientTypes().length !== ALL_CLIENT_TYPES.length;

  const clearFilters = () => {
    setQuery("");
    setStatus("all");
    setClientTypes(ALL_CLIENT_TYPES);
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
            Opening, received, billed and remaining balances in{" "}
            <span class="font-semibold text-[#14233A] dark:text-gray-200">
              {monthLabel()}
            </span>
            .
          </p>
          {/* Only for the roles the backend narrows — a shorter table is the
              point, not a bug, and saying so beats letting them wonder. */}
          <Show when={scopeHint()}>
            <p class="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#ECF2FA] dark:bg-blue-900/30 text-[12px] font-semibold text-[#3E6FB0] dark:text-blue-300">
              <svg
                class="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 16v-4M12 8h.01" />
              </svg>
              {scopeHint()}
            </p>
          </Show>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <MonthPicker
            value={month()}
            max={currentMonthStr()}
            onChange={handleMonthChange}
          />

          {/* GST toggle — flips every money column AND the tiles together. */}
          <div class="inline-flex items-center gap-1 bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-600 rounded-full p-1">
            <button
              type="button"
              onClick={() => setIncGst(true)}
              aria-pressed={incGst()}
              class={
                "px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors " +
                (incGst()
                  ? "bg-[#14233A] text-white"
                  : "text-[#54657E] dark:text-gray-300 hover:text-[#14233A]")
              }
            >
              Including GST
            </button>
            <button
              type="button"
              onClick={() => setIncGst(false)}
              aria-pressed={!incGst()}
              class={
                "px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors " +
                (!incGst()
                  ? "bg-[#14233A] text-white"
                  : "text-[#54657E] dark:text-gray-300 hover:text-[#14233A]")
              }
            >
              Excluding GST
            </button>
          </div>

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

      {/* ════════ CLIENT TYPE CHIPS (client-side filter) ════════
          All three on by default — retainers included, and visibly so. */}
      <ClientTypeFilter
        value={clientTypes()}
        onToggle={(key) => setClientTypes((prev) => toggleClientTypeIn(prev, key))}
        hint="All client types are included; the summary stays month-wide."
        class="mb-5"
      />

      {/* ════════ HERO STRIP — three tiles from the month totals ════════
          The GST basis lives here, once, for the whole strip: all three tiles
          read the same suffix off the same toggle. Wording is scoped to these
          totals rather than the page — the outstanding callout below is
          inc-GST-only (the endpoint publishes no ex-GST counterpart) and
          carries its own label. */}
      <div class="mb-3">
        <p class="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-[#8593A8] dark:text-gray-400">
          Month totals · {gstNote()}
        </p>
        <MoneyTilesRow tiles={tiles} loading={loading} />
      </div>

      {/* owes / low / healthy counts + the outstanding callout */}
      <div class="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2">
        <p class="text-sm text-[#54657E] dark:text-gray-400 flex flex-wrap items-center gap-x-4 gap-y-1">
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

        {/* A positive net Remaining can hide clients who owe — surface it.
            Always the incl-GST figure: that is the amount actually collectable,
            and it is the only one the endpoint publishes. */}
        <Show when={(totals().clients_owing ?? 0) > 0}>
          <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 text-[13px] font-bold text-[#AC2334] dark:text-red-300 tabular-nums">
            {fmtMoney(totals().total_owed_inc_gst, 0)} outstanding
            <span class="font-semibold text-[11.5px] text-[#54657E] dark:text-gray-400">
              incl. GST
            </span>
          </span>
        </Show>
      </div>

      {/* ════════ FILTERS: search · status · clear ════════ */}
      <div class="mb-3 flex flex-col sm:flex-row sm:items-center gap-3">
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

        {/* Status — the follow-up filter the coordination desk works from. */}
        <select
          value={status()}
          onChange={(e) => setStatus(e.currentTarget.value)}
          aria-label="Filter by status"
          class="px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-[#14233A] dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#14233A]/20 focus:border-[#14233A]/40 cursor-pointer transition"
        >
          <option value="all">All statuses</option>
          <option value="owes">Owes</option>
          <option value="low">Low</option>
          <option value="healthy">Healthy</option>
        </select>

        <Show when={isFiltered()}>
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

        {/* Tiles above are server totals for the whole month — say so whenever a
            filter is on, so a shrunken table never reads as shrunken money. */}
        <Show when={!loading() && isFiltered()}>
          <p class="text-xs text-[#8593A8] dark:text-gray-400 sm:ml-auto">
            Showing{" "}
            <b class="text-[#14233A] dark:text-gray-200">
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
        incGst={incGst()}
        storageKey="clientPaymentsRowsPerPage"
        emptyHint={
          isFiltered()
            ? "No clients match the current search, status or client-type filter."
            : "There is no payments data for this month yet."
        }
      />
    </section>
  );
}
