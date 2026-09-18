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

// The page opens on CPL + Hybrid, the same default the funding and billing
// screens carry: those are the priced types, and every number this screen exists
// to police — premium spend, raw CPL, the missing-config flag — is defined only
// for them. A retainer has no pricing config by design, so with retainers in
// view the premium column is mostly "n/a" and the rows that matter have to be
// picked out from among them. They are one chip away, never hidden.
export const DEFAULT_CLIENT_TYPES = ["cpl", "hybrid"];

// Toggle a key within the selection, never landing on empty: an empty selection
// sends no param, the server returns all three types, and the chips would then
// disagree with the table. Deselecting the last lit chip is a no-op.
export const toggleClientType = (prev, key) => {
  const cur = Array.isArray(prev) ? prev : [];
  const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
  return next.length ? next : cur;
};

// What goes on the wire as ?type=. All three selected is not a narrowing — it is
// every type there is — so it sends nothing rather than enumerating the set,
// which keeps that request identical to the unfiltered one the server caches.
// Order follows CLIENT_TYPES, so one selection always produces one string
// whatever order the chips were clicked in.
export const typeParam = (selected) => {
  const keys = CLIENT_TYPES.map((t) => t.key);
  const on = keys.filter((k) => (selected ?? []).includes(k));
  if (on.length === 0 || on.length === keys.length) return null;
  return on.join(",");
};

// Did the server actually apply ?type=? A comma list is the convention
// everywhere else in this API (?client_types=cpl,hybrid), but that is a
// different parser on a different view and this endpoint has not been seen
// handling one. If it ignores the list, or reads it as one unknown value, rows
// come back carrying types nobody asked for while the chips claim a narrowing —
// the header describing one set and the rows another. So the rows are checked
// against the ask and the page says so out loud.
export const typesNotApplied = (rows, selected) => {
  const param = typeParam(selected);
  if (!param) return [];
  const asked = new Set(param.split(","));
  const stray = new Set();
  for (const r of rows ?? []) {
    const t = r?.client_type;
    if (t && !asked.has(t)) stray.add(t);
  }
  return [...stray];
};

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

// ── What the loading state should promise ────────────────────────────────────
// The server cache is 900s, written by both the endpoint and the refresh task.
// (It used to be 300 from the endpoint and 900 from the task, so an entry's
// lifetime depended on which one wrote it; aligned to 900 in 6ec9d4f.) One
// number, exported, because the UI copy quotes it and a second copy would drift.
export const CACHE_TTL_MINUTES = 15;
export const CACHE_TTL_MS = CACHE_TTL_MINUTES * 60 * 1000;

// Whether to warn the reader about a ~14s build.
//
// The refresh task runs every ten minutes against a fifteen-minute TTL, so the
// NAMED PRESETS are warm continuously and only go cold if the task itself
// fails. Presuming them cold — which is what "this tab hasn't fetched it yet"
// amounted to — put a "this will take about 15 seconds" warning on the single
// most common event on this page: opening it. The wait it warned about was
// 0.1s.
//
// A custom range is the opposite: nothing pre-warms an arbitrary window, so the
// first call for one really is a build.
//
// Being wrong in the warm direction is cheap and self-correcting — the page
// escalates on elapsed time at 3s, which is the signal that can't be wrong. That
// asymmetry is why the default is optimistic rather than defensive.
export const expectColdLoad = ({ preset, fetchedInThisTab }) => {
  if (fetchedInThisTab) return false;
  return preset === "custom";
};

// ── Dormancy (?active_only=true, delivered_last_7d) ──────────────────────────
// A client is DORMANT when it has produced no leads and no spend in the last
// seven days. 186 clients without the filter, 92 with it.
//
// THE WINDOW IS FIXED AND IS NOT THE DATE FILTER. Seven days, whatever range the
// page is showing. A client dormant for a month stays hidden on Last 30 Days.
// Structurally the same trap as balance_inc_gst always being the current month,
// so it gets the same treatment: every label says "last 7 days" out loud, and
// never just "active", which would silently inherit whatever range is selected.
//
// THIS IS DELIVERY, NOT CAMPAIGN STATE, and the two are NOT interchangeable.
// Coordination asked for "no live campaign"; 14 clients delivered this week off
// campaigns that have since paused — ShubhamShakya on 49 leads and ₹9,162,
// RohitAgarwal on 43 and ₹8,480 — and hiding those would have someone asking
// where they went within a day. Only one client differs between the two tests,
// and delivery is the one that keeps the 14.
//
// The word "active" is also already taken in this codebase: `campaign_activity`
// is running/paused, derived from campaigns, and valueTier.js carries an
// explicit warning that the labels on a client must never be merged or
// described in each other's words. Naming this control "Active" would collide
// with the exact concept the 14 clients prove it isn't.
export const DELIVERY_WINDOW_DAYS = 7;
export const DELIVERY_WINDOW_LABEL = "last 7 days";

export const DELIVERY = {
  DELIVERING: "delivering",
  DORMANT: "dormant",
  UNKNOWN: "unknown",
};

// Tri-state on purpose, for the same reason premiumSpendState is four-state: a
// plain `!row.delivered_last_7d` reads a MISSING field as dormant and would mark
// all 186 clients dormant the day the key is renamed or a cache serves rows from
// before it existed. That last one is not hypothetical — the row cache is keyed
// by version, and stale rows are exactly how a new field arrives absent.
export const deliveryState = (row) => {
  const v = row?.delivered_last_7d;
  if (v === true) return DELIVERY.DELIVERING;
  if (v === false) return DELIVERY.DORMANT;
  return DELIVERY.UNKNOWN;
};

