import { Show } from "solid-js";
import { fmtMoney, isMissing } from "../sales/salesFormat";

// ─── Payments formatting + badges ─────────────────────────────────────────────
// Money formatting is NOT re-implemented here — it reuses the sales null
// discipline (missing → "—", never ₹0) so every money surface in the app reads
// the same way. Only the payment-specific bits live here.

export { fmtMoney, isMissing };

// Field styling shared by the record + edit forms (house navy/red palette).
export const fieldClass =
  "w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-700 " +
  "bg-white dark:bg-gray-900 text-sm text-[#14233A] dark:text-gray-100 " +
  "placeholder:text-[#8593A8] dark:placeholder:text-gray-500 " +
  "focus:outline-none focus:ring-2 focus:ring-[#14233A]/20 focus:border-[#14233A]/40 " +
  "disabled:opacity-60 disabled:cursor-not-allowed transition";

export const labelClass =
  "block text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5";

// ── Dates ─────────────────────────────────────────────────────────────────────

// "12 Mar 2026". Missing → "—". Unparseable → the raw string (better to show
// what the server sent than to swallow it).
export const fmtDate = (v) => {
  if (isMissing(v)) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// paid_at is a DATETIME server-side, so the forms use <input
// type="datetime-local">. That control speaks LOCAL "YYYY-MM-DDTHH:mm" with no
// zone, so the pair below converts at the boundary: parse to local for display,
// and send an absolute ISO instant. Posting the raw local string would leave
// the server to guess a timezone and could book a late-evening payment on the
// wrong date.
const pad2 = (n) => String(n).padStart(2, "0");

export const toDateTimeInput = (v) => {
  if (isMissing(v)) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
    `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
};

// Local "YYYY-MM-DDTHH:mm" → absolute ISO instant. Blank → null (the field is
// optional; null means "don't send it", not "epoch").
export const fromDateTimeInput = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

// ── Payment method ────────────────────────────────────────────────────────────
// The backend PaymentMethod enum, in full. These SIX are the only values the
// API accepts, so every picker renders exactly this list — no free-text escape,
// no values inferred from whatever happens to be on the current page. (The
// earlier guessed vocabulary offered Cash/Cheque/NEFT/RTGS/IMPS, none of which
// are enum members; the business books cash as "points".)
export const PAYMENT_METHODS = [
  { value: "card", label: "Card" },
  { value: "net_banking", label: "Net Banking" },
  { value: "upi", label: "UPI" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "wallet", label: "Wallet" },
  { value: "points", label: "Points" },
];

const METHOD_LABELS = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.value, m.label]),
);

// ── Payment status (the SETTLEMENT axis) ──────────────────────────────────────
// Distinct from docs_status. This answers "has the money settled", which only
// accounts sets — the CM record form has no status control at all, and the
// server defaults a CM entry to "pending".
export const PAYMENT_STATUSES = [
  { value: "pending", label: "Pending" },
  { value: "succeeded", label: "Succeeded" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
];

// "bank_transfer" → "Bank Transfer". A value outside the enum still renders
// title-cased rather than blank: historical rows predate the enum being
// enforced, and hiding what the server actually stored would be worse than
// showing it. Only the PICKERS are restricted to the six.
export const methodLabel = (m) => {
  if (isMissing(m)) return "—";
  const known = METHOD_LABELS[String(m).toLowerCase()];
  if (known) return known;
  return String(m)
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

// ── Badges ────────────────────────────────────────────────────────────────────

const BADGE_BASE =
  "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wide whitespace-nowrap";

// docs_status — the paperwork flag, NOT a money state and NOT the settlement
// state. `pending` means a tier-1 CM recorded the amount and accounts still
// owes it a reference/invoice; the money already counts either way.
//
// COLOUR comes from the raw `value` (docs_status), TEXT from `label`
// (docs_status_label) so the server owns the wording. Falling back to our own
// copy only when the label is absent keeps a renamed server label from being
// silently overwritten by a stale frontend string.
export function DocsBadge(props) {
  const pending = () => String(props.value ?? "").toLowerCase() === "pending";
  const text = () =>
    props.label ?? (pending() ? "Needs docs" : "Complete");
  return (
    <Show
      when={!isMissing(props.value) || !isMissing(props.label)}
      fallback={<span class="text-[#8593A8] dark:text-gray-500">—</span>}
    >
      <span
        class={
          BADGE_BASE +
          " " +
          (pending()
            ? "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300"
            : "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300")
        }
        title={
          pending()
            ? "Awaiting paperwork — fill the reference to complete it"
            : "Paperwork complete"
        }
      >
        <span
          class={
            "w-1.5 h-1.5 rounded-full " +
            (pending() ? "bg-[#B07A14]" : "bg-[#15966A]")
          }
        />
        {text()}
      </span>
    </Show>
  );
}

// NOTE — there is deliberately no settlement-status badge here. The API also
// returns status / status_label (the PROCESSING axis: pending/succeeded), but
// this dashboard runs the PAPERWORK workflow, and showing both made an accounts
// entry read as "pending" when only its bank settlement was. The normalized row
// still carries `statusLabel`, so a settlement column is a small addition if
// it's ever wanted — it just shouldn't sit next to the docs badge unlabelled.
