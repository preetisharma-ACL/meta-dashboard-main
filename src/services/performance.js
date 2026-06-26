import { api } from "../api/api";

// ─── Manager Performance service (admin / global-read only) ───────────────────
// Per-manager monthly profitability (revenue − ad spend) for CP+Hybrid clients.
// CMs get a 403 → callers render a "not available for your role" state.
// month is optional (YYYY-MM); defaults to current month server-side.
export const fetchManagerPerformance = async (month) => {
  let url = `/cm/performance/managers/?1=1`;
  if (month) url += `&month=${encodeURIComponent(month)}`;
  return await api(url, { method: "GET" });
};
