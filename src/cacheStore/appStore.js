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
    } catch { }
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
const projectsDefault = { data: [], meta: null, insightsMap: {}, lastFetched: null, loading: false };

export const [projectsCache, setProjectsCacheRaw] = createStore(
    hydrate("cache_projects", projectsDefault)
);

// Wrap setter to auto-persist on every write
export const setProjectsCache = (keyOrPatch, value) => {
    if (typeof keyOrPatch === "string") {
        setProjectsCacheRaw(keyOrPatch, value);
    } else {
        setProjectsCacheRaw(keyOrPatch);
    }
    // Persist after the tick so the store has updated
    queueMicrotask(() => persist("cache_projects", projectsCache));
};

// ─── Billing ──────────────────────────────────────────────────────────────────
const billingDefault = { overview: {}, projects: [], lastFetched: null, loading: false };

export const [billingCache, setBillingCacheRaw] = createStore(
    hydrate("cache_billing", billingDefault)
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
export const [projectDetailsCache, setProjectDetailsCacheRaw] = createStore(
    hydrate("cache_project_details", {}) ?? {}
);

export const setProjectDetailsCache = (...args) => {
    setProjectDetailsCacheRaw(...args);
    queueMicrotask(() => persist("cache_project_details", projectDetailsCache));
};

export const isProjectCacheStale = (projectId) =>
    isCacheStale(projectDetailsCache[projectId]?.lastFetched ?? null);

// ─── Campaign Details (keyed by campaignId) ──────────────────────────────────
export const [campaignDetailsCache, setCampaignDetailsCacheRaw] = createStore(
    hydrate("cache_campaign_details", {}) ?? {}
);

export const setCampaignDetailsCache = (...args) => {
    setCampaignDetailsCacheRaw(...args);
    queueMicrotask(() => persist("cache_campaign_details", campaignDetailsCache));
};

export const isCampaignCacheStale = (campaignId) =>
    isCacheStale(campaignDetailsCache[campaignId]?.lastFetched ?? null);


// ─── Header / User Cache ──────────────────────────────────────────────────────
const headerDefault = {
    user: null,
    notifications: [],
    lastFetched: null,
    loading: false,
};

export const [headerCache, setHeaderCacheRaw] = createStore(
    hydrate("cache_header", headerDefault)
);

export const setHeaderCache = (keyOrPatch, value) => {
    if (typeof keyOrPatch === "string") {
        setHeaderCacheRaw(keyOrPatch, value);
    } else {
        setHeaderCacheRaw(keyOrPatch);
    }
    queueMicrotask(() => persist("cache_header", headerCache));
};

export const isHeaderCacheStale = () =>
    isCacheStale(headerCache.lastFetched);



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
    ["cache_projects", "cache_billing", "cache_project_details", "cache_campaign_details", "cache_header"]
        .forEach(k => sessionStorage.removeItem(k));
};