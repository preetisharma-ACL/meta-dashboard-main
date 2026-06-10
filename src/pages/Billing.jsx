import { createSignal, createMemo, createResource, For, Show } from "solid-js";
import { fetchBillingOverview } from "../services/billing-service";
import { fetchPaymentsDetails } from "../services/payments-service";
import useRole, { clientRole } from "../hooks/useRole";

// --- Helpers ------------------------------------------------------------------
// API returns decimals as strings; we only format for display (no further math),
// so Number() here is safe. Currency formatting via Intl.NumberFormat.
const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmt = (n) => inrFormatter.format(Number(n ?? 0));
const pct = (a, b) => (b === 0 ? 0 : Math.min(100, Math.round((a / b) * 100)));

// TODO: replace with the API field once the backend exposes the contracted
// per-lead rate (e.g. budget.fixed_cpl). Hardcoded for now per requirement.
const FIXED_CPL = "NA";

// --- Primitive UI Components --------------------------------------------------

function SectionLabel(props) {
  return (
    <p class="text-md font-semibold text-gray-600 dark:text-gray-400 mb-3 mt-4">
      {props.children}
    </p>
  );
}

function Card(props) {
  return (
    <div
      class={`rounded-xl shadow-sm transition border border-gray-200/80 dark:border dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl ${props.class || ""}`}
    >
      {props.children}
    </div>
  );
}

function Tag(props) {
  const variantMap = {
    gray: "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400",
    green: "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-400",
    amber: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400",
    blue: "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-400",
    red: "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400",
  };
  return (
    <span
      class={`inline-flex items-center rounded-full px-2 py-0.5 text-sm font-bold tracking-wide ${variantMap[props.variant || "gray"]}`}
    >
      {props.children}
    </span>
  );
}

// Tiny label used across the Overview, mirrors the reference design.
function Eyebrow(props) {
  return (
    <p class="text-sm text-gray-600 dark:text-gray-300">{props.children}</p>
  );
}

// --- Overview: Hero cards -------------------------------------------------------
function HeroCard(props) {
  return (
    <section
      aria-label={props.ariaLabel}
      class={`rounded-2xl border p-6 transition shadow-sm ${
        props.accent
          ? "border-blue-300/60 dark:border-blue-800/70 bg-gradient-to-b from-blue-50/90 to-white dark:from-blue-950/40 dark:to-gray-800/70"
          : "border-gray-200/80 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl"
      }`}
    >
      <Eyebrow>{props.label}</Eyebrow>
      <p
        class={`mt-3 text-2xl font-bold tracking-tight tabular-nums ${
          props.accent
            ? "text-blue-900 dark:text-blue-300"
            : "text-gray-900 dark:text-gray-100"
        }`}
      >
        {props.value}
      </p>
      <p class="mt-2.5 text-sm text-gray-500 dark:text-gray-400">{props.sub}</p>
    </section>
  );
}

// --- Overview: Leads card (CPL value optional, per client type) -----------------
function LeadsCard(props) {
  return (
    <Card class={`p-6 ${props.class || ""}`} aria-label="Lead performance">
      <div
        class={`flex h-full gap-8 ${
          props.stacked
            ? "flex-row md:flex-col md:gap-5 justify-center"
            : "flex-row items-center justify-center"
        }`}
      >
        <div>
          <Eyebrow>Total Leads</Eyebrow>
          <p class="mt-1.5 text-2xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-gray-100">
            {props.leads}
          </p>
        </div>
        <Show when={props.showCpl}>
          <div>
            <Eyebrow>Cost per Lead</Eyebrow>
            <p class="mt-1.5 text-xl font-bold tracking-tight tabular-nums text-blue-900 dark:text-blue-400">
              {props.cpl > 0 ? fmt(props.cpl) : "—"}
              <span class="ml-2 text-sm font-medium tracking-normal text-gray-500 dark:text-gray-400">
                ex-GST
              </span>
            </p>
          </div>
        </Show>
      </div>
    </Card>
  );
}

