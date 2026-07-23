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
  createResource,
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
import {
  fedLeadsForProject,
  fetchFedLeadBatches,
  fedLeadsByProject,
  fmtFed,
} from "../services/fedLeads";
import { fetchCampaigns } from "../services/campaigns";
import { fetchBulkCampaignInsights } from "../services/campaigns";
import { fetchAllCampaigns } from "../services/campaigns";
import { fetchAllAdminClients } from "./admin/services/fetchClients";
import { fetchSalesClients } from "../services/sales";
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

// Admin/CM "preview as client" insight rows (returned when the bulk call is sent
// with as_client_id) carry BOTH `spend` (client-facing — markup / fixed-CPL
// applied) and `spend_raw` (the actual Meta charge). The ledger's "Total Spent"
// / "AVG CPL" columns are the RAW Meta figures — the marked-up number lives in
// the separate Premium CPL column — so read `spend_raw` whenever it is present.
// A client's own rows have no `spend_raw`, so fall back to `spend` (which is
// already their billed figure). This keeps the raw columns at the Meta charge
// even after we start sending as_client_id (which flips `spend` to marked-up).
const rawSpendOf = (row) =>
  parseFloat((row?.spend_raw != null ? row.spend_raw : row?.spend) || 0);

// ── Dev-time ledger invariants ───────────────────────────────────────────────
// The privileged ledger derives Meta by SUBTRACTING fed from an inclusive sum,
// so a single lead lost anywhere between the bulk response and the rendered row
// surfaces as a quietly wrong Meta figure, not as an obvious blank — which is
// exactly how "Meta 65" shipped against a real 66. These fire in dev only and
// name the stage that dropped it instead of leaving it to be re-derived by hand.
const DEV_ASSERTS = Boolean(import.meta.env?.DEV);

const assertLeadIdentity = (label, meta, fed, total) => {
  if (!DEV_ASSERTS) return;
  if (meta + fed !== total) {
    console.error(
      `[ledger] ${label}: Meta + Fed != Total (${meta} + ${fed} != ${total}). ` +
        `A lead was lost or double-counted between the bulk rows and the split.`,
    );
  }
};

// Reported once per bulk load when rows never reach a project — the silent
// drop path behind a short Total. `dropped` rows are gone from leads AND spend.
const reportRowAudit = (audit) => {
  if (!DEV_ASSERTS) return;
  if (audit.dropped === 0 && audit.dateless === 0) return;
  console.error(
    `[ledger] bulk rows not counted: ${audit.dropped} unmapped ` +
      `(${audit.droppedLeads} leads — campaign_id not in the requested set), ` +
      `${audit.dateless} dateless (${audit.datelessLeads} leads — no row.date, ` +
      `so every date filter drops them). Received ${audit.received} rows, ` +
      `${audit.leads} leads total.`,
  );
};

// ── Design-section toggles (UI only) ─────────────────────────────────────────
// The funnel needs impressions/CTR/CPM (not fetched anywhere yet) and the AI
// brief's issue timestamps need the diagnostics service. Until those exist,
// both render with the same "Proposed / Illustrative" tags the approved design
// uses. Flip to false to hide them entirely.
const SHOW_PROPOSED_SECTIONS = true;

// Display thresholds for the "Needs attention" rules (presentation only).
const HOT_CPL_RATIO = 1.4; // CPL > 140% of portfolio average → "running hot"

// A client route is "/:client-nomen-name" where the slug is the raw nomen
// lowercased with runs of whitespace collapsed to "-" (see Clients.jsx's
// handleClientDashboard). slugify() reproduces that transform so a stored nomen
// can be matched against the slug in the URL.
const slugify = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-");

