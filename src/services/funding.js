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
