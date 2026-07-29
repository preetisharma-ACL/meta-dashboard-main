import { createSignal, createResource, createMemo, Show, For } from "solid-js";
import { A } from "@solidjs/router";

import { fetchPayments } from "../../services/payments";
import PaymentsTable from "../../components/payments/PaymentsTable";
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
// visible set. We send no scoping params of our own.

export default function MyPaymentEntries() {
  const [docsStatus, setDocsStatus] = createSignal("");
  const [dateFrom, setDateFrom] = createSignal("");
  const [dateTo, setDateTo] = createSignal("");
  const [query, setQuery] = createSignal("");

  const filterKey = createMemo(() => ({
    docsStatus: docsStatus(),
    dateFrom: dateFrom(),
    dateTo: dateTo(),
  }));

  const [payload, { refetch }] = createResource(filterKey, fetchPayments);

  const rows = () => payload()?.rows ?? [];
  const loading = () => payload.loading;

  const filtered = createMemo(() => {
    const q = query().trim().toLowerCase();
    if (!q) return rows();
    return rows().filter((r) =>
      [r.clientName, r.project, r.notes].some((v) =>
        String(v ?? "").toLowerCase().includes(q),
      ),
    );
  });

  const pendingCount = () =>
    filtered().filter(
      (r) => String(r.docsStatus ?? "").toLowerCase() === "pending",
    ).length;

  const tiles = createMemo(() => [
    {
      label: "Entries",
      value: String(filtered().length),
      tone: "text-[#14233A] dark:text-white",
    },
    {
      label: "Total recorded",
      value: fmtMoney(sumMoney(filtered(), "finalAmount"), 0),
      tone: "text-[#15966A] dark:text-green-300",
    },
    {
      label: "Awaiting accounts",
      value: String(pendingCount()),
      tone: "text-[#B07A14] dark:text-yellow-300",
    },
  ]);

  const hasFilters = () =>
    query().trim() !== "" ||
    docsStatus() !== "" ||
    dateFrom() !== "" ||
    dateTo() !== "";

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
      <Show when={!loading() && pendingCount() > 0}>
        <div class="mb-6 rounded-xl border border-[#B07A14]/25 bg-[#FBF3E2] dark:bg-yellow-900/15 px-4 py-3">
          <p class="text-sm text-[#8A6410] dark:text-yellow-200 leading-relaxed">
            {pendingCount()} of your entries {pendingCount() === 1 ? "is" : "are"}{" "}
            marked <b>Needs docs</b>. That's accounts' paperwork step — the
            amounts already count towards each client's received total.
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
            </div>
          )}
        </For>
      </div>

      {/* ════════ FILTERS ════════ */}
      <div class="bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-4 mb-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label class={labelClass}>Search</label>
            <input
              type="search"
              value={query()}
              onInput={(e) => setQuery(e.currentTarget.value)}
              placeholder="Client or project…"
              class={fieldClass}
            />
          </div>
          <div>
            <label class={labelClass}>Docs status</label>
            <select
              value={docsStatus()}
              onChange={(e) => setDocsStatus(e.currentTarget.value)}
              class={fieldClass}
            >
              <option value="">All</option>
              <option value="pending">Needs docs</option>
              <option value="complete">Complete</option>
            </select>
          </div>
          <div>
            <label class={labelClass}>From</label>
            {/* onChange, not onInput — these drive a server refetch (see the
                same note on the accounts ledger). */}
            <input
              type="date"
              value={dateFrom()}
              onChange={(e) => setDateFrom(e.currentTarget.value)}
              class={fieldClass}
            />
          </div>
          <div>
            <label class={labelClass}>To</label>
            <input
              type="date"
              value={dateTo()}
              onChange={(e) => setDateTo(e.currentTarget.value)}
              class={fieldClass}
            />
          </div>
        </div>
      </div>

      {/* ════════ TABLE (read-only — canManage omitted) ════════ */}
      <PaymentsTable
        rows={filtered}
        loading={loading}
        canManage={false}
        emptyHint={
          hasFilters()
            ? "No entries match the current filters."
            : "You haven't recorded any payments yet."
        }
      />
    </section>
  );
}
