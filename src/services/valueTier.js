import { api } from "../api/api";

// ─── Client value tier (MANUAL, INTERNAL) ─────────────────────────────────────
// A commercial classification somebody sets by hand: ultra_premium / premium /
// standard, or null when nobody has classified the client yet.
//
// ⚠ INTERNAL ONLY — NEVER RENDER THIS ON A CLIENT-FACING SCREEN. A client
// reading "Standard" about themselves is a bad afternoon for whoever owns the
// account. The backend leaves it out of the client-facing serializers; the
// frontend is just as strict, and ValueTierControl refuses to render at all for a
// role outside canSeeValueTier() (admin + coordination) so the guard travels with
// the component rather than living only at the call sites.
//
// FOUR LABELS NOW LIVE ON A CLIENT. They are different things and must never be
// merged, collapsed into one column, or described in each other's words:
//   client_type        cpl / hybrid / retainer            billing basis
//   engagement_status  active / hold / completed / unset   MANUAL, operational
//   campaign_activity  running / paused                    DERIVED from campaigns
//   value_tier         ultra_premium / premium / standard   MANUAL, commercial
//
// SCOPE IS SERVER-SIDE, as everywhere else here: the endpoints 403 anyone who
// isn't admin or coordination. Our gates only decide whether to SHOW a control,
// so nobody is handed a button that can only fail.
//
// ENVELOPE: every endpoint answers { success, message, data } — read `.data`.

export const VALUE_TIER_UNSET = "unset";

// The three real tiers, richest first — the order they read as a hierarchy.
// `unset` is deliberately not here: it is the absence of a classification.
export const VALUE_TIERS = [
  { key: "ultra_premium", label: "Ultra Premium" },
  { key: "premium", label: "Premium" },
  { key: "standard", label: "Standard" },
];

export const VALUE_TIER_FILTERS = [
  { key: "all", label: "All" },
  { key: "ultra_premium", label: "Ultra Premium" },
  { key: "premium", label: "Premium" },
  { key: "standard", label: "Standard" },
  { key: VALUE_TIER_UNSET, label: "Unset" },
];

// Badge styling — a THIRD visual family, because a client row already carries an
// engagement pill and an activity outline and a reader must never have to squint
// to tell which is which:
//   Engagement  full pill · light tinted fill · coloured round dot
//   Activity    rounded rectangle · monochrome outline · ●/○ mark
//   Value tier  sharp 4px corners · SOLID fill · ◆ diamond      ← this
// The tiers step down in weight (deep navy → slate → light grey) so the ranking
// is legible without reading the words.
export const VALUE_TIER_BADGE = {
  ultra_premium:
    "bg-[#14233A] text-white dark:bg-[#0F1B2E] dark:text-white shadow-[0_1px_2px_rgba(20,35,58,.35)]",
  premium:
    "bg-[#4A5A73] text-white dark:bg-[#3A485D] dark:text-white",
  standard:
    "bg-[#E7EAF0] text-[#54657E] dark:bg-gray-700 dark:text-gray-200",
};

// The ◆ inherits its own colour: gold at the top of the range, silver next,
// muted at the base. This is the cue that survives a greyscale print.
export const VALUE_TIER_DIAMOND = {
  ultra_premium: "text-[#E9AE5C]",
  premium: "text-[#CBD5E1]",
  standard: "text-[#8593A8] dark:text-gray-400",
};

// Small dot for filter chips and legends (chips can't carry a filled badge).
export const VALUE_TIER_DOT = {
  ultra_premium: "bg-[#14233A] dark:bg-[#E9AE5C]",
  premium: "bg-[#4A5A73] dark:bg-[#CBD5E1]",
  standard: "bg-[#C3CBD8] dark:bg-gray-500",
  [VALUE_TIER_UNSET]: "bg-gray-300 dark:bg-gray-600",
};

// null / "" / unknown all normalise to the unset bucket, so one key drives the
// badge, the filter and the counts.
export const normaliseValueTier = (t) => {
  const k = String(t ?? "").toLowerCase();
  return VALUE_TIERS.some((x) => x.key === k) ? k : VALUE_TIER_UNSET;
};

export const valueTierLabel = (t) => {
  const k = normaliseValueTier(t);
  if (k === VALUE_TIER_UNSET) return "No tier";
  return VALUE_TIERS.find((x) => x.key === k).label;
};

// A set tier that disagrees with what this month's funds suggest. The board
// serves its own `mismatch` boolean — prefer that; this is for the surfaces that
// only have the two tiers to hand (e.g. straight after a PATCH). An UNSET tier is
// not a mismatch: nothing has been claimed yet, so there is nothing to contradict.
export const isValueTierMismatch = (tier, suggested) => {
  const t = normaliseValueTier(tier);
  if (t === VALUE_TIER_UNSET) return false;
  const s = normaliseValueTier(suggested);
  if (s === VALUE_TIER_UNSET) return false;
  return t !== s;
};

