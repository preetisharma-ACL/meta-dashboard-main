import {
  createSignal,
  createMemo,
  createEffect,
  createResource,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { useDialog } from "../../utils/useDialog";
import { errorMessage } from "../../utils/apiErrors";
import {
  fetchPayQuote,
  startPayment,
  tdsChoices,
  payMethodsNote,
  payMethodLabels,
  payNum,
  wholeRupees,
  fmtRs,
} from "../../services/hdfcPay";

// ─── Pay now (client) ─────────────────────────────────────────────────────────
// The client's own card / UPI payment, through the HDFC gateway. Opened from the
// Billing page, which only offers the button once GET pay/summary/ has answered
// enabled: true.
//
// EVERY FIGURE ON SCREEN IS THE SERVER'S. The amount box is the only input; the
// breakdown under it comes from GET pay/quote/ and is never computed here. That
// is the whole point of the quote endpoint: a locally multiplied "You pay" that
// disagreed with the gateway by a rupee would be a client approving one number
// and being charged another. While a quote is in flight the previous breakdown
// stays on screen, dimmed, rather than collapsing to zeroes.
//
// Props: open, onClose(), summary (the pay/summary/ payload)

const FIELD =
  "w-full pl-8 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 " +
  "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-lg " +
  "focus:outline-none focus:ring-2 focus:ring-blue-900/30 dark:focus:ring-blue-400/30 " +
  "placeholder-gray-300 dark:placeholder-gray-600 transition";

const QUOTE_DEBOUNCE_MS = 300;

export default function PayNowModal(props) {
  const summary = () => props.summary ?? {};

  const minExGst = () => payNum(summary().min_ex_gst);
  const duesExGst = () => payNum(summary().dues_ex_gst);
  const choices = createMemo(() => tdsChoices(summary()));

  const [amount, setAmount] = createSignal("");
  const [deductTds, setDeductTds] = createSignal(false);
  // The percentage behind the checkbox. Null until the choices load; the first
  // non-zero option the server offers becomes the selection when the box is
  // ticked. It is never silent: the breakdown prints a "TDS deducted" row and
  // the payable figure moves, both before anything is charged.
  const [tdsPct, setTdsPct] = createSignal(null);
  const [starting, setStarting] = createSignal(false);
  const [startError, setStartError] = createSignal(null);

  // Prefill the amount with the minimum each time the modal opens, and clear
  // whatever the last attempt left behind.
  createEffect(() => {
    if (!props.open) return;
    const min = minExGst();
    setAmount(min === null ? "" : String(Math.ceil(min)));
    setDeductTds(false);
    setTdsPct(null);
    setStartError(null);
    setStarting(false);
  });

  // Ticking the box selects the LOWEST percentage the server offers; unticking
  // it returns to 0. No invented value: with no options the box cannot be
  // ticked at all.
  const toggleTds = (on) => {
    setDeductTds(on);
    setTdsPct(on ? (choices()[0] ?? null) : null);
  };

  const effectiveTds = () => (deductTds() ? (tdsPct() ?? 0) : 0);

  const amountValue = () => wholeRupees(amount());

  // ── Live breakdown ────────────────────────────────────────────────────────
  // Debounced 300 ms on the amount, immediate on a TDS change (a radio click is
  // a deliberate act, not typing). The resource is keyed on the debounced pair,
  // so a half-typed "5" never reaches the server.
  const [quoteKey, setQuoteKey] = createSignal(null);
  let debounceTimer;

  createEffect(() => {
    const amt = amountValue();
    const tds = effectiveTds();
    const open = props.open;
    clearTimeout(debounceTimer);
    if (!open || amt === null) {
      setQuoteKey(null);
      return;
    }
    debounceTimer = setTimeout(
      () => setQuoteKey({ amount: amt, tds }),
      QUOTE_DEBOUNCE_MS,
    );
  });

  onCleanup(() => clearTimeout(debounceTimer));

  const [quoteRes] = createResource(quoteKey, ({ amount: amt, tds }) =>
    fetchPayQuote(amt, tds),
  );

  // Reading an errored resource throws, so every read goes through these two.
  const quote = () => (quoteRes.error ? null : quoteRes()) ?? null;
  // The server's own words, which is where "below the minimum" comes from.
  const quoteError = () => (quoteRes.error ? errorMessage(quoteRes.error) : null);

  // The last good breakdown, kept so a refetch dims the rows instead of
  // emptying them. Cleared whenever the quote itself fails, because stale
  // figures next to a live error message would be the wrong number shown
  // confidently.
  const [lastQuote, setLastQuote] = createSignal(null);
  createEffect(() => {
    if (quoteRes.error) {
      setLastQuote(null);
      return;
    }
    const q = quote();
    if (q) setLastQuote(q);
  });

  const shown = () => quote() ?? lastQuote();
  const stale = () => quoteRes.loading && !!lastQuote();

  const gstPctLabel = () => {
    const pct = payNum(shown()?.gst_pct ?? summary().gst_pct);
    return pct === null ? "GST" : `GST ${pct}%`;
  };

  const tdsAmount = () => payNum(shown()?.tds_amount);
  const showTdsRow = () => tdsAmount() !== null && tdsAmount() > 0;

  const payable = () => payNum(shown()?.amount_payable);

  // The button needs a whole-rupee amount, a server-approved payable figure and
  // no error in between. Anything less and the gateway would be handed a number
  // nobody has agreed on.
  const canPay = () =>
    !starting() &&
    amountValue() !== null &&
    payable() !== null &&
    !quoteError() &&
    !quoteRes.loading;

  const pay = async () => {
    const amt = amountValue();
    if (amt === null) return;
    setStarting(true);
    setStartError(null);
    try {
      const res = await startPayment({
        amountExGst: amt,
        tdsPct: effectiveTds(),
      });
      const url = res?.payment_url;
      if (!url) throw new Error("The payment page address was not returned.");
      // Leaving the app on purpose: the gateway owns the next screen and brings
      // the browser back to /payment-result when it is done.
      window.location.href = url;
    } catch (err) {
      setStartError(errorMessage(err, "Could not start the payment."));
      setStarting(false);
    }
  };

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget && !starting()) props.onClose();
  };

  let dialogBox;
  useDialog(
    () => props.open,
    () => {
      if (!starting()) props.onClose();
    },
    () => dialogBox,
  );

  return (
    <div
      class={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-all duration-200 ${
        props.open
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      }`}
      style={{ background: "rgba(0,0,0,0.45)", "backdrop-filter": "blur(4px)" }}
      onClick={handleBackdrop}
      inert={props.open ? undefined : true}
      aria-hidden={props.open ? undefined : "true"}
    >
      <div
        ref={dialogBox}
        role="dialog"
        aria-modal="true"
        aria-label="Pay now"
        class={`w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl transition-all duration-200 ${
          props.open ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
        }`}
      >
        <div class="p-6 space-y-5">
          {/* ── Header ── */}
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100">
                Pay now
              </h3>
              <p class="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                Secure payment through HDFC Bank
              </p>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              disabled={starting()}
              aria-label="Close"
              class="w-8 h-8 shrink-0 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {/* ── Pending dues ──
              Only when there is something outstanding. A "Pending dues: ₹0"
              line on a client who owes nothing reads as a bill. */}
          <Show when={duesExGst() !== null && duesExGst() > 0}>
            <div class="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-4 py-3">
              <p class="text-sm font-semibold text-amber-800 dark:text-amber-200">
                Pending dues: {fmtRs(duesExGst(), 2)}
                <span class="ml-1.5 font-medium text-amber-700/80 dark:text-amber-300/80">
                  (ex GST)
                </span>
              </p>
            </div>
          </Show>

          {/* ── Amount ── */}
          <div class="space-y-1.5">
            <label
              for="pay-amount"
              class="block text-sm font-semibold text-gray-700 dark:text-gray-300"
            >
              Amount (ex GST)
            </label>
            <div class="relative">
              <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold select-none">
                ₹
              </span>
              <input
                id="pay-amount"
                data-autofocus
                type="text"
                inputMode="numeric"
                autocomplete="off"
                placeholder="0"
                value={amount()}
                disabled={starting()}
                // Whole rupees only: the paise are the gateway's business, and
                // a decimal typed here would be quoted on and then rounded
                // somewhere the client cannot see.
                onInput={(e) => {
                  const cleaned = e.currentTarget.value.replace(/[^\d]/g, "");
                  e.currentTarget.value = cleaned;
                  setAmount(cleaned);
                }}
                class={FIELD}
              />
            </div>
            <Show when={minExGst() !== null}>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                Minimum ₹
                {Math.ceil(minExGst()).toLocaleString("en-IN")} + GST
              </p>
            </Show>
          </div>

          {/* ── TDS ──
              Hidden entirely when the server offers no percentages: a checkbox
              that reveals an empty choice is a dead control. */}
          <Show when={choices().length > 0}>
            <div class="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 space-y-3">
              <label class="flex items-center gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deductTds()}
                  disabled={starting()}
                  onChange={(e) => toggleTds(e.currentTarget.checked)}
                  class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-900 focus:ring-blue-900/30"
                />
                <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  I will deduct TDS
                </span>
              </label>

              <Show when={deductTds()}>
                <div class="flex flex-wrap gap-2 pl-7">
                  <For each={choices()}>
                    {(pct) => (
                      <button
                        type="button"
                        disabled={starting()}
                        onClick={() => setTdsPct(pct)}
                        aria-pressed={tdsPct() === pct}
                        class={`px-3.5 py-1.5 rounded-full border text-xs font-bold transition-colors ${
                          tdsPct() === pct
                            ? "bg-blue-900 dark:bg-blue-700 text-white border-blue-900 dark:border-blue-700"
                            : "border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-400"
                        }`}
                      >
                        {pct}%
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </Show>

          {/* ── Breakdown ── */}
          <Show when={quoteError()}>
            <div
              role="alert"
              class="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300"
            >
              {quoteError()}
            </div>
          </Show>

          <Show when={shown()}>
            <div
              class={`rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40 divide-y divide-gray-200 dark:divide-gray-700 transition-opacity ${
                stale() ? "opacity-50" : "opacity-100"
              }`}
              aria-busy={stale() ? "true" : undefined}
            >
              <Row
                label="Amount (ex GST)"
                value={fmtRs(shown().amount_ex_gst, 2)}
              />
              <Row label={gstPctLabel()} value={fmtRs(shown().gst_amount, 2)} />
              <Row
                label="Total incl. GST"
                value={fmtRs(shown().including_gst, 2)}
              />
              <Show when={showTdsRow()}>
                <Row
                  label={`TDS deducted${
                    payNum(shown().tds_pct) ? ` (${payNum(shown().tds_pct)}%)` : ""
                  }`}
                  value={`- ${fmtRs(tdsAmount(), 2)}`}
                  tone="text-amber-700 dark:text-amber-300"
                />
              </Show>
              <Row label="You pay" value={fmtRs(shown().amount_payable, 2)} strong />
              <Row
                label="Credited to your account"
                value={fmtRs(shown().credited, 2)}
                tone="text-green-700 dark:text-green-300"
              />
            </div>
          </Show>

          {/* ── Methods note ── */}
          <div class="space-y-2">
            <Show when={payMethodLabels(summary()).length > 0}>
              <div class="flex flex-wrap gap-1.5">
                <For each={payMethodLabels(summary())}>
                  {(m) => (
                    <span class="px-2.5 py-1 rounded-full bg-gray-100 dark:bg-gray-700 text-[11px] font-bold uppercase tracking-wide text-gray-600 dark:text-gray-300">
                      {m}
                    </span>
                  )}
                </For>
              </div>
            </Show>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              {payMethodsNote(summary())}
            </p>
          </div>

          {/* ── Start error ── */}
          <Show when={startError()}>
            <div
              role="alert"
              class="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300"
            >
              {startError()}
            </div>
          </Show>

          {/* ── Pay ── */}
          <button
            type="button"
            onClick={pay}
            disabled={!canPay()}
            class="w-full py-3 rounded-2xl bg-blue-900 dark:bg-blue-700 text-white font-bold text-sm hover:bg-blue-800 dark:hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {starting()
              ? "Opening the payment page…"
              : payable() !== null
                ? `Pay ${fmtRs(payable(), 2)}`
                : "Enter an amount to continue"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row(props) {
  return (
    <div class="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <span
        class={`text-sm ${
          props.strong
            ? "font-bold text-gray-900 dark:text-gray-100"
            : "text-gray-600 dark:text-gray-400"
        }`}
      >
        {props.label}
      </span>
      <span
        class={`text-sm tabular-nums ${
          props.strong
            ? "font-bold text-base text-gray-900 dark:text-gray-100"
            : `font-semibold ${props.tone ?? "text-gray-800 dark:text-gray-200"}`
        }`}
      >
        {props.value}
      </span>
    </div>
  );
}
