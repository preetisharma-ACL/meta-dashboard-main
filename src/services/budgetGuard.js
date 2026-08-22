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
//   trigger,                 budget | objective | daily_spend  ← WHICH RULE FIRED
//   detail,                  specifics for the non-budget triggers
//   original_daily_budget,   string, RUPEES — what it was when it tripped
//   capped_daily_budget,     "100.00" — what we dropped it to
//   threshold,               "5000.00" — the cap in force at the time
//   paused_campaign, paused_adset, budget_capped,   booleans: what we managed
//   meta_error,              non-empty if Meta refused part of it
//   state,                   paused_pending | approved | rejected
//   reason, decided_by, decided_at, restored_budget, created_at
// }
//
// ⚠ THREE RULES, AND ONLY ONE OF THEM TOUCHES A BUDGET.
//   budget       ad-set daily budget over the cap → PAUSED + BUDGET DROPPED to
//                ₹100/day. Approving RESTORES original_daily_budget.
//   objective    campaign objective isn't lead generation → PAUSED. The budget
//                was never touched.
//   daily_spend  the day's spend went past the daily limit → PAUSED. The budget
//                was never touched.
//
// original_daily_budget is populated on ALL THREE — it is simply what the
// campaign's budget was. On an objective or daily_spend row it was NOT capped
// and will NOT be restored, so printing it in either of those sentences states
// something that did not happen. Every sentence below therefore branches on the
// trigger FIRST, and the capped/restored figures exist only in the budget
// branch.

// ── Triggers ─────────────────────────────────────────────────────────────────
export const TRIGGER_BUDGET = "budget";
export const TRIGGER_OBJECTIVE = "objective";
export const TRIGGER_DAILY_SPEND = "daily_spend";

// A row whose trigger is missing or unrecognised (rows written before the field
// existed, or a fourth rule added on the backend before this screen knows about
// it) is NOT guessed into one of the three. It falls through to wording that
// claims nothing beyond what the row's own booleans prove — see guardEventSentence.
export const normaliseTrigger = (row = {}) => {
  const t = String(row.trigger ?? "").toLowerCase();
  return t === TRIGGER_BUDGET ||
    t === TRIGGER_OBJECTIVE ||
    t === TRIGGER_DAILY_SPEND
    ? t
    : null;
};

// The ONLY trigger that changes a budget. Everything that prints a capped or a
// restored figure asks this first.
export const involvesBudgetChange = (row = {}) => {
  const t = normaliseTrigger(row);
  // An unknown trigger is read off what actually happened rather than assumed:
  // if the guard capped the budget, it was a budget event.
  if (t === null) return !!row.budget_capped;
  return t === TRIGGER_BUDGET;
};

export const TRIGGER_LABEL = {
  [TRIGGER_BUDGET]: "Budget cap",
  [TRIGGER_OBJECTIVE]: "Wrong objective",
  [TRIGGER_DAILY_SPEND]: "Daily spend",
};

export const triggerLabel = (row = {}) =>
  TRIGGER_LABEL[normaliseTrigger(row)] ?? "Guard rule";

// Three visually distinct chips, because the three rules mean genuinely
// different things and the reader decides how to read the rest of the card from
// this one mark. Daily spend is deliberately the CALMEST of the three: Meta
// routinely delivers 10–20% over a daily budget, so a correctly-set ₹5,000/day
// campaign lands there at ₹5,500 through nobody's fault, and a red chip would
// make every one of those look like an incident.
export const TRIGGER_CHIP = {
  [TRIGGER_BUDGET]:
    "bg-[#FDF2F4] text-[#8C1F2C] dark:bg-red-950/40 dark:text-red-300",
  [TRIGGER_OBJECTIVE]:
    "bg-[#EEF0FB] text-[#3B4A9C] dark:bg-indigo-950/40 dark:text-indigo-300",
  [TRIGGER_DAILY_SPEND]:
    "bg-[#F1F4F8] text-[#54657E] dark:bg-gray-700 dark:text-gray-300",
};

export const triggerChip = (row = {}) =>
  TRIGGER_CHIP[normaliseTrigger(row)] ?? TRIGGER_CHIP[TRIGGER_DAILY_SPEND];

