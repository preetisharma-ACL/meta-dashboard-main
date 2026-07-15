import {
  For,
  Show,
  createMemo,
  createSignal,
  createEffect,
  untrack,
} from "solid-js";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { A, useParams } from "@solidjs/router";
import { useLocation } from "@solidjs/router";
import {
  Users,
  PhoneCall,
  BadgeCheck,
  MapPin,
  Home,
  TrendingUp,
} from "lucide-solid";
import { IndianRupee, Clock, XCircle, User } from "lucide-solid";
import { onMount, onCleanup } from "solid-js";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import {
  fetchCampaigns,
  fetchBulkCampaignInsights,
  fetchProjectById,
} from "../services/campaigns";
import useColumnSort from "../components/Columnsorting";
import {
  projectDetailsCache,
  setProjectDetailsCache,
  dashboardFilter,
  setDashboardFilter,
} from "../cacheStore/appStore";
import Chart from "chart.js/auto";
import Avatar from "../components/common/Avatar";
import useRole, { clientRole } from "./../hooks/useRole";

// Admin/CM "preview as client" insight rows (returned when the bulk call is sent
// with as_client_id) carry BOTH `spend` (client-facing — markup / fixed-CPL
// applied) and `spend_raw` (the actual Meta charge). This footer's raw "Total
// Spent" / CPL is the Meta figure — the Premium CPL is computed separately from
// premium_metrics — so read `spend_raw` when present. A client's own rows have no
// `spend_raw`, so fall back to `spend` (already their billed figure).
const rawSpendOf = (row) =>
  parseFloat((row?.spend_raw != null ? row.spend_raw : row?.spend) || 0);

