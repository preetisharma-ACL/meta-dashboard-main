import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { fetchProjects } from "../services/fetchProjects"; // ← adjust path
import Avatar from "../../../components/common/Avatar";

// ── Constants ────────────────────────────────────────────────────────────────

const PROPERTY_COLORS = {
  residential: "bg-blue-100 text-blue-800 ring-1 ring-blue-300",
  commercial: "bg-amber-100 text-amber-700 ring-1 ring-amber-300",
  apartment: "bg-sky-100 text-sky-700 ring-1 ring-sky-300",
  villa: "bg-purple-100 text-purple-700 ring-1 ring-purple-300",
};

const PRIORITY_COLORS = {
  high: "bg-red-100 text-red-700 ring-1 ring-red-300",
  medium: "bg-yellow-100 text-yellow-700 ring-1 ring-yellow-300",
  low: "bg-green-100 text-green-700 ring-1 ring-green-300",
};

const STATUS_DOT = {
  active: "bg-green-500",
  inactive: "bg-red-400",
  paused: "bg-yellow-400",
};

const PAGE_SIZE = 20;

// ── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n, fallback = "—") =>
  n == null ? fallback : Number(n).toLocaleString("en-IN");

const fmtCurrency = (n) =>
  n == null ? "—" : `₹${Number(n).toLocaleString("en-IN")}`;

// ── Component ────────────────────────────────────────────────────────────────

