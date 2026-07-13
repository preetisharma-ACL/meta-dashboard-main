import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { fetchCampaigns, resolveDateRange } from "../services/campaigns";
import Avatar from "../../../components/common/Avatar";
import CampaignStatusControl from "../../../components/CampaignStatusControl";
import { canWriteCampaigns } from "../../../stores/currentUser";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

const formatCPL = (val) => {
  if (val == null || val === "") return "—";
  return `₹${parseFloat(val).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
};

const STATUS_COLORS = {
  active: "bg-green-100 text-green-700 ring-1 ring-green-300",
  paused: "bg-amber-100 text-amber-700 ring-1 ring-amber-300",
  completed: "bg-gray-100  text-gray-600  ring-1 ring-gray-300",
};

// Preset options shown in the Start Date dropdown
const DATE_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 3 Days", value: "last3days" },
  { label: "Last 7 Days", value: "last7days" },
  { label: "Last Month", value: "lastMonth" },
];

const PAGE_SIZE = 20;

// ─── SearchableSelect ─────────────────────────────────────────────────────────
function SearchableSelect(props) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");

  const visible = createMemo(() => {
    const q = query().toLowerCase();
    return props.options.filter((o) => o.name.toLowerCase().includes(q));
  });

  const close = () => {
    setOpen(false);
    setQuery("");
  };

  const selectedName = createMemo(() => {
    if (props.value === "all") return null;
    return props.options.find((o) => o.id === props.value)?.name ?? null;
  });

  return (
    <div class="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        class="flex items-center justify-between gap-2 px-3 py-2 text-sm rounded-lg
               border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800
               text-gray-700 dark:text-gray-300 min-w-[180px]
               focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
      >
        <span class="truncate">{selectedName() ?? props.placeholder}</span>
        <svg
          class={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open() ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <Show when={open()}>
        <div class="fixed inset-0 z-10" onClick={close} />
        <div
          class="absolute z-20 mt-1 w-full min-w-[220px] bg-white dark:bg-gray-800
                    rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl overflow-hidden"
        >
          <div class="p-2 border-b border-gray-100 dark:border-gray-700">
            <input
              type="text"
              placeholder="Search…"
              value={query()}
              onInput={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              class="w-full px-3 py-1.5 text-sm rounded-lg border border-gray-200
                     dark:border-gray-700 dark:bg-gray-900 dark:text-white
                     focus:outline-none focus:ring-2 focus:ring-purple-400"
            />
          </div>
          <ul class="max-h-52 overflow-y-auto">
            <li
              onClick={() => {
                props.onChange("all");
                close();
              }}
              class={`px-3 py-2 text-sm cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20
                      ${props.value === "all" ? "text-purple-600 font-semibold bg-purple-50 dark:bg-purple-900/20" : "text-gray-700 dark:text-gray-300"}`}
            >
              {props.placeholder}
            </li>
            <For each={visible()}>
              {(opt) => (
                <li
                  onClick={() => {
                    props.onChange(opt.id);
                    close();
                  }}
                  class={`px-3 py-2 text-sm cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20
                          ${props.value === opt.id ? "text-purple-600 font-semibold bg-purple-50 dark:bg-purple-900/20" : "text-gray-700 dark:text-gray-300"}`}
                >
                  {opt.name}
                </li>
              )}
            </For>
            <Show when={visible().length === 0}>
              <li class="px-3 py-4 text-sm text-center text-gray-400">
                No results
              </li>
            </Show>
          </ul>
        </div>
      </Show>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Campaigns() {
  const [allCampaigns, setAllCampaigns] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);

  // Filters
  const [search, setSearch] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("all");
  const [startDatePreset, setStartDatePreset] = createSignal("all"); // dropdown value
  const [adAccountFilter, setAdAccountFilter] = createSignal("all");
  const [clientNomenFilter, setClientNomenFilter] = createSignal("all");
  const [allAdAccountOptions, setAllAdAccountOptions] = createSignal([]);
  const [allClientNomenOptions, setAllClientNomenOptions] = createSignal([]);

  // Sort
  const [sortKey, setSortKey] = createSignal("id");
  const [sortDir, setSortDir] = createSignal("desc");

  // Pagination (client-side)
  const [page, setPage] = createSignal(1);

  // Pull the row array out of a response, tolerating both the flat envelope
  // ({ data: [...] }) and the older nested one ({ data: { results: [...] } }).
  // Guards against a null/undefined response (api() returns undefined on an
  // auth-refresh bail) so one bad page can't throw the whole load.
  const rawRows = (r) =>
    r?.data?.results ?? (Array.isArray(r?.data) ? r.data : []);

  // Rebuild the Ad-Account / Client-Nomen dropdown options from whatever rows
  // we have so far (called again as more pages stream in).
  const rebuildOptions = (rows) => {
    const adSeen = new Map();
    const clientSeen = new Map();
    rows.forEach((c) => {
      if (c.ad_account_id && c.ad_account_name)
        adSeen.set(c.ad_account_id, c.ad_account_name);
      if (c.client_nomen && c.client_nomen_name)
        clientSeen.set(c.client_nomen, c.client_nomen_name);
    });
    setAllAdAccountOptions(
      [...adSeen.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
    setAllClientNomenOptions(
      [...clientSeen.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  };

  // ── Render the FIRST page immediately, then stream the rest in the background.
  // The old version awaited a full sweep of every page (6,590 rows / 330 pages
  // at the default 20-per-page, since it never passed page_size) BEFORE clearing
  // the loading flag — so the table sat on skeleton rows and "0 results" for the
  // whole multi-minute sweep. We now show page 1 the moment it arrives and append
  // the remaining pages as they load. A large page_size (already used by the
  // Ad-Accounts sweep against this same endpoint) collapses the round-trips when
  // the backend honours it, and falls back safely to 20/page if it doesn't —
  // either way the UI is unblocked after the first request. Filtering/sorting/
  // pagination stay client-side (they work once the rows are in memory).
  const loadAll = async () => {
    try {
      setError(null);
      setLoading(true);

      const first = await fetchCampaigns({ page: 1, pageSize: 1000 });
      const firstRaw = rawRows(first);
      const srvTotalPages =
        first?.data?.meta?.pagination?.total_pages ??
        first?.meta?.pagination?.total_pages ??
        1;

      setAllCampaigns(firstRaw);
      rebuildOptions(firstRaw);
      setLoading(false); // unblock the UI as soon as the first page is in

      // Stream the remaining pages in the background — this does NOT gate render.
      for (let p = 2; p <= srvTotalPages; p += 10) {
        const batch = [];
        for (let b = p; b < p + 10 && b <= srvTotalPages; b++)
          batch.push(fetchCampaigns({ page: b, pageSize: 1000 }));
        const more = (await Promise.all(batch)).flatMap(rawRows);
        if (more.length) {
          setAllCampaigns((prev) => {
            const merged = prev.concat(more);
            rebuildOptions(merged);
            return merged;
          });
        }
      }
    } catch (err) {
      console.error(err);
      // Only surface a blocking error if we have nothing to show; a failure
      // part-way through the background stream shouldn't wipe rendered rows.
      if (allCampaigns().length === 0)
        setError("Failed to load campaigns. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    loadAll();
  });

  // Reflect a confirmed pause/resume on the row without a full refetch.
  const applyStatusChange = (id, newStatus) =>
    setAllCampaigns((rows) =>
      rows.map((c) =>
        c.id === id
          ? { ...c, status: newStatus, status_label: newStatus === "active" ? "Active" : "Paused" }
          : c,
      ),
    );

  // ── Filter helpers (client-side; just set the signal + reset to page 1) ────
  const applyFilter = (setter, value) => {
    setter(value);
    setPage(1);
  };

  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setStartDatePreset("all");
    setAdAccountFilter("all");
    setClientNomenFilter("all");
    setPage(1);
  };

  const activeFilterCount = createMemo(
    () =>
      [
        search(),
        statusFilter() !== "all" ? statusFilter() : "",
        startDatePreset() !== "all" ? startDatePreset() : "",
        adAccountFilter() !== "all" ? adAccountFilter() : "",
        clientNomenFilter() !== "all" ? clientNomenFilter() : "",
      ].filter(Boolean).length,
  );

  // ── Sort ──────────────────────────────────────────────────────────────────
  const toggleSort = (key) => {
    if (sortKey() === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(1);
  };
  const sortIcon = (key) => {
    if (sortKey() !== key) return <span class="text-gray-300 ml-1">⇅</span>;
    return (
      <span class="ml-1 text-purple-600">
        {sortDir() === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  // ── Derived: filter → sort → paginate (all client-side) ────────────────────
  const NUMERIC_KEYS = new Set([
    "id",
    "cpl",
    "spend",
    "leads_count",
    "premium_cpl",
    "premium_spend",
  ]);

  const sortValue = (c, key) => {
    switch (key) {
      case "premium_cpl":
        return parseFloat(c.premium_metrics?.cpl);
      case "premium_spend":
        return parseFloat(c.premium_metrics?.spend);
      case "id":
        return Number(c.id);
      case "cpl":
        return parseFloat(c.cpl);
      case "spend":
        return parseFloat(c.spend);
      case "leads_count":
        return Number(c.leads_count);
      default:
        return c[key];
    }
  };

  const filtered = createMemo(() => {
    const q = search().trim().toLowerCase();
    const status = statusFilter();
    const preset = startDatePreset();
    const { from, to } =
      preset && preset !== "all" ? resolveDateRange(preset) : { from: "", to: "" };
    const adId = adAccountFilter();
    const nomen = clientNomenFilter();

    let rows = allCampaigns().filter((c) => {
      if (q) {
        const hay = `${c.name ?? ""} ${c.project_name ?? ""} ${c.client_nomen_name ?? ""} ${c.ad_account_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (status && status !== "all" && c.status !== status) return false;
      if (from && to) {
        const sd = (c.start_date ?? "").slice(0, 10);
        if (!sd || sd < from || sd > to) return false;
      }
      if (adId && adId !== "all" && c.ad_account_id !== adId) return false;
      if (nomen && nomen !== "all" && c.client_nomen !== nomen) return false;
      return true;
    });

    const key = sortKey();
    const dir = sortDir() === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      let av = sortValue(a, key);
      let bv = sortValue(b, key);
      if (NUMERIC_KEYS.has(key)) {
        av = isFinite(av) ? av : -Infinity;
        bv = isFinite(bv) ? bv : -Infinity;
        return (av - bv) * dir;
      }
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });

    return rows;
  });

  const total = createMemo(() => filtered().length);
  const totalPages = createMemo(() => Math.max(1, Math.ceil(total() / PAGE_SIZE)));
  const campaigns = createMemo(() => {
    const p = Math.min(page(), totalPages());
    const start = (p - 1) * PAGE_SIZE;
    return filtered().slice(start, start + PAGE_SIZE);
  });

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-3 lg:p-8">
      {/* Page Header */}
      <div class="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
            Campaigns
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {total()} matching campaigns
          </p>
        </div>
        <Show when={activeFilterCount() > 0}>
          <button
            onClick={clearAllFilters}
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
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
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
            placeholder="Search by name, project or client…"
            value={search()}
            onInput={(e) => applyFilter(setSearch, e.target.value, "search")}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white
                   focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </div>

        {/* Status */}
        <select
          value={statusFilter()}
          onChange={(e) =>
            applyFilter(setStatusFilter, e.target.value, "status")
          }
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
        </select>

        {/* Start Date — preset dropdown, resolves to started_after/started_before */}
        <select
          value={startDatePreset()}
          onChange={(e) =>
            applyFilter(setStartDatePreset, e.target.value, "startDatePreset")
          }
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
        >
          <option value="all">All Start Dates</option>
          <For each={DATE_OPTIONS}>
            {(o) => <option value={o.value}>{o.label}</option>}
          </For>
        </select>

        {/* Ad Account */}
        <SearchableSelect
          placeholder="All Ad Accounts"
          value={adAccountFilter()}
          options={allAdAccountOptions()}
          onChange={(v) => applyFilter(setAdAccountFilter, v, "adAccountId")}
        />

        {/* Client Nomen */}
        <SearchableSelect
          placeholder="All Client Nomens"
          value={clientNomenFilter()}
          options={allClientNomenOptions()}
          onChange={(v) =>
            applyFilter(setClientNomenFilter, v, "clientNomenId")
          }
        />

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {total()} result{total() !== 1 ? "s" : ""}
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
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr
              class="border-b border-gray-200 dark:border-gray-700 bg-gray-50
                       dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider"
            >
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("id")}
              >
                ID {sortIcon("id")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap min-w-[200px]"
                onClick={() => toggleSort("name")}
              >
                Campaign Name {sortIcon("name")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("client_nomen_name")}
              >
                Client Nomen {sortIcon("client_nomen_name")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("project_name")}
              >
                Project {sortIcon("project_name")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("ad_account_name")}
              >
                Ad Account {sortIcon("ad_account_name")}
              </th>
              <th
                class="p-3 text-center cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("status")}
              >
                Status {sortIcon("status")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("start_date")}
              >
                Start Date {sortIcon("start_date")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("stop_date")}
              >
                Stop Date {sortIcon("stop_date")}
              </th>
              <th
                class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("cpl")}
              >
                CPL {sortIcon("cpl")}
              </th>
              <th
                class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap text-purple-600"
                onClick={() => toggleSort("premium_cpl")}
              >
                Premium CPL {sortIcon("premium_cpl")}
              </th>
              <th class="p-3 text-center whitespace-nowrap text-purple-600">
                Rule
              </th>
              <th
                class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("spend")}
              >
                Spend {sortIcon("spend")}
              </th>
              <th
                class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap text-purple-600"
                onClick={() => toggleSort("premium_spend")}
              >
                Premium Spend {sortIcon("premium_spend")}
              </th>
              <th
                class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("leads_count")}
              >
                Leads {sortIcon("leads_count")}
              </th>
              <Show when={canWriteCampaigns()}>
                <th
                  class="p-3 text-center whitespace-nowrap sticky right-0 z-20
                         bg-gray-50 dark:bg-gray-800
                         shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.18)]"
                >
                  Actions
                </th>
              </Show>
            </tr>
          </thead>

          <Show
            when={!loading()}
            fallback={
              <tbody>
                <For each={Array(8).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse bg-white dark:bg-gray-900">
                      {Array(canWriteCampaigns() ? 15 : 14)
                        .fill(0)
                        .map((_, idx, arr) => {
                          const isActions =
                            canWriteCampaigns() && idx === arr.length - 1;
                          return (
                            <td
                              class={`p-3 ${isActions ? "sticky right-0 z-10 bg-white dark:bg-gray-900 shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.18)]" : ""}`}
                            >
                              <div
                                class={`h-3 bg-gray-200 dark:bg-gray-700 rounded ${idx === 1 ? "w-48" : idx === 5 ? "w-16" : "w-20"} ${isActions ? "mx-auto" : ""}`}
                              />
                            </td>
                          );
                        })}
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={campaigns()}>
                {(c, i) => {
                  const pm = c.premium_metrics;
                  return (
                    <tr
                      class={`border-b border-gray-100 dark:border-gray-800 transition-colors
                                ${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/60 dark:bg-gray-800/30"}`}
                    >
                      <td class="p-3 text-purple-700 dark:text-gray-300 font-medium text-sm whitespace-nowrap">
                        {c.id}
                      </td>

                      <td class="p-3 max-w-[220px]">
                        <div class="flex items-center gap-4">
                          <div class="flex-shrink-0">
                            <Avatar name={c.name} />
                          </div>
                          <span
                            class="text-purple-700 dark:text-gray-300 font-medium line-clamp-2"
                            title={c.name}
                          >
                            {c.name}
                          </span>
                        </div>
                      </td>
                      <td class="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {c.client_nomen_name ?? "—"}
                      </td>
                      <td class="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {c.project_name ?? "—"}
                      </td>
                      <td class="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {c.ad_account_name ?? "—"}
                      </td>
                      <td class="p-3 text-center">
                        <span
                          class={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold
                                      ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          <span
                            class={`w-1.5 h-1.5 rounded-full inline-block
                                        ${c.status === "active" ? "bg-green-500" : c.status === "paused" ? "bg-amber-500" : "bg-gray-400"}`}
                          />
                          {c.status_label ?? c.status}
                        </span>
                      </td>
                      <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatDate(c.start_date)}
                      </td>
                      <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatDate(c.stop_date)}
                      </td>
                      <td class="p-3 text-right text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
                        {formatCPL(c.cpl)}
                      </td>
                      <td class="p-3 text-right font-medium whitespace-nowrap">
                        <span class="text-purple-600 dark:text-purple-400">
                          {formatCPL(pm?.cpl)}
                        </span>
                      </td>
                      <td class="p-3 text-center whitespace-nowrap">
                        <Show
                          when={pm?.markup_rule?.label}
                          fallback={<span class="text-gray-400">—</span>}
                        >
                          <span
                            class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold
                                       bg-purple-100 text-purple-700 ring-1 ring-purple-300"
                          >
                            {pm.markup_rule.label}
                          </span>
                        </Show>
                      </td>
                      <td class="p-3 text-right text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
                        {formatCPL(c.spend)}
                      </td>
                      <td class="p-3 text-right font-medium whitespace-nowrap">
                        <span class="text-purple-600 dark:text-purple-400">
                          {formatCPL(pm?.spend)}
                        </span>
                      </td>
                      <td class="p-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {c.leads_count ?? 0}
                      </td>
                      <Show when={canWriteCampaigns()}>
                        <td
                          class={`p-3 text-center whitespace-nowrap sticky right-0 z-10
                                  shadow-[-6px_0_8px_-6px_rgba(0,0,0,0.18)]
                                  ${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50 dark:bg-gray-800"}`}
                        >
                          <CampaignStatusControl
                            campaignId={c.id}
                            campaignName={c.name}
                            status={c.status}
                            size="sm"
                            onChanged={(s) => applyStatusChange(c.id, s)}
                          />
                        </td>
                      </Show>
                    </tr>
                  );
                }}
              </For>

              <Show when={campaigns().length === 0}>
                <tr>
                  <td
                    colspan={canWriteCampaigns() ? 15 : 14}
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
                        d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"
                      />
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="1.5"
                        d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"
                      />
                    </svg>
                    No campaigns match your filters
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>

          <tfoot>
            <tr class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <td
                colspan={canWriteCampaigns() ? 15 : 14}
                class="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400"
              >
                {campaigns().length} campaign
                {campaigns().length !== 1 ? "s" : ""}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Pagination */}
      <div class="flex items-center justify-between mt-5 flex-wrap gap-3">
        <span class="text-sm text-gray-500 dark:text-gray-400">
          {campaigns().length === 0
            ? "No results"
            : `Showing ${(page() - 1) * PAGE_SIZE + 1}–${Math.min(page() * PAGE_SIZE, total())} of ${total()} campaigns`}
        </span>
        <div class="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
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
            onClick={() => setPage((p) => Math.min(totalPages(), p + 1))}
            disabled={page() >= totalPages() || loading()}
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
