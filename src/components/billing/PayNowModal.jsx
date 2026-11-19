import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { useDialog } from "../../utils/useDialog";
import { errorMessage } from "../../utils/apiErrors";
import { createPayQuote, QuoteRows, TdsPicker } from "./payQuote";
import BankTransferPanel from "./BankTransferPanel";
import {
  startPayment,
  tdsOffered,
  tdsPctFor,
  payMethodsNote,
  payMethodLabels,
  isPayEnabled,
  isBankEnabled,
  payNum,
  wholeRupees,
  fmtRs,
} from "../../services/hdfcPay";

// ─── Add funds (client) ───────────────────────────────────────────────────────
// Two ways to pay, one dialog:
//   ONLINE   card / UPI through the HDFC gateway, offered while
//            GET pay/summary/ returns enabled: true
//   TRANSFER NEFT / RTGS / IMPS / UPI the client makes themselves and then
//            REPORTS, offered while GET pay/bank-details/ returns enabled: true
//
// The two switches are INDEPENDENT. Either, both or neither may be on, so the
// tab strip appears only when both are, and with one the panel stands alone
// under its own heading. A tab strip with one tab is a control that cannot do
// anything.
//
// EVERY FIGURE ON SCREEN IS THE SERVER'S, on both tabs: the same GET pay/quote/
// drives both breakdowns (see payQuote.jsx) so the amount a client is charged
// by the gateway and the amount they are told to transfer cannot drift apart.
//
// Props: open, onClose(), summary (pay/summary/), bankDetails
//        (pay/bank-details/), onTransferSubmitted()

const FIELD =
  "w-full pl-8 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 " +
  "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 text-lg " +
  "focus:outline-none focus:ring-2 focus:ring-blue-900/30 dark:focus:ring-blue-400/30 " +
  "placeholder-gray-300 dark:placeholder-gray-600 transition";

