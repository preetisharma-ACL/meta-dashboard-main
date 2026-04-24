import { api } from "../api/api";

// ✅ Fetch follow-up data
export const fetchFollowUp = async () => {
  return await api("/follow-ups", {
    method: "GET",
  });
};