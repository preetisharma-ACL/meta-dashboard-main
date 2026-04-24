import { api } from "../api/api";

// ✅ Login API (POST)
export const loginUser = async (email, password) => {
  return await api("/auth/login/", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
    }),
  });
};