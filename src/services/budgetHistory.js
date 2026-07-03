import { api } from "../api/api";

// ─── Budget History service (admin / global-read only) ────────────────────────
// GET /cm/budget-history/ — allocated budget + spend for a specific date or date
// range. (BASE_URL already includes /api → the spec's /api/cm/... maps to /cm/…)
//
// The honest limitation this endpoint encodes: SPEND is backfilled and available
// for any past date, but ALLOCATED BUDGET is only captured going forward from the
// day forward-capture deployed. So for pre-tracking dates the endpoint returns
// spend with null allocated values and sets meta.allocated_budget_available_for_range
// = false + a human note. Callers must render the note, NOT ₹0 (see BudgetHistory).
//
// CARRY-FORWARD (meta.carry_forward = true): allocated budget is a STANDING value,
// so for any tracked date a client's budget = their most recent captured value
// on/before that date (today shows the standing budget, not a blank). The allocated
// FIELD NAMES DIFFER by query mode — callers must branch:
//   • Single date (?date=):     allocated_budget, allocated_carried_forward,
//                               allocated_source_date  (overall: total_allocated_budget)
//   • Date range (?start/end=): allocated_daily_rate (standing rate as of range end),
//                               allocated_total_over_range (sum of each day's carried
//                               budget), allocated_source_date, days_with_budget
//
// Params (all optional, but pass either `date` OR start+end):
//   date       "YYYY-MM-DD"  single day
//   startDate  "YYYY-MM-DD"  range start (with endDate; values aggregate across it)
//   endDate    "YYYY-MM-DD"  range end
//   groupBy    "client" (default) | "manager" | "overall"
//   managerId  optional filter to one manager
//   clientTypes  optional array of "cpl" | "hybrid" | "retainer" — sent as
//                ?client_type=cpl,hybrid. Omitting it lets the backend default
//                to cpl,hybrid (retainers are client-funded → excluded by
//                convention, so the totals reconcile with the Allowed Budget
//                page). The CPL/Hybrid/Retainer chips only ever send those three
//                keys, which excludes unclassified clients (the backend's `all`
//                value would include them, matching Account Funding's behaviour).
//                meta.client_type_filter echoes back the applied filter.
//
// Returns the raw envelope { data, meta } — data is an array for client/manager
// grouping and a single object for group_by=overall.
export const fetchBudgetHistory = async ({
  date,
  startDate,
  endDate,
  groupBy,
  managerId,
  clientTypes,
} = {}) => {
  let url = `/cm/budget-history/?1=1`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
  if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`;
  if (endDate) url += `&end_date=${encodeURIComponent(endDate)}`;
  if (groupBy) url += `&group_by=${encodeURIComponent(groupBy)}`;
  if (managerId != null && managerId !== "")
    url += `&manager_id=${encodeURIComponent(managerId)}`;
  if (Array.isArray(clientTypes) && clientTypes.length)
    url += `&client_type=${encodeURIComponent(clientTypes.join(","))}`;

  return await api(url, { method: "GET" });
};
