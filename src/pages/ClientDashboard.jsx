// ─────────────────────────────────────────────────────────────────────────────
// FULL v4 DESIGN IMPLEMENTATION — UI layer only.
//
// New sections added (matching realty-assistant-dashboard-v4.html):
//   1. Hero "ledger" — big spend figure + budget pacing rail + side stats
//   2. "Needs attention" signal cards (derived from live data by display rules)
//   3. CPL-by-project bar chart + lead-share band + campaign health
//   4. AI Daily Brief (highlights derived from live data; issues log preview)
//   5. Funnel strip (Proposed — illustrative numbers, flag-gated)
//
// HARD GUARANTEES:
//   • No new API calls. No changes to existing signals, memos, effects,
//     loaders, role gates, sorting, pagination, or cache behaviour.
//   • All new values are DISPLAY-ONLY createMemo derivations from data the
//     component already computes (allProjects / cardStats / overviewStatsCards).
//   • The seven old KPI cards are not lost — every metric now lives in the
//     hero section (mapping documented next to the hero JSX).
//   • Existing font family/sizes kept (Tailwind default scale, no new fonts).
//
// Palette (project theme): navy #14233A · crimson #AC2334 · line #E2E8F1
//   muted #54657E · faint #8593A8 · green #15966A/#E9F7F1
//   amber #B07A14/#FBF3E2 · steel #3E6FB0/#ECF2FA · thead/zebra #F8FAFC/#FAFBFD
// ─────────────────────────────────────────────────────────────────────────────
import {
  For,
  Show,
  createSignal,
  createMemo,
  createEffect,
  on,
} from "solid-js";
import { useParams } from "@solidjs/router";
import { onMount } from "solid-js";
import { useLocation } from "@solidjs/router";
import Swal from "sweetalert2";
import godrejlogo from "../assets/project-logo/dlf.png";
import birlalogo from "../assets/project-logo/godrej.png";
import prestigelogo from "../assets/project-logo/prestige.png";
import { A } from "@solidjs/router";
import { DateRangeFilter } from "../components/DateRangeFilter";
import useColumnSort from "../components/Columnsorting";
import { fetchProjects, fetchManualBatches } from "../services/dashboard";
import { fetchCampaigns } from "../services/campaigns";
import { fetchBulkCampaignInsights } from "../services/campaigns";
import { fetchAllCampaigns } from "../services/campaigns";
import Avatar from "../components/common/Avatar";
import CountUp from "../components/CountUp";
import ClientAIInsightButton from "../components/ClientAIInsightButton";
import {
  projectsCache,
  setProjectsCache,
  isCacheStale,
  isAllProjectsCacheStale,
  dashboardFilter,
  setDashboardFilter,
} from "../cacheStore/appStore";
import useRole, { clientRole } from "./../hooks/useRole";

// Guards against stale in-flight loads overwriting the cache after the
// dashboard context switches (e.g. admin leaves a client dashboard and returns
// to their own Main Dashboard). Every async loader captures this token when it
// starts and only commits its results to the cache if the token is still
// current. Bumping the token effectively cancels older in-flight loads so a
// slow client-data request can no longer clobber freshly loaded admin data.
let activeLoadToken = 0;
const bumpLoadToken = () => ++activeLoadToken;

// ── Design-section toggles (UI only) ─────────────────────────────────────────
// The funnel needs impressions/CTR/CPM (not fetched anywhere yet) and the AI
// brief's issue timestamps need the diagnostics service. Until those exist,
// both render with the same "Proposed / Illustrative" tags the approved design
// uses. Flip to false to hide them entirely.
const SHOW_PROPOSED_SECTIONS = true;

// Display thresholds for the "Needs attention" rules (presentation only).
const HOT_CPL_RATIO = 1.4; // CPL > 140% of portfolio average → "running hot"

