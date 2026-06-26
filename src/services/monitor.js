import { api } from "../api/api";

// ─── Account & Budget Monitor service (admin / global-read only) ──────────────
// Health view: low-balance / under-one-day / under-delivery flags across all ad
// accounts. CMs get a 403 → callers render a "not available for your role" state.
// Admin-only, not switch-mode scoped → no scopeQuery. Returns accounts already
// sorted by urgency; callers must preserve that order.
export const fetchMonitorAccounts = async () => {
  return await api(`/cm/monitor/accounts/`, { method: "GET" });
};
