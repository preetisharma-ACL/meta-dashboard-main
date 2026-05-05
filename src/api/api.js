const BASE_URL = "https://metadashboard.aajneeticonnectltd.com/api";

let isRefreshing = false;
let refreshPromise = null;

// ✅ Decode JWT expiry from token
const getTokenExpiry = (token) => {
    try {
        const payload = JSON.parse(atob(token.split(".")[1]));
        return payload.exp * 1000;
    } catch {
        return null;
    }
};

// ✅ Proactively refresh if token expires within 30 seconds
const isTokenExpiredOrExpiringSoon = (auth) => {
    if (!auth?.tokenExpiresAt) return false;
    return Date.now() > auth.tokenExpiresAt - 30000;
};

const doRefresh = async () => {
    if (!isRefreshing) {
        isRefreshing = true;
        refreshPromise = (async () => {
            try {
                const latestAuth = JSON.parse(localStorage.getItem("auth") || "null");

                if (!latestAuth?.refreshToken) {
                    throw new Error("No refresh token available");
                }

                const refreshRes = await fetch(BASE_URL + "/auth/refresh/", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ refresh: latestAuth.refreshToken }),
                });

                let refreshData = null;
                try { refreshData = await refreshRes.json(); } catch {}

                if (!refreshRes.ok) throw new Error("Refresh failed");

                const newToken = refreshData?.access || refreshData?.access_token;
                if (!newToken) throw new Error("No access token in refresh response");

                const updatedAuth = {
                    ...latestAuth,
                    token: newToken,
                    tokenExpiresAt: getTokenExpiry(newToken),
                };
                localStorage.setItem("auth", JSON.stringify(updatedAuth));

                // ✅ Notify other tabs
                try {
                    const channel = new BroadcastChannel("token_refresh");
                    channel.postMessage({ type: "TOKEN_REFRESHED", token: newToken });
                    channel.close();
                } catch {}

            } catch (err) {
                localStorage.removeItem("auth");
                window.location.href = "/login";
                throw err;
            } finally {
                isRefreshing = false;
                refreshPromise = null;
            }
        })();
    }

    await refreshPromise;
};

export async function api(endpoint, options = {}) {
    // Safety cleanup
    if (!isRefreshing && refreshPromise) {
        refreshPromise = null;
    }

    let auth = JSON.parse(localStorage.getItem("auth") || "null");

    // ✅ Proactively refresh before request if token is expiring soon
    if (isTokenExpiredOrExpiringSoon(auth) && auth?.refreshToken) {
        try {
            await doRefresh();
            auth = JSON.parse(localStorage.getItem("auth") || "null");
        } catch {
            return;
        }
    }

    const makeRequest = async (tokenToUse) => {
        const headers = {
            ...(tokenToUse && { Authorization: "Bearer " + tokenToUse }),
            ...options.headers,
        };
        if (!(options.body instanceof FormData)) {
            headers["Content-Type"] = "application/json";
        }
        return fetch(BASE_URL + endpoint, { ...options, headers });
    };

    try {
        let res = await makeRequest(auth?.token);

        // ✅ Token rejected by server → try refresh
        if (res.status === 401 && auth?.refreshToken) {
            try {
                await doRefresh();
            } catch {
                return;
            }

            auth = JSON.parse(localStorage.getItem("auth") || "null");
            res = await makeRequest(auth?.token);

            // Still failing after refresh → force logout
            if (res.status === 401) {
                localStorage.removeItem("auth");
                window.location.href = "/login";
                return;
            }
        }

        // ✅ Parse response
        let data = null;
        try { data = await res.json(); } catch {}

        if (!res.ok) throw new Error(data?.message || "API Error");

        return data;

    } catch (error) {
        // ✅ Don't logout on network failure
        if (error.message === "Failed to fetch") {
            console.warn("Network error — not logging out");
            throw error;
        }
        console.error("API ERROR:", error);
        throw error;
    }
}