// Only a row we KNOW to be dormant is treated as dormant. Unknown is not.
export const isDormant = (row) => deliveryState(row) === DELIVERY.DORMANT;

// The endpoint DEFAULTS to delivering-only: no param means 92, and
// ?active_only=false is how you ask for all 186. That inverted on 2026-09-18
// (e26098a), and it inverted under a frontend whose "show everything" state
// worked by sending nothing — which silently became "show 92" while the UI still
// said 186. So the param is always sent explicitly, in both directions.
//
// Sending active_only=true rather than omitting it is deliberate. It pins intent
// against a default that has already moved once, and it cannot misfire: if the
// value were ever ignored, the server's own default is the same answer. Omitting
// it has a real failure mode; stating it has none.
//
// One line, an inversion, and it decides which half of the book a reader sees —
// which is why it is here with a check on it rather than inline at the call.
export const activeOnlyParam = (includeDormant) =>
  includeDormant ? "false" : "true";

// ── Pagination ────────────────────────────────────────────────────────────────
// meta.pagination is FOUR fields, verified on the live payload:
//   { page, page_size, total, pages }
// `pages`, not `total_pages`. There is no has_next and no has_prev — those are
// ours to derive. Reading the DRF-ish names this was first written against left
// both flags permanently false, and since the nav only renders when one of them
// is true, the controls vanished entirely: at 50 per page a reader was stranded
// on page 1 of 4 with no way forward. Invisible at the default 200, because one
// page of 186 genuinely has no next.
//
// Lives here rather than beside the fetch so it can be asserted directly. Two
// bugs have now come out of these six lines; that is enough to earn checks.
const toNum = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// `p` is meta.pagination verbatim (or null). `rowCount` is how many rows the
// response actually carried.
export const derivePagination = (p, rowCount = 0) => {
  const page = toNum(p?.page) ?? 1;
  const pageSize = toNum(p?.page_size) ?? rowCount;
  // `total` deliberately does NOT fall back to rowCount. A page size wearing a
  // total's clothes is how "20 of 20" happened on a 264-row ledger; unknown is
  // an honest answer and the UI says "many".
  const total = toNum(p?.total);

  const served = toNum(p?.pages);
  // Arithmetic fallback, so one renamed key can never again take the navigation
  // away. Only used when the server didn't say.
  const computed =
    total != null && pageSize > 0 ? Math.ceil(total / pageSize) : null;
  const totalPages = served ?? computed;

  return {
    page,
    pageSize,
    total,
    totalPages,
    // `pages` is the server's own count and wins where both exist; the mismatch
    // is surfaced by paginationDisagrees() rather than silently resolved.
    hasNext: totalPages != null ? page < totalPages : false,
    // NOT dependent on knowing the total. Someone on page 3 can always go back,
    // even if the response forgot to say how many pages there are — being unable
    // to retreat is the worse half of being stranded.
    hasPrev: page > 1,
  };
};

// True when the server's `pages` contradicts what its own `total` and
// `page_size` imply. Both come from the same serializer and should agree, so a
// disagreement is a backend bug worth seeing rather than papering over — and it
// would show up as pages of empty rows the reader can page into.
export const paginationDisagrees = (p) => {
  const pages = toNum(p?.pages);
  const total = toNum(p?.total);
  const pageSize = toNum(p?.page_size);
  if (pages == null || total == null || !pageSize) return false;
  return pages !== Math.ceil(total / pageSize);
};

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
// Used for the custom-range date inputs — what the user is picking, not what the
// server resolved. For the latter see fmtRange below.
export const isoDate = (d) => {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// ── The resolved window (meta.range) ─────────────────────────────────────────
// meta.range = { since, until }, both ISO, always present, resolved server-side
// in Asia/Kolkata. These dates are AUTHORITATIVE — they are what the figures
// were actually computed over, not what this browser thinks "last 7 days" means.
// So they are displayed as fact.
//
// Formatted straight off the string, with no Date object anywhere near it. That
// is the whole point: `new Date("2026-08-20")` parses as UTC midnight, so a
// browser anywhere west of Greenwich would render the server's 20 Aug as 19 Aug
// — the page would contradict the numbers it is labelling, in exactly the way
// this field exists to prevent.
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const parseIsoParts = (iso) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? "").trim());
  if (!m) return null;
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return { y: m[1], m: MONTHS[month - 1], d: String(Number(m[3])) };
};

// "18 Sep 2026" · "12–18 Sep 2026" · "20 Aug – 18 Sep 2026" ·
// "20 Dec 2025 – 18 Jan 2026". Returns null if either end is unreadable, so a
// caller shows nothing rather than half a window.
export const fmtRange = (since, until) => {
  const a = parseIsoParts(since);
  const b = parseIsoParts(until);
  if (!a || !b) return null;
  if (a.y === b.y && a.m === b.m && a.d === b.d) return `${a.d} ${a.m} ${a.y}`;
  if (a.y === b.y && a.m === b.m) return `${a.d}–${b.d} ${b.m} ${b.y}`;
  if (a.y === b.y) return `${a.d} ${a.m} – ${b.d} ${b.m} ${b.y}`;
  return `${a.d} ${a.m} ${a.y} – ${b.d} ${b.m} ${b.y}`;
};
