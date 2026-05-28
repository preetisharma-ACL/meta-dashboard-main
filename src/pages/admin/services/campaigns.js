import { api } from "../../../api/api";

// Fetch campaigns with optional filters
export const fetchCampaigns = async () => {
  return await api(`/campaigns`, { method: "GET" });
};