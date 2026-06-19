import { api } from "../api/api";
import { scopeQuery, applyMeta } from "../stores/cmScope";

// ─── Campaign Manager service layer ───────────────────────────────────────────
// Every list/detail call here threads the CM switch-mode scope via scopeQuery()
// and captures meta.viewing_as via applyMeta() so the "Viewing as…" banner stays
// in sync. The backend scopes all data server-side — we never filter by role.

const today = () => new Date().toISOString().split("T")[0];

// ─── B. Campaigns (scoped) ────────────────────────────────────────────────────
export const fetchCampaignsScoped = async ({
  page = 1,
  pageSize = 1000,
  startDate,
  endDate,
  status,
  project,
  search,
  sort,
} = {}) => {
  let url = `/campaigns/?page=${page}&page_size=${pageSize}`;
  url += `&start_date=${startDate || "2020-01-01"}`;
  url += `&end_date=${endDate || today()}`;
  if (status && status !== "all") url += `&status=${encodeURIComponent(status)}`;
  if (project && project !== "all") url += `&project=${encodeURIComponent(project)}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (sort) url += `&sort=${encodeURIComponent(sort)}`;
  url += scopeQuery();

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// Sweep every page so the dashboard can aggregate scoped totals locally.
export const fetchAllCampaignsScoped = async ({
  pageSize = 1000,
  startDate,
  endDate,
  status,
  search,
} = {}) => {
  let page = 1;
  let all = [];
  let lastRes = null;

  while (true) {
    const res = await fetchCampaignsScoped({
      page,
      pageSize,
      startDate,
      endDate,
      status,
      search,
    });
    lastRes = res;
    const batch = res?.data?.results ?? (Array.isArray(res?.data) ? res.data : []);
    if (!Array.isArray(batch) || batch.length === 0) break;
    all = [...all, ...batch];
    if (!(res?.meta?.pagination?.has_next)) break;
    page += 1;
  }

  return { data: all, meta: lastRes?.meta ?? null };
};

export const fetchCampaignByIdScoped = async (campaignId) => {
  const res = await api(`/campaigns/${campaignId}/?1=1${scopeQuery()}`, {
    method: "GET",
  });
  applyMeta(res?.meta);
  return res;
};

// ─── E. Dashboard summary (scoped) ────────────────────────────────────────────
export const fetchDashboardSummaryScoped = async ({ startDate, endDate } = {}) => {
  let url = `/dashboard/summary/?1=1`;
  if (startDate) url += `&start_date=${startDate}`;
  if (endDate) url += `&end_date=${endDate}`;
  url += scopeQuery();

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// ─── F. Project report (scoped) ───────────────────────────────────────────────
export const fetchProjectReportScoped = async (projectId, { startDate, endDate } = {}) => {
  let url = `/reports/project/${projectId}/?1=1`;
  if (startDate) url += `&start_date=${startDate}`;
  if (endDate) url += `&end_date=${endDate}`;
  url += scopeQuery();

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// ─── B/C. Team members (Tier 1 → switch dropdown) ─────────────────────────────
export const fetchTeamMembers = async () => {
  return await api(`/cm/team-members/`, { method: "GET" });
};

// ─── I. AI campaign insight (admin + Tier 1 only) ─────────────────────────────
// Live LLM call: 2–4s. Callers must render a loading state and never block.
// Returns the envelope; data.insight may be null (AI unavailable) — that is NOT
// an error, render metrics + a quiet note. A 403 means the caller isn't allowed.
export const fetchAIInsight = async (
  campaignId,
  { startDate, endDate, refresh = false } = {},
) => {
  let url = `/insights/ai/campaign/${campaignId}/?1=1`;
  if (startDate) url += `&start_date=${startDate}`;
  if (endDate) url += `&end_date=${endDate}`;
  if (refresh) url += `&refresh=1`;
  url += scopeQuery();

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};
