import { api } from "../api/api";

// ─── Budget Guard ─────────────────────────────────────────────────────────────
// The queue of campaigns the backend PAUSED AND CAPPED on its own, waiting for
// an admin to release them.
//
// WHY IT EXISTS: on 17 Aug two campaigns were created straight in Ads Manager at
// ₹9,00,000/day while their names said "300". They burned ₹62,786 in a day on
// US traffic for zero leads, and the actor had also set Meta automated rules
// whose only job was to UNPAUSE them — so the team's manual pause was undone
// within hours. Hence the backend now does BOTH things: it pauses the campaign
// AND drops the ad-set budget to ₹100/day. The CAP is the half that holds — an
// automation can flip a pause back on, it cannot un-cap a budget.
//
// Enforcing since 22 Aug 2026: any ad-set daily budget over the threshold
// (₹5,000 at the time of writing, but READ IT OFF THE ROW — each row carries the
// `threshold` that was in force when it tripped) is auto-paused and capped, and
// stays that way until an admin approves it with a written reason.
//
// ADMIN ONLY. The endpoints 403 every other role; the route is gated too.
//
// ⚠ NOTHING HERE IS RECOMPUTED. Every rupee figure on this screen is a string
// the server sent, grouped for reading and printed. We never derive "what it
// will be restored to" from the cap and the threshold, never total anything up,
// never re-round. Same rule as billed_amount: one row, one source. If a figure
// is missing it prints as missing — an invented number on a screen whose whole
// job is "should we let this campaign spend again" is the worst possible bug.

// ── The row ──────────────────────────────────────────────────────────────────
// {
//   id, campaign_id, campaign_name, meta_campaign_id, ad_account, adset_id,
//   original_daily_budget,   string, RUPEES — what it was when it tripped
//   capped_daily_budget,     "100.00" — what we dropped it to
//   threshold,               "5000.00" — the cap in force at the time
//   paused_campaign, paused_adset, budget_capped,   booleans: what we managed
//   meta_error,              non-empty if Meta refused part of it
//   state,                   paused_pending | approved | rejected
//   reason, decided_by, decided_at, restored_budget, created_at
// }

export const STATE_PENDING = "paused_pending";
export const STATE_APPROVED = "approved";
export const STATE_REJECTED = "rejected";

export const stateLabel = (state) => {
  if (state === STATE_PENDING) return "Awaiting approval";
  if (state === STATE_APPROVED) return "Approved";
  if (state === STATE_REJECTED) return "Rejected";
  return state ? String(state) : "—";
};

// "Approved" is green in the "a decision was taken" sense only — it means money
// is flowing again, which is not the reassuring green a settled payment gets.
// Rejected is grey: it is the resting state of a guard that held.
export const STATE_PILL = {
  [STATE_PENDING]:
    "bg-[#FDF0D9] text-[#8A5B12] dark:bg-[#4A3714]/60 dark:text-[#E9AE5C]",
  [STATE_APPROVED]:
    "bg-[#E6F4EE] text-[#0F6B4B] dark:bg-[#0E3D2C]/60 dark:text-[#4ED0A0]",
  [STATE_REJECTED]:
    "bg-[#F1F4F8] text-[#54657E] dark:bg-gray-700 dark:text-gray-300",
};

