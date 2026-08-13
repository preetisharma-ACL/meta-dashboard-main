import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { fetchManualBatches, createManualBatch } from "../services/feededLeads";
import { fetchClients } from "../services/fetchClients";
import { fetchProjectDisplayConfig } from "../services/projectDisplayConfig";
import { fetchProjectsByClient } from "../services/fetchProjectsByClient";
import Avatar from "../../../components/common/Avatar";
import RowsPerPageSelect from "../../../components/common/RowsPerPageSelect";
import SuccessToast, {showToast} from "../../../components/common/SuccessToast";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatCost = (val) => {
  if (val == null || val === "") return "—";
  return `₹${parseFloat(val).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ManualBatches() {
  const [batches, setBatches] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  const [search, setSearch] = createSignal("");
  const [revokedFilter, setRevokedFilter] = createSignal("all");
  const [sortKey, setSortKey] = createSignal("id");
  const [sortDir, setSortDir] = createSignal("desc");
  const [clients, setClients] = createSignal([]);
  const [configs, setConfigs] = createSignal([]);
  const [projects, setProjects] = createSignal([]);
  const [projectsLoading, setProjectsLoading] = createSignal(false);
  const [sidebarMounted, setSidebarMounted] = createSignal(false);
  const [sidebarVisible, setSidebarVisible] = createSignal(false);

  const [submitting, setSubmitting] = createSignal(false);

  const [clientSearch, setClientSearch] = createSignal("");
  const [projectSearch, setProjectSearch] = createSignal("");

  const [showClientDropdown, setShowClientDropdown] = createSignal(false);
  const [showProjectDropdown, setShowProjectDropdown] = createSignal(false);

  // Pagination
  const [page, setPage] = createSignal(1);
  const [totalPages, setTotalPages] = createSignal(1);
  const [total, setTotal] = createSignal(0);
  const [hasNext, setHasNext] = createSignal(false);
  const [hasPrev, setHasPrev] = createSignal(false);
  // Requested rows per page (remembered) vs. the size the server applied.
  const [pageSize, setPageSize] = createSignal(
    Number(localStorage.getItem("feededLeadsRowsPerPage")) || 20,
  );
  const [appliedPageSize, setAppliedPageSize] = createSignal(pageSize());
  const [formData, setFormData] = createSignal({
    target_client_id: "",
    project_id: "",
    synthetic_lead_count: "",
    total_cost: "",
    received_date: "",
    notes: "",
  });

  // ── Fetch ─────────────────────────────────────────────────────────────────

  const loadBatches = async (pageNum = 1, size = pageSize()) => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetchManualBatches(pageNum, size);

      const raw = Array.isArray(res.data)
        ? res.data
        : (res.data?.results ?? []);

      const pagination = res.meta?.pagination ?? null;

      setBatches(raw);
      setPage(pageNum);
      setTotalPages(pagination?.total_pages ?? 1);
      setTotal(pagination?.total ?? raw.length);
      setAppliedPageSize(Number(pagination?.page_size) || size);
      setHasNext(pagination?.has_next ?? false);
      setHasPrev(pagination?.has_prev ?? false);
    } catch (err) {
      console.error(err);
      setError("Failed to load manual batches. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Rows per page — always restart at page 1; the old page number can be past
  // the end once the page grows.
  const changeRowsPerPage = (size) => {
    if (size === pageSize()) return;
    setPageSize(size);
    localStorage.setItem("feededLeadsRowsPerPage", String(size));
    loadBatches(1, size);
  };

  onMount(async () => {
    await loadBatches(1);

    try {
      const clientRes = await fetchClients(1, 500);
      console.log("Fetched clients:", clientRes.data);
      setClients(clientRes.data ?? []);

      const configRes = await fetchProjectDisplayConfig();

      setConfigs(configRes.data ?? []);
    } catch (err) {
      console.error(err);
    }
  });

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
      console.error("Failed to load projects:", err);
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  };

  // ── Sort toggle ───────────────────────────────────────────────────────────

  const toggleSort = (key) => {
    if (sortKey() === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
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

  // ── Client-side filter + sort on current page ─────────────────────────────

  const filtered = createMemo(() => {
    let data = [...batches()];

    // Search
    const q = search().trim().toLowerCase();
    if (q) {
      data = data.filter(
        (b) =>
          b.project_name?.toLowerCase().includes(q) ||
          b.target_client_nomen?.toLowerCase().includes(q) ||
          b.target_client_email?.toLowerCase().includes(q) ||
          b.uploaded_by_email?.toLowerCase().includes(q),
      );
    }

    // Revoked filter
    if (revokedFilter() === "active") data = data.filter((b) => !b.is_revoked);
    if (revokedFilter() === "revoked") data = data.filter((b) => b.is_revoked);

    // Sort
    data.sort((a, b) => {
      let va = a[sortKey()];
      let vb = b[sortKey()];

      if (
        sortKey() === "id" ||
        sortKey() === "synthetic_lead_count" ||
        sortKey() === "lead_count"
      ) {
        va = Number(va);
        vb = Number(vb);
      } else if (sortKey() === "total_cost") {
        va = parseFloat(va ?? 0);
        vb = parseFloat(vb ?? 0);
      } else if (sortKey() === "uploaded_at") {
        va = new Date(va);
        vb = new Date(vb);
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

  // ── Clear filters ─────────────────────────────────────────────────────────

  const clearFilters = () => {
    setSearch("");
    setRevokedFilter("all");
    setSortKey("id");
    setSortDir("desc");
  };

  const openSidebar = () => {
    setSidebarMounted(true);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setSidebarVisible(true);
      });
    });
  };

  const closeSidebar = () => {
    setSidebarVisible(false);

    setShowClientDropdown(false);
    setShowProjectDropdown(false);

    setTimeout(() => {
      setSidebarMounted(false);

      setFormData({
        target_client_id: "",
        project_id: "",
        synthetic_lead_count: "",
        total_cost: "",
        received_date: "",
        notes: "",
      });

      setClientSearch("");
      setProjectSearch("");
      setProjects([]);
    }, 300);
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const activeFilterCount = createMemo(
    () => [search(), revokedFilter()].filter((v) => v && v !== "all").length,
  );

  const filteredClients = createMemo(() => {
    const q = clientSearch().trim().toLowerCase();

    if (!q) return clients();

    return clients().filter(
      (c) =>
        c.email?.toLowerCase().includes(q) ||
        c.client_nomen_name?.toLowerCase().includes(q),
    );
  });

  const filteredProjects = createMemo(() => {
    const q = projectSearch().trim().toLowerCase();

    if (!q) return projects();

    return projects().filter((p) => p.name?.toLowerCase().includes(q));
  });

  const handleSubmit = async () => {
    try {
      setSubmitting(true);

      const payload = {
        project_id: Number(formData().project_id),
        target_client_id: Number(formData().target_client_id),
        synthetic_lead_count: Number(formData().synthetic_lead_count),
        total_cost: formData().total_cost,
        notes: formData().notes,
      };

      // received_date is optional. The <input type="date"> already yields a
      // "YYYY-MM-DD" string. Only include it when the user actually picked a
      // date — never send an empty string (backend defaults to upload date
      // when the field is omitted/null).
      const receivedDate = formData().received_date?.trim();
      if (receivedDate) {
        payload.received_date = receivedDate;
      }

      await createManualBatch(payload);
      const leadCount = formData().synthetic_lead_count;
      const projectName =
        projects().find((p) => p.id === Number(formData().project_id))?.name ||
        projectSearch();
      await loadBatches(page());
      closeSidebar();
      showToast(
        `Successfully feeded ${leadCount} leads to the "${projectName}" project.`,
        "Leads feeded",
      );
    } catch (err) {
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-3 lg:p-8">
      {/* Page Header */}
      <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          {/* Same heading treatment as the dashboard: crimson→gold tile with
              this section's sidebar glyph, gradient wordmark, description
              indented by tile (36px) + gap (10px). */}
          <h1 class="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7E1522] via-[#AC2334] via-70% to-[#C4802B] text-white shadow-[0_2px_8px_rgba(126,21,34,.32)]">
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </span>
            <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
              Manual Batches
            </span>
          </h1>
          <p class="pl-[46px] text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {total()} total batches
          </p>
        </div>
        <button
          onClick={openSidebar}
          class="px-4 py-2 text-sm rounded-md
         bg-blue-900 text-white
         hover:bg-blue-800
         transition-colors shadow-sm"
        >
          + Feed Leads
        </button>
       
        <Show when={activeFilterCount() > 0}>
          <button
            onClick={clearFilters}
            class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                   border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
          >
            <svg
              class="w-3.5 h-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            Clear filters
            <span class="bg-red-100 text-red-600 text-xs font-bold px-1.5 rounded-full">
              {activeFilterCount()}
            </span>
          </button>
        </Show>
      </div>

      {/* Filters Bar */}
      <div
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                  dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3"
      >
        {/* Search */}
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
            placeholder="Search by project, client nomen, email…"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white
                   focus:outline-none focus:ring-1 focus:ring-purple-400"
          />
        </div>

        {/* Revoked Filter */}
        <select
          value={revokedFilter()}
          onChange={(e) => setRevokedFilter(e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-1 focus:ring-purple-400 cursor-pointer"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="revoked">Revoked</option>
        </select>

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {filtered().length} result{filtered().length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Error */}
      <Show when={error()}>
        <div
          class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800
                    rounded-xl p-4 mb-4 text-sm text-red-600 dark:text-red-400 flex items-center gap-2"
        >
          <svg
            class="w-4 h-4 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
          {error()}
        </div>
      </Show>

      {/* Table */}
      <div
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                  dark:border-gray-700 overflow-x-auto"
      >
        <table class="min-w-full text-sm">
          <thead>
            <tr
              class="border-b border-gray-200 dark:border-gray-700 bg-gray-50
                       dark:bg-gray-800/60 text-gray-500 dark:text-gray-400
                       uppercase text-xs tracking-wider"
            >
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("id")}
              >
                ID {sortIcon("id")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("project_name")}
              >
                Project {sortIcon("project_name")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("target_client_nomen")}
              >
                Client Nomen {sortIcon("target_client_nomen")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("target_client_email")}
              >
                Client Email {sortIcon("target_client_email")}
              </th>
              <th
                class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("synthetic_lead_count")}
              >
                Feeded leads {sortIcon("synthetic_lead_count")}
              </th>
              <th
                class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("synthetic_lead_count")}
              >
                Leads Count {sortIcon("lead_count")}
              </th>
              <th
                class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("total_cost")}
              >
                Total Cost {sortIcon("total_cost")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("is_revoked")}
              >
                Status {sortIcon("is_revoked")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("uploaded_at")}
              >
                Uploaded At {sortIcon("uploaded_at")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("uploaded_by_email")}
              >
                Uploaded By {sortIcon("uploaded_by_email")}
              </th>
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
                      {Array(9)
                        .fill(0)
                        .map((_, idx) => (
                          <td class="p-3">
                            <div
                              class={`h-3 bg-gray-200 dark:bg-gray-700 rounded
                            ${idx === 1 || idx === 3 ? "w-40" : idx === 7 ? "w-32" : "w-20"}`}
                            />
                          </td>
                        ))}
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={filtered()}>
                {(b, i) => (
                  <tr
                    class={`border-b border-gray-100 dark:border-gray-800
                                transition-colors
                              ${
                                i() % 2 === 0
                                  ? "bg-white dark:bg-gray-900"
                                  : "bg-gray-50/60 dark:bg-gray-800/30"
                              }`}
                  >
                    {/* ID */}
                    <td class="p-3 text-gray-700 dark:text-gray-300 font-medium text-sm whitespace-nowrap">
                      {b.id}
                    </td>

                    {/* Project */}
                    <td class="p-3">
                      <div class="flex items-center gap-2">
                        <div class="flex-shrink-0">
                          <Avatar name={b.project_name} />
                        </div>
                        <div class="flex items-center">
                          <span class="text-purple-700 dark:text-gray-300 font-medium">
                            {b.project_name ?? "—"}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Client Nomen */}
                    <td class="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {b.target_client_nomen ?? "—"}
                    </td>

                    {/* Client Email */}
                    <td class="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {b.target_client_email ?? "—"}
                    </td>

                    {/* Synthetic Lead Count */}
                    <td class="p-3 text-center  font-semibold text-gray-700 dark:text-gray-300">
                      {b.synthetic_lead_count ?? 0}
                    </td>

                    {/* Synthetic Lead Count */}
                    <td class="p-3 text-center font-semibold text-gray-700  dark:text-gray-300">
                      {b.lead_count ?? 0}
                    </td>

                    {/* Total Cost */}
                    <td class="p-3 text-center font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      {formatCost(b.total_cost)}
                    </td>

                    {/* Is Revoked */}
                    <td class="p-3 text-center">
                      {b.is_revoked ? (
                        <span
                          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                                     bg-red-100 text-red-700 text-xs font-semibold ring-1 ring-red-200"
                        >
                          <span class="w-1.5 h-1.5 rounded-full bg-red-500 inline-block" />
                          Revoked
                        </span>
                      ) : (
                        <span
                          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                                     bg-green-100 text-green-700 text-xs font-semibold ring-1 ring-green-200"
                        >
                          <span class="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          Active
                        </span>
                      )}
                    </td>

                    {/* Uploaded At */}
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">
                      {formatDate(b.uploaded_at)}
                    </td>

                    {/* Uploaded By */}
                    <td class="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                      {b.uploaded_by_email ?? "—"}
                    </td>
                  </tr>
                )}
              </For>

              {/* Empty State */}
              <Show when={filtered().length === 0}>
                <tr>
                  <td
                    colspan="10"
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
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    No batches match your filters
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>

          <tfoot>
            <tr class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <td
                colspan="10"
                class="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400"
              >
                {filtered().length} batch{filtered().length !== 1 ? "es" : ""}{" "}
                on this page
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Pagination */}
      <div class="flex items-center justify-between mt-5 flex-wrap gap-3">
        <div class="flex items-center gap-3">
          <span class="text-sm text-gray-500 dark:text-gray-400">
            {total() === 0
              ? "No results"
              : `Showing ${(page() - 1) * appliedPageSize() + 1}–${Math.min(
                  page() * appliedPageSize(),
                  total(),
                )} of ${total()} batches`}
          </span>

          <RowsPerPageSelect value={pageSize()} onChange={changeRowsPerPage} />
        </div>

        <div class="flex items-center gap-2">
          <button
            onClick={() => loadBatches(page() - 1)}
            disabled={!hasPrev() || loading()}
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
            onClick={() => loadBatches(page() + 1)}
            disabled={!hasNext() || loading()}
            class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg
                   bg-red-800 border border-red-800 text-white
                   hover:bg-red-700 disabled:opacity-35 disabled:cursor-default transition-colors"
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

      <Show when={sidebarMounted()}>
        <div class="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            onClick={closeSidebar}
            class="fixed inset-0 bg-black/30 backdrop-blur-sm transition-opacity duration-300"
            style={{
              opacity: sidebarVisible() ? "1" : "0",
            }}
          />

          {/* Sidebar */}
          <div
            class="fixed inset-y-0 right-0 z-50 w-full max-w-md
             bg-white dark:bg-gray-900
             border-l border-gray-200 dark:border-gray-700
             shadow-2xl flex flex-col
             transition-transform duration-300 ease-in-out"
            style={{
              transform: sidebarVisible()
                ? "translateX(0)"
                : "translateX(100%)",
            }}
          >
            {/* Header */}
            <div
              class="flex items-center justify-between px-6 py-4
               border-b border-gray-200 dark:border-gray-700
               bg-gray-50 dark:bg-gray-800"
            >
              <div>
                <h2 class="text-lg font-bold text-gray-800 dark:text-white">
                  Feed Leads
                </h2>

                <p class="text-sm text-gray-500 dark:text-gray-400">
                  Create manual lead batch
                </p>
              </div>

              <button
                onClick={closeSidebar}
                class="w-8 h-8 rounded-full flex items-center justify-center
                 hover:bg-gray-200 dark:hover:bg-gray-700 transition"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">
              {/* Client Dropdown */}
              <div>
                <label class="block text-sm font-medium mb-1.5">Client</label>

                <div class="relative">
                  <input
                    type="text"
                    value={clientSearch()}
                    placeholder="Search email or nomen..."
                    onFocus={() => setShowClientDropdown(true)}
                    onInput={(e) => {
                      setClientSearch(e.target.value);
                      setShowClientDropdown(true);
                    }}
                    class="w-full px-3 py-2 rounded-lg border
                     border-gray-300 dark:border-gray-600
                     bg-white dark:bg-gray-800
                     focus:ring-2 focus:ring-purple-500
                     outline-none"
                  />

                  <Show when={showClientDropdown()}>
                    <div
                      class="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto
                       rounded-lg border border-gray-200 dark:border-gray-700
                       bg-white dark:bg-gray-900 shadow-xl"
                    >
                      <For each={filteredClients()}>
                        {(client) => (
                          <button
                            type="button"
                            onClick={() => {
                              handleInputChange("target_client_id", client.id);

                              setClientSearch(
                                `${client.client_nomen_name} (${client.email})`,
                              );

                              setShowClientDropdown(false);

                              loadProjectsForClient(client.id);
                            }}
                            class="w-full text-left px-3 py-2
                             hover:bg-purple-50 dark:hover:bg-gray-800
                             transition-colors"
                          >
                            <div class="font-medium">
                              {client.client_nomen_name}
                            </div>

                            <div class="text-xs text-gray-500">
                              {client.email}
                            </div>
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>

              {/* Project Dropdown */}
              <div>
                <label class="block text-sm font-medium mb-1.5">Project</label>

                <div class="relative">
                  <input
                    type="text"
                    disabled={!formData().target_client_id || projectsLoading()}
                    value={projectSearch()}
                    placeholder={
                      !formData().target_client_id
                        ? "Select client first..."
                        : projectsLoading()
                          ? "Loading projects..."
                          : "Search project..."
                    }
                    onFocus={() => setShowProjectDropdown(true)}
                    onInput={(e) => {
                      setProjectSearch(e.target.value);
                      setShowProjectDropdown(true);
                    }}
                    class="w-full px-3 py-2 rounded-lg border
                     border-gray-300 dark:border-gray-600
                     bg-white dark:bg-gray-800
                     focus:ring-2 focus:ring-purple-500
                     outline-none disabled:opacity-50"
                  />

                  <Show when={showProjectDropdown()}>
                    <div
                      class="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto
                       rounded-lg border border-gray-200 dark:border-gray-700
                       bg-white dark:bg-gray-900 shadow-xl"
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
                            class="w-full text-left px-3 py-2
                             hover:bg-purple-50 dark:hover:bg-gray-800
                             transition-colors"
                          >
                            {project.name}
                          </button>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>

              {/* Leads Count */}
              <div>
                <label class="block text-sm font-medium mb-1.5">
                  Feeded Leads Count
                </label>

                <input
                  type="number"
                  value={formData().synthetic_lead_count}
                  onInput={(e) =>
                    handleInputChange("synthetic_lead_count", e.target.value)
                  }
                  class="w-full px-3 py-2 rounded-lg border
                   border-gray-300 dark:border-gray-600
                   bg-white dark:bg-gray-800
                   focus:ring-2 focus:ring-purple-500
                   outline-none"
                />
              </div>

              {/* Total Cost */}
              <div>
                <label class="block text-sm font-medium mb-1.5">
                  Total Cost
                </label>

                <input
                  type="number"
                  step="0.01"
                  value={formData().total_cost}
                  onInput={(e) =>
                    handleInputChange("total_cost", e.target.value)
                  }
                  class="w-full px-3 py-2 rounded-lg border
                   border-gray-300 dark:border-gray-600
                   bg-white dark:bg-gray-800
                   focus:ring-2 focus:ring-purple-500
                   outline-none"
                />
              </div>

              {/* Received date (optional) */}
              <div>
                <label class="block text-sm font-medium mb-1.5">
                  Received date{" "}
                  <span class="text-gray-400 font-normal">(optional)</span>
                </label>

                <input
                  type="date"
                  value={formData().received_date}
                  onInput={(e) =>
                    handleInputChange("received_date", e.target.value)
                  }
                  class="w-full px-3 py-2 rounded-lg border
                   border-gray-300 dark:border-gray-600
                   bg-white dark:bg-gray-800
                   focus:ring-2 focus:ring-purple-500
                   outline-none"
                />

                <p class="text-xs text-gray-400 mt-1">
                  Leave blank to use today's upload date.
                </p>
              </div>

              {/* Notes */}
              <div>
                <label class="block text-sm font-medium mb-1.5">Notes</label>

                <textarea
                  rows="4"
                  value={formData().notes}
                  onInput={(e) => handleInputChange("notes", e.target.value)}
                  class="w-full px-3 py-2 rounded-lg border
                   border-gray-300 dark:border-gray-600
                   bg-white dark:bg-gray-800
                   focus:ring-2 focus:ring-purple-500
                   outline-none resize-none"
                />
              </div>
            </div>

            {/* Footer */}
            <div
              class="px-6 py-4 border-t border-gray-200 dark:border-gray-700
               bg-gray-50 dark:bg-gray-800 flex gap-3"
            >
              <button
                onClick={closeSidebar}
                class="flex-1 px-4 py-2.5 rounded-lg border
                 border-gray-300 dark:border-gray-600
                 hover:bg-gray-100 dark:hover:bg-gray-700
                 transition"
              >
                Cancel
              </button>

              <button
                onClick={handleSubmit}
                disabled={
                  submitting() ||
                  !formData().target_client_id ||
                  !formData().project_id ||
                  !formData().synthetic_lead_count ||
                  !formData().total_cost
                }
                class="flex-1 px-4 py-2.5 rounded-lg
                 bg-purple-600 text-white
                 hover:bg-purple-700
                 disabled:opacity-50
                 transition"
              >
                {submitting() ? "Submitting..." : "Feed Leads"}
              </button>
            </div>
          </div>
        </div>
      </Show>
      <SuccessToast />
    </div>
  );
}
