import { api } from "../../../api/api";

// Fetch paginated clients list
export const fetchClients = async (page = 1, pageSize = 20) => {
  return await api(
    `/clients/admin/clients?page=${page}&page_size=${pageSize}`,
    { method: "GET" }
  );
};

// Sweep every page and return the flat client list. Used where we need the whole
// roster in one shot (e.g. the authoritative is_active / client_type set that the
// admin "Campaign Managers' Clients" section joins against the per-CM own-client
// lists). Large page size keeps this to as few round-trips as possible.
export const fetchAllAdminClients = async () => {
  let page = 1;
  let all = [];
  while (true) {
    const res = await fetchClients(page, 1000);
    const batch = Array.isArray(res?.data) ? res.data : [];
    all = [...all, ...batch];
    if (!res?.meta?.pagination?.has_next) break;
    page += 1;
  }
  return all;
};