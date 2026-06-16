// ─────────────────────────────────────────────────────────────────────────────
// Coordination Team — Payments Overview Dashboard
//
// Single screen: for all clients in a chosen month, show opening / received /
// utilized / closing balances so the team can spot debtors and follow up.
//
// Built to match the existing Admin/Client dashboards:
//   • SolidJS signals + createMemo (same patterns as MainDashboard.jsx)
//   • v4 theme tokens: navy #14233A · crimson #AC2334 · line #E2E8F1
//     muted #54657E · faint #8593A8 · green #15966A/#E9F7F1
//     amber #B07A14/#FBF3E2 · steel #3E6FB0/#ECF2FA · thead/zebra #F8FAFC/#FAFBFD
//   • Same Tailwind font scale (no new fonts), same card/table/badge styling
//
// Data behaviour per the spec:
//   • On mount → fetch current month (cached, fast)
//   • Month change → refetch with ?month=
//   • Refresh button → refetch with &refresh=1 (spinner, ~6s)
//   • Status filter + search + GST toggle + sorting are all client-side
//     (every client arrives in one response)
// ─────────────────────────────────────────────────────────────────────────────
import {
  For,
  Show,
  createSignal,
  createMemo,
  createEffect,
  onMount,
} from "solid-js";
import { fetchPaymentsOverview } from "../services/coDashboard-service";
import Avatar from "../../../components/common/Avatar";

// Distinct badge colors per client type (v4 theme tokens)
const TYPE_BADGE = {
  retainer: "bg-[#ECF2FA] text-[#3E6FB0] dark:bg-gray-800 dark:text-blue-300", // steel
  hybrid: "bg-[#F3ECFB] text-[#7A3EB0] dark:bg-gray-800 dark:text-purple-300", // violet
  cpl: "bg-[#FBF3E2] text-[#B07A14] dark:bg-gray-800 dark:text-amber-300", // amber
};

