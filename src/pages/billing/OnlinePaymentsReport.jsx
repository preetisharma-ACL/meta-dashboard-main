import {
  createSignal,
  createResource,
  createMemo,
  For,
  Show,
} from "solid-js";
import { useNavigate, A } from "@solidjs/router";
import {
  CreditCard,
  IndianRupee,
  Wallet,
  Percent,
  ReceiptText,
} from "lucide-solid";
import StatTile from "../../components/common/StatTile";
import EntityPicker from "../../components/payments/EntityPicker";
import { OrderStatusBadge } from "../../components/billing/payStatus";
import { errorMessage } from "../../utils/apiErrors";
import { isAdmin } from "../../stores/currentUser";
import {
  fetchPayOrdersReport,
  fetchPayLinkClients,
  sortReportRows,
  effectiveOrderDate,
  orderKindLabel,
  readByMethod,
  buildReportCsv,
  reportCsvFilename,
  downloadCsv,
  reportQuickPicks,
  reportDefaultRange,
  reportRangeError,
  fmtRs,
  fmtPayDateTime,
  payNum,
  REPORT_STATUSES,
  REPORT_DEFAULT_STATUS,
  REPORT_KINDS,
  REPORT_MAX_DAYS,
} from "../../services/hdfcPay";

// ─── Online payments report (accounts + admin) ────────────────────────────────
// Every client's gateway orders over a date range, for reconciling against the
// HDFC settlement report. This screen exists to be compared, line by line,
// against somebody else's export, which decides three things about it:
//
//   • Order ID and Bank ref are shown verbatim and in a monospace face, because
//     they are the join keys against HDFC's own dashboard.
//   • The CSV writes amounts as PLAIN NUMBERS. A "₹5,900.00" would have to be
//     un-formatted by hand before a spreadsheet could sum it.
//   • The date column says WHICH date it is showing. The server filters paid
//     orders by their paid date and everything else by their created date, so
//     on any status but Paid the column holds a mix, and a created date sitting
//     silently under a "Paid on" heading is the one thing a reconciliation
//     screen must never print.
//
// EVERY FILTER IS SERVER-SIDE. Nothing is narrowed here, so the totals cards
// (which are the server's own) always describe exactly the rows in the table.
// That is also why "Export CSV" can write the rows as they stand.

const SECTION =
  "rounded-2xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm";

const TH =
  "px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider " +
  "text-[#8593A8] dark:text-gray-400 whitespace-nowrap";

const TD = "px-4 py-3 text-sm text-[#14233A] dark:text-gray-100 align-top";

const DATE_FIELD =
  "px-3 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-700 " +
  "bg-white dark:bg-gray-800 text-sm text-[#14233A] dark:text-gray-100 " +
  "focus:outline-none focus:ring-2 focus:ring-[#14233A]/20 transition";