// ── Money ────────────────────────────────────────────────────────────────────
// Grouping ONLY. The server sends rupees as a decimal string ("900000.00"); we
// group the digits the Indian way and keep the paise only when there are any, so
// ₹100.00/day reads as ₹100/day while ₹5,000.50 keeps its 50 paise. No rounding,
// no unit conversion, no arithmetic of any kind.
//
// A value we cannot parse is printed VERBATIM rather than swallowed — if the
// backend one day sends "9,00,000" or a figure with four decimal places, the
// reader still sees the server's own number instead of a dash.
export const fmtRupees = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value);
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const hasPaise = Math.abs(n % 1) > 0;
  return `₹${n.toLocaleString("en-IN", {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
};

// "₹9,00,000/day" — the unit every budget on this screen is in.
export const fmtPerDay = (value) => {
  const r = fmtRupees(value);
  return r ? `${r}/day` : null;
};

export const fmtDateTime = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// ── The sentences ────────────────────────────────────────────────────────────
// The budget change is stated as ONE sentence, not two numbers in separate cells
// the reader has to compare. And the sentence tells the truth about what the
// guard MANAGED to do: a campaign that was paused but never capped is a
// different event from a clean one, and printing the clean wording over a
// partial application is exactly how somebody approves a campaign believing it
// had been safely stopped.
export const budgetChangeSentence = (row = {}) => {
  const was = fmtPerDay(row.original_daily_budget);
  const now = fmtPerDay(row.capped_daily_budget);

  const wasPart = was ? `Budget was ${was}` : "Budget at the time not recorded";
  const capPhrase = now ? `cap to ${now}` : "budget cap";

  if (row.budget_capped && row.paused_campaign)
    return `${wasPart} — capped to ${now ?? "the guard budget"} and paused.`;
  if (row.budget_capped && !row.paused_campaign)
    return `${wasPart} — capped to ${now ?? "the guard budget"}. The campaign was NOT paused.`;
  if (!row.budget_capped && row.paused_campaign)
    return `${wasPart} — the campaign was paused, but the ${capPhrase} did NOT apply.`;
  return `${wasPart} — the campaign was NOT paused and the ${capPhrase} did NOT apply.`;
};

// What approve DOES, in the row's own numbers. The restored figure is
// original_daily_budget verbatim — never the threshold, never anything derived.
export const approveSentence = (row = {}) => {
  const was = fmtPerDay(row.original_daily_budget);
  return was
    ? `Approving restores the budget to ${was} and resumes the campaign.`
    : "Approving restores the budget the campaign had when it tripped and resumes the campaign.";
};

// What reject DOES, phrased off what the guard actually applied — telling
// somebody the campaign "stays paused" when the pause never landed is a claim
// the card itself can already disprove.
export const rejectSentence = (row = {}) => {
  const now = fmtPerDay(row.capped_daily_budget);
  const at = now ? ` at ${now}` : "";
  if (row.paused_campaign)
    return `Rejecting leaves the campaign paused${at} and closes this request.`;
  return `Rejecting leaves the campaign as it stands now${at} and closes this request.`;
};

// The cap that was in force when THIS row tripped — read off the row, never
// hard-coded, because the threshold is a backend setting that can move.
export const thresholdSentence = (row = {}) => {
  const t = fmtPerDay(row.threshold);
  return t ? `Tripped the ${t} cap in force at the time.` : null;
};

// ── What the guard actually managed ──────────────────────────────────────────
// Three separate writes to Meta, any of which can fail on its own. Each one is
// named rather than rolled into a single "guarded ✓": a partially applied guard
// is not a guard.
export const guardActions = (row = {}) => [
  {
    key: "budget_capped",
    label: "Ad-set budget capped",
    done: !!row.budget_capped,
    // The cap is the half that survives an automated unpause, so its failure is
    // the serious one.
    critical: true,
  },
  {
    key: "paused_campaign",
    label: "Campaign paused",
    done: !!row.paused_campaign,
    critical: true,
  },
  {
    key: "paused_adset",
    label: "Ad set paused",
    done: !!row.paused_adset,
    critical: false,
  },
];

export const guardIsPartial = (row = {}) =>
  guardActions(row).some((a) => !a.done);

// Meta refused part of the pause or the cap — the ONE case where somebody has to
// go and look in Ads Manager, because the campaign may not actually be stopped
// and this screen cannot tell them whether it is.
export const hasMetaError = (row = {}) =>
  typeof row.meta_error === "string" && row.meta_error.trim() !== "";

// Newest first. Done here rather than trusted from the server, because "most
// recent at top" is what the screen promises; rows with no usable timestamp keep
// their served order relative to each other.
const sortNewestFirst = (rows, primaryKey = "created_at") =>
  [...rows].sort((a, b) => {
    const at = new Date(a?.[primaryKey] ?? a?.created_at ?? 0).getTime() || 0;
    const bt = new Date(b?.[primaryKey] ?? b?.created_at ?? 0).getTime() || 0;
    return bt - at;
  });

// ── Queue ────────────────────────────────────────────────────────────────────
// GET /campaigns/budget-guard/ → { pending, recent, pending_count }
// Read through the standard { success, message, data } envelope, but tolerate a
// flat body — the shape is read off the payload, never off the ticket.
export const fetchBudgetGuardQueue = async () => {
  const res = await api(`/campaigns/budget-guard/`, { method: "GET" });
  const body = res?.data ?? res ?? {};

  const pending = Array.isArray(body.pending) ? body.pending : [];
  const recent = Array.isArray(body.recent) ? body.recent : [];

  // The badge count is the SERVER's number. The list length is a fallback only
  // for a body carrying no pending_count key at all — a count from one source
  // next to a list from another is exactly how a screen stops adding up.
  const served = body.pending_count;
  const pendingCount =
    served === undefined || served === null || served === ""
      ? pending.length
      : Number(served);

  return {
    pending: sortNewestFirst(pending),
    recent: sortNewestFirst(recent, "decided_at"),
    pendingCount: Number.isFinite(pendingCount) ? pendingCount : pending.length,
  };
};

// ── Decisions ────────────────────────────────────────────────────────────────
// POST /campaigns/budget-guard/<id>/approve/  { reason }   REQUIRED
// POST /campaigns/budget-guard/<id>/reject/   { reason }   REQUIRED
//   422 — reason blank
//   409 — already decided (somebody else got there first)
// api() lifts status/code/fields onto the error; callers read them through
// utils/apiErrors so the server's own wording is what the admin sees.
const decide = async (id, verb, reason) =>
  await api(`/campaigns/budget-guard/${id}/${verb}/`, {
    method: "POST",
    body: JSON.stringify({ reason: String(reason ?? "").trim() }),
  });

export const approveBudgetGuardEntry = (id, reason) =>
  decide(id, "approve", reason);

export const rejectBudgetGuardEntry = (id, reason) =>
  decide(id, "reject", reason);
