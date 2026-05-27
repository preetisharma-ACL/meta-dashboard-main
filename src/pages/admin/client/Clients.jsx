import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchClients } from "../services/fetchClients";
import { setProjectsCache } from "../../../cacheStore/appStore";

// ─── helpers ─────────────────────────────────────────────────────────────────

const TYPE_COLORS = {
  hybrid: "bg-purple-100 text-purple-700 ring-1 ring-purple-300",
  cpl: "bg-amber-100  text-amber-700  ring-1 ring-amber-300",
  retainer: "bg-sky-100    text-sky-700    ring-1 ring-sky-300",
};

const fmtType = (t) =>
  String(t ?? "")
    .charAt(0)
    .toUpperCase() + String(t ?? "").slice(1);

const fmt = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// Avatar initials from client_nomen_name e.g. "AkashSrivastavGarg…" → "AS"
const avatar = (name) => {
  const s = String(name ?? "").trim();
  if (!s) return "?";
  const words = s.match(/[A-Z][a-z]*/g);
  if (words && words.length >= 2)
    return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
};

const AVATAR_PALETTE = [
  "bg-purple-600",
  "bg-blue-600",
  "bg-emerald-600",
  "bg-amber-500",
  "bg-rose-500",
  "bg-indigo-600",
];
const avatarColor = (str) => {
  const s = String(str ?? "");
  return s
    ? AVATAR_PALETTE[s.charCodeAt(0) % AVATAR_PALETTE.length]
    : AVATAR_PALETTE[0];
};

