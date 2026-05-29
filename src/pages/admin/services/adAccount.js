import { api } from "../../../api/api";

export const fetchAdAccounts = async () => {
  return await api("/campaigns/admin/ad-accounts/", { method: "GET" });
};