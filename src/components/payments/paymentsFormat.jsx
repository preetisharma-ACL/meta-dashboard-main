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

// YYYY-MM-DD for <input type="date"> round-tripping.
export const toDateInput = (v) => {
  if (isMissing(v)) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// ── Payment method ────────────────────────────────────────────────────────────
// The backend's method vocabulary isn't published in the spec, so we never
// hardcode it as the only truth: these are SUGGESTIONS, and the picker unions
// them with whatever values already appear in the loaded ledger, plus a free
// "Other" escape. A wrong guess would 400 on save rather than fail silently.
export const METHOD_SUGGESTIONS = [
  "bank_transfer",
  "neft",
  "rtgs",
  "imps",
  "upi",
  "cheque",
  "cash",
  "card",
];

// "bank_transfer" → "Bank Transfer". Unknown values pass through title-cased,
// so a method the frontend has never seen still reads properly.
export const methodLabel = (m) => {
  if (isMissing(m)) return "—";
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
