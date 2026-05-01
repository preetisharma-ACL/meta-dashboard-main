import { api } from "../api/api";

// ✅ Fetch client type
export const fetchClientType = async () => {
  return await api("/clients/me/", {
    method: "GET",
  });
};