export default function PayNowModal(props) {
  const summary = () => props.summary ?? {};
  const onlineOn = () => isPayEnabled(props.summary);
  const bankOn = () => isBankEnabled(props.bankDetails);
  const bothOn = () => onlineOn() && bankOn();

  // Which panel is showing. Defaults to online when it is available, because
  // that is the one that settles instantly; a client with only the transfer
  // option lands straight on it.
  const [tab, setTab] = createSignal("online");
  createEffect(() => {
    if (!props.open) return;
    setTab(onlineOn() ? "online" : "bank");
  });
  const showing = () => (bothOn() ? tab() : onlineOn() ? "online" : "bank");

  const minExGst = () => payNum(summary().min_ex_gst);
  const duesExGst = () => payNum(summary().dues_ex_gst);
  // Whether to OFFER the TDS box at all. The RATE is never read from here: it
  // is the TDS_PCT constant, so no array ordering can change what is withheld.
  const tdsAvailable = createMemo(() => tdsOffered(summary()));

  // ── Online tab state ──
  // Deliberately NOT shared with the transfer tab. The two have different
  // minimums (pay/summary/.min_ex_gst against a flat 50,000), so one shared
  // amount would carry a figure across that is valid on one tab and rejected on
  // the other, with the error appearing only after a submit.
  const [amount, setAmount] = createSignal("");
  // ONE BOOLEAN, not a rate. Since backend fd948f4 the statutory rate is 2% and
  // the backend 400s anything else, so the only state worth holding is whether
  // the client is deducting it.
  const [deductTds, setDeductTds] = createSignal(false);
  const [starting, setStarting] = createSignal(false);
  const [startError, setStartError] = createSignal(null);

  createEffect(() => {
    if (!props.open) return;
    const min = minExGst();
    setAmount(min === null ? "" : String(Math.ceil(min)));
    setDeductTds(false);
    setStartError(null);
    setStarting(false);
  });

  // The percentage that will actually be sent. tdsPctFor() yields TDS_PCT or 0
  // and nothing else, so there is no path by which a 1 reaches the server, and
  // no array index that could quietly become one again.
  const effectiveTds = () => tdsPctFor(deductTds());
  const amountValue = () => wholeRupees(amount());

  const quote = createPayQuote({
    amount: amountValue,
    tds: effectiveTds,
    // Parked while the transfer tab is showing, so switching tabs does not keep
    // a second quote running against an amount nobody is looking at.
    active: () => !!props.open && showing() === "online",
  });

  // The button needs a whole-rupee amount, a server-approved payable figure and
  // no error in between. Anything less and the gateway would be handed a number
  // nobody has agreed on.
  const canPay = () =>
    !starting() &&
    amountValue() !== null &&
    quote.payable() !== null &&
    !quote.error();

  const pay = async () => {
    const amt = amountValue();
    if (amt === null) return;
    setStarting(true);
    setStartError(null);
    try {
      const res = await startPayment({ amountExGst: amt, tdsPct: effectiveTds() });
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

  const busy = () => starting();

  const handleBackdrop = (e) => {
    if (e.target === e.currentTarget && !busy()) props.onClose();
  };

  let dialogBox;
  useDialog(
    () => props.open,
    () => {
      if (!busy()) props.onClose();
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
        aria-label="Add funds"
        class={`w-full max-w-md max-h-[92vh] overflow-y-auto rounded-2xl border border-gray-200/80 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-xl transition-all duration-200 ${
          props.open ? "scale-100 translate-y-0" : "scale-95 translate-y-4"
        }`}
      >
        <div class="p-6 space-y-5">
          {/* ── Header ── */}
          <div class="flex items-start justify-between gap-3">
            <div>
              <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100">
                Add funds
              </h3>
              <p class="mt-0.5 text-sm text-gray-600 dark:text-gray-400">
                {showing() === "online"
                  ? "Secure payment through HDFC Bank"
                  : "Transfer to our account, then tell us about it"}
              </p>
            </div>
            <button
              type="button"
              onClick={props.onClose}
              disabled={busy()}
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

          {/* ── Tabs, only when there are two ── */}
          <Show when={bothOn()}>
            <div
              role="tablist"
              class="grid grid-cols-2 gap-1 p-1 rounded-xl bg-gray-100 dark:bg-gray-900/50"
            >
              <TabButton
                active={showing() === "online"}
                disabled={busy()}
                onClick={() => setTab("online")}
              >
                Card / UPI
              </TabButton>
              <TabButton
                active={showing() === "bank"}
                disabled={busy()}
                onClick={() => setTab("bank")}
              >
                Bank transfer / UPI
              </TabButton>
            </div>
          </Show>

          {/* ── Pending dues ──
              Above the tabs' content because it is true of both. Only when
              there is something outstanding: a "Pending dues: ₹0" line on a
              client who owes nothing reads as a bill. */}
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

          {/* ════════ ONLINE ════════ */}
          <Show when={showing() === "online"}>
            <div class="space-y-5">
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
                    // Whole rupees only: the paise are the gateway's business,
                    // and a decimal typed here would be quoted on and then
                    // rounded somewhere the client cannot see.
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
                    Minimum ₹{Math.ceil(minExGst()).toLocaleString("en-IN")} + GST
                  </p>
                </Show>
              </div>

              <TdsPicker
                offered={tdsAvailable()}
                checked={deductTds()}
                disabled={starting()}
                onToggle={setDeductTds}
              />

              <Show when={quote.error()}>
                <div
                  role="alert"
                  class="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300"
                >
                  {quote.error()}
                </div>
              </Show>

              <QuoteRows quote={quote} payableLabel="You pay" />

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
                {/* ONE note, here under the chip. It names the Bank transfer
                    tab only when that tab is actually on (its switch is
                    independent), and the server's other_ways_note overrides
                    both wordings when it sent one. */}
                <p class="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                  {payMethodsNote(summary(), bankOn())}
                </p>
              </div>

              <Show when={startError()}>
                <div
                  role="alert"
                  class="rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm font-medium text-red-700 dark:text-red-300"
                >
                  {startError()}
                </div>
              </Show>

              <button
                type="button"
                onClick={pay}
                disabled={!canPay()}
                class="w-full py-3 rounded-2xl bg-blue-900 dark:bg-blue-700 text-white font-bold text-sm hover:bg-blue-800 dark:hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {starting()
                  ? "Opening the payment page…"
                  : quote.payable() !== null
                    ? `Pay ${fmtRs(quote.payable(), 2)}`
                    : "Enter an amount to continue"}
              </button>
            </div>
          </Show>

          {/* ════════ BANK TRANSFER ════════ */}
          <Show when={showing() === "bank"}>
            <BankTransferPanel
              open={props.open && showing() === "bank"}
              details={props.bankDetails}
              summary={props.summary}
              onSubmitted={props.onTransferSubmitted}
            />
          </Show>
        </div>
      </div>
    </div>
  );
}

function TabButton(props) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      disabled={props.disabled}
      onClick={props.onClick}
      class={`px-3 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 ${
        props.active
          ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
          : "text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
      }`}
    >
      {props.children}
    </button>
  );
}
