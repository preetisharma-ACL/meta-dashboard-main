import { api } from "../../../api/api";

// Fetch project display configuration
export const fetchProjectDisplayConfig = async (projectId) => {
  return await api(`/clients/admin/configs/`, { method: "GET" });
};




// Create project display config
export const createProjectDisplayConfig = async (payload) => {
  return await api(`/clients/admin/configs/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
};


// Update project display config
export const updateProjectDisplayConfig = async (
  id,
  payload,
) => {
  return await api(
    `/clients/admin/configs/${id}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
};

export const fetchClients = async (page = 1, pageSize = 20) => {
  return await api(
    `/clients/admin/clients?page=${page}&page_size=${pageSize}`,
    { method: "GET" }
  );
};

export const fetchProjects = async () => {
  let allProjects = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const res = await api(
      `/projects/?page=${page}&page_size=20`,
      {
        method: "GET",
      }
    );

    const projects = res?.data || [];

    allProjects = [...allProjects, ...projects];

    const pagination = res?.meta?.pagination;

    hasNext = pagination?.has_next || false;

    page++;
  }

  return allProjects;
};


/**
 * Fetches full markup config history for a specific client + project.
 * active_only=false ensures we get all versioned rows, not just current.
 *
 * @param {number} clientId - from campaign.premium_metrics.client_id
 * @param {number} projectId
 */
export const fetchConfigHistory = async (clientId, projectId) => {
  return await api(
    `/clients/admin/configs/?client_id=${clientId}&project_id=${projectId}&active_only=false`,
    { method: "GET" }
  );
};