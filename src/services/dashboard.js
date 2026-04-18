import { api } from "../api/api";

// 🔥 Fetch campaigns / profiles
export const fetchProfiles = async () => {
  return await api("/projects", {
    method: "GET",
  });
};