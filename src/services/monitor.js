import { api } from "../api/api";

// ─── Account & Budget Monitor service (admin / global-read only) ──────────────
// Health view: low-balance / under-one-day / under-delivery flags across all ad
// accounts. CMs get a 403 → callers render a "not available for your role" state.
// Admin-only, not switch-mode scoped → no scopeQuery. Returns accounts already
// sorted by urgency; callers must preserve that order.
export const fetchMonitorAccounts = async () => {
  return await api(`/cm/monitor/accounts/`, { method: "GET" });
};

// ─── Section 2 — client-wise budget & spend rollup (admin-only) ───────────────
// One row per client for the chosen window. Rows arrive pre-sorted by spend
// (highest first) — preserve that order. meta.summary carries the roll-up totals
// (daily budget, active campaigns/projects, blended CPL) used by the tiles.
// Default window is "yesterday" (the key daily check; today is a partial day).
const MONITOR_WINDOWS = ["today", "yesterday", "7d", "30d"];
export const fetchMonitorClients = async (window = "yesterday") => {
  const w = MONITOR_WINDOWS.includes(window) ? window : "yesterday";
  return await api(`/cm/monitor/clients/?window=${w}`, { method: "GET" });
};
