import { api } from "../../../api/api";

// Fetch Client Nomenclature
export const fetchClientNomen = async (page = 1) => {
  return await api(`/clients/admin/nomens/?page=${page}`, { method: "GET" });
};

// Create a Client Nomenclature.
// Same collection endpoint as the list — VERIFIED against the live API, which
// answers `Allow: GET, POST, HEAD, OPTIONS` on /clients/admin/nomens/. The new
// nomen starts with no client attached (has_client:false); a login is bound to
// it later through the onboarding wizard.
//
// ENVELOPE: { success, message, data } — the created row is on `.data`. A
// validation failure (duplicate name, "|" in the name) arrives as the standard
// field map, which the caller reads with utils/apiErrors.
export const createClientNomen = async (name) => {
  const res = await api(`/clients/admin/nomens/`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return res?.data ?? null;
};
