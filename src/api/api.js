const BASE_URL = "/api";

export async function api(endpoint, options = {}) {
  const auth = JSON.parse(localStorage.getItem("auth"));
  const token = auth?.token;

  try {
    const res = await fetch(BASE_URL + endpoint, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token && { Authorization: "Bearer " + token }),
        ...options.headers,
      },
    });

    // ✅ Safely parse JSON — don't crash on empty responses
    let data = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }

    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem("auth");
      window.location.href = "/login";
      return;
    }

    if (!res.ok) {
      throw new Error(data?.message || data?.detail || "API Error");
    }

    return data;

  } catch (error) {
    console.error("API ERROR:", error);
    throw error;
  }
}