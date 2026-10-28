import { api } from "../api/api";
import { scopeQuery, applyMeta } from "../stores/cmScope";

// ─── Tier B — CPL Rules & Alerts service (admin + CM-scoped) ──────────────────
// Flags campaigns running expensive vs a per-(client, project) target CPL.
// Read views are switch-mode aware (scopeQuery); the admin-only target write is
// not. BASE_URL already includes /api → paths are /cm/cpl-rules/...

// Campaigns ranked by expensiveness desc. A (client, project) without its own
// target is rated against meta.summary.default_target_cpl (₹300).
// cmId → only that CM's clients (403 if not allowed); only: "expensive" → only
// rows at ≥125% of target. meta.cms feeds the CM dropdown.
// Window: days (2|4|7, today inclusive) or since+until (YYYY-MM-DD, ≤92 days);
// nothing → last 7 days. Bad input → 422. Echoed back as meta.window.
export const fetchCplCampaigns = async ({ cmId, only, days, since, until } = {}) => {
  let q = `?1=1${scopeQuery({ supportsOwn: true })}`;
  if (since && until) q += `&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`;
  else if (days) q += `&days=${encodeURIComponent(days)}`;
  if (cmId != null && cmId !== "") q += `&cm_id=${encodeURIComponent(cmId)}`;
  if (only) q += `&only=${encodeURIComponent(only)}`;
  const res = await api(`/cm/cpl-rules/campaigns/${q}`, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// Admin + coordination set/edit a per-(client, project) target CPL (CMs 403).
export const setCplTarget = async (body) => {
  return await api(`/cm/cpl-rules/targets/`, { method: "PUT", body: JSON.stringify(body) });
};

// Clients exceeding N leads/day (default 10). Works without any setup.
export const fetchHighVolumeClients = async () => {
  const res = await api(`/cm/cpl-rules/high-volume/?1=1${scopeQuery()}`, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};
