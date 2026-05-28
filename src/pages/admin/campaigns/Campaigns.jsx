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
  active:    "bg-green-100 text-green-700 ring-1 ring-green-300",
  paused:    "bg-amber-100 text-amber-700 ring-1 ring-amber-300",
  completed: "bg-gray-100  text-gray-600  ring-1 ring-gray-300",
};

// Date range helpers
const toYMD  = (d) => d.toISOString().slice(0, 10);
const today  = () => toYMD(new Date());
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return toYMD(d); };

const dateInRange = (dateStr, key) => {
  if (!dateStr || key === "all") return true;
  const d = dateStr.slice(0, 10);
  if (key === "today")     return d === today();
  if (key === "yesterday") return d === daysAgo(1);
  if (key === "last3")     return d >= daysAgo(2) && d <= today();
  if (key === "last7")     return d >= daysAgo(6) && d <= today();
  return true;
};

const DATE_OPTIONS = [
  { label: "Today",       value: "today"     },
  { label: "Yesterday",   value: "yesterday" },
  { label: "Last 3 Days", value: "last3"     },
  { label: "Last 7 Days", value: "last7"     },
];

const PAGE_SIZE = 20;

// ─── Searchable Select ────────────────────────────────────────────────────────
function SearchableSelect(props) {
  const [open,  setOpen]  = createSignal(false);
  const [query, setQuery] = createSignal("");

  const visible = createMemo(() => {
    const q = query().toLowerCase();
    return props.options.filter((o) => o.toLowerCase().includes(q));
  });

  const close = () => { setOpen(false); setQuery(""); };

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
        <span class="truncate">
          {props.value === "all" ? props.placeholder : props.value}
        </span>
        <svg class={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open() ? "rotate-180" : ""}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <Show when={open()}>
        <div class="fixed inset-0 z-10" onClick={close} />
        <div class="absolute z-20 mt-1 w-full min-w-[220px] bg-white dark:bg-gray-800
                    rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl overflow-hidden">
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
              onClick={() => { props.onChange("all"); close(); }}
              class={`px-3 py-2 text-sm cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20
                      ${props.value === "all" ? "text-purple-600 font-semibold bg-purple-50 dark:bg-purple-900/20" : "text-gray-700 dark:text-gray-300"}`}
            >
              {props.placeholder}
            </li>
            <For each={visible()}>
              {(opt) => (
                <li
                  onClick={() => { props.onChange(opt); close(); }}
                  class={`px-3 py-2 text-sm cursor-pointer hover:bg-purple-50 dark:hover:bg-purple-900/20
                          ${props.value === opt ? "text-purple-600 font-semibold bg-purple-50 dark:bg-purple-900/20" : "text-gray-700 dark:text-gray-300"}`}
                >
                  {opt}
                </li>
              )}
            </For>
            <Show when={visible().length === 0}>
              <li class="px-3 py-4 text-sm text-center text-gray-400">No results</li>
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
  const [loading,   setLoading]   = createSignal(true);
  const [error,     setError]     = createSignal(null);

  // Filters
  const [search,            setSearch]            = createSignal("");
  const [statusFilter,      setStatusFilter]      = createSignal("all");
  const [startDateFilter,   setStartDateFilter]   = createSignal("all");
  const [stopDateFilter,    setStopDateFilter]    = createSignal("all");
  const [adAccountFilter,   setAdAccountFilter]   = createSignal("all");
  const [clientNomenFilter, setClientNomenFilter] = createSignal("all");

  // Sort
  const [sortKey, setSortKey] = createSignal("id");
  const [sortDir, setSortDir] = createSignal("desc");

  // Pagination
  const [page, setPage] = createSignal(1);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  onMount(async () => {
    try {
      const res = await fetchCampaigns();
      const raw = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.results)
        ? res.data.results
        : [];
      setCampaigns(raw);
    } catch (err) {
      console.error("Failed to load campaigns:", err);
      setError("Failed to load campaigns. Please try again.");
    } finally {
      setLoading(false);
    }
  });

  // ── Dynamic dropdown options from API data ────────────────────────────────
  const adAccountOptions   = createMemo(() =>
    [...new Set(campaigns().map((c) => c.ad_account_name).filter(Boolean))].sort()
  );
  const clientNomenOptions = createMemo(() =>
    [...new Set(campaigns().map((c) => c.client_nomen_name).filter(Boolean))].sort()
  );

  // ── Sort ──────────────────────────────────────────────────────────────────
  const toggleSort = (key) => {
    if (sortKey() === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };
  const sortIcon = (key) => {
    if (sortKey() !== key) return <span class="text-gray-300 ml-1">⇅</span>;
    return <span class="ml-1 text-purple-600">{sortDir() === "asc" ? "↑" : "↓"}</span>;
  };

  // Reset to page 1 on any filter change
  const applyFilter = (setter, value) => { setter(value); setPage(1); };

  // ── Filter + Sort ─────────────────────────────────────────────────────────
  const filtered = createMemo(() => {
    let data = [...campaigns()];

    const q = search().trim().toLowerCase();
    if (q) {
      data = data.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.project_name?.toLowerCase().includes(q) ||
          c.client_nomen_name?.toLowerCase().includes(q)
      );
    }

    if (statusFilter() !== "all")
      data = data.filter((c) => c.status === statusFilter());

    if (startDateFilter() !== "all")
      data = data.filter((c) => dateInRange(c.start_date, startDateFilter()));

    if (stopDateFilter() !== "all")
      data = data.filter((c) => dateInRange(c.stop_date, stopDateFilter()));

    if (adAccountFilter() !== "all")
      data = data.filter((c) => c.ad_account_name === adAccountFilter());

    if (clientNomenFilter() !== "all")
      data = data.filter((c) => c.client_nomen_name === clientNomenFilter());

    data.sort((a, b) => {
      let va = a[sortKey()];
      let vb = b[sortKey()];

      if (sortKey() === "id" || sortKey() === "leads_count") {
        va = Number(va ?? 0); vb = Number(vb ?? 0);
      } else if (["cpl", "spend", "premium_cpl", "premium_spend"].includes(sortKey())) {
        // premium fields live inside premium_metrics
        if (sortKey() === "premium_cpl")   { va = parseFloat(a.premium_metrics?.cpl   ?? 0); vb = parseFloat(b.premium_metrics?.cpl   ?? 0); }
        if (sortKey() === "premium_spend") { va = parseFloat(a.premium_metrics?.spend ?? 0); vb = parseFloat(b.premium_metrics?.spend ?? 0); }
        if (sortKey() === "cpl")           { va = parseFloat(va ?? 0); vb = parseFloat(vb ?? 0); }
        if (sortKey() === "spend")         { va = parseFloat(va ?? 0); vb = parseFloat(vb ?? 0); }
      } else if (["start_date", "stop_date"].includes(sortKey())) {
        va = new Date(va ?? 0); vb = new Date(vb ?? 0);
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

  const paginated  = createMemo(() => filtered().slice((page() - 1) * PAGE_SIZE, page() * PAGE_SIZE));
  const totalPages = createMemo(() => Math.max(1, Math.ceil(filtered().length / PAGE_SIZE)));

  const activeFilterCount = createMemo(() =>
    [search(), statusFilter(), startDateFilter(), stopDateFilter(), adAccountFilter(), clientNomenFilter()]
      .filter((v) => v && v !== "all").length
  );

  const clearAllFilters = () => {
    setSearch(""); setStatusFilter("all"); setStartDateFilter("all");
    setStopDateFilter("all"); setAdAccountFilter("all"); setClientNomenFilter("all");
    setPage(1);
  };

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
            {campaigns().length} total · {filtered().length} matching filters
          </p>
        </div>
        <Show when={activeFilterCount() > 0}>
          <button
            onClick={clearAllFilters}
            class="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg
                   border border-red-200 text-red-600 hover:bg-red-50 transition-colors"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
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
          <svg class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by name, project or client…"
            value={search()}
            onInput={(e) => applyFilter(setSearch, e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white
                   focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </div>

        {/* Status */}
        <select
          value={statusFilter()}
          onChange={(e) => applyFilter(setStatusFilter, e.target.value)}
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
          onChange={(e) => applyFilter(setStartDateFilter, e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
        >
          <option value="all">All Start Dates</option>
          <For each={DATE_OPTIONS}>{(o) => <option value={o.value}>{o.label}</option>}</For>
        </select>

        {/* Stop Date */}
        <select
          value={stopDateFilter()}
          onChange={(e) => applyFilter(setStopDateFilter, e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300
                 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
        >
          <option value="all">All Stop Dates</option>
          <For each={DATE_OPTIONS}>{(o) => <option value={o.value}>{o.label}</option>}</For>
        </select>

        {/* Ad Account — searchable */}
        <SearchableSelect
          placeholder="All Ad Accounts"
          value={adAccountFilter()}
          options={adAccountOptions()}
          onChange={(v) => applyFilter(setAdAccountFilter, v)}
        />

        {/* Client Nomen — searchable */}
        <SearchableSelect
          placeholder="All Client Nomens"
          value={clientNomenFilter()}
          options={clientNomenOptions()}
          onChange={(v) => applyFilter(setClientNomenFilter, v)}
        />

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {filtered().length} result{filtered().length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Error */}
      <Show when={error()}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800
                    rounded-xl p-4 mb-4 text-sm text-red-600 dark:text-red-400 flex items-center gap-2">
          <svg class="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
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
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50
                       dark:bg-gray-800/60 text-gray-500 dark:text-gray-400
                       uppercase text-xs tracking-wider">
              <th class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("id")}>
                ID {sortIcon("id")}
              </th>
              <th class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap min-w-[200px]"
                onClick={() => toggleSort("name")}>
                Campaign Name {sortIcon("name")}
              </th>
              <th class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("client_nomen_name")}>
                Client Nomen {sortIcon("client_nomen_name")}
              </th>
              <th class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("project_name")}>
                Project {sortIcon("project_name")}
              </th>
              <th class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("ad_account_name")}>
                Ad Account {sortIcon("ad_account_name")}
              </th>
              <th class="p-3 text-center cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("status")}>
                Status {sortIcon("status")}
              </th>
              <th class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("start_date")}>
                Start Date {sortIcon("start_date")}
              </th>
              <th class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("stop_date")}>
                Stop Date {sortIcon("stop_date")}
              </th>
              <th class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("cpl")}>
                CPL {sortIcon("cpl")}
              </th>
              <th class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap text-purple-600"
                onClick={() => toggleSort("premium_cpl")}>
                Premium CPL {sortIcon("premium_cpl")}
              </th>
              <th class="p-3 text-center whitespace-nowrap text-purple-600">
                Rule
              </th>
              <th class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("spend")}>
                Spend {sortIcon("spend")}
              </th>
              <th class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap text-purple-600"
                onClick={() => toggleSort("premium_spend")}>
                Premium Spend {sortIcon("premium_spend")}
              </th>
              <th class="p-3 text-right cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("leads_count")}>
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
                      {Array(14).fill(0).map((_, idx) => (
                        <td class="p-3">
                          <div class={`h-3 bg-gray-200 dark:bg-gray-700 rounded
                                       ${idx === 1 ? "w-48" : idx === 5 ? "w-16" : "w-20"}`} />
                        </td>
                      ))}
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={paginated()}>
                {(c, i) => {
                  // Shortcut to premium_metrics for cleaner JSX below
                  const pm = c.premium_metrics;

                  return (
                    <tr class={`border-b border-gray-100 dark:border-gray-800
                                 hover:bg-purple-50/60 dark:hover:bg-purple-900/10 transition-colors
                                 ${i() % 2 === 0
                                   ? "bg-white dark:bg-gray-900"
                                   : "bg-gray-50/60 dark:bg-gray-800/30"}`}>

                      {/* 1. ID — data.id */}
                      <td class="p-3 text-gray-400 dark:text-gray-500 font-mono text-xs">
                        {c.id}
                      </td>

                      {/* 2. Campaign Name — data.name */}
                      <td class="p-3 max-w-[220px]">
                        <span class="text-gray-800 dark:text-gray-200 font-medium line-clamp-2 leading-snug"
                          title={c.name}>
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
                        <span class={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full
                                      text-xs font-semibold
                                      ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                          <span class={`w-1.5 h-1.5 rounded-full inline-block
                                        ${c.status === "active"  ? "bg-green-500"
                                        : c.status === "paused" ? "bg-amber-500"
                                        : "bg-gray-400"}`} />
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
                          <span class="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold
                                       bg-purple-100 text-purple-700 ring-1 ring-purple-300">
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
              <Show when={filtered().length === 0}>
                <tr>
                  <td colspan="14" class="py-16 text-center text-gray-400 dark:text-gray-500">
                    <svg class="w-10 h-10 mx-auto mb-3 opacity-30"
                      fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
                    </svg>
                    No campaigns match your filters
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>

          <tfoot>
            <tr class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <td colspan="14" class="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                {filtered().length} campaign{filtered().length !== 1 ? "s" : ""}
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
            : `Showing ${(page() - 1) * PAGE_SIZE + 1}–${Math.min(page() * PAGE_SIZE, filtered().length)} of ${filtered().length} campaigns`}
        </span>
        <div class="flex items-center gap-2">
          <button
            onClick={() => setPage((p) => p - 1)}
            disabled={page() <= 1 || loading()}
            class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg border
                   border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900
                   text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800
                   disabled:opacity-35 disabled:cursor-default transition-colors"
          >
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.8">
              <path d="M10 12L6 8l4-4" />
            </svg>
            Prev
          </button>
          <span class="text-sm text-gray-500 dark:text-gray-400 px-1">
            Page {page()} of {totalPages()}
          </span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page() >= totalPages() || loading()}
            class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg
                   bg-purple-600 border border-purple-600 text-white
                   hover:bg-purple-700 disabled:opacity-35 disabled:cursor-default transition-colors"
          >
            Next
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16" stroke="currentColor" stroke-width="1.8">
              <path d="M6 4l4 4-4 4" />
            </svg>
          </button>
        </div>
      </div>

    </div>
  );
}