const BASE_URL = import.meta.env.VITE_API_BASE_URL;

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

    const data = await res.json();

    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem("auth");
      window.location.href = "/login";
      return;
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