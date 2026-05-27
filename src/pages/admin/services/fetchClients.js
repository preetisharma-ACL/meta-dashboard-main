import { api } from "../../../api/api";

// Fetch paginated clients list
export const fetchClients = async (page = 1, pageSize = 20) => {
  return await api(
    `/clients/admin/clients?page=${page}&page_size=${pageSize}`,
    { method: "GET" }
  );
};