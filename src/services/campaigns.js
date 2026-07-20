import { api } from "../api/api";

// campaigns.js — add this helper at the top
const getClientNomen = () => {
  const auth = JSON.parse(localStorage.getItem("auth") || "{}");
  // Admins AND campaign managers view clients through a switchable context, so
  // both scope off selectedClientNomen. A CM is not a client — auth.clientNomen
  // is null for them — so gating this on admin alone sent no client_nomen at all
  // and the request came back with the CM's whole book of business (every client
  // they manage) under one client's page. A CM passing client_nomen still can't
  // widen past their own scope: the backend intersects the two.
  // Sales views clients through the same switchable context; backend intersects
  // with their onboarded scope, so this can never widen.
  if (
    auth?.role === "admin" ||
    auth?.role === "campaign_manager" ||
    auth?.role === "sales"
  ) {
    return localStorage.getItem("selectedClientNomen") || null;
  }
  // Real client users: read from their own auth (ensure login sets this)
  return auth?.clientNomen || null;
};

// campaigns.js — fetchCampaigns (replace the role-check block)
export const fetchCampaigns = async (
  page = 1,
  projectId,
  search = "",
  pageSize = 1000,
  fromDate = "2020-01-01",
  toDate,
) => {
  const today = new Date().toISOString().split("T")[0];
  const startDate = fromDate || "2020-01-01";
  const endDate = toDate || today; // callers can scope the end; defaults to today

  let url =
    `/campaigns/?page=${page}` +
    `&page_size=${pageSize}` +
    `&start_date=${startDate}` +
    `&end_date=${endDate}`;

  if (projectId) url += `&project=${projectId}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  // ✅ FIX: applies for both admin (selectedClientNomen) and client (own nomen)
  const clientNomen = getClientNomen();
  if (clientNomen) url += `&client_nomen=${clientNomen}`;

  return await api(url, { method: "GET" });
};

// campaigns.js — fetch EVERY campaign for the current client in one paginated
// sweep (no project filter), so callers can group by project_id locally instead
// of firing one /campaigns/?project=N request per project.
// fromDate/toDate are optional and scope the server-computed premium_metrics /
// extra_leads to a date range (omitted → fetchCampaigns' defaults).
export const fetchAllCampaigns = async (pageSize = 1000, fromDate, toDate) => {
  let page = 1;
  let all = [];
  let hasMore = true;

  while (hasMore) {
    const res = await fetchCampaigns(page, undefined, "", pageSize, fromDate, toDate);
    const batch = res?.data?.results || res?.data || [];
    if (!Array.isArray(batch) || batch.length === 0) break;
    all = [...all, ...batch];
    hasMore = res?.meta?.pagination?.has_next ?? false;
    page += 1;
  }

  return all;
};

// campaigns.js — fetchCampaignInsights (add client_nomen here too)
export const fetchCampaignInsights = async (campaignId, pageSize = 1000) => {
  // ✅ FIX: insights must be scoped the same way as campaigns
  const clientNomen = getClientNomen();

  let page = 1;
  let allInsights = [];
  let lastResponse = null;
  let hasMore = true;

  while (hasMore) {
    let url = `/campaigns/${campaignId}/insights/?page=${page}&page_size=${pageSize}`;
    if (clientNomen) url += `&client_nomen=${clientNomen}`; // ← new

    lastResponse = await api(url, { method: "GET" });

    const pageData = Array.isArray(lastResponse?.data?.results)
      ? lastResponse.data.results
      : Array.isArray(lastResponse?.data)
        ? lastResponse.data
        : [];

    allInsights = [...allInsights, ...pageData];

    const pagination = lastResponse?.meta?.pagination;
    hasMore = Boolean(pagination?.has_next) && pageData.length > 0;
    page += 1;
  }
  console.log(`Fetched ${allInsights.length} insights for campaign ${campaignId} with client_nomen=${clientNomen}`);
  return { ...lastResponse, data: allInsights };
};

// campaigns.js — bulk insights for many campaigns in one call.
// Backend: GET /api/campaigns/insights/bulk/?campaign_ids=12,34&start_date&end_date
//   • max 500 campaign_ids per call  → we chunk
//   • page_size default 1000, max 10000 → we request 10000 and page if needed
//   • rows carry campaign_id; synthetic rows have is_manual: true
//   • scoping identical to single endpoint (client_nomen)
export const fetchBulkCampaignInsights = async (
  campaignIds,
  { startDate, endDate, pageSize = 10000, clientNomen, asClientId } = {},
) => {
  const ids = [...new Set((campaignIds || []).filter((id) => id != null))];
  if (ids.length === 0) return { data: [] };

  // Callers can pass `clientNomen` explicitly to override the localStorage-based
  // scoping — pass null for an unscoped admin sweep across all clients (e.g. the
  // Ad Accounts view, whose campaigns span many clients). Omitting it keeps the
  // default per-client scoping used by the client dashboard / reports.
  const nomen = clientNomen !== undefined ? clientNomen : getClientNomen();
  const CHUNK = 500; // backend hard limit on campaign_ids per call
  let allRows = [];

  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      let url =
        `/campaigns/insights/bulk/?campaign_ids=${chunk.join(",")}` +
        `&page=${page}&page_size=${pageSize}`;
      if (startDate) url += `&start_date=${startDate}`;
      if (endDate) url += `&end_date=${endDate}`;
      // Admin/CM previewing a client: as_client_id (Client PK) puts the backend
      // in "preview as client" mode — it scopes to that client AND applies the
      // markup (`spend` = marked-up, `spend_raw` = raw). It REPLACES client_nomen
      // here; sending both together returns no rows. Without as_client_id we fall
      // back to the normal client_nomen scoping (a client's own login, `spend`
      // already marked-up for them).
      const previewAs = asClientId != null && asClientId !== "";
      if (previewAs) {
        url += `&as_client_id=${encodeURIComponent(asClientId)}`;
      } else if (nomen) {
        url += `&client_nomen=${nomen}`;
      }

      const res = await api(url, { method: "GET" });

      const pageData = Array.isArray(res?.data?.results)
        ? res.data.results
        : Array.isArray(res?.data)
          ? res.data
          : [];

      allRows = [...allRows, ...pageData];

      const pagination = res?.meta?.pagination;
      hasMore = Boolean(pagination?.has_next) && pageData.length > 0;
      page += 1;
    }
  }

  return { data: allRows };
};

export const fetchProjectById = async (projectId) => {
  return await api(`/projects/${projectId}/`, { method: "GET" });
};

export const fetchCampaignById = async (campaignId) => {
  return await api(`/campaigns/${campaignId}/`, { method: "GET" });
};

