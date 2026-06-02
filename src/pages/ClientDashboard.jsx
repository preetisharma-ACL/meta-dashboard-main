import { For, Show, createSignal, createMemo } from "solid-js";
import { useParams } from "@solidjs/router";
import { onMount } from "solid-js";
import Swal from "sweetalert2";
import godrejlogo from "../assets/project-logo/dlf.png";
import birlalogo from "../assets/project-logo/godrej.png";
import prestigelogo from "../assets/project-logo/prestige.png";
import { A } from "@solidjs/router";
import { DateRangeFilter } from "../components/DateRangeFilter";
import { fetchProjects, fetchManualBatches } from "../services/dashboard";
import { fetchCampaigns } from "../services/campaigns";
import { fetchCampaignInsights } from "../services/campaigns";
import {
  projectsCache,
  setProjectsCache,
  isCacheStale,
} from "../cacheStore/appStore";
import useRole, { clientRole } from "./../hooks/useRole";

export default function MainDashboard() {
  const [statusFilter, setStatusFilter] = createSignal("all");
  const [searchText, setSearchText] = createSignal("");
  const [selectedColumns, setSelectedColumns] = createSignal([]);
  const [sortType, setSortType] = createSignal("");
  const [fromDate, setFromDate] = createSignal("");
  const [toDate, setToDate] = createSignal("");
  const [viewType, setViewType] = createSignal("table");
  const [userRole, setUserRole] = createSignal("client");
  const [cardRange, setCardRange] = createSignal(null);
  const [manualBatches, setManualBatches] = createSignal([]);
  const [currentPage, setCurrentPage] = createSignal(1);
  const allProjects = () => projectsCache.allProjects;
  const [columnSort, setColumnSort] = createSignal({
    key: "",
    direction: "desc",
  });
  // ── Read from global store via accessors ─────────────────────────────────────
  const projects = () => projectsCache.data;
  const projectInsightsMap = () => projectsCache.insightsMap;
  const loading = () => projectsCache.loading;
  const page = () => projectsCache.meta?.page ?? 1;
  const pageSize = () => projectsCache.meta?.page_size ?? 20;
  const total = () => projectsCache.meta?.total ?? 0;
  const totalPages = () => projectsCache.meta?.total_pages ?? 1;
  const hasNext = () => projectsCache.meta?.has_next ?? false;
  const hasPrev = () => projectsCache.meta?.has_prev ?? false;
  const insightsLoading = () => false; // handled inside loadAllProjectInsights

  const selectedClientName = localStorage.getItem("selectedClientName");

  const { isRetainer, iscpl, ishybrid, isAdmin } = clientRole();

  const textColumns = new Set(["name", "location", "type", "status"]);
  const handleColumnSort = (key) => {
    setColumnSort((prev) => {
      if (prev.key === key) {
        return {
          key,
          direction: prev.direction === "asc" ? "desc" : "asc",
        };
      }
      // text columns default to asc (A→Z), numeric columns default to desc (high→low)
      const defaultDirection = textColumns.has(key) ? "asc" : "desc";
      return { key, direction: defaultDirection };
    });
  };

  const params = useParams();

  // Update onMount to read the role
  // MainDashboard.jsx — update onMount
  onMount(() => {
    const auth = JSON.parse(localStorage.getItem("auth"));
    setUserRole(auth?.role ?? "client");

    // ✅ FIX: always reload when admin has selected a client
    // (cache was busted in Clients.jsx before navigation)
    const isAdminViewingClient =
      auth?.role === "admin" && localStorage.getItem("selectedClientNomenId");

    if (
      isAdminViewingClient ||
      isCacheStale(projectsCache.lastFetched) ||
      projectsCache.allProjects.length === 0
    ) {
      loadData(1);
      loadManualBatches();
      loadAllProjects();
    }
  });

  const loadManualBatches = async () => {
    try {
      const res = await fetchManualBatches();

      const data = Array.isArray(res?.data?.results)
        ? res.data.results
        : Array.isArray(res?.data)
          ? res.data
          : [];

      setManualBatches(data);
    } catch (err) {
      console.error("Failed to load manual batches", err);
    }
  };
  const loadData = async (pageNo = 1, search = "") => {
    try {
      setProjectsCache("loading", true);
      const res = await fetchProjects(pageNo, search);
      const apiData = Array.isArray(res?.data?.results)
        ? res.data.results
        : Array.isArray(res?.data)
          ? res.data
          : [];
      const meta = res?.meta?.pagination;

      const mappedProjects = (apiData || []).map((item) => ({
        id: item.id,
        name: item.name,
        logo: item.logo || "/default-logo.png",
        location: item.city,
        budget: parseFloat(item.budget) || 0,
        leadsgenerated: item.leads_count ?? 0,
        type: item.property_type
          ? item.property_type.charAt(0).toUpperCase() +
            item.property_type.slice(1).toLowerCase()
          : "N/A",
        uploaddocument: item.upload_document ?? null,
        activeCampaigns: item.campaign_count ?? 0,
        pausedCampaigns: item.paused_campaigns ?? 0,
        status: item.status,
        clientRequest: item.client_request ?? null,
        priority: item.priority_label ?? "Standard",
        projectControl: item.project_control ?? "Live",
        url: item.url ?? "/all-campaigns",
        cpl: parseFloat(item.cpl) || 0,

        modifiedCpl: item.modified_cpl ?? null,
        spent: parseFloat(item.total_spend) || 0,
        leadsByDate: item.leads_by_date ?? {},
      }));

      setProjectsCache({
        data: mappedProjects,
        meta: meta ?? projectsCache.meta,
        lastFetched: Date.now(),
        insightsMap: projectsCache.insightsMap,
      });

      // kick off async enrichment (status + insights)
    } catch (err) {
      console.error(err);
    } finally {
      setProjectsCache("loading", false);
    }
  };

  const loadAllProjects = async (search = "") => {
    try {
      let currentPage = 1;
      let hasMore = true;
      let allData = [];

      while (hasMore) {
        const res = await fetchProjects(currentPage, search);

        const apiData = Array.isArray(res?.data?.results)
          ? res.data.results
          : Array.isArray(res?.data)
            ? res.data
            : [];

        const mappedProjects = apiData.map((item) => ({
          id: item.id,
          name: item.name,
          logo: item.logo || "/default-logo.png",
          location: item.city,
          budget: parseFloat(item.budget) || 0,
          leadsgenerated: item.leads_count ?? 0,
          type: item.property_type
            ? item.property_type.charAt(0).toUpperCase() +
              item.property_type.slice(1).toLowerCase()
            : "N/A",
          activeCampaigns: item.campaign_count ?? 0,
          pausedCampaigns: item.paused_campaigns ?? 0,
          status: item.status,
          cpl: parseFloat(item.cpl) || 0,
          modifiedCpl: item.modified_cpl ?? null,
          spent: parseFloat(item.total_spend) || 0,
          leadsByDate: item.leads_by_date ?? {},
        }));

        allData = [...allData, ...mappedProjects];

        hasMore = res?.meta?.pagination?.has_next ?? false;

        currentPage++;
      }

      setProjectsCache("allProjects", allData);
      await deriveProjectStatuses(allData);
      await loadAllProjectInsights(allData);
    } catch (err) {
      console.error("Failed to load all projects", err);
    }
  };
  // Pure helper — returns { from, to } as Date objects for a given value
  const getDateRangeForValue = (value) => {
    const today = new Date();
    let from,
      to = new Date();

    switch (value) {
      case "today":
        from = new Date();
        break;
      case "yesterday":
        from = new Date();
        from.setDate(today.getDate() - 1);
        to = new Date(from);
        break;
      case "last7":
        // Exclude today: to = yesterday, from = 7 days before yesterday
        to = new Date();
        to.setDate(today.getDate() - 1); // yesterday (13 May)
        from = new Date();
        from.setDate(today.getDate() - 7); // 7 May
        break;
      case "thisMonth":
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case "lastMonth":
        from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        to = new Date(today.getFullYear(), today.getMonth(), 0);
        break;
      default:
        from = new Date();
    }

    return { from, to };
  };

  // Format Date → "YYYY-MM-DD" string for fromDate/toDate signals
  const formatDate = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const getCardDateRange = () => {
    if (cardRange()) return getDateRangeForValue(cardRange());
    return { from: fromDate(), to: toDate() }; // fallback to calendar picker
  };

  // Safely read insights/campaigns from the new { campaigns, insights } shape
  // Falls back gracefully if the cache still holds the old flat-array shape.
  const getProjectInsightData = (projectId) => {
    const entry = projectInsightsMap()[projectId];
    if (!entry) return { campaigns: [], insights: [] };
    // Old flat-array shape (cache not yet refreshed)
    if (Array.isArray(entry)) return { campaigns: [], insights: entry };
    return entry;
  };

  const getProjectExtraLeads = (projectId, batches, from, to) => {
    return batches
      .filter((b) => {
        const date = b.uploaded_at?.split("T")[0];

        const matchesProject = Number(b.project) === Number(projectId);

        // no filter selected
        if (!from || !to) {
          return matchesProject;
        }

        return matchesProject && date >= from && date <= to;
      })
      .reduce((sum, b) => sum + Number(b.synthetic_lead_count || 0), 0);
  };

  const cardStats = createMemo(() => {
    const { from, to } = getCardDateRange();
    const result = {};

    for (const project of allProjects()) {
      const { campaigns, insights } = getProjectInsightData(project.id);

      const filtered = insights.filter((d) => {
        if (!from || !to) return true;
        if (!d.date) return false;
        const date = new Date(d.date + "T00:00:00");
        const start = new Date(from);
        start.setHours(0, 0, 0, 0);
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        return date >= start && date <= end;
      });

      const totalLeads = filtered.reduce((s, d) => s + (d.leads || 0), 0);
      const extraLeads = getProjectExtraLeads(
        project.id,
        manualBatches(),
        from,
        to,
      );
      const totalSpent = filtered.reduce(
        (s, d) => s + parseFloat(d.spend || 0),
        0,
      );
      const avgCPL =
        totalLeads > 0 ? parseFloat(totalSpent / totalLeads).toFixed(2) : 0;

      // ✅ Date-range aware campaign counts
      let activeCampaigns, pausedCampaigns;
      if (!from || !to) {
        activeCampaigns = project.activeCampaigns ?? 0;
        pausedCampaigns = project.pausedCampaigns ?? 0;
      } else {
        const activeCampaignIds = new Set(
          filtered
            .filter((d) => d.spend > 0 || d.leads > 0)
            .map((d) => d.campaignId),
        );
        activeCampaigns = activeCampaignIds.size;
        pausedCampaigns = campaigns.filter(
          (c) => !activeCampaignIds.has(c.id),
        ).length;
      }

      result[project.id] = {
        totalLeads,
        extraLeads,
        totalSpent,
        avgCPL,
        activeCampaigns,
        pausedCampaigns,
      };
    }

    return result;
  });
  // ─── REPLACE deriveProjectStatuses in MainDashboard.jsx ──────────────────────
  //
  // Two fixes:
  //  1. The campaigns API returns status "active" | "paused" (lowercase).
  //     The old check (c.status === "active") was correct, but only ran if
  //     fetchCampaigns returned data. With the wrong client_nomen filter (numeric
  //     ID instead of name), it returned 0 campaigns → activeCampaigns = 0 every
  //     time → every project became "paused" incorrectly.
  //     Now that campaigns.js is fixed, this function receives real campaign data.
  //
  //  2. Page-1 with pageSize=1000 is kept, but we now also paginate if needed so
  //     large accounts (>1000 campaigns per project) don't miss any active ones.

  const deriveProjectStatuses = async (projectList) => {
    const statusUpdates = await Promise.all(
      projectList.map(async (project) => {
        try {
          // Fetch all campaigns for this project (large page size avoids
          // a second request in most cases; loop handles edge cases).
          let allCampaigns = [];
          let currentPage = 1;
          let hasMore = true;

          while (hasMore) {
            const res = await fetchCampaigns(currentPage, project.id, "", 1000);
            const batch = res.data?.results ?? res.data ?? [];
            if (!Array.isArray(batch) || batch.length === 0) break;
            allCampaigns = [...allCampaigns, ...batch];
            hasMore = res.meta?.pagination?.has_next ?? false;
            currentPage++;
          }

          // API status field is lowercase: "active" | "paused"
          const activeCampaigns = allCampaigns.filter(
            (c) => c.status === "active",
          ).length;
          const pausedCampaigns = allCampaigns.filter(
            (c) => c.status === "paused",
          ).length;

          return {
            id: project.id,
            // At least one active campaign → project is active
            status: activeCampaigns > 0 ? "active" : "paused",
            activeCampaigns,
            pausedCampaigns,
          };
        } catch (err) {
          console.warn(
            `deriveProjectStatuses: failed for project ${project.id}`,
            err,
          );
          // Fall back to whatever the projects API said; keep original counts.
          return {
            id: project.id,
            status: project.status,
            // project.activeCampaigns is mapped from campaign_count (total),
            // not active-only. Preserve it so the table isn't blank.
            activeCampaigns: project.activeCampaigns,
            pausedCampaigns: project.pausedCampaigns,
          };
        }
      }),
    );

    setProjectsCache("data", (prev) =>
      prev.map((p) => {
        const update = statusUpdates.find((u) => u.id === p.id);
        return update ? { ...p, ...update } : p;
      }),
    );
    setProjectsCache("allProjects", (prev) =>
      prev.map((p) => {
        const update = statusUpdates.find((u) => u.id === p.id);
        return update ? { ...p, ...update } : p;
      }),
    );
  };
  const loadAllProjectInsights = async (projectList) => {
    const result = {};
    await Promise.all(
      projectList.map(async (project) => {
        try {
          let currentPage = 1;
          let allCampaigns = [];
          let hasMore = true;

          while (hasMore) {
            const res = await fetchCampaigns(currentPage, project.id, "", 1000);
            const campaigns = res.data?.results || res.data || [];
            if (!Array.isArray(campaigns) || campaigns.length === 0) break;
            allCampaigns = [...allCampaigns, ...campaigns];
            hasMore = res.meta?.pagination?.has_next ?? false;
            currentPage++;
          }

          if (allCampaigns.length === 0) {
            result[project.id] = { campaigns: [], insights: [] };
            return;
          }
          const insightArrays = await Promise.all(
            allCampaigns.map((c) =>
              fetchCampaignInsights(c.id)
                .then((r) =>
                  (r.data || []).map((insight) => ({
                    ...insight,
                    campaignId: c.id,
                  })),
                )
                .catch(() => []),
            ),
          );
          result[project.id] = {
            campaigns: allCampaigns.map((c) => ({
              id: c.id,
              status: c.status,
            })),
            insights: insightArrays.flat(),
          };
        } catch {
          result[project.id] = { campaigns: [], insights: [] };
        }
      }),
    );
    setProjectsCache("insightsMap", result);
  };

  const normalizeLocalDate = (d) => {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };

  const getLeadsInRange = (leadsByDate, from, to) => {
    if (!from || !to) return 0;
    const start = normalizeLocalDate(from);
    const end = normalizeLocalDate(to);
    return Object.entries(leadsByDate || {}).reduce((total, [date, leads]) => {
      const current = normalizeLocalDate(date);
      return current >= start && current <= end ? total + leads : total;
    }, 0);
  };

  const allProjectStats = createMemo(() => {
    const from = fromDate();
    const to = toDate();
    const result = {};

    for (const project of allProjects()) {
      const { campaigns, insights } = getProjectInsightData(project.id);

      const filtered =
        !from || !to
          ? insights
          : insights.filter((d) => {
              if (!d.date) return false;
              const date = new Date(d.date + "T00:00:00");
              const start = new Date(from);
              start.setHours(0, 0, 0, 0);
              const end = new Date(to);
              end.setHours(23, 59, 59, 999);
              return date >= start && date <= end;
            });

      const totalLeads = filtered.reduce((s, d) => s + (d.leads || 0), 0);
      const extraLeads = getProjectExtraLeads(
        project.id,
        manualBatches(),
        from,
        to,
      );
      const totalSpent = filtered.reduce(
        (s, d) => s + parseFloat(d.spend || 0),
        0,
      );
      const avgCPL =
        totalLeads > 0 ? parseFloat(totalSpent / totalLeads).toFixed(2) : 0;

      //  Campaigns that had any activity in the date window = active; rest = paused
      let activeCampaigns, pausedCampaigns;
      if (!from || !to) {
        // No date range selected → use live counts from project data
        activeCampaigns = project.activeCampaigns ?? 0;
        pausedCampaigns = project.pausedCampaigns ?? 0;
      } else {
        const activeCampaignIds = new Set(
          filtered
            .filter((d) => d.spend > 0 || d.leads > 0)
            .map((d) => d.campaignId),
        );
        activeCampaigns = activeCampaignIds.size;
        // Paused = campaigns that exist but had NO activity in the window
        pausedCampaigns = campaigns.filter(
          (c) => !activeCampaignIds.has(c.id),
        ).length;
      }

      result[project.id] = {
        totalLeads,
        extraLeads,
        totalSpent,
        avgCPL,
        activeCampaigns,
        pausedCampaigns,
      };
    }

    return result;
  });

  const filteredProjects = createMemo(() => {
    let data = [...allProjects()];

    // Status filter
    if (statusFilter() !== "all") {
      data = data.filter((p) => p.status === statusFilter());
    }

    if (searchText().trim()) {
      const query = searchText().toLowerCase().trim();

      data = data.filter((p) =>
        [p.name, p.location, p.type, p.status]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(query)),
      );
    }

    switch (sortType()) {
      case "budget":
        data.sort((a, b) => b.budget - a.budget);
        break;

      case "leads":
        data.sort((a, b) => b.leadsgenerated - a.leadsgenerated);
        break;

      case "activeCampaigns":
        data.sort((a, b) => b.activeCampaigns - a.activeCampaigns);
        break;

      case "cplHigh":
        data.sort((a, b) => b.cpl - a.cpl);
        break;

      case "cplLow":
        data.sort((a, b) => a.cpl - b.cpl);
        break;
    }
    const startIndex = (currentPage() - 1) * pageSize();
    const endIndex = startIndex + pageSize();
    return data.slice(startIndex, endIndex);
  });

  const getSortIcon = (key) => {
    const current = columnSort();
    if (current.key !== key) return "⇅";
    return current.direction === "asc" ? "↑" : "↓";
  };

  const overviewStats = createMemo(() => {
    const all = allProjects();
    const statsMap = allProjectStats();

    // const totalBudget = all.reduce((s, p) => s + (p.budget ?? 0), 0);
    const totalBudget = all.reduce((s, p) => {
      const projectAvgCpl = Number(statsMap[p.id]?.avgCPL || 0);

      // CPL client → budget = CPL * 5
      if (iscpl()) {
        return s + projectAvgCpl * 5;
      }

      return s + (p.budget ?? 0);
    }, 0);
    const activeProjects = all.filter((p) => p.status === "active").length;
    const totalLeads = all.reduce(
      (s, p) => s + (statsMap[p.id]?.totalLeads ?? 0),
      0,
    );
    const totalSpent = all.reduce(
      (s, p) => s + (statsMap[p.id]?.totalSpent ?? 0),
      0,
    );
    const avgCPL =
      totalLeads > 0 ? parseFloat(totalSpent / totalLeads).toFixed(2) : 0;
    // derive from statsMap (date-range aware)
    const activeCampaigns = all.reduce(
      (s, p) => s + (statsMap[p.id]?.activeCampaigns ?? 0),
      0,
    );
    const pausedCampaigns = all.reduce(
      (s, p) => s + (statsMap[p.id]?.pausedCampaigns ?? 0),
      0,
    );

    return {
      totalBudget,
      totalSpent,
      totalLeads,
      avgCPL,
      activeCampaigns,
      pausedCampaigns,
      activeProjects,
    };
  });

  const overviewStatsCards = createMemo(() => {
    const all = allProjects();
    const statsMap = cardStats();

    // const totalBudget = all.reduce((s, p) => s + (p.budget ?? 0), 0);
    const totalBudget = all.reduce((s, p) => {
      const projectAvgCpl = Number(statsMap[p.id]?.avgCPL || 0);

      // CPL client → budget = CPL * 5
      if (iscpl()) {
        return s + projectAvgCpl * 5;
      }

      return s + (p.budget ?? 0);
    }, 0);
    const activeProjects = all.filter((p) => p.status === "active").length;
    const totalLeads = all.reduce(
      (s, p) => s + (statsMap[p.id]?.totalLeads ?? 0),
      0,
    );
    const totalSpent = all.reduce(
      (s, p) => s + (statsMap[p.id]?.totalSpent ?? 0),
      0,
    );

    const serviceChargeSpent = totalSpent + totalSpent * (0.13).toFixed(2);

    const avgCPL = totalLeads > 0 ? (totalSpent / totalLeads).toFixed(2) : 0;
    // derive from statsMap (date-range aware)
    const activeCampaigns = all.reduce(
      (s, p) => s + (statsMap[p.id]?.activeCampaigns ?? 0),
      0,
    );
    const pausedCampaigns = all.reduce(
      (s, p) => s + (statsMap[p.id]?.pausedCampaigns ?? 0),
      0,
    );

    return {
      totalLeads,
      totalSpent,
      serviceChargeSpent,
      avgCPL,
      activeCampaigns,
      pausedCampaigns,
      activeProjects,
      totalBudget,
    };
  });

  const handlePriorityChange = (id, value) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === id ? { ...p, priority: value } : p)),
    );
  };

  const handleClientControlRequest = (id, value) => {
    Swal.fire({
      title: "Are you sure?",
      text: `You want to ${value} this project.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#16a34a",
      cancelButtonColor: "#d33",
      confirmButtonText: "Yes, Send Request",
    }).then((result) => {
      if (result.isConfirmed) {
        Swal.fire("Request Sent!", "Campaign team will review it.", "success");
      }
    });
  };

  const handleClearFilters = () => {
    setStatusFilter("all");
    setSearchText("");
    setSortType("");
    setSelectedColumns([]);
    setFromDate("");
    setToDate("");
  };

  const rangeLabel = createMemo(() => {
    if (!fromDate() || !toDate()) return "";
    const from = new Date(fromDate());
    const to = new Date(toDate());
    from.setHours(0, 0, 0, 0);
    to.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
    if (diffDays === 1) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return from.getTime() === today.getTime() ? "Today" : "Yesterday";
    }
    if (diffDays === 3) return "Last 3 Days";
    if (diffDays === 7) return "Last 7 Days";
    if (diffDays >= 28 && diffDays <= 31) return "Last Month";
    return "Custom Range";
  });

  const getColor = (name) => {
    const colors = [
      "bg-red-100 text-red-600",
      "bg-blue-100 text-blue-600",
      "bg-green-100 text-green-600",
      "bg-yellow-100 text-yellow-600",
    ];
    const index = name ? name.charCodeAt(0) % colors.length : 0;
    return colors[index];
  };

  const TableSkeleton = () => {
    return (
      <tbody>
        <For each={Array(8).fill(0)}>
          {(_, i) => (
            <tr class="border-t animate-pulse">
              <td class="p-3">
                <div class="h-6 w-6 bg-gray-300 dark:bg-gray-700 rounded-full"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-32 bg-gray-300 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-24 bg-gray-300 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-20 bg-gray-300 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-6 w-16 bg-gray-300 dark:bg-gray-700 rounded-full"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-20 bg-gray-300 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-20 bg-gray-300 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-20 bg-gray-300 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-16 bg-gray-300 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-16 bg-gray-300 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-20 bg-gray-300 dark:bg-gray-700 rounded"></div>
              </td>
            </tr>
          )}
        </For>
      </tbody>
    );
  };

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6">
      {/* Section Header */}
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
        <div>
          <h1 class="text-2xl font-semibold mb-1">Active Projects</h1>
          <p class="text-md text-gray-700 dark:text-gray-400">
            All projects with live marketing campaigns.
          </p>
        </div>
        {/* <div class="flex items-center gap-2">
                    <A
                        href="/add-project"
                        class="bg-blue-900 hover:bg-blue-800 transition-all text-white px-4 py-2 rounded-lg text-sm font-medium shadow"
                    >
                        + Add New Project
                    </A>
                </div> */}
        <Show when={userRole() === "admin"}>
          <div class="bg-blue-100 text-blue-700 px-4 py-2 rounded-lg mb-4">
            Viewing Client:
            {selectedClientName}
          </div>
        </Show>
      </div>

      <div class="flex flex-wrap gap-2 mb-5">
        {[
          { label: "Today", value: "today" },
          { label: "Yesterday", value: "yesterday" },
          { label: "Last 7 Days", value: "last7" },
          { label: "This Month", value: "thisMonth" },
          { label: "Last Month", value: "lastMonth" },
        ].map((item) => (
          <button
            onClick={() => {
              setCardRange(item.value);
              // Sync fromDate/toDate so the table matches the cards
              const { from, to } = getDateRangeForValue(item.value);
              setFromDate(formatDate(from));
              setToDate(formatDate(to));
            }}
            class={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 border
            ${
              cardRange() === item.value
                ? "bg-blue-600 text-white border-blue-600 shadow-md"
                : "bg-white text-gray-700 border-gray-300 hover:bg-blue-50 hover:text-blue-700 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ))}

        {/* Clear Button */}
        <button
          onClick={() => {
            setCardRange(null);
            setFromDate(""); // ✅ also clear the table filter
            setToDate("");
          }}
          class="px-4 py-2 rounded-lg text-sm font-medium border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 transition dark:bg-red-900/30 dark:text-red-300 dark:border-red-700 dark:hover:bg-red-900/50"
        >
          Clear
        </button>
      </div>

      {/* Overview Cards Row 1 */}
      <div class="grid md:grid-cols-4 gap-6 mb-10">
        <Show when={isAdmin() || iscpl() || ishybrid()}>
          <div class="bg-blue-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-blue-200 dark:border-gray-600 flex justify-between items-center">
            <div>
              <p class="text-md text-blue-800 dark:text-gray-400">
                Total Budget Allocated
              </p>
              <h3 class="text-xl font-semibold mt-2 dark:text-white">
                {"₹"}
                {overviewStatsCards().totalBudget.toLocaleString("en-IN")}
              </h3>
            </div>
            <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-300">
              <svg
                class="w-5 h-5 text-blue-600 dark:text-blue-800"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
            </div>
          </div>
        </Show>

        <div class="bg-red-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-red-200 dark:border-gray-600 flex justify-between items-center">
          <div>
            <p class="text-md text-red-800 dark:text-gray-400">
              Total Spend Till Date
            </p>
            <h3 class="text-xl font-semibold mt-1 dark:text-white">
              {"₹"}
              {overviewStatsCards().totalSpent.toLocaleString("en-IN")}
            </h3>
          </div>
          <div class="p-3 rounded-lg bg-red-100 dark:bg-red-300">
            <svg
              class="w-5 h-5 text-red-600 dark:text-red-800"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M17 9V7a5 5 0 00-10 0v2" />
              <rect x="3" y="9" width="18" height="11" rx="2" />
            </svg>
          </div>
        </div>

        <div class="bg-green-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-green-200 dark:border-gray-600 flex justify-between items-center">
          <div>
            <p class="text-md text-green-800 dark:text-gray-400">
              Total Leads Generated
            </p>
            <h3 class="text-xl font-semibold mt-1 dark:text-white">
              {overviewStatsCards().totalLeads}
            </h3>
          </div>
          <div class="p-3 rounded-lg bg-green-100 dark:bg-green-300">
            <svg
              class="w-5 h-5 text-green-600 dark:text-green-800"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
        </div>

        <div class="bg-purple-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-purple-200 dark:border-gray-600 flex justify-between items-center">
          <div>
            <p class="text-md text-purple-800 dark:text-gray-400">
              Average CPL
            </p>
            <h3 class="text-xl font-semibold mt-1 dark:text-white">
              {"₹"}
              {overviewStatsCards().avgCPL.toLocaleString("en-IN")}
            </h3>
          </div>
          <div class="p-3 rounded-lg bg-purple-100 dark:bg-purple-300">
            <svg
              class="w-5 h-5 text-purple-600 dark:text-purple-800"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M3 3v18h18" />
              <path d="M18 17l-5-5-4 4-3-3" />
            </svg>
          </div>
        </div>
      </div>

      {/* Overview Cards Row 2 */}
      <div class="grid md:grid-cols-4 gap-6 mb-10">
        <div class="bg-blue-50 dark:bg-gray-800 px-3 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-blue-200 dark:border-gray-600 flex justify-between items-center">
          <div>
            <p class="text-md text-blue-800 dark:text-gray-400">
              Active Campaigns Count
            </p>
            <h3 class="text-xl font-semibold mt-1 dark:text-white">
              {overviewStatsCards().activeCampaigns}
            </h3>
          </div>
          <div class="p-3 rounded-lg bg-blue-100 dark:bg-blue-300">
            <svg
              class="w-5 h-5 text-blue-600 dark:text-blue-800"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 3" />
            </svg>
          </div>
        </div>

        <div class="bg-red-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-red-200 dark:border-gray-600 flex justify-between items-center">
          <div>
            <p class="text-md text-red-800 dark:text-gray-400">
              Active Projects
            </p>
            <h3 class="text-xl font-semibold mt-1 dark:text-white">
              {overviewStatsCards().activeProjects}
            </h3>
          </div>
          <div class="p-3 rounded-lg bg-red-100 dark:bg-red-300">
            <svg
              class="w-5 h-5 text-red-600 dark:text-red-800"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              viewBox="0 0 24 24"
            >
              <path d="M5 13l4 4L19 7" />
            </svg>
          </div>
        </div>
        <Show when={ishybrid()}>
          <div class="bg-orange-50 dark:bg-gray-800 px-5 py-9 gap-4 shadow-sm hover:shadow-lg transition-all rounded-xl border border-orange-200 dark:border-gray-600 flex justify-between items-center">
            <div>
              <p class="text-sm text-orange-800 dark:text-gray-400">
                Spend + 13% Service Charge
              </p>

              <h3 class="text-xl font-semibold mt-1 dark:text-white">
                {"₹"}
                {overviewStatsCards().serviceChargeSpent.toLocaleString(
                  "en-IN",
                )}
                <p class="text-xs text-gray-500 dark:text-gray-400">
                  (excluding GST)
                </p>
              </h3>
            </div>

            <div class="p-3 rounded-lg bg-orange-100 dark:bg-orange-300">
              <svg
                class="w-5 h-5 text-orange-600 dark:text-orange-800"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                viewBox="0 0 24 24"
              >
                <path d="M12 8c-2.2 0-4 1.8-4 4" />
                <path d="M12 8c2.2 0 4 1.8 4 4" />
                <path d="M12 16v.01" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </div>
          </div>
        </Show>
      </div>

      {/* Filters */}
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <div class="relative inline-block">
          <select
            class="border px-3 py-2 pr-10 rounded-lg bg-white dark:bg-gray-800 appearance-none"
            value={statusFilter()}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="active">Active Project</option>
            <option value="paused">Paused Project</option>
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

        <input
          type="text"
          placeholder="Search project..."
          value={searchText()}
          onInput={(e) => {
            const value = e.target.value;
            setSearchText(value);
          }}
          class="border px-3 py-2 rounded-lg w-60 dark:bg-gray-800"
        />

        {/* No arrow characters — use plain text */}
        <div class="relative inline-block">
          <select
            class="border px-3 py-2 pr-10 rounded-lg dark:bg-gray-800 appearance-none"
            value={sortType()}
            onChange={(e) => setSortType(e.target.value)}
          >
            <option value="">Sort by</option>
            <option value="budget">Budget: High to Low</option>
            <option value="leads">Leads: High to Low</option>
            <option value="activeCampaigns">Active Campaigns</option>
            <option value="cplHigh">CPL: High to Low</option>
            <option value="cplLow">CPL: Low to High</option>
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

        <DateRangeFilter
          fromDate={fromDate}
          toDate={toDate}
          setFromDate={setFromDate}
          setToDate={setToDate}
        />

        <button
          onClick={handleClearFilters}
          class="px-4 py-2 rounded-lg border bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 text-md font-medium transition"
        >
          Reset
        </button>
      </div>

      {/* Table */}
      <div class="overflow-x-auto bg-white dark:bg-gray-900 rounded-xl border">
        <table class="w-full text-sm table-auto">
          <thead class="bg-gray-100 dark:bg-gray-800">
            <tr class="[&_th]:text-center [&_th]:cursor-pointer [&_th]:whitespace-nowrap [&_th:first-child]:text-left text-gray-800 dark:text-gray-200">
              <th class="p-3 w-12 md:sticky md:left-0 md:z-20 bg-gray-100 dark:bg-gray-800">
                S.No
              </th>
              <th
                class="p-3 md:sticky md:left-[57px] md:z-20 bg-gray-100 dark:bg-gray-800 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.10)]"
                onClick={() => handleColumnSort("name")}
              >
                Project Name {getSortIcon("name")}
              </th>
              <th class="p-3" onClick={() => handleColumnSort("location")}>
                Location {getSortIcon("location")}
              </th>
              <th class="p-3" onClick={() => handleColumnSort("type")}>
                Type {getSortIcon("type")}
              </th>
              <th class="p-3" onClick={() => handleColumnSort("status")}>
                Status {getSortIcon("status")}
              </th>
              {/* <th class="p-3">Uploaded Document</th> */}
              {/* <th class="p-3">Customer Priority</th> */}
              {/* <th class="p-3">Project Control</th> */}
              <Show when={isAdmin() || iscpl() || ishybrid()}>
                <th class="p-3" onClick={() => handleColumnSort("budget")}>
                  Budget {getSortIcon("budget")}
                </th>
              </Show>
              <th class="p-3" onClick={() => handleColumnSort("totalLeads")}>
                {rangeLabel()} Total Leads {getSortIcon("totalLeads")}
              </th>
              {isAdmin() && <th class="p-3">{rangeLabel()} Extra Leads</th>}
              <th class="p-3" onClick={() => handleColumnSort("totalSpent")}>
                {rangeLabel()} Total Spent {getSortIcon("totalSpent")}
              </th>
              <th class="p-3" onClick={() => handleColumnSort("avgCPL")}>
                {rangeLabel()} AVG CPL {getSortIcon("avgCPL")}
              </th>
              {userRole() === "admin" && (
                <th class="p-3" onClick={() => handleColumnSort("premiumCPL")}>
                  Premium CPL {getSortIcon("premiumCPL")}
                </th>
              )}
              <th
                class="p-3"
                onClick={() => handleColumnSort("activeCampaigns")}
              >
                Active Campaigns {getSortIcon("activeCampaigns")}
              </th>
              <th
                class="p-3"
                onClick={() => handleColumnSort("pausedCampaigns")}
              >
                Paused Campaigns {getSortIcon("pausedCampaigns")}
              </th>
            </tr>
          </thead>
          <Show when={!loading()} fallback={<TableSkeleton />}>
            <tbody>
              {/*  For callback with explicit return */}
              <For each={filteredProjects()}>
                {(project, index) => {
                  const stats = () =>
                    allProjectStats()[project.id] || {
                      totalLeads: 0,
                      totalSpent: 0,
                      avgCPL: 0,
                    }; //  changed

                  return (
                    <tr
                      class={
                        "border-t transition-all duration-300 ease-in-out group " +
                        "[&_td]:text-center [&_td]:px-6 [&_td:first-child]:px-2 " +
                        "[&_td]:whitespace-nowrap [&_td:first-child]:text-left " +
                        (index() % 2 === 0
                          ? "bg-white dark:bg-gray-900 "
                          : "bg-purple-50 dark:bg-gray-900 ")
                      }
                    >
                      <td
                        class={
                          "px-1 py-2 w-12 text-center md:sticky md:left-0 md:z-10 " +
                          " " +
                          (index() % 2 === 0
                            ? "bg-white dark:bg-gray-900"
                            : "bg-purple-50 dark:bg-gray-900")
                        }
                      >
                        <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-xs font-semibold">
                          {(currentPage() - 1) * pageSize() + index() + 1}
                        </span>
                      </td>
                      {/* Project Name */}
                      <td
                        class={
                          "px-2 py-2 md:sticky md:left-[57px] md:z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)] " +
                          " " +
                          (index() % 2 === 0
                            ? "bg-white dark:bg-gray-900"
                            : "bg-purple-50 dark:bg-gray-900")
                        }
                      >
                        <div class="flex items-center gap-2">
                          <div
                            class={`rounded flex items-center justify-center w-10 h-10 font-bold text-lg uppercase ${getColor(project.name)}`}
                          >
                            {project.name ? project.name.charAt(0) : "?"}
                          </div>
                          <A
                            href={`/project/${project.id}`} //  ADD THIS
                            state={{ project }}
                            class="text-purple-700 dark:text-purple-300 font-medium hover:underline transition"
                          >
                            {project.name}
                          </A>
                        </div>
                      </td>

                      {/* Location */}
                      <td class="p-2">{project.location}</td>

                      {/* Type */}
                      <td class="p-2">{project.type}</td>

                      {/* Status Badge */}
                      <td class="px-4 py-3">
                        <span
                          class={
                            "px-3 py-1 text-sm rounded-full capitalize " +
                            (project.status === "active"
                              ? "bg-green-100 text-green-700"
                              : project.status === "paused"
                                ? "bg-yellow-100 text-yellow-700"
                                : "bg-red-100 text-red-700")
                          }
                        >
                          {project.status}
                        </span>
                      </td>

                      {/* Uploaded Document */}
                      {/* <td class="p-2">
                                            {project.uploaddocument ? (
                                                <a
                                                    href={project.uploaddocument}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    class="text-blue-600 dark:text-blue-400 hover:underline text-sm"
                                                >
                                                    View PDF
                                                </a>
                                            ) : (
                                                <span class="text-gray-400">No File</span>
                                            )}
                                        </td> */}

                      {/* Priority */}
                      {/* <td class="p-2">
                                            <select
                                                class="border border-purple-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-purple-100 dark:bg-gray-800 min-w-max"
                                                value={project.priority}
                                                onChange={(e) => handlePriorityChange(project.id, e.target.value)}
                                            >
                                                <option value="Urgent">Urgent</option>
                                                <option value="High">High Priority</option>
                                                <option value="Standard">Standard</option>
                                            </select>
                                        </td> */}

                      {/* Project Control */}
                      {/* <td class="p-2">
                                            <select
                                                class="border border-blue-200 dark:border-gray-600 rounded px-2 py-1 text-sm bg-blue-50 dark:bg-gray-800 min-w-max"
                                                value={
                                                    project.status === "active"
                                                        ? "Live"
                                                        : project.status === "paused"
                                                            ? "Temporary Pause"
                                                            : "Stopped"
                                                }
                                                onChange={(e) => handleClientControlRequest(project.id, e.target.value)}
                                            >
                                                <option value="Live">Live</option>
                                                <option value="Temporary Pause">Temporary Pause</option>
                                                <option value="Stopped">Stopped</option>
                                            </select>
                                        </td> */}

                      {/* Budget */}
                      <Show when={isAdmin() || iscpl() || ishybrid()}>
                        <td class="p-2">
                          {"₹"}
                          {(iscpl()
                            ? Number(stats().avgCPL || 0) * 5
                            : (project.budget ?? 0)
                          ).toLocaleString("en-IN")}
                        </td>
                      </Show>

                      {/* Date-range Leads */}
                      <td class="p-2">{stats().totalLeads}</td>

                      {isAdmin() && (
                        <td class="p-2">+{stats().extraLeads || 0}</td>
                      )}
                      {/* Date-range Spent */}
                      <td class="p-2">
                        {"₹"}
                        {stats().totalSpent.toLocaleString("en-IN")}
                      </td>

                      {/* Date-range AVG CPL */}
                      <td class="p-2">
                        {"₹"}
                        {stats().avgCPL}
                      </td>
                      {userRole() === "admin" && (
                        <td class="p-2">
                          {"₹"}
                          {project.modifiedCpl ?? "—"}
                        </td>
                      )}

                      {/* Active Campaigns */}
                      <td class="p-2 text-center">
                        {stats().activeCampaigns ?? 0}
                      </td>

                      {/* Paused Campaigns */}
                      <td class="p-2 text-center">
                        {stats().pausedCampaigns ?? 0}
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
            <tfoot class="bg-gray-100 dark:bg-gray-800 font-semibold">
              <tr class="[&_td]:text-center [&_td]:px-6 [&_td]:py-3">
                <td class="sticky left-0 bg-gray-100 dark:bg-gray-800 z-20"></td>

                <td class="sticky left-[57px] bg-gray-100 dark:bg-gray-800 z-20 text-left">
                  Total
                </td>

                <td></td>
                <td></td>
                <td></td>

                {/* Budget Total */}
                <Show when={isAdmin() || iscpl() || ishybrid()}>
                  <td>
                    {"₹"}
                    {overviewStats().totalBudget.toLocaleString("en-IN")}
                  </td>
                </Show>

                {/* Leads Total */}
                <td>{overviewStats().totalLeads}</td>

                {isAdmin() && (
                  <td>
                    {filteredProjects().reduce(
                      (sum, project) =>
                        sum + (allProjectStats()[project.id]?.extraLeads || 0),
                      0,
                    )}
                  </td>
                )}

                {/* Spent Total */}
                <td>
                  {"₹"}
                  {overviewStats().totalSpent.toLocaleString("en-IN")}
                </td>

                {/* Avg CPL */}
                <td>
                  {"₹"}
                  {overviewStats().avgCPL}
                </td>

                {userRole() === "admin" && <td></td>}

                {/* Active Campaigns */}
                <td>{overviewStats().activeCampaigns}</td>

                {/* Paused Campaigns */}
                <td> {overviewStats().pausedCampaigns}</td>
              </tr>
            </tfoot>
          </Show>
        </table>
      </div>
      <div class="flex items-center justify-between mt-5 flex-wrap gap-3">
        <span class="text-sm text-gray-500">
          {total() === 0
            ? "No results"
            : `Showing ${(currentPage() - 1) * pageSize() + 1}–${Math.min(page() * pageSize(), total())} of ${total()} results`}
        </span>

        <div class="flex items-center gap-2">
          <button
            onClick={() =>
              currentPage() > 1 && setCurrentPage(currentPage() - 1)
            }
            disabled={currentPage() === 1}
            class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 disabled:opacity-35 disabled:cursor-default transition-colors"
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
            Page {currentPage()} of{" "}
            {Math.ceil(allProjects().length / pageSize())}
          </span>

          <button
            onClick={() =>
              currentPage() < Math.ceil(allProjects().length / pageSize()) &&
              setCurrentPage(currentPage() + 1)
            }
            disabled={
              currentPage() >= Math.ceil(allProjects().length / pageSize())
            }
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
      {/* Empty State */}
      <Show when={projects().length === 0}>
        <div class="mt-8 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 p-6 text-center">
          <p class="text-sm font-medium text-gray-700 dark:text-gray-300">
            No active projects found
          </p>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Your live projects will appear here once campaigns are started
          </p>
        </div>
      </Show>
    </section>
  );
}
