import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { fetchClientNomen } from "../services/clientNomen";
import Avatar from "../../../components/common/Avatar";
import { useClientNomen } from "../../../hooks/useClientNomen";

// ─── Format date ──────────────────────────────────────────────────────────────
const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ClientNomen() {
  const [nomens, setNomens] = createSignal([]);
  const [allNomens, setAllNomens] = createSignal([]);
  const [search, setSearch] = createSignal("");
  const [hasClientFilter, setHasClientFilter] = createSignal("All");
  const [sortKey, setSortKey] = createSignal("id");
  const [sortDir, setSortDir] = createSignal("asc");

  // Pagination — server-driven
  const [page, setPage] = createSignal(1);
  const [totalPages, setTotalPages] = createSignal(1);
  const [hasNext, setHasNext] = createSignal(false);
  const [hasPrev, setHasPrev] = createSignal(false);

  const nomen = useClientNomen();

  const loading = () => nomen.isLoading;
  const total = () => (nomen.data ?? []).length;

  // ── Fetch one page from server ────────────────────────────────────────────
  const loadNomens = async () => {
    setLoading(true);

    try {
      let pageNo = 1;
      let allData = [];
      let hasNextPage = true;

      while (hasNextPage) {
        const res = await fetchClientNomen(pageNo);

        allData = [...allData, ...(res.data ?? [])];

        const p = res.meta?.pagination;

        hasNextPage = p?.has_next;
        pageNo++;
      }

      setAllNomens(allData);
      setNomens(allData);

      setTotal(allData.length);
      setTotalPages(1);
      setPage(1);
    } catch (err) {
      console.error("Failed to load client nomens:", err);
    } finally {
      setLoading(false);
    }
  };
  onMount(() => loadNomens());

  // ── Sort toggle ───────────────────────────────────────────────────────────
  const toggleSort = (key) => {
    if (sortKey() === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
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

  // ── Client-side filter + sort on current page data ────────────────────────
  const filtered = createMemo(() => {
     let data = [...(nomen.data ?? [])];

    // Search by name
    const q = search().trim().toLowerCase();
    if (q) {
      data = data.filter((n) => n.name?.toLowerCase().includes(q));
    }

    // Filter by has_client
    if (hasClientFilter() === "Yes") data = data.filter((n) => n.has_client);
    if (hasClientFilter() === "No") data = data.filter((n) => !n.has_client);

    // Sort
    data.sort((a, b) => {
      let va = a[sortKey()];
      let vb = b[sortKey()];

      if (sortKey() === "id") {
        va = Number(va);
        vb = Number(vb);
      } else if (sortKey() === "created_at") {
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

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 lg:p-8">
      {/* Page Header */}
      <div class="mb-6">
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
          Client Nomenclatures
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {total()} total · click column headers to sort
        </p>
      </div>

      {/* Filters Bar */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
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
            placeholder="Search by name…"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white
                   focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>

        {/* Has Login Filter Dropdown */}
        <select
          value={hasClientFilter()}
          onChange={(e) => setHasClientFilter(e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer"
        >
          <option value="All">All Login Status</option>
          <option value="Yes">Has Login</option>
          <option value="No">No Login</option>
        </select>

        <button
          onClick={() => {
            setSearch("");
            setHasClientFilter("All");
            setSortKey("created_at");
            setSortDir("desc");
          }}
          class="px-3 py-2 text-sm  rounded-lg
                bg-red-50 text-red-600 border border-red-200
                hover:bg-red-100 hover:border-red-300
                dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700
                transition-colors"
        >
          Clear All
        </button>

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {filtered().length} on this page
        </span>
      </div>

      {/* Table */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          {/* Table Head */}
          <thead>
            <tr
              class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60
                       text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider"
            >
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("id")}
              >
                ID {sortIcon("id")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("name")}
              >
                Name {sortIcon("name")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("has_client")}
              >
                Has Login {sortIcon("has_client")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("created_at")}
              >
                Created At {sortIcon("created_at")}
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
                      <td class="p-3">
                        <div class="h-3 w-10 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-56 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-28 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={filtered()}>
                {(nomen, i) => (
                  <tr
                    class={`border-b border-gray-100 dark:border-gray-800
                               hover:bg-purple-50/60 transition-colors
                               ${
                                 i() % 2 === 0
                                   ? "bg-white dark:bg-gray-900"
                                   : "bg-gray-50/60 dark:bg-gray-800/30"
                               }`}
                  >
                    {/* ID — maps to id */}
                    <td class="p-3 text-purple-700 dark:text-gray-300 font-medium">
                      {nomen.id}
                    </td>

                    {/* Name — maps to name */}
                    <td class="p-3">
                      <div class="flex items-center gap-2">
                        <Avatar name={nomen.name} />

                        <span class="text-purple-700 dark:text-gray-300 font-medium">
                          {nomen.name}
                        </span>
                      </div>
                    </td>

                    {/* Has Login — maps to has_client */}
                    <td class="p-3 text-center">
                      {nomen.has_client ? (
                        <span
                          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                                     bg-green-100 text-green-700 text-xs font-semibold"
                        >
                          <span class="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                          Yes
                        </span>
                      ) : (
                        <span
                          class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                                     bg-gray-100 text-gray-500 text-xs font-semibold"
                        >
                          <span class="w-1.5 h-1.5 rounded-full bg-gray-400 inline-block" />
                          No
                        </span>
                      )}
                    </td>

                    {/* Created At — maps to created_at */}
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(nomen.created_at)}
                    </td>
                  </tr>
                )}
              </For>

              {/* Empty State */}
              <Show when={filtered().length === 0}>
                <tr>
                  <td
                    colspan="4"
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
                        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                    </svg>
                    No nomenclatures match your filters
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>

          {/* Table Footer */}
          <tfoot>
            <tr class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <td
                colspan="4"
                class="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400"
              >
                {filtered().length} result{filtered().length !== 1 ? "s" : ""}{" "}
                on this page
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Pagination — server-driven */}
      <div class="flex items-center justify-between mt-5 flex-wrap gap-3">
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {total() === 0
            ? "No results"
            : `Page ${page()} of ${totalPages()} · ${total()} total`}
        </span>

        <div class="flex items-center gap-2">
          <button
            onClick={() => loadNomens(page() - 1)}
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
            onClick={() => loadNomens(page() + 1)}
            disabled={!hasNext() || loading()}
            class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg
                   bg-purple-600 border border-purple-600 text-white
                   hover:bg-purple-700 disabled:opacity-35 disabled:cursor-default transition-colors"
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