// --- Overview: Budget pacing card ----------------------------------------------
function PacingCard(props) {
  return (
    <Card class="p-6">
      <Eyebrow>Budget Utilized · Monthly Allocation</Eyebrow>

      <div class="mt-3 flex flex-wrap items-baseline justify-between gap-2">
        <p class="text-2xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-gray-100">
          {fmt(props.utilized)}
          <span class="ml-2 text-sm font-medium tracking-normal text-gray-500 dark:text-gray-400">
            of {fmt(props.allocated)} committed
          </span>
        </p>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          <span class="font-semibold text-gray-900 dark:text-gray-100">
            {props.utilizationPct}%
          </span>{" "}
          used
        </p>
      </div>

      {/* Progress bar with a "today" marker */}
      <div
        class="relative mt-5 h-2 rounded-full bg-gray-100 dark:bg-gray-700"
        role="img"
        aria-label={`${props.utilizationPct} percent of budget used, ${Math.round(props.elapsedPct)} percent of month elapsed`}
      >
        <div
          class="absolute inset-y-0 left-0 rounded-full bg-blue-900 dark:bg-blue-400 transition-all duration-700 motion-reduce:transition-none"
          style={{ width: `${Math.min(100, props.utilizationPct)}%` }}
        />
        <Show when={props.elapsedPct > 0 && props.elapsedPct < 100}>
          <div
            class="absolute -top-1 -bottom-1 w-0.5 rounded bg-gray-400 dark:bg-gray-500"
            style={{ left: `${props.elapsedPct}%` }}
          />
        </Show>
      </div>

      <div class="mt-2.5 flex justify-between text-xs text-gray-400 dark:text-gray-500">
        <span>1 {props.monthShort}</span>
        <Show
          when={props.dayOfMonth > 0 && props.dayOfMonth < props.daysInMonth}
        >
          <span class="text-gray-500 dark:text-gray-400">
            Today · day {props.dayOfMonth} of {props.daysInMonth}
          </span>
        </Show>
        <span>
          {props.daysInMonth} {props.monthShort}
        </span>
      </div>

      <Show when={props.pacing}>
        <p class="mt-4 inline-flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <span class={`h-2 w-2 rounded-full ${props.pacing.dotClass}`} />
          {props.pacing.text}
        </p>
      </Show>
    </Card>
  );
}

