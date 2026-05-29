import { api } from "../../../api/api";

// Fetch campaigns with optional filters

export const fetchCampaigns = async ({
  page = 1,
  search = "",
  status = "",
  startDate = "",
  stopDate = "",
  adAccountId = "",
  clientNomenId = "",
}) => {
  const params = new URLSearchParams();
  params.append("page", page);

  if (search) params.append("search", search);
  if (status && status !== "all") params.append("status", status);
  if (adAccountId && adAccountId !== "all")
    params.append("ad_account", adAccountId);
  if (clientNomenId && clientNomenId !== "all")
    params.append("client_nomen_id", clientNomenId);

  if (startDate && startDate !== "all") {
    const { from, to } = resolveDateRange(startDate);
    if (from) params.append("start_date_after", from);
    if (to) params.append("start_date_before", to);
  }
  if (stopDate && stopDate !== "all") {
    const { from, to } = resolveDateRange(stopDate);
    if (from) params.append("stop_date_after", from);
    if (to) params.append("stop_date_before", to);
  }

  return await api(`/campaigns/?${params.toString()}`, { method: "GET" });
};

const toYMD = (d) => d.toISOString().slice(0, 10);

export const resolveDateRange = (key) => {
  const now = new Date();
  const today = toYMD(now);
  if (key === "today") return { from: today, to: today };
  if (key === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const ymd = toYMD(d);
    return { from: ymd, to: ymd };
  }
  if (key === "last3") {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return { from: toYMD(d), to: today };
  }
  if (key === "last7") {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return { from: toYMD(d), to: today };
  }
  return { from: "", to: "" };
};