// One line under the chip saying what the rule is FOR. The daily-spend one says
// the quiet part out loud so nobody reads the card as an accusation.
export const TRIGGER_MEANING = {
  [TRIGGER_BUDGET]:
    "An ad-set daily budget was set above the cap. The budget was dropped as well as the campaign paused, because a pause alone can be undone by an automated rule.",
  [TRIGGER_OBJECTIVE]:
    "The campaign objective is not lead generation, so its spend cannot produce leads.",
  [TRIGGER_DAILY_SPEND]:
    "The day's spend went past the daily limit. Meta commonly delivers 10–20% above a daily budget, so a campaign correctly set at the limit can land here at around 10% over — read the figures before assuming anything is wrong.",
};

export const triggerMeaning = (row = {}) =>
  TRIGGER_MEANING[normaliseTrigger(row)] ?? null;

// ── Reading `detail` ─────────────────────────────────────────────────────────
// The non-budget triggers carry their specifics in one free-text string:
//     objective     "objective=engagement"
//     daily_spend   "spent Rs 38,291 today (cap Rs 5,000)"
// These readers lift the values out to build a sentence a person can read. They
// NEVER do arithmetic on them: the digit groups are carried across EXACTLY as
// the server wrote them, with "Rs" swapped for "₹" and nothing else. A string
// that doesn't match is not guessed at — the caller falls back to wording with
// no figures in it, and the raw detail is printed verbatim on the card anyway.
export const detailText = (row = {}) => {
  const d = row.detail;
  return typeof d === "string" && d.trim() ? d.trim() : null;
};

