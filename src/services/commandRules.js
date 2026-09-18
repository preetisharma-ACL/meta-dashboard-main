// ─── Command page: the rules ──────────────────────────────────────────────────
// Everything the Command screen decides, with nothing it fetches. Split from
// command.js so the rule that matters most — what a null premium_spend means —
// can be asserted directly by scripts/verify-command-flag.mjs without a browser,
// the same arrangement orgClientRule.js has beside the payment form.
//
// No imports. Keep it that way: the moment this file reaches for `api`, the
// checks below stop being runnable.

// ── Date presets ─────────────────────────────────────────────────────────────
// These keys are the server's own. Deliberately NOT routed through the older
// DateRangeFilter component, whose preset values ("last7days", "thisMonth") are
// its own vocabulary and are not what this endpoint accepts.
export const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "this_month", label: "This month" },
];

export const DEFAULT_PRESET = "last7";

export const CLIENT_TYPES = [
  { key: "cpl", label: "CPL" },
  { key: "hybrid", label: "Hybrid" },
  { key: "retainer", label: "Retainer" },
];

// The columns the server can sort on, keyed by our column id. A header that
// isn't in here must not offer a sort control: a client-side sort would reorder
// one page while reading as an ordering of the whole set.
export const SORTABLE = {
  client: "client",
  daily_budget: "budget",
  raw_cpl: "cpl",
  balance_inc_gst: "balance",
  raw_spend: "spend",
  premium_spend: "premium_spend",
  leads: "leads",
};

// A cache key for one date range. A named preset keys on its name alone —
// stray start/end values aren't sent with it, so letting them into the key would
// split the cache over a difference the server never sees.
export const rangeKeyOf = ({ preset, start, end }) =>
  preset === "custom" ? `custom:${start ?? ""}:${end ?? ""}` : String(preset);

// ── The premium-spend flag ────────────────────────────────────────────────────
// THIS IS THE ONE THING THE PAGE HAS TO GET RIGHT.
//
// premium_spend is null in two completely unrelated situations and they must not
// look alike:
//
//   retainer      null BY DESIGN — retainers carry no configs. Nothing is wrong.
//   cpl / hybrid  null because no config covers those days. The client is being
//                 delivered leads nobody has priced. This is the flag.
//
// Render "gap" as a warning and "na" as a neutral dash. Show both the same way
// and the warning becomes wallpaper: every retainer on the page would carry it,
// so a genuinely unpriced client reads as one more row of the same grey.
//
// Note the null check rather than a falsy one. A CPL client priced at ₹0 spend
// for the window is PRICED — `!premium_spend` would put a warning on a row that
// is entirely fine.
//
// UNKNOWN is a fourth state on purpose. client_type is documented on every row,
// so it should never appear — but if it ever doesn't arrive we cannot tell the
// two nulls apart, and guessing either way is worse than saying so. Calling it a
// gap invents an alarm; calling it n/a hides a real one.
export const PREMIUM = {
  VALUE: "value",
  NA: "na",
  GAP: "gap",
  UNKNOWN: "unknown",
};

export const premiumSpendState = (row) => {
  if (row?.premium_spend !== null && row?.premium_spend !== undefined)
    return PREMIUM.VALUE;
  const type = row?.client_type;
  if (type === "retainer") return PREMIUM.NA;
  if (type === "cpl" || type === "hybrid") return PREMIUM.GAP;
  return PREMIUM.UNKNOWN;
};

export const isConfigGap = (row) => premiumSpendState(row) === PREMIUM.GAP;

// ── balance_source ────────────────────────────────────────────────────────────
// Where the current-month balance came from. A tooltip, not a column: it
// explains a number the reader is already looking at, and it would cost a column
// of width to say something that only matters when someone queries the figure.
export const BALANCE_SOURCE_NOTE = {
  explicit_payment_row:
    "From a payment recorded against this client this month.",
  computed_from_previous_month:
    "No payment recorded this month — carried forward from last month.",
  zero_no_history: "No payment history for this client, so the balance is zero.",
};

export const balanceSourceNote = (source) =>
  BALANCE_SOURCE_NOTE[source] ??
  (source ? `Balance source: ${source}` : "Balance source not reported.");

// ── Gaps the page makes visible ───────────────────────────────────────────────
// Sales person is unset for 79 of 186 clients; lead destination reads "Not
// recorded yet" for all 186. Neither is a bug and neither is an error state —
// they are facts about the records, and the page's job is to show them as
// missing rather than dress them up or hide them.
const NOT_RECORDED = "not recorded yet";

export const isUnrecorded = (v) => {
  const s = String(v ?? "").trim();
  return !s || s.toLowerCase() === NOT_RECORDED;
};

// snake_case → "Snake case". Used for lead_destination_kind, whose values are
// not enumerated anywhere we can check — so it is humanised rather than mapped
// to labels we would be inventing.
export const humanise = (v) => {
  const s = String(v ?? "")
    .trim()
    .replace(/[_-]+/g, " ");
  if (!s) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// A list field (campaign_managers, team_leads) that may arrive as an array of
// names, an array of objects, a comma-joined string, or nothing.
//
// The key chain is deliberately wide. An object we can't read a name out of gets
// dropped, and a dropped manager makes the Team column say "No CM" about a
// client that has one — a false gap, which is the same failure as flagging a
// retainer's premium spend. Rather than print "[object Object]" we cover the
// shapes people actually ship, and anything past them is a bug to fix here.
const personName = (x) =>
  typeof x === "string"
    ? x
    : (x?.name ?? x?.full_name ?? x?.username ?? x?.email ?? "");

export const asList = (v) => {
  if (Array.isArray(v)) return v.map(personName).filter(Boolean);
  const s = String(v ?? "").trim();
  if (!s || isUnrecorded(s)) return [];
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
};

// ── Formatters ────────────────────────────────────────────────────────────────
// null → "—", always. "The server didn't say" and "the server counted zero" are
// different facts and only the second may be printed as a number.
export const DASH = "—";

export const inr = (v) =>
  v == null
    ? DASH
    : `₹${Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// CPL keeps two decimals: it is a rate, and rounding to whole rupees hides the
// difference between two clients whose rates really are a few paise apart.
export const inrRate = (v) =>
  v == null
    ? DASH
    : `₹${Number(v).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

export const count = (v) =>
  v == null ? DASH : Number(v).toLocaleString("en-IN");

// Compact money for the totals strip, where a full figure would wrap the tile.
export const inrCompact = (v) => {
  if (v == null) return DASH;
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return inr(n);
};

// YYYY-MM-DD in the BROWSER's timezone. toISOString() would shift an Indian
// evening back a day, which is how a "today" filter quietly becomes yesterday.
export const isoDate = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
