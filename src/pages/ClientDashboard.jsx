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
import {
  fetchProjects,
  fetchDashboardLedger,
  readDashboardLedger,
  readClientLedger,
  premiumRollup,
  EMPTY_LEDGER,
} from "../services/dashboard";
import { fmtFed } from "../services/fedLeads";
import { fetchAllAdminClients } from "./admin/services/fetchClients";
import { fetchSalesClients } from "../services/sales";
import Avatar from "../components/common/Avatar";
import RowsPerPageSelect from "../components/common/RowsPerPageSelect";
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
import LeadBreakdown from "../components/leads/LeadBreakdown";
import RecordReplacementModal from "../components/leads/RecordReplacementModal";
import RecordDisqualificationModal from "../components/leads/RecordDisqualificationModal";
import {
  fetchDashboardSummary,
  summaryLeadBreakdown,
  showsReplacement,
} from "../services/leadReplacement";
import { canRecordReplacement } from "../stores/currentUser";
import { scopeKey } from "../stores/cmScope";
import SuccessToast, { showToast } from "../components/common/SuccessToast";

// Guards against stale in-flight loads overwriting the cache after the
// dashboard context switches (e.g. admin leaves a client dashboard and returns
// to their own Main Dashboard). Every async loader captures this token when it
// starts and only commits its results to the cache if the token is still
// current. Bumping the token effectively cancels older in-flight loads so a
// slow client-data request can no longer clobber freshly loaded admin data.
let activeLoadToken = 0;
const bumpLoadToken = () => ++activeLoadToken;

// Replaced leads read as a deduction, so a real count shows as "−N"; none shows
// a plain 0 — the batch list genuinely says "nothing replaced" for that project,
// which is a fact, not a gap. (Mirrors fmtFed's "+N" for the column beside it.)
const fmtReplacedLeads = (n) =>
  Number(n) > 0 ? `−${Number(n).toLocaleString("en-IN")}` : "0";

// ── Dev-time ledger invariants ───────────────────────────────────────────────
// Meta + Fed == Total is now the BACKEND's identity: /dashboard/ledger/ returns
// meta_leads, fed_leads and total_leads already reconciled, and this page prints
// them verbatim. That makes a break here a payload bug rather than a join bug —
// which is exactly why the assert stays. A lead lost server-side still surfaces
// as a quietly wrong Meta figure on screen, not as an obvious blank ("Meta 65"
// against a real 66 is how it shipped last time). Dev only.
const DEV_ASSERTS = Boolean(import.meta.env?.DEV);

const assertLeadIdentity = (label, meta, fed, total) => {
  if (!DEV_ASSERTS) return;
  if (meta + fed !== total) {
    console.error(
      `[ledger] ${label}: Meta + Fed != Total (${meta} + ${fed} != ${total}). ` +
        `The /dashboard/ledger/ row does not reconcile — do not patch it here.`,
    );
  }
};

// ── Design-section toggles (UI only) ─────────────────────────────────────────
// The funnel needs impressions/CTR/CPM (not fetched anywhere yet) and the AI
// brief's issue timestamps need the diagnostics service. Until those exist,
// both render with the same "Proposed / Illustrative" tags the approved design
// uses. Flip to false to hide them entirely.
const SHOW_PROPOSED_SECTIONS = true;

// Display thresholds for the "Needs attention" rules (presentation only).
const HOT_CPL_RATIO = 1.4; // CPL > 140% of portfolio average → "running hot"

