import {
  createSignal,
  createResource,
  createMemo,
  createEffect,
  onCleanup,
  batch,
  Show,
  For,
} from "solid-js";
import { A } from "@solidjs/router";

import { fetchPayments, fetchPaymentsCount } from "../../services/payments";
import PaymentsTable from "../../components/payments/PaymentsTable";
import MonthPicker from "../../components/sales/MonthPicker";
import {
  fmtMoney,
  fieldClass,
  labelClass,
} from "../../components/payments/paymentsFormat";
import { sumMoney } from "../../components/sales/salesFormat";

// ─── My Payment Entries (tier-1 CM) ───────────────────────────────────────────
// Read-only by construction. PaymentsTable renders Edit/Delete only when
// `canManage` is true, so this page has no mutation affordance anywhere — the
// API's 403 on PATCH/DELETE is the backstop, not the mechanism.
//
// The feed is GET /payments/, which the backend already narrows to the CM's
// visible set. We send no scoping params of our own — same server pagination
// and the same server-side filters as the accounts ledger.

const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const monthRange = (m) => {
  if (!m) return { from: "", to: "" };
  const [y, mo] = String(m).split("-").map(Number);
  if (!y || !mo) return { from: "", to: "" };
  const last = new Date(y, mo, 0).getDate();
  const p = (n) => String(n).padStart(2, "0");
  return { from: `${y}-${p(mo)}-01`, to: `${y}-${p(mo)}-${p(last)}` };
};

