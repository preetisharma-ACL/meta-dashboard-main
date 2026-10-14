import { createSignal, onMount, For, Show } from "solid-js";
import { fetchProjects, fetchProjectCities } from "../services/fetchProjects"; // ← adjust path
import { updateProject, deleteProject } from "../services/updateProject";
import Avatar from "../../../components/common/Avatar";
import RowsPerPageSelect from "../../../components/common/RowsPerPageSelect";
import {
  canEditProjects,
  canRenameProjects,
  canDeleteProjects,
} from "../../../stores/currentUser";
import SuccessToast, {
  showToast,
} from "../../../components/common/SuccessToast";

// ── Constants ────────────────────────────────────────────────────────────────

const PROPERTY_COLORS = {
  residential: "bg-blue-100 text-blue-800 ring-1 ring-blue-300",
  commercial: "bg-amber-100 text-amber-700 ring-1 ring-amber-300",
  apartment: "bg-sky-100 text-sky-700 ring-1 ring-sky-300",
  villa: "bg-purple-100 text-purple-700 ring-1 ring-purple-300",
  plot: "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-300",
};

// What PATCH accepts for property_type; "" = not set.
const PROPERTY_TYPES = ["residential", "commercial", "plot", "villa", "apartment"];

// The Types / City filters' "Not set" option: the list endpoint matches a blank
// property_type / city on this exact value.
const TYPE_NOT_SET = "not_set";
const CITY_NOT_SET = "not_set";

const STATUSES = ["active", "inactive", "paused"];
const PRIORITIES = ["high", "medium", "low"];

// The fields the edit form owns. Only the ones that changed are PATCHed.
const EDIT_FIELDS = [
  "name",
  "city",
  "location",
  "property_type",
  "rera_number",
  "status",
  "priority",
  "budget",
  "start_date",
  "end_date",
];

const RENAME_WARNING =
  "Campaigns named with the old project name will create a new project on the next sync unless their names in Meta are changed too.";

// A stored value outside the known list still gets its own option, so the
// select shows what's really saved instead of silently landing on the first.
const withCurrent = (list, v) => (!v || list.includes(v) ? list : [v, ...list]);

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const isBlank = (v) => v == null || String(v).trim() === "";

// ~330 projects had fake "Delhi / India / Residential" cleared by the sync fix,
// so blank is common and real: a muted "Not set", never "—" or a guess.
const NotSet = () => (
  <span class="text-xs italic text-gray-400 dark:text-gray-500">Not set</span>
);

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

