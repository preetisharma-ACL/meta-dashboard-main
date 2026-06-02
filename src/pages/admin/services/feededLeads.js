import { api } from "../../../api/api";

export const fetchManualBatches = async (page = 1) => {
  return await api(`/leads/manual-batches/?page=${page}`, { method: "GET" });
};

export const createManualBatch = async (payload) => {
  return await api(`/leads/manual-batches/`, {
    method: "POST",
    body: payload,
  });
};