import { createStore } from "solid-js/store";

export const CACHE_TTL = 5 * 60 * 1000;

export const isCacheStale = (lastFetched) => {
  if (!lastFetched) return true;
  return Date.now() - lastFetched > CACHE_TTL;
};

// ─── sessionStorage helpers ───────────────────────────────────────────────────
// sessionStorage is cleared when the browser tab closes — perfect scope for cache
const persist = (key, value) => {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

const hydrate = (key, fallback) => {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // Discard if stale so we don't serve 3-hour-old data after a reload
    if (isCacheStale(parsed.lastFetched)) return fallback;
    return parsed;
  } catch {
    return fallback;
  }
};

// ─── Dashboard ────────────────────────────────────────────────────────────────
const projectsDefault = {
  data: [],
  allProjects: [],
  meta: null,
  insightsMap: {},
  lastFetched: null,
  loading: false,
};

// Caching for projects is intentionally DISABLED (dashboard must always show
// fresh data for both client and admin views). The store below is kept purely
// as in-memory reactive state — it is never hydrated from nor persisted to
// sessionStorage, so every page load / reload starts empty and refetches.
export const [projectsCache, setProjectsCacheRaw] = createStore({
  ...projectsDefault,
});

// Drop any projects cache written by an earlier build so a stale blob from
// before caching was disabled can't be read back this session.
try {
  sessionStorage.removeItem("cache_projects");
} catch {}

// Wrap setter to keep the same call-site API. Persistence removed — writes only
// update the in-memory store, so no project data survives across reloads.
export const setProjectsCache = (keyOrPatch, value) => {
  if (typeof keyOrPatch === "string") {
    setProjectsCacheRaw(keyOrPatch, value);
  } else {
    setProjectsCacheRaw(keyOrPatch);
  }
};

// ─── Dashboard date filter (persists across page navigation) ─────────────────
// Kept here (not in the component) so the selected range survives unmount and
// stays in sync with the range-scoped data cache. Only an explicit Clear resets
// it. No TTL — a filter the user set shouldn't silently expire mid-session.
const dashboardFilterDefault = { fromDate: "", toDate: "", cardRange: null };

const hydrateFilter = () => {
  try {
    const raw = sessionStorage.getItem("dashboard_filter");
    return raw ? { ...dashboardFilterDefault, ...JSON.parse(raw) } : dashboardFilterDefault;
  } catch {
    return dashboardFilterDefault;
  }
};

export const [dashboardFilter, setDashboardFilterRaw] = createStore(hydrateFilter());

export const setDashboardFilter = (keyOrPatch, value) => {
  if (typeof keyOrPatch === "string") {
    setDashboardFilterRaw(keyOrPatch, value);
  } else {
    setDashboardFilterRaw(keyOrPatch);
  }
  queueMicrotask(() => persist("dashboard_filter", dashboardFilter));
};

export const resetDashboardFilter = () =>
  setDashboardFilter({ fromDate: "", toDate: "", cardRange: null });

// ─── Billing ──────────────────────────────────────────────────────────────────
const billingDefault = {
  overview: {},
  projects: [],
  lastFetched: null,
  loading: false,
};

export const [billingCache, setBillingCacheRaw] = createStore(
  hydrate("cache_billing", billingDefault),
);

export const setBillingCache = (keyOrPatch, value) => {
  if (typeof keyOrPatch === "string") {
    setBillingCacheRaw(keyOrPatch, value);
  } else {
    setBillingCacheRaw(keyOrPatch);
  }
  queueMicrotask(() => persist("cache_billing", billingCache));
};

// ─── Project Details (keyed by projectId) ────────────────────────────────────
// Caching disabled — kept purely as in-memory reactive state (no hydration, no
// persistence) so Project Details always fetches fresh data on every visit.
try {
  sessionStorage.removeItem("cache_project_details");
} catch {}

export const [projectDetailsCache, setProjectDetailsCacheRaw] = createStore({});

export const setProjectDetailsCache = (...args) => {
  setProjectDetailsCacheRaw(...args);
};

export const clearClientDashboardContext = () => {
  localStorage.removeItem("selectedClientNomen");
  localStorage.removeItem("selectedClientNomenId");
  localStorage.removeItem("selectedClientName");

  // Switching context starts a fresh view — drop any persisted date filter.
  resetDashboardFilter();

  setProjectsCache({
    data: [],
    allProjects: [],
    insightsMap: {},
    meta: null,
    lastFetched: 0,
    lastFetchedAll: 0,
    loading: false,
  });
};

// Project Details caching disabled — always stale so it refetches every time.
export const isProjectCacheStale = () => true;

// Projects caching is disabled — always report stale so the dashboard refetches
// fresh data on every mount (kept as a function so call sites stay unchanged).
export const isAllProjectsCacheStale = () => true;

// ─── Campaign Details (keyed by campaignId) ──────────────────────────────────
// Caching disabled — kept purely as in-memory reactive state (no hydration, no
// persistence) so Campaign Details always fetches fresh data on every visit.
try {
  sessionStorage.removeItem("cache_campaign_details");
} catch {}

export const [campaignDetailsCache, setCampaignDetailsCacheRaw] = createStore({});

export const setCampaignDetailsCache = (...args) => {
  setCampaignDetailsCacheRaw(...args);
};

// Campaign Details caching disabled — always stale so it refetches every time.
export const isCampaignCacheStale = () => true;

// ─── Header / User Cache ──────────────────────────────────────────────────────
const headerDefault = {
  user: null,
  notifications: [],
  lastFetched: null,
  loading: false,
};

export const [headerCache, setHeaderCacheRaw] = createStore(
  hydrate("cache_header", headerDefault),
);

export const setHeaderCache = (keyOrPatch, value) => {
  if (typeof keyOrPatch === "string") {
    setHeaderCacheRaw(keyOrPatch, value);
  } else {
    setHeaderCacheRaw(keyOrPatch);
  }
  queueMicrotask(() => persist("cache_header", headerCache));
};

export const isHeaderCacheStale = () => isCacheStale(headerCache.lastFetched);

// ─── Invalidation helpers ─────────────────────────────────────────────────────
export const invalidateProjectsCache = () => {
  setProjectsCache("lastFetched", null);
  sessionStorage.removeItem("cache_projects");
};

export const invalidateBillingCache = () => {
  setBillingCache("lastFetched", null);
  sessionStorage.removeItem("cache_billing");
};

export const invalidateProjectDetails = (projectId) => {
  setProjectDetailsCache(projectId, "lastFetched", null);
  sessionStorage.removeItem("cache_project_details");
};

export const invalidateCampaignDetails = (campaignId) => {
  setCampaignDetailsCache(campaignId, "lastFetched", null);
  sessionStorage.removeItem("cache_campaign_details");
};

// ─── Clear ALL cache on logout ────────────────────────────────────────────────
// Call this from your logout handler so stale data isn't served to the next user
export const clearAllCache = () => {
  [
    "cache_projects",
    "cache_billing",
    "cache_project_details",
    "cache_campaign_details",
    "cache_header",
    "dashboard_filter",
  ].forEach((k) => sessionStorage.removeItem(k));
};
