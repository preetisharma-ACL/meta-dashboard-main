import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import {
  fetchProjectDisplayConfig,
  createProjectDisplayConfig,
  updateProjectDisplayConfig,
  fetchClients,
  // ← CHANGED: removed fetchProjects, added this
} from "../services/projectDisplayConfig";
import Avatar from "../../../components/common/Avatar";
import { fetchProjectsByClient } from "../services/fetchProjectsByClient"; // ← NEW

const TYPE_COLORS = {
  hybrid: "bg-blue-100 text-blue-800 ring-1 ring-blue-300",
  cpl: "bg-amber-100 text-amber-700 ring-1 ring-amber-300",
  retainer: "bg-sky-100 text-sky-700 ring-1 ring-sky-300",
};

const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

export default function ProjectDisplayConfig() {
  const [configs, setConfigs] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [search, setSearch] = createSignal("");
  const [typeFilter, setTypeFilter] = createSignal("all");
  const [activeFilter, setActiveFilter] = createSignal("All");
  const [sortKey, setSortKey] = createSignal("id");
  const [sortDir, setSortDir] = createSignal("desc");
  const [sidebarMounted, setSidebarMounted] = createSignal(false);
  const [sidebarVisible, setSidebarVisible] = createSignal(false);
  const [submitting, setSubmitting] = createSignal(false);
  const [clients, setClients] = createSignal([]);
  const [projects, setProjects] = createSignal([]);
  const [projectsLoading, setProjectsLoading] = createSignal(false); // ← NEW
  const [projectSearch, setProjectSearch] = createSignal("");
  const [showProjectDropdown, setShowProjectDropdown] = createSignal(false);
  const [formData, setFormData] = createSignal({
    client_id: "",
    project_id: "",
    rule_type: "cpl_markup_pct",
    rule_value: "",
    notes: "",
  });
  const [clientSearch, setClientSearch] = createSignal("");
  const [showClientDropdown, setShowClientDropdown] = createSignal(false);
  const [editingConfig, setEditingConfig] = createSignal(null);

  const isEditMode = createMemo(() => editingConfig() !== null);

  const PAGE_SIZE = 20;
  const [page, setPage] = createSignal(1);

  // ── CHANGED: removed fetchProjects() — projects are loaded on demand ──────
  onMount(async () => {
    try {
      const [configRes, clientRes] = await Promise.all([
        fetchProjectDisplayConfig(),
        fetchClients(1, 500),
      ]);

      setConfigs(configRes.data ?? []);
      setClients(
        Array.isArray(clientRes?.data?.results)
          ? clientRes.data.results
          : clientRes.data || [],
      );
    } catch (err) {
      console.error("Failed to load configs:", err);
    } finally {
      setLoading(false);
    }
  });

  // ── NEW: fetch projects for a given clientId via AJAX ─────────────────────
  const loadProjectsForClient = async (clientId) => {
    setProjects([]);
    setProjectSearch("");
    setShowProjectDropdown(false);
    handleInputChange("project_id", "");
    setProjectsLoading(true);

    try {
      const clientProjects = await fetchProjectsByClient(clientId);
      setProjects(clientProjects);
    } catch (err) {
      console.error("Failed to load projects for client:", err);
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
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

  const filtered = createMemo(() => {
    let data = [...configs()];
    const q = search().trim().toLowerCase();
    if (q) {
      data = data.filter(
        (c) =>
          c.client_email?.toLowerCase().includes(q) ||
          c.project_name?.toLowerCase().includes(q),
      );
    }
    if (typeFilter() !== "all") {
      data = data.filter((c) => c.client_type === typeFilter());
    }
    if (activeFilter() === "Yes") data = data.filter((c) => c.is_active);
    if (activeFilter() === "No") data = data.filter((c) => !c.is_active);

    data.sort((a, b) => {
      let va = a[sortKey()];
      let vb = b[sortKey()];
      if (sortKey() === "valid_from") {
        va = new Date(va);
        vb = new Date(vb);
      } else if (sortKey() === "rule_value") {
        va = parseFloat(va ?? 0);
        vb = parseFloat(vb ?? 0);
      } else if (["id", "client_id", "project_id"].includes(sortKey())) {
        va = Number(va ?? 0);
        vb = Number(vb ?? 0);
      } else {
        va = String(va ?? "").toLowerCase();
        vb = String(vb ?? "").toLowerCase();
      }
      if (va < vb) return sortDir() === "asc" ? -1 : 1;
      if (va > vb) return sortDir() === "asc" ? 1 : -1;
      return 0;
    });

    return data;
  });

  const paginated = createMemo(() => {
    const start = (page() - 1) * PAGE_SIZE;
    return filtered().slice(start, start + PAGE_SIZE);
  });

  const totalPages = createMemo(() =>
    Math.max(1, Math.ceil(filtered().length / PAGE_SIZE)),
  );

  const filteredClients = createMemo(() => {
    const query = clientSearch().trim().toLowerCase();
    if (!query) return clients();
    return clients().filter((c) => c.email?.toLowerCase().includes(query));
  });

  const filteredProjects = createMemo(() => {
    const query = projectSearch().trim().toLowerCase();
    if (!query) return projects();
    return projects().filter((p) => p.name?.toLowerCase().includes(query));
  });

  const applyFilter = (setter, value) => {
    setter(value);
    setPage(1);
  };

  const openSidebar = () => {
    setShowClientDropdown(false);
    setShowProjectDropdown(false);
    setSidebarMounted(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setSidebarVisible(true));
    });
  };

  // ── CHANGED: async, pre-loads projects for the client being edited ────────
  const handleEdit = async (cfg) => {
    setEditingConfig(cfg);
    setFormData({
      client_id: cfg.client_id,
      project_id: cfg.project_id,
      rule_type: cfg.rule_type,
      rule_value: cfg.rule_value,
      notes: cfg.notes ?? "",
    });
    setClientSearch(cfg.client_email);
    setProjectSearch(cfg.project_name ?? "");

    // Pre-load the projects for this client so the dropdown works immediately
    setProjectsLoading(true);
    try {
      const clientProjects = await fetchProjectsByClient(cfg.client_id);
      setProjects(clientProjects);
    } catch (err) {
      console.error("Failed to load projects on edit:", err);
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }

    setSidebarMounted(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setSidebarVisible(true));
    });
  };

  // ── CHANGED: also resets projects and loading state ───────────────────────
  const closeSidebar = () => {
    setSidebarVisible(false);
    setClientSearch("");
    setProjectSearch("");
    setProjects([]); // ← NEW
    setProjectsLoading(false); // ← NEW
    setShowProjectDropdown(false);
    setShowClientDropdown(false);
    setEditingConfig(null);

    setTimeout(() => {
      setSidebarMounted(false);
      setFormData({
        client_id: "",
        project_id: "",
        rule_type: "cpl_markup_pct",
        rule_value: "",
        notes: "",
      });
    }, 300);
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmitConfig = async () => {
    try {
      setSubmitting(true);
      const payload = {
        client_id: Number(formData().client_id),
        project_id: Number(formData().project_id),
        rule_type: formData().rule_type,
        rule_value: formData().rule_value,
        notes: formData().notes,
      };

      if (isEditMode()) {
        await updateProjectDisplayConfig(editingConfig().id, payload);
      } else {
        await createProjectDisplayConfig(payload);
      }

      const res = await fetchProjectDisplayConfig();
      setConfigs(res.data ?? []);
      closeSidebar();
    } catch (err) {
      console.error("Failed to save config:", err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 lg:p-8">
      {/* Page Header */}
      <div class="mb-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div class="mb-6">
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
            Project Display Configs
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {configs().length} total · billing rules per project
          </p>
        </div>
        <button
          onClick={openSidebar}
          class="mb-6 px-4 py-2 text-sm rounded-md bg-blue-900 text-white hover:bg-blue-800 transition-colors shadow-sm"
        >
          + Add Project Config
        </button>
      </div>

      {/* Filters Bar */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex w-[500px]">
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
            placeholder="Search by email or project name…"
            value={search()}
            onInput={(e) => applyFilter(setSearch, e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>
        <select
          value={typeFilter()}
          onChange={(e) => applyFilter(setTypeFilter, e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer"
        >
          <option value="all">All Types</option>
          <option value="hybrid">Hybrid</option>
          <option value="cpl">CPL</option>
          <option value="retainer">Retainer</option>
        </select>
        <select
          value={activeFilter()}
          onChange={(e) => applyFilter(setActiveFilter, e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer"
        >
          <option value="All">All Status</option>
          <option value="Yes">Active</option>
          <option value="No">Inactive</option>
        </select>
        <button
          onClick={() => {
            setSearch("");
            setTypeFilter("all");
            setActiveFilter("All");
            setSortKey("id");
            setSortDir("desc");
            setPage(1);
          }}
          class="px-3 py-2 text-sm rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 hover:border-red-300 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 transition-colors"
        >
          Clear All
        </button>
        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {filtered().length} result{filtered().length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table — unchanged from original */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          {/* Table Head */}
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
                class="hidden p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("client_id")}
              >
                Client ID {sortIcon("client_id")}
              </th>
              <th
                class="hidden p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("project_id")}
              >
                Project ID {sortIcon("project_id")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("client_email")}
              >
                Client {sortIcon("client_email")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("client_type")}
              >
                Type {sortIcon("client_type")}
              </th>
              <th
                class="hidden p-3 text-center cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("rule_type")}
              >
                Rule Type {sortIcon("rule_type")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("project_name")}
              >
                Project {sortIcon("project_name")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("rule_value")}
              >
                Markup {sortIcon("rule_value")}
              </th>
              <th class="p-3 text-center whitespace-nowrap">Status</th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("valid_from")}
              >
                Effective From {sortIcon("valid_from")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-600 whitespace-nowrap"
                onClick={() => toggleSort("created_by_email")}
              >
                Created By {sortIcon("created_by_email")}
              </th>
              <th class="p-3 text-center whitespace-nowrap">Action</th>
            </tr>
          </thead>

          {/* Loading Skeleton */}
          <Show
            when={!loading()}
            fallback={
              <tbody>
                <For each={Array(8).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                      <td class="p-3">
                        <div class="h-3 w-44 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-36 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded mx-auto" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={paginated()}>
                {(cfg, i) => (
                  <tr
                    class={`border-b border-gray-100 dark:border-gray-800
                               hover:bg-purple-50/60 transition-colors
                               ${
                                 i() % 2 === 0
                                   ? "bg-white dark:bg-gray-900"
                                   : "bg-gray-50/60 dark:bg-gray-800/30"
                               }`}
                  >
                    {/* Client — maps to client_email */}
                    <td class="p-3 text-purple-700 dark:text-gray-300 font-medium">
                      {cfg.id}
                    </td>
                    <td class="hidden p-3 text-purple-700 dark:text-gray-300 font-medium">
                      {cfg.client_id}
                    </td>
                    <td class="hidden p-3 text-purple-700 dark:text-gray-300 font-medium">
                      {cfg.project_id}
                    </td>
                    {/* Client — maps to client_email */}
                    <td class="p-3">
                      <div class="flex items-center gap-2">
                        <Avatar name={cfg.client_email} />
                        <span class="text-purple-700 dark:text-gray-300 font-medium">
                          {cfg.client_email}
                        </span>
                      </div>
                    </td>

                    {/* Type — maps to client_type */}
                    <td class="p-3 text-center">
                      <span
                        class={`px-2.5 py-0.5 rounded-full text-xs font-semibold
                                    ${TYPE_COLORS[cfg.client_type] ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {String(cfg.client_type ?? "").toUpperCase()}
                      </span>
                    </td>

                    {/* Project — maps to project_name */}
                    <td class="hidden p-3 text-gray-700 dark:text-gray-300 font-medium">
                      {cfg.rule_type}
                    </td>

                    {/* Project — maps to project_name */}
                    <td class="p-3 text-gray-700 dark:text-gray-300 font-medium">
                      {cfg.project_name}
                    </td>

                    {/* Markup — maps to rule_value */}
                    <td class="p-3 text-center text-blue-800 dark:text-blue-400 font-semibold">
                      +{parseFloat(cfg.rule_value ?? 0).toFixed(2)}%
                    </td>

                    {/* Status — maps to is_active */}
                    <td class="p-3 text-center">
                      {cfg.is_active ? (
                        <span
                          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                                     bg-green-100 text-green-700 text-xs font-semibold"
                        >
                          <span class="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          Active
                        </span>
                      ) : (
                        <span
                          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                                     bg-red-100 text-red-600 text-xs font-semibold"
                        >
                          <span class="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                          Inactive
                        </span>
                      )}
                    </td>

                    {/* Effective From — maps to valid_from */}
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(cfg.valid_from)}
                    </td>

                    {/* Created By — maps to created_by_email */}
                    <td class="p-3 text-gray-500 dark:text-gray-400 text-sm">
                      {cfg.created_by_email}
                    </td>
                    <td class="p-3 text-center">
                      {/* Edit */}
                      <button
                        onClick={() => handleEdit(cfg)}
                        class="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-500 text-white hover:bg-amber-100 border border-amber-400 hover:border-amber-300 hover:text-amber-600 transition-all duration-150 shadow-sm hover:shadow"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="w-4 h-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                )}
              </For>

              {/* Empty State */}
              <Show when={filtered().length === 0}>
                <tr>
                  <td
                    colspan="7"
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
                    No configs match your filters
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>

          {/* Table Footer */}
          <tfoot>
            <tr class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <td
                colspan="7"
                class="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400"
              >
                {filtered().length} config{filtered().length !== 1 ? "s" : ""}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Pagination */}
      <div class="flex items-center justify-between mt-5 flex-wrap gap-3">
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {filtered().length === 0
            ? "No results"
            : `Showing ${(page() - 1) * PAGE_SIZE + 1}–${Math.min(page() * PAGE_SIZE, filtered().length)} of ${filtered().length} configs`}
        </span>

        <div class="flex items-center gap-2">
          <button
            onClick={() => {
              setPage((p) => p - 1);
            }}
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
            onClick={() => {
              setPage((p) => p + 1);
            }}
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

      {/* ───────────────── Sidebar Modal ───────────────── */}
      <Show when={sidebarMounted()}>
        <div class="fixed inset-0 z-50 flex">
          <div
            onClick={closeSidebar}
            class="fixed inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-300"
            style={{ opacity: sidebarVisible() ? "1" : "0" }}
          />
          <div
            class="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out"
            style={{
              transform: sidebarVisible()
                ? "translateX(0)"
                : "translateX(100%)",
            }}
          >
            {/* Header */}
            <div class="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
              <div>
                <h2 class="text-lg font-bold text-gray-800 dark:text-white">
                  {isEditMode() ? "Edit Project Config" : "Add Project Config"}
                </h2>
                <p class="text-sm text-gray-500 dark:text-gray-400">
                  {isEditMode()
                    ? "Update existing billing rule"
                    : "Create new billing rule"}
                </p>
              </div>
              <button
                onClick={closeSidebar}
                class="w-8 h-8 rounded-full flex items-center justify-center hover:bg-gray-200 dark:hover:bg-gray-700 transition"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* ── Client dropdown ── */}
              <div>
                <label class="block text-sm font-medium mb-1.5">
                  Client Name
                </label>
                <div class="relative">
                  <input
                    type="text"
                    value={clientSearch()}
                    placeholder="Search client…"
                    onFocus={() => setShowClientDropdown(true)}
                    onInput={(e) => {
                      setClientSearch(e.target.value);
                      setShowClientDropdown(true);
                    }}
                    class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 outline-none"
                  />
                  <Show when={showClientDropdown()}>
                    <div class="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
                      <Show
                        when={filteredClients().length > 0}
                        fallback={
                          <div class="px-3 py-2 text-sm text-gray-500">
                            No client found
                          </div>
                        }
                      >
                        <For each={filteredClients()}>
                          {(client) => (
                            <button
                              type="button"
                              // ── CHANGED: triggers AJAX project load ──────
                              onClick={() => {
                                handleInputChange("client_id", client.id);
                                setClientSearch(client.email);
                                setShowClientDropdown(false);
                                loadProjectsForClient(client.id); // ← NEW
                              }}
                              class="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 dark:hover:bg-gray-800 transition-colors"
                            >
                              {client.email}
                            </button>
                          )}
                        </For>
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>

              {/* ── Project dropdown — CHANGED entirely ── */}
              <div>
                <label class="block text-sm font-medium mb-1.5">
                  Project Name
                  {/* Live status hint next to label */}
                  <Show when={projectsLoading()}>
                    <span class="ml-2 text-xs text-purple-500 font-normal animate-pulse">
                      Loading…
                    </span>
                  </Show>
                  <Show
                    when={
                      !projectsLoading() &&
                      formData().client_id &&
                      projects().length > 0
                    }
                  >
                    <span class="ml-2 text-xs text-gray-400 font-normal">
                      {projects().length} project
                      {projects().length !== 1 ? "s" : ""} found
                    </span>
                  </Show>
                </label>

                <div class="relative">
                  <input
                    type="text"
                    value={projectSearch()}
                    // ── Placeholder communicates current state clearly ──
                    placeholder={
                      !formData().client_id
                        ? "Select a client first…"
                        : projectsLoading()
                          ? "Loading projects…"
                          : projects().length === 0
                            ? "No projects for this client"
                            : "Search project…"
                    }
                    // ── Disabled until a client is chosen and projects have loaded ──
                    disabled={!formData().client_id || projectsLoading()}
                    onClick={() => {
                      if (
                        formData().client_id &&
                        !projectsLoading() &&
                        projects().length > 0
                      ) {
                        setShowProjectDropdown(true);
                      }
                    }}
                    onInput={(e) => {
                      setProjectSearch(e.target.value);
                      setShowProjectDropdown(true);
                    }}
                    class={`w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600
                      bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 outline-none
                      transition-opacity
                      ${
                        !formData().client_id || projectsLoading()
                          ? "opacity-50 cursor-not-allowed"
                          : ""
                      }`}
                  />

                  {/* Spinner inside the input when loading */}
                  <Show when={projectsLoading()}>
                    <div class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                      <svg
                        class="w-4 h-4 text-purple-500 animate-spin"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          class="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="4"
                        />
                        <path
                          class="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v8H4z"
                        />
                      </svg>
                    </div>
                  </Show>

                  {/* Dropdown list */}
                  <Show when={showProjectDropdown() && !projectsLoading()}>
                    <div class="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
                      <Show
                        when={filteredProjects().length > 0}
                        fallback={
                          <div class="px-3 py-2 text-sm text-gray-500">
                            No project found
                          </div>
                        }
                      >
                        <For each={filteredProjects()}>
                          {(project) => (
                            <button
                              type="button"
                              onClick={() => {
                                handleInputChange("project_id", project.id);
                                setProjectSearch(project.name);
                                setShowProjectDropdown(false);
                              }}
                              class="w-full text-left px-3 py-2 text-sm hover:bg-purple-50 dark:hover:bg-gray-800 transition-colors"
                            >
                              {project.name}
                            </button>
                          )}
                        </For>
                      </Show>
                    </div>
                  </Show>
                </div>
              </div>

              {/* Rule Type — unchanged */}
              <div>
                <label class="block text-sm font-medium mb-1.5">
                  Rule Type
                </label>
                <input
                  type="text"
                  value={formData().rule_type}
                  readonly
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 cursor-not-allowed outline-none"
                />
              </div>

              {/* Rule Value — unchanged */}
              <div>
                <label class="block text-sm font-medium mb-1.5">
                  Rule Value
                </label>
                <input
                  type="number"
                  value={formData().rule_value}
                  onInput={(e) =>
                    handleInputChange("rule_value", e.target.value)
                  }
                  placeholder="Enter markup percentage"
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 outline-none"
                />
              </div>

              {/* Notes — unchanged */}
              <div>
                <label class="block text-sm font-medium mb-1.5">Notes</label>
                <textarea
                  rows="4"
                  value={formData().notes}
                  onInput={(e) => handleInputChange("notes", e.target.value)}
                  placeholder="Add notes..."
                  class="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                />
              </div>
            </div>

            {/* Footer — unchanged */}
            <div class="px-6 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 flex gap-3">
              <button
                onClick={closeSidebar}
                class="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitConfig}
                disabled={submitting()}
                class="flex-1 px-4 py-2.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition"
              >
                {submitting()
                  ? isEditMode()
                    ? "Saving…"
                    : "Adding…"
                  : isEditMode()
                    ? "Save Changes"
                    : "Add Config"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