export default function ProjectDetails() {
  const location = useLocation();
  const project = location.state?.project;
  const params = useParams();
  const projectId = params.id;

  // ── Drive the analytics chart from the same filtered data ──────────────────────
  createEffect(() => {
    const data = displayedCampaigns(); // date-filtered + sorted (+ ad-account filter)
    const label = rangeLabel(); // "Today" / "Last 7 Days" / "Custom Range" etc.

    if (typeof window.__updateCampaignChart === "function") {
      window.__updateCampaignChart(data, `Showing: ${label}`);
    }
  });

  // Build chart once on mount; createEffect above will re-feed data reactively
  let chartInstance = null;

  const buildChart = (campaigns) => {
    const canvas = document.getElementById("campaignChartCanvas");
    if (!canvas) return;

    // ── Dark-mode detection ────────────────────────────────────────────────
    const dark = document.documentElement.classList.contains("dark");

    // ── Theme tokens ───────────────────────────────────────────────────────
    const theme = {
      // Leads bar
      barBg: dark ? "rgba(167,139,250,0.75)" : "rgba(124,58,237,0.82)", // violet-400 / violet-700
      barBorder: dark ? "#A78BFA" : "#6D28D9",

      // Spend line
      lineBorder: dark ? "#FB923C" : "#EA580C", // orange-400 / orange-600
      lineFill: dark ? "rgba(251,146,60,0.10)" : "rgba(234,88,12,0.08)",

      // Grid
      grid: dark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.06)",

      // Axis ticks
      tick: dark ? "#9CA3AF" : "#6B7280", // gray-400 / gray-500

      // Axis titles
      leadsTitle: dark ? "#C4B5FD" : "#5B21B6", // violet-300 / violet-800
      spentTitle: dark ? "#FCA5A5" : "#C2410C", // orange-300 / orange-700

      // Tooltip
      tipBg: dark ? "#1F2937" : "#ffffff",
      tipBorder: dark ? "#374151" : "#E5E7EB",
      tipTitle: dark ? "#F9FAFB" : "#111827",
      tipBody: dark ? "#D1D5DB" : "#374151",

      // Point dot border (makes dots pop on their bg)
      dotBorder: dark ? "#1F2937" : "#ffffff",
    };

    // ── Data ───────────────────────────────────────────────────────────────
    const labels = campaigns.map((c) =>
      (c.campaign_name?.split("|")[0] ?? "").trim().slice(0, 18),
    );
    const leads = campaigns.map((c) => c.totalLeads ?? 0);
    const spent = campaigns.map((c) => c.totalSpent ?? 0);

    // ── Destroy old instance ───────────────────────────────────────────────
    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(canvas, {
      data: {
        labels,
        datasets: [
          {
            type: "bar",
            label: "Leads",
            data: leads,
            backgroundColor: theme.barBg,
            borderColor: theme.barBorder,
            borderWidth: 1.5,
            borderRadius: 6,
            yAxisID: "yLeads",
            order: 2,
          },
          {
            type: "line",
            label: "Spent (₹)",
            data: spent,
            borderColor: theme.lineBorder,
            backgroundColor: theme.lineFill,
            pointBackgroundColor: theme.lineBorder,
            pointBorderColor: theme.dotBorder,
            pointBorderWidth: 2,
            pointRadius: 5,
            pointHoverRadius: 7,
            fill: true,
            tension: 0.38,
            borderWidth: 2.5,
            yAxisID: "ySpent",
            order: 1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: "easeOutQuart" },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: theme.tipBg,
            titleColor: theme.tipTitle,
            bodyColor: theme.tipBody,
            borderColor: theme.tipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            // CPL clients don't see spend anywhere — drop it from the tooltip too.
            filter: (item) => !(iscpl() && item.dataset.label === "Spent (₹)"),
            callbacks: {
              title: (items) =>
                campaigns[items[0].dataIndex]?.campaign_name ?? items[0].label,
              label: (item) =>
                item.dataset.label === "Leads"
                  ? `  Leads: ${item.raw}`
                  : `  Spent: ₹${Number(item.raw).toLocaleString("en-IN")}`,
            },
          },
        },
        scales: {
          x: {
            ticks: {
              autoSkip: false,
              maxRotation: 35,
              color: theme.tick,
              font: { size: 11 },
            },
            grid: { color: theme.grid },
          },
          yLeads: {
            type: "linear",
            position: "left",
            title: {
              display: true,
              text: "Leads",
              color: theme.leadsTitle,
              font: { size: 11, weight: "600" },
            },
            ticks: { color: theme.leadsTitle, font: { size: 11 } },
            grid: { color: theme.grid },
          },
          ySpent: {
            type: "linear",
            position: "right",
            grid: { drawOnChartArea: false },
            title: {
              display: true,
              text: "Spent (₹)",
              color: theme.spentTitle,
              font: { size: 11, weight: "600" },
            },
            ticks: {
              color: theme.spentTitle,
              font: { size: 11 },
              callback: (v) => "₹" + Number(v).toLocaleString("en-IN"),
            },
          },
        },
      },
    });
  };
  // Wire into the reactive effect
  window.__updateCampaignChart = (campaigns) =>
    buildChart(campaigns, rangeLabel());

  const [showNotifications, setShowNotifications] = createSignal(false);

  /* ================= FILTER STATES ================= */

  // Shared with the dashboard via a persisted store, so the selected date range
  // carries across navigation and stays in sync. Same accessor/setter shape as a
  // signal — call sites unchanged.
  const fromDate = () => dashboardFilter.fromDate;
  const toDate = () => dashboardFilter.toDate;
  const setFromDate = (v) => setDashboardFilter("fromDate", v);
  const setToDate = (v) => setDashboardFilter("toDate", v);
  const [search, setSearch] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("All");
  // Admin-only: filter the campaigns table by ad account (client-side, additive).
  const [adAccountFilter, setAdAccountFilter] = createSignal("all");
  // const [page, setPage] = createSignal(1);
  // const [campaigns, setCampaigns] = createSignal([]);
  // const [pageSize, setPageSize] = createSignal(20);
  // const [total, setTotal] = createSignal(0);
  // const [totalPages, setTotalPages] = createSignal(1);
  // const [hasNext, setHasNext] = createSignal(false);
  // const [hasPrev, setHasPrev] = createSignal(false);
  // Add near your other signals — init from auth so role is correct before the
  // date-reactive effect fires (avoids a race with onMount).
  const [userRole, setUserRole] = createSignal(
    JSON.parse(localStorage.getItem("auth") || "null")?.role ?? "client",
  );
  const { handleSort, getSortIcon, sortData } = useColumnSort();
  // Add near your other signals
  const [allCampaigns, setAllCampaigns] = createSignal([]);
  const [allCampaignsLoaded, setAllCampaignsLoaded] = createSignal(false);
  const [loadingAllCampaigns, setLoadingAllCampaigns] = createSignal(false);

  // ── Read from global cache ───────────────────────────────────────────────────
  const cachedProject = () => projectDetailsCache[projectId] ?? {};
  const campaigns = () => cachedProject().campaigns ?? [];
  const loading = () => cachedProject().loading ?? false;
  const page = () => cachedProject().meta?.page ?? 1;
  const pageSize = () => cachedProject().meta?.page_size ?? 20;
  const total = () => cachedProject().meta?.total ?? 0;
  const totalPages = () => cachedProject().meta?.total_pages ?? 1;
  const hasNext = () => cachedProject().meta?.has_next ?? false;
  const hasPrev = () => cachedProject().meta?.has_prev ?? false;
  const { isRetainer, iscpl, ishybrid, isAdmin } = clientRole();

  // Admin/CM previewing a client → the selected Client PK, sent as as_client_id so
  // the bulk-insights call is scoped/marked-up in preview-as-client mode (matches
  // the ledger + DailyReports). Null for a client's own login and for an admin
  // viewing a project outside a selected-client context, where the call falls back
  // to the normal client_nomen scoping.
  const previewClientId = () =>
    userRole() === "admin"
      ? localStorage.getItem("selectedClientNomenId")
      : null;

  // ── Write helper — merges into this project's cache slot ────────────────────
  const setProjectCache = (patch) =>
    setProjectDetailsCache(projectId, (prev) => ({ ...prev, ...patch }));

  // ── Date range sent to the API (premium_metrics is computed server-side for
  //    this window). Clamped: floor 2026-04-01, ceiling today. ────────────────
  const PREMIUM_FLOOR = "2026-04-01";
  const todayStr = () => new Date().toISOString().split("T")[0];
  const rangeStart = () => {
    const f = fromDate();
    return f && f > PREMIUM_FLOOR ? f : PREMIUM_FLOOR;
  };
  const rangeEnd = () => {
    const t = toDate();
    const today = todayStr();
    return t && t < today ? t : today;
  };

  const formatDateTime = (date) => {
    if (!date) return "No Date";

    return new Date(date).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };
  // Normalise the raw campaign status into the three states this table shows.
  // Anything not paused/completed is treated as running ("Live").
  const normalizeStatus = (s) => {
    const v = String(s || "").toLowerCase();
    if (v === "paused") return "paused";
    if (v === "completed") return "completed";
    return "Live";
  };
  // ── Re-scope to the selected date range. premium_metrics is server-computed
  //    per range, so changing the filter must re-fetch the list (raw columns
  //    stay reactive via their own client-side insight filtering). Tracks only
  //    the date signals; search is handled by its own input handler. ──────────
  createEffect(() => {
    fromDate();
    toDate();
    untrack(() => {
      loadCampaigns(1, search());
      loadAllCampaignsForTotals(true);
    });
  });

  onMount(() => {
    const handleClickOutside = (e) => {
      if (!e.target.closest(".notification-wrapper")) {
        setShowNotifications(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    onCleanup(() => document.removeEventListener("click", handleClickOutside));

    // Re-build chart whenever the <html> dark class toggles (live theme switch)
    const darkObserver = new MutationObserver(() => {
      const data = displayedCampaigns();
      if (data.length) buildChart(data);
    });
    darkObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
  });

  const loadProject = async () => {
    try {
      const res = await fetchProjectById(projectId);
    } catch (err) {
      console.error(err);
    }
  };

  // ✅ No floating code here — insightsResults belongs INSIDE loadCampaigns below

  const loadCampaigns = async (pageNo = 1, searchValue = "") => {
    try {
      setProjectCache({ loading: true });

      const res = await fetchCampaigns(
        pageNo,
        projectId,
        searchValue,
        20,
        rangeStart(),
        rangeEnd(),
      );
      const apiData = res.data.results || res.data || [];

      if (!Array.isArray(apiData)) {
        setProjectCache({ campaigns: [], loading: false });
        return;
      }

      // Fetch insights for this page's campaigns in ONE bulk call
      // (was: one fetchCampaignInsights request per campaign).
      const insightsMap = {};
      try {
        const bulk = await fetchBulkCampaignInsights(
          apiData.map((item) => item.id),
          { asClientId: previewClientId() },
        );
        for (const row of bulk.data || []) {
          if (row.is_manual) continue; // manual leads come from a separate path
          const key = row.campaign_id;
          if (!insightsMap[key]) insightsMap[key] = [];
          insightsMap[key].push(row);
        }
      } catch (err) {
        console.error("Failed to load campaign insights:", err);
      }

      const formatted = apiData.map((item, index) => {
        return {
          number: index + 1,
          id: item.id,
          campaign_name:
            userRole() === "admin"
              ? item.name || "No Name"
              : item.name
                  ?.split("|")
                  .slice(1, 2)
                  .map((s) => s.trim())
                  .join(" | ") || "No Name",
          start_date: item.start_date || "No Date",
          paused_date: formatDateTime(item.paused_at),
          stop_date: item.stop_date || "No date",
          location: item.project_name || "-",
          ad_account: item.ad_account_name || "-",
          status: normalizeStatus(item.status),
          cpl: item.cpl || 0,
          // Server-computed lead counts (scoped to the requested date range).
          // extra_leads = manually-added leads; leads_count = own + extra.
          own_leads: Number(item.own_leads ?? 0),
          extra_leads: Number(item.extra_leads ?? 0),
          leads_count: Number(item.leads_count ?? 0),
          // Premium comes straight off the server-computed object (per-day
          // markup already applied for the requested date range).
          premium_metrics: item.premium_metrics,
          insights: insightsMap[item.id] || [],
        };
      });

      const meta = res?.meta?.pagination;

      // ✅ Write everything into the global cache slot for this projectId
      setProjectCache({
        campaigns: formatted,
        meta: meta ?? cachedProject().meta,
        lastFetched: Date.now(),
        loading: false,
      });
    } catch (err) {
      console.error("API error:", err);
      setProjectCache({ campaigns: [], loading: false });
    }
  };

  // Add this new function to load ALL campaigns for totals.
  // `force` re-runs it when the date filter changes (premium is range-scoped).
  const loadAllCampaignsForTotals = async (force = false) => {
    if (loadingAllCampaigns()) return;
    if (!force && allCampaignsLoaded()) return;

    setLoadingAllCampaigns(true);
    try {
      let currentPage = 1;
      let accumulated = [];
      let hasMorePages = true;

      while (hasMorePages) {
        const res = await fetchCampaigns(
          currentPage,
          projectId,
          "",
          1000,
          rangeStart(),
          rangeEnd(),
        );
        const apiData = res.data.results || res.data || [];

        if (!Array.isArray(apiData) || apiData.length === 0) break;

        // Fetch insights for this batch in ONE bulk call
        // (was: one fetchCampaignInsights request per campaign).
        const insightsMap = {};
        try {
          const bulk = await fetchBulkCampaignInsights(
            apiData.map((item) => item.id),
            { asClientId: previewClientId() },
          );
          for (const row of bulk.data || []) {
            if (row.is_manual) continue; // manual leads come from a separate path
            const key = row.campaign_id;
            if (!insightsMap[key]) insightsMap[key] = [];
            insightsMap[key].push(row);
          }
        } catch (err) {
          console.error("Failed to load campaign insights:", err);
        }

        const formatted = apiData.map((item) => {
          return {
            id: item.id,
            // Admin sees the full name (matches the paginated table); clients keep
            // the trimmed label. ad_account added so the all-pages set can power
            // the ad-account filter + dropdown.
            campaign_name:
              userRole() === "admin"
                ? item.name || "No Name"
                : item.name
                  ? `${item.name
                      .split("|")
                      .slice(1, 2)
                      .map((s) => s.trim())
                      .join(" | ")} | ${item.start_date || "No Date"}`
                  : "No Name",
            ad_account: item.ad_account_name || "-",
            start_date: item.start_date || "No Date",
            paused_date: formatDateTime(item.paused_at),
            stop_date: item.stop_date || "No date",
            status: normalizeStatus(item.status),
            cpl: item.cpl || 0,
            own_leads: Number(item.own_leads ?? 0),
            extra_leads: Number(item.extra_leads ?? 0),
            leads_count: Number(item.leads_count ?? 0),
            premium_metrics: item.premium_metrics,
            insights: insightsMap[item.id] || [],
          };
        });

        accumulated = [...accumulated, ...formatted];

        const meta = res?.meta?.pagination;
        hasMorePages = meta?.has_next ?? false;
        currentPage++;
      }

      setAllCampaigns(accumulated);
      setAllCampaignsLoaded(true);
    } catch (err) {
      console.error("Failed to load all campaigns for totals:", err);
    } finally {
      setLoadingAllCampaigns(false);
    }
  };

  // Add this inside ProjectDetails component
  /**
   * Aggregates RAW insight rows within an optional date range.
   * (Premium/marked-up figures now come straight from the server-computed
   * premium_metrics on each campaign — no client-side markup reconstruction.)
   *
   * @param {Array}  insights - raw insight rows for one campaign
   * @param {string} from     - "YYYY-MM-DD" or ""
   * @param {string} to       - "YYYY-MM-DD" or ""
   */
  const getInsightsInRange = (insights, from, to) => {
    if (!insights?.length) {
      return { leads: 0, clicks: 0, reach: 0, spent: 0, cpl: 0 };
    }

    const filtered =
      !from || !to
        ? insights
        : insights.filter((d) => {
            const dateStr = d.date.includes("T")
              ? d.date.split("T")[0]
              : d.date;
            return dateStr >= from && dateStr <= to;
          });

    let totalLeads = 0;
    let totalClicks = 0;
    let totalReach = 0;
    let totalSpent = 0;

    for (const d of filtered) {
      totalLeads += d.leads || 0;
      totalClicks += d.clicks || 0;
      totalReach += d.impressions || 0;
      totalSpent += rawSpendOf(d);
    }

    const cpl =
      totalLeads > 0 ? Number((totalSpent / totalLeads).toFixed(2)) : 0;

    return {
      leads: totalLeads,
      clicks: totalClicks,
      reach: totalReach,
      spent: totalSpent,
      cpl,
    };
  };

  const goToPrev = () => {
    if (hasPrev()) loadCampaigns(page() - 1, search());
  };

  const goToNext = () => {
    if (hasNext()) loadCampaigns(page() + 1, search());
  };

  /* ================= BASE FILTER (SEARCH + STATUS) ================= */

  const baseFilteredData = createMemo(() => {
    return campaigns().filter((item) => {
      // const matchesSearch = item.campaign_name
      //     .toLowerCase()
      //     .includes(search().toLowerCase());

      const matchesStatus =
        statusFilter() === "All" || item.status === statusFilter();

      return matchesStatus;
    });
  });

  /* ================= GROUP + AGGREGATE + SORT ================= */

  const sortedCampaigns = createMemo(() => {
    const map = new Map();

    for (const row of baseFilteredData()) {
      const key = row.id;

      if (!map.has(key)) {
        // Raw columns from insights (date-filtered client-side)
        const stats = getInsightsInRange(row.insights, fromDate(), toDate());

        // Premium straight off the server-computed object (already per-day
        // marked up for the requested range). null when no premium attribution.
        const pm = row.premium_metrics;
        const premiumCpl = pm && pm.cpl != null ? Number(pm.cpl) : null;

        // Total leads = own (from insights) + extra (manually-added, server-
        // computed). CPL is recomputed against the combined lead count.
        const totalLeads = stats.leads + Number(row.extra_leads || 0);
        const totalCPL =
          totalLeads > 0 ? Number((stats.spent / totalLeads).toFixed(2)) : 0;

        map.set(key, {
          ...row,
          totalLeads,
          totalClicks: stats.clicks,
          totalReach: stats.reach,
          totalSpent: stats.spent,
          totalCPL,
          premiumCpl,
        });
      }
    }

    // let data = Array.from(map.values()).sort((a, b) => b.totalLeads - a.totalLeads);
    let data = Array.from(map.values()).sort(
      (a, b) => new Date(b.start_date) - new Date(a.start_date),
    );
    return sortData(data);
  });

  // ── Admin-only ad-account filter ───────────────────────────────────────────
  // Dropdown lists EVERY ad account across all pages (from the all-pages set
  // loaded for totals); falls back to the current page until that finishes.
  const adAccountOptions = createMemo(() => {
    const set = new Set();
    const src = allCampaigns().length ? allCampaigns() : campaigns();
    for (const c of src) {
      if (c.ad_account && c.ad_account !== "-") set.add(c.ad_account);
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  });

  // Aggregate a raw row into the display shape (same maths as sortedCampaigns).
  const aggregateRow = (row) => {
    const stats = getInsightsInRange(row.insights, fromDate(), toDate());
    const pm = row.premium_metrics;
    const premiumCpl = pm && pm.cpl != null ? Number(pm.cpl) : null;
    const totalLeads = stats.leads + Number(row.extra_leads || 0);
    const totalCPL =
      totalLeads > 0 ? Number((stats.spent / totalLeads).toFixed(2)) : 0;
    return {
      ...row,
      totalLeads,
      totalClicks: stats.clicks,
      totalReach: stats.reach,
      totalSpent: stats.spent,
      totalCPL,
      premiumCpl,
    };
  };

  // When an ad account is selected we ignore pagination and show every matching
  // campaign across ALL pages (search + status still apply, client-side). When
  // "all", behaviour is unchanged — the existing paginated page view.
  const displayedCampaigns = createMemo(() => {
    const acc = adAccountFilter();
    if (acc === "all") return sortedCampaigns();

    const q = search().trim().toLowerCase();
    const status = statusFilter();
    const rows = allCampaigns()
      .filter((r) => (r.ad_account ?? "-") === acc)
      .filter((r) => status === "All" || r.status === status)
      .filter((r) => !q || (r.campaign_name ?? "").toLowerCase().includes(q))
      .map(aggregateRow)
      .sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
    return sortData(rows);
  });

  const suggestions = createMemo(() => {
    const result = [];

    const data = sortedCampaigns();

    data.forEach((campaign) => {
      // 1. Zero Leads
      if (campaign.totalLeads === 0) {
        result.push(`${campaign.campaign_name} has zero leads`);
      }

      // 2. High CPL
      if (campaign.cpl > 250) {
        result.push(
          `${campaign.campaign_name} CPL is high (₹${campaign.cpl}) - Need attention`,
        );
      }

      // 3. Low performance suggestion
      if (campaign.totalLeads < 10 && campaign.cpl > 200) {
        result.push(`Improve performance in ${campaign.campaign_name}`);
      }

      // 4. Good campaign → suggest scaling
      if (campaign.totalLeads > 50 && campaign.cpl < 200) {
        result.push(` Increase budget in ${campaign.campaign_name}`);
      }

      // dummy logic
      if (campaign.cpl > 1.2 * 200) {
        result.push(` ${campaign.campaign_name} CPL increased significantly`);
      }
    });

    return result;
  });

  /* ================= PAGINATION ================= */

  // const paginatedData = createMemo(() =>
  //     sortedCampaigns().slice(
  //         (page() - 1) * rowsPerPage,
  //         page() * rowsPerPage
  //     )
  // );

  /* ================= CLEAR FILTERS ================= */

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("All");
    setAdAccountFilter("all");
    setFromDate("");
    setToDate("");
  };

  /* ================= RANGE LABEL ================= */

  const rangeLabel = createMemo(() => {
    if (!fromDate() || !toDate()) return "Total";

    const from = new Date(fromDate());
    const to = new Date(toDate());

    // normalize to local midnight
    from.setHours(0, 0, 0, 0);
    to.setHours(0, 0, 0, 0);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const sameDay = (a, b) => a.getTime() === b.getTime();
    const diffDays = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;

    // Only use a preset label when the range ACTUALLY matches that period —
    // otherwise a custom selection (e.g. 13–14 Jun) wrongly read "Yesterday".
    if (diffDays === 1 && sameDay(from, today)) return "Today";
    if (diffDays === 1 && sameDay(from, yesterday)) return "Yesterday";
    if (sameDay(to, yesterday)) {
      if (diffDays === 3) return "Last 3 Days";
      if (diffDays === 7) return "Last 7 Days";
    }
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
    if (sameDay(from, firstOfThisMonth) && sameDay(to, today))
      return "This Month";
    if (sameDay(from, firstOfPrevMonth) && sameDay(to, lastOfPrevMonth))
      return "Last Month";

    // Custom selection → show the actual date(s).
    const fmt = (d) =>
      d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
    return sameDay(from, to) ? fmt(from) : `${fmt(from)} – ${fmt(to)}`;
  });

  const metricIcons = {
    "Total Leads Generated": Users,
    "Average CPL": TrendingUp,
    "Total Spent Amount": IndianRupee,
    "Total Qualified Leads": BadgeCheck,
    "Follow ups / Interested": PhoneCall,
    "Delay in Feedback": Clock,
    "Not Interested": XCircle,
    "Call Not Picked / Call Later": PhoneCall,
    Broker: User,
  };

  async function downloadPDF(elementId, fileName) {
    const element = document.getElementById(elementId);

    const canvas = await html2canvas(element, {
      scale: 2,
      backgroundColor: "#ffffff",
    });

    const imgData = canvas.toDataURL("image/png");

    const pdf = new jsPDF("p", "mm", "a4");

    const imgWidth = 210;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);

    pdf.save(fileName);
  }
  /* ================= UI ================= */

  const leadSummary = {
    totalLeads: 120,
    deliveredLeads: 100,
    commitment: 60,
    qualifiedLeads: 52, // actual qualified (manual or API)
  };
  const requiredQualified = () =>
    Math.round(leadSummary.totalLeads * (leadSummary.commitment / 100));

  const isCommitmentMet = () =>
    leadSummary.qualifiedLeads >= requiredQualified();

  const remainingLeads = () =>
    isCommitmentMet() ? 0 : leadSummary.totalLeads - leadSummary.deliveredLeads;

  // Replace your existing footerTotals createMemo with this
  const footerTotals = createMemo(() => {
    const source = allCampaignsLoaded() ? allCampaigns() : sortedCampaigns();
    const acc = adAccountFilter();

    const filtered = source.filter((item) => {
      const matchesStatus =
        statusFilter() === "All" || item.status === statusFilter();
      // Respect the admin ad-account filter so the footer totals match the
      // filtered table.
      const matchesAcc = acc === "all" || (item.ad_account ?? "-") === acc;

      return matchesStatus && matchesAcc;
    });

    let totalLeads = 0;
    let totalClicks = 0;
    let totalReach = 0;
    let totalSpent = 0;

    // Premium CPL is AGGREGATED, never averaged: Σ premium spend ÷ Σ premium
    // leads. Rows with no premium_metrics contribute nothing.
    let premiumSpend = 0;
    let premiumLeads = 0;

    for (const row of filtered) {
      const stats = getInsightsInRange(row.insights, fromDate(), toDate());

      totalLeads += stats.leads + Number(row.extra_leads || 0);
      totalClicks += stats.clicks;
      totalReach += stats.reach;
      totalSpent += stats.spent;

      const pm = row.premium_metrics;
      if (pm && pm.spend != null && pm.leads_count != null) {
        premiumSpend += Number(pm.spend);
        premiumLeads += Number(pm.leads_count);
      }
    }

    const avgCPL = totalLeads > 0 ? (totalSpent / totalLeads).toFixed(2) : 0;

    const premiumCPL = premiumLeads > 0 ? premiumSpend / premiumLeads : null;

    return {
      totalLeads,
      totalClicks,
      totalReach,
      totalSpent,
      avgCPL,
      premiumCPL,
    };
  });

  return (
    <div class="space-y-6 m-4">
      {/* ================= PROJECT OVERVIEW ================= */}
      <div>
        <h1 class="text-2xl font-semibold">All campaigns</h1>
        <nav>
          <ul class="flex items-center gap-1.5 mb-1.5 mt-2 list-none p-0">
            <li class="flex items-center gap-1 group cursor-pointer">
              <svg
                class="w-4 h-4 text-gray-500 transition-colors group-hover:text-purple-600"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001 1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"
                />
              </svg>

              <a
                href="/"
                class="text-sm text-gray-600 dark:text-gray-400 transition-colors group-hover:text-purple-600"
              >
                Home
              </a>
            </li>
            <li class="flex items-center">
              <svg
                class="w-3 h-3 text-gray-600 dark:text-gray-400"
                viewBox="0 0 12 12"
                fill="none"
              >
                <path
                  d="M4.5 2.5L7.5 6L4.5 9.5"
                  stroke="currentColor"
                  stroke-width="1.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </li>
            <li>
              <span class="text-sm text-gray-500 dark:text-gray-400 font-medium">
                All active campaigns
              </span>
            </li>
          </ul>
        </nav>
      </div>
      <Show
        when={project}
        fallback={
          <p class="text-sm text-gray-400 border border-dashed rounded-xl p-8 text-center">
            No project selected
          </p>
        }
      >
        <section class=" dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
          <h2 class="text-[15px] font-medium mb-4 pb-3 border-b border-gray-200 dark:border-gray-700">
            Project overview
          </h2>
          <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Info label="Project name" value={project?.name} />
            <Info label="Location" value={project?.location} />
            <Info label="Property type" value={project?.type} />
            {/* <Info label="Priority" value={project?.priority} badge />
            <Info label="Project control" value={project?.projectControl} />
            <Info label="Pricing & typology" value={project?.summary} /> */}
          </div>
        </section>
      </Show>
      <div class="hidden">
        <Show when={project}>
          <div class="mt-8 p-6 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-sm">
            {/* Header */}
            <div class="flex items-center justify-between mb-6">
              <h2 class="text-lg font-semibold text-gray-800 dark:text-white">
                Qualification Summary
              </h2>
              <span
                class="text-sm px-4 py-1 rounded-full font-medium"
                classList={{
                  "bg-green-100 text-green-700": isCommitmentMet(),
                  "bg-yellow-100 text-yellow-700": !isCommitmentMet(),
                }}
              >
                {isCommitmentMet() ? "Completed" : "In Progress"}
              </span>
            </div>
            {/* Cards */}
            <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {/* Card */}
              {[
                { label: "Total Required", value: leadSummary.totalLeads },
                { label: "Delivered", value: leadSummary.deliveredLeads },
                { label: "Commitment", value: `${leadSummary.commitment}%` },
                {
                  label: "Target Qualified",
                  value: requiredQualified(),
                  color: "text-blue-600",
                },
                {
                  label: "Achieved",
                  value: leadSummary.qualifiedLeads,
                  color: "text-green-600",
                },
                {
                  label: "Remaining",
                  value: remainingLeads(),
                  color: "text-yellow-500",
                },
              ].map((item) => (
                <div class="group bg-white dark:bg-gray-800/70 backdrop-blur-sm p-4 rounded-xl border border-gray-100 shadow-md dark:border-gray-700 hover:shadow-lg transition-all duration-300">
                  <p class="text-sm text-gray-700 dark:text-gray-400 mb-1">
                    {item.label}
                  </p>

                  <h2
                    class={`text-2xl font-semibold ${item.color || "text-gray-800 dark:text-white"}`}
                  >
                    {item.value}
                  </h2>
                </div>
              ))}
            </div>

            {/* Progress Bar */}
            <div class="mt-6">
              <div class="flex justify-between text-xs text-gray-500 mb-1">
                <span>Qualification Progress</span>
                <span>
                  {leadSummary.qualifiedLeads} / {requiredQualified()}
                </span>
              </div>

              <div class="w-full bg-gray-200 dark:bg-gray-700 h-1 rounded-full overflow-hidden">
                <div
                  class="h-1 rounded-full transition-all duration-700"
                  classList={{
                    "bg-green-700": isCommitmentMet(),
                    "bg-yellow-500": !isCommitmentMet(),
                  }}
                  style={{
                    width: `${Math.min(
                      (leadSummary.qualifiedLeads / requiredQualified()) * 100,
                      100,
                    )}%`,
                  }}
                />
              </div>
            </div>

            {/* Insight Box */}
            <div class="mt-6 p-4 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
              <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
                You have received{" "}
                <span class="font-semibold text-gray-900 dark:text-white">
                  {leadSummary.deliveredLeads}
                </span>{" "}
                leads. Based on{" "}
                <span class="font-semibold">{leadSummary.commitment}%</span>{" "}
                commitment,
                <span class="font-semibold">{requiredQualified()}</span> should
                be qualified. Currently,{" "}
                <span class="font-semibold text-green-600">
                  {leadSummary.qualifiedLeads}
                </span>{" "}
                are achieved.
                <span
                  class={`ml-1 font-medium ${isCommitmentMet() ? "text-green-600" : "text-yellow-600"}`}
                >
                  {isCommitmentMet()
                    ? "Requirement has been fulfilled."
                    : "More qualified leads are required."}
                </span>
              </p>
            </div>
          </div>
        </Show>
      </div>
      {/* ================= FILTERS ================= */}
      <div class="flex justify-between">
        <div class="flex flex-wrap gap-2 items-center">
          <input
            placeholder="Search campaign..."
            value={search()}
            onInput={(e) => {
              const value = e.target.value;
              setSearch(value);
              loadCampaigns(1, value);
            }}
            class="px-3 py-2 border rounded-lg dark:bg-gray-800"
          />

          <div class="relative inline-block">
            <select
              value={statusFilter()}
              onChange={(e) => setStatusFilter(e.target.value)}
              class="px-3 py-2 border rounded-lg dark:bg-gray-800 appearance-none
                            "
            >
              <option value="All">All</option>
              <option value="Live">Live</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>

            <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
              <svg
                class="w-4 h-4 text-gray-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>

          {/* Admin-only: Ad Account filter */}
          {userRole() === "admin" && (
            <div class="relative inline-block">
              <select
                value={adAccountFilter()}
                onChange={(e) => setAdAccountFilter(e.target.value)}
                class="px-3 py-2 border rounded-lg dark:bg-gray-800 appearance-none pr-9"
              >
                <option value="all">All Ad Accounts</option>
                <For each={adAccountOptions()}>
                  {(acc) => <option value={acc}>{acc}</option>}
                </For>
              </select>
              <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                <svg
                  class="w-4 h-4 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </div>
            </div>
          )}

          <DateRangeFilter
            fromDate={fromDate}
            toDate={toDate}
            setFromDate={setFromDate}
            setToDate={setToDate}
          />

          <button
            onClick={clearFilters}
            class="px-3 py-2 bg-red-100 text-red-700 rounded-lg"
          >
            Clear
          </button>
        </div>
        <div class="relative notification-wrapper">
          {/* <div class="flex justify-end items-center gap-4  relative">

                        <h3 class="text-lg font-semibold text-gray-800 dark:text-white">
                            Notifications & Recommendations
                        </h3>

                        <button
                            onClick={() => setShowNotifications(!showNotifications())}
                            class="relative p-2 m-2 rounded-full bg-blue-100 dark:bg-blue-800 hover:scale-105 transition"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5 text-blue-900 dark:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14V11a6 6 0 10-12 0v3c0 .386-.149.735-.405 1.001L4 17h5m6 0a3 3 0 11-6 0h6z" />
                            </svg>

                            <Show when={suggestions().length > 0}>
                                <span class="absolute -top-1 -right-1 bg-red-500 text-white text-xs px-1.5 rounded-full">
                                    {suggestions().length}
                                </span>
                            </Show>
                        </button>
                    </div> */}

          <Show when={showNotifications()}>
            <div
              class="absolute right-0 mt-3 w-90 bg-white dark:bg-gray-900 
              rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 z-50"
            >
              {/* Header (RED like your image) */}
              <div class="bg-blue-800 text-white px-4 py-3 rounded-t-xl flex justify-between items-center">
                <span class="font-semibold">Notifications</span>
                <span class="text-sm">
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                    />
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                    />
                  </svg>
                </span>
              </div>

              {/* List */}
              <div class="max-h-80 overflow-y-auto">
                <For each={suggestions()}>
                  {(item) => (
                    <div class="flex items-start gap-3 px-4 py-3 border-b dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                      {/* Avatar circle */}
                      <div class="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-blue-900 text-xs font-bold">
                        B
                      </div>

                      {/* Content */}
                      <div class="flex-1">
                        <p class="text-sm text-gray-800 dark:text-gray-200">
                          {item}
                        </p>
                        <span class="text-xs text-gray-400">just now</span>
                      </div>
                    </div>
                  )}
                </For>
              </div>

              {/* Footer */}
              <div class="text-center text-sm text-blue-500 py-2 hover:underline cursor-pointer">
                See all recent activity
              </div>
            </div>
          </Show>
        </div>
      </div>

      {/* ================= TABLE ================= */}
      <div class="overflow-x-auto border rounded-xl">
        <table class="min-w-full text-sm">
          <thead class="bg-gray-100 dark:bg-gray-800">
            <tr class="[&_th]:text-center [&_th]:cursor-pointer [&_th]:whitespace-nowrap [&_th:first-child]:text-left">
              {userRole() === "admin" && (
                <th class="p-3" onClick={() => handleSort("id")}>
                  ID {getSortIcon("id")}
                </th>
              )}
              <th class="p-3" onClick={() => handleSort("campaign_name")}>
                Campaign {getSortIcon("campaign_name")}
              </th>
              <th class="p-3" onClick={() => handleSort("start_date")}>
                Start Date {getSortIcon("start_date")}
              </th>
              <th class="p-3" onClick={() => handleSort("paused_date")}>
                Paused Date {getSortIcon("paused_date")}
              </th>
              {userRole() === "admin" && (
                <th class="p-3" onClick={() => handleSort("ad_account")}>
                  Ad Account {getSortIcon("ad_account")}
                </th>
              )}
              <th class="p-3" onClick={() => handleSort("status")}>
                Status {getSortIcon("status")}
              </th>
              <th class="p-3" onClick={() => handleSort("totalLeads")}>
                {rangeLabel()} Leads {getSortIcon("totalLeads")}
              </th>
              {userRole() === "client" && (
                <th class="p-3" onClick={() => handleSort("totalClicks")}>
                  {rangeLabel()} Clicks {getSortIcon("totalClicks")}
                </th>
              )}
              {userRole() === "client" && (
                <th class="p-3" onClick={() => handleSort("totalReach")}>
                  {rangeLabel()} Impression {getSortIcon("totalReach")}
                </th>
              )}
              <Show when={!iscpl()}>
                <th class="p-3" onClick={() => handleSort("totalSpent")}>
                  {rangeLabel()} Spent {getSortIcon("totalSpent")}
                </th>
              </Show>
              <th class="p-3" onClick={() => handleSort("cpl")}>
                {rangeLabel()} Avg CPL {getSortIcon("cpl")}
              </th>
              {userRole() === "admin" && (
                <th class="p-3" onClick={() => handleSort("premium_cpl")}>
                  Premium CPL {getSortIcon("premium_cpl")}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            <For each={displayedCampaigns()}>
              {(row, i) => (
                <tr
                  class={`[&_td]:text-center [&_td:first-child]:text-left border-t    ${
                    i() % 2 === 0
                      ? "bg-white dark:bg-gray-900"
                      : "bg-purple-50 dark:bg-gray-900"
                  }`}
                >
                  {userRole() === "admin" && <td class="p-3">{row.id}</td>}

                  <td class="p-3 font-medium w-[300px]">
                    <div class="flex items-center gap-2">
                      <Avatar name={row.campaign_name} />
                      <A
                        href={`/campaign/${row.id}`}
                        class="text-purple-800  dark:text-purple-300 whitespace-nowrap"
                      >
                        {row.campaign_name}
                      </A>

                      <Show
                        when={
                          row.totalLeads ===
                          Math.max(
                            ...displayedCampaigns().map((c) => c.totalLeads),
                          )
                        }
                      >
                        <span class="ml-2 px-2 py-0.5 text-xs rounded bg-green-100 text-green-700">
                          Top Leads
                        </span>
                      </Show>
                    </div>
                  </td>
                  <td class="p-3 ">{row.start_date || "No Date"}</td>
                  <td class="p-3 ">{row.paused_date || "No Date"}</td>
                  {userRole() === "admin" && (
                    <td class="p-3 whitespace-nowrap ">{row.ad_account}</td>
                  )}
                  <td class="px-4 py-3">
                    <span
                      class="px-2 py-1 text-sm rounded-full capitalize"
                      classList={{
                        "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400":
                          row.status === "Live",
                        "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400":
                          row.status === "paused",
                        "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400":
                          row.status === "completed",
                      }}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td class="p-3 font-semibold">{row.totalLeads}</td>
                  {userRole() === "client" && (
                    <td class="p-3">{row.totalClicks}</td>
                  )}
                  {userRole() === "client" && (
                    <td class="p-3">{row.totalReach}</td>
                  )}
                  <Show when={!iscpl()}>
                    <td class="p-3">
                      ₹{row.totalSpent.toLocaleString("en-IN")}
                    </td>
                  </Show>
                  <td class="p-3">₹{(row.totalCPL ?? 0).toFixed(2)}</td>
                  {userRole() === "admin" && (
                    <td class="p-3">
                      {row.premiumCpl !== null && row.premiumCpl !== undefined
                        ? `₹${row.premiumCpl.toLocaleString("en-IN", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}`
                        : "—"}
                    </td>
                  )}
                </tr>
              )}
            </For>
          </tbody>
          <tfoot class="sticky bottom-0 z-10">
            <tr
              class="
    bg-gradient-to-r from-purple-100 to-purple-50 
    dark:from-gray-800 dark:to-gray-900
    border-t-2 border-purple-300 dark:border-gray-600
    shadow-[0_-2px_10px_rgba(0,0,0,0.08)]
    font-semibold text-center
  "
            >
              {/* Label */}
              <td class="p-3 text-left">
                <span class="px-3 py-1 bg-purple-600 text-white rounded-lg text-xs font-bold">
                  TOTAL
                </span>
              </td>

              {/* ✅ Add this — matches the Ad Account column in thead */}
              {userRole() === "admin" && <td></td>}

              {userRole() === "admin" && <td></td>}
              <td></td>
              <td></td>
              <td></td>

              {/* Leads */}
              <td class="text-green-700 dark:text-green-300 font-bold">
                {footerTotals().totalLeads}
              </td>

              {/* Clicks */}
              {userRole() === "client" && (
                <td class="text-blue-700 dark:text-blue-300 font-bold">
                  {footerTotals().totalClicks}
                </td>
              )}

              {/* Reach */}
              {userRole() === "client" && (
                <td class="text-indigo-700 dark:text-indigo-300 font-bold">
                  {footerTotals().totalReach}
                </td>
              )}

              {/* Spend */}
              <Show when={!iscpl()}>
                <td class="text-red-700 dark:text-red-300 font-bold">
                  ₹{footerTotals().totalSpent.toLocaleString("en-IN")}
                </td>
              </Show>

              {/* CPL */}
              <td class="text-purple-700 dark:text-purple-300 font-bold">
                ₹{footerTotals().avgCPL}
              </td>

              {userRole() === "admin" && (
                <td class="text-purple-700 dark:text-purple-300 font-bold">
                  {footerTotals().premiumCPL !== null
                    ? `₹${footerTotals().premiumCPL.toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}`
                    : "—"}
                </td>
              )}
            </tr>
          </tfoot>
        </table>
      </div>
      {/* Pagination — only when not filtering by ad account (that view spans all
          pages, so paging would be misleading). */}
      <Show
        when={adAccountFilter() === "all"}
        fallback={
          <div class="mt-4 text-sm text-gray-500">
            Showing all {displayedCampaigns().length} campaign
            {displayedCampaigns().length === 1 ? "" : "s"} for the selected ad
            account
          </div>
        }
      >
        <div class="flex items-center justify-between mt-4 flex-wrap gap-3">
          <span class="text-sm text-gray-500">
            {total() === 0
              ? "No results"
              : `Showing ${(page() - 1) * pageSize() + 1}–${Math.min(page() * pageSize(), total())} of ${total()} results`}
          </span>

          <div class="flex items-center gap-2">
            <button
              onClick={() => {
                if (hasPrev()) {
                  const newPage = page() - 1;
                  loadCampaigns(newPage, search());
                }
              }}
              disabled={!hasPrev()}
              class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-35 disabled:cursor-default transition-colors"
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

            <span class="text-sm text-gray-500 px-1">
              Page {page()} of {totalPages()}
            </span>

            <button
              onClick={() => {
                if (hasNext()) {
                  const newPage = page() + 1;
                  loadCampaigns(newPage, search());
                }
              }}
              disabled={!hasNext()}
              class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg bg-blue-600 border border-blue-600 text-white hover:bg-blue-700 disabled:opacity-35 disabled:cursor-default transition-colors"
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
      </Show>

      {/* ================= ANALYTICS CHART ================= */}
      <div
        class="mt-8 p-5
                bg-white       dark:bg-gray-800/70
                border border-gray-200 dark:border-gray-700/60
                rounded-xl shadow-sm dark:shadow-black/30"
      >
        {/* Header row */}
        <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h3 class="text-[15px] font-semibold text-gray-800 dark:text-gray-100">
              Campaign performance
            </h3>
            <p class="text-sm text-gray-400 dark:text-gray-500 mt-0.5">
              {rangeLabel()} · leads vs spend
            </p>
          </div>

          {/* Legend */}
          <div class="flex items-center gap-5 text-xs text-gray-500 dark:text-gray-400">
            <span class="flex items-center gap-1.5">
              <span class="w-3 h-3 rounded-sm bg-violet-500 dark:bg-violet-400 inline-block" />
              Leads (bar)
            </span>
            <span class="flex items-center gap-2">
              <span class="relative w-5 h-0.5 bg-orange-500 dark:bg-orange-400 inline-block">
                <span
                  class="w-2 h-2 rounded-full bg-orange-500 dark:bg-orange-400
                                 absolute -top-[3px] left-1/2 -translate-x-1/2"
                />
              </span>
              Spent ₹ (line)
            </span>
          </div>
        </div>

        {/* Summary cards */}
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {/* Campaigns */}
          <div
            class="rounded-lg p-3
                        bg-gray-50       dark:bg-gray-900/60
                        border border-transparent dark:border-gray-700/40"
          >
            <p class="text-xs text-gray-400 dark:text-gray-500 mb-1">
              Campaigns
            </p>
            <p class="text-xl font-semibold text-gray-800 dark:text-gray-100">
              {displayedCampaigns().length}
            </p>
          </div>

          {/* Total leads */}
          <div
            class="rounded-lg p-3
                        bg-violet-50     dark:bg-violet-900/20
                        border border-violet-100 dark:border-violet-700/30"
          >
            <p class="text-xs text-violet-500 dark:text-violet-400 mb-1">
              Total leads
            </p>
            <p class="text-xl font-semibold text-violet-600 dark:text-violet-300">
              {footerTotals().totalLeads}
            </p>
          </div>

          {/* Total spent */}
          <Show when={!iscpl()}>
            <div
              class="rounded-lg p-3
            bg-orange-50     dark:bg-orange-900/20
            border border-orange-100 dark:border-orange-700/30"
            >
              <p class="text-xs text-orange-500 dark:text-orange-400 mb-1">
                Total spent
              </p>
              <p class="text-xl font-semibold text-orange-500 dark:text-orange-300">
                ₹{footerTotals().totalSpent.toLocaleString("en-IN")}
              </p>
            </div>
          </Show>

          {/* Top campaign */}
          <div
            class="rounded-lg p-3
            bg-gray-50       dark:bg-gray-900/60
            border border-transparent dark:border-gray-700/40"
          >
            <p class="text-xs text-gray-400 dark:text-gray-500 mb-1">
              Top campaign
            </p>
            <p class="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
              {displayedCampaigns()[0]?.campaign_name?.split("|")[0]?.trim() ??
                "—"}
            </p>
          </div>
        </div>

        {/* Chart canvas — wrapped in a bg-matched container */}
        <div
          class="relative w-full h-72 sm:h-80
        rounded-lg overflow-hidden
        bg-white dark:bg-gray-900/50
        border border-gray-100 dark:border-gray-700/40
        p-1"
        >
          <canvas
            id="campaignChartCanvas"
            role="img"
            aria-label="Combined bar and line chart: purple bars for leads, orange line for spend per campaign"
          />
        </div>
      </div>

      {/* ================= Lead Quality Insights ================= */}
      <div class="hidden">
        <h3 class="mt-8 mb-4 text-lg font-semibold text-gray-800 dark:text-white">
          Lead Quality Insights
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {/* Total Leads */}
          <div class="p-4 rounded-lg bg-blue-50 dark:bg-gray-800 border border-blue-100 dark:border-gray-700 shadow-sm hover:shadow-md transition">
            <div class="flex items-center justify-between">
              <p class="text-sm text-gray-600 dark:text-gray-400">
                Total Leads
              </p>
              <div class="p-2 bg-blue-100 dark:bg-blue-500 rounded">
                <Users size={18} class="text-blue-500 dark:text-blue-100" />
              </div>
            </div>
            <h3 class="mt-2 text-xl font-semibold text-gray-800 dark:text-white">
              120
            </h3>
          </div>

          {/* Contacted */}
          <div class="p-4 rounded-lg bg-purple-50 dark:bg-gray-800 border border-purple-100 dark:border-gray-700 shadow-sm hover:shadow-md transition">
            <div class="flex items-center justify-between">
              <p class="text-sm text-gray-600 dark:text-gray-400">Contacted</p>
              <div class="p-2 bg-purple-100 dark:bg-purple-500 rounded">
                <PhoneCall
                  size={18}
                  class="text-purple-500 dark:text-purple-100"
                />
              </div>
            </div>
            <h3 class="mt-2 text-xl font-semibold text-gray-800 dark:text-white">
              95
            </h3>
          </div>
          {/* Qualified */}
          <div class="p-4 rounded-lg bg-green-50 dark:bg-gray-800 border border-green-100 dark:border-gray-700 shadow-sm hover:shadow-md transition">
            <div class="flex items-center justify-between">
              <p class="text-sm text-gray-600 dark:text-gray-400">Qualified</p>
              <div class="p-2 bg-green-100 dark:bg-green-500 rounded">
                <BadgeCheck
                  size={18}
                  class="text-green-500 dark:text-green-100"
                />
              </div>
            </div>
            <h3 class="mt-2 text-xl font-semibold text-gray-800 dark:text-white">
              60
            </h3>
          </div>

          {/* Site Visits */}
          <div class="p-4 rounded-lg bg-yellow-50 dark:bg-gray-800 border border-yellow-100 dark:border-gray-700 shadow-sm hover:shadow-md transition">
            <div class="flex items-center justify-between">
              <p class="text-sm text-gray-600 dark:text-gray-400">
                Site Visits
              </p>
              <div class="p-2 bg-yellow-100 dark:bg-yellow-500 rounded">
                <MapPin
                  size={18}
                  class="text-yellow-500 dark:text-yellow-100"
                />
              </div>
            </div>
            <h3 class="mt-2 text-xl font-semibold text-gray-800 dark:text-white">
              30
            </h3>
          </div>

          {/* Bookings */}
          <div class="p-4 rounded-lg bg-pink-50 dark:bg-gray-800 border border-pink-100 dark:border-gray-700 shadow-sm hover:shadow-md transition">
            <div class="flex items-center justify-between">
              <p class="text-sm text-gray-600 dark:text-gray-400">Bookings</p>
              <div class="p-2 bg-pink-100 dark:bg-pink-500 rounded">
                <Home size={18} class="text-pink-500 dark:text-pink-100" />
              </div>
            </div>
            <h3 class="mt-2 text-xl font-semibold text-gray-800 dark:text-white">
              12
            </h3>
          </div>

          {/* Conversion */}
          <div class="p-4 rounded-lg bg-emerald-50 dark:bg-gray-800 border border-emerald-100 dark:border-gray-700 shadow-sm hover:shadow-md transition">
            <div class="flex items-center justify-between">
              <p class="text-sm text-gray-600 dark:text-gray-400">
                Conversion %
              </p>
              <div class="p-2 bg-emerald-100 dark:bg-emerald-500 rounded">
                <TrendingUp
                  size={18}
                  class="text-emerald-500 dark:text-emerald-100"
                />
              </div>
            </div>
            <h3 class="mt-2 text-xl font-semibold text-emerald-600 dark:text-emerald-400">
              10%
            </h3>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ================= SMALL COMPONENTS ================= */

function Info({ label, value, badge }) {
  return (
    <div class="flex flex-col gap-0.5">
      <span class="text-[14px] font-medium uppercase tracking-wider  text-gray-400 dark:text-gray-500">
        {label}
      </span>
      {badge ? (
        <span class="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 w-fit">
          <span class="w-1.5 h-1.5 rounded-full bg-amber-400" />
          {value}
        </span>
      ) : (
        <span class="text-sm font-medium text-gray-900 dark:text-gray-100">
          {value}
        </span>
      )}
    </div>
  );
}