export default function MyPaymentEntries() {
  const [docsStatus, setDocsStatus] = createSignal("");
  const [month, setMonth] = createSignal("");
  const [query, setQuery] = createSignal("");
  const [search, setSearch] = createSignal("");
  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(50);

  let searchTimer;
  const onSearchInput = (v) => {
    setQuery(v);
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      applyFilter(() => setSearch(v.trim()));
    }, 350);
  };
  onCleanup(() => clearTimeout(searchTimer));

  const baseFilters = createMemo(() => {
    const { from, to } = monthRange(month());
    return {
      docsStatus: docsStatus(),
      dateFrom: from,
      dateTo: to,
      client: search(),
    };
  });

  const listKey = createMemo(() => ({
    ...baseFilters(),
    page: page(),
    pageSize: pageSize(),
  }));

  const [payload, { refetch }] = createResource(listKey, fetchPayments);

  // True across-all-pages count of entries still waiting on accounts.
  const pendingKey = createMemo(() =>
    docsStatus() === "pending" ? false : { ...baseFilters(), docsStatus: "pending" },
  );
  const [pendingProbe] = createResource(pendingKey, fetchPaymentsCount);

  const rows = () => payload()?.rows ?? [];
  const pagination = () => payload()?.pagination ?? {};
  const loading = () => payload.loading;
  // Same page-safety contract as the accounts ledger: a filter write and the
  // page reset must land in ONE batch, or listKey recomputes twice and fires an
  // interim request for (new filter, OLD page) — the out-of-range combination
  // the API rejects with "Invalid page". gotoPage then clamps to total_pages.
  const applyFilter = (fn) =>
    batch(() => {
      fn();
      setPage(1);
    });

  const gotoPage = (n) => {
    const target = Math.max(1, Math.floor(Number(n)) || 1);
    const tp = pagination().totalPages;
    setPage(tp != null && tp >= 1 ? Math.min(target, tp) : target);
  };

  createEffect(() => {
    const tp = pagination().totalPages;
    if (tp != null && tp >= 1 && page() > tp) setPage(tp);
  });

  const total = () => pagination().total ?? null;
  const awaitingDocs = () =>
    docsStatus() === "pending" ? total() : (pendingProbe() ?? null);

  const fmtCount = (v) => (v == null ? "—" : String(v));

  const tiles = createMemo(() => [
    {
      label: "Entries",
      value: fmtCount(total()),
      tone: "text-[#14233A] dark:text-white",
      caption: "matching the current filters",
    },
    {
      label: "Awaiting accounts",
      value: fmtCount(awaitingDocs()),
      tone: "text-[#B07A14] dark:text-yellow-300",
      caption: "across all pages",
    },
    {
      // Page-scoped and labelled as such — there's no server-side sum, and a
      // headline "total" covering one page of many would misread as the lot.
      label: "Recorded on this page",
      value: fmtMoney(sumMoney(rows(), "finalAmount"), 0),
      tone: "text-[#15966A] dark:text-green-300",
      caption: `${rows().length} row${rows().length === 1 ? "" : "s"} shown`,
    },
  ]);

  const hasFilters = () =>
    query().trim() !== "" || docsStatus() !== "" || month() !== "";

  const loadError = () => {
    const e = payload.error;
    if (!e) return null;
    if (e.status === 403) return "You don't have access to payment entries.";
    return "Could not load your entries. Please try again.";
  };

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Campaign Manager
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            My Payment Entries
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400 max-w-2xl">
            Payments you've recorded for your clients. These are read-only —
            accounts adds the reference and invoice, and can correct an amount
            if something needs changing.
          </p>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          <Show
            when={month()}
            fallback={
              <button
                onClick={() => {
                  applyFilter(() => setMonth(currentMonthStr()));
                }}
                class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-colors"
              >
                <svg class="w-4 h-4 text-[#AC2334]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Filter by month
              </button>
            }
          >
            <div class="inline-flex items-center gap-1.5">
              <MonthPicker
                value={month()}
                max={currentMonthStr()}
                onChange={(m) => {
                  applyFilter(() => setMonth(m));
                }}
              />
              <button
                onClick={() => {
                  applyFilter(() => setMonth(""));
                }}
                aria-label="Show all months"
                title="Show all months"
                class="w-8 h-8 grid place-items-center rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-[#8593A8] hover:text-[#AC2334] hover:bg-[#FBEEF0] dark:hover:bg-red-900/30 transition-colors"
              >
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </Show>

          <A
            href="/payments/record"
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#1d3252] transition-colors"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 5v14M5 12h14" />
            </svg>
            Record payment
          </A>
          <button
            onClick={() => refetch()}
            disabled={loading()}
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 disabled:opacity-60 transition-colors"
          >
            <svg
              class={"w-4 h-4 " + (loading() ? "animate-spin" : "")}
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
            Refresh
          </button>
        </div>
      </div>

      <Show when={loadError()}>
        <div class="mb-6 rounded-xl border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300">
          {loadError()}
        </div>
      </Show>

      {/* "Needs docs" on a CM's own screen is about ACCOUNTS' paperwork, not
          about the money being in limbo. Say so once, plainly. */}
      <Show when={!loading() && (awaitingDocs() ?? 0) > 0}>
        <div class="mb-6 rounded-xl border border-[#B07A14]/25 bg-[#FBF3E2] dark:bg-yellow-900/15 px-4 py-3">
          <p class="text-sm text-[#8A6410] dark:text-yellow-200 leading-relaxed">
            {awaitingDocs()} of your entries{" "}
            {awaitingDocs() === 1 ? "is" : "are"} marked <b>Needs docs</b>.
            That's accounts' paperwork step — the amounts already count towards
            each client's received total.
          </p>
        </div>
      </Show>

      {/* ════════ SUMMARY TILES ════════ */}
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <For each={tiles()}>
          {(t) => (
            <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                {t.label}
              </p>
              <p class={`text-2xl font-bold mt-1.5 tracking-tight tabular-nums ${t.tone}`}>
                <Show
                  when={!loading()}
                  fallback={
                    <span class="inline-block h-8 w-28 bg-gray-200 dark:bg-gray-700 rounded animate-pulse align-middle" />
                  }
                >
                  {t.value}
                </Show>
              </p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                {t.caption}
              </p>
            </div>
          )}
        </For>
      </div>

      {/* ════════ FILTERS ════════ */}
      <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-4 mb-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class={labelClass}>Client search</label>
            <input
              type="search"
              value={query()}
              onInput={(e) => onSearchInput(e.currentTarget.value)}
              placeholder="Client name…"
              class={fieldClass}
            />
          </div>
          <div>
            <label class={labelClass}>Docs status</label>
            <select
              value={docsStatus()}
              onChange={(e) => {
                applyFilter(() => setDocsStatus(e.currentTarget.value));
              }}
              class={fieldClass}
            >
              <option value="">All</option>
              <option value="pending">Needs docs</option>
              <option value="complete">Complete</option>
            </select>
          </div>
        </div>
      </div>

      {/* ════════ TABLE (read-only — canManage false) ════════ */}
      <PaymentsTable
        rows={rows}
        loading={loading}
        canManage={false}
        page={page}
        pageSize={pageSize}
        total={total}
        totalPages={() => pagination().totalPages}
        hasNext={() => pagination().hasNext}
        hasPrev={() => pagination().hasPrev}
        onPageChange={gotoPage}
        onPageSizeChange={(n) => {
          applyFilter(() => setPageSize(n));
        }}
        emptyHint={
          hasFilters()
            ? "No entries match the current filters."
            : "You haven't recorded any payments yet."
        }
      />
    </section>
  );
}
