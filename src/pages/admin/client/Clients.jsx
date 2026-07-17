import {
  createSignal,
  createMemo,
  createResource,
  createEffect,
  on,
  onMount,
  For,
  Show,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchClients } from "../services/fetchClients";
import { fetchHierarchyClients } from "../../../services/cm";
import { fetchManagerPerformance } from "../../../services/performance";
import {
  probeAdminSwitchMode,
  fetchManagerOwnClients,
} from "../../../services/cmAdmin";
import { setProjectsCache } from "../../../cacheStore/appStore";
import Avatar from "../../../components/common/Avatar";

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

// Client-type multi-select chips (same pattern as Allowed Budget / Account
// Funding). CPL + Hybrid are on by default; Retainer is off by default.
const CLIENT_TYPE_CHIPS = [
  { key: "cpl", label: "CPL" },
  { key: "hybrid", label: "Hybrid" },
  { key: "retainer", label: "Retainer" },
];
const DEFAULT_CLIENT_TYPES = ["cpl", "hybrid"];

// Assignment (has a campaign manager) filter options.
const ASSIGN_OPTIONS = [
  { value: "all", label: "All Assignment" },
  { value: "assigned", label: "Assigned" },
  { value: "unassigned", label: "Not assigned yet" },
];

// Current month key (YYYY-MM) — the manager roster is month-scoped.
const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Friendly manager name from their email local-part.
const labelFromEmail = (email) => {
  const local = String(email ?? "").split("@")[0] || "—";
  return local.charAt(0).toUpperCase() + local.slice(1);
};

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

// ─── component ───────────────────────────────────────────────────────────────

// Read the caller's role synchronously (same source the route guards use).
const authRole = (() => {
  try {
    return JSON.parse(localStorage.getItem("auth") || "{}")?.role ?? null;
  } catch {
    return null;
  }
})();
const isCampaignManager = () => authRole === "campaign_manager";

// The admin clients endpoint is 403 for CMs, so CMs are sourced from the
// CM-scoped hierarchy endpoint instead. That payload is smaller — this maps it
// onto the fields the table reads. Columns the hierarchy doesn't expose
// (email, organisation, created-at) fall back to null → rendered as "—"; the
// active flag is inferred from has_client_login.
const adaptHierarchyClient = (c) => ({
  id: c.client_nomen_id,
  client_nomen: c.client_nomen_id,
  client_nomen_name: c.client_name ?? "",
  organization_name: c.organization_name ?? null,
  email: c.email ?? null,
  client_type: c.client_type ?? null,
  is_active: c.is_active ?? c.has_client_login ?? true,
  created_at: c.created_at ?? null,
});

