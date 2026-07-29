import { api } from "../../../api/api";

export const fetchManualBatches = async (page = 1, pageSize) => {
  const qs = pageSize ? `?page=${page}&page_size=${pageSize}` : `?page=${page}`;
  return await api(`/leads/manual-batches/${qs}`, { method: "GET" });
};

export const createManualBatch = async (payload) => {
  return await api(`/leads/manual-batches/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
};