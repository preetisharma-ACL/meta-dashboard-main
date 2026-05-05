const BASE_URL = "https://metadashboard.aajneeticonnectltd.com/api";

// ── Deployment stamp: bump this string on every production deploy ──
// It clears stale localStorage tokens automatically.
const DEPLOY_STAMP = "v1.0.1"; // ← change this on each deploy

const getTokenExpiry = (token) => {
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        return payload.exp * 1000;
    } catch {
        return null;
    }
};

const isTokenExpiredOrExpiringSoon = (auth) => {
    if (!auth?.tokenExpiresAt) return false;
    return Date.now() > auth.tokenExpiresAt - 30_000;
};

// ── Stale-token guard: runs once on module load ──
(() => {
    const savedStamp = localStorage.getItem("deploy_stamp");
    if (savedStamp !== DEPLOY_STAMP) {
        localStorage.removeItem("auth");
        localStorage.setItem("deploy_stamp", DEPLOY_STAMP);
        console.info("[api] New deployment detected — cleared stale auth tokens.");
    }
})();

// ── Refresh lock: one Promise shared across ALL concurrent callers ──
let refreshPromise = null; // null means "not refreshing"

const doRefresh = () => {
    // If a refresh is already in flight, reuse it — never start a second one
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
        try {
            const latestAuth = JSON.parse(localStorage.getItem("auth") || "null");

            if (!latestAuth?.refreshToken) {
                throw new Error("No refresh token available");
            }

            const refreshRes = await fetch(`${BASE_URL}/auth/refresh/`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ refresh: latestAuth.refreshToken }),
            });

            let refreshData = null;
            try { refreshData = await refreshRes.json(); } catch {}

            if (!refreshRes.ok) {
                throw new Error(
                    refreshData?.detail || refreshData?.message || "Token refresh failed"
                );
            }

            const newToken = refreshData?.access ?? refreshData?.access_token;
            if (!newToken) throw new Error("No access token in refresh response");

            const updatedAuth = {
                ...latestAuth,
                token: newToken,
                tokenExpiresAt: getTokenExpiry(newToken),
            };
            localStorage.setItem("auth", JSON.stringify(updatedAuth));

            // Notify other tabs
            try {
                const ch = new BroadcastChannel("token_refresh");
                ch.postMessage({ type: "TOKEN_REFRESHED", token: newToken });
                ch.close();
            } catch {}

        } catch (err) {
            // Refresh failed for real → log out
            console.error("[api] Refresh failed:", err.message);
            localStorage.removeItem("auth");
            window.location.href = "/login";
            throw err; // re-throw so callers know it failed

        } finally {
            refreshPromise = null; // ← unlock AFTER all awaiters have resumed
        }
    })();

    return refreshPromise;
};

const buildHeaders = (token, options) => {
    const headers = {
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
    };
    if (!(options.body instanceof FormData)) {
        headers["Content-Type"] = "application/json";
    }
    return headers;
};

export async function api(endpoint, options = {}) {
    let auth = JSON.parse(localStorage.getItem("auth") || "null");

    // Proactively refresh before the request if token is about to expire
    if (isTokenExpiredOrExpiringSoon(auth) && auth?.refreshToken) {
        try {
            await doRefresh();
            auth = JSON.parse(localStorage.getItem("auth") || "null");
        } catch {
            // doRefresh already redirects to /login; just stop here
            return;
        }
    }

    const makeRequest = (token) =>
        fetch(`${BASE_URL}${endpoint}`, {
            ...options,
            headers: buildHeaders(token, options),
        });

    try {
        let res = await makeRequest(auth?.token);

        // Server rejected token → attempt one refresh then retry
        if (res.status === 401 && auth?.refreshToken) {
            try {
                await doRefresh();
            } catch {
                return; // already redirected
            }

            auth = JSON.parse(localStorage.getItem("auth") || "null");
            res = await makeRequest(auth?.token);

            if (res.status === 401) {
                // Still failing after a fresh token — force logout
                console.error("[api] Still 401 after token refresh — logging out");
                localStorage.removeItem("auth");
                window.location.href = "/login";
                return;
            }
        }

        let data = null;
        try { data = await res.json(); } catch {}

        if (!res.ok) throw new Error(data?.message || data?.detail || "API Error");

        return data;

    } catch (error) {
        if (error.message === "Failed to fetch") {
            console.warn("[api] Network error — not logging out");
            throw error;
        }
        console.error("[api] Error:", error.message);
        throw error;
    }
}