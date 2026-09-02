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

/**
 * Preview what a client's CPL would become under a given markup rule —
 * across 3 time windows (current month, last 7 days, last 3 days) — WITHOUT
 * saving anything. Sends exactly ONE rule param matching ruleType; the backend
 * errors if more than one is present.
 *
 * @param {object} args
 * @param {number|string} args.clientId
 * @param {number|string} args.projectId
 * @param {string} args.ruleType - one of cpl_markup_pct | cpl_markup_flat | target_cpl | fixed_cpl
 * @param {number|string} args.ruleValue - the current Rule Value
 */
export const previewClientCpl = async ({
  clientId,
  projectId,
  ruleType,
  ruleValue,
}) => {
  const params = new URLSearchParams({
    client_id: clientId,
    project_id: projectId,
  });
  // Exactly one rule param — the one matching the selected Rule Type.
  params.set(ruleType, ruleValue);

  return await api(`/clients/admin/configs/preview-cpl/?${params.toString()}`, {
    method: "GET",
  });
};

/**
 * Resolve the billing rule the config form should pre-fill for a client+project
 * pair. The backend owns the whole resolution (existing → inherited → default),
 * gated by client_type. Returns:
 *   { rule_type, rule_value, rule_value_unit, source, client_type, is_active }
 *   • rule_type: fixed_cpl | cpl_markup_pct | cpl_markup_flat | target_cpl | null
 *   • rule_value: string, or null for inherited/default (enter fresh)
 *   • rule_value_unit: "percent" | "amount" | null
 *   • source: "existing" | "inherited_from_client" | "default_by_client_type"
 *   • client_type: cpl | hybrid | retainer
 */
export const resolveConfigRule = async (clientId, projectId) => {
  const params = new URLSearchParams({
    client_id: clientId,
    project_id: projectId,
  });
  const res = await api(
    `/clients/admin/configs/resolve/?${params.toString()}`,
    { method: "GET" },
  );
  return res?.data ?? null;
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

/**
 * Supersede an existing config: closes the named row AND creates the
 * replacement in one call. This is the resolution for a `config_overlap` 422 —
 * naming the config you are superseding is the explicit intent the overlap
 * guard exists to ask for, so this endpoint deliberately skips that guard.
 *
 * Body is the same shape POST takes, minus the client/project pair (the id
 * supplies it). Refuses (422) a config whose valid_to is already set — only an
 * open row can be superseded, which a blocking row always is.
 *
 * @param {number|string} id - existing_config.id from the 422 payload
 * @param {object} payload - { rule_type, rule_value, valid_from?, notes? }
 */
export const supersedeProjectDisplayConfig = async (id, payload) => {
  return await api(`/clients/admin/configs/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
};
