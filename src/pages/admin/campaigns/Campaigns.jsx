import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { fetchCampaigns } from "../services/campaigns";

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

// Status badge styles
const STATUS_COLORS = {
  active: "bg-green-100 text-green-700 ring-1 ring-green-300",
  paused: "bg-amber-100 text-amber-700 ring-1 ring-amber-300",
  completed: "bg-gray-100  text-gray-600  ring-1 ring-gray-300",
};

// Date range helpers
const toYMD = (d) => d.toISOString().slice(0, 10);
const today = () => toYMD(new Date());
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toYMD(d);
};

const dateInRange = (dateStr, key) => {
  if (!dateStr || key === "all") return true;
  const d = dateStr.slice(0, 10);
  if (key === "today") return d === today();
  if (key === "yesterday") return d === daysAgo(1);
  if (key === "last3") return d >= daysAgo(2) && d <= today();
  if (key === "last7") return d >= daysAgo(6) && d <= today();
  return true;
};

const DATE_OPTIONS = [
  { label: "Today", value: "today" },
  { label: "Yesterday", value: "yesterday" },
  { label: "Last 3 Days", value: "last3" },
  { label: "Last 7 Days", value: "last7" },
];

const PAGE_SIZE = 20;

function SearchableSelect(props) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");

  // options are now { id, name } objects
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
    const found = props.options.find((o) => o.id === props.value);
    return found?.name ?? null;
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
  const [campaigns, setCampaigns] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);

  // Filters
  const [search, setSearch] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("all");
  const [startDateFilter, setStartDateFilter] = createSignal("all");
  const [stopDateFilter, setStopDateFilter] = createSignal("all");
  const [adAccountFilter, setAdAccountFilter] = createSignal("all");
  const [clientNomenFilter, setClientNomenFilter] = createSignal("all");
  const [allAdAccountOptions, setAllAdAccountOptions] = createSignal([]);
  const [allClientNomenOptions, setAllClientNomenOptions] = createSignal([]);

  // Sort
  const [sortKey, setSortKey] = createSignal("id");
  const [sortDir, setSortDir] = createSignal("desc");

  // Pagination
  const [page, setPage] = createSignal(1);
  const [totalPages, setTotalPages] = createSignal(1);
  const [total, setTotal] = createSignal(0);

  const loadCampaigns = async (pageNum = 1, overrides = {}) => {
    try {
      setLoading(true);
      setError(null);

      const res = await fetchCampaigns({
        page: pageNum,
        search: overrides.search ?? search(),
        status: overrides.status ?? statusFilter(),
        startDate: overrides.startDate ?? startDateFilter(),
        stopDate: overrides.stopDate ?? stopDateFilter(),
        adAccountId: overrides.adAccountId ?? adAccountFilter(), // sends ID
        clientNomenId: overrides.clientNomenId ?? clientNomenFilter(), // sends ID
      });

      const raw =
        res.data?.results ?? (Array.isArray(res.data) ? res.data : []);
      const pagination = res.data?.meta?.pagination ?? res.meta?.pagination;

      setCampaigns(raw);
      setPage(pageNum);
      setTotalPages(pagination?.total_pages ?? 1);
      setTotal(pagination?.total ?? raw.length);
    } catch (err) {
      console.error(err);
      setError("Failed to load campaigns. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Add this function
  const loadFilterOptions = async () => {
    try {
      const adSeen = new Map();
      const clientSeen = new Map();

      const first = await fetchCampaigns({ page: 1 });

      // ← Fix: handle both response shapes
      const firstRaw =
        first.data?.results ?? (Array.isArray(first.data) ? first.data : []);
      const totalPages =
        first.data?.meta?.pagination?.total_pages ??
        first.meta?.pagination?.total_pages ??
        1;

      console.log("totalPages =", totalPages, "firstRaw =", firstRaw.length);

      firstRaw.forEach((c) => {
        if (c.ad_account_id && c.ad_account_name)
          adSeen.set(c.ad_account_id, c.ad_account_name);
        if (c.client_nomen && c.client_nomen_name)
          clientSeen.set(c.client_nomen, c.client_nomen_name);
      });

      for (let p = 2; p <= totalPages; p += 10) {
        const batch = [];
        for (let b = p; b < p + 10 && b <= totalPages; b++) {
          batch.push(fetchCampaigns({ page: b }));
        }
        const results = await Promise.all(batch);
        results.forEach((r) => {
          const raw = r.data?.results ?? (Array.isArray(r.data) ? r.data : []);
          raw.forEach((c) => {
            if (c.ad_account_id && c.ad_account_name)
              adSeen.set(c.ad_account_id, c.ad_account_name);
            if (c.client_nomen && c.client_nomen_name)
              clientSeen.set(c.client_nomen, c.client_nomen_name);
          });
        });
      }

      console.log("adSeen:", adSeen.size, "clientSeen:", clientSeen.size);

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
    } catch (err) {
      console.error("Failed to load filter options:", err);
    }
  };

  onMount(() => {
    loadCampaigns(1);
    loadFilterOptions();
  });

  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setStartDateFilter("all");
    setStopDateFilter("all");
    setAdAccountFilter("all");
    setClientNomenFilter("all");
    loadCampaigns(1, {
      search: "",
      status: "all",
      startDate: "all",
      stopDate: "all",
      adAccountId: "all", // ← was "adAccount"
      clientNomenId: "all", // ← was "clientNomen"
    });
  };

  // ── Dynamic dropdown options from API data ────────────────────────────────
  const adAccountOptions = createMemo(() => {
    const seen = new Map();
    campaigns().forEach((c) => {
      if (c.ad_account_id && c.ad_account_name) {
        seen.set(c.ad_account_id, c.ad_account_name);
      }
    });
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  const clientNomenOptions = createMemo(() => {
    const seen = new Map();
    campaigns().forEach((c) => {
      if (c.client_nomen && c.client_nomen_name) {
        seen.set(c.client_nomen, c.client_nomen_name);
      }
    });
    return [...seen.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  // ── Sort ──────────────────────────────────────────────────────────────────
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

  // Reset to page 1 on any filter change
  const applyFilter = (setter, value, filterKey) => {
    setter(value);
    loadCampaigns(1, { [filterKey]: value });
  };

  const activeFilterCount = createMemo(
    () =>
      [
        search(),
        statusFilter(),
        startDateFilter(),
        stopDateFilter(),
        adAccountFilter(),
        clientNomenFilter(),
      ].filter((v) => v && v !== "all").length,
  );

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 lg:p-8">
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

        {/* Start Date */}
        <select
          value={startDateFilter()}
          onChange={(e) =>
            applyFilter(setStartDateFilter, e.target.value, "startDate")
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

        {/* Stop Date */}
        <select
          value={stopDateFilter()}
          onChange={(e) =>
            applyFilter(setStopDateFilter, e.target.value, "stopDate")
          }
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
        >
          <option value="all">All Stop Dates</option>
          <For each={DATE_OPTIONS}>
            {(o) => <option value={o.value}>{o.label}</option>}
          </For>
        </select>

        {/* Ad Account */}
        <SearchableSelect
          placeholder="All Ad Accounts"
          value={adAccountFilter()}
          options={allAdAccountOptions()} // ← use full list
          onChange={(v) => applyFilter(setAdAccountFilter, v, "adAccountId")}
        />

        {/* Client Nomen */}
        <SearchableSelect
          placeholder="All Client Nomens"
          value={clientNomenFilter()}
          options={allClientNomenOptions()} // ← use full list
          onChange={(v) =>
            applyFilter(setClientNomenFilter, v, "clientNomenId")
          }
        />

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {total()} result{campaigns().length !== 1 ? "s" : ""}
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
          {/*
            Column → API field mapping:
            1.  id                          → data.id
            2.  name                        → data.name
            3.  client_nomen_name           → data.client_nomen_name
            4.  project_name               → data.project_name
            5.  ad_account_name            → data.ad_account_name
            6.  status                     → data.status + data.status_label
            7.  start_date                 → data.start_date
            8.  stop_date                  → data.stop_date
            9.  cpl                        → data.cpl
            10. premium_cpl               → data.premium_metrics.cpl
            11. rule                       → data.premium_metrics.markup_rule.label  (e.g. "+22.00%")
            12. spend                      → data.spend
            13. premium_spend             → data.premium_metrics.spend
            14. leads_count               → data.leads_count
          */}
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
                      {Array(14)
                        .fill(0)
                        .map((_, idx) => (
                          <td class="p-3">
                            <div
                              class={`h-3 bg-gray-200 dark:bg-gray-700 rounded
                                       ${idx === 1 ? "w-48" : idx === 5 ? "w-16" : "w-20"}`}
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
              <For each={campaigns()}>
                {(c, i) => {
                  // Shortcut to premium_metrics for cleaner JSX below
                  const pm = c.premium_metrics;

                  return (
                    <tr
                      class={`border-b border-gray-100 dark:border-gray-800
                                   transition-colors
                                 ${
                                   i() % 2 === 0
                                     ? "bg-white dark:bg-gray-900"
                                     : "bg-gray-50/60 dark:bg-gray-800/30"
                                 }`}
                    >
                      {/* 1. ID — data.id */}
                      <td class="p-3 text-gray-600 dark:text-gray-300 font-medium text-sm whitespace-nowrap">
                        {c.id}
                      </td>

                      {/* 2. Campaign Name — data.name */}
                      <td class="p-3 max-w-[220px]">
                        <span
                          class="text-gray-700 dark:text-gray-300 font-medium line-clamp-2 "
                          title={c.name}
                        >
                          {c.name}
                        </span>
                      </td>

                      {/* 3. Client Nomen — data.client_nomen_name */}
                      <td class="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {c.client_nomen_name ?? "—"}
                      </td>

                      {/* 4. Project — data.project_name */}
                      <td class="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {c.project_name ?? "—"}
                      </td>

                      {/* 5. Ad Account — data.ad_account_name */}
                      <td class="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                        {c.ad_account_name ?? "—"}
                      </td>

                      {/* 6. Status — data.status + data.status_label */}
                      <td class="p-3 text-center">
                        <span
                          class={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                                      text-xs font-semibold
                                      ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-600"}`}
                        >
                          <span
                            class={`w-1.5 h-1.5 rounded-full inline-block
                                        ${
                                          c.status === "active"
                                            ? "bg-green-500"
                                            : c.status === "paused"
                                              ? "bg-amber-500"
                                              : "bg-gray-400"
                                        }`}
                          />
                          {c.status_label ?? c.status}
                        </span>
                      </td>

                      {/* 7. Start Date — data.start_date */}
                      <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatDate(c.start_date)}
                      </td>

                      {/* 8. Stop Date — data.stop_date */}
                      <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                        {formatDate(c.stop_date)}
                      </td>

                      {/* 9. CPL — data.cpl */}
                      <td class="p-3 text-right text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
                        {formatCPL(c.cpl)}
                      </td>

                      {/* 10. Premium CPL — data.premium_metrics.cpl */}
                      <td class="p-3 text-right font-medium whitespace-nowrap">
                        <span class="text-purple-600 dark:text-purple-400">
                          {formatCPL(pm?.cpl)}
                        </span>
                      </td>

                      {/* 11. Rule — data.premium_metrics.markup_rule.label (e.g. "+22.00%") */}
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

                      {/* 12. Spend — data.spend */}
                      <td class="p-3 text-right text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
                        {formatCPL(c.spend)}
                      </td>

                      {/* 13. Premium Spend — data.premium_metrics.spend */}
                      <td class="p-3 text-right font-medium whitespace-nowrap">
                        <span class="text-purple-600 dark:text-purple-400">
                          {formatCPL(pm?.spend)}
                        </span>
                      </td>

                      {/* 14. Leads — data.leads_count */}
                      <td class="p-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        {c.leads_count ?? 0}
                      </td>
                    </tr>
                  );
                }}
              </For>

              {/* Empty State */}
              <Show when={campaigns().length === 0}>
                <tr>
                  <td
                    colspan="14"
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
                colspan="14"
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
            : `Showing ${(page() - 1) * PAGE_SIZE + 1}–
            ${Math.min(page() * PAGE_SIZE, total())}
            of ${total()} campaigns`}
        </span>
        <div class="flex items-center gap-2">
          <button
            onClick={() => {
              const newPage = page() - 1;
              setPage(newPage);
              loadCampaigns(newPage);
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
              const newPage = page() + 1;
              setPage(newPage);
              loadCampaigns(newPage);
            }}
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
