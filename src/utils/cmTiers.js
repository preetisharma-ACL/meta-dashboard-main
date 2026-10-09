// ─── Campaign-manager tiers ───────────────────────────────────────────────────
// Three tiers since the backend went live with tier_3:
//   tier_1  Reporting Manager — reports to an admin (or nobody)
//   tier_2  Team Member       — reports to a Tier 1 CM or an admin
//   tier_3  Junior            — reports to a Tier 2 CM
//
// Tier 1 and Tier 2 hold the SAME powers (pause/resume/budget, payments,
// replacements, fed leads, disqualifications, configs, reassign, AI, team
// switch). Tier 3 has the old tier-2 limits: own clients, no senior actions.
// Gate on isSeniorTierValue(), never on `=== "tier_1"`.

export const CM_TIERS = ["tier_1", "tier_2", "tier_3"];
export const SENIOR_TIERS = ["tier_1", "tier_2"];

export const isSeniorTierValue = (t) => SENIOR_TIERS.includes(t);

const LONG = {
  tier_1: "Tier 1 (Reporting Manager)",
  tier_2: "Tier 2 (Team Member)",
  tier_3: "Tier 3 (Junior)",
};
const SHORT = { tier_1: "Tier 1", tier_2: "Tier 2", tier_3: "Tier 3" };

// Prefer the API's tier_label where a row carries one; the map is the fallback
// for payloads that only send the key. Unknown keys pass through rather than
// becoming blank, so a fourth tier shows up as itself instead of disappearing.
export const tierLabel = (tier, apiLabel) =>
  apiLabel || LONG[tier] || (tier ? String(tier) : "");

export const tierShortLabel = (tier) => SHORT[tier] || (tier ? String(tier) : "");

// Which leads a manager of `tier` may report to. Lead option tiers are
// "admin" | "tier_1" | "tier_2" (onboarding lead_options) — the backend
// validates the same rule and 422s on a mismatch.
const LEAD_TIERS = {
  tier_1: ["admin"],
  tier_2: ["tier_1", "admin"],
  tier_3: ["tier_2"],
};
export const leadTiersFor = (tier) => LEAD_TIERS[tier] ?? [];

// Tier 1 may have no lead at all; Tier 2 and 3 must name one.
export const leadRequiredFor = (tier) => tier === "tier_2" || tier === "tier_3";
