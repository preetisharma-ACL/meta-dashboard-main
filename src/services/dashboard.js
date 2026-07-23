import { api } from "../api/api";
import { fetchFedLeadBatches } from "./fedLeads";

const getClientNomen = () => {
  const auth = JSON.parse(localStorage.getItem("auth") || "{}");

  // Admins AND campaign managers view clients through a switchable context, so
  // both scope off selectedClientNomen. A CM is not a client — auth.clientNomen
  // is null for them — so gating this on admin alone sent no client_nomen at all
  // and the request came back with the CM's whole book of business (every client
  // they manage) under one client's page. A CM passing client_nomen still can't
  // widen past their own scope: the backend intersects the two.
  // Sales views clients through the same switchable context; backend intersects
  // with their onboarded scope, so this can never widen.
  if (
    auth?.role === "admin" ||
    auth?.role === "campaign_manager" ||
    auth?.role === "sales"
  ) {
    return localStorage.getItem("selectedClientNomen") || null;
  }

  return auth?.clientNomen || null;
};

export const fetchProjects = async (
  page = 1,
  search = "",
  pageSize = 20,
  clientId = null,
) => {
  let url = `/projects/?page=${page}&page_size=${pageSize}`;

  if (search) {
    url += `&search=${search}`;
  }

  // An explicit client_id (the admin Daily Report's client picker) scopes the
  // list to that one client and makes the backend return its per-client
  // meta.report_summary (client_type + service_charge). It takes precedence over
  // the global selectedClientNomen so the picker is authoritative.
  if (clientId != null && clientId !== "") {
    url += `&client_id=${encodeURIComponent(clientId)}`;
  } else {
    const selectedClientNomen = localStorage.getItem("selectedClientNomen");
    if (selectedClientNomen) {
      url += `&client_nomen=${selectedClientNomen}`;
    }
  }

  return await api(url, {
    method: "GET",
  });
};

// Manual (fed) lead batches for the client currently in context. Delegates to
// the shared fed-leads service so the fetch is paginated — a single page
// silently truncated the roll-up once a client had enough batches — and so every
// surface reads batches the same way. Returns the usual { data } envelope shape
// the callers already unwrap.
export const fetchManualBatches = async () => {
  const rows = await fetchFedLeadBatches({ clientNomen: getClientNomen() });
  return { data: rows };
};


