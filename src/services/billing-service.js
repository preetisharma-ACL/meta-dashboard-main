import { api } from "../api/api";

// ✅ Fetch top-level billing overview (budget, utilized, remaining, pending)
export const fetchBillingOverview = async () => {
  return await api("/billing/overview/", {
    method: "GET",
  });
};

// ✅ Fetch all active projects (same API used in ClientDashboard)
export const fetchAllProjects = async () => {
  return await api("/projects/?page=1&page_size=1000", {
    method: "GET",
  });
};

// ✅ Fetch project-level billing details (campaigns, CPL, leads, etc.)
export const fetchBillingProject = async (projectId) => {
  return await api(`/billing/project/${projectId}`, {
    method: "GET",
  });
};

// ✅ Fetch all projects then load billing details for each in parallel
export const fetchAllProjectsBilling = async () => {
  const projectsRes = await fetchAllProjects();
  const projectList = projectsRes?.data || [];

  const billingResults = await Promise.all(
    projectList.map((p) =>
      fetchBillingProject(p.id)
        .then((r) => ({ projectMeta: p, billing: r?.data || null }))
        .catch(() => ({ projectMeta: p, billing: null }))
    )
  );

  return billingResults.filter((r) => r.billing !== null);
};