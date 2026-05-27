import { api } from "../api/api";

// campaigns.js — add this helper at the top
const getClientNomen = () => {
  const auth = JSON.parse(localStorage.getItem("auth") || "{}");
  if (auth?.role === "admin") {
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
) => {
  const today = new Date().toISOString().split("T")[0];

  let url =
    `/campaigns/?page=${page}` +
    `&page_size=${pageSize}` +
    `&start_date=${fromDate}` +
    `&end_date=${today}`;

  if (projectId) url += `&project=${projectId}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;

  // ✅ FIX: applies for both admin (selectedClientNomen) and client (own nomen)
  const clientNomen = getClientNomen();
  if (clientNomen) url += `&client_nomen=${clientNomen}`;

  return await api(url, { method: "GET" });
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

export const fetchProjectById = async (projectId) => {
  return await api(`/projects/${projectId}/`, { method: "GET" });
};
