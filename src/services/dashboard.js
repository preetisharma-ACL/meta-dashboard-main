import { api } from "../api/api";

export const fetchProjects = async (
  page = 1,
  search = "",
  pageSize = 20
) => {

  let url = `/projects/?page=${page}&page_size=${pageSize}`;

  if (search) {
    url += `&search=${search}`;
  }

  const selectedClientNomen =
    localStorage.getItem("selectedClientNomen");

  if (selectedClientNomen) {
    url += `&client_nomen=${selectedClientNomen}`;
  }

  return await api(url, {
    method: "GET",
  });
};