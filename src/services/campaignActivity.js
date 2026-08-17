// ─── Campaign activity (DERIVED) ──────────────────────────────────────────────
// `campaign_activity` answers ONE question: does this client have any campaign
// that is live right now? The backend derives it from the campaigns themselves —
// nobody types it in.
//
//   running  at least one ACTIVE campaign
//   paused   none
//
// THIS IS NOT `engagement_status`. That one (active / hold / completed / unset,
// see services/clientStatus.js) is a MANUAL label a CM or admin puts on a client
// and it drifts from reality the moment somebody forgets to update it. Activity
// cannot drift — which is exactly why both are shown side by side and NEVER
// merged: the interesting rows are the ones where the two DISAGREE (marked
// Active, nothing running). See `isActivityMismatch` below.
//
// Vocabulary, kept apart on purpose:
//   Engagement = Active / Hold / Completed / Unset   (manual, set by a person)
//   Activity   = Running / Paused                    (derived from live campaigns)
//
// WHERE IT COMES FROM
//   GET /clients/admin/clients/     → per row, plus a server-side ?activity=
//   GET /cm/hierarchy/clients/      → per row, NO ?activity= param (filter locally)
//
// The hierarchy response is cached per scope + date window, so a payload minted
// before this field existed simply has no `campaign_activity`. That absence is
// NOT "paused" — it is unknown, and everything here treats it as such so a stale
// cache can never libel a client as having nothing running.

import { normaliseStatus } from "./clientStatus";

export const ACTIVITY_RUNNING = "running";
export const ACTIVITY_PAUSED = "paused";
// Field missing (pre-field cached payload) or a value we don't recognise.
export const ACTIVITY_UNKNOWN = "unknown";

// The mismatch bucket is a FILTER, not a value the API returns: it is the
// intersection of the manual label and the derived fact.
export const ACTIVITY_MISMATCH = "mismatch";

export const ACTIVITY_VALUES = [ACTIVITY_RUNNING, ACTIVITY_PAUSED];

export const ACTIVITY_FILTERS = [
  { key: "all", label: "All" },
  { key: ACTIVITY_RUNNING, label: "Running" },
  { key: ACTIVITY_PAUSED, label: "Paused" },
  { key: ACTIVITY_MISMATCH, label: "Mismatch" },
];

export const normaliseActivity = (a) => {
  const k = String(a ?? "").toLowerCase();
  return ACTIVITY_VALUES.includes(k) ? k : ACTIVITY_UNKNOWN;
};

export const activityLabel = (a) => {
  const k = normaliseActivity(a);
  if (k === ACTIVITY_RUNNING) return "Running";
  if (k === ACTIVITY_PAUSED) return "Paused";
  return "Unknown";
};

// The row worth looking at: somebody marked the engagement Active, but no
// campaign is actually live. Only ever true for a KNOWN "paused" — an unknown
// activity is not evidence of anything.
export const isActivityMismatch = (engagementStatus, activity) =>
  normaliseStatus(engagementStatus) === "active" &&
  normaliseActivity(activity) === ACTIVITY_PAUSED;

export const MISMATCH_TOOLTIP = "Marked Active but no campaigns are running";

// Does one row pass an Activity chip? Used wherever the filtering happens in the
// browser (the CM hierarchy, and the mismatch bucket on every surface).
export const matchesActivityFilter = (filterKey, { engagement, activity }) => {
  if (!filterKey || filterKey === "all") return true;
  if (filterKey === ACTIVITY_MISMATCH) return isActivityMismatch(engagement, activity);
  return normaliseActivity(activity) === filterKey;
};

// The value for `?activity=` on /clients/admin/clients/, or null when the chip
// can't be expressed server-side. "Mismatch" narrows to paused on the server and
// then keeps only the Active-labelled rows locally — the API has no notion of
// the manual label crossed with the derived one.
export const activityParam = (filterKey) => {
  if (filterKey === ACTIVITY_RUNNING || filterKey === ACTIVITY_PAUSED) return filterKey;
  if (filterKey === ACTIVITY_MISMATCH) return ACTIVITY_PAUSED;
  return null;
};