export const objectiveFromDetail = (row = {}) => {
  const d = detailText(row);
  if (!d) return null;
  const m = d.match(/objective\s*[=:]\s*["']?([A-Za-z0-9 _.-]+?)["']?\s*$/i);
  return m ? m[1].trim() : null;
};

// { spent: "38,291", cap: "5,000" } — both strings, both verbatim.
export const dailySpendFromDetail = (row = {}) => {
  const d = detailText(row);
  if (!d) return null;
  const m = d.match(
    /spent\s*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)[^(]*\(?\s*cap\s*(?:rs\.?|inr|₹)\s*([\d,]+(?:\.\d+)?)/i,
  );
  if (!m) return null;
  return { spent: `₹${m[1]}`, cap: `₹${m[2]}` };
};

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
// What happened, as ONE sentence — not numbers in separate cells the reader has
// to compare. Each sentence also tells the truth about what the guard MANAGED to
// do: a campaign that was paused but never capped is a different event from a
// clean one, and printing the clean wording over a partial application is
// exactly how somebody approves a campaign believing it had been safely stopped.
//
// Tail shared by all three triggers, so "paused" is never claimed for a pause
// that did not land.
const pausedTail = (row) =>
  row.paused_campaign ? "paused." : "the campaign was NOT paused.";

// budget — the only trigger with a budget change in it.
const budgetEventSentence = (row) => {
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

// objective — NO budget figure anywhere in here. The objective itself comes out
// of `detail`; when it doesn't parse, the sentence simply omits it and the card
// prints the raw detail underneath.
const objectiveEventSentence = (row) => {
  const objective = objectiveFromDetail(row);
  return objective
    ? `Objective is “${objective}”, not lead generation — ${pausedTail(row)}`
    : `Objective is not lead generation — ${pausedTail(row)}`;
};

// daily_spend — the day's spend against the day's limit, both lifted verbatim
// from `detail`. Stated as a measurement, not an allegation: this is the rule a
// perfectly correct ₹5,000/day campaign trips by being delivered at ₹5,500.
const dailySpendEventSentence = (row) => {
  const figures = dailySpendFromDetail(row);
  if (figures)
    return `Spent ${figures.spent} today — above the ${figures.cap} daily limit. ${
      row.paused_campaign ? "Paused." : "The campaign was NOT paused."
    }`;
  return `The day's spend went above the daily limit — ${pausedTail(row)}`;
};

// The card's "what happened" line, chosen by the rule that fired.
export const guardEventSentence = (row = {}) => {
  const trigger = normaliseTrigger(row);
  if (trigger === TRIGGER_OBJECTIVE) return objectiveEventSentence(row);
  if (trigger === TRIGGER_DAILY_SPEND) return dailySpendEventSentence(row);
  if (trigger === TRIGGER_BUDGET) return budgetEventSentence(row);

  // Unknown/absent trigger. If a budget was capped, this was a budget event and
  // the budget wording is safe. Otherwise claim only the pause — inventing a
  // reason for a rule we don't recognise is worse than naming none.
  if (row.budget_capped) return budgetEventSentence(row);
  return row.paused_campaign
    ? "Paused by the Budget Guard."
    : "Flagged by the Budget Guard — the campaign was NOT paused.";
};

// What approve DOES. Only the budget trigger restores anything; on the other two
// the guard never touched the budget, so promising a restore would describe a
// write that will not happen.
export const approveSentence = (row = {}) => {
  if (!involvesBudgetChange(row))
    return "Approving resumes the campaign. Its budget is untouched — the guard never changed it, so there is nothing to restore.";

  const was = fmtPerDay(row.original_daily_budget);
  return was
    ? `Approving restores the budget to ${was} and resumes the campaign.`
    : "Approving restores the budget the campaign had when it tripped and resumes the campaign.";
};

// What reject DOES, phrased off what the guard actually applied — telling
// somebody the campaign "stays paused at ₹100/day" when no cap was ever applied
// is a claim the card itself can already disprove.
export const rejectSentence = (row = {}) => {
  const at = involvesBudgetChange(row)
    ? (() => {
        const now = fmtPerDay(row.capped_daily_budget);
        return now ? ` at ${now}` : "";
      })()
    : "";
  if (row.paused_campaign)
    return `Rejecting leaves the campaign paused${at} and closes this request.`;
  return `Rejecting leaves the campaign as it stands now${at} and closes this request.`;
};

// The ad-set budget cap that was in force when THIS row tripped — read off the
// row, never hard-coded, because the threshold is a backend setting that can
// move. BUDGET TRIGGER ONLY: on a daily_spend row the limit that matters is the
// one in the sentence above (from the same `detail` phrase as the spend), and
// two different cap figures on one card is the fastest way to make a reader
// distrust both.
export const thresholdSentence = (row = {}) => {
  if (!involvesBudgetChange(row)) return null;
  const t = fmtPerDay(row.threshold);
  return t ? `Tripped the ${t} cap in force at the time.` : null;
};

// The campaign's daily budget on a NON-budget row, labelled for what it is.
// Worth showing — approving a wrong-objective campaign running at ₹9,00,000/day
// is a different decision from approving one at ₹5,000 — but it is never
// presented as capped or restored, which is the whole point of keeping it out of
// the sentences above.
export const untouchedBudgetLine = (row = {}) => {
  if (involvesBudgetChange(row)) return null;
  const was = fmtPerDay(row.original_daily_budget);
  return was ? `Daily budget ${was} — the guard did not change it.` : null;
};

// ── What the guard actually managed ──────────────────────────────────────────
// The writes to Meta this row's rule was supposed to make, any of which can fail
// on its own. Each is named rather than rolled into a single "guarded ✓": a
// partially applied guard is not a guard.
//
// WHICH WRITES BELONG depends on the rule. Only the budget rule caps a budget —
// listing "Ad-set budget capped ✕ did not apply" on an objective or daily-spend
// row would report a failure for a write that was never attempted, which reads
// as a broken guard on a campaign the guard handled exactly right.
export const guardActions = (row = {}) => {
  const actions = [];

  if (involvesBudgetChange(row)) {
    actions.push({
      key: "budget_capped",
      label: "Ad-set budget capped",
      done: !!row.budget_capped,
      // The cap is the half that survives an automated unpause, so its failure
      // is the serious one.
      critical: true,
    });
  }

  actions.push({
    key: "paused_campaign",
    label: "Campaign paused",
    done: !!row.paused_campaign,
    critical: true,
  });

  // The ad-set pause is reported as MISSING only on a budget row, where the ad
  // set is the thing the rule is about (the budget lives on it, and the row
  // names an adset_id for that reason). The objective and daily-spend rules act
  // on the campaign; a false `paused_adset` there cannot be told apart from "no
  // ad-set write was attempted", and reporting a failure we cannot distinguish
  // from a non-event would put a warning on a campaign the guard handled
  // correctly. When it IS true, it is listed and reads as done.
  if (involvesBudgetChange(row) || row.paused_adset) {
    actions.push({
      key: "paused_adset",
      label: "Ad set paused",
      done: !!row.paused_adset,
      critical: false,
    });
  }

  return actions;
};

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
