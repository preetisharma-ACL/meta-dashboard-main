import { api } from "../api/api";
import { scopeQuery, applyMeta } from "../stores/cmScope";

// ─── Account Funding service ──────────────────────────────────────────────────
// GET /cm/funding/accounts/  (BASE_URL already includes /api, so the spec's
// /api/cm/... maps to /cm/...). Returns every account in scope, ALREADY sorted
// by shortfall descending (most urgent to fund first) — callers must preserve
// that order. Switch-mode aware: threads ?as_team_member_id via scopeQuery().
export const fetchFundingAccounts = async () => {
  const res = await api(`/cm/funding/accounts/?1=1${scopeQuery()}`, {
    method: "GET",
  });
  applyMeta(res?.meta);
  return res;
};
