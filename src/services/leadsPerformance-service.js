import { api } from "../api/api";

// ✅ Fetch leads performance data
export const fetchLeadsPerformance = async () => {
  return await api("/leads", {
    method: "GET",
  });
};