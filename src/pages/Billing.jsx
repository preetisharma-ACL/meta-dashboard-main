import { createSignal, createMemo, createResource, For, Show } from "solid-js";
import { fetchBillingOverview } from "../services/billing-service";
import { fetchPaymentsDetails } from "../services/payments-service";
import useRole, { clientRole } from "../hooks/useRole";
import LeadBreakdown from "../components/leads/LeadBreakdown";
import { readLeadBreakdown, showsReplacement } from "../services/leadReplacement";

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
// Plain number format (no ₹) for points-based amounts
const numFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const fmtPoints = (n) => numFormatter.format(Number(n ?? 0));
const isPointsMethod = (m) =>
  String(m || "")
    .toLowerCase()
    .includes("point");
// Wallet-method rows represent the auto-carried opening balance, not real money
// received this period — kept in Payment History but excluded from "Total Received".
const isWalletMethod = (m) =>
  String(m || "")
    .toLowerCase()
    .includes("wallet");

// Classify a payment-history row so the client can tell at a glance what each
// entry is: a carried-over opening balance, a points credit, or real funds.
// `iconClass` colour-codes the leading avatar to match the category tag.
const paymentCategory = (pay) => {
  if (pay.isWallet || pay.isOpeningBalance)
    return {
      label: "Opening Balance",
      variant: "gray",
      icon: "↻",
      iconClass:
        "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 ring-1 ring-inset ring-gray-200 dark:ring-gray-700",
    };
  if (pay.isPoints)
    return {
      label: "Points Added",
      variant: "blue",
      icon: "★",
      iconClass:
        "bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 ring-1 ring-inset ring-blue-200 dark:ring-blue-900",
    };
  return {
    label: "Funds Added",
    variant: "green",
    icon: "✓",
    iconClass:
      "bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-400 ring-1 ring-inset ring-green-200 dark:ring-green-900",
  };
};

// Status shown as a quiet dot + label in the meta line (keeps the category tag
// as the single prominent pill).
const statusDotClass = (status) =>
  status === "succeeded"
    ? "bg-green-500 dark:bg-green-400"
    : status === "pending"
      ? "bg-amber-500 dark:bg-amber-400"
      : "bg-red-500 dark:bg-red-400";

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
          {/* Reconciles this card with the Generated → Replaced → Billable
              strip below: the headline stays the leads generated, the caption
              says what is actually billed. */}
          <Show when={props.breakdown?.replaced > 0}>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {Number(props.breakdown.billable ?? 0).toLocaleString("en-IN")}{" "}
              billable · {Number(props.breakdown.replaced).toLocaleString("en-IN")}{" "}
              replaced
            </p>
          </Show>
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
            {(pay) => {
              const cat = paymentCategory(pay);
              return (
                <div class="group rounded-xl border border-gray-200 dark:border-gray-800 bg-white/60 dark:bg-gray-800/20 p-4 transition-colors hover:border-gray-300 dark:hover:border-gray-700 hover:bg-white dark:hover:bg-gray-800/40">
                  <div class="flex items-start justify-between gap-3 flex-wrap">
                    <div class="flex items-center gap-3.5">
                      <div
                        class={`w-10 h-10 rounded-full flex items-center justify-center text-base flex-shrink-0 ${
                          pay.credit
                            ? "bg-gray-100 dark:bg-gray-800 text-gray-500"
                            : cat.iconClass
                        }`}
                      >
                        {pay.credit ? "📋" : cat.icon}
                      </div>

                      <div class="min-w-0">
                        <div class="flex items-center gap-2 flex-wrap">
                          <span class="text-lg font-bold tracking-tight tabular-nums text-gray-900 dark:text-gray-100">
                            {pay.isPoints
                              ? `${fmtPoints(pay.amount)} pts`
                              : fmt(pay.amount)}
                          </span>

                          <Show
                            when={pay.credit}
                            fallback={
                              <Tag variant={cat.variant}>{cat.label}</Tag>
                            }
                          >
                            <Tag variant="gray">
                              CREDITED by {pay.creditedBy}
                            </Tag>
                          </Show>

                          <Show when={pay.gstFiled}>
                            <Tag variant="blue">GST Filed</Tag>
                          </Show>
                        </div>

                        <div class="mt-1 flex items-center gap-2 flex-wrap text-sm text-gray-500 dark:text-gray-400">
                          <span>
                            {pay.credit
                              ? `Credited on ${pay.creditDate} by ${pay.creditedBy}`
                              : `${pay.date} · via ${pay.method} · ${pay.id}`}
                          </span>
                          <Show when={!pay.credit}>
                            <span class="text-gray-300 dark:text-gray-600">
                              ·
                            </span>
                            <span class="inline-flex items-center gap-1.5">
                              <span
                                class={`h-1.5 w-1.5 rounded-full ${statusDotClass(pay.status)}`}
                              />
                              <span class="font-medium text-gray-600 dark:text-gray-300">
                                {pay.statusLabel ||
                                  (pay.status
                                    ? pay.status.charAt(0).toUpperCase() +
                                      pay.status.slice(1)
                                    : "—")}
                              </span>
                            </span>
                          </Show>
                        </div>
                      </div>
                    </div>

                    <Show when={!pay.credit}>
                      <button
                        onClick={() => props.onViewInvoice(pay)}
                        class="flex items-center gap-1.5 text-sm font-semibold text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 transition-colors group-hover:border-gray-300 dark:group-hover:border-gray-600"
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
                        Receipt
                      </button>
                    </Show>
                  </div>
                </div>
              );
            }}
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
                Receipt
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
              Download Receipt
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

