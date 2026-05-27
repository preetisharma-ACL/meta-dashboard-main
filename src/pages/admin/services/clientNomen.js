import { api } from "../../../api/api";

// Fetch Client Nomenclature
export const fetchClientNomen = async (page = 1) => {
  return await api(`/clients/admin/nomens/?page=${page}`, { method: "GET" });
};
