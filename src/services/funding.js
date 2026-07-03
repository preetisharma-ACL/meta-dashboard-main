import { api } from "../api/api";
import { scopeQuery, applyMeta } from "../stores/cmScope";

// ─── Account Funding service ──────────────────────────────────────────────────
// GET /cm/funding/accounts/  (BASE_URL already includes /api, so the spec's
// /api/cm/... maps to /cm/...). Returns every account in scope, ALREADY sorted
// by shortfall descending (most urgent to fund first) — callers must preserve
// that order. Switch-mode aware: threads ?as_team_member_id via scopeQuery().
//
// clientTypes (optional) — array of "cpl" | "hybrid" | "retainer". Sent as
// ?client_types=cpl,hybrid. Omitting it lets the backend default to cpl,hybrid
// (the agency-funded view that excludes client-funded retainer accounts).
export const fetchFundingAccounts = async (clientTypes) => {
  let url = `/cm/funding/accounts/?1=1`;
  if (Array.isArray(clientTypes) && clientTypes.length) {
    url += `&client_types=${encodeURIComponent(clientTypes.join(","))}`;
  }
  url += scopeQuery({ supportsOwn: true });

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// ─── "Refresh from Meta" — on-demand balance sync ─────────────────────────────
// Admin / global-read only (the backend enforces 403 otherwise). Balance sync
// across all ~78 prepaid accounts takes ~30-60s, so it runs as a background job:
// POST kicks it off (or reports a cooldown), then the caller polls the status
// endpoint until it's done. A 60s server-side cooldown stops rapid re-clicks
// from hammering Meta.
//
// POST returns the standard { success, data, message } envelope with data being
// either:
//   { status: "started",  task_id, cooldown_seconds }         — a sync kicked off
//   { status: "cooldown", seconds_remaining, last_task_id }   — synced <60s ago
export const startFundingRefresh = async () => {
  const res = await api(`/cm/funding/refresh/`, { method: "POST" });
  return res?.data ?? null;
};

// GET the status of an in-flight refresh. data.status is
// "running" | "done" | "failed"; `summary` is present once "done":
//   { synced, failed, total_available_balance, duration_seconds }
export const getFundingRefreshStatus = async (taskId) => {
  const res = await api(
    `/cm/funding/refresh/status/?task_id=${encodeURIComponent(taskId)}`,
    { method: "GET" },
  );
  return res?.data ?? null;
};
