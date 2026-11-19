import {
  createSignal,
  createEffect,
  createResource,
  onCleanup,
  Show,
} from "solid-js";
import { errorMessage } from "../../utils/apiErrors";
import {
  fetchPayQuote,
  payNum,
  fmtRs,
  TDS_PCT,
  TDS_NOTE,
} from "../../services/hdfcPay";

// ─── The live breakdown, shared by both ways of paying ────────────────────────
// GET pay/quote/ is the SAME endpoint for the credit card gateway and for a bank
// transfer the client reports, and the figures must agree to the paisa: the
// only difference is what the payable row is CALLED ("You pay" when the gateway
// is about to charge it, "Amount to transfer" when the client is about to move
// it themselves). So this is one implementation with a label prop rather than
// two that drift.
//
// NOTHING IS COMPUTED HERE. Every number rendered is the server's. A locally
// multiplied total that disagreed with the quote by a rupee would be a client
// transferring one amount and being credited another, and then arguing about it
// with accounts.

export const QUOTE_DEBOUNCE_MS = 300;

// createPayQuote({ amount, tds, active })
//   amount  () => whole-rupee number | null
//   tds     () => percentage number
//   active  () => boolean — false parks the quote (panel hidden, modal closed)
//
// Returns { shown, stale, error, payable, gstLabel, tdsAmount, hasTds }.
export function createPayQuote({ amount, tds, active }) {
  // Debounced on the amount so a half-typed "5" never reaches the server. The
  // key carries the TDS too, so flipping the percentage refetches without
  // waiting on a keystroke that is not coming.
  const [key, setKey] = createSignal(null);
  let timer;

  createEffect(() => {
    const amt = amount();
    const pct = tds();
    const on = active();
    clearTimeout(timer);
    if (!on || amt === null) {
      setKey(null);
      return;
    }
    timer = setTimeout(() => setKey({ amount: amt, tds: pct }), QUOTE_DEBOUNCE_MS);
  });

  onCleanup(() => clearTimeout(timer));

  const [res] = createResource(key, ({ amount: amt, tds: pct }) =>
    fetchPayQuote(amt, pct),
  );

  // Reading an errored resource throws, so both reads go through these.
  const quote = () => (res.error ? null : res()) ?? null;
  // The server's own words, which is where "below the minimum" comes from.
  const error = () => (res.error ? errorMessage(res.error) : null);

  // The last good breakdown, so a refetch DIMS the rows instead of emptying
  // them. Cleared the moment the quote fails: stale figures sitting next to a
  // live error message would be the wrong number shown confidently.
  const [last, setLast] = createSignal(null);
  createEffect(() => {
    if (res.error) {
      setLast(null);
      return;
    }
    const q = quote();
    if (q) setLast(q);
  });

  const shown = () => quote() ?? last();
  const stale = () => res.loading && !!last();

  const tdsAmount = () => payNum(shown()?.tds_amount);

  return {
    shown,
    stale,
    error,
    payable: () => payNum(shown()?.amount_payable),
    tdsAmount,
    hasTds: () => tdsAmount() !== null && tdsAmount() > 0,
    gstLabel: () => {
      const pct = payNum(shown()?.gst_pct);
      return pct === null ? "GST" : `GST ${pct}%`;
    },
  };
}

// The rows themselves. `payableLabel` is the one thing that differs between the
// two ways of paying; `creditedLabel` differs only in wording.
export function QuoteRows(props) {
  const q = () => props.quote;
  const shown = () => q().shown();

  return (
    <Show when={shown()}>
      <div
        class={`rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-900/40 divide-y divide-gray-200 dark:divide-gray-700 transition-opacity ${
          q().stale() ? "opacity-50" : "opacity-100"
        }`}
        aria-busy={q().stale() ? "true" : undefined}
      >
        <QuoteRow label="Amount (ex GST)" value={fmtRs(shown().amount_ex_gst, 2)} />
        <QuoteRow label={q().gstLabel()} value={fmtRs(shown().gst_amount, 2)} />
        <QuoteRow label="Total incl. GST" value={fmtRs(shown().including_gst, 2)} />
        <Show when={q().hasTds()}>
          <QuoteRow
            label={`TDS deducted${
              payNum(shown().tds_pct) ? ` (${payNum(shown().tds_pct)}%)` : ""
            }`}
            value={`- ${fmtRs(q().tdsAmount(), 2)}`}
            tone="text-amber-700 dark:text-amber-300"
          />
        </Show>
        <QuoteRow
          label={props.payableLabel ?? "You pay"}
          value={fmtRs(shown().amount_payable, 2)}
          strong
        />
        <QuoteRow
          label={props.creditedLabel ?? "Credited to your account"}
          value={fmtRs(shown().credited, 2)}
          tone="text-green-700 dark:text-green-300"
        />
      </div>
    </Show>
  );
}

export function QuoteRow(props) {
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

// The TDS control, shared by both ways of paying. A plain ON/OFF since backend
// fd948f4: the statutory rate is 2% and the backend answers 400 to anything
// else, so there is no rate to pick and the figure is shown as TEXT. The old
// 1% / 2% buttons are gone rather than disabled, because a control whose only
// other option is a guaranteed 400 is not a choice.
//
// Hidden entirely when the server is not offering that rate (see tdsOffered):
// a checkbox that posts a percentage the backend refuses is worse than no
// checkbox at all.
//
// Props: offered, checked, disabled, onToggle(bool)
export function TdsPicker(props) {
  return (
    <Show when={props.offered}>
      <div class="rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3 space-y-2">
        <label class="flex items-center gap-2.5 cursor-pointer">
          <input
            type="checkbox"
            checked={props.checked}
            disabled={props.disabled}
            onChange={(e) => props.onToggle?.(e.currentTarget.checked)}
            class="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-blue-900 focus:ring-blue-900/30"
          />
          <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">
            I will deduct TDS
          </span>
          <span class="ml-auto text-xs font-bold tabular-nums text-blue-900 dark:text-blue-300">
            TDS @ {TDS_PCT}%
          </span>
        </label>

        {/* The statutory citation, verbatim from the backend ticket. Shown
            whether or not the box is ticked: it is what a client reads to
            decide whether to tick it. */}
        <p class="pl-7 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
          {TDS_NOTE}
        </p>
      </div>
    </Show>
  );
}