export default function Clients() {
  const navigate = useNavigate();

  const [clients, setClients] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [search, setSearch] = createSignal("");
  const [clientTypes, setClientTypes] = createSignal(DEFAULT_CLIENT_TYPES); // multi-select
  const [assignFilter, setAssignFilter] = createSignal("all"); // all | assigned | unassigned
  const [cmFilter, setCmFilter] = createSignal("all"); // "all" | manager_email
  const [activeFilter, setActiveFilter] = createSignal("All");

  // Toggle a client-type chip; never allow an empty selection.
  const toggleClientType = (key) => {
    setClientTypes((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      return next.length ? next : prev;
    });
  };

  // ── Campaign-manager map (client_nomen → owning CM) ────────────────────────
  // The admin clients endpoint carries no owner, so we assemble it the same way
  // the "Campaign Manager's Clients" screen does: roster → switch-mode probe →
  // per-manager own-client lists, joined on the client nomen id.
  // Roster + switch-mode probing are admin-only; skip them entirely for CMs so
  // they don't 403 (and leave the CM filter stuck on "Loading managers…").
  const [rosterRes] = createResource(
    () => (isCampaignManager() ? false : currentMonthKey()),
    async (m) => {
      const res = await fetchManagerPerformance(m);
      return Array.isArray(res?.data) ? res.data : [];
    },
  );
  const managers = () => rosterRes() ?? [];

  const [switchMode, setSwitchMode] = createSignal("unknown");
  createEffect(
    on(managers, (list) => {
      if (switchMode() !== "unknown") return;
      if (!list || list.length === 0) return;
      setSwitchMode("checking");
      probeAdminSwitchMode(list[0].manager_id)
        .then((r) => setSwitchMode(r.allowed ? "allowed" : "denied"))
        .catch(() => setSwitchMode("denied"));
    }),
  );
  const cmAllowed = () => switchMode() === "allowed";

  const [ownLists] = createResource(
    () => (cmAllowed() && managers().length ? managers() : null),
    async (list) => {
      const entries = await Promise.all(
        list.map(async (m) => [
          m.manager_id,
          await fetchManagerOwnClients(m.manager_id),
        ]),
      );
      return Object.fromEntries(entries);
    },
  );

  // nomen (as string) → { email, name } of the first manager that owns it.
  const cmByNomen = createMemo(() => {
    const own = ownLists() ?? {};
    const map = {};
    for (const m of managers()) {
      for (const c of own[m.manager_id] ?? []) {
        const key = String(c.client_nomen_id);
        if (!(key in map)) {
          map[key] = { email: m.manager_email, name: labelFromEmail(m.manager_email) };
        }
      }
    }
    return map;
  });
  const cmForClient = (c) => cmByNomen()[String(c.client_nomen)] ?? null;
  // Map is trustworthy only once the probe allowed it AND the lists resolved.
  const cmReady = () => cmAllowed() && !ownLists.loading && !!ownLists();

  // Every manager from the roster, A→Z, for the CM filter dropdown.
  const managerOptions = createMemo(() =>
    managers()
      .map((m) => ({ email: m.manager_email, name: labelFromEmail(m.manager_email) }))
      .filter((m) => m.email)
      .sort((a, b) => a.name.localeCompare(b.name)),
  );
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
      // CMs: one CM-scoped call returns their whole (small) client set — no
      // server pagination, so we render it as a single page.
      if (isCampaignManager()) {
        const res = await fetchHierarchyClients();
        const rows = (Array.isArray(res?.data) ? res.data : []).map(
          adaptHierarchyClient,
        );
        setClients(rows);
        setAllClients(rows);
        setPage(1);
        setTotal(rows.length);
        setTotalPages(1);
        setHasNext(false);
        setHasPrev(false);
        return;
      }

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
    // CMs already have their full set from loadClients (hierarchy has no paging).
    if (isCampaignManager()) return;
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
 
    // Multi-select client-type filter. Clients with no type always pass through.
    const types = clientTypes();
    data = data.filter((c) => !c.client_type || types.includes(c.client_type));

    // Assignment filter — only applied once the CM map is trustworthy.
    if (cmReady() && assignFilter() !== "all") {
      const wantAssigned = assignFilter() === "assigned";
      data = data.filter((c) => Boolean(cmForClient(c)) === wantAssigned);
    }

    // Campaign-manager filter — clients owned by the selected manager.
    if (cmReady() && cmFilter() !== "all") {
      data = data.filter((c) => cmForClient(c)?.email === cmFilter());
    }

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
    localStorage.setItem("selectedClientNomenId", client.client_nomen); // nomen id
    // Client PK — what as_client_id expects. Distinct from the nomen id above for
    // all but one client, and the backend 404s if handed a nomen id.
    localStorage.setItem("selectedClientId", String(client.id));
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
    // In Clients.jsx, wherever you currently bust the cache before navigating:
    setProjectsCache("lastFetched", 0);
    setProjectsCache("lastFetchedAll", 0); // ← add this
    setProjectsCache("allProjects", []);
    setProjectsCache("insightsMap", {});

    navigate(`/${client.client_nomen_name.toLowerCase().replace(/\s+/g, "-")}`);
  };

  // ─── render ───────────────────────────────────────────────────────────────
  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-2 sm:p-6 lg:p-8">
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

      {/* ── Client-type toggle chips ── */}
      <div class="flex flex-wrap items-center gap-1.5 mb-4">
        <span class="text-[11px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500 mr-1">
          Client type
        </span>
        {/* Keep CPL/Hybrid/Retainer together on a single line */}
        <div class="flex items-center gap-1.5">
          <For each={CLIENT_TYPE_CHIPS}>
            {(t) => {
              const on = () => clientTypes().includes(t.key);
              return (
                <button
                  type="button"
                  onClick={() => toggleClientType(t.key)}
                  aria-pressed={on()}
                  class={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
                    on()
                      ? "bg-[#14233A] text-white border-[#14233A]"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
                  }`}
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <Show when={on()} fallback={<circle cx="12" cy="12" r="9" stroke-width="1.6" />}>
                      <path d="M20 6L9 17l-5-5" />
                    </Show>
                  </svg>
                  {t.label}
                </button>
              );
            }}
          </For>
        </div>
      </div>

      {/* ── Filters ── */}
      <div
        class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                        dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3"
      >
        {/* Search */}
        <div class="relative flex w-full sm:w-[360px]">
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
                               focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>

        {/* Active filter */}
        {/* Active Status Dropdown */}
        <select
          value={activeFilter()}
          onChange={(e) => setActiveFilter(e.target.value)}
          class="w-full sm:w-auto px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
         bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
         focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer"
        >
          <option value="All">All Status</option>
          <option value="Yes">Active</option>
          <option value="No">Inactive</option>
        </select>

        {/* Assignment + Campaign-manager filters are admin-only: they depend on
            the manager roster, which CMs can't read. Hidden for CMs. */}
        <Show when={!isCampaignManager()}>
        <div class="flex w-full sm:w-auto sm:inline-flex items-stretch sm:items-center gap-1 p-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
          <For each={ASSIGN_OPTIONS}>
            {(o) => {
              const on = () => assignFilter() === o.value;
              return (
                <button
                  type="button"
                  onClick={() => setAssignFilter(o.value)}
                  aria-pressed={on()}
                  class={`flex-1 sm:flex-none min-w-0 sm:min-w-fit flex items-center justify-center text-center px-3 py-1.5 text-sm font-medium rounded-md transition-colors sm:whitespace-nowrap ${
                    on()
                      ? "bg-blue-900 text-white shadow-sm"
                      : "text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700"
                  }`}
                >
                  {o.label}
                </button>
              );
            }}
          </For>
        </div>

        {/* Campaign-manager filter */}
        {/* Campaign Manager Dropdown — lists every manager; select to see their clients */}
        <select
          value={cmFilter()}
          onChange={(e) => setCmFilter(e.target.value)}
          disabled={!cmReady() || managerOptions().length === 0}
          class="w-full sm:w-auto px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
         bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
         focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 cursor-pointer
         disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <option value="all">
            {cmReady() ? "All Campaign Managers" : "Loading managers…"}
          </option>
          <For each={managerOptions()}>
            {(m) => <option value={m.email}>{m.name}</option>}
          </For>
        </select>
        </Show>
        {/* Clear All Filters Button */}
        <button
          onClick={() => {
            setSearch("");
            setClientTypes(DEFAULT_CLIENT_TYPES);
            setAssignFilter("all");
            setCmFilter("all");
            setActiveFilter("All");
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
          {filtered().length} results
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
                class="p-3 text-left cursor-pointer hover:text-blue-900 whitespace-nowrap"
                onClick={() => toggleSort("email")}
              >
                User {sortIcon("email")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-900 whitespace-nowrap"
                onClick={() => toggleSort("client_nomen_name")}
              >
                Client Nomen {sortIcon("client_nomen_name")}
              </th>
              <Show when={!isCampaignManager()}>
                <th class="p-3 text-left whitespace-nowrap">
                  Campaign Manager
                </th>
              </Show>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-900 whitespace-nowrap"
                onClick={() => toggleSort("organization_name")}
              >
                Organisation {sortIcon("organization_name")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-blue-900 whitespace-nowrap"
                onClick={() => toggleSort("client_type")}
              >
                Client Type {sortIcon("client_type")}
              </th>
              <th class="p-3 text-center whitespace-nowrap">Is Active</th>
              <th
                class="p-3 text-left cursor-pointer hover:text-blue-900 whitespace-nowrap"
                onClick={() => toggleSort("created_at")}
              >
                Created At {sortIcon("created_at")}
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
                        <Avatar name={client.email} />
                        <span class="text-purple-700 dark:text-gray-300 group-hover:underline font-medium">
                          {client.email}
                        </span>
                      </div>
                    </td>

                    {/* client_nomen_name */}
                    <td class="p-3 text-gray-700 dark:text-gray-300 font-medium">
                      {client.client_nomen_name}
                    </td>

                    {/* Assigned campaign manager */}
                    <Show when={!isCampaignManager()}>
                      <td class="p-3" onClick={(e) => e.stopPropagation()}>
                        <Show
                          when={cmReady()}
                          fallback={
                            <span class="text-gray-300 dark:text-gray-600">—</span>
                          }
                        >
                          <Show
                            when={cmForClient(client)}
                            fallback={
                              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300">
                                Not assigned
                              </span>
                            }
                          >
                            <div class="flex items-center gap-2">
                              <Avatar name={cmForClient(client).email} size="w-7 h-7" />
                              <span
                                class="text-gray-700 dark:text-gray-300 font-medium truncate max-w-[160px]"
                                title={cmForClient(client).email}
                              >
                                {cmForClient(client).name}
                              </span>
                            </div>
                          </Show>
                        </Show>
                      </td>
                    </Show>

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
                  </tr>
                )}
              </For>

              {/* Empty state */}
              <Show when={filtered().length === 0}>
                <tr>
                  <td
                    colspan={isCampaignManager() ? 7 : 8}
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
                colspan={isCampaignManager() ? 7 : 8}
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
