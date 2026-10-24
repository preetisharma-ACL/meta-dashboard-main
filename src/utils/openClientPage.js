import { setProjectsCache } from "../cacheStore/appStore";

// ─── Open a client's dashboard from Campaign Analysis / Dead Clients ──────────
// The client dashboard scopes everything off localStorage.selectedClientNomen
// (and, for CMs, selectedClientNomenId — /campaigns/ comes back UNSCOPED
// without it). Admin and sales re-derive both from the URL slug on arrival,
// but CMs and coordination do NOT: they read whatever was left there, so a
// bare navigate(`/${slug}`) opens the LAST client viewed under this one's URL.
//
// So: write the nomen and the nomen id the row itself carries (both
// /clients/command/ and /clients/dead/ serve client_nomen_id), drop the Client
// PK and name we can't vouch for (the admin resolver backfills them from the
// slug), bust the projects cache as Clients.jsx does, then navigate.
//
// No hierarchy lookup: the hierarchy hides dead clients by default, so it
// can't resolve a dead client opened with the Dead toggle on.
export const clientSlug = (nomen) =>
  String(nomen ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-");

export const openClientPage = (navigate, { nomen, nomenId } = {}) => {
  if (!nomen) return;
  localStorage.setItem("selectedClientNomen", nomen);
  if (nomenId != null && nomenId !== "") {
    localStorage.setItem("selectedClientNomenId", String(nomenId));
  } else {
    localStorage.removeItem("selectedClientNomenId");
  }
  localStorage.removeItem("selectedClientId");
  localStorage.removeItem("selectedClientName");

  setProjectsCache("lastFetched", 0);
  setProjectsCache("lastFetchedAll", 0);
  setProjectsCache("allProjects", []);
  setProjectsCache("insightsMap", {});
  setProjectsCache("data", []);

  navigate(`/${clientSlug(nomen)}`);
};