// ─── component ───────────────────────────────────────────────────────────────
export default function Clients() {
  const navigate = useNavigate();

  const [clients, setClients] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [search, setSearch] = createSignal("");
  const [typeFilter, setTypeFilter] = createSignal("all");
  const [activeFilter, setActiveFilter] = createSignal("All");
  const [sortKey, setSortKey] = createSignal("created_at");
  const [sortDir, setSortDir] = createSignal("desc");
  const [selected, setSelected] = createSignal(new Set());
  const [impersonating, setImpersonating] = createSignal(null);
  const [allClients, setAllClients] = createSignal([]);

  // ── pagination state ──────────────────────────────────────────────────────
  const [page, setPage] = createSignal(1);
  const [pageSize] = createSignal(20);
  const [total, setTotal] = createSignal(0);
  const [totalPages, setTotalPages] = createSignal(1);
  const [hasNext, setHasNext] = createSignal(false);
  const [hasPrev, setHasPrev] = createSignal(false);

  // ── load ──────────────────────────────────────────────────────────────────
  const loadClients = async (pageNo = 1) => {
    setLoading(true);
    try {
      const res = await fetchClients(pageNo, pageSize());
      setClients(res.data ?? []);

      // Wire up pagination meta from API response
      const pagination = res.meta?.pagination;
      if (pagination) {
        setPage(pagination.page);
        setTotal(pagination.total);
        setTotalPages(pagination.total_pages);
        setHasNext(pagination.has_next);
        setHasPrev(pagination.has_prev);
      }
    } catch (err) {
      console.error("Failed to load clients:", err);
    } finally {
      setLoading(false);
    }
  };

  const loadAllClients = async () => {
    try {
      let currentPage = 1;
      let hasMore = true;
      let allData = [];

      while (hasMore) {
        const res = await fetchClients(currentPage, 1000);

        const clientsData = res.data || [];

        allData = [...allData, ...clientsData];

        const pagination = res.meta?.pagination;

        hasMore = pagination?.has_next;
        currentPage++;
      }

      setAllClients(allData);
    } catch (err) {
      console.error("Failed to load all clients:", err);
    }
  };

  onMount(() => {
    loadClients(1);
    loadAllClients();
  });

  // ── sort ──────────────────────────────────────────────────────────────────
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

  // ── client-side filter + sort (applied to the current page's data) ────────
  const filtered = createMemo(() => {
   let data = [...allClients()];

    const q = search().trim().toLowerCase();
    if (q) {
      data = data.filter(
        (c) =>
          c.email?.toLowerCase().includes(q) ||
          c.client_nomen_name?.toLowerCase().includes(q) ||
          c.organization_name?.toLowerCase().includes(q),
      );
    }

    if (typeFilter() !== "all")
      data = data.filter((c) => c.client_type === typeFilter());

    if (activeFilter() === "Yes") data = data.filter((c) => c.is_active);
    else if (activeFilter() === "No") data = data.filter((c) => !c.is_active);

    data.sort((a, b) => {
      let va = a[sortKey()],
        vb = b[sortKey()];
      if (sortKey() === "created_at") {
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

  // ── select-all (scoped to current filtered page) ──────────────────────────
  const allSelected = createMemo(
    () =>
      filtered().length > 0 && filtered().every((c) => selected().has(c.id)),
  );
  const toggleAll = () => {
    setSelected(
      allSelected() ? new Set() : new Set(filtered().map((c) => c.id)),
    );
  };
  const toggleOne = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── impersonation ─────────────────────────────────────────────────────────
  const handleImpersonate = (client) => {
    setImpersonating(client.id);

    const realAdmin = localStorage.getItem("auth");
    if (realAdmin) sessionStorage.setItem("admin_auth_backup", realAdmin);

    const clientAuth = client.auth ?? {
      token: client.impersonation_token ?? JSON.parse(realAdmin ?? "{}").token,
      role: "client",
      clientId: client.id,
      clientName: client.client_nomen_name,
      organizationId: client.organization,
      email: client.email,
      _impersonating: true,
      _adminEmail: JSON.parse(realAdmin ?? "{}").email,
    };

    // localStorage.setItem("auth", JSON.stringify(clientAuth));
    // navigate("/");
  };

  const handleClientDashboard = (client) => {
    localStorage.setItem("selectedClientNomen", client.client_nomen_name);
    localStorage.setItem("selectedClientNomenId", client.client_nomen);
    localStorage.setItem("selectedClientName", client.organization_name);

    setProjectsCache({
      data: [],
      insightsMap: {},
      lastFetched: 0,
      loading: false,
      meta: {
        page: 1,
        page_size: 20,
        total: 0,
        total_pages: 1,
        has_next: false,
        has_prev: false,
      },
    });

    navigate(`/${client.client_nomen_name.toLowerCase().replace(/\s+/g, "-")}`);
  };

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 lg:p-8">
      {/* ── Page header ── */}
      <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
            Clients
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {total()} total · click a row to open that client's dashboard
          </p>
        </div>
      </div>

      {/* ── Filters ── */}
      <div
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                        dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3"
      >
        {/* Search */}
        <div class="relative flex-1 min-w-[220px]">
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
            placeholder="Search by email, client name, or org…"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200
                               dark:border-gray-700 dark:bg-gray-800 dark:text-white
                               focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </div>

        {/* Type filter */}
        <div class="flex items-center gap-1 text-sm">
          <span class="text-gray-500 dark:text-gray-400 hidden sm:block mr-1">
            Type:
          </span>
          {[
            { label: "All", value: "all" },
            { label: "Hybrid", value: "hybrid" },
            { label: "CPL", value: "cpl" },
            { label: "Retainer", value: "retainer" },
          ].map(({ label, value }) => (
            <button
              onClick={() => setTypeFilter(value)}
              class={`px-3 py-1.5 rounded-lg transition-colors font-medium ${
                typeFilter() === value
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Active filter */}
        <div class="flex items-center gap-1 text-sm">
          <span class="text-gray-500 dark:text-gray-400 hidden sm:block mr-1">
            Active:
          </span>
          {["All", "Yes", "No"].map((a) => (
            <button
              onClick={() => setActiveFilter(a)}
              class={`px-3 py-1.5 rounded-lg transition-colors font-medium ${
                activeFilter() === a
                  ? "bg-purple-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {a}
            </button>
          ))}
        </div>

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {filtered().length} on this page
        </span>
      </div>

      {/* ── Table ── */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr
              class="border-b border-gray-200 dark:border-gray-700
                                   bg-gray-50 dark:bg-gray-800/60 text-gray-500
                                   dark:text-gray-400 uppercase text-xs tracking-wider"
            >
              <th class="p-3 w-10">
                <input
                  type="checkbox"
                  checked={allSelected()}
                  onChange={toggleAll}
                  class="rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("email")}
              >
                User {sortIcon("email")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("client_nomen_name")}
              >
                Client Nomen {sortIcon("client_nomen_name")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("organization_name")}
              >
                Organisation {sortIcon("organization_name")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("client_type")}
              >
                Client Type {sortIcon("client_type")}
              </th>
              <th class="p-3 text-center whitespace-nowrap">Is Active</th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("created_at")}
              >
                Created At {sortIcon("created_at")}
              </th>
              <th class="p-3 text-center whitespace-nowrap">Action</th>
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
                        <div class="w-4 h-4 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="flex items-center gap-2">
                          <div class="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700" />
                          <div class="h-3 w-40 bg-gray-200 dark:bg-gray-700 rounded" />
                        </div>
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-44 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-5 w-5 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3 text-center">
                        <div class="h-8 w-20 bg-gray-200 dark:bg-gray-700 rounded-lg mx-auto" />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={filtered()}>
                {(client, i) => (
                  <tr
                    class={`border-b border-gray-100 dark:border-gray-800
                                                hover:bg-purple-50/60 
                                                transition-colors group cursor-pointer
                                                ${
                                                  selected().has(client.id)
                                                    ? "bg-purple-50 dark:bg-purple-900/10"
                                                    : i() % 2 === 0
                                                      ? "bg-white dark:bg-gray-900"
                                                      : "bg-gray-50/60 dark:bg-gray-800/30"
                                                }`}
                    onClick={() => handleClientDashboard(client)}
                  >
                    {/* Checkbox */}
                    <td class="p-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected().has(client.id)}
                        onChange={() => toggleOne(client.id)}
                        class="rounded border-gray-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                      />
                    </td>

                    {/* Email + avatar */}
                    <td class="p-3">
                      <div class="flex items-center gap-2.5">
                        <span
                          class={`w-8 h-8 rounded-full flex-shrink-0 flex items-center
                                                              justify-center text-white text-xs font-bold
                                                              ${avatarColor(client.client_nomen_name)}`}
                        >
                          {avatar(client.client_nomen_name)}
                        </span>
                        <span class="text-purple-700 dark:text-gray-300 group-hover:underline font-medium">
                          {client.email}
                        </span>
                      </div>
                    </td>

                    {/* client_nomen_name */}
                    <td class="p-3 text-gray-700 dark:text-gray-300 font-medium">
                      {client.client_nomen_name}
                    </td>

                    {/* organization_name */}
                    <td class="p-3 text-gray-500 dark:text-gray-400">
                      {client.organization_name ?? "—"}
                    </td>

                    {/* Type badge */}
                    <td class="p-3 text-center">
                      <span
                        class={`px-2.5 py-0.5 rounded-full text-xs font-semibold
                                                          ${TYPE_COLORS[client.client_type] ?? "bg-gray-100 text-gray-600"}`}
                      >
                        {fmtType(client.client_type)}
                      </span>
                    </td>

                    {/* Is Active */}
                    <td class="p-3 text-center">
                      {client.is_active ? (
                        <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-600">
                          <svg
                            class="w-3.5 h-3.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        </span>
                      ) : (
                        <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-500">
                          <svg
                            class="w-3.5 h-3.5"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                              clip-rule="evenodd"
                            />
                          </svg>
                        </span>
                      )}
                    </td>

                    {/* Created at */}
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {fmt(client.created_at)}
                    </td>

                    {/* View button */}
                    <td
                      class="p-3 text-center"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => handleImpersonate(client)}
                        disabled={impersonating() === client.id}
                        class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg
                                                       bg-purple-600 hover:bg-purple-700 disabled:opacity-60
                                                       text-white text-xs font-semibold shadow-sm transition-all"
                      >
                        <Show
                          when={impersonating() === client.id}
                          fallback={
                            <>
                              <svg
                                class="w-3.5 h-3.5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                stroke-width="2.2"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                                />
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                                />
                              </svg>
                              View
                            </>
                          }
                        >
                          <svg
                            class="w-3.5 h-3.5 animate-spin"
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
                              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                            />
                          </svg>
                          Opening…
                        </Show>
                      </button>
                    </td>
                  </tr>
                )}
              </For>

              {/* Empty state */}
              <Show when={filtered().length === 0}>
                <tr>
                  <td
                    colspan="8"
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
                    No clients match your filters
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>

          {/* ── Footer: row count + selection ── */}
          <tfoot>
            <tr class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <td
                colspan="8"
                class="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400"
              >
                {filtered().length} client{filtered().length !== 1 ? "s" : ""}{" "}
                on this page
                {selected().size > 0 && ` · ${selected().size} selected`}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* ── Pagination ── */}
      <div class="flex items-center justify-between mt-5 flex-wrap gap-3">
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {total() === 0
            ? "No results"
            : `Showing ${(page() - 1) * pageSize() + 1}–${Math.min(
                page() * pageSize(),
                total(),
              )} of ${total()} clients`}
        </span>

        <div class="flex items-center gap-2">
          <button
            onClick={() => {
              if (hasPrev()) {
                setSelected(new Set()); // clear selection on page change
                loadClients(page() - 1);
              }
            }}
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
            onClick={() => {
              if (hasNext()) {
                setSelected(new Set()); // clear selection on page change
                loadClients(page() + 1);
              }
            }}
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
