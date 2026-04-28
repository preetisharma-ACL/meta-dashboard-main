import { api } from "../api/api";

export const fetchAlerts = async (page = 1) => {
  return await api(`/alerts/?page=${page}`, {
    method: "GET",
  });
};