import { api } from "../api/api";

// ✅ Fetch leads data
export const fetchLeads = async () => {
  return await api("/leads", {
    method: "GET",
  });
};