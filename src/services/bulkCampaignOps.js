import { api } from "../api/api";

// ─── Bulk campaign operations service (Phase D) ───────────────────────────────
// Backs the multi-campaign pause / resume / set-budget flow. These are REAL Meta
// writes, so the contract deliberately makes the safety steps explicit:
//
//   preview (read-only) → confirm-by-typed-count → execute → poll status → revert
//
// Every endpoint requires can_write_campaigns server-side (admin + Tier-1 CM);
// others get 403. The frontend also gates the whole screen on canWriteCampaigns()
// so non-writers never see a control that always 403s.
//
// Envelope discipline mirrors campaignStatus.js: api() returns the full
// { success, data, meta } envelope (or undefined on an auth-refresh bail), and we
// hand callers res.data. On any HTTP error api() throws an Error carrying
// err.status, err.code and err.data — callers branch on those (e.g. the 409
// count_mismatch / all_drifted cases below).

export const BULK_ACTIONS = new Set(["pause", "resume", "budget"]);

// Fat-finger guard rails for the bulk-budget input. The backend is the real
// authority (values outside the range come back in preview's `skipped` as
// "exceeds the safety ceiling"); these let the UI flag it before a round-trip.
export const BUDGET_MIN = 1;
export const BUDGET_MAX = 50000;

const assertAction = (action) => {
  if (!BULK_ACTIONS.has(action)) {
    throw new Error(
      `Invalid action "${action}" (expected "pause", "resume" or "budget")`,
    );
  }
};

// api() returns undefined only on the auth-failure path (it soft-logs out).
const unwrap = (res) => {
  if (!res) throw new Error("Session expired — please sign in again.");
  return res.data;
};

// 1. Preview (read-only — safe to call freely). Returns res.data:
//   { action, counts:{will_change,skipped,total_requested},
//     will_change:[…], skipped:[{campaign_id,campaign_name,reason}],
//     budget_value?, totals?:{current_daily_total,new_daily_total,delta} }
export const previewBulk = async ({ campaignIds, action, budgetValue }) => {
  assertAction(action);
  const body = { campaign_ids: campaignIds, action };
  if (action === "budget") body.budget_value = Number(budgetValue);
  const res = await api(`/cm/campaigns/bulk/preview/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return unwrap(res);
};

// 2. Execute (the write — confirm-count guarded). expectedCount MUST equal the
//   will_change count from the preview. If the live set changed since preview the
//   backend returns 409 (err.code "count_mismatch", err.data.detail =
//   { live_count, expected_count }) — the UI tells the user to re-preview.
//   Returns res.data: { operation_id, task_id, count, status }.
export const executeBulk = async ({
  campaignIds,
  action,
  budgetValue,
  expectedCount,
}) => {
  assertAction(action);
  const body = {
    campaign_ids: campaignIds,
    action,
    expected_count: expectedCount,
    confirm: true,
  };
  if (action === "budget") body.budget_value = Number(budgetValue);
  const res = await api(`/cm/campaigns/bulk/execute/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return unwrap(res);
};

// 3. Status (poll while running — ~every 2s). Returns res.data:
//   { operation_id, status, operation_type, budget_value,
//     progress:{done,total}, summary:{succeeded,failed,skipped,total} }
export const fetchBulkStatus = async (operationId) => {
  const res = await api(`/cm/campaigns/bulk/${operationId}/status/`, {
    method: "GET",
  });
  return unwrap(res);
};

// 4. Revert (drift-checked). Restores each campaign to its pre-op value.
//   Campaigns changed since the op are SKIPPED (returned in `drifted`) unless
//   force:true. Returns res.data:
//   { revert_operation_id, task_id, reverting, skipped_drifted, drifted:[…] }.
//   Poll revert_operation_id via fetchBulkStatus. 409 all_drifted (err.code
//   "all_drifted") when EVERYTHING drifted and force wasn't set.
export const revertBulk = async (operationId, { force = false } = {}) => {
  const body = { confirm: true };
  if (force) body.force = true;
  const res = await api(`/cm/campaigns/bulk/${operationId}/revert/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return unwrap(res);
};

// 5. History (read-only audit). Admins see all; Tier-1 CMs see their own.
//   Returns res.data: [ { operation_id, operation_type, budget_value, status,
//     expected_count, summary, actor_email, is_revert, reverts_operation_id,
//     created_at, completed_at } ].
export const fetchBulkHistory = async (limit = 50) => {
  const res = await api(`/cm/campaigns/bulk/operations/?limit=${limit}`, {
    method: "GET",
  });
  return unwrap(res);
};

// 6. Operation detail (drill-down). Returns res.data:
//   { …operation fields…, revertable, items:[ { campaign_id, campaign_name,
//     before_status, after_status, before_budget, after_budget, result, error } ] }.
export const fetchBulkDetail = async (operationId) => {
  const res = await api(`/cm/campaigns/bulk/${operationId}/detail/`, {
    method: "GET",
  });
  return unwrap(res);
};