// Reconcile localStorage.selectedClientNomen to the client named in the URL.
// The whole dashboard — the projects list (fetchProjects), manual batches, AND
// the campaign sweep's client_nomen scope — keys off this single localStorage
// value. Clicking a client in the Clients screen sets it before navigating, but
// a direct URL / fresh tab (never clicked through) leaves it UNSET, and editing
// the address bar from one client to another leaves it STALE. Either way the
// dashboard would render the wrong client — or, when unset, sweep EVERY client
// in the org (starving the hero ledger for minutes). Resolve the slug back to
// the raw nomen via the admin roster and write it before any scoped load fires.
//
// `routeSlug` MUST be the router's own :client-nomen-name param (see callers) —
// NOT a value parsed out of location.pathname. All ~35 routes are siblings under
// one layout, so string-parsing the pathname treated static routes (/clients,
// /billing, /my-work, …) as client nomens and hard-errored on them. A router
// param only carries a value when the dynamic "/:client-nomen-name" route matched,
// so it is undefined on every static route and on "/" — exactly the distinction
// we need, and it never needs a route-name exclusion list kept in sync.
//
// Returns { ok, changed }: ok=false when the slug matches no client; changed=true
// when localStorage was actually rewritten (so callers must bust the cache).
const ensureClientContextFromRoute = async (routeSlug) => {
  const auth = JSON.parse(localStorage.getItem("auth") || "{}");
  const role = auth?.role;
  // Only admin + sales carry a switchable client context reconciled from the
  // URL. Real client logins are scoped server-side by their own nomen and never
  // touch these keys.
  if (role !== "admin" && role !== "sales") return { ok: true, changed: false };

  // Not the dynamic client route (a static route, or "/") → nothing to reconcile.
  if (!routeSlug) return { ok: true, changed: false };

  // ── Sales: mirror the admin slow path against the sales roster. Sales NEVER
  // writes selectedClientId — that Client PK feeds as_client_id ("preview as
  // client"), which is admin-only. Sales scopes purely by nomen, and the backend
  // intersects with the manager's onboarded book, so this can never widen. ──
  if (role === "sales") {
    const stored = localStorage.getItem("selectedClientNomen");
    // Fast path: localStorage already names the client in the URL → no fetch.
    if (stored && slugify(stored) === routeSlug) {
      return { ok: true, changed: false };
    }
    try {
      const roster = await fetchSalesClients();
      const match = roster.find(
        (c) => slugify(c.client_nomen_name) === routeSlug,
      );
      if (!match) {
        console.warn(
          `ClientDashboard: no sales client matches route slug "${routeSlug}"`,
        );
        return { ok: false, changed: false, reason: "not-found" };
      }
      localStorage.setItem("selectedClientNomen", match.client_nomen_name);
      localStorage.setItem("selectedClientNomenId", match.client_nomen); // nomen id
      localStorage.setItem("selectedClientName", match.client_nomen_name);
      // NOT selectedClientId — admin-only (as_client_id preview).
      return { ok: true, changed: true };
    } catch (err) {
      console.error(
        "ClientDashboard: failed to resolve sales client from route",
        err,
      );
      return { ok: false, changed: false, reason: "error" };
    }
  }

  const stored = localStorage.getItem("selectedClientNomen");
  // Fast path: localStorage already names the client in the URL AND carries its
  // Client PK → no roster fetch, no change. The PK check matters: a session from
  // before selectedClientId existed (or any partial write) must fall through to
  // the roster so the PK is backfilled — otherwise as_client_id goes missing and
  // the ledger silently loses its preview-as-client scoping.
  if (
    stored &&
    slugify(stored) === routeSlug &&
    localStorage.getItem("selectedClientId")
  ) {
    return { ok: true, changed: false };
  }

  // Slow path (unset or stale): resolve the slug via the admin roster.
  try {
    const roster = await fetchAllAdminClients();
    const match = roster.find((c) => slugify(c.client_nomen_name) === routeSlug);
    if (!match) {
      console.warn(`ClientDashboard: no client matches route slug "${routeSlug}"`);
      return { ok: false, changed: false, reason: "not-found" };
    }
    localStorage.setItem("selectedClientNomen", match.client_nomen_name);
    localStorage.setItem("selectedClientNomenId", match.client_nomen); // nomen id
    localStorage.setItem("selectedClientId", String(match.id)); // Client PK
    localStorage.setItem("selectedClientName", match.organization_name ?? "");
    return { ok: true, changed: true };
  } catch (err) {
    console.error("ClientDashboard: failed to resolve client from route", err);
    return { ok: false, changed: false, reason: "error" };
  }
};

