import { api } from "../api/api";

// ─── Company Spend Segregation service (admin / global-read only) ─────────────
// Splits total company ad spend by client commercial type. CMs get a 403 here;
// callers render a "not available for your role" state on err.status === 403.
// These endpoints are NOT switch-mode scoped (admin-only), so no scopeQuery.

// Summary — today + yesterday, each with total, agency_cost, and by_type.
export const fetchSpendSegregation = async () => {
  return await api(`/cm/spend-segregation/`, { method: "GET" });
};

// Per-bucket client drill-down. clientType ∈ cpl | hybrid | retainer | unclassified.
// Returns clients with spend_today / spend_7d / spend_30d, already sorted by 30d.
export const fetchSpendSegregationClients = async (clientType) => {
  return await api(`/cm/spend-segregation/${encodeURIComponent(clientType)}/clients/`, {
    method: "GET",
  });
};
