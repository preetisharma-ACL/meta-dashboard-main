import { api } from "../api/api";

// ✅ Fetch billing data
export const fetchBilling = async () => {
  return await api("/billing", {
    method: "GET",
  });
};