// The app home — an admin's OWN dashboard, no client selected. This used to be
// "/", but "/" is now the public reporting intro, so the three checks below
// (sweep gate, back-to-home effect, onMount context clear) all key off this one
// constant rather than a literal that could drift apart from the route table.
const HOME_PATH = "/dashboard";

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
  // Ledger opens on live work only — "All" (and every other status) stays one
  // pick away in the dropdown; the filter itself is unchanged.
  const [statusFilter, setStatusFilter] = createSignal("active");
  // Set when an admin lands on a client route whose slug resolves to no client
  // (typo'd / renamed / removed) or the roster lookup fails. Gates the whole
  // dashboard behind a "client not found" state so a stale-cached client's
  // numbers never render under the wrong URL. Shape: { type: "not-found"|"error",
  // slug } or null. See ensureClientContextFromRoute.
  const [clientRouteError, setClientRouteError] = createSignal(null);
  const [searchText, setSearchText] = createSignal("");
  const [selectedColumns, setSelectedColumns] = createSignal([]);
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
  const [currentPage, setCurrentPage] = createSignal(1);
  // Rows-per-page. This table paginates client-side over allProjects(), so the
  // choice only re-slices — no refetch. Persisted so it survives navigation.
  const [rowsPerPage, setRowsPerPage] = createSignal(
    Number(localStorage.getItem("clientDashboardRowsPerPage")) || 20,
  );
  const changeRowsPerPage = (size) => {
    setRowsPerPage(size);
    localStorage.setItem("clientDashboardRowsPerPage", String(size));
    setCurrentPage(1); // the old page number can be past the end once rows grow
  };
  const allProjects = () => projectsCache.allProjects;

  // ── THE ROLE SPLIT ─────────────────────────────────────────────────────────
  // Every role now reads /dashboard/ledger/ — one call, one shape on this side.
  // What differs is which MONEY the endpoint returns, and therefore which reader
  // decodes it:
  //   • admin / CM / sales / coordination / accounts → `spend` + `cpl`, RAW
  //     agency cost, via readDashboardLedger()
  //   • client → `premium_spend` + `premium_cpl` (marked-up for hybrid, leads ×
  //     fixed_cpl for CPL, raw passthrough for retainer, who pay a flat fee), via
  //     readClientLedger(). A client payload carries NO `spend` / `cpl` keys at
  //     all, so a raw figure has no route onto a client's screen.
  // Picking the wrong reader yields a visible zero, never a plausible number that
  // is 23% light — which is the whole point of the two key sets.
  //
  // Read from storage rather than the userRole() signal: this is needed above the
  // component's own `auth` const AND before onMount sets that signal.
  const authRole = () => {
    try {
      return JSON.parse(localStorage.getItem("auth") || "{}")?.role ?? null;
    } catch {
      return null;
    }
  };
  const isClientViewer = () => authRole() === "client";

  // ── Read from global store via accessors ─────────────────────────────────────
  const projects = () => projectsCache.data;
  const loading = () => projectsCache.loading;
  const page = () => projectsCache.meta?.page ?? 1;
  // Slicing/labelling follow the user's rows-per-page choice, not the size the
  // server happened to page at (the table renders the fully swept allProjects()).
  const pageSize = () => rowsPerPage();
  // NOTE: the server pagination meta (total / total_pages / has_next) is no
  // longer read here. The table paginates client-side over the FILTERED set, so
  // the server's count describes a different set than the one on screen — that
  // mismatch is what printed "of 448 results" beside a single searched row.

  // True once the PROJECT LIST itself has been swept in — which is all the
  // mount gate needs now, for every role. The ledger resource owns its own
  // loading state, and no role fetches campaigns from this page any more.
  const hasRenderedProjectData = () => allProjects().length > 0;

  const needsInitialSweep = () =>
    isAllProjectsCacheStale() || !hasRenderedProjectData();

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
  // This is true only while previewing a client: the admin's own home dashboard
  // (no client selected) is meant to be all-clients, and real client logins are
  // force-scoped server-side by their own nomen — so both return ready = true.
  const clientContextReady = () => {
    if (userRole() !== "admin") return true; // clients are server-scoped
    if (location.pathname === HOME_PATH) return true; // admin's own dashboard
    return !!selectedClientId(); // previewing a client → need the Client PK
  };

  // ── Reactively clear client context when navigating back to the Main Dashboard ──
  // Both HOME_PATH and "/:client-nomen-name" render THIS same component, so SolidJS
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
        // this reused instance). Sales' home renders SalesDashboard, so the
        // HOME_PATH branch below only ever fires for admin; the client-route
        // branch runs for both and ensureClientContextFromRoute handles the
        // sales roster.
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
          loadAllProjects();
        };

        // ── Back to admin home (HOME_PATH) ──
        if (pathname === HOME_PATH) {
          setClientRouteError(null); // leaving any not-found / client state behind

          // Clear any selected-client context so only admin's own data is used.
          localStorage.removeItem("selectedClientNomen");
          localStorage.removeItem("selectedClientNomenId");
          localStorage.removeItem("selectedClientId");
          localStorage.removeItem("selectedClientName");

          // Always bust the client cache and reload admin data. This effect fires
          // ONLY when navigating to HOME_PATH FROM a client route within the reused
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
    if (auth?.role === "admin" && window.location.pathname === HOME_PATH) {
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

    // Fire the project-list sweep when the cache is stale OR when there is
    // nothing to render. This guarantees data loads on every reload while still
    // skipping the refetch when valid data is already present. For every role on
    // the ledger the heavy part of this pipeline — every campaign plus every
    // campaign's insights — is gone; what remains is the projects list, which
    // carries the city / type / budget the ledger response doesn't. A client
    // login still chains the two sweeps (see loadAllProjects).
    if (clientContextReady() && needsInitialSweep()) {
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
        if (ready && !wasReady && needsInitialSweep()) {
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

  // The VIEWED client's type, from the same meta.report_summary block as the
  // service charge above. Gates the lead-replacement breakdown: an admin/CM
  // looking at a CPL client must see it even though their own clientRole() says
  // "retainer". Null until the projects response lands → fall back to the
  // viewer's own type flags.
  const [clientTypeFromReport, setClientTypeFromReport] = createSignal(null);

  const serviceChargePercent = () =>
    Number(clientServiceCharge() ?? auth?.serviceCharge ?? 13);

  const serviceChargeRate = () => serviceChargePercent() / 100;

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
      const ct = res?.meta?.report_summary?.client_type;
      if (ct != null) setClientTypeFromReport(String(ct).toLowerCase());

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
        // Seed status counts to 0 — the ledger row fills them. campaign_count
        // is a TOTAL, not an active count; seeding it here flashed the whole
        // project total in the "Active Campaigns" column until the ledger landed.
        activeCampaigns: 0,
        completedCampaigns: 0,
        pausedCampaigns: 0,
        // Seed status to null (skeleton) like the counts above — the backend's
        // Project.status is stale (says "active" while every campaign is
        // paused). statusOf() fills it from the ledger's campaign counts.
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
          // Seed status counts to 0 — the ledger row fills them.
          // campaign_count is a TOTAL, not an active count.
          activeCampaigns: 0,
          completedCampaigns: 0,
          pausedCampaigns: 0,
          // Seed status to null (skeleton) like the counts — the backend's stale
          // Project.status is replaced by statusOf(), which reads the ledger's
          // campaign counts.
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
      // Nothing chains off this for any role. The figures arrive from
      // /dashboard/ledger/, fired by its own resource off the date range rather
      // than by this loader; all that is left here is the projects list, which
      // carries the city / type / budget / logo the ledger response doesn't.
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

  // ── The server-built ledger — every role EXCEPT a client ──────────────────
  // ONE call replaces the browser-side join that used to build every money and
  // lead figure here: fetchAllCampaigns(10_000) + fetchBulkCampaignInsights over
  // every campaign id + the manual-batch, fed-batch and replacement-batch
  // sweeps, all reduced in the tab. For an admin that was the whole agency's
  // data over the wire; /dashboard/ledger/ returns the finished rows in ~0.2s.
  //
  // It returns RAW spend, so a client login must never reach it — see THE ROLE
  // SPLIT above. Both resources below take FALSE as their source for a client,
  // which is what actually stops the call; the endpoint's 403 is the backstop.
  //
  // The rules the old code carried now live behind that endpoint and are
  // deliberately NOT re-derived on this side:
  //   • CPL divides by META leads — fed leads cost nothing on Meta
  //   • fed_leads is ALREADY INSIDE total_leads — never added on top (adding it
  //     is the 108 → 122 double count this page shipped once already)
  //   • campaign status counts are NOT date-filtered
  //
  // SCOPING IS SERVER-SIDE: the same URL hands each role its own slice, so
  // nothing below narrows the returned rows by role — the client carve-out above
  // is about WHICH source a role reads, not about filtering this one. Rows are
  // joined onto the projects list by project_id; that list carries the city /
  // type / budget / logo the ledger response doesn't.
  const ymd = (d) => (!d ? "" : typeof d === "string" ? d : formatDate(d));

  // The CALENDAR range (the date picker), as the endpoint wants it. Empty means
  // "unset": the backend then defaults to month-to-date, and it floors at
  // 2026-04-01 and caps at today itself, so nothing is clamped here.
  //
  const ledgerRangeKey = () => ({
    client: selectedClientNomen() ?? "self",
    scope: scopeKey(),
    start: ymd(fromDate()),
    end: ymd(toDate()),
  });

  // The CARD range (the preset chips above the hero) — a different picker, and
  // routinely a different window, so the hero gets its own request rather than
  // sharing one and drifting from the numbers printed beside it. Returns FALSE
  // when the two windows coincide (the common case: the card range falls back to
  // the calendar range), which stops createResource firing a duplicate call —
  // cardLedger() then reads the calendar response instead.
  const cardRangeKey = () => {
    const cal = ledgerRangeKey();
    const { from, to } = getCardDateRange();
    const start = ymd(from);
    const end = ymd(to);
    if (start === cal.start && end === cal.end) return false;
    return { client: cal.client, scope: cal.scope, start, end };
  };

  // Which client + CM scope a payload belongs to. Stamped on the result so a
  // held-over payload can be checked against the context now on screen — see
  // sticky() below.
  const scopeSigOf = (key) => `${key.client}|${key.scope}`;

  const loadLedger = async (key) => {
    const scopeSig = scopeSigOf(key);
    try {
      const res = await fetchDashboardLedger({
        startDate: key.start || undefined,
        endDate: key.end || undefined,
      });
      // The reader must match the shape the backend sent for this role: a
      // client payload carries premium_spend / premium_cpl and NO spend / cpl,
      // so readDashboardLedger would read a raw key that isn't there and total
      // ₹0 — visibly wrong, which is the failure mode we want. This is the ONLY
      // place the two decoders are chosen between.
      const read = isClientViewer() ? readClientLedger : readDashboardLedger;
      return { ...read(res), scopeSig };
    } catch (err) {
      // A failed ledger must NOT read as "this client spent nothing" — loaded
      // stays false so nothing treats the zeros as real. But it IS settled: the
      // request is over, and leaving it unsettled would leave every counter
      // climbing forever on an error.
      console.error("[ClientDashboard] /dashboard/ledger/ failed:", err);
      return { ...EMPTY_LEDGER, scopeSig, settled: true };
    }
  };

  const [ledgerRes] = createResource(ledgerRangeKey, loadLedger);
  const [cardLedgerRes] = createResource(cardRangeKey, loadLedger);

  // Solid keeps the previously resolved payload readable while a refetch is in
  // flight, rather than dropping back to undefined. For a DATE-RANGE change that
  // is exactly right: the figures hold their last values instead of blanking to
  // zero and re-running every count-up animation.
  //
  // For a CLIENT SWITCH it is exactly wrong — the previous client's money would
  // sit on screen until the new request lands. So a payload is only accepted
  // when it is stamped with the client + CM scope currently on screen; anything
  // else falls back to the placeholder, and the counters go honestly back to
  // their loading state. (Verified both ways against the Solid runtime rather
  // than assumed: a mutable "last good" wrapper looked correct and was not.)
  const scopedLedger = (res, keyFn) => () => {
    const key = keyFn();
    const scopeSig = key === false ? null : scopeSigOf(key);
    const value = res();
    return value && value.scopeSig === scopeSig ? value : EMPTY_LEDGER;
  };

  const ledger = scopedLedger(ledgerRes, ledgerRangeKey);
  const cardLedgerOwn = scopedLedger(cardLedgerRes, cardRangeKey);
  const cardLedger = () =>
    cardRangeKey() === false ? ledger() : cardLedgerOwn();

  // The projects list has been swept at least once this session. The store is
  // never hydrated from storage, so this starts at 0 on every load — which is
  // what separates "not loaded yet" from "this client genuinely has no
  // projects". Without that distinction an empty portfolio leaves the counters
  // climbing forever.
  const projectsSwept = () => Number(projectsCache.lastFetchedAll) > 0;

  // ── When a counter may animate ─────────────────────────────────────────────
  // A counter must never animate to a number that isn't real data. It has real
  // data only when BOTH halves have landed: the ledger payload AND the projects
  // list its rows are joined onto. The ledger answers in ~0.2s, well ahead of
  // the paginated projects sweep, so gating on the ledger alone flips loading
  // off while every project row is still missing — the counter reveals to 0,
  // latches "revealed", and then jumps when the projects arrive. That is the
  // climb → 0 → climb the hero was doing on login.
  //
  // The hero reads the CARD ledger, so this waits on THAT resource, not the
  // calendar one. Waiting on the wrong one was the second half of the same bug:
  // with two different date windows the calendar ledger settles first and would
  // release the animation while the hero's own payload is still out.
  const heroLoading = () => !(projectsSwept() && cardLedger().settled);

  const ledgerRowOf = (projectId) => ledger().byProject[String(projectId)];

  // Admin and CM both show the Meta / Fed / Total split; a client sees one
  // (already inclusive) leads figure. One flag drives every header, cell and
  // label so the two privileged ledgers cannot drift apart visually either.
  const isCMViewer = () => auth?.role === "campaign_manager";
  const isFedAwareViewer = () => isAdmin() || isCMViewer();

  // ── Project status, from the ledger's campaign counts ─────────────────────
  // Same rule the per-project campaign sweep used to apply: anything still
  // running → active; every campaign completed → completed; otherwise paused.
  // Those counts are NOT date-filtered server-side, which is the point — a
  // now-paused campaign that spent earlier in the range must not read as active.
  // Before the response lands we keep the project's existing status (null on a
  // first load), so the badge holds its skeleton instead of flashing "paused".
  const statusOf = (project) => {
    const row = ledgerRowOf(project.id);
    if (!row) return ledger().loaded ? "paused" : (project.status ?? null);
    if (row.campaignsTotal <= 0) return "paused";
    if (row.campaignsActive > 0) return "active";
    if (row.campaignsCompleted >= row.campaignsTotal) return "completed";
    return "paused";
  };

  // The projects list with its status resolved. EVERYTHING that reads a
  // project's status — the badge, the status filter, the footer's active count —
  // goes through this, so they cannot disagree about the same project.
  const statusedProjects = createMemo(() =>
    allProjects().map((p) => ({ ...p, status: statusOf(p) })),
  );

  // ── THE filtered set ───────────────────────────────────────────────────────
  // Every row that matches EVERY active filter — the status dropdown and the
  // search box. There is exactly one of these, and the table body, the Total
  // row, the "of N results" count and the page count all read it, so the footer
  // can never describe a set the reader cannot see. Searching one project used
  // to leave agency-wide totals under a single row because the footer applied
  // only the status filter.
  //
  // Pagination is deliberately NOT applied here: a Total row is the total of
  // everything that matches, not of the page you happen to be on, and
  // "Showing 1–20 of 34" already names that difference.
  //
  // This is also why the footer sums the SERVER's per-row figures instead of
  // printing the response's own `totals` block: that block covers the caller's
  // whole scope by design and cannot know a client-side filter. One rule — sum
  // the matching rows, always — rather than switching sources when a filter
  // happens to be off.
  const matchingProjects = createMemo(() => {
    let data = statusedProjects();

    if (statusFilter() !== "all") {
      data = data.filter((x) => x.status === statusFilter());
    }

    const query = searchText().trim().toLowerCase();
    if (query) {
      data = data.filter((x) =>
        [x.name, x.location, x.type, x.status]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(query)),
      );
    }

    return data;
  });

  // Footer Premium CPL — Σ premium spend ÷ Σ premium leads over the rows on
  // screen, so it narrows with the search box and the status dropdown like every
  // other total in this row. `covered` is how many of those rows actually had a
  // premium figure; the rest have no display config and are outside this average.
  const ledgerPremiumTotals = () =>
    premiumRollup(matchingProjects().map((p) => allProjectStats()[p.id]));

  // Ledger footer totals for the Replaced / Billable pair — Σ of the same
  // per-row figures those columns print, so the footer equals the sum of the
  // column above it.
  const ledgerReplacedTotals = () => {
    let replaced = 0;
    let billable = 0;
    for (const p of matchingProjects()) {
      const row = ledgerRowOf(p.id);
      replaced += row?.replacedLeads ?? 0;
      billable += row?.billableLeads ?? 0;
    }
    return { replaced, billable };
  };

  // ── Per-project stats, straight off one ledger response ────────────────────
  // The hero and the ledger table share this builder, so they can only ever
  // differ by their date range — never by rule. Nothing here recomputes a figure
  // the backend already decided; it renames fields and asserts the identity.
  const statsFromLedger = (led, projects) => {
    const result = {};
    for (const project of projects) {
      const row = led.byProject[String(project.id)];

      // fed_leads is ALREADY INSIDE total_leads. `inclusive` is that total,
      // printed as returned — the two are never added together.
      const metaLeads = row?.metaLeads ?? 0;
      const rowFed = row?.fedLeads ?? 0;
      const inclusive = row?.totalLeads ?? metaLeads + rowFed;

      // WHICH figure the viewer's primary leads column shows:
      //   • admin / CM — Meta only, with Fed and Total broken out beside it
      //   • client     — ONE column, and it must be the INCLUSIVE total. Handing
      //     them meta_leads under a "Total Leads" header silently drops every
      //     fed lead they were delivered.
      const fedAware = isFedAwareViewer();
      const totalLeads = fedAware ? metaLeads : inclusive;
      const fedLeads = fedAware ? rowFed : 0;
      const totalLeadsWithFed = inclusive;
      assertLeadIdentity(
        `project ${project.name ?? project.id}`,
        totalLeads,
        fedLeads,
        totalLeadsWithFed,
      );
      result[project.id] = {
        totalLeads,
        fedLeads,
        totalLeadsWithFed,
        totalSpent: row?.spend ?? 0,
        // Cost per META lead — already divided that way server-side. null (no
        // Meta leads to divide by) prints as ₹0, exactly as it did before.
        avgCPL: row?.cpl ?? 0,
        // Premium CPL — the marked-up, client-facing figure, beside the raw one.
        // Null on ~2/3 of rows for two legitimate reasons: a retainer client has
        // no display config by design, and some client+project pairs are missing
        // one. Both must stay null so the cell prints "—"; defaulting to 0 would
        // claim the client was billed nothing.
        modifiedCpl: row?.premiumCpl ?? null,
        // The pair the footer's roll-up divides. Kept as spend AND leads rather
        // than just the per-row CPL, because a weighted total needs the
        // denominator — and premium leads are not Meta leads for a CPL client.
        premiumSpend: row?.premiumSpend ?? null,
        premiumLeads: row?.premiumLeads ?? null,
        activeCampaigns: row?.campaignsActive ?? 0,
        completedCampaigns: row?.campaignsCompleted ?? 0,
        pausedCampaigns: row?.campaignsPaused ?? 0,
      };
    }
    return result;
  };

  // ── Replaced → Billable ────────────────────────────────────────────────────
  // Both figures come straight off the ledger row, for every role. They used to
  // need their own paginated batch sweep — /leads/replacement-batches/ for
  // admin/CM, /leads/my-replacements/ for a client — plus a client-side
  // received_date + revoked roll-up. The backend applies those rules now, from
  // one source.
  const replacedOf = (projectId) => ledgerRowOf(projectId)?.replacedLeads ?? 0;

  // total − replaced, as the backend computed it. Deliberately NOT re-derived
  // from the row's own Total: the footer sums billable_leads, and a cell that
  // subtracts for itself is precisely how a column and its own total drift.
  const billableOf = (projectId) => ledgerRowOf(projectId)?.billableLeads ?? 0;

  // Only grow the Replaced / Billable columns once this client actually has
  // replacement activity in the range — replacements are a CPL/hybrid concept,
  // and a retainer client would otherwise get two columns of zeros. Within the
  // table every project still shows its own 0.
  const showReplacedCols = () => ledger().rows.some((r) => r.replacedLeads > 0);

  // The hero reads the CARD range, the ledger table reads the CALENDAR range.
  const cardStats = createMemo(() =>
    statsFromLedger(cardLedger(), statusedProjects()),
  );

  const allProjectStats = createMemo(() =>
    statsFromLedger(ledger(), statusedProjects()),
  );

  // The matching rows with their ledger figures joined on — the sortable shape.
  // Filtering happens in matchingProjects() and NOT again here, so the table and
  // the footer are guaranteed to be looking at the same rows.
  const matchingRows = createMemo(() =>
    matchingProjects().map((project) => {
      const stats = allProjectStats()[project.id] || {};

      return {
        ...project,
        totalLeads: stats.totalLeads || 0,
        totalSpent: stats.totalSpent || 0,
        avgCPL: Number(stats.avgCPL || 0),
        activeCampaigns: stats.activeCampaigns || 0,
        completedCampaigns: stats.completedCampaigns || 0,
        pausedCampaigns: stats.pausedCampaigns || 0,
        modifiedCpl: stats.modifiedCpl ?? null,
      };
    }),
  );

  // What the table body renders: the matching rows, sorted, sliced to the page.
  const filteredProjects = createMemo(() => {
    const data = sortData(matchingRows());
    const startIndex = (currentPage() - 1) * pageSize();
    return data.slice(startIndex, startIndex + pageSize());
  });

  // ── What the Total row is the total OF ─────────────────────────────────────
  // The status filter defaults to "active", so out of the box the Total row
  // EXCLUDES every paused and completed project. That is intended, but it is
  // invisible: the number just looks like the client's total, and the first
  // person to reconcile it against a bill loses an hour finding out why it is
  // short. So the footer states its own scope, in every state — including the
  // unfiltered one, because "all 34 projects" is the sentence that makes the
  // narrowed version legible when it appears.
  const footerScope = createMemo(() => {
    const shown = matchingProjects().length;
    const all = statusedProjects().length;

    const parts = [];
    if (statusFilter() !== "all") parts.push(`${statusFilter()} only`);
    const query = searchText().trim();
    if (query) parts.push(`matching “${query}”`);

    if (parts.length === 0)
      return { narrowed: false, note: `all ${all} projects` };

    return {
      narrowed: true,
      note: `${shown} of ${all} projects · ${parts.join(" · ")}`,
    };
  });

  // How many pages the matching set fills — at least 1, so an empty result reads
  // "Page 1 of 1" rather than "Page 1 of 0".
  const filteredPageCount = () =>
    Math.max(1, Math.ceil(matchingProjects().length / pageSize()));

  // A filter change re-slices the set, so the page the reader was on can end up
  // past the end — searching from page 3 rendered an empty table under a
  // populated footer. Go back to the first page whenever the set changes.
  createEffect(
    on([statusFilter, searchText], () => setCurrentPage(1), { defer: true }),
  );

  // Ledger footer only. Scoped to the status the ledger is showing — with the
  // filter on "All" this is every project, exactly as before.
  const overviewStats = createMemo(() => {
    const all = matchingProjects();
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
    // Admin + CM (0 for a client). Summed over the same project set as
    // totalLeads above, so the ledger footer's "Total (incl. fed)" reconciles
    // with the CM's own Daily Report total for the same client and range — and
    // with what the client sees on their own dashboard — whenever the status
    // filter is on "All". Narrow the filter and both figures narrow together.
    const totalFedLeads = all.reduce(
      (s, p) => s + (statsMap[p.id]?.fedLeads ?? 0),
      0,
    );
    const totalSpent = all.reduce(
      (s, p) => s + (statsMap[p.id]?.totalSpent ?? 0),
      0,
    );
    // Number, not the string .toFixed() returns — same reason as the hero tiles'
    // avgCPL in overviewStatsCards below: the footer renders this as ₹, and
    // String.prototype.toLocaleString is a silent no-op, so a string can never be
    // grouped. Also drops a redundant parseFloat() of something already numeric.
    const avgCPL =
      totalLeads > 0 ? Number((totalSpent / totalLeads).toFixed(2)) : 0;
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
    const all = statusedProjects();
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

    // Round the RESULT, not the rate. `serviceChargeRate().toFixed(2)` bound to
    // the rate: the multiplication still worked (JS coerced "0.10" back to a
    // number) but nothing was ever rounded, so the hero rendered the raw float
    // as ₹1,80,202.022 — toLocaleString defaults to 3 fraction digits.
    const serviceChargeSpent = Number(
      (totalSpent + totalSpent * serviceChargeRate()).toFixed(2),
    );

    // Admin view: spend + 18% GST (client view uses serviceChargeSpent above)
    const gstSpent = Number((totalSpent + totalSpent * 0.18).toFixed(2));

    // Number, not the string .toFixed() returns: this is rendered via
    // .toLocaleString("en-IN"), and String's toLocaleString is a no-op that
    // silently dropped the thousands grouping ("180202.02", not "1,80,202.02").
    // Callers that already wrap it in Number() are unaffected.
    const avgCPL =
      totalLeads > 0 ? Number((totalSpent / totalLeads).toFixed(2)) : 0;
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

  // ₹ to 2dp with Indian grouping. The ledger returns CPL as a number, and a
  // bare number loses both the trailing zero and the grouping that every other
  // money cell in this table has ("1517.2", not "1,517.20").
  const inr2 = (n) =>
    Number(n || 0).toLocaleString("en-IN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  // Premium CPL under the raw CPL is possible and MEANINGFUL, not a glitch — so
  // the row gets flagged rather than printed flat. On a project shared by several
  // clients, premium_spend only counts the clients that have a display config
  // while raw spend counts them all, so an unconfigured client drags premium
  // below raw (FaridabadEvent: raw ₹150.49 vs premium ₹134.44, two of its four
  // clients unconfigured). A CPL client billed under what their ads cost does the
  // same thing. Either reading is worth a second look; both are invisible if the
  // two numbers just sit next to each other.
  const premiumBelowRaw = (premium, raw) =>
    premium != null && Number(raw) > 0 && Number(premium) < Number(raw);

  // ── Lead replacement breakdown (GET /dashboard/summary/) ──────────────────
  // The ledger's leads/spend are still derived from the campaign sweep — this is
  // a separate, small read purely for the Generated → Replaced → Billable
  // progression, which only the backend can compute (it owns the replacement
  // batches). Keyed on the client context AND the date range so switching either
  // refetches; a failure resolves to null and the section simply doesn't render,
  // because a dashboard that can't reach this endpoint must not imply "zero
  // replacements".
  const [summaryRes, { refetch: refetchSummary }] = createResource(
    () => ({
      client: selectedClientNomen() ?? "self",
      scope: scopeKey(),
      from: fromDate(),
      to: toDate(),
    }),
    async (key) => {
      try {
        return await fetchDashboardSummary({
          startDate: key.from || undefined,
          endDate: key.to || undefined,
        });
      } catch (err) {
        console.error("ClientDashboard: dashboard summary failed", err);
        return null;
      }
    },
  );

  const leadBreakdown = createMemo(() => summaryLeadBreakdown(summaryRes()));

  // Prefer the REPORTED client's type over the viewer's own — an admin looking
  // at a CPL client must see the progression.
  const viewedClientType = () =>
    clientTypeFromReport() ??
    (iscpl() ? "cpl" : ishybrid() ? "hybrid" : isRetainer() ? "retainer" : "");

  const showLeadBreakdown = () =>
    showsReplacement(leadBreakdown(), viewedClientType());

  // "Record Replacement" — admin + tier-1 CM only (canRecordReplacement()).
  const [showReplacementForm, setShowReplacementForm] = createSignal(false);

  // "Record Disqualification" — same permission, but the action is CPL-only
  // (the create endpoint 400s a hybrid or retainer client), so the button is
  // additionally hidden on a client we KNOW isn't CPL. An unknown type still
  // shows it: the backend stays the authority, and hiding on a missing field
  // would strand a legitimate CPL client with no way to record.
  const [showDisqualificationForm, setShowDisqualificationForm] =
    createSignal(false);
  const canDisqualifyViewedClient = () => {
    const type = viewedClientType();
    return !type || type === "cpl";
  };

  // Project rows joined with their card-range stats (the same stats the old
  // KPI cards used), reused by hero / signals / charts below.
  const projectCardRows = createMemo(() => {
    const map = cardStats();
    return statusedProjects().map((p) => ({
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

  // ── Proposed funnel: real Impression→Lead metrics ─────────────────────────
  // Sums the CARD-range ledger rows — impressions, clicks, spend and leads are
  // all on them — and derives only the ratios (CPM, CTR, CPC, click-to-lead)
  // the payload doesn't carry. It used to sum the per-day insight rows for every
  // campaign of every project in the browser.
  const funnelStats = createMemo(() => {
    // Summed over the SAME rows the hero tiles beside it sum — the ledger rows
    // joined onto this client's projects — rather than the response's `totals`
    // block. That block covers the caller's whole scope, so if it ever described
    // a wider set than the projects on screen, the funnel would quietly disagree
    // with the tile printed next to it. Nothing on this page reads `totals`.
    const byProject = cardLedger().byProject;
    let impressions = 0;
    let clicks = 0;
    let leads = 0;
    let metaLeads = 0;
    let spend = 0;

    for (const project of statusedProjects()) {
      const row = byProject[String(project.id)];
      if (!row) continue;
      impressions += row.impressions;
      clicks += row.clicks;
      leads += row.totalLeads;
      metaLeads += row.metaLeads;
      spend += row.spend;
    }

    // `reach` has never been returned by any of these endpoints, so frequency
    // stays unavailable — hasReach gates the one cell that wanted it.
    const reach = 0;

    return {
      impressions,
      reach,
      clicks,
      leads,
      spend,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : 0,
      frequency: 0,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : 0,
      cpc: clicks > 0 ? spend / clicks : 0,
      clickToLead: clicks > 0 ? (leads / clicks) * 100 : 0,
      // Per META lead — the backend's own rule, applied to the summed rows.
      cpl: metaLeads > 0 ? spend / metaLeads : 0,
      hasReach: false,
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
    setStatusFilter("active");
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
                href="/dashboard"
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
          {/* pl-[46px] = the 36px tile + the 10px gap in the h1 below, so the
              eyebrow and the description line up with the heading TEXT and the
              tile hangs to the left of the whole block. */}
         
          {/* Icon tile + gradient wordmark. The tile carries the crimson→gold
              solid so the heading reads at a glance even where the gradient
              text is thin; `pb-0.5` keeps bg-clip-text from shaving the
              descender off the "j"-height glyphs. */}
          <h1 class="flex items-center gap-2.5 text-2xl font-bold mb-1">
            <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7E1522] via-[#AC2334] via-70% to-[#C4802B] text-white shadow-[0_2px_8px_rgba(126,21,34,.32)]">
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </span>
            {/* Crimson holds the word; gold is a highlight on the tail, not an
                equal partner. via-72% is what keeps the ramp off the middle. */}
            <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
              Active Projects
            </span>
          </h1>
          <p class="pl-[46px] text-md text-[#54657E] dark:text-gray-400">
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
        <Show
          when={
            (userRole() === "admin" ||
              userRole() === "campaign_manager" ||
              userRole() === "sales") &&
            selectedClientNomen()
          }
        >
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

      {/* Record Replacement — admin + TIER-1 CM only. Tier-2 CMs, clients,
          sales and accounts never see it (the endpoint 403s them anyway).
          Recording refetches the summary so the new Replaced/Billable figures
          appear without a reload. */}
      <Show when={canRecordReplacement()}>
        <div class="flex flex-wrap justify-end gap-2 mb-4">
          <button
            onClick={() => setShowReplacementForm(true)}
            class="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#AC2334]/30 bg-[#FBEEF0] text-[#AC2334] text-sm font-bold hover:bg-[#AC2334] hover:text-white transition dark:bg-red-900/30 dark:text-red-300 dark:border-red-700 dark:hover:bg-red-900/50"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Record Replacement
          </button>
          {/* CPL-only twin — count of unbillable leads, no credit amount. */}
          <Show when={canDisqualifyViewedClient()}>
            <button
              onClick={() => setShowDisqualificationForm(true)}
              class="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#AC2334]/30 bg-[#FBEEF0] text-[#AC2334] text-sm font-bold hover:bg-[#AC2334] hover:text-white transition dark:bg-red-900/30 dark:text-red-300 dark:border-red-700 dark:hover:bg-red-900/50"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
              Record Disqualification
            </button>
          </Show>
        </div>
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
                  loading={heroLoading()}
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
        <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-4 sm:p-8 mb-8 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6 lg:gap-12 items-start">
          {/* min-w-0: a grid track defaults to min-content, so a long
              non-wrapping figure would otherwise widen the card past the
              viewport instead of shrinking inside it. */}
          <div class="min-w-0">
            <p class="text-sm text-[#54657E] dark:text-gray-400 font-medium mb-1">
              Total spend till date
            </p>
            <h2 class="text-xl sm:text-2xl font-bold tracking-tight text-gray-700 dark:text-white break-words">
              {"₹"}
              <CountUp
                value={overviewStatsCards().totalSpent}
                loading={heroLoading()}
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
                      {/* The caption is far wider than the tick it hangs off,
                          so centring it spills past the card near the ends of
                          the month — on a phone that gives the whole page a
                          sideways scroll. Anchor it to whichever side of the
                          tick still has room. */}
                      <span
                        class="absolute -top-7 whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-[#14233A] dark:text-white"
                        style={
                          heroPacing().calendarPct > 70
                            ? "right:0"
                            : heroPacing().calendarPct < 30
                              ? "left:0"
                              : "left:50%;transform:translateX(-50%)"
                        }
                      >
                        Today · Day {heroPacing().dayOfMonth} of{" "}
                        {heroPacing().daysInMonth}
                      </span>
                    </div>
                  </Show>
                </div>
                <div class="flex justify-between gap-2 mt-2 text-xs font-medium text-[#8593A8] dark:text-gray-500">
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
          {/* Stacked under the spend block on a phone, two-up on a tablet, and
              back to a single rail beside the spend block on desktop. */}
          <div class="grid grid-cols-1 sm:grid-cols-2 sm:gap-x-8 lg:grid-cols-1 border-t lg:border-t-0 lg:border-l border-[#E2E8F1] dark:border-gray-700 pt-4 lg:pt-0 lg:pl-9">
            <div class="py-3.5 border-b border-[#E2E8F1] dark:border-gray-700">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                {isFedAwareViewer() ? "Meta leads" : "Leads generated"}
              </p>
              <p class="text-xl font-bold text-[#14233A] dark:text-white mt-1">
                <CountUp
                  value={overviewStatsCards().totalLeads}
                  loading={heroLoading()}
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
                    loading={heroLoading()}
                  />
                </p>
                <p class="text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                  (including 18% GST)
                </p>
              </div>
            </Show> */}
            {/* Bordered only in the two-up tablet layout, where it shares a
                row with the tile above it. */}
            <div class="py-3.5 border-b max-sm:border-b-0 lg:border-b-0 border-[#E2E8F1] dark:border-gray-700">
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

      {/* ════════ LEAD REPLACEMENT ════════
          Generated → Replaced → Billable, straight off the dashboard summary.
          CPL/hybrid always (it's how they're billed); everyone else only once a
          replacement has actually been recorded. Retainer clients never see it.
          The ledger above stays on the leads GENERATED — this section is the one
          place the deduction is explained. */}
      <Show when={showLeadBreakdown()}>
        <LeadBreakdown
          class="mb-8"
          title={`Lead replacement · ${rangeLabel()}`}
          breakdown={leadBreakdown()}
          note="Replaced leads are credited back on the client's bill. Utilisation and CPL above stay on true ad spend."
        />
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
          class="border border-[#E2E8F1]  dark:border-gray-600 px-3 py-2 rounded-lg flex-1 min-w-[240px] max-w-[420px] bg-gray-50 dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
        />

        {/* Sorting lives on the column headers (useColumnSort) — the old
            "Sort by" dropdown fed a signal nothing read, so it was removed. */}

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
              {/* Total → Replaced → Billable reads as one progression */}
              <Show when={showReplacedCols()}>
                <th class="p-3 text-[#AC2334] dark:text-red-400">Replaced</th>
                <th class="p-3">Billable</th>
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

                      {/* Replaced → Billable — credited back, then charged.
                          Billable comes off the inclusive total (Meta + fed),
                          which is the figure the client is billed against. Both
                          are printed as the ledger returned them. */}
                      <Show when={showReplacedCols()}>
                        <td class="p-2 font-semibold text-[#AC2334] dark:text-red-400">
                          {fmtReplacedLeads(replacedOf(project.id))}
                        </td>
                        <td class="p-2 font-bold text-[#14233A] dark:text-white">
                          {billableOf(project.id).toLocaleString("en-IN")}
                        </td>
                      </Show>

                      {/* Date-range Spent */}
                      <Show when={!iscpl()}>
                        <td class="p-2 font-medium text-gray-700 dark:text-gray-100">
                          {"₹"}
                          {stats().totalSpent.toLocaleString("en-IN")}
                        </td>
                      </Show>

                      {/* Date-range AVG CPL — spend ÷ META leads, divided
                          server-side. Fed leads cost nothing on Meta, so this is
                          never re-derived off the inclusive total here. */}
                      <td class="p-2 font-medium text-gray-700 dark:text-gray-100">
                        {"₹"}
                        {inr2(stats().avgCPL)}
                      </td>
                      {/* Premium CPL — what the client is billed per lead,
                          beside the raw Meta cost. "—" where there is no figure:
                          a retainer client has no display config by design, and
                          some client+project pairs are missing one. That blank is
                          correct and is never filled with a 0. */}
                      <Show when={isAdmin()}>
                        <td class="p-3 font-medium">
                          <Show
                            when={
                              project.modifiedCpl !== null &&
                              project.modifiedCpl !== undefined
                            }
                            fallback={
                              <span
                                class="text-[#8593A8] dark:text-gray-500"
                                title="No premium figure for this project in this range — either a retainer client (no display config by design) or a client+project pair whose config is missing."
                              >
                                —
                              </span>
                            }
                          >
                            <span
                              class={
                                premiumBelowRaw(
                                  project.modifiedCpl,
                                  project.avgCPL,
                                )
                                  ? "text-[#B07A14] dark:text-yellow-300"
                                  : "text-gray-700 dark:text-gray-100"
                              }
                              title={
                                premiumBelowRaw(
                                  project.modifiedCpl,
                                  project.avgCPL,
                                )
                                  ? "Premium is BELOW raw. Usually a shared project where not every client has a display config — that spend counts in raw but not in premium. Can also mean a CPL client is billed under what their ads cost."
                                  : undefined
                              }
                            >
                              {"₹"}
                              {inr2(project.modifiedCpl)}
                            </span>
                          </Show>
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
                  {/* Amber when the set is narrowed — the same "heads up, this
                      is not everything" tone the paused badges use. */}
                  <div
                    class={
                      "mt-0.5 font-normal normal-case tracking-normal text-[11px] leading-tight whitespace-normal " +
                      (footerScope().narrowed
                        ? "text-[#B07A14] dark:text-yellow-300"
                        : "text-[#8593A8] dark:text-gray-400")
                    }
                  >
                    {footerScope().note}
                  </div>
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
                  {/* Fed total, then Total (incl. fed). Both roll up over the
                      status-scoped project set — the same set totalLeads above
                      sums — so on "All" this footer reconciles with the CM's own
                      Daily Report total for the same client and range, and
                      admin's footer matches the CM's line for line. */}
                  <td class="text-[#15966A] dark:text-green-300">
                    {fmtFed(overviewStats().totalFedLeads)}
                  </td>
                  <td>
                    {overviewStats().totalLeadsWithFed.toLocaleString("en-IN")}
                  </td>
                </Show>

                {/* Replaced / Billable totals — Σ of the per-row figures the
                    columns print, floor included, so the footer equals the sum
                    of the column above it. */}
                <Show when={showReplacedCols()}>
                  <td class="text-[#AC2334] dark:text-red-400">
                    {fmtReplacedLeads(ledgerReplacedTotals().replaced)}
                  </td>
                  <td>
                    {ledgerReplacedTotals().billable.toLocaleString("en-IN")}
                  </td>
                </Show>

                {/* Spent Total */}
                <Show when={!iscpl()}>
                  <td>
                    {"₹"}
                    {overviewStats().totalSpent.toLocaleString("en-IN")}
                  </td>
                </Show>

                {/* Avg CPL — grouped and 2dp like the column above it */}
                <td>
                  {"₹"}
                  {inr2(overviewStats().avgCPL)}
                </td>
                {/* Premium CPL total — Σ premium spend ÷ Σ premium LEADS, never
                    the average of the per-row CPLs and never divided by Meta
                    leads (a CPL client is billed on a different lead basis).
                    Covers only the rows that HAVE a premium figure, which is
                    fewer than the rows above it — the subtext says how many, so
                    a reader reconciling this against the raw total beside it can
                    see the gap instead of hunting for it. */}
                <Show when={isAdmin()}>
                  <td>
                    <Show
                      when={ledgerPremiumTotals().cpl != null}
                      fallback={
                        <span
                          class="text-[#8593A8] dark:text-gray-500"
                          title="No project in view has a premium figure — retainer clients have no display config by design, and some client+project pairs are missing one."
                        >
                          —
                        </span>
                      }
                    >
                      <span
                        class={
                          premiumBelowRaw(
                            ledgerPremiumTotals().cpl,
                            overviewStats().avgCPL,
                          )
                            ? "text-[#B07A14] dark:text-yellow-300"
                            : ""
                        }
                        title={
                          premiumBelowRaw(
                            ledgerPremiumTotals().cpl,
                            overviewStats().avgCPL,
                          )
                            ? "Premium is BELOW raw across these projects — spend with no display config counts in raw but not in premium. Expected while configs are outstanding."
                            : undefined
                        }
                      >
                        {"₹"}
                        {inr2(ledgerPremiumTotals().cpl)}
                      </span>
                      <div class="mt-0.5 font-normal normal-case tracking-normal text-[11px] leading-tight whitespace-normal text-[#8593A8] dark:text-gray-400">
                        {ledgerPremiumTotals().covered} of{" "}
                        {matchingProjects().length} priced
                      </div>
                    </Show>
                  </td>
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
      <div class="flex items-center justify-between mt-5 mb-4 flex-wrap gap-3">
        <div class="flex items-center gap-3">
          <span class="text-sm text-[#8593A8] dark:text-gray-400">
            {matchingProjects().length === 0
              ? "No results"
              : `Showing ${(currentPage() - 1) * pageSize() + 1}–${Math.min(
                  currentPage() * pageSize(),
                  matchingProjects().length,
                )} of ${matchingProjects().length} results`}
          </span>

          <RowsPerPageSelect
            value={rowsPerPage()}
            onChange={changeRowsPerPage}
          />
        </div>

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
            Page {currentPage()} of {filteredPageCount()}
          </span>

          <button
            onClick={() =>
              currentPage() < filteredPageCount() &&
              setCurrentPage(currentPage() + 1)
            }
            disabled={currentPage() >= filteredPageCount()}
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

      {/* Record Replacement — mounted only for admin + tier-1 CM. On success we
          refetch the summary so the Replaced/Billable figures update in place. */}
      <Show when={canRecordReplacement()}>
        <RecordReplacementModal
          open={showReplacementForm()}
          onClose={() => setShowReplacementForm(false)}
          clientId={selectedClientId() || undefined}
          onRecorded={(r) => {
            refetchSummary();
            showToast(
              `${r.count} lead${r.count === 1 ? "" : "s"} credited back on "${r.projectName}".`,
              "Replacement recorded",
            );
          }}
        />
        {/* Record Disqualification — same gate, CPL clients only. Recording
            refetches the summary so the new qualified-lead figures land
            without a reload, exactly as the replacement form does. */}
        <RecordDisqualificationModal
          open={showDisqualificationForm()}
          onClose={() => setShowDisqualificationForm(false)}
          clientId={selectedClientId() || undefined}
          onRecorded={(r) => {
            refetchSummary();
            showToast(
              `${r.count} lead${r.count === 1 ? "" : "s"} disqualified on "${r.projectName}".`,
              "Disqualification recorded",
            );
          }}
        />
        <SuccessToast />
      </Show>
    </section>
    </Show>
  );
}
