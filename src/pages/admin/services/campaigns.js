import { api } from "../../../api/api";

// ── Local-safe date string (avoids UTC midnight shift) ─────────────────────
const toLocalYMD = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Resolve preset keys → { from, to } as YYYY-MM-DD strings
export const resolveDateRange = (key) => {
  const now = new Date();
  const today = toLocalYMD(now);

  if (key === "today") return { from: today, to: today };

  if (key === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    const ymd = toLocalYMD(d);
    return { from: ymd, to: ymd };
  }

  if (key === "last3days") {
    const d = new Date();
    d.setDate(d.getDate() - 2);
    return { from: toLocalYMD(d), to: today };
  }

  if (key === "last7days") {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return { from: toLocalYMD(d), to: today };
  }

  if (key === "lastMonth") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: toLocalYMD(start), to: toLocalYMD(end) };
  }

  return { from: "", to: "" };
};

export const fetchCampaigns = async ({
  page = 1,
  search = "",
  status = "",
  startedFrom = "",   // YYYY-MM-DD — filters by campaign launch date
  startedTo = "",     // YYYY-MM-DD
  adAccountId = "",
  clientNomenId = "",
} = {}) => {
  const params = new URLSearchParams();
  params.append("page", page);

  if (search)                              params.append("search", search);
  if (status && status !== "all")          params.append("status", status);
  if (adAccountId && adAccountId !== "all")
                                           params.append("ad_account", adAccountId);
  if (clientNomenId && clientNomenId !== "all")
                                           params.append("client_nomen_id", clientNomenId);

  // ── Campaign launch date filter (started_after / started_before) ──────────
  if (startedFrom) params.append("started_after", startedFrom);
  if (startedTo)   params.append("started_before", startedTo);

  return await api(`/campaigns/?${params.toString()}`, { method: "GET" });
};