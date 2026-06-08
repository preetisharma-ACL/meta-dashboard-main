import { api } from "../api/api";

// ✅ Fetch the monthly billing overview (client view).
//    `month` is "YYYY-MM"; omit to let the backend default to the current month.
export const fetchBillingOverview = async (month) => {
  const qs = month ? `?month=${month}` : "";
  return await api(`/billing/overview/${qs}`, {
    method: "GET",
  });
};

// ✅ Fetch all active projects (same API used in ClientDashboard)
export const fetchAllProjects = async () => {
  return await api("/projects/?page=1&page_size=50", {
    method: "GET",
  });
};

// ✅ Fetch project-level billing details (campaigns, CPL, leads, etc.)
export const fetchBillingProject = async (projectId) => {
  return await api(`/billing/project/${projectId}/`, {
    method: "GET",
  });
};

// ✅ Fetch all projects then load billing details for each in parallel
// billing-service.js — add this overload so caller can pass project list in
export const fetchAllProjectsBilling = async () => {
  const projectsRes = await fetchAllProjects();
  const projectList = projectsRes?.data || [];

  const results = [];
  const batchSize = 5;

  for (let i = 0; i < projectList.length; i += batchSize) {
    const batch = projectList.slice(i, i + batchSize);

    const batchResults = await Promise.all(
      batch.map(async (p) => {
        try {
          const r = await fetchBillingProject(p.id);

          return {
            projectMeta: p,
            billing: r?.data || null,
          };
        } catch {
          return {
            projectMeta: p,
            billing: null,
          };
        }
      })
    );

    results.push(...batchResults);
  }

  return results.filter((r) => r.billing !== null);
};