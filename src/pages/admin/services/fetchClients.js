import { api } from "../../../api/api";

// Fetch paginated clients list. The trailing slash before the query matches the
// convention of every other endpoint here (`/path/?query`) and avoids an
// APPEND_SLASH 301 round-trip. (The redirect preserves the query string either
// way, so this is convention/efficiency, not correctness.)
// `status` narrows to one engagement bucket (active | hold | completed | unset)
// server-side; omit it — or pass "all" — for every client. It is the same param
// the status board accepts, so the two surfaces filter identically.
// `activity` narrows to clients whose campaigns are currently running | paused.
// DIFFERENT AXIS from `status`: that one is the manual engagement label, this one
// is derived from live campaigns (see services/campaignActivity.js). They compose
// — passing both asks for "marked Active but nothing running".
export const fetchClients = async (page = 1, pageSize = 20, status, activity) => {
  let url = `/clients/admin/clients/?page=${page}&page_size=${pageSize}`;
  if (status && status !== "all") {
    url += `&status=${encodeURIComponent(status)}`;
  }
  if (activity && activity !== "all") {
    url += `&activity=${encodeURIComponent(activity)}`;
  }
  return await api(url, { method: "GET" });
};

// Sweep every page and return the flat client list. Used where we need the whole
// roster in one shot (e.g. the authoritative is_active / client_type set that the
// admin "Campaign Managers' Clients" section joins against the per-CM own-client
// lists). Large page size keeps this to as few round-trips as possible.
export const fetchAllAdminClients = async ({ status, activity } = {}) => {
  let page = 1;
  let all = [];
  let total = Infinity;
  let pageSize = 1000; // one round-trip at today's roster size
  // Loop until we've collected EVERY client, paging with the size the backend
  // ACTUALLY applied rather than the one we asked for, and stopping on the
  // client count (`total`) rather than has_next / total_pages.
  //
  // HISTORY, so the next reader doesn't chase a cap that is gone: this sweep
  // was written when ?page_size was ignored outright — page_size_query_param
  // was unset, so DRF fell back to its default of 20 while still reporting no
  // next page, which stranded the roster at 20 of 150 and made every
  // direct-nav client route resolve to "not found". Both settings are in place
  // now: StandardPageNumberPagination sets page_size_query_param and allows up
  // to max_page_size 10000, so ?page_size=500 returns all 188 clients in one
  // page (confirmed live 2026-09-21). Callers that ask for a single large page
  // — the config screen's client picker does — are fine at this roster size.
  //
  // The loop stays because it is the shape that survives crossing 10000, and
  // because reading the applied page_size costs nothing when it matches the
  // requested one. Guards: stop on an empty page, and a hard page cap.
  while (all.length < total) {
    const res = await fetchClients(page, pageSize, status, activity);
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