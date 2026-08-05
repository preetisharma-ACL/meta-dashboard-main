import { api } from "../api/api";

// ✅ Fetch client type
export const fetchClientType = async () => {
  return await api("/clients/me/", {
    method: "GET",
  });
};

// GET /api/clients/me/team/ — the people looking after this client's account.
// Client-token only (404s for every other role). Shape:
//   { campaign_managers: [Contact], coordination_team: [Contact],
//     head_of_operations: Contact | null }
// where Contact = { name, designation, phone, whatsapp, email, photo_url, intro }.
//
// The response is returned unwrapped for whichever envelope the backend uses:
// most endpoints here answer { success, data: {...} }, a few answer the object
// flat. Normalising once means the page only ever sees the three keys, and the
// group arrays are always arrays even if a key is missing altogether.
export const getMyTeam = async () => {
  const res = await api("/clients/me/team/", { method: "GET" });
  const body = res?.data ?? res ?? {};

  const asList = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

  return {
    campaign_managers: asList(body.campaign_managers),
    coordination_team: asList(body.coordination_team),
    head_of_operations: body.head_of_operations || null,
  };
};