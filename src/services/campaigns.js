import { api } from "../api/api";

export const fetchCampaigns = async (page = 1, projectId, search = "", pageSize = 20, fromDate = "2020-01-01") => {
    const today = new Date().toISOString().split("T")[0];
    let url = `/campaigns/?page=${page}&page_size=${pageSize}&start_date=${fromDate}&end_date=${today}`;

    if (projectId) url += `&project=${projectId}`;
    if (search) url += `&search=${search}`;

    return await api(url, { method: "GET" });
};

// in services/campaigns.js
export const fetchCampaignInsights = async (campaignId, pageSize = 1000) => {
    return await api(`/campaigns/${campaignId}/insights/?page_size=${pageSize}`, { method: "GET" });
};

// In services/campaigns.js — add this
export const fetchProjectById = async (projectId) => {
    return await api(`/projects/${projectId}/`, { method: "GET" });
};