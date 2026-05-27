import { api } from "../../../api/api";

// Fetch project display configuration
export const fetchProjectDisplayConfig = async (projectId) => {
  return await api(`/clients/admin/configs/`, { method: "GET" });
};
// Create project display config
export const createProjectDisplayConfig = async (payload) => {
  return await api(`/clients/admin/configs/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
};