export default function OnlinePaymentsReport() {
  const navigate = useNavigate();
  const initial = reportDefaultRange();

  const [from, setFrom] = createSignal(initial.from);
  const [to, setTo] = createSignal(initial.to);
  const [status, setStatus] = createSignal(REPORT_DEFAULT_STATUS);
  const [clientNomen, setClientNomen] = createSignal(null);
  const [kind, setKind] = createSignal("");

  const picks = createMemo(() => reportQuickPicks());
  const rangeError = () => reportRangeError(from(), to());

  // Keyed on the whole filter set. A bad range is NOT requested: the key goes
  // null, the resource parks, and the message under the dates explains why
  // rather than waiting for a 400 to come back and say the same thing.
  const [report] = createResource(
    () =>
      rangeError()
        ? null
        : {
            from: from(),
            to: to(),
            status: status(),
            clientNomen: clientNomen(),
            kind: kind(),
          },
    fetchPayOrdersReport,
  );

  // Reading an errored resource throws, so every read goes through these.
  //
  // AND a bad range blanks the result even though the resource still holds the
  // LAST good one. Solid keeps a parked resource's previous value, so without
  // this the table would go on showing the rows for the range the operator has
  // just navigated away from, under filter boxes that say something else, with
  // the server's totals above them. Export CSV would then write those stale
  // rows into a file named for the NEW range: a spreadsheet that states one
  // period on the filename and holds another, handed to somebody reconciling
  // it against a bank statement. Caught by the headless run.
  const data = () =>
    (report.error || rangeError() ? null : report()) ?? null;
  const totals = () => data()?.totals ?? {};
  const rows = createMemo(() => sortReportRows(data()?.rows));
  const byMethod = createMemo(() => readByMethod(totals()));

  const activePick = () =>
    picks().find((p) => p.from === from() && p.to === to())?.key ?? null;

  const applyPick = (p) => {
    setFrom(p.from);
    setTo(p.to);
  };

  const statusLabel = () =>
    REPORT_STATUSES.find((s) => s.value === status())?.label ?? status();

  // The UPI / Card split under Amount received. Built from the server's
  // by_method block, never summed from the rows.
  const methodSplit = () =>
    byMethod()
      .map((m) => `${m.label} ${fmtRs(m.paid, 0)}`)
      .join(" · ");

  const tiles = createMemo(() => [
    {
      label: "Payments",
      value: (payNum(totals().count) ?? 0).toLocaleString("en-IN"),
      sub: `${statusLabel()} orders in this range`,
      tone: "navy",
      icon: ReceiptText,
    },
    {
      label: "Amount received",
      value: fmtRs(totals().amount_paid, 0),
      sub: methodSplit() || "What the gateway collected",
      tone: "emerald",
      icon: IndianRupee,
      valueClass: "text-[#15966A] dark:text-emerald-300",
    },
    {
      label: "Credited to clients",
      value: fmtRs(totals().credited, 0),
      sub: "Added to client balances",
      tone: "slate",
      icon: Wallet,
    },
    {
      label: "TDS deducted",
      value: fmtRs(totals().tds_amount, 0),
      sub: "Withheld by clients",
      tone: "gold",
      icon: Percent,
    },
    {
      label: "GST",
      value: fmtRs(totals().gst_amount, 0),
      sub: `On ${fmtRs(totals().amount_ex_gst, 0)} ex GST`,
      tone: "crimson",
      icon: CreditCard,
    },
  ]);

  const exportCsv = () => {
    if (!rows().length) return;
    downloadCsv(
      reportCsvFilename(from(), to()),
      buildReportCsv(rows()),
    );
  };

  const openOrder = (row) => {
    if (!row?.order_id) return;
    navigate(`/payment-result?order_id=${encodeURIComponent(row.order_id)}`);
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
            Online payments
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400 max-w-2xl">
            Order ID and Bank ref match the HDFC dashboard and settlement
            report.
          </p>
        </div>

        <div class="flex items-center gap-3">
          <A
            href="/billing/bank-transfers"
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-semibold text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700 transition-colors whitespace-nowrap"
          >
            Bank transfers
          </A>
          <button
            type="button"
            onClick={exportCsv}
            disabled={report.loading || rows().length === 0}
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#1d3252] disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            <svg
              class="w-4 h-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
            Export CSV
          </button>
        </div>
      </div>

      {/* ════════ FILTERS ════════ */}
      <div class={`${SECTION} p-4 sm:p-5 mb-5`}>
        <div class="flex flex-wrap items-end gap-4">
          {/* Dates */}
          <div>
            <label
              class="block text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5"
              for="rp-from"
            >
              From
            </label>
            <input
              id="rp-from"
              type="date"
              value={from()}
              max={to()}
              onInput={(e) => setFrom(e.currentTarget.value)}
              class={DATE_FIELD}
            />
          </div>
          <div>
            <label
              class="block text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5"
              for="rp-to"
            >
              To
            </label>
            <input
              id="rp-to"
              type="date"
              value={to()}
              min={from()}
              onInput={(e) => setTo(e.currentTarget.value)}
              class={DATE_FIELD}
            />
          </div>

          {/* Quick picks */}
          <div class="flex flex-wrap gap-1.5">
            <For each={picks()}>
              {(p) => (
                <button
                  type="button"
                  onClick={() => applyPick(p)}
                  aria-pressed={activePick() === p.key}
                  class={
                    "px-3 py-2 rounded-lg text-xs font-bold transition-colors " +
                    (activePick() === p.key
                      ? "bg-[#14233A] text-white"
                      : "border border-[#E2E8F1] dark:border-gray-600 text-[#54657E] dark:text-gray-300 hover:bg-[#F6F9FC] dark:hover:bg-gray-700")
                  }
                >
                  {p.label}
                </button>
              )}
            </For>
          </div>

          {/* Status */}
          <div>
            <label
              class="block text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5"
              for="rp-status"
            >
              Status
            </label>
            <select
              id="rp-status"
              value={status()}
              onChange={(e) => setStatus(e.currentTarget.value)}
              class={DATE_FIELD + " cursor-pointer"}
            >
              <For each={REPORT_STATUSES}>
                {(s) => <option value={s.value}>{s.label}</option>}
              </For>
            </select>
          </div>

          {/* Kind — ADMIN ONLY. It exists to separate real client payments from
              test links, which is not a distinction the accounts desk works
              with and not one they should be filtering their reconciliation by
              without meaning to. */}
          <Show when={isAdmin()}>
            <div>
              <label
                class="block text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5"
                for="rp-kind"
              >
                Kind
              </label>
              <select
                id="rp-kind"
                value={kind()}
                onChange={(e) => setKind(e.currentTarget.value)}
                class={DATE_FIELD + " cursor-pointer"}
              >
                <For each={REPORT_KINDS}>
                  {(k) => <option value={k.value}>{k.label}</option>}
                </For>
              </select>
            </div>
          </Show>

          {/* Client */}
          <div class="w-full sm:w-64">
            <EntityPicker
              label="Client"
              allowClear
              clearLabel="All clients"
              value={clientNomen()}
              onChange={(id) => setClientNomen(id)}
              fetcher={fetchPayLinkClients}
              placeholder="All clients"
              forbiddenMsg="You don't have access to the client list."
              errorMsg="The client list could not be loaded."
              labelClass="block text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5"
              fieldClass={DATE_FIELD + " w-full"}
            />
          </div>
        </div>

        {/* The local range check, said before a doomed request is made. */}
        <Show when={rangeError()}>
          <p
            role="alert"
            class="mt-3 text-sm font-medium text-[#AC2334] dark:text-red-400"
          >
            {rangeError()} The report covers up to {REPORT_MAX_DAYS} days at a
            time.
          </p>
        </Show>
      </div>

      {/* The server's own message, for anything the local check did not catch. */}
      <Show when={report.error}>
        <div
          role="alert"
          class="mb-5 rounded-xl border border-[#AC2334]/30 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
        >
          {errorMessage(report.error, "The report could not be loaded.")}
        </div>
      </Show>

      {/* ════════ TOTALS ════════ */}
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-5">
        <For each={tiles()}>
          {(t) => (
            <Show
              when={!report.loading}
              fallback={
                <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-4">
                  <div class="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                  <div class="mt-3 h-6 w-28 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                </div>
              }
            >
              <StatTile
                label={t.label}
                value={t.value}
                sub={t.sub}
                tone={t.tone}
                icon={t.icon}
                valueClass={t.valueClass}
              />
            </Show>
          )}
        </For>
      </div>

      {/* ════════ TRUNCATION ════════
          The server stopped sending rows, so the TABLE is a subset while the
          TOTALS above are not. Said plainly, because a totals row that does not
          match a hand-summed column is exactly what a reconciliation screen
          gets distrusted for. */}
      <Show when={data()?.truncated === true}>
        <div class="mb-4 rounded-xl border border-[#B07A14]/30 bg-[#FBF3E2] dark:bg-yellow-900/20 dark:border-yellow-800 px-4 py-3 text-sm font-semibold text-[#B07A14] dark:text-yellow-300">
          Showing the first 2,000. Narrow the date range.
        </div>
      </Show>

      {/* ════════ TABLE ════════ */}
      <div class={`${SECTION} overflow-hidden`}>
        <Show
          when={!report.loading}
          fallback={
            <p class="px-5 py-10 text-sm text-[#54657E] dark:text-gray-400">
              Loading the report…
            </p>
          }
        >
          <Show
            when={rows().length > 0}
            fallback={
              <p class="px-5 py-12 text-center text-sm text-[#54657E] dark:text-gray-400">
                {rangeError()
                  ? "Pick a valid date range to run the report."
                  : "No payments match these filters."}
              </p>
            }
          >
            <div class="overflow-auto max-h-[calc(100vh-16rem)]">
              <table class="w-full">
                <thead class="sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-900">
                  <tr>
                    <th class={TH}>Paid on</th>
                    <th class={TH}>Client</th>
                    <th class={TH}>Order ID</th>
                    <th class={TH}>Bank ref</th>
                    <th class={TH}>Method</th>
                    <th class={TH}>Kind</th>
                    <th class={`${TH} text-right`}>Amount received</th>
                    <th class={`${TH} text-right`}>TDS</th>
                    <th class={`${TH} text-right`}>Credited</th>
                    <th class={`${TH} text-center`}>Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[#E2E8F1] dark:divide-gray-700">
                  <For each={rows()}>
                    {(row) => {
                      const d = effectiveOrderDate(row);
                      return (
                        <tr
                          tabIndex={0}
                          role="button"
                          aria-label={`Open receipt for order ${row.order_id}`}
                          onClick={() => openOrder(row)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              openOrder(row);
                            }
                          }}
                          class="cursor-pointer hover:bg-[#F8FAFC] dark:hover:bg-gray-700/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 transition-colors"
                        >
                          <td class={`${TD} whitespace-nowrap`}>
                            {fmtPayDateTime(d.value)}
                            {/* An unpaid order has no paid date, so the cell
                                shows its created date and SAYS SO. Silently
                                printing it under "Paid on" would put a date
                                in a settlement column that HDFC never settled
                                anything on. */}
                            <Show when={d.field === "created_at"}>
                              <span class="block text-[11px] font-semibold uppercase tracking-wide text-[#8593A8] dark:text-gray-500">
                                Created
                              </span>
                            </Show>
                          </td>
                          <td class={`${TD} font-semibold`}>
                            {row.client || "—"}
                          </td>
                          {/* The two HDFC join keys, monospace so a digit can
                              be matched against their export by eye. */}
                          <td class={`${TD} font-mono text-xs break-all`}>
                            {row.order_id || "—"}
                          </td>
                          <td class={`${TD} font-mono text-xs break-all`}>
                            {row.bank_ref || "—"}
                          </td>
                          <td class={`${TD} whitespace-nowrap`}>
                            {row.method || "—"}
                          </td>
                          <td class={`${TD} whitespace-nowrap`}>
                            {orderKindLabel(row)}
                          </td>
                          <td class={`${TD} text-right tabular-nums font-semibold`}>
                            {fmtRs(row.amount_paid, 2)}
                          </td>
                          <td class={`${TD} text-right tabular-nums`}>
                            {fmtRs(row.tds_amount, 2)}
                          </td>
                          <td class={`${TD} text-right tabular-nums text-[#15966A] dark:text-green-300`}>
                            {fmtRs(row.credited, 2)}
                          </td>
                          <td class={`${TD} text-center`}>
                            <OrderStatusBadge order={row} />
                            {/* Why a failed order failed, on the row, so the
                                desk can answer a client without opening it. */}
                            <Show when={String(row.error ?? "").trim()}>
                              <p class="mt-1.5 text-[11px] leading-snug text-[#8593A8] dark:text-gray-400 max-w-[16rem] mx-auto">
                                {row.error}
                              </p>
                            </Show>
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </div>

            <div class="px-5 py-3 border-t border-[#E2E8F1] dark:border-gray-700 text-xs text-[#8593A8] dark:text-gray-400">
              {rows().length.toLocaleString("en-IN")} rows shown, newest first.
              The totals above are the server's and cover the whole range.
            </div>
          </Show>
        </Show>
      </div>
    </section>
  );
}