const DEFAULT_PAGE_SIZE = 20;

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

  // Rows per page — requested size is remembered; the display uses the size the
  // server actually applied (it may cap large values).
  const [rowsPerPage, setRowsPerPage] = createSignal(
    Number(localStorage.getItem("adminProjectsRowsPerPage")) ||
      DEFAULT_PAGE_SIZE,
  );
  const [appliedPageSize, setAppliedPageSize] = createSignal(rowsPerPage());

  // Client-side filter/sort (applied on the current page's 20 rows)
  const [search, setSearch] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("all");
  const [typeFilter, setTypeFilter] = createSignal("all");
  const [cityFilter, setCityFilter] = createSignal("all");
  // Distinct cities across every page, for the City dropdown. Loaded once, in
  // the background — the table never waits on it.
  const [cities, setCities] = createSignal([]);
  const [priorityFilter, setPriority] = createSignal("all");
  const [sortKey, setSortKey] = createSignal("id");
  const [sortDir, setSortDir] = createSignal("desc");

  // ── Data loading (server-side pagination) ─────────────────────────────────

  const load = async (p = 1, overrides = {}) => {
    setLoading(true);

    try {
      const size = overrides.pageSize ?? rowsPerPage();

      const res = await fetchProjects({
        page: p,
        pageSize: size,
        search: overrides.search ?? search(),
        status: overrides.status ?? statusFilter(),
        propertyType: overrides.propertyType ?? typeFilter(),
        city: overrides.city ?? cityFilter(),
        priority: overrides.priority ?? priorityFilter(),
      });

      const raw =
        res.data?.results ?? (Array.isArray(res.data) ? res.data : []);

      const pagination = res.data?.meta?.pagination ?? res.meta?.pagination;

      setProjects(raw);
      setTotalCount(pagination?.total ?? raw.length);
      setTotalPages(pagination?.total_pages ?? 1);
      setAppliedPageSize(Number(pagination?.page_size) || size);
      setPage(p);
    } catch (err) {
      console.error("Failed to load projects:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadCities = () =>
    fetchProjectCities()
      .then(setCities)
      .catch((err) => console.error("Failed to load project cities:", err));

  onMount(() => {
    load(1);
    loadCities();
  });

  const goToPage = (p) => {
    setPage(p);
    load(p);
  };

  // Changing the page size always restarts at page 1 — the old page number can
  // be past the end once rows per page grows.
  const changeRowsPerPage = (size) => {
    if (size === rowsPerPage()) return;
    setRowsPerPage(size);
    localStorage.setItem("adminProjectsRowsPerPage", String(size));
    load(1, { pageSize: size });
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
    setCityFilter("all");
    setPriority("all");
    setSortKey("id");
    setSortDir("desc");

    load(1, {
      search: "",
      status: "all",
      propertyType: "all",
      city: "all",
      priority: "all",
    });
  };

  // ── Edit / delete ─────────────────────────────────────────────────────────
  // The row being edited, the form, and the rename-confirm step. A PATCH sends
  // only what changed, so an untouched blank city stays blank and an untouched
  // name never trips the rename guard.
  const [editing, setEditing] = createSignal(null);
  const [form, setForm] = createSignal({});
  const [saving, setSaving] = createSignal(false);
  const [editError, setEditError] = createSignal("");
  const [confirmRename, setConfirmRename] = createSignal(false);
  const [confirmDelete, setConfirmDelete] = createSignal(null);
  const [deleting, setDeleting] = createSignal(false);

  const toForm = (p) => {
    const f = {};
    for (const k of EDIT_FIELDS) f[k] = p[k] == null ? "" : String(p[k]);
    // date inputs want YYYY-MM-DD; a datetime string still edits cleanly.
    f.start_date = f.start_date.slice(0, 10);
    f.end_date = f.end_date.slice(0, 10);
    return f;
  };

  const openEdit = (p) => {
    if (!canEditProjects()) return;
    // Form FIRST: setting `editing` renders the modal synchronously, and it
    // reads form() as it mounts — an empty form there crashed the render.
    setForm(toForm(p));
    setEditing(p);
    setEditError("");
    setConfirmRename(false);
  };
  const closeEdit = () => {
    setEditing(null);
    setConfirmRename(false);
    setEditError("");
  };
  const setField = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
    if (editError()) setEditError("");
  };

  const changes = () => {
    const before = toForm(editing() || {});
    const out = {};
    for (const k of EDIT_FIELDS) {
      if (form()[k] === before[k]) continue;
      if (k === "name" && !canRenameProjects()) continue;
      let v = form()[k] ?? "";
      if (k === "budget") v = v === "" ? null : Number(v);
      else if (k === "start_date" || k === "end_date") v = v || null;
      else if (k === "name") v = v.trim();
      // city / location / rera_number / property_type: "" = not set.
      out[k] = v;
    }
    return out;
  };
  const renaming = () => "name" in changes();

  const validate = (c) => {
    if ("name" in c && !c.name) return "Project name can't be empty.";
    if ("budget" in c && !(c.budget > 0)) return "Budget must be greater than 0.";
    const s = form().start_date;
    const e = form().end_date;
    if (s && e && e < s) return "End date can't be before the start date.";
    return "";
  };

  // A 404 to a CM is scoping, not a missing project.
  const saveErrorText = (err) => {
    if (err?.status === 404) return "This project is not in your clients.";
    if (err?.status === 403) return "You don't have permission to edit projects.";
    const f = err?.fields;
    if (f && typeof f === "object") {
      const parts = Object.entries(f).map(
        ([k, v]) => `${k}: ${Array.isArray(v) ? v.join(" ") : v}`,
      );
      if (parts.length) return parts.join(" · ");
    }
    return err?.message || "Couldn't save the project. Please try again.";
  };

  const submitEdit = async (confirmed = false) => {
    const c = changes();
    if (Object.keys(c).length === 0) return closeEdit();
    const problem = validate(c);
    if (problem) return setEditError(problem);
    // Renames go through the warning first; the backend 400s without the flag.
    if ("name" in c && !confirmed) return setConfirmRename(true);
    if ("name" in c) c.confirm_rename = true;
    try {
      setSaving(true);
      await updateProject(editing().id, c);
      const name = c.name ?? editing().name;
      closeEdit();
      showToast(`Saved changes to "${name}".`, "Project updated");
      load(page());
      // A new or cleared city changes the dropdown's options.
      if ("city" in c) loadCities();
    } catch (err) {
      console.error("Failed to update project:", err);
      setConfirmRename(false);
      setEditError(saveErrorText(err));
    } finally {
      setSaving(false);
    }
  };

  const submitDelete = async () => {
    const p = confirmDelete();
    if (!p || !canDeleteProjects()) return;
    try {
      setDeleting(true);
      await deleteProject(p.id);
      setConfirmDelete(null);
      showToast(`Deleted "${p.name}".`, "Project deleted");
      // The last row on a page leaves an empty page behind — step back.
      load(projects().length === 1 && page() > 1 ? page() - 1 : page());
    } catch (err) {
      console.error("Failed to delete project:", err);
      setConfirmDelete(null);
      showToast(err?.message || "Couldn't delete the project.", "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const showActions = () => canEditProjects() || canDeleteProjects();

  const inputCls =
    "w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:opacity-60 disabled:cursor-not-allowed";
  const labelCls = "block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1";

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-3 lg:p-8">
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
          <For each={PROPERTY_TYPES}>
            {(t) => <option value={t}>{cap(t)}</option>}
          </For>
          <option value={TYPE_NOT_SET}>Not set</option>
        </select>

        {/* City — exact, case-insensitive match server-side, so each option
            sends the city as shown. "Not set" matches blank cities. */}
        <select
          value={cityFilter()}
          onChange={(e) => applyFilter(setCityFilter, e.target.value, "city")}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer"
        >
          <option value="all">All cities</option>
          <option value={CITY_NOT_SET}>Not set</option>
          <For each={cities()}>{(c) => <option value={c}>{c}</option>}</For>
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
              <Show when={showActions()}>
                <th class="p-3 text-center whitespace-nowrap">Action</th>
              </Show>
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
                      <Show
                        when={!isBlank(project.property_type)}
                        fallback={<NotSet />}
                      >
                        <span
                          class={`px-2.5 py-0.5 rounded-full text-xs font-semibold
                          ${PROPERTY_COLORS[project.property_type] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          {String(project.property_type).toUpperCase()}
                        </span>
                      </Show>
                    </td>
                    {/* City, with location beneath it — both blank on ~330
                        projects after the sync stopped writing fake values. */}
                    <td class="p-3 text-gray-600 dark:text-gray-400">
                      <Show when={!isBlank(project.city)} fallback={<NotSet />}>
                        {project.city}
                      </Show>
                      <span class="block text-xs text-gray-400 dark:text-gray-500">
                        <Show
                          when={!isBlank(project.location)}
                          fallback={<NotSet />}
                        >
                          {project.location}
                        </Show>
                      </span>
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
                    <Show when={showActions()}>
                      <td class="p-3 text-center whitespace-nowrap">
                        <Show when={canEditProjects()}>
                          <button
                            type="button"
                            onClick={() => openEdit(project)}
                            class="px-2.5 py-1 text-xs font-medium rounded-md border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                          >
                            Edit
                          </button>
                        </Show>
                        <Show when={canDeleteProjects()}>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(project)}
                            class="ml-2 px-2.5 py-1 text-xs font-medium rounded-md border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20"
                          >
                            Delete
                          </button>
                        </Show>
                      </td>
                    </Show>
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
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-500 dark:text-gray-400">
            {totalCount() === 0
              ? "No results"
              : `Showing ${(page() - 1) * appliedPageSize() + 1}–${Math.min(page() * appliedPageSize(), totalCount())} of ${totalCount()} projects`}
          </span>

          <RowsPerPageSelect
            value={rowsPerPage()}
            onChange={changeRowsPerPage}
          />
        </div>

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

      {/* ── Edit project ── */}
      <Show when={editing()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={(e) => e.target === e.currentTarget && !saving() && closeEdit()}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Edit project"
            class="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl"
          >
            <div class="px-6 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800">
              <h2 class="text-lg font-semibold text-gray-900 dark:text-white">
                Edit project
              </h2>
              <p class="text-xs text-gray-500 dark:text-gray-400">
                #{editing().id} · {editing().name}
              </p>
            </div>

            <div class="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div class="sm:col-span-2">
                <label class={labelCls}>
                  Project name
                  <Show when={!canRenameProjects()}>
                    <span class="ml-1 text-gray-400">(admin only)</span>
                  </Show>
                </label>
                <input
                  type="text"
                  value={form().name}
                  disabled={!canRenameProjects()}
                  onInput={(e) => setField("name", e.target.value)}
                  class={inputCls}
                />
                <Show when={renaming()}>
                  <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    Renaming — you'll be asked to confirm on save.
                  </p>
                </Show>
              </div>

              <div>
                <label class={labelCls}>City</label>
                <input
                  type="text"
                  value={form().city}
                  placeholder="Not set"
                  onInput={(e) => setField("city", e.target.value)}
                  class={inputCls}
                />
              </div>
              <div>
                <label class={labelCls}>Location</label>
                <input
                  type="text"
                  value={form().location}
                  placeholder="Not set"
                  onInput={(e) => setField("location", e.target.value)}
                  class={inputCls}
                />
              </div>

              <div>
                <label class={labelCls}>Property type</label>
                <select
                  value={form().property_type}
                  onChange={(e) => setField("property_type", e.target.value)}
                  class={inputCls}
                >
                  <option value="">Not set</option>
                  <For each={PROPERTY_TYPES}>
                    {(t) => <option value={t}>{cap(t)}</option>}
                  </For>
                </select>
              </div>
              <div>
                <label class={labelCls}>RERA number</label>
                <input
                  type="text"
                  value={form().rera_number}
                  placeholder="Not set"
                  onInput={(e) => setField("rera_number", e.target.value)}
                  class={inputCls}
                />
              </div>

              <div>
                <label class={labelCls}>Status</label>
                <select
                  value={form().status}
                  onChange={(e) => setField("status", e.target.value)}
                  class={inputCls}
                >
                  <For each={withCurrent(STATUSES, editing().status)}>
                    {(s) => <option value={s}>{cap(s)}</option>}
                  </For>
                </select>
              </div>
              <div>
                <label class={labelCls}>Priority</label>
                <select
                  value={form().priority}
                  onChange={(e) => setField("priority", e.target.value)}
                  class={inputCls}
                >
                  <For each={withCurrent(PRIORITIES, editing().priority)}>
                    {(s) => <option value={s}>{cap(s)}</option>}
                  </For>
                </select>
              </div>

              <div>
                <label class={labelCls}>Budget (₹)</label>
                <input
                  type="number"
                  min="1"
                  value={form().budget}
                  onInput={(e) => setField("budget", e.target.value)}
                  class={inputCls}
                />
              </div>
              <div />

              <div>
                <label class={labelCls}>Start date</label>
                <input
                  type="date"
                  value={form().start_date}
                  onInput={(e) => setField("start_date", e.target.value)}
                  class={inputCls}
                />
              </div>
              <div>
                <label class={labelCls}>End date</label>
                <input
                  type="date"
                  value={form().end_date}
                  min={form().start_date || undefined}
                  onInput={(e) => setField("end_date", e.target.value)}
                  class={inputCls}
                />
              </div>
            </div>

            <Show when={editError()}>
              <div class="mx-6 mb-4 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
                {editError()}
              </div>
            </Show>

            <div class="px-6 py-4 border-t border-gray-100 dark:border-gray-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeEdit}
                disabled={saving()}
                class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => submitEdit(false)}
                disabled={saving()}
                class="px-4 py-2 text-sm rounded-lg bg-blue-900 text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {saving() ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* ── Rename confirm ── */}
      <Show when={editing() && confirmRename()}>
        <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm rename"
            class="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl p-6"
          >
            <h3 class="text-base font-semibold text-gray-900 dark:text-white">
              Rename project?
            </h3>
            <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
              <span class="font-medium">{editing().name}</span> →{" "}
              <span class="font-medium">{(form().name ?? "").trim()}</span>
            </p>
            <p class="mt-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
              {RENAME_WARNING}
            </p>
            <div class="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmRename(false)}
                disabled={saving()}
                class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => submitEdit(true)}
                disabled={saving()}
                class="px-4 py-2 text-sm rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {saving() ? "Saving…" : "Rename and save"}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* ── Delete confirm (admin) ── */}
      <Show when={confirmDelete()}>
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div
            role="alertdialog"
            aria-modal="true"
            aria-label="Confirm delete"
            class="w-full max-w-md rounded-xl bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-xl p-6"
          >
            <h3 class="text-base font-semibold text-gray-900 dark:text-white">
              Delete project?
            </h3>
            <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
              <span class="font-medium">{confirmDelete().name}</span> (#
              {confirmDelete().id}) will be permanently deleted. This can't be
              undone.
            </p>
            <div class="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting()}
                class="px-4 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitDelete}
                disabled={deleting()}
                class="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting() ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      </Show>

      <SuccessToast />
    </div>
  );
}
