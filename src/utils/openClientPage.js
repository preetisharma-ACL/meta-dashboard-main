import { setProjectsCache } from "../cacheStore/appStore";
import { fetchHierarchyClients } from "../services/cm";

// ─── Open a client's dashboard from a screen that only knows the nomen ────────
// The client dashboard scopes everything off localStorage.selectedClientNomen
// (and, for CMs, selectedClientNomenId — /campaigns/ comes back UNSCOPED
// without it). Admin and sales re-derive both from the URL slug on arrival,
// but CMs and coordination do NOT: they read whatever was left there, so a
// bare navigate(`/${slug}`) opens the LAST client viewed under this one's URL.
//
// So: write the nomen, drop the ids we can't vouch for (nomen id and Client PK
// are different numbers, and a wrong one silently scopes to someone else), and
// for a CM use the nomen id the caller hands us (Dead Clients rows carry
// client_nomen_id) or else look it up in their hierarchy — the same source the
// Clients screen uses. Then bust the projects cache (as Clients.jsx does before
// its click-through) and navigate. The admin resolver backfills its own ids.
export const clientSlug = (nomen) =>
  String(nomen ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-");

const role = () => {
  try {
    return JSON.parse(localStorage.getItem("auth") || "{}")?.role ?? null;
  } catch {
    return null;
  }
};

// { nomenId } from the CM hierarchy, matched on Client PK first, then nomen.
const resolveForCM = async (nomen, pk) => {
  try {
    const res = await fetchHierarchyClients();
    const rows = Array.isArray(res?.data) ? res.data : [];
    const hit =
      (pk != null && rows.find((c) => String(c.client_id) === String(pk))) ||
      rows.find((c) => clientSlug(c.client_name) === clientSlug(nomen));
    return hit?.client_nomen_id != null ? String(hit.client_nomen_id) : null;
  } catch (err) {
    console.error("openClientPage: hierarchy lookup failed", err);
    return null;
  }
};

export const openClientPage = async (navigate, { nomen, pk, nomenId } = {}) => {
  if (!nomen) return;
  localStorage.setItem("selectedClientNomen", nomen);
  localStorage.removeItem("selectedClientNomenId");
  localStorage.removeItem("selectedClientId");
  localStorage.removeItem("selectedClientName");

  if (role() === "campaign_manager") {
    const id = nomenId != null ? String(nomenId) : await resolveForCM(nomen, pk);
    if (id) localStorage.setItem("selectedClientNomenId", id);
  }

  setProjectsCache("lastFetched", 0);
  setProjectsCache("lastFetchedAll", 0);
  setProjectsCache("allProjects", []);
  setProjectsCache("insightsMap", {});
  setProjectsCache("data", []);

  navigate(`/${clientSlug(nomen)}`);
};
