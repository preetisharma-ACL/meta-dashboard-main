import { api } from "../api/api";

const getClientNomen = () => {
  const auth = JSON.parse(localStorage.getItem("auth") || "{}");

  if (auth?.role === "admin") {
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

export const fetchManualBatches = async () => {
  const clientNomen = getClientNomen();

  let url = `/leads/manual-batches/`;

  if (clientNomen) {
    url += `?client_nomen=${clientNomen}`;
  }

  return await api(url, {
    method: "GET",
  });
};


