import { api } from "../../../api/api";

export const fetchProjects = async ({
  page = 1,
  pageSize,
  search = "",
  status = "",
  propertyType = "",
  priority = "",
  city = "",
}) => {
  const params = new URLSearchParams();

  params.append("page", page);

  if (pageSize) params.append("page_size", pageSize);

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

  // Exact, case-insensitive match server-side; "not_set" matches blank cities.
  if (city && city !== "all") {
    params.append("city", city);
  }

  return await api(`/projects/?${params.toString()}`, {
    method: "GET",
  });
};

// Every distinct non-empty city across ALL pages of /projects/ (scoped
// server-side to what the caller can see), A→Z. The table is paginated, so the
// loaded page alone would offer only its own cities. Deduped case-insensitively
// — the filter matches that way — keeping the first spelling seen.
export const fetchProjectCities = async () => {
  const seen = new Map();
  let page = 1;
  for (;;) {
    const res = await fetchProjects({ page, pageSize: 500 });
    const rows =
      res?.data?.results ?? (Array.isArray(res?.data) ? res.data : []);
    for (const p of rows) {
      const c = typeof p.city === "string" ? p.city.trim() : "";
      if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
    }
    const pagination = res?.data?.meta?.pagination ?? res?.meta?.pagination;
    if (!pagination?.has_next || rows.length === 0) break;
    page += 1;
  }
  return [...seen.values()].sort((a, b) =>
    a.localeCompare(b, "en", { sensitivity: "base" }),
  );
};
