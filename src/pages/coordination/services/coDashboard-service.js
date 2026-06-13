import { api } from "../../../api/api"

// ─────────────────────────────────────────────────────────────────────────────
// Coordination Team — Payments Overview service
//
// Mirrors the structure of services/dashboard.js: named async exports that
// build a query string and delegate to the shared `api` wrapper. The /billing
// prefix is assumed to live in the api base the same way /projects/ does for
// fetchProjects (i.e. the base already includes /api). If your base does NOT
// include /billing, change the path below to "/billing/admin/payments-overview/".
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch the all-clients payments overview for a given month.
 *
 * @param {string} [month]    "YYYY-MM". Omit to let the server default to the
 *                            current month.
 * @param {boolean} [refresh] When true, appends &refresh=1 to bypass the
 *                            server's 10-min cache (slower ~6s recompute).
 * @returns {Promise<object>} The raw API response: { success, message, data }.
 */
export const fetchPaymentsOverview = async (month = "", refresh = false) => {
  let url = `/billing/admin/payments-overview/`;

  const params = [];
  if (month) params.push(`month=${encodeURIComponent(month)}`);
  if (refresh) params.push(`refresh=1`);
  if (params.length) url += `?${params.join("&")}`;

  return await api(url, {
    method: "GET",
  });
};