// --- Overview: Ledger (account statement) --------------------------------------
function LedgerRow(props) {
  const borderClass = () => {
    if (props.noBorder) return "";
    if (props.total) return "border-t border-gray-200 dark:border-gray-700";
    if (props.sub)
      return "border-t border-dashed border-gray-100 dark:border-gray-700/70";
    return "border-t border-gray-100 dark:border-gray-700/70";
  };
  return (
    <div
      class={`flex items-baseline justify-between gap-4 px-6 py-3.5 ${borderClass()} ${
        props.total ? "bg-gray-50 dark:bg-gray-800/80" : ""
      }`}
    >
      <div
        class={`flex items-baseline gap-2.5 ${
          props.sub
            ? "pl-9 text-sm font-normal text-gray-500 dark:text-gray-400"
            : `text-sm md:text-base ${props.total ? "font-semibold" : "font-medium"} text-gray-900 dark:text-gray-100`
        }`}
      >
        <Show when={props.op}>
          <span
            class={`inline-block w-4 text-center text-sm font-medium ${
              props.op === "+"
                ? "text-green-600 dark:text-green-400"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {props.op}
          </span>
        </Show>
        {props.name}
        <Show when={props.tag}>
          <span class="text-[11px] font-medium text-gray-400 dark:text-gray-500">
            {props.tag}
          </span>
        </Show>
      </div>
      <p
        class={`tabular-nums ${
          props.total
            ? "text-2xl font-bold tracking-tight text-blue-900 dark:text-blue-300"
            : props.sub
              ? "text-sm font-medium text-gray-500 dark:text-gray-400"
              : `text-sm md:text-base font-semibold ${
                  props.tone === "neg"
                    ? "text-red-600 dark:text-red-400"
                    : props.tone === "zero"
                      ? "text-gray-400 dark:text-gray-500"
                      : "text-gray-900 dark:text-gray-100"
                }`
        }`}
      >
        {props.value}
      </p>
    </div>
  );
}

// --- Payment History ----------------------------------------------------------
function PaymentHistory(props) {
  return (
    <Card class="p-5 space-y-4">
      <SectionLabel>Payment History</SectionLabel>

      <Show
        when={props.payments && props.payments.length > 0}
        fallback={
          <div class="flex items-center justify-center py-10 text-sm text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
            No payment history available yet
          </div>
        }
      >
        <div class="space-y-3">
          <For each={props.payments}>
            {(pay) => (
              <div
                class={`rounded-xl border p-4 space-y-2 ${
                  pay.credit
                    ? "border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30"
                    : "border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-800/20"
                }`}
              >
                <div class="flex items-start justify-between gap-3 flex-wrap">
                  <div class="flex items-center gap-3">
                    <div
                      class={`w-9 h-9 rounded-full flex items-center justify-center text-sm flex-shrink-0 ${
                        pay.credit
                          ? "bg-gray-100 dark:bg-gray-800 text-gray-500"
                          : "bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900"
                      }`}
                    >
                      {pay.credit ? "📋" : "✓"}
                    </div>

                    <div>
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-semibold text-gray-900 dark:text-gray-100">
                          {fmt(pay.amount)}
                        </span>

                        <Show
                          when={pay.credit}
                          fallback={
                            <Tag
                              variant={
                                pay.status === "succeeded"
                                  ? "green"
                                  : pay.status === "pending"
                                    ? "amber"
                                    : "red"
                              }
                            >
                              {pay.status_label || pay.status?.toUpperCase()}
                            </Tag>
                          }
                        >
                          <Tag variant="gray">CREDITED by {pay.creditedBy}</Tag>
                        </Show>

                        <Show when={pay.gstFiled}>
                          <Tag variant="blue">GST Filed</Tag>
                        </Show>
                      </div>

                      <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                        {pay.credit
                          ? `Credited on ${pay.creditDate} by ${pay.creditedBy}`
                          : `${pay.date} · via ${pay.method} · ${pay.id}`}
                      </p>
                    </div>
                  </div>

                  <Show when={!pay.credit}>
                    <button
                      onClick={() => props.onViewInvoice(pay)}
                      class="flex items-center gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
                    >
                      <svg
                        class="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          stroke-width="2"
                          d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                        />
                      </svg>
                      Invoice
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Card>
  );
}

// --- Add Funds Modal ----------------------------------------------------------
function AddFundsModal(props) {
  const [amount, setAmount] = createSignal("");
  const [method, setMethod] = createSignal("UPI");
  const quickAmounts = [50000, 100000, 200000, 500000];
  const methods = ["UPI", "Bank Transfer", "Credit Card", "Cheque"];
  const totalWithGST = () =>
    amount() ? Math.round(Number(amount()) * 1.18) : null;

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  return (
    <div
      class={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${props.open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      style={{ background: "rgba(0,0,0,0.45)", "backdrop-filter": "blur(4px)" }}
      onClick={handleBackdrop}
    >
      <div
        class={`w-full max-w-md transition-all duration-200 ${props.open ? "scale-100 translate-y-0" : "scale-95 translate-y-4"}`}
      >
        <Card class="p-6 space-y-5 shadow-sm">
          <div class="flex items-start justify-between">
            <div>
              <h3 class="font-bold text-gray-900 dark:text-gray-100 text-lg">
                Add Funds
              </h3>
              <p class="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                Powered by HDFC Payment Gateway
              </p>
            </div>
            <button
              onClick={props.onClose}
              class="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-semibold text-gray-600 dark:text-gray-400">
              Amount (INR, ex-GST)
            </label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-600 font-bold select-none">
                ₹
              </span>
              <input
                type="number"
                placeholder="0"
                value={amount()}
                onInput={(e) => setAmount(e.currentTarget.value)}
                class="w-full pl-8 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-lg focus:outline-none focus:ring-2 focus:ring-gray-400 dark:focus:ring-gray-600 placeholder-gray-300 dark:placeholder-gray-700"
              />
            </div>
            <p class="text-sm text-gray-600 dark:text-gray-400">
              +18% GST · You pay:{" "}
              <span class="font-semibold text-gray-700 dark:text-gray-400">
                {totalWithGST() ? fmt(totalWithGST()) : "—"}
              </span>
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <For each={quickAmounts}>
              {(a) => (
                <button
                  onClick={() => setAmount(String(a))}
                  class={`text-sm font-semibold px-3 py-1.5 rounded-lg border transition-colors ${String(amount()) === String(a) ? "bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 border-transparent" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400"}`}
                >
                  {fmt(a)}
                </button>
              )}
            </For>
          </div>
          <div class="space-y-1.5">
            <label class="text-sm font-semibold text-gray-600 dark:text-gray-400">
              Payment Method
            </label>
            <div class="grid grid-cols-4 gap-2">
              <For each={methods}>
                {(m) => (
                  <button
                    onClick={() => setMethod(m)}
                    class={`text-[11px] font-semibold py-2 px-1 rounded-xl border transition-colors text-center ${method() === m ? "bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 border-transparent" : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400"}`}
                  >
                    {m}
                  </button>
                )}
              </For>
            </div>
          </div>
          <button
            disabled={!amount() || Number(amount()) <= 0}
            class="w-full py-3 rounded-2xl bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 font-bold text-sm hover:opacity-85 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {totalWithGST()
              ? `Proceed to Pay ${fmt(totalWithGST())} →`
              : "Enter Amount to Continue"}
          </button>
        </Card>
      </div>
    </div>
  );
}

