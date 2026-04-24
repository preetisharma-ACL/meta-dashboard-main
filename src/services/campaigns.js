import { api } from "../api/api";

export const fetchCampaigns = async (page = 1, projectId, search = "", pageSize = 20) => {
  let url = `/campaigns/?page=${page}&page_size=${pageSize}`;

  if (projectId) {
    url += `&project=${projectId}`;
  }

  if (search) {
    url += `&search=${search}`;
  }

  return await api(url, { method: "GET" });
};

// in services/campaigns.js
export const fetchCampaignInsights = async (campaignId) => {
    return await api(`/campaigns/${campaignId}/insights/`, { method: "GET" });
};

// In services/campaigns.js — add this
export const fetchProjectById = async (projectId) => {
    return await api(`/projects/${projectId}/`, { method: "GET" });
};