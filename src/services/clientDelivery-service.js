import { api } from "../api/api";

// ✅ Fetch client delivery data
export const fetchClientDelivery = async () => {
  return await api("/client-delivery", {
    method: "GET",
  });
};