import { api } from "../../../api/api";


export const fetchProjectsByClient = async (clientId) => {
  let allProjects = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    const res = await api(
      `/projects/?client_id=${clientId}&page=${page}&page_size=50`,
      { method: "GET" }
    );

    const projects = res?.data || [];
    allProjects = [...allProjects, ...projects];

    const pagination = res?.meta?.pagination;
    hasNext = pagination?.has_next || false;
    page++;
  }

  return allProjects;
};