export default function MainDashboard() {
  const [statusFilter, setStatusFilter] = createSignal("all");
  // Set when an admin lands on a client route whose slug resolves to no client
  // (typo'd / renamed / removed) or the roster lookup fails. Gates the whole
  // dashboard behind a "client not found" state so a stale-cached client's
  // numbers never render under the wrong URL. Shape: { type: "not-found"|"error",
  // slug } or null. See ensureClientContextFromRoute.
  const [clientRouteError, setClientRouteError] = createSignal(null);
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

  // Client PK — what as_client_id ("preview as client") expects. DISTINCT from the
  // nomen id above: they differ for all but one client (AnandSingh is PK 45 /
  // nomen 168; only Navdeep happens to have PK == nomen == 11, which is why this
  // slipped through testing). Sending a nomen id 404s "Target client not found or
  // inactive" → 0 leads / ₹0. Nomen id → AI-insight + CM endpoints; PK → as_client_id.
  const selectedClientId = () => {
    location.pathname; // track route changes
    return localStorage.getItem("selectedClientId");
  };

  const { isRetainer, iscpl, ishybrid, isAdmin } = clientRole();
  const { handleSort, getSortIcon, sortData, resetSort } = useColumnSort();

  const params = useParams();
  const location = useLocation();

  // ── Gate for the campaign/insights sweep (mirrors DailyReports' ready()) ─────
  // When an admin is "Viewing Client: X", the ledger's leads/spend MUST be
  // scoped to that client's Client PK (selectedClientId). Firing the sweep before
  // the PK is resolved sends an unscoped bulk-insights call that sums EVERY
  // client's spend on shared/multi-client projects — the all-clients bug.
  // This is true only while previewing a client: the admin's own "/" dashboard
  // (no client selected) is meant to be all-clients, and real client logins are
  // force-scoped server-side by their own nomen — so both return ready = true.
  const clientContextReady = () => {
    if (userRole() !== "admin") return true; // clients are server-scoped
    if (location.pathname === "/") return true; // admin's own dashboard
    return !!selectedClientId(); // previewing a client → need the Client PK
  };

  // ── Reactively clear client context when navigating back to the Main Dashboard ──
  // Both "/" and "/:client-nomen-name" render THIS same component, so SolidJS
  // reuses the instance on navigation and onMount does NOT re-run. Without this
  // effect, clicking "Dashboard" in the sidebar after viewing a client would keep
  // showing the previously selected client's cached data.
  createEffect(
    on(
      () => location.pathname,
      async (pathname, prevPathname) => {
        // First run is handled by onMount — skip to avoid a double load.
        if (prevPathname === undefined) return;

        const auth = JSON.parse(localStorage.getItem("auth") || "{}");
        // Admin AND sales reconcile the client context from the URL on in-place
        // nav (e.g. editing the address bar from one client to another within
        // this reused instance). Sales "/" renders SalesDashboard, so the "/"
        // branch below only ever fires for admin; the client-route branch runs
        // for both and ensureClientContextFromRoute handles the sales roster.
        if (auth?.role !== "admin" && auth?.role !== "sales") return;

        const bustAndReload = () => {
          // Cancel any still-in-flight loads so they can't overwrite the data
          // we're about to fetch.
          bumpLoadToken();

          setProjectsCache("lastFetched", 0);
          setProjectsCache("lastFetchedAll", 0);
          setProjectsCache("allProjects", []);
          setProjectsCache("insightsMap", {});
          setProjectsCache("data", []);

          loadData(1);
          loadManualBatches();
          loadAllProjects();
        };

        // ── Back to admin home ("/") ──
        if (pathname === "/") {
          setClientRouteError(null); // leaving any not-found / client state behind

          // Clear any selected-client context so only admin's own data is used.
          localStorage.removeItem("selectedClientNomen");
          localStorage.removeItem("selectedClientNomenId");
          localStorage.removeItem("selectedClientId");
          localStorage.removeItem("selectedClientName");

          // Always bust the client cache and reload admin data. This effect fires
          // ONLY when navigating to "/" FROM a client route within the reused
          // instance (arriving from another page runs onMount, whose first effect
          // run is skipped) — so we were always previewing a client or its
          // not-found state. Gating on wasViewingClient/hadError previously left
          // the previous client's projects on screen once the context had already
          // been cleared (e.g. by the not-found branch): one client's data under
          // another client's page, the worst failure mode here.
          bustAndReload();
          return;
        }

        // ── Navigated somewhere else within the reused instance. Ask the router
        // whether THIS is the dynamic client route: params carries a
        // client-nomen-name ONLY on "/:client-nomen-name", never on the static
        // sibling routes (/clients, /billing, /my-work, …) this component doesn't
        // own. Bailing on those is what stops the resolver treating the literal
        // "clients"/"billing"/etc. as a client nomen and hard-erroring on them.
        // onMount does NOT re-run across "/"↔client nav, so we reconcile here and
        // reload only when the context actually changed. ──
        const routeSlug = params["client-nomen-name"];
        if (!routeSlug) return; // static route / not a client route → do nothing
        const ctx = await ensureClientContextFromRoute(routeSlug);
        if (!ctx.ok) {
          // Unknown/unresolvable slug — clear the cache AND the stale selected-
          // client context so no other client's data shows under this URL or
          // after exiting, then surface the "client not found" state.
          bumpLoadToken();
          localStorage.removeItem("selectedClientNomen");
          localStorage.removeItem("selectedClientNomenId");
          localStorage.removeItem("selectedClientId");
          localStorage.removeItem("selectedClientName");
          setProjectsCache("lastFetched", 0);
          setProjectsCache("lastFetchedAll", 0);
          setProjectsCache("allProjects", []);
          setProjectsCache("insightsMap", {});
          setProjectsCache("data", []);
          setClientRouteError({
            type: ctx.reason ?? "not-found",
            slug: routeSlug,
          });
          return;
        }
        setClientRouteError(null);
        if (ctx.changed) bustAndReload();
      },
    ),
  );

  // Update onMount to read the role
  // MainDashboard.jsx — update onMount
  onMount(async () => {
    // New mount → cancel any loads still in flight from a previous context.
    bumpLoadToken();

    const auth = JSON.parse(localStorage.getItem("auth"));

    // Admin returning to their own dashboard — clear client context AND cache
    if (auth?.role === "admin" && window.location.pathname === "/") {
      const wasViewingClient = localStorage.getItem("selectedClientNomenId");

      localStorage.removeItem("selectedClientNomen");
      localStorage.removeItem("selectedClientNomenId");
      localStorage.removeItem("selectedClientId");
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

    // Reconcile the client context from the URL BEFORE any scoped load fires, so
    // a direct-URL / fresh-tab visit (localStorage never set) or an edited
    // address bar (stale) doesn't sweep the wrong client — or every client in
    // the org. When it rewrites the context, the persisted cache belongs to the
    // previous client, so drop it and re-fetch from scratch.
    // Ask the router which client this route is, not the pathname string.
    const routeSlug = params["client-nomen-name"];
    const ctx = await ensureClientContextFromRoute(routeSlug);
    if (!ctx.ok) {
      // Slug resolved to no client (or the lookup failed). Do NOT fall through
      // and render whatever client is still cached under this URL — clear the
      // cache AND the stale selected-client context (so nothing renders "as" a
      // client behind the gate or after "Back to dashboard"), then show the
      // "client not found" state.
      bumpLoadToken();
      localStorage.removeItem("selectedClientNomen");
      localStorage.removeItem("selectedClientNomenId");
      localStorage.removeItem("selectedClientId");
      localStorage.removeItem("selectedClientName");
      setProjectsCache("lastFetched", 0);
      setProjectsCache("lastFetchedAll", 0);
      setProjectsCache("allProjects", []);
      setProjectsCache("insightsMap", {});
      setProjectsCache("data", []);
      setClientRouteError({
        type: ctx.reason ?? "not-found",
        slug: routeSlug,
      });
      return;
    }
    setClientRouteError(null);
    if (ctx.changed) {
      bumpLoadToken();
      setProjectsCache("lastFetched", 0);
      setProjectsCache("lastFetchedAll", 0);
      setProjectsCache("allProjects", []);
      setProjectsCache("insightsMap", {});
      setProjectsCache("data", []);
    }

    loadData(1);
    if (auth?.role === "admin") {
      loadManualBatches();
    }

    // Fire the sweep when the cache is stale OR when there's nothing to render
    // (fresh timestamp but empty insightsMap — see hasRenderedCampaignData).
    // This guarantees data loads on every reload while still skipping the
    // refetch when valid data is already present (cache benefit preserved).
    // Gated on clientContextReady() so an admin previewing a client never fires
    // the sweep before the client PK resolves (the createEffect below re-fires it
    // the moment the context becomes ready, so it is never permanently skipped).
    if (
      clientContextReady() &&
      (isAllProjectsCacheStale() || !hasRenderedCampaignData())
    ) {
      loadAllProjects();
    }
  });

  // Safety net for the viewing-client hydration race: if onMount gated the sweep
  // because the selected-client PK was not resolved yet, fire it as soon as the
  // context becomes ready. clientContextReady() reads selectedClientNomenId(),
  // which tracks location.pathname, so this re-runs on navigation. defer:true
  // skips the initial run (onMount already covers the ready-at-mount case), so a
  // client already resolved at mount does not double-load.
  createEffect(
    on(
      clientContextReady,
      (ready, wasReady) => {
        if (
          ready &&
          !wasReady &&
          (isAllProjectsCacheStale() || !hasRenderedCampaignData())
        ) {
          loadAllProjects();
        }
      },
      { defer: true },
    ),
  );

  const auth = JSON.parse(localStorage.getItem("auth") || "{}");

  // Service charge for the ledger ("Spend + X% service charge"). This must be
  // the VIEWED client's rate, not the logged-in user's. It rides on the projects
  // response's `meta.report_summary.service_charge` (the exact field the admin /
  // client Daily Report reads) and is captured in loadData below — that call is
  // already scoped to the viewed client via selectedClientNomen, so no extra
  // request and no backend change are needed. Falls back to the logged-in user's
  // own auth.serviceCharge (correct for a client's own login) and finally 13%,
  // so an admin/CM viewing another client no longer sees their own / a hardcoded
  // rate.
  const [clientServiceCharge, setClientServiceCharge] = createSignal(null);

  const serviceChargePercent = () =>
    Number(clientServiceCharge() ?? auth?.serviceCharge ?? 13);

  const serviceChargeRate = () => serviceChargePercent() / 100;

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

      // The per-client service-charge rate lives in this response's
      // report_summary (present because /projects/ is scoped to one client via
      // selectedClientNomen). Capture it so the ledger bills the VIEWED client's
      // rate. null when unscoped → serviceChargePercent() falls back to auth/13%.
      const sc = res?.meta?.report_summary?.service_charge;
      if (sc != null) setClientServiceCharge(Number(sc));

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
        // Seed status to null (skeleton) like the counts above — the backend's
        // Project.status is stale (says "active" while every campaign is paused).
        // deriveProjectStatuses fills it from the real per-campaign statuses.
        status: null,
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
          // Seed status to null (skeleton) like the counts — the backend's stale
          // Project.status is filled in by deriveProjectStatuses from real
          // per-campaign statuses.
          status: null,
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

  // ── Fed (manually-uploaded) leads for a CM viewing a client's dashboard ─────
  //
  // A CM's bulk-insights rows come back RAW: the display pipeline that folds
  // synthetic leads into the normal rows does not run for privileged roles, so
  // there is no is_manual row in this response to derive fed leads from. They
  // have to come from the manual-batch list and be joined by project id — the
  // same route CMDashboard and CMDailyReport already take. That shared join is
  // the whole point: a CM's dashboard, their own daily report and the client's
  // own view can no longer disagree about the same batch. The day/revoked rule
  // is never re-implemented here; fedLeads.js owns it.
  //
  // This RESOURCE is CM-only — admin reads the same fedLeads.js helpers over the
  // batches loadManualBatches() already holds (also fetchFedLeadBatches, scoped
  // by client_nomen), so a second fetch here would be pure duplication. A
  // client's own rows need no fed source at all: they are already INCLUSIVE, and
  // adding batches on top is the 108 → 122 double count all over again.
  const isCMViewer = () => auth?.role === "campaign_manager";

  // Admin and CM both show the Meta / Fed / Total split; a client sees one
  // (already inclusive) leads figure. One flag drives every header, cell and
  // label so the two privileged ledgers cannot drift apart visually either.
  const isFedAwareViewer = () => isAdmin() || isCMViewer();

  // One fetch per viewed client. The list endpoint carries no date filter, so
  // every range below is applied client-side by fedLeadsByProject. A null source
  // means the fetcher never runs at all for admin / client viewers.
  const cmFedScope = () =>
    isCMViewer() ? (selectedClientNomen() ?? "cm") : null;

  const [cmFedBatches] = createResource(cmFedScope, async () => {
    try {
      // No client_nomen filter: the backend auto-scopes the list to the CM's
      // visible clients, and we then join by project id against THIS client's
      // own projects — so no other client's batch can surface here. A failure
      // degrades to "no fed leads" rather than sinking the dashboard.
      return await fetchFedLeadBatches();
    } catch (err) {
      console.error("[ClientDashboard] CM fed lead batches failed:", err);
      return [];
    }
  });

  // The hero reads the CARD range and the project ledger reads the CALENDAR
  // range — two different pickers — so each gets its own roll-up rather than
  // sharing one and drifting from the numbers printed beside it.
  const cmFedByProjectCard = createMemo(() => {
    if (!isCMViewer()) return {};
    const { from, to } = getCardDateRange();
    return fedLeadsByProject(cmFedBatches() ?? [], from, to);
  });

  const cmFedByProjectLedger = createMemo(() =>
    isCMViewer()
      ? fedLeadsByProject(cmFedBatches() ?? [], fromDate(), toDate())
      : {},
  );

  // Fed leads for one project, 0 for every non-CM viewer. Keys are strings.
  const cmFedOf = (map, projectId) =>
    isCMViewer() ? map[String(projectId)] || 0 : 0;

  // ── The ONE fed figure, for whichever viewer is looking ────────────────────
  // Admin and CM now read the same helper over the same kind of batch list
  // (fedLeads.js applies the shared received_date + revoked rules), so the two
  // ledgers can no longer print different fed totals for the same client, day
  // and project. The server-computed `extra_leads` column is deliberately NOT
  // consulted anywhere on this ledger: two fed sources drift, one cannot.
  //   • admin  → loadManualBatches(), client_nomen-scoped, swept over all pages
  //   • CM     → the cmFedBatches resource, pre-rolled per project by the range
  //   • client → 0; their bulk rows already include every fed lead
  const fedLeadsOf = (projectId, cmMap, from, to) => {
    if (isAdmin())
      return fedLeadsForProject(manualBatches(), projectId, from, to);
    return cmFedOf(cmMap, projectId);
  };

  // ── Raw Meta spend for ONE row ─────────────────────────────────────────────
  // The ledger's "Total Spent" / "AVG CPL" are the RAW Meta charge; the
  // marked-up figure lives in the separate Premium CPL column. On a privileged
  // view that means `spend_raw` and ONLY `spend_raw`:
  //   • with as_client_id, `spend` is the BILLED amount, so falling back to it
  //     for any row missing spend_raw silently mixes billed money into the raw
  //     total — ₹10,669.32 against a real ₹9,718.72 for Bullmen / NoidaEvent on
  //     20 Jul 2026, an excess of exactly one row's markup.
  //   • an is_manual row has no Meta charge at all (fed leads cost nothing on
  //     Meta), so it contributes 0. f950175 stopped skipping those rows for
  //     admin, which is right for LEADS but must not put their billed cost into
  //     raw spend.
  // This is the rule DailyReports' Raw column already uses (Σ spend_raw, no
  // fallback). A client's own login has no spend_raw on any row and `spend` IS
  // their billed figure, so the fallback stays for them — client view unchanged.
  const metaSpendOf = (row) => {
    if (!isFedAwareViewer()) return rawSpendOf(row);
    if (row?.is_manual) return 0;
    return parseFloat(row?.spend_raw || 0);
  };

  // Split one project's leads into Meta / Fed / Total from the bulk-row sum and
  // that fed figure. The bases differ by viewer, and that is the whole bug this
  // replaces — admin was printing an INCLUSIVE sum under "Total Leads" and then
  // a fed count beside it, so the row added up to 174 against a real 123:
  //   • ADMIN  — sent with as_client_id, so the backend runs the client display
  //     pipeline: fed leads are already merged into the normal rows (plus any
  //     standalone is_manual row we no longer drop). The sum IS the Total, and
  //     Meta is what remains once fed is taken back out.
  //   • CM     — privileged rows come back RAW, so the sum IS Meta and the
  //     Total is Meta + fed.
  //   • CLIENT — inclusive like admin, but fed is 0 here, so both are the sum
  //     and the client view is bit-for-bit unchanged.
  // Meta + Fed == Total holds BY CONSTRUCTION at every level: Total is always
  // re-derived as Meta + Fed rather than carried alongside them, so no
  // aggregation step can drift the three apart.
  //
  // The earlier clamp bounded FED into [0, sum]. That silently swallowed fed
  // leads for any project with fed batches but no Meta delivery in range (fed
  // clamped down to a 0 sum), and it hid a short sum instead of surfacing it.
  // Clamp META at 0 instead: when fed exceeds the inclusive sum, Meta is 0 and
  // Total becomes fed, which is honest and still satisfies the identity — and
  // the dev assert below fires so the short sum gets found rather than absorbed.
  const splitLeads = (sumLeads, fed) => {
    const fedLeads = Math.max(Number(fed) || 0, 0);
    const metaLeads = isAdmin()
      ? Math.max(sumLeads - fedLeads, 0) // inclusive sum → back out fed
      : sumLeads; // raw sum (CM) / already inclusive (client)
    return {
      totalLeads: metaLeads,
      fedLeads,
      totalLeadsWithFed: metaLeads + fedLeads,
    };
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

      // Leads filtered by the stamped campaign range so they stay in lockstep
      // with the bulk-insights window (no flicker during a date-change refetch).
      const leadsRange = range ?? { from, to };
      const leadSum = inRange(
        insights,
        leadsRange.from,
        leadsRange.to,
      ).reduce((s, d) => s + (d.leads || 0), 0);
      // Meta / Fed / Total from ONE sum and ONE fed source — see splitLeads.
      const { totalLeads, fedLeads, totalLeadsWithFed } = splitLeads(
        leadSum,
        fedLeadsOf(project.id, cmFedByProjectCard(), from, to),
      );
      assertLeadIdentity(
        `hero ${project.name ?? project.id}`,
        totalLeads,
        fedLeads,
        totalLeadsWithFed,
      );
      const totalSpent = filtered.reduce(
        (s, d) => s + metaSpendOf(d),
        0,
      );
      // CPL is cost per META lead: raw spend ÷ Meta leads. Fed leads cost
      // nothing on Meta, so dividing by the inclusive total would understate it.
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

      // For ADMIN and CLIENT the bulk sum is already INCLUSIVE of synthetic
      // leads (the endpoint merges them into normal rows and the standalone
      // is_manual row is counted in `insights` too), so nothing is ever added on
      // top — that add is what double-counted the merged portion (108 → 122).
      // splitLeads subtracts instead, which is why admin's Meta + Fed = Total.
      result[project.id] = {
        totalLeads,
        fedLeads,
        totalLeadsWithFed,
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
    // the date range these campaigns belong to.
    for (const project of projectList) {
      const allCampaigns = projectCampaigns[project.id] || [];
      result[project.id] = {
        campaigns: allCampaigns.map((c) => ({
          id: c.id,
          status: c.status,
          // server-computed premium (marked-up) figures for this campaign
          premium_metrics: c.premium_metrics,
        })),
        insights: [],
        // Date range these campaigns were fetched for. Real leads are filtered
        // by this so they stay in lockstep with the bulk insights window.
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
        // ADMIN previewing a client: send the Client PK as as_client_id so the
        // backend enters "preview as client" mode — it enables the Phase-4 history
        // filter (correct per-day attribution, drops any foreign campaign's rows)
        // and returns both `spend` (marked-up) and `spend_raw` (Meta charge). Null
        // for the admin's own dashboard / a client's own login (already scoped),
        // where the call falls back to the normal client_nomen scoping. Raw
        // columns read spend_raw via metaSpendOf(), so the displayed figure is
        // unchanged even though `spend` now carries the markup.
        // NEVER for a CM: only the admin roster carries the Client PK, so any
        // selectedClientId a CM session holds is a nomen id the backend 403s
        // ("This client is not in your scope") → silent zeros. CMs are already
        // server-scoped, so omitting it returns the correct rows. The isAdmin()
        // guard is defence in depth — it keeps poisoned storage off the wire even
        // though the write site is now admin-gated too.
        const bulk = await fetchBulkCampaignInsights(allCampaignIds, {
          asClientId: isAdmin() ? selectedClientId() : null, // PK; nomen id 403s
        });
        const rows = bulk.data || [];

        // Every row that never reaches a project is a lead missing from the
        // inclusive Total, and Meta is derived by subtracting fed FROM that
        // Total — so a silent drop here reads as a wrong Meta on screen. Audit
        // the two drop paths and report them in dev rather than absorbing them.
        const audit = {
          received: rows.length,
          leads: 0,
          dropped: 0,
          droppedLeads: 0,
          dateless: 0,
          datelessLeads: 0,
        };

        for (const row of rows) {
          const rowLeads = Number(row.leads || 0);
          audit.leads += rowLeads;
          if (!row.date) {
            // No date → every range filter downstream drops it, from both leads
            // and spend. Count it so a short Total names its own cause.
            audit.dateless += 1;
            audit.datelessLeads += rowLeads;
          }

          let entry = campaignById[String(row.campaign_id)];
          if (!entry && row.project_id != null && result[row.project_id]) {
            // The bulk response is scoped to THIS client, so a row we cannot map
            // by campaign still belongs on its own project when it names one
            // (standalone synthetic rows need not carry a campaign we asked for).
            // Dropping it lost its leads from the inclusive Total.
            entry = { projectId: row.project_id, campaign: { id: null } };
          }
          if (!entry) {
            audit.dropped += 1;
            audit.droppedLeads += rowLeads;
            continue;
          }
          // Standalone is_manual rows are counted for EVERY viewer. Dropping
          // them for admin (which the old code did, to keep that view exclusive)
          // made admin's total silently under-count whenever a batch did not
          // merge into a normal row — it happens to be 0 rows for Bullmen /
          // NoidaEvent, but EdenWaveCity has had them. Admin's total must be the
          // inclusive figure in EVERY case, because that is what the client sees
          // and what the Fed column is now subtracted from.
          //
          // The bulk endpoint is inclusive of synthetic leads (most merged into
          // normal rows; the remainder on standalone is_manual rows), so their
          // LEADS are counted here like any other row's. Their SPEND is handled
          // by metaSpendOf, which keeps the client's billed figure for a client
          // and contributes 0 on a privileged view (no Meta charge exists for a
          // fed lead). This replaces the old campaign.extra_leads add, which
          // double-counted the merged portion.
          result[entry.projectId].insights.push({
            ...row,
            campaignId: entry.campaign.id,
          });
        }

        reportRowAudit(audit);
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

      // Leads are filtered by the range the loaded campaigns belong to (stamped
      // in the cache), so Total Leads stays in lockstep with the bulk-insights
      // window — no flicker while a date-change campaign refetch is in flight.
      const leadsRange = range ?? { from, to };
      const leadSum = inRange(
        insights,
        leadsRange.from,
        leadsRange.to,
      ).reduce((s, d) => s + (d.leads || 0), 0);
      // Meta / Fed / Total from ONE sum and ONE fed source — see splitLeads.
      // Admin and CM feed the identical three columns from here, so a
      // back-to-back capture of the two ledgers must agree per project.
      const { totalLeads, fedLeads, totalLeadsWithFed } = splitLeads(
        leadSum,
        fedLeadsOf(project.id, cmFedByProjectLedger(), from, to),
      );
      // Row level. The footer asserts the same identity over the roll-up.
      assertLeadIdentity(
        `project ${project.name ?? project.id}`,
        totalLeads,
        fedLeads,
        totalLeadsWithFed,
      );
      const totalSpent = filtered.reduce(
        (s, d) => s + metaSpendOf(d),
        0,
      );
      // Cost per META lead — raw spend ÷ Meta leads, never ÷ the inclusive total.
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

      result[project.id] = {
        // totalLeads is the META figure for admin and CM, and the (already
        // inclusive) client figure for a client. campaign.extra_leads is never
        // added on top for anyone — that add double-counted the merged portion
        // (108 → 122), and the server-computed extra_leads column is retired
        // from this ledger entirely so there is exactly one fed source.
        totalLeads,
        fedLeads,
        totalLeadsWithFed,
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
    // Admin + CM (0 for a client). Summed over ALL projects, exactly like
    // totalLeads above, so the ledger footer's "Total (incl. fed)" reconciles
    // with the CM's own Daily Report total for the same client and range — and
    // with what the client sees on their own dashboard.
    const totalFedLeads = all.reduce(
      (s, p) => s + (statsMap[p.id]?.fedLeads ?? 0),
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

    // The footer re-derives its Total from the two roll-ups rather than summing
    // the per-project Totals, so assert BOTH: that the identity survives the
    // roll-up, and that the roll-up still equals the sum of the rows above it.
    const totalLeadsWithFed = totalLeads + totalFedLeads;
    assertLeadIdentity("footer", totalLeads, totalFedLeads, totalLeadsWithFed);
    if (DEV_ASSERTS) {
      const rowTotals = all.reduce(
        (s, p) => s + (statsMap[p.id]?.totalLeadsWithFed ?? 0),
        0,
      );
      if (rowTotals !== totalLeadsWithFed) {
        console.error(
          `[ledger] footer Total ${totalLeadsWithFed} != Σ per-project Totals ` +
            `${rowTotals} — the footer and the rows disagree.`,
        );
      }
    }

    return {
      totalBudget,
      totalSpent,
      totalLeads,
      totalFedLeads,
      totalLeadsWithFed,
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
    // Admin + CM (0 for a client) — the hero's "+N fed · N total" line.
    const totalFedLeads = all.reduce(
      (s, p) => s + (statsMap[p.id]?.fedLeads ?? 0),
      0,
    );
    const totalSpent = all.reduce(
      (s, p) => s + (statsMap[p.id]?.totalSpent ?? 0),
      0,
    );

    const serviceChargeSpent =
      totalSpent + totalSpent * serviceChargeRate().toFixed(2);

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
      totalFedLeads,
      totalLeadsWithFed: totalLeads + totalFedLeads,
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
        spend += metaSpendOf(d);
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
    <Show
      when={!clientRouteError()}
      fallback={
        <section class="w-full px-4 sm:px-6 lg:px-8 py-16 bg-gray-50 dark:bg-gray-900 min-h-screen flex items-center justify-center">
          <div class="max-w-md w-full text-center bg-white dark:bg-gray-800 rounded-2xl shadow-sm ring-1 ring-gray-200 dark:ring-gray-700 px-8 py-10">
            <div class="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-[#AC2334]/10 text-[#AC2334]">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
            <h2 class="text-xl font-bold text-[#14233A] dark:text-white mb-2">
              {clientRouteError()?.type === "error"
                ? "Couldn't load this client"
                : "Client not found"}
            </h2>
            <p class="text-sm text-[#54657E] dark:text-gray-400 mb-6">
              <Show
                when={clientRouteError()?.type === "error"}
                fallback={
                  <>
                    No client matches{" "}
                    <span class="font-semibold text-[#14233A] dark:text-gray-200">
                      "{clientRouteError()?.slug}"
                    </span>
                    . It may have been renamed or removed.
                  </>
                }
              >
                We couldn't load this client's details right now. Please check
                your connection and try again.
              </Show>
            </p>
            <div class="flex items-center justify-center gap-3">
              <A
                href="/"
                class="inline-flex items-center justify-center rounded-lg bg-[#14233A] px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-[#1d3255] transition-colors"
              >
                Back to dashboard
              </A>
              <Show when={clientRouteError()?.type === "error"}>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  class="inline-flex items-center justify-center rounded-lg ring-1 ring-gray-300 dark:ring-gray-600 px-5 py-2.5 text-sm font-medium text-[#14233A] dark:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Try again
                </button>
              </Show>
            </div>
          </div>
        </section>
      }
    >
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
                {isFedAwareViewer() ? "Meta leads" : "Leads generated"}
              </p>
              <p class="text-3xl font-bold text-[#14233A] dark:text-white mt-1.5">
                <CountUp
                  value={overviewStatsCards().totalLeads}
                  loading={ledgerLoading()}
                />
              </p>
              {/* Fed leads sit BESIDE the Meta figure, never inside it — this is
                  the number the client's own dashboard already counts, and it's
                  why a Meta-only dashboard read short against the CM's report. */}
              <Show
                when={
                  isFedAwareViewer() && overviewStatsCards().totalFedLeads > 0
                }
              >
                <p class="text-xs text-[#54657E] dark:text-gray-400 mt-1">
                  +
                  {overviewStatsCards().totalFedLeads.toLocaleString("en-IN")}{" "}
                  fed ·{" "}
                  <b class="text-[#14233A] dark:text-white">
                    {overviewStatsCards().totalLeadsWithFed.toLocaleString(
                      "en-IN",
                    )}
                  </b>{" "}
                  total
                </p>
              </Show>
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
                {/* Cost per META lead. Fed leads cost nothing on Meta, so they
                    are never in this denominator — say so on the privileged
                    views (admin and CM), which both break fed out. */}
                {isFedAwareViewer()
                  ? "Average CPL (per Meta lead)"
                  : "Average CPL"}
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
                {isFedAwareViewer() ? "Meta leads" : "Leads generated"}
              </p>
              <p class="text-xl font-bold text-[#14233A] dark:text-white mt-1">
                <CountUp
                  value={overviewStatsCards().totalLeads}
                  loading={ledgerLoading()}
                />
              </p>
              {/* Fed leads sit BESIDE the Meta figure, never inside it — this is
                  the number the client's own dashboard already counts, and it's
                  why a Meta-only dashboard read short against the CM's report. */}
              <Show
                when={
                  isFedAwareViewer() && overviewStatsCards().totalFedLeads > 0
                }
              >
                <p class="text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                  +
                  {overviewStatsCards().totalFedLeads.toLocaleString("en-IN")}{" "}
                  fed ·{" "}
                  <b class="text-[#14233A] dark:text-white">
                    {overviewStatsCards().totalLeadsWithFed.toLocaleString(
                      "en-IN",
                    )}
                  </b>{" "}
                  total
                </p>
              </Show>
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
                {/* Cost per META lead. Fed leads cost nothing on Meta, so they
                    are never in this denominator — say so on the privileged
                    views (admin and CM), which both break fed out. */}
                {isFedAwareViewer()
                  ? "Average CPL (per Meta lead)"
                  : "Average CPL"}
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
            
              <div class="py-3.5 border-b border-[#E2E8F1] dark:border-gray-700">
                <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                  Spend + {serviceChargePercent()}% service charge
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
            
            {/* <Show when={isAdmin()}>
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
            </Show> */}
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
              {/* Meta-only for admin and CM (fed is broken out beside it); for
                  a client it is already the inclusive total, so the label stays
                  "Total Leads" there. */}
              <th class="p-3" onClick={() => handleSort("totalLeads")}>
                {rangeLabel()}{" "}
                {isFedAwareViewer() ? "Meta Leads" : "Total Leads"}{" "}
                {getSortIcon("totalLeads")}
              </th>
              {/* The SAME three columns for admin and CM. The old admin-only
                  "Extra Leads" column is retired: it printed a fed count beside
                  an already-inclusive total, so the row added up past itself. */}
              <Show when={isFedAwareViewer()}>
                <th class="p-3">{rangeLabel()} Fed Leads</th>
                <th class="p-3">{rangeLabel()} Total (incl. fed)</th>
              </Show>
              <Show when={!iscpl()}>
                <th class="p-3" onClick={() => handleSort("totalSpent")}>
                  {rangeLabel()} Total Spent {getSortIcon("totalSpent")}
                </th>
              </Show>
              <th class="p-3" onClick={() => handleSort("avgCPL")}>
                {rangeLabel()} AVG CPL
                {isFedAwareViewer() ? " (per Meta lead)" : ""}{" "}
                {getSortIcon("avgCPL")}
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
                            (!project.status
                              ? "bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-400 animate-pulse"
                              : project.status === "active"
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
                              (!project.status
                                ? "bg-gray-300 dark:bg-gray-500"
                                : project.status === "active"
                                  ? "bg-[#15966A]"
                                  : project.status === "completed"
                                    ? "bg-[#3E6FB0]"
                                    : project.status === "paused"
                                      ? "bg-[#B07A14]"
                                      : "bg-[#AC2334]")
                            }
                          ></span>
                          {project.status ?? "—"}
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

                      {/* Date-range Leads — Meta only for admin and CM */}
                      <td class="p-2 font-medium text-gray-700 dark:text-gray-100">
                        {stats().totalLeads}
                      </td>

                      <Show when={isFedAwareViewer()}>
                        {/* Fed Leads — "+N", em dash when none */}
                        <td class="p-2 font-medium text-[#15966A] dark:text-green-300">
                          {fmtFed(stats().fedLeads)}
                        </td>
                        {/* Total — the figure the client sees on their own
                            dashboard. Meta + Fed by construction, never more. */}
                        <td class="p-2 font-bold text-[#14233A] dark:text-white">
                          {(
                            stats().totalLeadsWithFed ?? stats().totalLeads
                          ).toLocaleString("en-IN")}
                        </td>
                      </Show>

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

                {/* Leads Total — Meta only for admin and CM */}
                <td>{overviewStats().totalLeads}</td>

                <Show when={isFedAwareViewer()}>
                  {/* Fed total, then Total (incl. fed). Both roll up over ALL
                      projects — the same set totalLeads above sums — so this
                      footer reconciles with the CM's own Daily Report total for
                      the same client and range, and admin's footer matches the
                      CM's line for line. */}
                  <td class="text-[#15966A] dark:text-green-300">
                    {fmtFed(overviewStats().totalFedLeads)}
                  </td>
                  <td>
                    {overviewStats().totalLeadsWithFed.toLocaleString("en-IN")}
                  </td>
                </Show>

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
    </Show>
  );
}
