import { api } from "../../../api/api";

// Fetch paginated clients list. The trailing slash before the query matches the
// convention of every other endpoint here (`/path/?query`) and avoids an
// APPEND_SLASH 301 round-trip. (The redirect preserves the query string either
// way, so this is convention/efficiency, not correctness.)
// `status` narrows to one engagement bucket (active | hold | completed | unset)
// server-side; omit it — or pass "all" — for every client. It is the same param
// the status board accepts, so the two surfaces filter identically.
export const fetchClients = async (page = 1, pageSize = 20, status) => {
  let url = `/clients/admin/clients/?page=${page}&page_size=${pageSize}`;
  if (status && status !== "all") {
    url += `&status=${encodeURIComponent(status)}`;
  }
  return await api(url, { method: "GET" });
};

// Sweep every page and return the flat client list. Used where we need the whole
// roster in one shot (e.g. the authoritative is_active / client_type set that the
// admin "Campaign Managers' Clients" section joins against the per-CM own-client
// lists). Large page size keeps this to as few round-trips as possible.
export const fetchAllAdminClients = async ({ status } = {}) => {
  let page = 1;
  let all = [];
  let total = Infinity;
  let pageSize = 1000; // try large first; the backend may cap it
  // Loop until we've collected EVERY client. Do NOT trust has_next / total_pages
  // / page_size honoring: the backend caps page_size (a large ?page_size=1000
  // comes back as ~20 rows) while still reporting has_next=false or a total_pages
  // computed off the requested size — which strands the roster at page 1 (20 of
  // 150) and made every direct-nav client route resolve to "not found". The
  // client count (`total`) is the only reliable stop condition, and we page with
  // the size the backend ACTUALLY applied so offsets line up even when it caps
  // our request. Guards: stop on an empty page, and a hard page cap.
  while (all.length < total) {
    const res = await fetchClients(page, pageSize, status);
    const batch = Array.isArray(res?.data) ? res.data : [];
    if (batch.length === 0) break;
    all = [...all, ...batch];
    const pg = res?.meta?.pagination;
    const reportedTotal = Number(pg?.total);
    if (Number.isFinite(reportedTotal)) total = reportedTotal;
    const appliedSize = Number(pg?.page_size);
    if (appliedSize > 0) pageSize = appliedSize;
    if (page >= 100) break;
    page += 1;
  }
  return all;
};