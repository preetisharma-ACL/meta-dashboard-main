import { api } from "../api/api";

// ✅ Fetch payemnt details for a specific project
export const fetchPaymentsDetails = async (projectId) => {
  return await api(`/payments`, {
    method: "GET",
  });
}; 