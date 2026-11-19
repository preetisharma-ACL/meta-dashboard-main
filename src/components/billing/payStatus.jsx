import { Show } from "solid-js";
import {
  orderStatusLabel,
  orderStatusTone,
  linkStatusLabel,
  linkStatusTone,
  transferStatusLabel,
  transferStatusTone,
} from "../../services/hdfcPay";

// ─── Status pills for online payments ─────────────────────────────────────────
// One place for the order pill and the payment-link pill, so the client's
// history, the public result page and the staff links list never disagree about
// what "mismatch" looks like.
//
// COLOUR comes from the raw status, TEXT from the server's *_label where it sent
// one. A renamed label must never be able to turn a failed payment green.

const TONES = {
  green:
    "bg-green-50 text-green-700 ring-green-200 dark:bg-green-950/40 dark:text-green-300 dark:ring-green-900",
  amber:
    "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-900",
  red: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900",
  blue: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:ring-blue-900",
  gray: "bg-gray-100 text-gray-600 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700",
};

const DOTS = {
  green: "bg-green-500",
  amber: "bg-amber-500",
  red: "bg-red-500",
  blue: "bg-blue-500",
  gray: "bg-gray-400",
};

const BASE =
  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold " +
  "uppercase tracking-wide whitespace-nowrap ring-1 ring-inset";

function Pill(props) {
  return (
    <span class={`${BASE} ${TONES[props.tone] ?? TONES.gray}`}>
      <span class={`w-1.5 h-1.5 rounded-full ${DOTS[props.tone] ?? DOTS.gray}`} />
      {props.children}
    </span>
  );
}

// An order: created / pending / charged / failed / mismatch / expired.
export function OrderStatusBadge(props) {
  return (
    <Show
      when={props.order?.status || props.order?.status_label}
      fallback={<span class="text-gray-400 dark:text-gray-500">—</span>}
    >
      <Pill tone={orderStatusTone(props.order?.status)}>
        {orderStatusLabel(props.order)}
      </Pill>
    </Show>
  );
}

// A reported bank transfer: pending / verified / rejected.
//
// A THIRD vocabulary on purpose. "Pending" here means no human has looked at it
// yet, which is nothing like an ORDER's pending (the bank has not answered).
// Sharing a pill between the two would tell a client their money is on its way
// when in fact nobody has checked it.
export function TransferStatusBadge(props) {
  return (
    <Show
      when={props.transfer?.status || props.transfer?.status_label}
      fallback={<span class="text-gray-400 dark:text-gray-500">—</span>}
    >
      <Pill tone={transferStatusTone(props.transfer?.status)}>
        {transferStatusLabel(props.transfer)}
      </Pill>
    </Show>
  );
}

// A payment link: open / paid / cancelled / expired.
export function LinkStatusBadge(props) {
  return (
    <Show
      when={props.status}
      fallback={<span class="text-gray-400 dark:text-gray-500">—</span>}
    >
      <Pill tone={linkStatusTone(props.status)}>
        {linkStatusLabel(props.status)}
      </Pill>
    </Show>
  );
}
