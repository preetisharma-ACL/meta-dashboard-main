const BASE_URL = "https://metadashboard.aajneeticonnectltd.com/api";

const DEPLOY_STAMP = "v1.0.1";

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

// ── Stale-token guard ──
(() => {
    const savedStamp = localStorage.getItem("deploy_stamp");
    if (savedStamp !== DEPLOY_STAMP) {
        localStorage.removeItem("auth");
        localStorage.setItem("deploy_stamp", DEPLOY_STAMP);
        console.info("[api] New deployment — cleared stale auth.");
    }
})();

// ── Soft logout ──────────────────────────────────────────────────────────────
// FIX: clearAllCache equivalent — wipe sessionStorage so stale API data
// doesn't survive into the next login session. Previously softLogout only
// removed the auth key from localStorage, leaving the cache intact. When the
// user logged back in, dashboard components saw the cached (now-stale) data
// and never fired new API calls.
const softLogout = (reason = "session_expired") => {
    console.warn("[api] Logging out:", reason);
    localStorage.removeItem("auth");

    // Clear all sessionStorage cache so the next login starts fresh.
    // This mirrors what handleLogout (hard logout) does via clearAllCache().
    try {
        sessionStorage.clear();
    } catch (e) {
        console.warn("[api] Could not clear sessionStorage:", e);
    }

    // Dispatch event — App.jsx catches this and calls navigate("/login")
    window.dispatchEvent(new CustomEvent("auth-logout", { detail: { reason } }));
};

let refreshPromise = null;

const doRefresh = () => {
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

            try {
                const ch = new BroadcastChannel("token_refresh");
                ch.postMessage({ type: "TOKEN_REFRESHED", token: newToken });
                ch.close();
            } catch {}

        } catch (err) {
            console.error("[api] Refresh failed:", err.message);
            softLogout("refresh_failed");
            throw err;
        } finally {
            refreshPromise = null;
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

    if (isTokenExpiredOrExpiringSoon(auth) && auth?.refreshToken) {
        try {
            await doRefresh();
            auth = JSON.parse(localStorage.getItem("auth") || "null");
        } catch {
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

        if (res.status === 401 && auth?.refreshToken) {
            try {
                await doRefresh();
            } catch {
                return;
            }

            auth = JSON.parse(localStorage.getItem("auth") || "null");
            res = await makeRequest(auth?.token);

            if (res.status === 401) {
                console.error("[api] Still 401 after refresh — logging out");
                softLogout("401_after_refresh");
                return;
            }
        }

        let data = null;
        try { data = await res.json(); } catch {}

        if (!res.ok) throw new Error(data?.message || data?.detail || "API Error");

        return data;

    } catch (error) {
        if (error.message === "Failed to fetch") {
            console.warn("[api] Network error");
            throw error;
        }
        console.error("[api] Error:", error.message);
        throw error;
    }
}