export default function CoordinationDashboard() {
  // ── State ──────────────────────────────────────────────────────────────────
  const currentMonthStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  };

  const [month, setMonth] = createSignal(currentMonthStr());
  const [loading, setLoading] = createSignal(false);
  const [refreshing, setRefreshing] = createSignal(false);
  const [error, setError] = createSignal("");
  const [data, setData] = createSignal(null); // the `data` object from the API

  const [statusFilter, setStatusFilter] = createSignal("all"); // all|owes|low|healthy
  const [typeFilter, setTypeFilter] = createSignal("all"); // all|retainer|hybrid|cpl
  const [searchText, setSearchText] = createSignal("");
  const [incGst, setIncGst] = createSignal(true); // GST toggle, default Including
  const [sortKey, setSortKey] = createSignal("closing"); // default sort
  const [sortDir, setSortDir] = createSignal("asc"); // debtors first
  const [page, setPage] = createSignal(1);
  const PAGE_SIZE = 20;

  // ── Data loading ─────────────────────────────────────────────────────────────
  const load = async (refresh = false) => {
    try {
      setError("");
      if (refresh) setRefreshing(true);
      else setLoading(true);

      const res = await fetchPaymentsOverview(month(), refresh);

      if (res?.success && res?.data) {
        setData(res.data);
      } else {
        setData(res?.data ?? null);
        if (!res?.success) {
          setError(res?.message || "Could not load payments overview.");
        }
      }
    } catch (err) {
      console.error("Failed to load payments overview", err);
      setError("Something went wrong while loading payments overview.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  onMount(() => {
    // Fast path: no refresh param → server cache.
    load(false);
  });

  // Snap back to page 1 when the result set changes underneath us.
  createEffect(() => {
    statusFilter();
    typeFilter();
    searchText();
    month();
    setPage(1);
  });

  const handleMonthChange = (value) => {
    if (!value) return;
    // Never allow a future month (max attr guards the picker; this guards typing).
    if (value > currentMonthStr()) value = currentMonthStr();
    setMonth(value);
    load(false); // month change refetches with ?month=
  };

  const handleRefresh = () => {
    if (refreshing()) return;
    load(true); // &refresh=1, slow recompute
  };

  // ── Formatting helpers (display only) ─────────────────────────────────────────
  const toNum = (v) => parseFloat(v ?? 0) || 0;

  // Indian-grouped ₹ formatting. Negatives handled by the caller for colouring.
  const fmtINR = (v) => {
    const n = toNum(v);
    const abs = Math.abs(n).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return `${n < 0 ? "-" : ""}₹${abs}`;
  };

  const fmtINR0 = (v) => `₹${Math.round(toNum(v)).toLocaleString("en-IN")}`;

  const monthLabel = createMemo(() => {
    const m = data()?.month || month();
    const [y, mo] = m.split("-");
    if (!y || !mo) return m;
    const date = new Date(Number(y), Number(mo) - 1, 1);
    return date.toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
  });

  const totals = () => data()?.totals ?? {};

  // ── GST-aware field pickers ───────────────────────────────────────────────────
  const suffix = () => (incGst() ? "inc_gst" : "ex_gst");

  const rowField = (row, base) => row[`${base}_${suffix()}`];

  // ── Derived: filtered + sorted client rows (all client-side) ──────────────────
  const rows = () => data()?.clients ?? [];

  const filteredRows = createMemo(() => {
    let list = rows();

    if (statusFilter() !== "all") {
      list = list.filter((c) => c.status === statusFilter());
    }

    if (typeFilter() !== "all") {
      list = list.filter(
        (c) => (c.client_type || "").toLowerCase() === typeFilter(),
      );
    }

    const q = searchText().toLowerCase().trim();
    if (q) {
      list = list.filter((c) =>
        [c.client_nomen, c.client_email]
          .filter(Boolean)
          .some((f) => String(f).toLowerCase().includes(q)),
      );
    }

    // Sort client-side. Money keys resolve through the GST-aware picker so the
    // visible numbers and the sort always agree.
    const key = sortKey();
    const dir = sortDir() === "asc" ? 1 : -1;

    const valueOf = (c) => {
      switch (key) {
        case "client":
          return (c.client_nomen || c.client_email || "").toLowerCase();
        case "type":
          return (c.client_type || "").toLowerCase();
        case "status":
          return (c.status || "").toLowerCase();
        case "opening":
          return toNum(rowField(c, "opening_balance"));
        case "received":
          return toNum(rowField(c, "received"));
        case "utilized":
          return toNum(rowField(c, "utilized"));
        case "closing":
        default:
          return toNum(rowField(c, "closing_balance"));
      }
    };

    return [...list].sort((a, b) => {
      const av = valueOf(a);
      const bv = valueOf(b);
      if (typeof av === "string" || typeof bv === "string") {
        return String(av).localeCompare(String(bv)) * dir;
      }
      return (av - bv) * dir;
    });
  });

  const totalPages = createMemo(() =>
    Math.max(1, Math.ceil(filteredRows().length / PAGE_SIZE)),
  );

  const pagedRows = createMemo(() => {
    const start = (page() - 1) * PAGE_SIZE;
    return filteredRows().slice(start, start + PAGE_SIZE);
  });

  const handleSort = (key) => {
    if (sortKey() === key) {
      setSortDir(sortDir() === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      // Money columns most useful descending first; closing keeps asc (debtors).
      setSortDir(key === "closing" ? "asc" : "desc");
    }
  };

  const sortIcon = (key) => {
    if (sortKey() !== key) return "";
    return sortDir() === "asc" ? " ▲" : " ▼";
  };

  // ── Small presentational helpers ──────────────────────────────────────────────
  const StatusBadge = (props) => {
    const tone =
      props.status === "owes"
        ? "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300"
        : props.status === "low"
          ? "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300"
          : "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300";
    const dot =
      props.status === "owes"
        ? "bg-[#AC2334]"
        : props.status === "low"
          ? "bg-[#B07A14]"
          : "bg-[#15966A]";
    const label =
      props.status === "owes"
        ? "Owes"
        : props.status === "low"
          ? "Low"
          : "Healthy";
    return (
      <span
        class={
          "inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium uppercase tracking-wide rounded-full " +
          tone
        }
      >
        <span class={"w-1.5 h-1.5 rounded-full " + dot}></span>
        {label}
      </span>
    );
  };

  // Closing balance colour: negative → crimson, otherwise green.
  const closingClass = (row) =>
    toNum(rowField(row, "closing_balance")) < 0
      ? "text-[#AC2334] dark:text-gray-300 font-medium"
      : "text-[#15966A] dark:text-green-300 font-medium";

  const TableSkeleton = () => (
    <tbody>
      <For each={Array(8).fill(0)}>
        {() => (
          <tr class="border-t border-[#E2E8F1] dark:border-gray-700 animate-pulse">
            <td class="p-3">
              <div class="h-4 w-40 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </td>
            <td class="p-3">
              <div class="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded mx-auto"></div>
            </td>
            <For each={Array(4).fill(0)}>
              {() => (
                <td class="p-3">
                  <div class="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded ml-auto"></div>
                </td>
              )}
            </For>
            <td class="p-3">
              <div class="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto"></div>
            </td>
          </tr>
        )}
      </For>
    </tbody>
  );

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Coordination · Follow-ups
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Payments Overview
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400">
            Opening, received, utilized and closing balances for all clients in{" "}
            <span class="font-semibold text-[#14233A] dark:text-gray-200">
              {monthLabel()}
            </span>
            .
          </p>
        </div>

        <div class="flex items-center gap-3 flex-wrap">
          {/* Month picker */}
          <div class="relative">
            <input
              type="month"
              value={month()}
              max={currentMonthStr()}
              onInput={(e) => handleMonthChange(e.currentTarget.value)}
              class="border border-[#E2E8F1] dark:border-gray-600 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
            />
          </div>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={refreshing()}
            class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#1d3252] disabled:opacity-60 disabled:cursor-default transition-colors"
          >
            <svg
              class={"w-4 h-4 " + (refreshing() ? "animate-spin" : "")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                d="M4 4v5h5M20 20v-5h-5M5.5 9a7 7 0 0112.9-2M18.5 15a7 7 0 01-12.9 2"
              />
            </svg>
            {refreshing() ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Error banner */}
      <Show when={error()}>
        <div class="mb-6 rounded-xl border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300">
          {error()}
        </div>
      </Show>

      {/* ════════ SUMMARY CARDS ════════ */}
      <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-8">
        {/* Total Owed — headline */}
        <div class="relative overflow-hidden bg-white dark:bg-gray-900 px-5 py-6 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] xl:col-span-1 sm:col-span-2">
          <span class="absolute left-0 top-0 bottom-0 w-1 bg-[#AC2334]"></span>
          <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            Total Owed
          </p>
          <h3 class="text-3xl font-bold mt-2 text-[#AC2334] tracking-tight">
            {fmtINR0(totals().total_owed_inc_gst)}
          </h3>
          <p class="text-xs text-[#54657E] dark:text-gray-400 mt-1">
            across {totals().clients_owing ?? 0} clients · incl. GST
          </p>
        </div>

        {/* Clients Owing */}
        <div class="bg-white dark:bg-gray-900 px-5 py-6 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
          <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            Clients Owing
          </p>
          <h3 class="text-2xl font-bold mt-2 text-[#14233A] dark:text-white">
            {totals().clients_owing ?? 0}
          </h3>
          <span class="inline-flex mt-2 items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-full bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300">
            <span class="w-1.5 h-1.5 rounded-full bg-[#AC2334]"></span>
            Needs follow-up
          </span>
        </div>

        {/* Clients Low */}
        <div class="bg-white dark:bg-gray-900 px-5 py-6 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
          <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            Clients Low
          </p>
          <h3 class="text-2xl font-bold mt-2 text-[#14233A] dark:text-white">
            {totals().clients_low ?? 0}
          </h3>
          <span class="inline-flex mt-2 items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-full bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300">
            <span class="w-1.5 h-1.5 rounded-full bg-[#B07A14]"></span>
            Below 15%
          </span>
        </div>

        {/* Clients Healthy */}
        <div class="bg-white dark:bg-gray-900 px-5 py-6 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
          <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            Clients Healthy
          </p>
          <h3 class="text-2xl font-bold mt-2 text-[#14233A] dark:text-white">
            {totals().clients_healthy ?? 0}
          </h3>
          <span class="inline-flex mt-2 items-center gap-1.5 px-2.5 py-1 text-xs font-bold rounded-full bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300">
            <span class="w-1.5 h-1.5 rounded-full bg-[#15966A]"></span>
            In credit
          </span>
        </div>

        {/* Received + Utilized (optional, combined tile) */}
        <div class="bg-white dark:bg-gray-900 px-5 py-6 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
          <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
            Received · Utilized
          </p>
          <h3 class="text-lg font-extrabold mt-2 text-[#15966A] dark:text-green-300">
            {fmtINR0(
              incGst() ? totals().received_inc_gst : totals().received_ex_gst,
            )}
          </h3>
          <p class="text-sm font-bold text-[#54657E] dark:text-gray-300 mt-0.5">
            {fmtINR0(
              incGst() ? totals().utilized_inc_gst : totals().utilized_ex_gst,
            )}{" "}
            <span class="text-xs font-medium text-[#8593A8]">utilized</span>
          </p>
        </div>
      </div>

      {/* ════════ FILTER BAR ════════ */}
      <div class="flex flex-wrap items-center gap-3 mb-4">
        {/* Status filter dropdown */}
        <select
          value={statusFilter()}
          onChange={(e) => setStatusFilter(e.currentTarget.value)}
          class="border border-[#E2E8F1] dark:border-gray-600 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] cursor-pointer"
        >
          <option value="all">All</option>
          <option value="owes">Owes</option>
          <option value="low">Low</option>
          <option value="healthy">Healthy</option>
        </select>

        {/* Client type filter dropdown */}
        <select
          value={typeFilter()}
          onChange={(e) => setTypeFilter(e.currentTarget.value)}
          class="border border-[#E2E8F1] dark:border-gray-600 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] cursor-pointer"
        >
          <option value="all">Client Type</option>
          <option value="retainer">Retainer</option>
          <option value="hybrid">Hybrid</option>
          <option value="cpl">CPL</option>
        </select>

        {/* Search */}
        <input
          type="text"
          placeholder="Search client name or email..."
          value={searchText()}
          onInput={(e) => setSearchText(e.currentTarget.value)}
          class="border border-[#E2E8F1] dark:border-gray-600 px-3 py-2 rounded-lg w-72 max-w-full bg-white dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
        />

        {/* Clear all filters */}
        <Show
          when={
            statusFilter() !== "all" ||
            typeFilter() !== "all" ||
            searchText().trim() !== ""
          }
        >
          <button
            onClick={() => {
              setStatusFilter("all");
              setTypeFilter("all");
              setSearchText("");
            }}
            class="px-3 py-2 rounded-lg text-sm font-medium border border-[#E2E8F1] dark:border-gray-600 text-[#54657E] dark:text-gray-300 bg-white dark:bg-gray-800 hover:border-[#AC2334]/40 hover:text-[#AC2334] dark:hover:bg-gray-700 dark:hover:text-white transition-colors"
          >
            Clear all
          </button>
        </Show>

        {/* GST toggle */}
        <div class="ml-auto inline-flex items-center gap-1 bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-600 rounded-full p-1">
          <button
            onClick={() => setIncGst(true)}
            class={
              "px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors " +
              (incGst()
                ? "bg-[#14233A] text-white"
                : "text-[#54657E] dark:text-gray-300 hover:text-[#14233A]")
            }
          >
            Including GST
          </button>
          <button
            onClick={() => setIncGst(false)}
            class={
              "px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors " +
              (!incGst()
                ? "bg-[#14233A] text-white"
                : "text-[#54657E] dark:text-gray-300 hover:text-[#14233A]")
            }
          >
            Excluding GST
          </button>
        </div>
      </div>

      {/* ════════ MAIN TABLE ════════ */}
      <div class="overflow-x-auto bg-white dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
        <table class="w-full text-sm table-auto">
          <thead class="bg-[#F8FAFC] dark:bg-gray-800">
            <tr class="[&_th]:cursor-pointer [&_th]:whitespace-nowrap [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:font-bold [&_th]:px-4 [&_th]:py-3.5 text-[#54657E] dark:text-gray-300 border-b border-[#D4DDE9] dark:border-gray-700">
              <th
                class="text-left md:sticky md:left-0 md:z-20 bg-[#F8FAFC] dark:bg-gray-800"
                onClick={() => handleSort("client")}
              >
                Client{sortIcon("client")}
              </th>
              <th class="text-center" onClick={() => handleSort("type")}>
                Type{sortIcon("type")}
              </th>
              <th class="text-right" onClick={() => handleSort("opening")}>
                Opening{sortIcon("opening")}
              </th>
              <th class="text-right" onClick={() => handleSort("received")}>
                Received{sortIcon("received")}
              </th>
              <th class="text-right" onClick={() => handleSort("utilized")}>
                Utilized{sortIcon("utilized")}
              </th>
              <th class="text-right" onClick={() => handleSort("closing")}>
                Closing{sortIcon("closing")}
              </th>
              <th class="text-center" onClick={() => handleSort("status")}>
                Status{sortIcon("status")}
              </th>
            </tr>
          </thead>

          <Show when={!loading()} fallback={<TableSkeleton />}>
            <tbody>
              <For each={pagedRows()}>
                {(c, index) => (
                  <tr
                    class={
                      "border-t border-[#E2E8F1] dark:border-gray-700 transition-colors " +
                      (index() % 2 === 0
                        ? "bg-white dark:bg-gray-900"
                        : "bg-[#FAFBFD] dark:bg-gray-900") 
                      
                    }
                  >
                    {/* Client */}
                    <td
                      class={
                        "px-4 py-3 md:sticky md:left-0 md:z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] " +
                        (index() % 2 === 0
                          ? "bg-white dark:bg-gray-900"
                          : "bg-[#FAFBFD] dark:bg-gray-900")
                      }
                    >
                      <div class="flex items-center gap-4">
                        <Avatar name={c.client_nomen} />
                        <div>
                          <div class="font-semibold text-blue-900 dark:text-gray-100 ">
                            {c.client_nomen || "—"}
                          </div>
                          <div class="text-xs text-[#8593A8] dark:text-gray-400">
                            {c.client_email}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Type */}
                    <td class="px-4 py-3 text-center">
                      <span
                        class={
                          "inline-block px-2.5 py-1 text-xs font-semibold rounded-md uppercase " +
                          (TYPE_BADGE[(c.client_type || "").toLowerCase()] ||
                            "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300")
                        }
                      >
                        {c.client_type || "—"}
                      </span>
                    </td>

                    {/* Opening */}
                    <td
                      class={
                        "px-4 py-3 text-right tabular-nums font-medium " +
                        (toNum(rowField(c, "opening_balance")) < 0
                          ? "text-[#AC2334] dark:text-red-300"
                          : "text-[#14233A] dark:text-gray-300")
                      }
                    >
                      {fmtINR(rowField(c, "opening_balance"))}
                    </td>

                    {/* Received */}
                    <td class="px-4 py-3 text-right tabular-nums font-medium text-[#15966A] dark:text-gray-300">
                      {fmtINR(rowField(c, "received"))}
                    </td>

                    {/* Utilized */}
                    <td class="px-4 py-3 text-right tabular-nums font-medium text-[#14233A] dark:text-gray-300">
                      {fmtINR(rowField(c, "utilized"))}
                    </td>

                    {/* Closing */}
                    <td
                      class={
                        "px-4 py-3 text-right tabular-nums " + closingClass(c)
                      }
                    >
                      {fmtINR(rowField(c, "closing_balance"))}
                    </td>

                    {/* Status */}
                    <td class="px-4 py-3 text-center">
                      <StatusBadge status={c.status} />
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </Show>
        </table>

        {/* Empty state (after load, no rows match) */}
        <Show when={!loading() && filteredRows().length === 0}>
          <div class="p-8 text-center">
            <p class="text-sm font-semibold text-[#14233A] dark:text-gray-300">
              No clients to show
            </p>
            <p class="mt-1 text-sm text-[#8593A8] dark:text-gray-400">
              {rows().length === 0
                ? "There is no payments data for this month yet."
                : "No clients match the current filters."}
            </p>
          </div>
        </Show>
      </div>

      {/* Footer count */}
      <div class="flex items-center justify-between mt-5 flex-wrap gap-3">
        <span class="text-sm text-[#8593A8] dark:text-gray-400">
          {filteredRows().length === rows().length
            ? `${rows().length} clients`
            : `Showing ${filteredRows().length} of ${rows().length} clients`}
        </span>

        <Show when={totalPages() > 1}>
          <div class="flex items-center gap-2">
            <button
              onClick={() => page() > 1 && setPage(page() - 1)}
              disabled={page() === 1}
              class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 text-[#54657E] dark:text-gray-200 hover:bg-[#F6F9FC] dark:hover:bg-gray-800 disabled:opacity-35 disabled:cursor-default transition-colors"
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

            <span class="text-sm text-[#8593A8] dark:text-gray-400 px-1">
              Page {page()} of {totalPages()}
            </span>

            <button
              onClick={() => page() < totalPages() && setPage(page() + 1)}
              disabled={page() >= totalPages()}
              class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg bg-blue-900 border border-[#14233A] text-white hover:bg-[#1d3252] disabled:opacity-35 disabled:cursor-default transition-colors"
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
        </Show>
      </div>
    </section>
  );
}
