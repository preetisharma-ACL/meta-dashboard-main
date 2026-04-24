import { api } from "../api/api";

export const fetchCampaignDetails = async (id) => {
  return await api(`/campaigns/${id}`, {
    method: "GET",
  });
};