export default function Projects() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [projects, setProjects] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [totalCount, setTotalCount] = createSignal(0);
  const [totalPages, setTotalPages] = createSignal(1);
  const [page, setPage] = createSignal(1);

  // Client-side filter/sort (applied on the current page's 20 rows)
  const [search, setSearch] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("all");
  const [typeFilter, setTypeFilter] = createSignal("all");
  const [priorityFilter, setPriority] = createSignal("all");
  const [sortKey, setSortKey] = createSignal("id");
  const [sortDir, setSortDir] = createSignal("desc");

  // ── Data loading (server-side pagination) ─────────────────────────────────

  const load = async (p = 1, overrides = {}) => {
    setLoading(true);

    try {
      const res = await fetchProjects({
        page: p,
        search: overrides.search ?? search(),
        status: overrides.status ?? statusFilter(),
        propertyType: overrides.propertyType ?? typeFilter(),
        priority: overrides.priority ?? priorityFilter(),
      });

      const raw =
        res.data?.results ?? (Array.isArray(res.data) ? res.data : []);

      const pagination = res.data?.meta?.pagination ?? res.meta?.pagination;

      setProjects(raw);
      setTotalCount(pagination?.total ?? raw.length);
      setTotalPages(pagination?.total_pages ?? 1);
      setPage(p);
    } catch (err) {
      console.error("Failed to load projects:", err);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => load(1));

  const goToPage = (p) => {
    setPage(p);
    load(p);
  };

  // ── Client-side filter + sort (on the current page's rows) ────────────────

  const applyFilter = (setter, value, filterKey) => {
    setter(value);

    load(1, {
      [filterKey]: value,
    });
  };

  const toggleSort = (key) => {
    if (sortKey() === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortIcon = (key) => {
    if (sortKey() !== key) return <span class="text-gray-300 ml-1">⇅</span>;
    return (
      <span class="ml-1 text-purple-600">
        {sortDir() === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setTypeFilter("all");
    setPriority("all");
    setSortKey("id");
    setSortDir("desc");

    load(1, {
      search: "",
      status: "all",
      propertyType: "all",
      priority: "all",
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 lg:p-8">
      {/* Page Header */}
      <div class="mb-6">
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
          Projects
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {totalCount()} total · all client projects
        </p>
      </div>

      {/* Filters Bar */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex w-[340px]">
          <svg
            class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by name or city…"
            value={search()}
            onInput={(e) => applyFilter(setSearch, e.target.value, "search")}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                   dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-400
                   dark:focus:ring-gray-600"
          />
        </div>

        <select
          value={statusFilter()}
          onChange={(e) =>
            applyFilter(setStatusFilter, e.target.value, "status")
          }
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="paused">Paused</option>
        </select>

        <select
          value={typeFilter()}
          onChange={(e) =>
            applyFilter(setTypeFilter, e.target.value, "propertyType")
          }
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer"
        >
          <option value="all">All Types</option>
          <option value="residential">Residential</option>
          <option value="commercial">Commercial</option>
          <option value="apartment">Apartment</option>
          <option value="villa">Villa</option>
        </select>

        <select
          value={priorityFilter()}
          onChange={(e) => applyFilter(setPriority, e.target.value, "priority")}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer"
        >
          <option value="all">All Priorities</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>

        <button
          onClick={clearAllFilters}
          class="px-3 py-2 text-sm rounded-lg bg-red-50 text-red-600 border border-red-200
                 hover:bg-red-100 hover:border-red-300 dark:bg-gray-800 dark:text-gray-200
                 dark:border-gray-700 transition-colors"
        >
          Clear All
        </button>

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {totalCount()} total
        </span>
      </div>

      {/* Table */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr
              class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60
                       text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider"
            >
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("id")}
              >
                ID {sortIcon("id")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("name")}
              >
                Project Name {sortIcon("name")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("property_type")}
              >
                Type {sortIcon("property_type")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("city")}
              >
                City {sortIcon("city")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("status")}
              >
                Status {sortIcon("status")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("priority")}
              >
                Priority {sortIcon("priority")}
              </th>
              <th
                class="p-3 text-right cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("budget")}
              >
                Budget {sortIcon("budget")}
              </th>

              <th
                class="p-3 text-center cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("campaign_count")}
              >
                Campaigns {sortIcon("campaign_count")}
              </th>
            </tr>
          </thead>

          <Show
            when={!loading()}
            fallback={
              <tbody>
                <For each={Array(8).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                      <td class="p-3">
                        <div class="h-3 w-8 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-44 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-5 w-14 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded ml-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded ml-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-12 bg-gray-200 dark:bg-gray-700 rounded ml-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-10 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-10 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-10 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={projects()}>
                {(project, i) => (
                  <tr
                    class={`border-b border-gray-100 dark:border-gray-800
                            hover:bg-purple-50/60 transition-colors
                            ${
                              i() % 2 === 0
                                ? "bg-white dark:bg-gray-900"
                                : "bg-gray-50/60 dark:bg-gray-800/30"
                            }`}
                  >
                    <td class="p-3 text-purple-700 dark:text-gray-300 font-medium">
                      {project.id}
                    </td>
                    <td class="p-3">
                      <div class="flex items-center gap-2">
                        <Avatar name={project.name} />
                        <span class="text-purple-700 dark:text-gray-300 font-medium">
                          {project.name}
                        </span>
                      </div>
                    </td>
                    <td class="p-3 text-center">
                      <span
                        class={`px-2.5 py-0.5 rounded-full text-xs font-semibold
                        ${PROPERTY_COLORS[project.property_type] ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {String(project.property_type ?? "").toUpperCase()}
                      </span>
                    </td>
                    <td class="p-3 text-gray-600 dark:text-gray-400">
                      {project.city ?? "—"}
                    </td>
                    <td class="p-3 text-center">
                      <span
                        class={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold
                        ${
                          project.status === "active"
                            ? "bg-green-100 text-green-700"
                            : project.status === "paused"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-red-100 text-red-600"
                        }`}
                      >
                        <span
                          class={`w-1.5 h-1.5 rounded-full inline-block
                          ${STATUS_DOT[project.status] ?? "bg-gray-400"}`}
                        />
                        {project.status_label ?? project.status}
                      </span>
                    </td>
                    <td class="p-3 text-center">
                      <span
                        class={`px-2.5 py-0.5 rounded-full text-xs font-semibold
                        ${PRIORITY_COLORS[project.priority] ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {project.priority_label ?? project.priority}
                      </span>
                    </td>
                    <td class="p-3 text-right text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
                      {fmtCurrency(project.budget)}
                    </td>
                    <td class="p-3 text-center text-gray-500 dark:text-gray-400">
                      {fmt(project.campaign_count, "0")}
                    </td>
                  </tr>
                )}
              </For>

              <Show when={projects().length === 0}>
                <tr>
                  <td
                    colspan="12"
                    class="py-16 text-center text-gray-400 dark:text-gray-500"
                  >
                    <svg
                      class="w-10 h-10 mx-auto mb-3 opacity-30"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    No projects match your filters
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>

          <tfoot>
            <tr class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <td
                colspan="12"
                class="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400"
              >
                {totalCount()} project{totalCount() !== 1 ? "s" : ""}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Pagination */}
      <div class="flex items-center justify-between mt-5 flex-wrap gap-3">
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {totalCount() === 0
            ? "No results"
            : `Showing ${(page() - 1) * PAGE_SIZE + 1}–${Math.min(page() * PAGE_SIZE, totalCount())} of ${totalCount()} projects`}
        </span>

        <div class="flex items-center gap-2">
          <button
            onClick={() => goToPage(page() - 1)}
            disabled={page() <= 1 || loading()}
            class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg border
                   border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900
                   text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800
                   disabled:opacity-35 disabled:cursor-default transition-colors"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 16 16"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M10 12L6 8l4-4" />
            </svg>
            Prev
          </button>

          <span class="text-sm text-gray-500 dark:text-gray-400 px-1">
            Page {page()} of {totalPages()}
          </span>

          <button
            onClick={() => goToPage(page() + 1)}
            disabled={page() >= totalPages() || loading()}
            class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-md
                   bg-blue-900 border border-blue-900 text-white
                   hover:bg-blue-800 disabled:opacity-35 disabled:cursor-default transition-colors"
          >
            Next
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 16 16"
              stroke="currentColor"
              stroke-width="1.8"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