function InvoiceModal(props) {
  const gst = () => props.invoice?.gstAmount || 0;
  const total = () => props.invoice?.amount || 0;

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  return (
    <div
      class={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${
        props.open
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      }`}
      style={{ background: "rgba(0,0,0,0.45)", "backdrop-filter": "blur(4px)" }}
      onClick={handleBackdrop}
    >
      <div
        class={`w-full max-w-md transition-all duration-200 ${
          props.open ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
        }`}
      >
        <Card class="p-6 space-y-5 shadow-sm">
          {/* ── Header ── */}
          <div class="flex items-start justify-between">
            <div>
              <h3 class="font-bold text-gray-900 dark:text-gray-100 text-lg">
                Invoice
              </h3>
              <p class="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                {props.invoice?.id ?? "—"}
              </p>
            </div>
            <button
              onClick={props.onClose}
              class="w-8 h-8 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* ── Issued by / Date row ── */}
          <div class="flex items-start justify-between gap-4">
            <div class="space-y-0.5">
              <p class="text-sm font-semibold text-gray-600 dark:text-gray-400">
                Issued by
              </p>
              <p class="text-sm font-bold text-gray-900 dark:text-gray-100">
                Aajneeti Connect Ltd.
              </p>
              <p class="text-xs text-gray-500 dark:text-gray-500">
                Delhi, India
              </p>
            </div>
            <div class="text-right space-y-0.5">
              <p class="text-sm font-semibold text-gray-600 dark:text-gray-400">
                Payment Date
              </p>
              <p class="text-sm font-bold text-gray-900 dark:text-gray-100">
                {props.invoice?.date ?? "—"}
              </p>
            </div>
          </div>

          {/* ── Amount Breakdown ── */}
          <div class="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {[
              { label: "Base Amount", value: props.invoice?.baseAmount ?? 0 },
              {
                label: `GST (${props.invoice?.gstLabel || "18%"})`,
                value: gst(),
              },
            ].map(({ label, value }) => (
              <div class="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <span class="text-sm text-gray-600 dark:text-gray-400">
                  {label}
                </span>
                <span class="text-sm font-semibold text-gray-800 dark:text-gray-200">
                  {fmt(value)}
                </span>
              </div>
            ))}
            <div class="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/60">
              <span class="text-sm font-bold text-gray-900 dark:text-gray-100">
                Total
              </span>
              <span class="text-base font-bold text-gray-900 dark:text-gray-100">
                {fmt(total())}
              </span>
            </div>
          </div>

          {/* ── Status ── */}
          <div class="flex items-center justify-between">
            <div class="space-y-1">
              <p class="text-sm font-semibold text-gray-600 dark:text-gray-400">
                Payment Status
              </p>
              <Tag
                variant={
                  props.invoice?.status === "succeeded"
                    ? "green"
                    : props.invoice?.status === "pending"
                      ? "amber"
                      : "red"
                }
              >
                {props.invoice?.status?.toUpperCase() ?? "—"}
              </Tag>
            </div>
            <button
              onClick={() => window.print()}
              class="flex items-center gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors"
            >
              <svg
                class="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Download Invoice
            </button>
          </div>

          {/* ── Primary CTA ── */}
          <button
            onClick={props.onClose}
            class="w-full py-3 rounded-2xl bg-gray-800 dark:bg-gray-100 text-white dark:text-gray-900 font-bold text-sm hover:opacity-85 transition-opacity"
          >
            Done
          </button>
        </Card>
      </div>
    </div>
  );
}

// --- Root Component -----------------------------------------------------------
export default function Billing() {
  const [tab, setTab] = createSignal("overview");
  const [showModal, setShowModal] = createSignal(false);
  const [selectedInvoice, setSelectedInvoice] = createSignal(null);
  const [showInvoiceModal, setShowInvoiceModal] = createSignal(false);
  const [paymentsData] = createResource(fetchPaymentsDetails);

  // Client type decides which cards and which statement rows render:
  //   hybrid   → everything (balance heroes, pacing, leads+CPL, full statement)
  //   retainer → spend + leads cards; statement without opening/closing rows
  //   cpl      → fixed CPL + plain spend + leads cards; statement without
  //              ad-spend/SC/GST sub-rows and without the closing row
  const { ishybrid, isRetainer, iscpl } = clientRole();

  const payments = createMemo(() => {
    const apiData = paymentsData()?.data || [];

    return apiData.map((item) => ({
      id: `PAY-${item.id}`,
      date: new Date(item.paid_at).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      amount: parseFloat(item.final_amount || 0),
      baseAmount: parseFloat(item.base_amount || 0),
      gstPct: item.gst_pct,
      gstLabel: item.gst_pct_label,
      gstAmount: parseFloat(item.gst_amount || 0),
      includingGst: parseFloat(item.including_gst || 0),
      method: item.method_label || item.method,
      status: item.status,
      statusLabel: item.status_label,
      gstFiled: false,
      invoiceUrl: "#",
      credit: false,
      creditedBy: null,
      creditDate: null,
    }));
  });

  // ── Month selection + single monthly overview fetch ──────────────────────
  const pad2 = (n) => String(n).padStart(2, "0");
  const nowDate = new Date();
  const defaultMonth = `${nowDate.getFullYear()}-${pad2(nowDate.getMonth() + 1)}`;
  const [selectedMonth, setSelectedMonth] = createSignal(defaultMonth);

  // Monthly overview — ONE API call, refetches on month change.
  const [overviewRes, { refetch }] = createResource(
    selectedMonth,
    fetchBillingOverview,
  );

  const data = () => overviewRes()?.data || {};
  // Only show months from launch (June 2026) up to the current month.
  const LAUNCH_KEY = "2026-06";
  const availableMonths = () => {
    const currentKey = defaultMonth; // "YYYY-MM" for today
    return (data().available_months || []).filter((m) => {
      const key = `${m.year}-${pad2(m.month)}`;
      return key >= LAUNCH_KEY && key <= currentKey;
    });
  };
  const currentPeriod = () => data().current_period || {};
  const openingBalance = () => data().opening_balance || {};
  const monthSpend = () => data().month_spend || {};
  const monthFunds = () => data().month_funds || {};
  const closingBalance = () => data().closing_balance || {};
  const budgetInfo = () => data().budget || {};

  const isLoading = () => overviewRes.loading;
  const loadError = () => overviewRes.error;

  // Service-charge / GST percentages come from the API (per-client, NOT
  // hardcoded). Hide the service-charge ledger row entirely when the rate is 0.
  const serviceChargePct = () => monthSpend().service_charge_pct ?? "0.00";
  const gstPct = () => monthSpend().gst_pct ?? "18.00";
  const showServiceCharge = () => Number(serviceChargePct()) > 0;

  // ── Derived figures for the redesigned Overview ───────────────────────────
  const adSpendExGst = () => Number(monthSpend().total_spend_ex_gst || 0);
  const billedIncGst = () =>
    Number(monthSpend().total_with_service_charge_and_gst || 0);
  const withServiceCharge = () =>
    Number(monthSpend().total_with_service_charge ?? adSpendExGst());
  const serviceChargeAmt = () =>
    Math.max(0, withServiceCharge() - adSpendExGst());
  const gstAmt = () => Math.max(0, billedIncGst() - withServiceCharge());
  const remainingBalance = () => Number(closingBalance().inc_gst || 0);
  const fundsAddedIncGst = () => Number(monthFunds().funds_added_inc_gst || 0);
  const totalLeads = () => monthSpend().total_leads ?? 0;
  const avgCpl = () => (totalLeads() > 0 ? adSpendExGst() / totalLeads() : 0);
  const utilizationPct = () => Number(budgetInfo().utilization_pct || 0);

  // CPL clients are billed on the plain ex-SC, ex-GST figure; everyone else on
  // the fully loaded amount. Used by both the spend card and the statement so
  // the two always agree.
  const billedForClient = () => (iscpl() ? adSpendExGst() : billedIncGst());

  // Month progress: where "today" falls within the selected month.
  const monthProgress = createMemo(() => {
    const [y, m] = selectedMonth().split("-").map(Number);
    const now = new Date();
    const daysInMonth = new Date(y, m, 0).getDate();
    const monthStart = new Date(y, m - 1, 1);
    let dayOfMonth;
    if (now.getFullYear() === y && now.getMonth() + 1 === m) {
      dayOfMonth = now.getDate(); // current month
    } else if (now > monthStart) {
      dayOfMonth = daysInMonth; // past month → fully elapsed
    } else {
      dayOfMonth = 0; // future month
    }
    const monthShort = monthStart.toLocaleDateString("en-IN", {
      month: "short",
    });
    return {
      dayOfMonth,
      daysInMonth,
      monthShort,
      pct: daysInMonth ? (dayOfMonth / daysInMonth) * 100 : 0,
    };
  });

  // Pacing flag: budget % used vs month % elapsed (±5pt band = on track).
  const pacing = createMemo(() => {
    const mp = monthProgress();
    if (mp.dayOfMonth === 0) return null;
    const used = utilizationPct();
    const elapsed = Math.round(mp.pct);
    if (!Number(budgetInfo().allocated || 0)) return null;
    if (used < elapsed - 5)
      return {
        text: `Pacing behind: ${elapsed}% of month elapsed, ${used}% of budget spent`,
        dotClass: "bg-amber-500 dark:bg-amber-400",
      };
    if (used > elapsed + 5)
      return {
        text: `Pacing ahead: ${elapsed}% of month elapsed, ${used}% of budget spent`,
        dotClass: "bg-red-500 dark:bg-red-400",
      };
    return {
      text: `On track: ${elapsed}% of month elapsed, ${used}% of budget spent`,
      dotClass: "bg-green-500 dark:bg-green-400",
    };
  });

  // Rough runway: remaining balance ÷ current daily burn (inc GST).
  const runwayDays = createMemo(() => {
    const mp = monthProgress();
    if (!mp.dayOfMonth || !billedIncGst()) return null;
    const dailyBurn = billedIncGst() / mp.dayOfMonth;
    if (dailyBurn <= 0) return null;
    return Math.floor(remainingBalance() / dailyBurn);
  });

  // Friendly subtitle for where the opening balance was carried from.
  const openingSourceLabel = () => {
    switch (openingBalance().source) {
      case "explicit_payment_row":
        return "carried over from previous month";
      case "computed_from_previous_month":
        return "computed from last month";
      case "zero_no_history":
        return "first month, no previous history";
      default:
        return "";
    }
  };

  const monthLabel = () => {
    const match = availableMonths().find(
      (m) => `${m.year}-${pad2(m.month)}` === selectedMonth(),
    );
    if (match) return match.label;
    const [y, m] = selectedMonth().split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
  };

  // Payments-tab totals — all-time, summed from the payments list (independent
  // of the monthly overview above).
  const totalReceived = createMemo(() =>
    payments().reduce((s, p) => s + (p.amount || 0), 0),
  );
  const totalReceivedExGST = createMemo(() =>
    payments().reduce((s, p) => s + (p.baseAmount || 0), 0),
  );

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "payments", label: "Payments & Invoices" },
  ];

  return (
    <div class="min-h-screen bg-white p-6 dark:bg-gray-900 text-gray-800 dark:text-gray-200 transition-all duration-300">
      <div class=" mx-auto">
        {/* Header — title + tabs on one baseline, like the reference */}
        <header class="flex flex-wrap items-baseline justify-between gap-3">
          <h1 class="text-2xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            Billing{" "}
            <span class="font-medium text-gray-500 dark:text-gray-400">
              · {monthLabel()}
            </span>
          </h1>
          <nav class="flex gap-6 text-sm font-medium">
            <For each={tabs}>
              {(t) => (
                <button
                  onClick={() => setTab(t.id)}
                  class={`pb-1.5 border-b-2 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-4 ${
                    tab() === t.id
                      ? "border-blue-900 dark:border-blue-400 text-gray-900 dark:text-gray-100"
                      : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  {t.label}
                </button>
              )}
            </For>
          </nav>
        </header>

        {/* ══ OVERVIEW TAB ══ */}
        <Show when={tab() === "overview"}>
          {/* Month bar: pills left, GST note right (note hidden for CPL — no
              GST/SC wording anywhere for that client type) */}
          <div class="mt-6 flex flex-wrap items-center gap-2">
            <For each={availableMonths()}>
              {(m) => {
                const value = `${m.year}-${pad2(m.month)}`;
                return (
                  <button
                    onClick={() => setSelectedMonth(value)}
                    class={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 focus-visible:outline-offset-2 ${
                      selectedMonth() === value
                        ? "bg-blue-900 dark:bg-blue-800 text-white border-blue-900 dark:border-blue-800 font-semibold"
                        : "border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:border-gray-400 dark:hover:border-gray-500"
                    }`}
                  >
                    {m.label}
                  </button>
                );
              }}
            </For>
            <Show when={!iscpl()}>
              <span class="ml-auto text-xs text-gray-400 dark:text-gray-500">
                Amounts are{" "}
                <b class="font-medium text-gray-500 dark:text-gray-400">
                  excluding GST ({Number(gstPct())}%)
                </b>{" "}
                unless marked
              </span>
            </Show>
          </div>

          {/* Error state */}
          <Show when={loadError()}>
            <div class="mt-5 flex items-center justify-between gap-3 text-sm font-medium bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 rounded-lg px-4 py-3">
              <span>Couldn't load billing data for this month.</span>
              <button onClick={() => refetch()} class="underline font-semibold">
                Retry
              </button>
            </div>
          </Show>

          <div
            class={`transition-all duration-500 ${isLoading() ? "animate-pulse" : ""}`}
          >
            {/* ════ HYBRID: 4 cards + full statement ════ */}
            <Show when={ishybrid()}>
              {/* Hero row: Remaining Balance + Total Spent */}
              <div class="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <HeroCard
                  accent
                  ariaLabel="Remaining balance"
                  label="Remaining Balance · inc GST"
                  value={fmt(remainingBalance())}
                  sub={
                    <>
                      After this month's billing
                      <Show when={runwayDays() !== null}>
                        {" "}
                        · covers roughly{" "}
                        <b class="font-semibold text-gray-900 dark:text-gray-100">
                          {runwayDays()} more days
                        </b>{" "}
                        at current daily spend
                      </Show>
                      <Show when={closingBalance().has_outstanding_dues}>
                        {" "}
                        <Tag variant="red">Outstanding Dues</Tag>
                      </Show>
                    </>
                  }
                />
                <HeroCard
                  ariaLabel="Total spent this month"
                  label={`Total Spent · ${monthProgress().monthShort} · inc GST & Service Charge`}
                  value={fmt(billedIncGst())}
                  sub={
                    <>
                      Ad spend{" "}
                      <b class="font-semibold text-gray-900 dark:text-gray-100">
                        {fmt(adSpendExGst())}
                      </b>{" "}
                      ex-GST · breakdown in statement below
                    </>
                  }
                />
              </div>

              {/* Pacing + Leads row */}
              <div class="mt-4 grid grid-cols-1 md:grid-cols-[1.8fr_1fr] gap-4">
                <PacingCard
                  utilized={budgetInfo().utilized}
                  allocated={budgetInfo().allocated}
                  utilizationPct={utilizationPct()}
                  elapsedPct={monthProgress().pct}
                  dayOfMonth={monthProgress().dayOfMonth}
                  daysInMonth={monthProgress().daysInMonth}
                  monthShort={monthProgress().monthShort}
                  pacing={pacing()}
                />
                <LeadsCard
                  stacked
                  leads={totalLeads()}
                  showCpl
                  cpl={avgCpl()}
                />
              </div>
            </Show>

            {/* ════ RETAINER: Total Spent + Total Leads only ════ */}
            <Show when={isRetainer()}>
              <div class="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <HeroCard
                  ariaLabel="Total spent this month"
                  label={`Total Spent · ${monthProgress().monthShort} · inc GST & Service Charge`}
                  value={fmt(billedIncGst())}
                  sub={
                    <>
                      Ad spend{" "}
                      <b class="font-semibold text-gray-900 dark:text-gray-100">
                        {fmt(adSpendExGst())}
                      </b>{" "}
                      ex-GST · breakdown in statement below
                    </>
                  }
                />
                <LeadsCard leads={totalLeads()} showCpl={false} />
              </div>
            </Show>

            {/* ════ CPL: Fixed CPL + plain Total Spent + Total Leads ════
                No SC/GST wording on any of these cards. */}
            <Show when={iscpl()}>
              <div class="mt-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                <HeroCard
                  accent
                  ariaLabel="Fixed cost per lead"
                  label="CPL As Given"
                  value={fmt(FIXED_CPL)}
                  sub="Contracted rate per lead"
                />
                <HeroCard
                  ariaLabel="Total spent this month"
                  label={`Total Spent · ${monthProgress().monthShort}`}
                  value={fmt(adSpendExGst())}
                  sub="Details in statement below"
                />
                <LeadsCard leads={totalLeads()} showCpl={false} />
              </div>
            </Show>

            {/* ── Account statement ledger (rows vary by client type) ── */}
            <Card
              class="mt-4 overflow-hidden"
              aria-label={`Account statement for ${monthLabel()}`}
            >
              <div class="px-6 pt-5 pb-1">
                <Eyebrow>Account Statement · {monthLabel()}</Eyebrow>
              </div>

              {/* Opening balance — hidden for retainer */}
              <Show when={!isRetainer()}>
                <LedgerRow
                  noBorder
                  name="Opening balance"
                  tag={
                    iscpl()
                      ? openingSourceLabel()
                      : `inc GST${openingSourceLabel() ? ` · ${openingSourceLabel()}` : ""}`
                  }
                  value={fmt(openingBalance().inc_gst)}
                />
              </Show>

              <LedgerRow
                noBorder={isRetainer()}
                op="+"
                name="Funds added this month"
                value={fmt(fundsAddedIncGst())}
                tone={fundsAddedIncGst() === 0 ? "zero" : "pos"}
              />

              {/* CPL clients see the plain ex-SC/ex-GST figure with no GST tag,
                  so the card above and this row always match. */}
              <LedgerRow
                op="−"
                name="Billed this month"
                tag={iscpl() ? "" : "inc GST"}
                value={fmt(billedForClient())}
                tone="neg"
              />

              {/* Sub-rows — hidden entirely for CPL */}
              <Show when={!iscpl()}>
                <LedgerRow sub name="Ad spend" value={fmt(adSpendExGst())} />
                <Show when={showServiceCharge()}>
                  <LedgerRow
                    sub
                    name={`Service charge · ${Number(serviceChargePct())}%`}
                    value={fmt(serviceChargeAmt())}
                  />
                </Show>
                <LedgerRow
                  sub
                  name={`GST · ${Number(gstPct())}%`}
                  value={fmt(gstAmt())}
                />
              </Show>

              {/* Closing/remaining row — hybrid only */}
              <Show when={ishybrid()}>
                <LedgerRow
                  total
                  name="Remaining balance"
                  tag="inc GST · end of month position"
                  value={fmt(remainingBalance())}
                />
              </Show>
            </Card>
          </div>
        </Show>

        {/* ══ PAYMENTS TAB ══ */}
        <Show when={tab() === "payments"}>
          <div class="space-y-5 mt-6">
            <div class="flex items-center justify-between">
              <SectionLabel>Payment & Invoice Tracking</SectionLabel>
              <span class="text-sm text-gray-400">
                Managed by Accounts Team
              </span>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Card class="p-4">
                <p class="text-md text-gray-600 dark:text-gray-400">
                  Total Received (with GST)
                </p>
                <p class="text-xl font-bold mt-2 text-gray-900 dark:text-white">
                  {fmt(totalReceived())}
                </p>
              </Card>
              <Card class="p-4">
                <p class="text-md text-gray-600 dark:text-gray-400">
                  Total Received (ex-GST)
                </p>
                <p class="text-xl font-bold mt-2 text-gray-900 dark:text-white">
                  {fmt(totalReceivedExGST())}
                </p>
              </Card>
              <Card class="p-4">
                <p class="text-md text-gray-600 dark:text-gray-400">
                  Total Utilized
                </p>
                <p class="text-xl font-bold mt-2 text-gray-900 dark:text-gray-100">
                  0
                </p>
              </Card>
              <Card class="p-4">
                <p class="text-md text-gray-600 dark:text-gray-400">
                  Remaining Balance
                </p>
                <p class="text-xl font-bold mt-2 text-green-600 dark:text-green-400">
                  0
                </p>
              </Card>
              <Card class="p-4">
                <p class="text-md text-gray-600 dark:text-gray-400">
                  Pending Payment
                </p>
                <p class="text-xl font-bold mt-2 text-gray-900 dark:text-gray-100">
                  0
                </p>
              </Card>
            </div>
            <Show
              when={!paymentsData.loading}
              fallback={
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  Loading payments...
                </p>
              }
            >
              <PaymentHistory
                payments={payments()}
                onViewInvoice={(payment) => {
                  setSelectedInvoice(payment);
                  setShowInvoiceModal(true);
                }}
              />
            </Show>
          </div>
        </Show>

        <AddFundsModal open={showModal()} onClose={() => setShowModal(false)} />
        <InvoiceModal
          open={showInvoiceModal()}
          invoice={selectedInvoice()}
          onClose={() => setShowInvoiceModal(false)}
        />
      </div>
    </div>
  );
}