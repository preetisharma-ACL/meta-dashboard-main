import { api } from "../api/api";
import { scopeQuery, applyMeta } from "../stores/cmScope";

// GET /alerts/?page=N&acknowledged=false|true|all
// Backward compatible: existing callers pass just a page number. `acknowledged`
// is optional — when omitted the server applies its default (unacknowledged).
// scopeQuery() appends as_team_member_id only when a Tier 1 CM is switched, so
// this is a no-op for admin/client.
export const fetchAlerts = async (page = 1, acknowledged) => {
  let url = `/alerts/?page=${page}`;
  if (acknowledged !== undefined && acknowledged !== null) {
    url += `&acknowledged=${acknowledged}`;
  }
  url += scopeQuery();

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// GET /alerts/?category=account_suspended&acknowledged=false
// Account-suspension alerts surfaced as a prominent dashboard banner. Same Alert
// shape as the normal list — these just get a more urgent surface. The endpoint
// is role-scoped server-side (admin/CM/accounts see relevant ones; clients never
// receive any), so no client-side role filtering is needed. scopeQuery() appends
// as_team_member_id only for a switched Tier 1 CM (no-op otherwise).
export const fetchSuspendedAccountAlerts = async () => {
  const url = `/alerts/?category=account_suspended&acknowledged=false${scopeQuery()}`;
  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// GET /alerts/?category=account_suspended&acknowledged=all — every page.
// The Notifications page's suspension tab needs the complete set: the mixed
// /alerts/ feed only ever yields page 1 of *unacknowledged* alerts, so a
// suspension sitting on a later page — or one already dismissed from the banner
// — never reached that tab. Returns a flat array of alert rows.
export const fetchAllSuspensionAlerts = async () => {
  let page = 1;
  let all = [];
  while (true) {
    const url = `/alerts/?category=account_suspended&acknowledged=all&page=${page}${scopeQuery()}`;
    const res = await api(url, { method: "GET" });
    if (!res) return all; // redirected to login
    applyMeta(res?.meta);
    all = [...all, ...(res.data || [])];
    if (!res?.meta?.pagination?.has_next) break;
    page++;
  }
  return all;
};

// PATCH /alerts/{id}/acknowledge/ → { id, is_acknowledged: true }
// Acknowledging an alert outside your scope returns 404 (handle gracefully).
export const acknowledgeAlert = async (id) => {
  return await api(`/alerts/${id}/acknowledge/`, { method: "PATCH" });
};
