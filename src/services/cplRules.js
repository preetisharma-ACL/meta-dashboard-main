import { api } from "../api/api";
import { scopeQuery, applyMeta } from "../stores/cmScope";

// ─── Tier B — CPL Rules & Alerts service (admin + CM-scoped) ──────────────────
// Flags campaigns running expensive vs a per-(client, project) target CPL.
// Read views are switch-mode aware (scopeQuery); the admin-only target write is
// not. BASE_URL already includes /api → paths are /cm/cpl-rules/...

// Campaigns ranked by expensiveness desc (most over-target first, untargeted last).
export const fetchCplCampaigns = async () => {
  const res = await api(`/cm/cpl-rules/campaigns/?1=1${scopeQuery({ supportsOwn: true })}`, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// Admin sets/edits a per-(client, project) target CPL.
export const setCplTarget = async (body) => {
  return await api(`/cm/cpl-rules/targets/`, { method: "PUT", body: JSON.stringify(body) });
};

// Clients exceeding N leads/day (default 10). Works without any setup.
export const fetchHighVolumeClients = async () => {
  const res = await api(`/cm/cpl-rules/high-volume/?1=1${scopeQuery()}`, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};
