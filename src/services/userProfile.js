import { api } from "../api/api";

// ✅ Fetch logged-in user data
export const fetchUser = async () => {
  return await api("/auth/me", {
    method: "GET",
  });
};