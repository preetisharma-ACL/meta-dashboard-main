// ─── Credit Notes (hybrid clients, from 2026-09) ──────────────────────────────
// For a hybrid client a replaced lead no longer reduces the month's bill. Each
// replacement becomes a credit in a "Credit Notes" pool, and every month's
// charge is paid from that pool first; only the rest comes off the main balance.
//
// The backend decides when this applies. On the billing overview that is
// `credit_notes` being non-null; on /billing/credit-notes/ it is `applies`.
// When it doesn't apply, nothing about Credit Notes renders — not a zero, not a
// dash, nothing.
//
// Money arrives as strings. null is "unknown" and renders "—", never 0.

// String/number → finite number, or null when absent / unparsable.
export const cnNum = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// The figures the hybrid account statement needs, read once so the ledger rows
// and the check agree. `billed` is GROSS for these months (replacements are not
// subtracted), and the part of it the main balance actually paid is
// billed − used. Any leg that is null makes the derived figure null too.
//
//   check: opening + funds + points − (billed − used) = remaining
//
// `funds` and `points` are what the statement shows on those two rows (the page
// splits points out of funds_added_inc_gst), so the check covers the rows on
// screen rather than a re-read of the payload.
export const creditNotesStatement = ({
  overview,
  fundsAddedIncGst,
  pointsAdded,
}) => {
  const cn = overview?.credit_notes;
  if (!cn) return null;
  const ms = overview?.month_spend ?? {};

  const billed = cnNum(ms.total_with_service_charge_and_gst);
  const used = cnNum(cn.used_inc);
  const paidFromMain = billed != null && used != null ? billed - used : null;

  const opening = cnNum(overview?.opening_balance?.inc_gst);
  const remaining = cnNum(overview?.closing_balance?.inc_gst);
  const funds = cnNum(fundsAddedIncGst);
  const points = cnNum(pointsAdded);

  const expected =
    opening != null && funds != null && points != null && paidFromMain != null
      ? opening + funds + points - paidFromMain
      : null;
  // A rupee of slack: every input is already rounded to paise server-side.
  const balances =
    expected == null || remaining == null
      ? null
      : Math.abs(expected - remaining) < 1;

  return {
    opening,
    cnOpening: cnNum(cn.opening_inc),
    cnAdded: cnNum(cn.added_inc),
    billed,
    used,
    paidFromMain,
    remaining,
    cnClosing: cnNum(cn.closing_inc),
    expected,
    balances,
  };
};

// "2026-09" → "Sept 2026" (en-IN, like every other month label here).
// Anything else comes back as given.
export const cnMonthLabel = (key) => {
  const [y, m] = String(key ?? "").split("-").map(Number);
  if (!y || !m) return key ?? "—";
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
};

// True only when the key is on the object. Admin/CM-only fields on a credit
// batch (recorded_by, recorded_at, notes, revoke_reason) are ABSENT for a
// client, not false — presence is the signal, not truthiness.
export const hasKey = (o, k) =>
  o != null && Object.prototype.hasOwnProperty.call(o, k);
