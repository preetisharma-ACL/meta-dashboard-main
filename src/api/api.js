const BASE_URL = "https://metadashboard.aajneeticonnectltd.com/api";

let isRefreshing = false;
let refreshPromise = null;

export async function api(endpoint, options = {}) {
  let auth = JSON.parse(localStorage.getItem("auth") || "null");
  let token = auth?.token;

  const makeRequest = async (tokenToUse) => {
    let headers = {
      ...(tokenToUse && { Authorization: "Bearer " + tokenToUse }),
      ...options.headers,
    };

    // ✅ Only add JSON header if not FormData
    if (!(options.body instanceof FormData)) {
      headers["Content-Type"] = "application/json";
    }

    return fetch(BASE_URL + endpoint, {
      ...options,
      headers,
    });
  };

  try {
    let res = await makeRequest(token);

    // 🔥 If token expired → try refresh
    if (res.status === 401 && auth?.refreshToken) {

      if (isRefreshing && refreshPromise) {
        await refreshPromise;
      } else {
        isRefreshing = true;

        refreshPromise = (async () => {
          try {
            const latestAuth = JSON.parse(localStorage.getItem("auth") || "null");

            const refreshRes = await fetch(BASE_URL + "/auth/refresh/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                refresh: latestAuth?.refreshToken,
              }),
            });

            let refreshData;
            try {
              refreshData = await refreshRes.json();
            } catch {
              refreshData = null;
            }

            if (!refreshRes.ok) throw new Error("Refresh failed");

            // ✅ Support both response formats
            const newToken = refreshData?.access || refreshData?.access_token;

            if (!newToken) {
              throw new Error("No access token in refresh response");
            }

            auth.token = newToken;
            const updatedAuth = {
              ...latestAuth,
              token: newToken,
            };
            localStorage.setItem("auth", JSON.stringify(updatedAuth));

          } catch (err) {
            localStorage.removeItem("auth");
            window.location.href = "/login";
            throw err;
          }
          finally {
            isRefreshing = false;
            refreshPromise = null;
          }
        })();
        await refreshPromise;
      }

      // 🔁 Retry original request with new token
      auth = JSON.parse(localStorage.getItem("auth") || "null");
      res = await makeRequest(auth?.token);

      // Still unauthorized → logout
      if (res.status === 401) {
        localStorage.removeItem("auth");
        window.location.href = "/login";
        return;
      }
    }

    // ✅ Safe JSON parsing
    let data;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      throw new Error(data?.message || "API Error");
    }
    return data;

  } catch (error) {
    console.error("API ERROR:", error);
    throw error;
  }
}