// ₹ amounts, grouped the Indian way like every other money figure in the app.
// Whole rupees: these are monthly funding totals, and the paise add noise.
export const fmtFunds = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return null;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

// "Suggested: Premium (₹12,40,000 received this month)" — the whole point of the
// hint is the EVIDENCE, so the amount is never dropped when we have it. The
// thresholds live on the backend (>= ₹2,00,000 ultra premium, >= ₹1,00,000
// premium, else standard, inc-GST); we only ever display what it decided, and we
// NEVER auto-apply it. A human classifies the client.
export const suggestionCaption = (suggested, monthFunds) => {
  const s = normaliseValueTier(suggested);
  if (s === VALUE_TIER_UNSET) return null;
  const money = fmtFunds(monthFunds);
  const label = valueTierLabel(s);
  return money
    ? `Suggested: ${label} (${money} received this month)`
    : `Suggested: ${label}`;
};

// ── Value tier board ─────────────────────────────────────────────────────────
// GET /clients/value-tier-board/
//   data.counts  { ultra_premium, premium, standard, unset, total }
//   data.clients [{ client_id, client_nomen, client_email, client_type,
//                   value_tier, suggested_value_tier, month_funds_inc_gst,
//                   mismatch }]
// Read defensively: `client_id`/`client_email` here, but the engagement board
// next door serves the same two facts as `id`/`email`. Accepting both costs one
// `??` and saves a blank column if this one turns out to follow its neighbour.
export const fetchValueTierBoard = async () => {
  const res = await api(`/clients/value-tier-board/`, { method: "GET" });
  const data = res?.data ?? {};
  const clients = Array.isArray(data.clients) ? data.clients : [];
  return {
    counts: data.counts ?? {},
    clients: clients.map((c) => ({
      ...c,
      client_id: c.client_id ?? c.id ?? null,
      client_email: c.client_email ?? c.email ?? null,
    })),
  };
};

// ── Set a tier ───────────────────────────────────────────────────────────────
// PATCH /clients/{pk}/value-tier/  { value_tier, reason? }
// `pk` is the CLIENT PK — the same id /clients/admin/clients/ serves as `id` and
// the CM hierarchy serves as `client_id`, NOT the client nomen id (they differ
// for all but one client).
//
// Pass "unset" to CLEAR the classification.
//
// The reason is OPTIONAL here — unlike an engagement change, which refuses to go
// through without one. Do not "improve" this into a required field: the two
// endpoints made different promises and the UI should keep them.
//
// Returns data: { client_id, value_tier, latest_change, suggested_value_tier,
//                 month_funds_inc_gst } — the suggestion is re-served on every
// write, so a caller can refresh its hint from the response alone.
export const updateClientValueTier = async (clientId, { valueTier, reason }) => {
  const body = { value_tier: valueTier };
  const trimmed = String(reason ?? "").trim();
  if (trimmed) body.reason = trimmed;
  return await api(`/clients/${clientId}/value-tier/`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
};

// ── Per-client history ───────────────────────────────────────────────────────
// GET /clients/{pk}/value-tier-history/
//   data = [{ from_tier, to_tier, reason, changed_by_email, changed_at }]
// Sorted newest-first defensively rather than trusting the server's order, since
// "newest first" is what the drawer promises.
export const fetchClientValueTierHistory = async (clientId) => {
  const res = await api(`/clients/${clientId}/value-tier-history/`, {
    method: "GET",
  });
  const rows = Array.isArray(res?.data?.results)
    ? res.data.results
    : Array.isArray(res?.data)
      ? res.data
      : [];
  return [...rows].sort(
    (a, b) => new Date(b.changed_at ?? 0) - new Date(a.changed_at ?? 0),
  );
};

// ── Display helper for `latest_change` ───────────────────────────────────────
// One line: Premium · "Q3 review" · Shresth · 7 Aug. The reason is optional on
// this endpoint, so it is simply left out when absent rather than printed as an
// empty quote.
export const latestTierChangeCaption = (change) => {
  if (!change) return null;
  const parts = [valueTierLabel(change.to_tier)];
  if (change.reason) parts.push(`“${change.reason}”`);
  const who = String(change.changed_by_email ?? "").split("@")[0];
  if (who) parts.push(who.charAt(0).toUpperCase() + who.slice(1));
  if (change.changed_at) {
    const d = new Date(change.changed_at);
    if (!Number.isNaN(d.getTime()))
      parts.push(d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }));
  }
  return parts.join(" · ");
};
