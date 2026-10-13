import { api } from "../../../api/api";

// PATCH /projects/{id}/ — any of: name, city, location, property_type,
// rera_number, status, priority, budget (> 0), start_date, end_date.
// property_type: residential | commercial | plot | villa | apartment, or "" =
// not set. A name change needs confirm_rename: true (admin only), else 400.
// 403 = role can't edit; 404 for a CM = project outside their clients.
export const updateProject = async (id, payload) => {
  return await api(`/projects/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
};

// DELETE /projects/{id}/ — admin only.
export const deleteProject = async (id) => {
  return await api(`/projects/${id}/`, { method: "DELETE" });
};
