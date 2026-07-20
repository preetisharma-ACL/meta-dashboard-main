import { api } from "../api/api";

// ─── Sales Manager service layer ──────────────────────────────────────────────
// Sales tokens are scoped server-side to the manager's own onboarded clients.
// We never filter by role on the frontend — these calls just hit the sales
// roster + the shared dashboard summary, and the backend merges/intersects to
// the manager's book.

// Roster of the sales manager's onboarded clients.
//   id                → Client PK
//   client_nomen      → nomen id
//   client_nomen_name → display name (what the client route slug is built from)
//   client_type       → cpl | hybrid | retainer (badge)
// The backend already scopes this to the caller's onboarded clients, so no
// pagination params are needed for v1 (the roster is small per manager); we
// still return the flat data array so callers stay envelope-agnostic.
export const fetchSalesClients = async () => {
  const res = await api(`/clients/sales/clients/`, { method: "GET" });
  return Array.isArray(res?.data) ? res.data : res?.data?.results ?? [];
};

// Merged summary across ALL of the sales manager's onboarded clients (client-
// facing money only). For sales tokens the backend merges the whole book, so
// no client_nomen / as_client_id is sent. Keys mirror the client summary:
//   total_budget, total_spend, total_leads, avg_cpl, total_impressions,
//   total_clicks, active_campaigns, project_status_summary
// Returns the full envelope so callers can read res.data / res.meta.
export const fetchSalesSummary = async (startDate, endDate) => {
  let url = `/dashboard/summary/?1=1`;
  if (startDate) url += `&start_date=${startDate}`;
  if (endDate) url += `&end_date=${endDate}`;
  return await api(url, { method: "GET" });
};

// Per-client payments overview for a month, scoped server-side to the sales
// manager's onboarded book. The path carries "admin/" for historical reasons
// but the backend sales-scopes it (verified live). Returns the full envelope;
// callers read res.data = { month, totals, clients[] }.
//   month  → "YYYY-MM" (omit to let the server default to the current month)
//   refresh→ true ONLY from an explicit Refresh button — bypasses the server's
//            10-min cache and forces a ~6s recompute.
export const fetchSalesPayments = async (month = "", refresh = false) => {
  let url = `/billing/admin/payments-overview/`;
  const params = [];
  if (month) params.push(`month=${encodeURIComponent(month)}`);
  if (refresh) params.push(`refresh=1`);
  if (params.length) url += `?${params.join("&")}`;
  return await api(url, { method: "GET" });
};
