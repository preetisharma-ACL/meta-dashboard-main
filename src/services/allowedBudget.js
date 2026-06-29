import { api } from "../api/api";
import { scopeQuery, applyMeta } from "../stores/cmScope";

// ─── Allowed Budget + approval workflow service ───────────────────────────────
// Per-client spending ceilings (admins set directly; CMs request an increase an
// admin approves). Visible to CMs (own clients) and admins (all). §5 respects
// switch mode, so list/request thread scopeQuery; admin-only writes (set/review)
// do not. BASE_URL already includes /api → paths are /cm/allowed-budget/...

// 1. List clients with ceilings + consumption (CM: own; admin: all).
export const fetchAllowedBudgetClients = async () => {
  const res = await api(`/cm/allowed-budget/clients/?1=1${scopeQuery({ supportsOwn: true })}`, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// 2. Admin sets/edits a ceiling. Either field may be null to leave it unset.
export const setAllowedBudget = async (clientId, body) => {
  return await api(`/cm/allowed-budget/clients/${clientId}/`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
};

// 3. CM (or admin) requests an increase. Must be in requester's scope.
export const requestBudgetIncrease = async (clientId, body) => {
  return await api(`/cm/allowed-budget/clients/${clientId}/request/?1=1${scopeQuery()}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

// 4. Admin approves/rejects a request (approve writes the value through).
export const reviewBudgetRequest = async (requestId, body) => {
  return await api(`/cm/allowed-budget/requests/${requestId}/review/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

// 5. Audit / request list (admin: all; CM: own). Optional status filter.
export const fetchBudgetRequests = async (status) => {
  let url = `/cm/allowed-budget/requests/?1=1`;
  if (status && status !== "all") url += `&status=${encodeURIComponent(status)}`;
  url += scopeQuery();
  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};
