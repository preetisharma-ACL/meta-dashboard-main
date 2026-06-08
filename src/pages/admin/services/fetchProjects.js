import { api } from "../../../api/api";

export const fetchProjects = async ({
  page = 1,
  search = "",
  status = "",
  propertyType = "",
  priority = "",
}) => {
  const params = new URLSearchParams();

  params.append("page", page);

  if (search) params.append("search", search);

  if (status && status !== "all") {
    params.append("status", status);
  }

  if (propertyType && propertyType !== "all") {
    params.append("property_type", propertyType);
  }

  if (priority && priority !== "all") {
    params.append("priority", priority);
  }

  return await api(`/projects/?${params.toString()}`, {
    method: "GET",
  });
};