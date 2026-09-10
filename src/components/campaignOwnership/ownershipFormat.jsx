// ─── Campaign ownership formatting ────────────────────────────────────────────
// Shared by the reassign modal, the history drawer and the row control, so a
// date or a span reads identically wherever it appears.

export const FIELD =
  "w-full px-3 py-2.5 rounded-lg border border-[#E2E8F1] dark:border-gray-600 " +
  "bg-white dark:bg-gray-800 text-[#14233A] dark:text-gray-100 " +
  "placeholder:text-[#8593A8] " +
  "focus:ring-2 focus:ring-[#AC2334]/40 focus:border-[#AC2334] outline-none " +
  "disabled:opacity-50 transition";

export const FIELD_BAD =
  "border-[#AC2334] focus:border-[#AC2334] ring-1 ring-[#AC2334]/30";

export const LABEL =
  "block text-sm font-semibold text-[#14233A] dark:text-gray-200 mb-1.5";

export const HINT = "text-xs leading-relaxed text-[#8593A8] mt-1.5";

export const BODY = "text-sm text-[#14233A] dark:text-gray-200";

// ── Dates ────────────────────────────────────────────────────────────────────
// A YYYY-MM-DD from the API is rendered WITHOUT going through Date(): a bare
// date string parses as UTC midnight, which in an en-IN browser (UTC+5:30) still
// prints the right day, but the same code on a negative offset prints the day
// before. These are ownership boundaries — a day either side is a day of leads
// on the wrong ledger — so the string is split rather than parsed.
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export const fmtDate = (ymd) => {
  if (!ymd) return "—";
  const m = String(ymd)
    .slice(0, 10)
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(ymd);
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return String(ymd);
  return `${Number(m[3])} ${month} ${m[1]}`;
};

// Whole days from `from` to `to` inclusive, or null when either side is unusable.
// Computed in UTC on purpose: both ends are calendar dates with no time of day,
// so UTC arithmetic can't be shifted by a DST boundary sitting between them.
export const daysInclusive = (from, to) => {
  const a = String(from ?? "").slice(0, 10);
  const b = String(to ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b))
    return null;
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  return Math.floor(ms / 86_400_000) + 1;
};

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// One ownership span as a sentence. The open-ended current row has no end date —
// that is "still owns it", not a missing value, so it gets its own wording
// instead of an em dash that reads as absent data.
export const spanLabel = (row) => {
  if (!row?.validFrom) return "—";
  if (row.validTo) return `${fmtDate(row.validFrom)} → ${fmtDate(row.validTo)}`;
  return `${fmtDate(row.validFrom)} → now`;
};

// ── The first pipe segment ───────────────────────────────────────────────────
// The rename rewrites ONLY the text before the first "|"; everything after it is
// Meta's business and is left untouched. A name with no pipe is not renamed at
// all. Returning the three parts lets the UI show the operator exactly which
// characters are about to move, rather than asserting that something will happen.
export const splitFirstSegment = (name) => {
  const s = String(name ?? "");
  const i = s.indexOf("|");
  if (i === -1) return { head: s, rest: null, hasPipe: false };
  return { head: s.slice(0, i), rest: s.slice(i), hasPipe: true };
};