// --- Overview: CPL per-project charges -----------------------------------------
// CPL clients are billed per PROJECT at a contracted rate per qualified lead
// (qualified = generated − replaced − disqualified), and one client can run
// several projects on different rates — so a single headline rate is
// meaningless. This table is the CPL equivalent of the hybrid statement's
// ad-spend/SC/GST sub-rows: it shows where the month's charge comes from.
// Rows come straight from month_spend.cpl_projects (empty for hybrid/retainer).
function CplProjectTable(props) {
  const rows = () => props.projects || [];
  const num = (n) => Number(n || 0).toLocaleString("en-IN");

  // "No contracted rate set" is a statement about the agency's own setup, so
  // whether the viewer is told it is the server's call, not ours. It stopped
  // sending the signal to clients — admin and CM still get missing_rate on the
  // row and the month_spend.missing_cpl_rate list, and still get both when
  // previewing a client with as_client_id, because they are the ones who act
  // on it.
  //
  // For a client the key is now ABSENT rather than false — deliberately, the
  // same way raw spend is absent on the ledger — so this tests === true and
  // never defaults it. An absent key is not a confident "the rate IS set"
  // either; it means the question isn't ours to answer, so nothing about it
  // is rendered. Nothing here may infer the state from a null rate: a null
  // fixed_cpl is an absent number and says only that.
  const missingRate = (p) => p.missing_rate === true;

  const missingCount = () =>
    Math.max(props.missing?.length || 0, rows().filter(missingRate).length);
  const totalQualified = () =>
    rows().reduce((s, p) => s + Number(p.qualified || 0), 0);

  // A null charge is "not billed yet", not zero — it contributes nothing, and
  // a table where every row is null totals to "—" rather than ₹0.00, which
  // would read as "free". charge was always a string before and is now
  // sometimes null, so it never reaches Number()/fmt() unchecked.
  const billedCharges = () => rows().map((p) => p.charge).filter((c) => c != null);
  const totalCharge = () => billedCharges().reduce((s, c) => s + Number(c || 0), 0);

  const Dash = () => (
    <span class="font-medium text-gray-400 dark:text-gray-500">—</span>
  );

  const numCell =
    "px-3 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400";
  const numHead = "px-3 py-2.5 text-right font-medium";

  return (
    <Card
      class="mt-4 overflow-hidden"
      aria-label={`Project charges for ${props.monthLabel}`}
    >
      <div class="px-6 pt-5 pb-3">
        <Eyebrow>Project Charges · {props.monthLabel}</Eyebrow>
        <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Each project is billed at its own contracted rate per qualified lead ·
          qualified = generated − replaced − disqualified
        </p>
      </div>

      <Show when={missingCount() > 0}>
        <div class="mx-6 mb-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-sm font-medium text-amber-700 dark:text-amber-300">
          Some projects don't have a contracted rate set and aren't being
          billed. Contact admin.
        </div>
      </Show>

      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-y border-gray-200 dark:border-gray-700 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
              <th class="px-6 py-2.5 text-left font-medium">Project</th>
              <th class={`hidden sm:table-cell ${numHead}`}>Generated</th>
              <th class={`hidden sm:table-cell ${numHead}`}>Replaced</th>
              <th class={`hidden md:table-cell ${numHead}`}>Disqualified</th>
              <th class={numHead}>Qualified</th>
              <th class={numHead}>Rate / lead</th>
              <th class="px-6 py-2.5 text-right font-medium">Charge</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()}>
              {(p) => (
                <tr class="border-b border-gray-100 dark:border-gray-700/60">
                  <td class="px-6 py-3 font-medium text-gray-900 dark:text-gray-100">
                    {p.project_name}
                  </td>
                  <td class={`hidden sm:table-cell ${numCell}`}>
                    {num(p.generated)}
                  </td>
                  <td class={`hidden sm:table-cell ${numCell}`}>
                    {num(p.replaced)}
                  </td>
                  <td class={`hidden md:table-cell ${numCell}`}>
                    {num(p.disqualified)}
                  </td>
                  <td class="px-3 py-3 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">
                    {num(p.qualified)}
                  </td>
                  <td class="px-3 py-3 text-right tabular-nums">
                    {/* Only the server's flag produces "rate not set". A null
                        rate on its own renders "—" and nothing else. */}
                    <Show
                      when={missingRate(p)}
                      fallback={
                        <Show when={p.fixed_cpl != null} fallback={<Dash />}>
                          <span class="text-gray-600 dark:text-gray-300">
                            {fmt(p.fixed_cpl)}
                          </span>
                        </Show>
                      }
                    >
                      <span class="text-amber-600 dark:text-amber-400">
                        — rate not set
                      </span>
                    </Show>
                  </td>
                  <td class="px-6 py-3 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">
                    {/* Keyed off the charge itself: null is not billed yet,
                        which is "—" rather than ₹0.00 ("free"). */}
                    <Show
                      when={!missingRate(p) && p.charge != null}
                      fallback={<Dash />}
                    >
                      {fmt(p.charge)}
                    </Show>
                  </td>
                </tr>
              )}
            </For>
            <tr class="border-t border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/30">
              <td class="px-6 py-3 font-bold text-gray-900 dark:text-gray-100">
                Total
              </td>
              <td class="hidden sm:table-cell" />
              <td class="hidden sm:table-cell" />
              <td class="hidden md:table-cell" />
              <td class="px-3 py-3 text-right tabular-nums font-bold text-gray-900 dark:text-gray-100">
                {num(totalQualified())}
              </td>
              <td />
              <td class="px-6 py-3 text-right tabular-nums font-bold text-gray-900 dark:text-gray-100">
                <Show when={billedCharges().length > 0} fallback={<Dash />}>
                  {fmt(totalCharge())}
                </Show>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Card>
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
      paidAt: item.paid_at, // raw date, needed for monthly points filter
      isPoints:
        isPointsMethod(item.method) || isPointsMethod(item.method_label),
      isWallet:
        isWalletMethod(item.method) || isWalletMethod(item.method_label),
      // Explicit backend flag: an opening-balance carry-in, not money received
      // this period — badged as such and excluded from "Total Received".
      isOpeningBalance: !!item.is_opening_balance,
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

  // Points credited within the selected month, from the payments list
  const pointsAddedThisMonth = createMemo(() => {
    const [y, m] = selectedMonth().split("-").map(Number);
    return payments()
      .filter((p) => {
        if (!p.isPoints || !p.paidAt) return false;
        if (p.status && p.status !== "succeeded") return false;
        const d = new Date(p.paidAt);
        return d.getFullYear() === y && d.getMonth() + 1 === m;
      })
      .reduce((s, p) => s + (p.amount || 0), 0);
  });

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
    ishybrid()
      ? Number(monthSpend().total_with_service_charge_and_gst || 0)
      : Number(monthSpend().total_spend_ex_gst || 0);

  const billedForClient = () => billedIncGst();
  const withServiceCharge = () =>
    Number(monthSpend().total_with_service_charge ?? adSpendExGst());
  const serviceChargeAmt = () =>
    Math.max(0, withServiceCharge() - adSpendExGst());
  const gstAmt = () =>
    Math.max(
      0,
      Number(monthSpend().total_with_service_charge_and_gst || 0) -
        withServiceCharge(),
    );
  const remainingBalance = () => Number(closingBalance().inc_gst || 0);
  // API's funds_added_inc_gst currently includes points-method payments;
  // strip them out so points only appear in their own ledger row.
  const fundsAddedIncGst = () =>
    Math.max(
      0,
      Number(monthFunds().funds_added_inc_gst || 0) - pointsAddedThisMonth(),
    );
  const totalLeads = () => monthSpend().total_leads ?? 0;
  const avgCpl = () => (totalLeads() > 0 ? adSpendExGst() / totalLeads() : 0);
  const utilizationPct = () => Number(budgetInfo().utilization_pct || 0);

  // ── Lead replacement breakdown ────────────────────────────────────────────
  // month_spend carries generated_leads / replaced_leads / billable_leads for
  // CPL and hybrid clients. The billed figures above ALREADY reflect the credit
  // (the API reduces total_spend_ex_gst), so nothing here is subtracted a second
  // time — this block only explains where the reduction came from. Retainer
  // clients have no replacement concept and the fields are absent, so
  // showsReplacement() keeps the whole section off their page.
  const leadBreakdown = createMemo(() => readLeadBreakdown(monthSpend()));

  // ── CPL per-project charges ───────────────────────────────────────────────
  // Only CPL clients get cpl_projects (one row per project with its own
  // contracted rate); the array is absent/empty for hybrid and retainer.
  const cplProjects = () => monthSpend().cpl_projects || [];
  const missingCplRate = () => monthSpend().missing_cpl_rate || [];
  const clientTypeKey = () =>
    iscpl() ? "cpl" : ishybrid() ? "hybrid" : isRetainer() ? "retainer" : "";
  const showBreakdown = () =>
    showsReplacement(leadBreakdown(), clientTypeKey());

  // CPL clients are billed on the plain ex-SC, ex-GST figure; everyone else on
  // the fully loaded amount. Used by both the spend card and the statement so
  // the two always agree.

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
  // Total Received = genuine receipts only. Wallet rows are the auto-carried
  // opening balance, so they're summed into neither total. Non-succeeded rows
  // (refunded, failed, pending) never count — the money isn't with us.
  const countsAsReceived = (p) =>
    !p.isWallet && !p.isOpeningBalance && (!p.status || p.status === "succeeded");
  const totalReceived = createMemo(() =>
    payments()
      .filter(countsAsReceived)
      .reduce((s, p) => s + (p.amount || 0), 0),
  );
  const totalReceivedExGST = createMemo(() =>
    payments()
      .filter(countsAsReceived)
      .reduce((s, p) => s + (p.baseAmount || 0), 0),
  );

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "payments", label: "Payments & Receipts" },
  ];

  // ── Retainer billing: client pays only the service charge + GST on it ─────
  // Service charge comes strictly from the API — service_charge_amount when
  // present, else service_charge_pct × ad spend. No hardcoded default.
  const retainerScPct = () => Number(serviceChargePct()) || 0;

  const retainerScAmount = () => {
    const apiAmt = Number(monthSpend().service_charge_amount);
    if (apiAmt > 0) return apiAmt;
    return (adSpendExGst() * retainerScPct()) / 100;
  };

  const retainerScGst = () => (retainerScAmount() * Number(gstPct())) / 100;

  const retainerPayable = () => retainerScAmount() + retainerScGst();

  // All-time points credited, from the payments list
  const totalPointsReceived = createMemo(() =>
    payments()
      .filter((p) => p.isPoints && (!p.status || p.status === "succeeded"))
      .reduce((s, p) => s + (p.amount || 0), 0),
  );

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
          <nav class="flex gap-6 text-md font-medium">
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
            {/* <Show when={!iscpl()}>
              <span class="ml-auto text-xs text-gray-400 dark:text-gray-500">
                Amounts are{" "}
                <b class="font-medium text-gray-500 dark:text-gray-400">
                  excluding GST ({Number(gstPct())}%)
                </b>{" "}
                unless marked
              </span>
            </Show> */}
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
                  breakdown={showBreakdown() ? leadBreakdown() : null}
                />
              </div>
            </Show>

            {/* ════ RETAINER: Total Spent + Total Leads only ════ */}
            <Show when={isRetainer()}>
              <div class="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <HeroCard
                  ariaLabel="Total spent this month"
                  label={`Total Spent · ${monthProgress().monthShort} · ex GST & Service Charge`}
                  value={fmt(billedIncGst())}
                />
                <LeadsCard leads={totalLeads()} showCpl={false} />
              </div>
            </Show>

            {/* ════ CPL: plain Total Spent + Total Leads ════
                No single "CPL As Given" rate here — a CPL client can run
                several projects on different rates, so the rates live in the
                per-project table below. No SC/GST wording on these cards. */}
            <Show when={iscpl()}>
              <div class="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <Show when={!iscpl()}>
                  <HeroCard
                    ariaLabel="Total spent this month"
                    label={`Total Spent · ${monthProgress().monthShort}`}
                    value={fmt(adSpendExGst())}
                    sub="Details in statement below"
                  />
                </Show>
                <LeadsCard
                  leads={totalLeads()}
                  showCpl={false}
                  breakdown={showBreakdown() ? leadBreakdown() : null}
                />
              </div>
            </Show>

            {/* ── Lead replacement · Generated → Replaced → Billable ──
                CPL/hybrid only (retainer has no replacement concept). The
                statement below is already net of the credit. */}
            <Show when={showBreakdown()}>
              <LeadBreakdown
                class="mt-4"
                title={`Leads · ${monthLabel()}`}
                breakdown={leadBreakdown()}
                note="Replaced leads are credited back — the amounts in the statement below are already net of that credit."
              />
            </Show>

            {/* ── CPL only: what each project charged this month ──
                Replaces the old single "CPL As Given" card: rates are
                per-project, so the charge is only meaningful per project. */}
            <Show when={iscpl() && cplProjects().length > 0}>
              <CplProjectTable
                projects={cplProjects()}
                missing={missingCplRate()}
                monthLabel={monthLabel()}
              />
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
              <Show when={!iscpl()}>
                <LedgerRow
                  op="−"
                  name={ishybrid() ? "Billed This Month" : "Total Spend"}
                  tag={
                    ishybrid()
                      ? "inc GST & Service Charge"
                      : iscpl()
                        ? ""
                        : "ex GST"
                  }
                  value={fmt(billedForClient())}
                  tone="neg"
                />
              </Show>

              <LedgerRow
                op="+"
                name="Points Added This Month"
                tag="via Points"
                value={fmtPoints(pointsAddedThisMonth())}
                tone={pointsAddedThisMonth() === 0 ? "zero" : "pos"}
              />

              {/* Sub-rows — hidden entirely for CPL or retainer */}
              <Show when={ishybrid()}>
                <LedgerRow sub name="Ad spend" value={fmt(adSpendExGst())} />
                <Show when={showServiceCharge() || isRetainer()}>
                  <LedgerRow
                    sub
                    name={`Service charge${Number(serviceChargePct()) > 0 ? ` · ${Number(serviceChargePct())}%` : ""}`}
                    value={fmt(serviceChargeAmt())}
                  />
                </Show>
                <LedgerRow
                  sub
                  name={`GST · ${Number(gstPct())}%`}
                  value={fmt(gstAmt())}
                />
              </Show>

              {/* ── Retainer payable: service charge + GST on the charge ── */}
              <Show when={isRetainer()}>
                <LedgerRow
                  name="Service charge"
                  tag={retainerScPct() > 0 ? `${retainerScPct()}% ` : ""}
                  value={fmt(retainerScAmount())}
                />
                <LedgerRow
                  name={`GST · ${Number(gstPct())}%`}
                  value={fmt(retainerScGst())}
                />
                <LedgerRow
                  total
                  name="Payable amount"
                  value={fmt(retainerPayable())}
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
              <SectionLabel>Payment & Receipts Tracking</SectionLabel>
              <span class="text-sm text-gray-400">
                Managed by Accounts Team
              </span>
            </div>
            <div class="relative overflow-hidden rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white/70 dark:bg-gray-800/70 backdrop-blur-xl shadow-sm flex flex-col md:flex-row md:items-stretch">
              {/* ── Total Received ── */}
              <div class="flex-1 p-6">
                <p class="text-sm text-gray-600 dark:text-gray-300">
                  Total Received
                </p>

                <p class="mt-2 text-2xl font-bold tracking-tight tabular-nums text-gray-900 dark:text-gray-100">
                  {fmt(totalReceived())}
                  <span class="ml-2 align-middle text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    inc GST
                  </span>
                </p>

                <p class="mt-1 text-md font-semibold tabular-nums text-gray-600 dark:text-gray-400">
                  {fmt(totalReceivedExGST())}
                  <span class="ml-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                    ex GST
                  </span>
                </p>

                {/* Points note as a quiet pill */}
                {/* Points note — only when points have actually been credited */}
                <Show when={totalPointsReceived() > 0}>
                  <div class="mt-4 inline-flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40 px-3 py-1">
                    <span class="h-1.5 w-1.5 rounded-full bg-blue-900 dark:bg-blue-400" />
                    <span class="text-xs text-gray-500 dark:text-gray-400">
                      Points included ·{" "}
                      <b class="font-semibold text-gray-700 dark:text-gray-300">
                        {fmtPoints(totalPointsReceived())} pts · 1 pt = ₹1
                      </b>
                    </span>
                  </div>
                </Show>
              </div>

              {/* ── Remaining balance — hybrid clients only ── */}
              <Show when={ishybrid()}>
                {/* Divider: horizontal on mobile, vertical on desktop */}
                <div class="h-px w-full md:h-auto md:w-px bg-gray-200 dark:bg-gray-700" />

                <div class="flex-1 p-6 bg-gradient-to-b from-green-50/80 to-white dark:from-green-950/30 dark:to-gray-800/70">
                  <p class="text-sm text-gray-600 dark:text-gray-300">
                    Remaining Balance
                  </p>
                  <p class="mt-2 text-3xl font-bold tracking-tight tabular-nums text-green-900 dark:text-green-400">
                    {fmt(remainingBalance())}
                  </p>
                  <p class="mt-1.5 inline-flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                    <span class="h-1.5 w-1.5 rounded-full bg-green-900 dark:bg-green-400" />
                    Available to use · inc GST
                  </p>
                </div>
              </Show>
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
