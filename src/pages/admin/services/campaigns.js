import { api } from "../../../api/api";

// ── Local-safe date string (avoids UTC midnight shift) ─────────────────────
const toLocalYMD = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Resolve preset keys → { from, to } as YYYY-MM-DD strings
export const resolveDateRange = (key) => {
  const now = new Date();
  const today = toLocalYMD(now);

  if (key === "today") return { from: today, to: today };

  if (key === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const ymd = toLocalYMD(d);
    return { from: ymd, to: ymd };
  }

  if (key === "last3days") {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return { from: toLocalYMD(d), to: today };
  }

  if (key === "last7days") {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return { from: toLocalYMD(d), to: today };
  }

  if (key === "lastMonth") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: toLocalYMD(start), to: toLocalYMD(end) };
  }

  return { from: "", to: "" };
};

export const fetchCampaigns = async ({
  page = 1,
  pageSize,           // optional — bigger pages → far fewer round-trips
  search = "",
  status = "",
  startedFrom = "",   // YYYY-MM-DD — filters by campaign launch date
  startedTo = "",     // YYYY-MM-DD
  adAccountId = "",
  clientNomenId = "",
} = {}) => {
  const params = new URLSearchParams();
  params.append("page", page);
  if (pageSize)                            params.append("page_size", pageSize);

  if (search)                              params.append("search", search);
  if (status && status !== "all")          params.append("status", status);
  if (adAccountId && adAccountId !== "all")
                                           params.append("ad_account", adAccountId);
  if (clientNomenId && clientNomenId !== "all")
                                           params.append("client_nomen_id", clientNomenId);

  // ── Campaign launch date filter (started_after / started_before) ──────────
  if (startedFrom) params.append("started_after", startedFrom);
  if (startedTo)   params.append("started_before", startedTo);

  return await api(`/campaigns/?${params.toString()}`, { method: "GET" });
};

// ── Full sweep of every campaign, cached in-memory for a short TTL ───────────
// The /campaigns/ endpoint ignores the ad_account filter, so the Ad Accounts
// pages need the whole set to group locally. Requesting large pages turns what
// used to be dozens of tiny requests into one or two, and the cache means the
// list page → detail page navigation reuses the same data instead of re-sweeping.
let _allCampaigns = null;
let _allCampaignsAt = 0;
const ALL_CAMPAIGNS_TTL = 5 * 60 * 1000;

export const fetchAllAdminCampaigns = async ({ force = false } = {}) => {
  if (!force && _allCampaigns && Date.now() - _allCampaignsAt < ALL_CAMPAIGNS_TTL)
    return _allCampaigns;

  const PAGE_SIZE = 1000;
  const first = await fetchCampaigns({ page: 1, pageSize: PAGE_SIZE });
  const firstRaw =
    first.data?.results ?? (Array.isArray(first.data) ? first.data : []);
  const totalPages =
    first.data?.meta?.pagination?.total_pages ??
    first.meta?.pagination?.total_pages ??
    1;

  let all = [...firstRaw];
  for (let p = 2; p <= totalPages; p += 10) {
    const batch = [];
    for (let b = p; b < p + 10 && b <= totalPages; b++)
      batch.push(fetchCampaigns({ page: b, pageSize: PAGE_SIZE }));
    const results = await Promise.all(batch);
    results.forEach((r) => {
      const raw = r.data?.results ?? (Array.isArray(r.data) ? r.data : []);
      all = all.concat(raw);
    });
  }

  _allCampaigns = all;
  _allCampaignsAt = Date.now();
  return all;
};

export const invalidateAllAdminCampaigns = () => {
  _allCampaigns = null;
  _allCampaignsAt = 0;
};