export default function MainDashboard() {
  const [statusFilter, setStatusFilter] = createSignal("all");
  const [searchText, setSearchText] = createSignal("");
  const [selectedColumns, setSelectedColumns] = createSignal([]);
  const [sortType, setSortType] = createSignal("");
  // Date filter is backed by a persisted store (survives page navigation) so the
  // picker and the range-scoped data stay in sync until the user explicitly
  // clears it. Same accessor/setter shape as a signal, so call sites are unchanged.
  const fromDate = () => dashboardFilter.fromDate;
  const toDate = () => dashboardFilter.toDate;
  const setFromDate = (v) => setDashboardFilter("fromDate", v);
  const setToDate = (v) => setDashboardFilter("toDate", v);
  const [viewType, setViewType] = createSignal("table");
  const [userRole, setUserRole] = createSignal("client");
  const cardRange = () => dashboardFilter.cardRange;
  const setCardRange = (v) => setDashboardFilter("cardRange", v);
  const [manualBatches, setManualBatches] = createSignal([]);
  const [currentPage, setCurrentPage] = createSignal(1);
  const allProjects = () => projectsCache.allProjects;

  // ── Premium date range sent to the API (premium_metrics is server-computed
  //    per window). Clamped: floor 2026-04-01, ceiling today — matches the
  //    ProjectDetails ledger so the numbers line up. ──────────────────────────
  const PREMIUM_FLOOR = "2026-04-01";
  const premiumRangeStart = () => {
    const f = fromDate();
    return f && f > PREMIUM_FLOOR ? f : PREMIUM_FLOOR;
  };
  const premiumRangeEnd = () => {
    const today = new Date().toISOString().split("T")[0];
    const t = toDate();
    return t && t < today ? t : today;
  };

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

  // True only when the store actually holds swept campaign/insight data to
  // render. The persisted cache can carry a fresh `lastFetchedAll` timestamp but
  // an EMPTY insightsMap — e.g. admin's map is too large for sessionStorage and
  // the write silently fails (QuotaExceededError). In that case a reload must
  // re-run the sweep even though the staleness gate thinks the cache is fresh,
  // otherwise spend/leads/CPL render as ₹0 until the 5-min TTL expires.
  const hasRenderedCampaignData = () =>
    projectsCache.insightsMap &&
    Object.keys(projectsCache.insightsMap).length > 0;

  // True while the ledger's spend/leads figures are still being swept in — i.e.
  // projects exist but their campaign insights haven't populated yet. Drives the
  // CountUp "rolling number" so the ledger never shows a static 0 during load.
  const ledgerLoading = () =>
    allProjects().length > 0 && !hasRenderedCampaignData();

  // Recompute on navigation so the "Viewing Client" badge clears when the
  // client context is removed on the Main Dashboard.
  const selectedClientNomen = () => {
    location.pathname; // track route changes
    return localStorage.getItem("selectedClientNomen");
  };

  // Client nomen id for the client-level AI insight call. Tracks route changes
  // (same as selectedClientNomen above) so it clears when the client context is
  // removed on the Main Dashboard.
  const selectedClientNomenId = () => {
    location.pathname; // track route changes
    return localStorage.getItem("selectedClientNomenId");
  };

  const { isRetainer, iscpl, ishybrid, isAdmin } = clientRole();
  const { handleSort, getSortIcon, sortData, resetSort } = useColumnSort();

  const params = useParams();
  const location = useLocation();

  // ── Reactively clear client context when navigating back to the Main Dashboard ──
  // Both "/" and "/:client-nomen-name" render THIS same component, so SolidJS
  // reuses the instance on navigation and onMount does NOT re-run. Without this
  // effect, clicking "Dashboard" in the sidebar after viewing a client would keep
  // showing the previously selected client's cached data.
  createEffect(
    on(
      () => location.pathname,
      (pathname, prevPathname) => {
        // First run is handled by onMount — skip to avoid a double load.
        if (prevPathname === undefined) return;

        const auth = JSON.parse(localStorage.getItem("auth") || "{}");
        if (auth?.role !== "admin" || pathname !== "/") return;

        const wasViewingClient = localStorage.getItem("selectedClientNomenId");

        // Clear any selected-client context so only admin's own data is used.
        localStorage.removeItem("selectedClientNomen");
        localStorage.removeItem("selectedClientNomenId");
        localStorage.removeItem("selectedClientName");

        // Only bust cache + reload if we were actually viewing a client,
        // otherwise leave the already-loaded admin dashboard untouched.
        if (wasViewingClient) {
          // Cancel the client's still-in-flight loads so they can't overwrite
          // the admin data we're about to fetch.
          bumpLoadToken();

          setProjectsCache("lastFetched", 0);
          setProjectsCache("lastFetchedAll", 0);
          setProjectsCache("allProjects", []);
          setProjectsCache("insightsMap", {});
          setProjectsCache("data", []);

          loadData(1);
          if (auth?.role === "admin") {
            loadManualBatches();
          }
          loadAllProjects();
        }
      },
    ),
  );

  // Update onMount to read the role
  // MainDashboard.jsx — update onMount
  onMount(() => {
    // New mount → cancel any loads still in flight from a previous context.
    bumpLoadToken();

    const auth = JSON.parse(localStorage.getItem("auth"));

    // Admin returning to their own dashboard — clear client context AND cache
    if (auth?.role === "admin" && window.location.pathname === "/") {
      const wasViewingClient = localStorage.getItem("selectedClientNomenId");

      localStorage.removeItem("selectedClientNomen");
      localStorage.removeItem("selectedClientNomenId");
      localStorage.removeItem("selectedClientName");

      // ✅ If admin was viewing a client, bust the cache so admin's own
      // data reloads — otherwise the client's projects stay visible
      if (wasViewingClient) {
        setProjectsCache("lastFetched", 0);
        setProjectsCache("lastFetchedAll", 0);
        setProjectsCache("allProjects", []);
        setProjectsCache("insightsMap", {});
        setProjectsCache("data", []);
      }
    }

    setUserRole(auth?.role ?? "client");

    loadData(1);
    if (auth?.role === "admin") {
      loadManualBatches();
    }

    // Fire the sweep when the cache is stale OR when there's nothing to render
    // (fresh timestamp but empty insightsMap — see hasRenderedCampaignData).
    // This guarantees data loads on every reload while still skipping the
    // refetch when valid data is already present (cache benefit preserved).
    if (isAllProjectsCacheStale() || !hasRenderedCampaignData()) {
      loadAllProjects();
    }
  });

  const auth = JSON.parse(localStorage.getItem("auth") || "{}");

  const serviceChargePercent = Number(auth?.serviceCharge ?? 13);

  const serviceChargeRate = serviceChargePercent / 100;

  const loadManualBatches = async () => {
    const token = activeLoadToken;
    try {
      const res = await fetchManualBatches();
      if (token !== activeLoadToken) return;

      const data = Array.isArray(res?.data?.results)
        ? res.data.results
        : Array.isArray(res?.data)
          ? res.data
          : [];

      setManualBatches(data);
      console.log("manual batches:", manualBatches());
    } catch (err) {
      console.error("Failed to load manual batches", err);
    }
  };
  const loadData = async (pageNo = 1, search = "") => {
    const token = activeLoadToken;
    try {
      setProjectsCache("loading", true);
      const res = await fetchProjects(pageNo, search);
      // Context switched while this request was in flight → discard its result.
      if (token !== activeLoadToken) return;
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
        // Seed status counts to 0 — deriveProjectStatuses fills them from c.status.
        // campaign_count is a TOTAL, not an active count; seeding it here flashed
        // the whole project total in the "Active Campaigns" column until derive ran.
        activeCampaigns: 0,
        completedCampaigns: 0,
        pausedCampaigns: 0,
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
      if (token === activeLoadToken) setProjectsCache("loading", false);
    }
  };

  const loadAllProjects = async (search = "") => {
    const token = activeLoadToken;
    try {
      let currentPage = 1;
      let hasMore = true;
      let allData = [];

      while (hasMore) {
        const res = await fetchProjects(currentPage, search);
        // Context switched mid-pagination → stop and discard.
        if (token !== activeLoadToken) return;

        const apiData = Array.isArray(res?.data?.results)
          ? res.data.results
          : Array.isArray(res?.data)
            ? res.data
            : [];

        // ← ADD THIS TEMPORARILY
        console.log("Sample project from API:", apiData[0]);
        console.log("modified_cpl value:", apiData[0]?.modified_cpl);

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
          // Seed status counts to 0 — deriveProjectStatuses fills them from
          // c.status. campaign_count is a TOTAL, not an active count.
          activeCampaigns: 0,
          completedCampaigns: 0,
          pausedCampaigns: 0,
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

      if (token !== activeLoadToken) return;
      setProjectsCache("allProjects", allData);
      setProjectsCache("lastFetchedAll", Date.now());
      // Fetch each project's campaigns ONCE here, then reuse them for insights
      // so we don't fetch the same campaigns twice (was: two overlapping waves).
      const campaignsByProject = await deriveProjectStatuses(allData, token);
      await loadAllProjectInsights(allData, token, campaignsByProject);
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
    if (!entry) return { campaigns: [], insights: [], range: null };
    // Old flat-array shape (cache not yet refreshed)
    if (Array.isArray(entry))
      return { campaigns: [], insights: entry, range: null };
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
      const { campaigns, insights, range } = getProjectInsightData(project.id);

      const inRange = (rows, rFrom, rTo) =>
        rows.filter((d) => {
          if (!rFrom || !rTo) return true;
          if (!d.date) return false;
          const date = new Date(d.date + "T00:00:00");
          const start = new Date(rFrom);
          start.setHours(0, 0, 0, 0);
          const end = new Date(rTo);
          end.setHours(23, 59, 59, 999);
          return date >= start && date <= end;
        });

      const filtered = inRange(insights, from, to);

      // Real leads filtered by the stamped campaign range so they stay in
      // lockstep with extra_leads (no flicker during a date-change refetch).
      const leadsRange = range ?? { from, to };
      const totalLeads = inRange(
        insights,
        leadsRange.from,
        leadsRange.to,
      ).reduce((s, d) => s + (d.leads || 0), 0);
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

      const resolvedCpl = totalLeads > 0 ? Number(avgCPL) : 1500;

      // ✅ Date-range aware campaign counts
      // Campaign status counts are classified by c.status — a campaign's
      // active/paused/completed state is NOT date-dependent, so the date range
      // must not drive it. The old range path counted "active" as "had spend or
      // leads in range", which mislabelled a now-paused campaign that spent
      // earlier in the range as active (e.g. DholeraEvent: 11 paused → 11 active).
      // Same rule as deriveProjectStatuses: live = not paused and not completed.
      const activeCampaigns = campaigns.filter(
        (c) => c.status !== "paused" && c.status !== "completed",
      ).length;
      const completedCampaigns = campaigns.filter(
        (c) => c.status === "completed",
      ).length;
      const pausedCampaigns = campaigns.filter(
        (c) => c.status === "paused",
      ).length;

      // Same rule as the table (allProjectStats): clients fold synthetic leads
      // into Total Leads via the client-accessible campaign.extra_leads field;
      // admins keep real-only here (synthetic in the separate column).
      const extraFromCampaigns = campaigns.reduce(
        (s, c) => s + Number(c.extra_leads ?? 0),
        0,
      );

      result[project.id] = {
        totalLeads: isAdmin() ? totalLeads : totalLeads + extraFromCampaigns,
        extraLeads,
        totalSpent,
        avgCPL,
        resolvedCpl,
        activeCampaigns,
        completedCampaigns,
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

  // Roll a project's status up from its campaigns:
  //   • any campaign still running (not paused, not completed) → "active"
  //   • otherwise, every campaign completed (≥1 campaign)      → "completed"
  //   • otherwise (all paused, or a paused/completed mix)       → "paused"
  const deriveStatus = (camps) => {
    if (!Array.isArray(camps) || camps.length === 0) return "paused";
    const running = camps.filter(
      (c) => c.status !== "paused" && c.status !== "completed",
    ).length;
    if (running > 0) return "active";
    const completed = camps.filter((c) => c.status === "completed").length;
    if (completed === camps.length) return "completed";
    return "paused";
  };

  const deriveProjectStatuses = async (
    projectList,
    token = activeLoadToken,
  ) => {
    // ── Admin fast path ──────────────────────────────────────────────────────
    // Admins load every client's projects (hundreds), so the per-project loop
    // below turns into an N+1 storm (one /campaigns/?project=N request each).
    // Instead fetch ALL campaigns in ONE date-scoped paginated sweep and group
    // them by project_id locally — identical result, ~1 request instead of N.
    // The client path below is left exactly as-is so its behaviour is unchanged.
    if (isAdmin()) {
      const campaignsByProject = {};
      for (const project of projectList) campaignsByProject[project.id] = [];

      let sweepOk = true;
      try {
        const allCampaigns = await fetchAllCampaigns(
          10000,
          premiumRangeStart(),
          premiumRangeEnd(),
        );
        for (const c of allCampaigns) {
          const pid = c.project_id;
          if (pid == null) continue;
          if (!campaignsByProject[pid]) campaignsByProject[pid] = [];
          campaignsByProject[pid].push(c);
        }
      } catch (err) {
        sweepOk = false;
        console.warn("deriveProjectStatuses: bulk campaign sweep failed", err);
      }

      const statusUpdates = projectList.map((project) => {
        const camps = campaignsByProject[project.id] || [];
        // Sweep failed → mirror the old per-project catch branch: keep whatever
        // the projects API already reported so the table isn't blanked.
        if (!sweepOk) {
          return {
            id: project.id,
            status: project.status,
            activeCampaigns: project.activeCampaigns,
            completedCampaigns: project.completedCampaigns,
            pausedCampaigns: project.pausedCampaigns,
          };
        }
        // A campaign is "live" when it is anything other than paused — the same
        // rule the campaigns table / ProjectDetails use (status !== "paused").
        // Using a strict === "active" here mislabels projects as paused when
        // their live campaigns carry a non-"active" status (e.g. in_review).
        // Live only — completed campaigns are counted separately, not as active.
        const activeCampaigns = camps.filter(
          (c) => c.status !== "paused" && c.status !== "completed",
        ).length;
        const completedCampaigns = camps.filter(
          (c) => c.status === "completed",
        ).length;
        const pausedCampaigns = camps.filter(
          (c) => c.status === "paused",
        ).length;
        return {
          id: project.id,
          status: deriveStatus(camps),
          activeCampaigns,
          completedCampaigns,
          pausedCampaigns,
        };
      });

      if (token !== activeLoadToken) return campaignsByProject;
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
      return campaignsByProject;
    }

    const perProject = await Promise.all(
      projectList.map(async (project) => {
        try {
          // Fetch all campaigns for this project (large page size avoids
          // a second request in most cases; loop handles edge cases).
          let allCampaigns = [];
          let currentPage = 1;
          let hasMore = true;

          while (hasMore) {
            const res = await fetchCampaigns(
              currentPage,
              project.id,
              "",
              1000,
              premiumRangeStart(),
              premiumRangeEnd(),
            );
            const batch = res.data?.results ?? res.data ?? [];
            if (!Array.isArray(batch) || batch.length === 0) break;
            allCampaigns = [...allCampaigns, ...batch];
            hasMore = res.meta?.pagination?.has_next ?? false;
            currentPage++;
          }

          // "Live" = not paused (matches the campaigns table / ProjectDetails).
          // A strict === "active" check mislabels a project as paused when its
          // live campaigns report a non-"active" status (e.g. in_review).
          // Live only — completed campaigns are counted separately, not active.
          const activeCampaigns = allCampaigns.filter(
            (c) => c.status !== "paused" && c.status !== "completed",
          ).length;
          const completedCampaigns = allCampaigns.filter(
            (c) => c.status === "completed",
          ).length;
          const pausedCampaigns = allCampaigns.filter(
            (c) => c.status === "paused",
          ).length;

          return {
            // status update committed to the cache (campaigns NOT spread in)
            status: {
              id: project.id,
              // Active if any campaign is running; completed only when EVERY
              // campaign is completed; otherwise paused.
              status: deriveStatus(allCampaigns),
              activeCampaigns,
              completedCampaigns,
              pausedCampaigns,
            },
            // raw campaigns handed back so the insights pass can reuse them
            campaigns: allCampaigns,
          };
        } catch (err) {
          console.warn(
            `deriveProjectStatuses: failed for project ${project.id}`,
            err,
          );
          // Fall back to whatever the projects API said; keep original counts.
          return {
            status: {
              id: project.id,
              status: project.status,
              // project.activeCampaigns is mapped from campaign_count (total),
              // not active-only. Preserve it so the table isn't blank.
              activeCampaigns: project.activeCampaigns,
              completedCampaigns: project.completedCampaigns,
              pausedCampaigns: project.pausedCampaigns,
            },
            campaigns: [],
          };
        }
      }),
    );

    const statusUpdates = perProject.map((p) => p.status);
    const campaignsByProject = {};
    perProject.forEach((p) => {
      campaignsByProject[p.status.id] = p.campaigns;
    });

    if (token !== activeLoadToken) return campaignsByProject;
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

    // Return the campaigns so loadAllProjectInsights can skip re-fetching them.
    return campaignsByProject;
  };

  const loadAllProjectInsights = async (
    projectList,
    token = activeLoadToken,
    campaignsByProject = null,
  ) => {
    const result = {};
    const projectCampaigns = {};

    // 1. Resolve campaigns per project (reuse or fetch)
    if (isAdmin() && !campaignsByProject) {
      // Admin fast path: when called standalone (no precomputed campaigns),
      // fetch ALL campaigns in ONE sweep and group by project_id locally,
      // instead of one fetchCampaigns(project.id) per project (was 311 calls).
      let allCampaigns = [];
      try {
        allCampaigns = await fetchAllCampaigns(10000, fromDate(), toDate());
      } catch (err) {
        console.error("loadAllProjectInsights: admin sweep failed", err);
      }
      const byProj = {};
      for (const c of allCampaigns) {
        const pid = c.project_id;
        if (pid == null) continue;
        if (!byProj[pid]) byProj[pid] = [];
        byProj[pid].push(c);
      }
      for (const project of projectList) {
        projectCampaigns[project.id] = byProj[project.id] || [];
      }
    } else {
      // Client path / reuse path (unchanged): reuse precomputed campaigns, or
      // fall back to a per-project fetch when none were supplied.
      await Promise.all(
        projectList.map(async (project) => {
          let allCampaigns = campaignsByProject
            ? campaignsByProject[project.id]
            : undefined;

          if (allCampaigns === undefined) {
            let currentPage = 1;
            allCampaigns = [];
            let hasMore = true;
            while (hasMore) {
              const res = await fetchCampaigns(
                currentPage,
                project.id,
                "",
                1000,
              );
              const campaigns = res.data?.results || res.data || [];
              if (!Array.isArray(campaigns) || campaigns.length === 0) break;
              allCampaigns = [...allCampaigns, ...campaigns];
              hasMore = res.meta?.pagination?.has_next ?? false;
              currentPage++;
            }
          }

          projectCampaigns[project.id] = allCampaigns || [];
        }),
      );
    }

    // Build the per-project result entry for every project (same shape as
    // before): mapped campaigns + empty insights (filled by the bulk call) +
    // the date range these campaigns/extra_leads belong to.
    for (const project of projectList) {
      const allCampaigns = projectCampaigns[project.id] || [];
      result[project.id] = {
        campaigns: allCampaigns.map((c) => ({
          id: c.id,
          status: c.status,
          // Backend-computed synthetic/extra leads, client-accessible via the
          // /api/campaigns/ endpoint (same field Project Details uses). Used to
          // fold synthetic leads into the client's Total Leads.
          extra_leads: Number(c.extra_leads ?? 0),
          // server-computed premium (marked-up) figures for this campaign
          premium_metrics: c.premium_metrics,
        })),
        insights: [],
        // Date range these campaigns/extra_leads were fetched for. Real leads
        // are filtered by this so they stay in lockstep with extra_leads.
        range: { from: fromDate(), to: toDate() },
      };
    }

    // ── Step 3: Build campaign lookup ────────────────────────────────────────
    // (Premium CPL now comes straight off each campaign's server-computed
    // premium_metrics — no markup-config history / reconstruction needed.)
    const campaignById = {};
    const allCampaignIds = [];

    for (const project of projectList) {
      for (const c of projectCampaigns[project.id] || []) {
        campaignById[String(c.id)] = {
          campaign: c,
          projectId: project.id,
        };
        allCampaignIds.push(c.id);
      }
    }
    // 4. ONE bulk insights call for all campaigns (raw, date-filtered later)
    if (allCampaignIds.length > 0) {
      try {
        const bulk = await fetchBulkCampaignInsights(allCampaignIds);
        const rows = bulk.data || [];

        for (const row of rows) {
          if (row.is_manual) continue;
          const entry = campaignById[String(row.campaign_id)];
          if (!entry) continue;
          result[entry.projectId].insights.push({
            ...row,
            campaignId: entry.campaign.id,
          });
        }
      } catch (err) {
        console.error("Failed to load bulk campaign insights", err);
      }
    }

    if (token !== activeLoadToken) return;
    setProjectsCache("insightsMap", result);
  };

  // ── Date-reactive premium refetch ──────────────────────────────────────────
  // premium_metrics is computed server-side per date range, so when the table
  // date filter changes we re-pull each project's campaigns (range-scoped) and
  // patch just their premium_metrics into the cache. Raw columns already
  // re-scope client-side from insights, so we deliberately skip the heavy
  // bulk-insights pass here.
  const refreshPremiumForRange = async () => {
    const token = activeLoadToken;
    const projects = allProjects();
    if (!projects.length) return;

    const start = premiumRangeStart();
    const end = premiumRangeEnd();

    // ── Admin fast path ──────────────────────────────────────────────────────
    // This runs on every date-filter change. For admins (hundreds of projects)
    // the per-project loop below is the main cause of the slow re-load. Replace
    // it with ONE date-scoped sweep grouped by project_id locally. Client path
    // (the Promise.all below) is left unchanged.
    if (isAdmin()) {
      let allCampaigns = [];
      try {
        allCampaigns = await fetchAllCampaigns(10000, start, end);
      } catch (err) {
        console.error("refreshPremiumForRange: bulk sweep failed", err);
        return;
      }

      if (token !== activeLoadToken) return;

      const campsByProject = {};
      for (const c of allCampaigns) {
        const pid = c.project_id;
        if (pid == null) continue;
        if (!campsByProject[pid]) campsByProject[pid] = [];
        campsByProject[pid].push({
          id: c.id,
          status: c.status,
          extra_leads: Number(c.extra_leads ?? 0),
          premium_metrics: c.premium_metrics,
        });
      }

      // Patch every project's campaigns in-place, preserving its insights and
      // stamping the range these campaigns belong to (same as the client path).
      setProjectsCache("insightsMap", (prev) => {
        const next = { ...prev };
        for (const project of projects) {
          const existing = next?.[project.id];
          const insights =
            existing && !Array.isArray(existing) ? existing.insights : [];
          next[project.id] = {
            campaigns: campsByProject[project.id] || [],
            insights,
            range: { from: fromDate(), to: toDate() },
          };
        }
        return next;
      });
      return;
    }

    await Promise.all(
      projects.map(async (project) => {
        try {
          let all = [];
          let currentPage = 1;
          let hasMore = true;
          while (hasMore) {
            const res = await fetchCampaigns(
              currentPage,
              project.id,
              "",
              1000,
              start,
              end,
            );
            const batch = res.data?.results ?? res.data ?? [];
            if (!Array.isArray(batch) || batch.length === 0) break;
            all = [...all, ...batch];
            hasMore = res.meta?.pagination?.has_next ?? false;
            currentPage++;
          }

          if (token !== activeLoadToken) return;

          const camps = all.map((c) => ({
            id: c.id,
            status: c.status,
            // Preserve date-scoped synthetic leads so the client's Total Leads
            // stays correct after a date-filter change (these campaigns replace
            // the ones loaded at mount).
            extra_leads: Number(c.extra_leads ?? 0),
            premium_metrics: c.premium_metrics,
          }));

          // Patch the project's campaigns in-place, preserving its insights.
          // Stamp the range these campaigns belong to so real leads filter by
          // the same window (campaigns + range update atomically here).
          setProjectsCache("insightsMap", (prev) => {
            const existing = prev?.[project.id];
            const insights =
              existing && !Array.isArray(existing) ? existing.insights : [];
            return {
              ...prev,
              [project.id]: {
                campaigns: camps,
                insights,
                range: { from: fromDate(), to: toDate() },
              },
            };
          });
        } catch (err) {
          console.error(
            "Failed to refresh premium for project",
            project.id,
            err,
          );
        }
      }),
    );
  };

  // Re-run on date-filter change only (defer skips the initial load, which the
  // mount pipeline already covers with the same clamped range).
  createEffect(
    on(
      [fromDate, toDate],
      () => {
        refreshPremiumForRange();
      },
      { defer: true },
    ),
  );

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
      const { campaigns, insights, range } = getProjectInsightData(project.id);

      const inRange = (rows, rFrom, rTo) =>
        !rFrom || !rTo
          ? rows
          : rows.filter((d) => {
              if (!d.date) return false;
              const date = new Date(d.date + "T00:00:00");
              const start = new Date(rFrom);
              start.setHours(0, 0, 0, 0);
              const end = new Date(rTo);
              end.setHours(23, 59, 59, 999);
              return date >= start && date <= end;
            });

      const filtered = inRange(insights, from, to);

      // Real leads are filtered by the range the loaded campaigns/extra_leads
      // belong to (stamped in the cache), so the real (insights) and synthetic
      // (extra_leads) halves of Total Leads always move together — no flicker
      // while a date-change campaign refetch is in flight.
      const leadsRange = range ?? { from, to };
      const totalLeads = inRange(
        insights,
        leadsRange.from,
        leadsRange.to,
      ).reduce((s, d) => s + (d.leads || 0), 0);
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
      const resolvedCpl = totalLeads > 0 ? Number(avgCPL) : 1500;

      // ── Premium CPL: aggregate from the server-computed premium_metrics ──
      // Same formula as the ProjectDetails footer (Project Ledger):
      //   Σ premium spend ÷ Σ premium leads  (never an average of per-campaign
      //   CPLs). Campaigns without premium_metrics contribute nothing.
      let premiumSpend = 0;
      let premiumLeads = 0;

      for (const c of campaigns) {
        const pm = c.premium_metrics;
        if (pm && pm.spend != null && pm.leads_count != null) {
          premiumSpend += Number(pm.spend);
          premiumLeads += Number(pm.leads_count);
        }
      }

      const modifiedCpl =
        premiumLeads > 0
          ? Number((premiumSpend / premiumLeads).toFixed(2))
          : null;
      // ─────────────────────────────────────────────────────────────────────

      // Campaign status counts are classified by c.status — a campaign's
      // active/paused/completed state is NOT date-dependent, so the date range
      // must not drive it. The old range path counted "active" as "had spend or
      // leads in range", which mislabelled a now-paused campaign that spent
      // earlier in the range as active (e.g. DholeraEvent: 11 paused → 11 active).
      // Same rule as deriveProjectStatuses: live = not paused and not completed.
      const activeCampaigns = campaigns.filter(
        (c) => c.status !== "paused" && c.status !== "completed",
      ).length;
      const completedCampaigns = campaigns.filter(
        (c) => c.status === "completed",
      ).length;
      const pausedCampaigns = campaigns.filter(
        (c) => c.status === "paused",
      ).length;

      // Synthetic/extra leads for the CLIENT total come from the backend-
      // computed campaign.extra_leads (client-accessible, authoritative, matches
      // billing) — NOT the admin-only manual-batches endpoint.
      const extraFromCampaigns = campaigns.reduce(
        (s, c) => s + Number(c.extra_leads ?? 0),
        0,
      );

      result[project.id] = {
        // Admin sees real leads here (synthetic in its own "Extra Leads"
        // column, sourced from manualBatches). Clients have no such column, so
        // synthetic leads are folded into Total Leads via campaign.extra_leads.
        totalLeads: isAdmin() ? totalLeads : totalLeads + extraFromCampaigns,
        extraLeads,
        totalSpent,
        avgCPL,
        modifiedCpl, // ← now properly computed
        resolvedCpl,
        activeCampaigns,
        completedCampaigns,
        pausedCampaigns,
      };
    }

    return result;
  });

  const filteredProjects = createMemo(() => {
    let data = allProjects().map((project) => {
      const stats = allProjectStats()[project.id] || {};

      return {
        ...project,
        totalLeads: stats.totalLeads || 0,
        totalSpent: stats.totalSpent || 0,
        avgCPL: Number(stats.avgCPL || 0),
        activeCampaigns: stats.activeCampaigns || 0,
        completedCampaigns: stats.completedCampaigns || 0,
        pausedCampaigns: stats.pausedCampaigns || 0,
        modifiedCpl: stats.modifiedCpl ?? null, // ← add this
      };
    });

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

    data = sortData(data);
    const startIndex = (currentPage() - 1) * pageSize();
    const endIndex = startIndex + pageSize();
    return data.slice(startIndex, endIndex);
  });

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
    const completedCampaigns = all.reduce(
      (s, p) => s + (statsMap[p.id]?.completedCampaigns ?? 0),
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
      completedCampaigns,
      pausedCampaigns,
      activeProjects,
    };
  });

  const overviewStatsCards = createMemo(() => {
    const all = allProjects();
    const statsMap = cardStats();

    // const totalBudget = all.reduce((s, p) => s + (p.budget ?? 0), 0);
    const totalBudget = all.reduce((s, p) => {
      if (iscpl()) {
        const leads = statsMap[p.id]?.totalLeads ?? 0;
        const avgCpl = Number(statsMap[p.id]?.avgCPL || 0);
        return s + (leads > 0 ? avgCpl * 5 : 1500);
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

    const serviceChargeSpent =
      totalSpent + totalSpent * serviceChargeRate.toFixed(2);

    // Admin view: spend + 18% GST (client view uses serviceChargeSpent above)
    const gstSpent = totalSpent + totalSpent * 0.18;

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
      gstSpent,
      avgCPL,
      activeCampaigns,
      pausedCampaigns,
      activeProjects,
      totalBudget,
    };
  });

  // ════════════════════════════════════════════════════════════════════════
  // DISPLAY-ONLY DERIVATIONS for the new design sections.
  // Everything below reads from memos that already exist (allProjects,
  // cardStats, overviewStatsCards). No fetches, no cache writes, no changes
  // to any existing calculation.
  // ════════════════════════════════════════════════════════════════════════

  // ₹ formatter for the new sections (display only)
  const inr = (n) => `₹${Math.round(Number(n) || 0).toLocaleString("en-IN")}`;

  // Project rows joined with their card-range stats (the same stats the old
  // KPI cards used), reused by hero / signals / charts below.
  const projectCardRows = createMemo(() => {
    const map = cardStats();
    return allProjects().map((p) => ({
      ...p,
      s: map[p.id] || {
        totalLeads: 0,
        totalSpent: 0,
        avgCPL: 0,
        activeCampaigns: 0,
        pausedCampaigns: 0,
      },
    }));
  });

  // Budget pacing for the hero rail. The "Today · Day X of Y" tick and the
  // run-rate note only make sense for the current-month view, mirroring the
  // existing "Current Month Allocation" badge condition.
  const heroPacing = createMemo(() => {
    const s = overviewStatsCards();
    const budget = Number(s.totalBudget) || 0;
    const spent = Number(s.totalSpent) || 0;
    const utilPct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const calendarPct = (dayOfMonth / daysInMonth) * 100;
    const isMonthView =
      cardRange() === "thisMonth" || (!cardRange() && !fromDate() && !toDate());
    const runRate = dayOfMonth > 0 ? spent / dayOfMonth : 0;
    const projected = runRate * daysInMonth;
    const behindPts = calendarPct - utilPct;
    return {
      budget,
      spent,
      utilPct,
      dayOfMonth,
      daysInMonth,
      calendarPct,
      isMonthView,
      runRate,
      projected,
      behindPts,
    };
  });

  // Best / worst CPL among projects that actually generated leads.
  const cplExtremes = createMemo(() => {
    const rows = projectCardRows().filter((r) => r.s.totalLeads > 0);
    if (rows.length === 0) return { best: null, worst: null };
    let best = rows[0];
    let worst = rows[0];
    for (const r of rows) {
      if (Number(r.s.avgCPL) < Number(best.s.avgCPL)) best = r;
      if (Number(r.s.avgCPL) > Number(worst.s.avgCPL)) worst = r;
    }
    return { best, worst };
  });

  // CPL-by-project chart data: top 8 projects by spend (keeps the chart
  // readable for large accounts; the rest stay in the ledger table).
  const cplChart = createMemo(() => {
    const avg = Number(overviewStatsCards().avgCPL) || 0;
    const rows = [...projectCardRows()]
      .sort((a, b) => b.s.totalSpent - a.s.totalSpent)
      .slice(0, 8);
    const maxCpl =
      Math.max(avg, ...rows.map((r) => Number(r.s.avgCPL) || 0)) * 1.15 || 1;
    return {
      avg,
      avgPos: avg > 0 ? (avg / maxCpl) * 100 : 0,
      extra: Math.max(allProjects().length - rows.length, 0),
      rows: rows.map((r) => {
        const cpl = Number(r.s.avgCPL) || 0;
        const hasLeads = r.s.totalLeads > 0;
        const ratio = avg > 0 && hasLeads ? cpl / avg : 1;
        return {
          id: r.id,
          name: r.name,
          cpl: r.s.avgCPL,
          hasLeads,
          width: hasLeads ? (cpl / maxCpl) * 100 : 2,
          tone: !hasLeads
            ? "none"
            : ratio < 0.85
              ? "green"
              : ratio <= 1.25
                ? "steel"
                : "red",
          deltaPct: avg > 0 && hasLeads ? Math.round((ratio - 1) * 100) : null,
        };
      }),
    };
  });

  // Lead-share band: top 4 projects + "Others".
  const leadShare = createMemo(() => {
    const rows = [...projectCardRows()].sort(
      (a, b) => b.s.totalLeads - a.s.totalLeads,
    );
    const totalLeads = rows.reduce((s, r) => s + r.s.totalLeads, 0);
    const top = rows.slice(0, 4);
    const others = rows.slice(4).reduce((s, r) => s + r.s.totalLeads, 0);
    const palette = ["#3E6FB0", "#7FA1CD", "#15966A", "#AC2334", "#D4DDE9"];
    const items = top.map((r, i) => ({
      name: r.name,
      count: r.s.totalLeads,
      pct: totalLeads > 0 ? (r.s.totalLeads / totalLeads) * 100 : 0,
      color: palette[i],
    }));
    if (others > 0)
      items.push({
        name: "Others",
        count: others,
        pct: totalLeads > 0 ? (others / totalLeads) * 100 : 0,
        color: palette[4],
      });
    return { totalLeads, items };
  });

  // ── Proposed funnel: real Impression→Lead metrics, summed per project ──────
  // Aggregates the same date-range-filtered insight rows the KPI cards use
  // (impressions / reach / clicks / leads / spend) across every project, then
  // derives CPM, frequency, CTR, CPC, click-to-lead and avg CPL. Display-only:
  // no new fetches — reads from insightsMap already loaded for the cards.
  const funnelStats = createMemo(() => {
    const { from, to } = getCardDateRange();
    let impressions = 0;
    let reach = 0;
    let clicks = 0;
    let leads = 0;
    let spend = 0;

    for (const project of allProjects()) {
      const { insights } = getProjectInsightData(project.id);
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

      for (const d of filtered) {
        impressions += Number(d.impressions || 0);
        reach += Number(d.reach || 0);
        clicks += Number(d.clicks || 0);
        leads += Number(d.leads || 0);
        spend += parseFloat(d.spend || 0);
      }
    }

    return {
      impressions,
      reach,
      clicks,
      leads,
      spend,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      frequency: reach > 0 ? impressions / reach : 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      clickToLead: clicks > 0 ? (leads / clicks) * 100 : 0,
      cpl: leads > 0 ? spend / leads : 0,
      hasReach: reach > 0,
      hasData: impressions > 0 || clicks > 0 || leads > 0,
    };
  });

  // Compact Indian-style number (21,40,000 → "21.4L", 1,20,00,000 → "1.2Cr").
  const compactIN = (n) => {
    const num = Number(n) || 0;
    if (num >= 1e7) return `${(num / 1e7).toFixed(1)}Cr`;
    if (num >= 1e5) return `${(num / 1e5).toFixed(1)}L`;
    return num.toLocaleString("en-IN");
  };

  // Funnel cells driven by the live aggregates above. "—" where a denominator
  // is missing (e.g. reach not returned by the Insights API) so nothing reads
  // as NaN / ₹0.00 on empty data.
  const funnelCells = createMemo(() => {
    const f = funnelStats();
    return [
      {
        l: "Impressions",
        v: f.impressions > 0 ? compactIN(f.impressions) : "—",
        s: f.impressions > 0 ? `CPM ₹${f.cpm.toFixed(2)}` : "No impressions",
      },
      // {
      //   l: "Reach",
      //   v: f.hasReach ? compactIN(f.reach) : "—",
      //   s: f.hasReach ? `Frequency ${f.frequency.toFixed(2)}` : "Not synced",
      // },
      {
        l: "Link clicks",
        v: f.clicks > 0 ? f.clicks.toLocaleString("en-IN") : "—",
        s:
          f.clicks > 0
            ? `CTR ${f.ctr.toFixed(2)}% · CPC ₹${f.cpc.toFixed(2)}`
            : "No clicks",
      },
      {
        l: "Leads",
        v: f.leads > 0 ? f.leads.toLocaleString("en-IN") : "—",
        s:
          f.clicks > 0
            ? `Click to lead ${f.clickToLead.toFixed(2)}%`
            : `${f.leads.toLocaleString("en-IN")} total`,
      },
      {
        l: "Cost per lead",
        v: f.leads > 0 ? `₹${f.cpl.toFixed(2)}` : "—",
        s: f.spend > 0 ? `From ${inr(f.spend)} spend` : "No spend",
      },
    ];
  });

  // "Needs attention" signal cards (max 3), built by display rules:
  //   paused project with idle budget → amber · CPL far above average → red
  //   live campaigns but zero spend in range → red
  const signals = createMemo(() => {
    const out = [];
    const avg = Number(overviewStatsCards().avgCPL) || 0;
    const rows = projectCardRows();

    const paused = rows
      .filter((r) => r.status === "paused" && r.s.pausedCampaigns > 0)
      .sort(
        (a, b) =>
          (b.budget || 0) - b.s.totalSpent - ((a.budget || 0) - a.s.totalSpent),
      );
    for (const r of paused) {
      const idle = Math.max((r.budget || 0) - r.s.totalSpent, 0);
      out.push({
        tone: "amber",
        tag: "Paused",
        title: `${r.name} has gone dark`,
        body: (
          <>
            All <b>{r.s.pausedCampaigns} campaigns</b> are paused.
            {r.budget > 0 && (
              <>
                {" "}
                <b>{inr(idle)}</b> of its {inr(r.budget)} budget is sitting
                idle.
              </>
            )}
          </>
        ),
      });
    }

    const hot = rows
      .filter(
        (r) =>
          r.s.totalLeads > 0 &&
          avg > 0 &&
          Number(r.s.avgCPL) > avg * HOT_CPL_RATIO,
      )
      .sort((a, b) => Number(b.s.avgCPL) - Number(a.s.avgCPL));
    for (const r of hot) {
      out.push({
        tone: "red",
        tag: "CPL running hot",
        title: `${r.name} is paying ${Math.round((Number(r.s.avgCPL) / avg - 1) * 100)}% over`,
        body: (
          <>
            Buying leads at <b>₹{r.s.avgCPL}</b> against a portfolio average of
            ₹{avg.toFixed(2)}, across{" "}
            <b>{r.s.activeCampaigns} live campaigns</b>. A creative and audience
            review could recover real money here.
          </>
        ),
      });
    }

    const zero = rows.filter(
      (r) => r.s.activeCampaigns > 0 && r.s.totalSpent === 0,
    );
    for (const r of zero) {
      out.push({
        tone: "red",
        tag: "Zero delivery",
        title: `${r.name} is not spending`,
        body: (
          <>
            <b>{r.s.activeCampaigns}</b> campaign
            {r.s.activeCampaigns > 1 ? "s are" : " is"} live but{" "}
            <b>₹0 spend and 0 leads</b> are recorded in this range. Check ad
            review status, ad set delivery and the account spend limit.
          </>
        ),
      });
    }

    return out.slice(0, 3);
  });

  // AI Daily Brief — "What went well" derived from live data; the issues log
  // reuses the same signal rules. Tagged as a preview until the Claude API
  // service supplies the real narrative + timestamps.
  const briefHighlights = createMemo(() => {
    const out = [];
    const { best, worst } = cplExtremes();
    const avg = Number(overviewStatsCards().avgCPL) || 0;
    if (best && avg > 0) {
      const pct = Math.round((1 - Number(best.s.avgCPL) / avg) * 100);
      if (pct > 0)
        out.push({
          tone: "green",
          body: (
            <>
              <b>{best.name} is the portfolio's bargain.</b> CPL of ₹
              {best.s.avgCPL} is {pct}% under the account average, with{" "}
              {best.s.activeCampaigns} campaign
              {best.s.activeCampaigns === 1 ? "" : "s"} delivering.
            </>
          ),
        });
    }
    const volume = [...projectCardRows()].sort(
      (a, b) => b.s.totalLeads - a.s.totalLeads,
    )[0];
    if (volume && volume.s.totalLeads > 0) {
      const share =
        leadShare().totalLeads > 0
          ? Math.round((volume.s.totalLeads / leadShare().totalLeads) * 100)
          : 0;
      out.push({
        tone: "green",
        body: (
          <>
            <b>
              {volume.name} leads on volume with{" "}
              {volume.s.totalLeads.toLocaleString("en-IN")} leads
            </b>{" "}
            in this range, {share}% of everything the account generated.
          </>
        ),
      });
    }
    if (worst && avg > 0 && Number(worst.s.avgCPL) > avg * 1.25) {
      out.push({
        tone: "amber",
        body: (
          <>
            <b>{worst.name} needs a creative refresh.</b> CPL of ₹
            {worst.s.avgCPL} across {worst.s.activeCampaigns} live campaign
            {worst.s.activeCampaigns === 1 ? "" : "s"} is the account's
            costliest buying right now.
          </>
        ),
      });
    }
    return out;
  });

  const briefIssues = createMemo(() =>
    signals().map((sig) => ({
      state: sig.tag === "Paused" ? "prog" : "new",
      stateLabel: sig.tag === "Paused" ? "In progress" : "New",
      title: sig.title,
      body: sig.body,
    })),
  );

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
    resetSort();
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
            <tr class="border-t border-[#E2E8F1] dark:border-gray-700 animate-pulse">
              <td class="p-3">
                <div class="h-6 w-6 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </td>
              <td class="p-3">
                <div class="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </td>
            </tr>
          )}
        </For>
      </tbody>
    );
  };

  // Reusable section eyebrow (design language)
  const Eyebrow = (props) => (
    <div class="flex items-center gap-3 mb-4 text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334]">
      <span>
        {props.label}
        <Show when={props.soft}>
          <span class="text-[#8593A8] dark:text-gray-400 font-bold normal-case tracking-normal">
            {" "}
            · {props.soft}
          </span>
        </Show>
      </span>
      <span class="flex-1 h-px bg-[#D4DDE9] dark:bg-gray-700"></span>
    </div>
  );

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* Section Header */}
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Reporting · Live campaigns
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Active Projects
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400">
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
        <Show when={userRole() === "admin" && selectedClientNomen()}>
          <div class="inline-flex items-center gap-2.5 bg-[#14233A] text-white px-5 py-2.5 rounded-full mb-4 text-sm font-medium shadow-sm">
            <span class="w-2 h-2 rounded-full bg-[#3DD598]"></span>
            Viewing Client:
            {selectedClientNomen()}
          </div>
        </Show>
      </div>

      <div class="flex flex-wrap gap-2 mb-6">
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
            class={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border
            ${
              cardRange() === item.value
                ? "bg-[#AC2334] text-white border-[#AC2334] shadow-md"
                : "bg-gray-50 text-[#54657E] border-[#E2E8F1] hover:border-[#AC2334]/40 hover:text-[#AC2334] dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white"
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
          class="px-4 py-2 rounded-full text-sm font-bold border border-[#AC2334]/25 text-[#AC2334] bg-[#FBEEF0] hover:bg-[#AC2334] hover:text-white transition dark:bg-red-900/30 dark:text-red-300 dark:border-red-700 dark:hover:bg-red-900/50"
        >
          Clear
        </button>
      </div>

      {/* Client-level AI insight (admin + Tier 1 only; self-gates on canUseAI).
          Only rendered when a specific client is in context — its narrative
          summarizes ALL of that client's campaigns for the selected range. */}
      <Show when={selectedClientNomenId()}>
        <ClientAIInsightButton
          clientId={selectedClientNomenId()}
          startDate={fromDate()}
          endDate={toDate()}
        />
      </Show>

      {/* ════════ HERO LEDGER ════════
          Replaces the two KPI card rows; every old metric is mapped here:
            Spend → hero figure · Budget → "of ₹X allocated" + rail
            Leads / Avg CPL / Campaigns / Service charge → side stats
            Active Projects → eyebrow count                                  */}
      {/* ════════ HERO LEDGER ════════
          Replaces the two KPI card rows; every old metric is mapped here:
            Spend → hero figure · Budget → "of ₹X allocated" + rail
            Leads / Avg CPL / Campaigns / Service charge → side stats
            Active Projects → eyebrow count

          LAYOUT NOTE: CPL clients have no spend figure and no budget rail, so
          the left "1fr" column would render empty and leave a gap. For that
          case we drop the two-column grid and lay the stats out full-width in a
          responsive row instead, so there is no dead space.                 */}
      <Eyebrow
        label="The ledger"
        soft={`${overviewStatsCards().activeProjects} of ${allProjects().length} projects live`}
      />

      {/* ── CPL client: full-width balanced stat row (no empty left column) ── */}
      <Show when={iscpl()}>
        <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-7 mb-8">
          <div class="grid grid-cols-1 sm:grid-cols-3 sm:divide-x divide-[#E2E8F1] dark:divide-gray-700">
            {/* Leads generated */}
            <div class="py-2 sm:py-1 sm:px-6 first:sm:pl-0">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Leads generated
              </p>
              <p class="text-3xl font-bold text-[#14233A] dark:text-white mt-1.5">
                <CountUp
                  value={overviewStatsCards().totalLeads}
                  loading={ledgerLoading()}
                />
              </p>
              <Show
                when={heroPacing().isMonthView && heroPacing().dayOfMonth > 0}
              >
                <p class="text-xs text-[#54657E] dark:text-gray-400 mt-1">
                  {Math.round(
                    overviewStatsCards().totalLeads / heroPacing().dayOfMonth,
                  ).toLocaleString("en-IN")}{" "}
                  a day on average
                </p>
              </Show>
            </div>

            {/* Average CPL */}
            <div class="py-2 sm:py-1 sm:px-6 border-t sm:border-t-0 border-[#E2E8F1] dark:border-gray-700">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Average CPL
              </p>
              <p class="text-3xl font-bold text-[#14233A] dark:text-white mt-1.5">
                {"₹"}
                {overviewStatsCards().avgCPL.toLocaleString("en-IN")}
              </p>
              <Show when={cplExtremes().best && cplExtremes().worst}>
                <p class="text-xs text-[#54657E] dark:text-gray-400 mt-1">
                  best ₹{cplExtremes().best.s.avgCPL} · worst ₹
                  {cplExtremes().worst.s.avgCPL}
                </p>
              </Show>
            </div>

            {/* Campaigns */}
            <div class="py-2 sm:py-1 sm:px-6 border-t sm:border-t-0 border-[#E2E8F1] dark:border-gray-700">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Campaigns
              </p>
              <p class="text-3xl font-bold mt-1.5">
                <span class="text-[#15966A]">
                  {overviewStatsCards().activeCampaigns}
                </span>{" "}
                <span class="text-sm font-bold text-[#8593A8]">live</span>
                {" · "}
                <span class="text-[#B07A14]">
                  {overviewStatsCards().pausedCampaigns}
                </span>{" "}
                <span class="text-sm font-bold text-[#8593A8]">paused</span>
              </p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-1">
                {overviewStatsCards().activeCampaigns +
                  overviewStatsCards().pausedCampaigns}{" "}
                total across {allProjects().length} projects
              </p>
            </div>
          </div>
        </div>
      </Show>

      {/* ── Non-CPL clients: original two-column ledger (spend + rail + stats) ── */}
      <Show when={!iscpl()}>
        <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-8 mb-8 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 lg:gap-12 items-start">
          <div>
            <p class="text-sm text-[#54657E] dark:text-gray-400 font-medium mb-1">
              Total spend till date
            </p>
            <h2 class="text-xl sm:text-2xl font-bold tracking-tight text-gray-700 dark:text-white">
              {"₹"}
              <CountUp
                value={overviewStatsCards().totalSpent}
                loading={ledgerLoading()}
              />
            </h2>

            <Show when={isAdmin() || ishybrid()}>
              <p class="text-sm text-[#54657E] dark:text-gray-400 mt-2">
                of{" "}
                <b class="text-[#14233A] dark:text-white">
                  {"₹"}
                  {overviewStatsCards().totalBudget.toLocaleString("en-IN")}
                </b>{" "}
                allocated
                <Show when={!cardRange() && !fromDate() && !toDate()}>
                  <span class="inline-flex ml-2 px-2.5 py-0.5 text-xs font-bold rounded-full bg-[#ECF2FA] text-[#3E6FB0] dark:bg-blue-900/40 dark:text-blue-300 align-middle">
                    Current Month Allocation
                  </span>
                </Show>
                {" · "}
                {heroPacing().utilPct.toFixed(1)}% utilised
              </p>

              {/* Pacing rail */}
              <div class="mt-9">
                <div class="relative h-4 rounded-full bg-[#EAEFF6] dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700">
                  <div
                    class="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#AC2334] to-[#C9374B] transition-all duration-700"
                    style={`width:${heroPacing().utilPct}%`}
                  ></div>
                  <Show when={heroPacing().isMonthView}>
                    <div
                      class="absolute -top-2 -bottom-2 w-0.5 bg-[#14233A] dark:bg-gray-50 rounded"
                      style={`left:${heroPacing().calendarPct}%`}
                    >
                      <span class="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-[#14233A] dark:text-white">
                        Today · Day {heroPacing().dayOfMonth} of{" "}
                        {heroPacing().daysInMonth}
                      </span>
                    </div>
                  </Show>
                </div>
                <div class="flex justify-between mt-2 text-xs font-medium text-[#8593A8] dark:text-gray-500">
                  <span>₹0</span>
                  <span>
                    {"₹"}
                    {overviewStatsCards().totalBudget.toLocaleString("en-IN")}
                  </span>
                </div>

                <Show
                  when={heroPacing().isMonthView && heroPacing().budget > 0}
                >
                  <p class="mt-4 text-sm text-[#54657E] dark:text-gray-400 max-w-xl">
                    <Show
                      when={Math.abs(heroPacing().behindPts) > 1}
                      fallback={
                        <>
                          Spend is{" "}
                          <b class="text-[#15966A]">tracking on pace</b> with
                          the calendar at the current run rate of{" "}
                          {inr(heroPacing().runRate)} a day.
                        </>
                      }
                    >
                      Spend is tracking{" "}
                      <b class="text-[#AC2334]">
                        {Math.abs(heroPacing().behindPts).toFixed(1)} points{" "}
                        {heroPacing().behindPts > 0 ? "behind" : "ahead of"} the
                        calendar
                      </b>
                      . At the current run rate of {inr(heroPacing().runRate)} a
                      day, the month closes near {inr(heroPacing().projected)}
                      {heroPacing().projected <= heroPacing().budget ? (
                        <>
                          , leaving roughly{" "}
                          {inr(heroPacing().budget - heroPacing().projected)} of
                          the allocation unspent.
                        </>
                      ) : (
                        <>
                          , about{" "}
                          {inr(heroPacing().projected - heroPacing().budget)}{" "}
                          over the allocation if nothing changes.
                        </>
                      )}
                    </Show>
                  </p>
                </Show>
              </div>
            </Show>
          </div>

          {/* Hero side stats */}
          <div class="flex flex-col border-t lg:border-t-0 lg:border-l border-[#E2E8F1] dark:border-gray-700 pt-4 lg:pt-0 lg:pl-9">
            <div class="py-3.5 border-b border-[#E2E8F1] dark:border-gray-700">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Leads generated
              </p>
              <p class="text-xl font-bold text-[#14233A] dark:text-white mt-1">
                <CountUp
                  value={overviewStatsCards().totalLeads}
                  loading={ledgerLoading()}
                />
              </p>
              <Show
                when={heroPacing().isMonthView && heroPacing().dayOfMonth > 0}
              >
                <p class="text-xs text-gray-700 dark:text-gray-400 mt-0.5">
                  {Math.round(
                    overviewStatsCards().totalLeads / heroPacing().dayOfMonth,
                  ).toLocaleString("en-IN")}{" "}
                  a day on average
                </p>
              </Show>
            </div>
            <div class="py-3.5 border-b border-[#E2E8F1] dark:border-gray-700">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Average CPL
              </p>
              <p class="text-xl font-bold text-gray-700 dark:text-white mt-1">
                {"₹"}
                {overviewStatsCards().avgCPL.toLocaleString("en-IN")}
              </p>
              <Show when={cplExtremes().best && cplExtremes().worst}>
                <p class="text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                  best ₹{cplExtremes().best.s.avgCPL} · worst ₹
                  {cplExtremes().worst.s.avgCPL}
                </p>
              </Show>
            </div>
            <Show when={!isAdmin()}>
              <div class="py-3.5 border-b border-[#E2E8F1] dark:border-gray-700">
                <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                  Spend + {serviceChargePercent}% service charge
                </p>
                <p class="text-xl font-bold text-gray-700 dark:text-white mt-1">
                  {"₹"}
                  {overviewStatsCards().serviceChargeSpent.toLocaleString(
                    "en-IN",
                  )}
                </p>
                <p class="text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                  (excluding GST)
                </p>
              </div>
            </Show>
            <Show when={isAdmin()}>
              <div class="py-3.5 border-b border-[#E2E8F1] dark:border-gray-700">
                <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                  Spend + 18% GST
                </p>
                <p class="text-xl font-bold text-gray-700 dark:text-white mt-1">
                  {"₹"}
                  <CountUp
                    value={overviewStatsCards().gstSpent}
                    loading={ledgerLoading()}
                  />
                </p>
                <p class="text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                  (including 18% GST)
                </p>
              </div>
            </Show>
            <div class="py-3.5">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Campaigns
              </p>
              <p class="text-xl font-bold mt-1">
                <span class="text-[#15966A]">
                  {overviewStatsCards().activeCampaigns}
                </span>{" "}
                <span class="text-sm font-bold text-[#8593A8]">live</span>
                {" · "}
                <span class="text-[#B07A14]">
                  {overviewStatsCards().pausedCampaigns}
                </span>{" "}
                <span class="text-sm font-bold text-[#8593A8]">paused</span>
              </p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                {overviewStatsCards().activeCampaigns +
                  overviewStatsCards().pausedCampaigns}{" "}
                total across {allProjects().length} projects
              </p>
            </div>
          </div>
        </div>
      </Show>
      {/* ════════ PROJECT LEDGER ════════ */}
      <Eyebrow label="Project ledger" soft="full reference" />

      {/* Filters */}
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <div class="relative inline-block">
          <select
            class="border border-[#E2E8F1] dark:border-gray-600 px-3 py-2 pr-10 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 appearance-none focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
            value={statusFilter()}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All</option>
            <option value="active">Active Project</option>
            <option value="paused">Paused Project</option>
            <option value="completed">Completed Project</option>
          </select>

          <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
            <svg
              class="w-4 h-4 text-[#8593A8]"
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
          class="border border-[#E2E8F1] dark:border-gray-600 px-3 py-2 rounded-lg w-60 bg-gray-50 dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
        />

        {/* No arrow characters — use plain text */}
        <div class="relative inline-block">
          <select
            class="border border-[#E2E8F1] dark:border-gray-600 px-3 py-2 pr-10 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 appearance-none focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
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
              class="w-4 h-4 text-[#8593A8]"
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
          class="px-4 py-2 rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-200 hover:bg-[#F6F9FC] dark:hover:bg-gray-600 text-sm font-medium transition"
        >
          Reset
        </button>
      </div>

      {/* Table */}
      <div class="overflow-x-auto bg-gray-50 dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
        <table class="w-full text-sm table-auto">
          <thead class="bg-[#F8FAFC] dark:bg-gray-800">
            <tr class="[&_th]:text-center [&_th]:cursor-pointer [&_th]:whitespace-nowrap [&_th:first-child]:text-left [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:font-bold text-[#54657E] dark:text-gray-300 border-b border-[#D4DDE9] dark:border-gray-700">
              <th class="p-3 w-12 md:sticky md:left-0 md:z-20 bg-[#F8FAFC] dark:bg-gray-800">
                S.No
              </th>
              <th
                class="p-3 md:sticky md:left-[57px] md:z-20 bg-[#F8FAFC] dark:bg-gray-800 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.10)]"
                onClick={() => handleSort("name")}
              >
                Project Name {getSortIcon("name")}
              </th>
              <th class="p-3" onClick={() => handleSort("location")}>
                Location {getSortIcon("location")}
              </th>
              <th class="p-3" onClick={() => handleSort("type")}>
                Type {getSortIcon("type")}
              </th>
              <th class="p-3" onClick={() => handleSort("status")}>
                Status {getSortIcon("status")}
              </th>
              {/* <th class="p-3">Uploaded Document</th> */}
              {/* <th class="p-3">Customer Priority</th> */}
              {/* <th class="p-3">Project Control</th> */}
              <Show when={ishybrid()}>
                <th class="p-3" onClick={() => handleSort("budget")}>
                  Budget {getSortIcon("budget")}
                </th>
              </Show>
              <th class="p-3" onClick={() => handleSort("totalLeads")}>
                {rangeLabel()} Total Leads {getSortIcon("totalLeads")}
              </th>
              {isAdmin() && <th class="p-3">{rangeLabel()} Extra Leads</th>}
              <Show when={!iscpl()}>
                <th class="p-3" onClick={() => handleSort("totalSpent")}>
                  {rangeLabel()} Total Spent {getSortIcon("totalSpent")}
                </th>
              </Show>
              <th class="p-3" onClick={() => handleSort("avgCPL")}>
                {rangeLabel()} AVG CPL {getSortIcon("avgCPL")}
              </th>
              <Show when={isAdmin()}>
                <th class="p-3" onClick={() => handleSort("modifiedCpl")}>
                  Premium CPL {getSortIcon("modifiedCpl")}
                </th>
              </Show>
              <th class="p-3" onClick={() => handleSort("activeCampaigns")}>
                Active Campaigns {getSortIcon("activeCampaigns")}
              </th>
              <th class="p-3" onClick={() => handleSort("completedCampaigns")}>
                Completed Campaigns {getSortIcon("completedCampaigns")}
              </th>
              <th class="p-3" onClick={() => handleSort("pausedCampaigns")}>
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
                        "border-t border-[#E2E8F1] dark:border-gray-700 transition-all duration-300 ease-in-out group " +
                        "[&_td]:text-center [&_td]:px-6 [&_td:first-child]:px-2 " +
                        "[&_td]:whitespace-nowrap [&_td:first-child]:text-left " +
                        (index() % 2 === 0
                          ? "bg-gray-50 dark:bg-gray-800 "
                          : "bg-[#FAFBFD] dark:bg-gray-800 ")
                      }
                    >
                      <td
                        class={
                          "px-1 py-2 w-12 text-center md:sticky md:left-0 md:z-10 " +
                          " " +
                          (index() % 2 === 0
                            ? "bg-gray-50 dark:bg-gray-800"
                            : "bg-[#FAFBFD] dark:bg-gray-800")
                        }
                      >
                        <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FBEEF0] dark:bg-red-900/30 text-[#AC2334] dark:text-red-300 text-xs font-bold">
                          {(currentPage() - 1) * pageSize() + index() + 1}
                        </span>
                      </td>
                      {/* Project Name */}
                      <td
                        class={
                          "px-2 py-2 md:sticky md:left-[57px] md:z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)] " +
                          " " +
                          (index() % 2 === 0
                            ? "bg-gray-50 dark:bg-gray-800"
                            : "bg-[#FAFBFD] dark:bg-gray-800")
                        }
                      >
                        <div class="flex items-center gap-4">
                          <Avatar name={project.name} />
                          <A
                            href={`/project/${project.id}`} //  ADD THIS
                            state={{ project }}
                            class="text-blue-900 dark:text-gray-100 font-semibold hover:text-[#AC2334] dark:hover:text-red-300 transition"
                          >
                            {project.name}
                          </A>
                        </div>
                      </td>

                      {/* Location */}
                      <td class="p-2 text-[#54657E] dark:text-gray-300">
                        {project.location}
                      </td>

                      {/* Type */}
                      <td class="p-2 text-[#54657E] dark:text-gray-300">
                        {project.type}
                      </td>

                      {/* Status Badge */}
                      <td class="px-4 py-3">
                        <span
                          class={
                            "inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wide rounded-full " +
                            (project.status === "active"
                              ? "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300"
                              : project.status === "completed"
                                ? "bg-[#ECF2FA] text-[#3E6FB0] dark:bg-blue-900/30 dark:text-blue-300"
                                : project.status === "paused"
                                  ? "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300"
                                  : "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300")
                          }
                        >
                          <span
                            class={
                              "w-1.5 h-1.5 rounded-full " +
                              (project.status === "active"
                                ? "bg-[#15966A]"
                                : project.status === "completed"
                                  ? "bg-[#3E6FB0]"
                                  : project.status === "paused"
                                    ? "bg-[#B07A14]"
                                    : "bg-[#AC2334]")
                            }
                          ></span>
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
                      <Show when={ishybrid()}>
                        <td class="p-2 font-medium text-gray-700 dark:text-gray-100">
                          {"₹"}
                          {(iscpl()
                            ? Number(stats().avgCPL || 0) * 5
                            : (project.budget ?? 0)
                          ).toLocaleString("en-IN")}
                        </td>
                      </Show>

                      {/* Date-range Leads */}
                      <td class="p-2 font-medium text-gray-700 dark:text-gray-100">
                        {stats().totalLeads}
                      </td>

                      {isAdmin() && (
                        <td class="p-2 text-gray-700 dark:text-green-300 font-medium">
                          +{stats().extraLeads || 0}
                        </td>
                      )}
                      {/* Date-range Spent */}
                      <Show when={!iscpl()}>
                        <td class="p-2 font-medium text-gray-700 dark:text-gray-100">
                          {"₹"}
                          {stats().totalSpent.toLocaleString("en-IN")}
                        </td>
                      </Show>

                      {/* Date-range AVG CPL */}
                      <td class="p-2 font-medium text-gray-700 dark:text-gray-100">
                        {"₹"}
                        {stats().avgCPL}
                      </td>
                      <Show when={isAdmin()}>
                        <td class="p-3 font-medium text-gray-700 dark:text-gray-100">
                          {project.modifiedCpl !== null &&
                          project.modifiedCpl !== undefined
                            ? `₹${Number(project.modifiedCpl).toLocaleString("en-IN")}`
                            : "—"}
                        </td>
                      </Show>

                      {/* Active Campaigns */}
                      <td class="p-2 text-center font-medium text-[#15966A] dark:text-green-300">
                        {stats().activeCampaigns ?? 0}
                      </td>

                      {/* Completed Campaigns */}
                      <td class="p-2 text-center font-medium text-[#3E6FB0] dark:text-blue-300">
                        {stats().completedCampaigns ?? 0}
                      </td>

                      {/* Paused Campaigns */}
                      <td class="p-2 text-center font-medium text-[#B07A14] dark:text-yellow-300">
                        {stats().pausedCampaigns ?? 0}
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
            <tfoot class="bg-[#F8FAFC] dark:bg-gray-800 font-semibold text-gray-700 dark:text-white border-t-2 border-[#D4DDE9] dark:border-gray-600">
              <tr class="[&_td]:text-center [&_td]:px-6 [&_td]:py-3">
                <td class="md:sticky md:left-0 md:z-20 bg-[#F8FAFC] dark:bg-gray-800"></td>

                <td class="md:sticky md:left-[57px] md:z-20 bg-[#F8FAFC] dark:bg-gray-800 text-left text-xs uppercase tracking-wider text-[#54657E] dark:text-gray-300">
                  Total
                </td>

                <td></td>
                <td></td>
                <td></td>

                {/* Budget Total */}
                <Show when={ishybrid()}>
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
                <Show when={!iscpl()}>
                  <td>
                    {"₹"}
                    {overviewStats().totalSpent.toLocaleString("en-IN")}
                  </td>
                </Show>

                {/* Avg CPL */}
                <td>
                  {"₹"}
                  {overviewStats().avgCPL}
                </td>
                {/* Premium CPL — no meaningful aggregate, show dash */}
                <Show when={isAdmin()}>
                  <td>—</td>
                </Show>

                {/* Active Campaigns */}
                <td>{overviewStats().activeCampaigns}</td>

                {/* Completed Campaigns */}
                <td>{overviewStats().completedCampaigns}</td>

                {/* Paused Campaigns */}
                <td> {overviewStats().pausedCampaigns}</td>
              </tr>
            </tfoot>
          </Show>
        </table>
      </div>
      <div class="flex items-center justify-between mt-5 flex-wrap gap-3">
        <span class="text-sm text-[#8593A8] dark:text-gray-400">
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
            class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-200 hover:bg-[#F6F9FC] disabled:opacity-35 disabled:cursor-default transition-colors"
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
            class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg bg-[#AC2334] border border-[#AC2334] text-white hover:bg-[#8E1C2B] disabled:opacity-35 disabled:cursor-default transition-colors"
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
        <div class="mt-8 rounded-xl border border-dashed border-[#D4DDE9] dark:border-gray-600 bg-gray-50 dark:bg-gray-800 p-6 text-center">
          <p class="text-sm font-bold text-gray-700 dark:text-gray-300">
            No active projects found
          </p>
          <p class="mt-1 text-sm text-[#8593A8] dark:text-gray-400">
            Your live projects will appear here once campaigns are started
          </p>
        </div>
      </Show>

      {/* ════════ NEEDS ATTENTION (derived from live data) ════════ */}
      <Show when={signals().length > 0}>
        <Eyebrow label="Needs attention" />
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
          <For each={signals()}>
            {(sig) => (
              <div class="relative overflow-hidden bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5">
                <span
                  class={
                    "absolute left-0 top-0 bottom-0 w-1 " +
                    (sig.tone === "red" ? "bg-[#AC2334]" : "bg-[#D89A2B]")
                  }
                ></span>
                <p
                  class={
                    "text-xs font-bold uppercase tracking-wider " +
                    (sig.tone === "red" ? "text-[#AC2334]" : "text-[#B07A14]")
                  }
                >
                  {sig.tag}
                </p>
                <h3 class="text-base font-bold text-[#14233A] dark:text-white mt-1.5 mb-1.5">
                  {sig.title}
                </h3>
                <p class="text-sm text-[#54657E] dark:text-gray-400 leading-relaxed [&_b]:text-[#1A2B45] dark:[&_b]:text-gray-100 [&_b]:font-bold">
                  {sig.body}
                </p>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* ════════ HOW THE PORTFOLIO IS BUYING ════════ */}
      <Show when={allProjects().length > 0}>
        <Eyebrow label="How the portfolio is buying" />
        <div class="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-4 mb-8">
          {/* CPL by project */}
          <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-6">
            <h3 class="text-base font-bold text-[#14233A] dark:text-white">
              Cost per lead, by project
            </h3>
            <p class="text-xs text-[#8593A8] dark:text-gray-400 mt-0.5 mb-5">
              Dashed line marks the portfolio average of ₹
              {overviewStatsCards().avgCPL}
              <Show when={cplChart().extra > 0}>
                {" "}
                · top 8 by spend, {cplChart().extra} more in the ledger
              </Show>
            </p>
            <div class="relative pt-1.5">
              <Show when={cplChart().avg > 0}>
                <div
                  class="absolute top-0 bottom-5 border-l-2 border-dashed border-[#B9C5D6] dark:border-gray-600"
                  style={`left:${cplChart().avgPos}%`}
                ></div>
                <span
                  class="absolute -top-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8593A8]"
                  style={`left:calc(${cplChart().avgPos}% + 8px)`}
                >
                  avg
                </span>
              </Show>
              <For each={cplChart().rows}>
                {(r) => (
                  <div class="grid grid-cols-[1fr_auto] sm:grid-cols-[110px_1fr_96px] gap-x-3 gap-y-2 items-center py-2.5">
                    <div class="text-sm font-bold text-[#54657E] dark:text-gray-300 text-left sm:text-right truncate sm:row-start-1 sm:col-start-1">
                      {r.name}
                    </div>
                    <div class="col-span-2 sm:col-span-1 h-3 rounded-full bg-[#EDF1F7] dark:bg-gray-800 relative sm:row-start-1 sm:col-start-2">
                      <div
                        class={
                          "absolute inset-y-0 left-0 rounded-full transition-all duration-700 " +
                          (r.tone === "green"
                            ? "bg-[#15966A]"
                            : r.tone === "steel"
                              ? "bg-[#3E6FB0]"
                              : r.tone === "red"
                                ? "bg-[#AC2334]"
                                : "bg-[#D8DFE9] dark:bg-gray-700")
                        }
                        style={`width:${r.width}%`}
                      ></div>
                    </div>
                    <div class="row-start-1 col-start-2 sm:col-start-3 text-right">
                      <Show
                        when={r.hasLeads}
                        fallback={
                          <span class="text-sm font-bold text-[#8593A8]">
                            —{" "}
                            <span class="block sm:inline text-[10px] font-medium">
                              no delivery yet
                            </span>
                          </span>
                        }
                      >
                        <span class="text-sm font-bold text-[#14233A] dark:text-white">
                          ₹{r.cpl}
                        </span>
                        <span class="block text-[10px] font-medium text-[#8593A8]">
                          {r.deltaPct === 0
                            ? "at avg"
                            : `${Math.abs(r.deltaPct)}% ${r.deltaPct > 0 ? "above" : "below"} avg`}
                        </span>
                      </Show>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>

          {/* Lead share + campaign health */}
          <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-6">
            <h3 class="text-base font-bold text-[#14233A] dark:text-white">
              Where the {leadShare().totalLeads.toLocaleString("en-IN")} leads
              came from
            </h3>
            <p class="text-xs text-[#8593A8] dark:text-gray-400 mt-0.5 mb-4">
              Share of leads in the selected range
            </p>
            <div class="flex h-4 rounded-full overflow-hidden mb-4">
              <For each={leadShare().items}>
                {(item) => (
                  <div
                    style={`width:${item.pct}%;background:${item.color}`}
                  ></div>
                )}
              </For>
            </div>
            <For each={leadShare().items}>
              {(item) => (
                <div class="flex items-center gap-2.5 py-2 border-b border-[#E2E8F1] dark:border-gray-700 last:border-b-0 text-sm">
                  <span
                    class="w-2.5 h-2.5 rounded flex-none"
                    style={`background:${item.color}`}
                  ></span>
                  <span class="flex-1 text-[#54657E] dark:text-gray-300 font-medium truncate">
                    {item.name}
                  </span>
                  <span class="font-bold text-[#14233A] dark:text-white">
                    {item.count.toLocaleString("en-IN")}
                  </span>
                  <span class="w-12 text-right text-xs font-medium text-[#8593A8]">
                    {item.pct.toFixed(1)}%
                  </span>
                </div>
              )}
            </For>

            {/* Campaign health */}
            <div class="mt-5 pt-5 border-t border-[#E2E8F1] dark:border-gray-700">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-2.5">
                Campaign health
              </p>
              <div class="flex h-3.5 rounded-full overflow-hidden">
                <div
                  class="bg-[#15966A]"
                  style={`width:${
                    overviewStatsCards().activeCampaigns +
                      overviewStatsCards().pausedCampaigns >
                    0
                      ? (overviewStatsCards().activeCampaigns /
                          (overviewStatsCards().activeCampaigns +
                            overviewStatsCards().pausedCampaigns)) *
                        100
                      : 0
                  }%`}
                ></div>
                <div class="bg-[#D89A2B] flex-1"></div>
              </div>
              <div class="flex justify-between mt-2 text-xs font-medium text-[#54657E] dark:text-gray-400">
                <span>
                  <b class="text-[#14233A] dark:text-white">
                    {overviewStatsCards().activeCampaigns}
                  </b>{" "}
                  live
                </span>
                <span>
                  <b class="text-[#14233A] dark:text-white">
                    {overviewStatsCards().pausedCampaigns}
                  </b>{" "}
                  paused
                </span>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* ════════ AI DAILY BRIEF (preview — highlights are live-derived) ════════ */}
      <Show when={SHOW_PROPOSED_SECTIONS && briefHighlights().length > 0}>
        <Eyebrow label="Account brief" soft="preview" />
        <div class="rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] bg-gradient-to-b from-[#192A45] to-[#101D31] border border-[#0D1828] p-5 sm:p-7 mb-8 text-[#C9D5E7]">
          <div class="flex items-center gap-3 flex-wrap">
            <h3 class="text-lg font-bold text-white">Daily brief</h3>
            {/* <span class="text-[10px] font-bold uppercase tracking-wider rounded-full px-3 py-1 bg-[#AC2334] text-white">
              Claude API
            </span> */}
            <span class="text-[10px] font-bold uppercase tracking-wider rounded-full px-3 py-1 border border-white/20 text-[#AEBDD3]">
              Preview · rule-based
            </span>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-7 mt-5">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#7E90AC] mb-2">
                What went well
              </p>
              <For each={briefHighlights()}>
                {(line) => (
                  <div class="flex gap-3 py-2.5 border-t border-white/10 text-sm leading-relaxed [&_b]:text-white [&_b]:font-bold">
                    <span
                      class={
                        "w-2 h-2 rounded-full flex-none mt-1.5 " +
                        (line.tone === "green"
                          ? "bg-[#3DD598]"
                          : "bg-[#E8B45A]")
                      }
                    ></span>
                    <div>{line.body}</div>
                  </div>
                )}
              </For>
            </div>
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#7E90AC] mb-2">
                Issues log · auto-tracked
              </p>
              <Show
                when={briefIssues().length > 0}
                fallback={
                  <div class="py-2.5 border-t border-white/10 text-sm text-[#AEBDD3]">
                    No open issues detected in this range.
                  </div>
                }
              >
                <For each={briefIssues()}>
                  {(iss) => (
                    <div class="flex gap-3 items-start py-2.5 border-t border-white/10">
                      <span
                        class={
                          "text-[9px] font-bold uppercase tracking-wide rounded px-2 py-1 flex-none mt-0.5 " +
                          (iss.state === "prog"
                            ? "bg-[#E8B45A] text-[#4A340B]"
                            : "bg-[#AC2334] text-white")
                        }
                      >
                        {iss.stateLabel}
                      </span>
                      <p class="text-sm leading-relaxed [&_b]:text-white [&_b]:font-bold">
                        <b>{iss.title}.</b> {iss.body}
                      </p>
                    </div>
                  )}
                </For>
              </Show>
            </div>
          </div>
          <div class="mt-4 pt-3.5 border-t border-white/10 flex justify-between flex-wrap gap-2 text-[11px] font-medium text-[#7E90AC]">
            <span>
              Highlights derived from this range's data · Claude API narrative
              wiring pending
            </span>
            <span>Numbers are restricted to the data shown on this page</span>
          </div>
        </div>
      </Show>

      {/* ════════ FUNNEL — live Impression→Lead, summed across projects ════════ */}
      <Show when={SHOW_PROPOSED_SECTIONS}>
        <Eyebrow
          label="Funnel"
          soft="impression to lead, across all projects"
        />
        <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-6 mb-8">
          <div class="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 class="text-base font-bold text-[#14233A] dark:text-white">
                Impression to lead, one glance
              </h3>
              <p class="text-xs text-[#8593A8] dark:text-gray-400 mt-0.5">
                Totals across every project from the Insights API
                {rangeLabel() ? ` · ${rangeLabel()}` : ""}.
              </p>
            </div>
            <span class="text-[10px] font-bold uppercase tracking-wider rounded-full px-3 py-1 bg-[#E9F7F1] text-[#15966A] flex-none">
              Live data
            </span>
          </div>
          <Show when={!funnelStats().hasData}>
            <p class="text-sm text-[#8593A8] dark:text-gray-400 mt-5">
              No insights for this range yet.
            </p>
          </Show>
          <div
            class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 mt-5"
            classList={{ "opacity-50": !funnelStats().hasData }}
          >
            {funnelCells().map((f) => (
              <div class="py-3 lg:py-0 lg:px-5 border-t lg:border-t-0 lg:border-l border-[#E2E8F1] dark:border-gray-700 first:border-t-0 first:border-l-0 first:pl-0 flex lg:block items-center justify-between gap-3">
                {/* Label — with subtext stacked beneath on mobile */}
                <div class="min-w-0">
                  <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                    {f.l}
                  </p>
                  <p class="lg:hidden text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                    {f.s}
                  </p>
                </div>
                <p class="flex-none text-right lg:text-left text-xl sm:text-2xl font-bold text-[#14233A] dark:text-white lg:mt-1">
                  {f.v}
                </p>
                {/* Subtext — sits under the value on desktop */}
                <p class="hidden lg:block text-xs text-[#54657E] dark:text-gray-400 mt-1">
                  {f.s}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Show>
    </section>
  );
}
