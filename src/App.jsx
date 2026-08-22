import { Router, Route, Navigate } from "@solidjs/router";
import { ThemeProvider } from "./context/ThemeContext";
import { SidebarProvider } from "./context/SidebarContext";
import { useSidebar } from "./context/SidebarContext";
import { useNavigate } from "@solidjs/router";
import { onMount, onCleanup } from "solid-js";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import CMBanner from "./components/CMBanner";
import SuspendedAccountsBanner from "./components/SuspendedAccountsBanner";
import TricolourWash from "./components/common/TricolourWash";
import MainDashboard from "./pages/ClientDashboard";
import AddProject from "./pages/AddProjects";
import Billing from "./pages/Billing";
import ClientDelivery from "./pages/Client-Delivery";
import PerformingProjects from "./pages/PerformingProjects";
import Settings from "./pages/Settings";
import Notifications from "./pages/Alert";
import ProjectDetails from "./pages/ProjectDetails";
import CampaignDetails from "./pages/CampaignDetails";
import Activity from "./pages/Activity";
import Login from "./pages/login/LoginForm";
import ProtectedRoute from "./routes/ProtectedRoute";
import LeadsPage from "./pages/LeadPerformance";
import Leads from "./pages/Leads";
import FollowUp from "./pages/FollowUp";
import DailyReports from "./pages/DailyReports";
import MyTeam from "./pages/MyTeam";
import Clients from "./pages/admin/client/Clients";
import ImpersonationBanner from "./pages/admin/component/ImpersonationBanner";
import ProjectDisplayConfig from "./pages/admin/client/ProjectDisplayConfig";
import ClientNomen from "./pages/admin/client/ClientNomen";
import ClientStatusBoard from "./pages/clients/ClientStatusBoard";
import ValueTierBoard from "./pages/clients/ValueTierBoard";
import Campaigns from "./pages/admin/campaigns/Campaigns";
import AdAccounts from "./pages/admin/client/AdAccounts";
import AdAccountClients from "./pages/admin/client/AdAccountClients";
import AdAccountCampaigns from "./pages/admin/client/AdAccountCampaigns";
import FeededLeads from "./pages/admin/leads/FeededLeads";
import ManualBatches from "./pages/admin/leads/FeededLeads";
import Projects from "./pages/admin/projects/Projects";
import AdminRoute from "./utils/AdminRoute";
import CMDashboard from "./pages/CMDashboard";
import SalesDashboard from "./pages/sales/SalesDashboard";
import SalesClients from "./pages/sales/SalesClients";
import SalesManagers from "./pages/admin/sales/SalesManagers";
import SalesLeaderboard from "./pages/admin/sales/SalesLeaderboard";
import CMDailyReport from "./pages/CMDailyReport";
import AccountFunding from "./pages/funding/AccountFunding";
import FundsAdded from "./pages/funding/FundsAdded";
import SpendSegregation from "./pages/spend/SpendSegregation";
import AllowedBudget from "./pages/budget/AllowedBudget";
import BudgetGuard from "./pages/budget/BudgetGuard";
import ManagerPerformance from "./pages/performance/ManagerPerformance";
import AdminCampaignManagers from "./pages/admin/cm/AdminCampaignManagers";
import CampaignManagerClients from "./pages/admin/cm/CampaignManagerClients";
import BulkCampaignOperations from "./pages/admin/cm/BulkCampaignOperations";
import AccountMonitor from "./pages/monitor/AccountMonitor";
import MyWork from "./pages/worklog/MyWork";
import ClientWorkspace from "./pages/worklog/ClientWorkspace";
import CplRules from "./pages/cpl/CplRules";
import LeadReplacements from "./pages/leads/LeadReplacements";
import LeadDisqualifications from "./pages/leads/LeadDisqualifications";
import ClientBilling from "./pages/billing/ClientBilling";
import OnboardingWizard from "./pages/onboarding/OnboardingWizard";
import Assignments from "./pages/assignments/Assignments";
import PaymentsList from "./pages/payments/PaymentsList";
import RecordPayment from "./pages/payments/RecordPayment";
import NeedsDocs from "./pages/payments/NeedsDocs";
import MyPaymentEntries from "./pages/payments/MyPaymentEntries";
import PaymentsRoute from "./utils/PaymentsRoute";
import AlertsPanel from "./components/AlertsPanel";
import ReportingIntro from "./pages/landing/ReportingIntro";
import { loadCurrentUser } from "./stores/currentUser";

// The home route ("/") branches on role: Campaign Managers get the CM dashboard,
// everyone else keeps the existing client/admin dashboard. Role is read from the
// auth blob the login flow already stores, so this resolves synchronously.
function RoleHome() {
  const role = (() => {
    try {
      return JSON.parse(localStorage.getItem("auth") || "{}")?.role;
    } catch {
      return null;
    }
  })();
  if (role === "campaign_manager") return <CMDashboard />;
  if (role === "sales") return <SalesDashboard />;
  // The accounts desk's primary screen is the payments ledger, not the client
  // dashboard — it's the surface they work out of all day.
  if (role === "accounts") return <PaymentsList />;
  return <MainDashboard />;
}

//  Layout is a named component — SolidJS reuses the SAME instance across all
//    child route navigations, so Header and Sidebar mount exactly ONCE
function Layout(props) {
  const { isCollapsed } = useSidebar();

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
      <ImpersonationBanner />
      <Sidebar />
      <div
        class={`transition-all duration-300 ${isCollapsed() ? "lg:ml-20" : "lg:ml-64"}`}
      >
        <Header />
        <CMBanner />
        <SuspendedAccountsBanner />
        <main class="min-h-[calc(100vh-4rem)]">{props.children}</main>
      </div>
    </div>
  );
}

//  Root is a proper component — onMount is valid here
//    It catches softLogout() events from api.js without a hard page reload
function Root(props) {
  const navigate = useNavigate();

  onMount(() => {
    const handleLogout = (e) => {
      console.warn("[App] Auth logout event:", e.detail?.reason);
      navigate("/login", { replace: true });
    };

    window.addEventListener("auth-logout", handleLogout);
    onCleanup(() => window.removeEventListener("auth-logout", handleLogout));
  });

  return (
    <>
      {/* Tricolour backdrop for every route. Mounted HERE rather than in Layout
          so it also covers /login and the public intro, which render outside
          it. Purely decorative; see components/common/TricolourWash. */}
      <TricolourWash />
      {props.children}
    </>
  );
}

//  ProtectedLayout combines auth guard + layout in one reusable component
//    so routes stay clean and Layout is never re-instantiated
function ProtectedLayout(props) {
  // Fetch the logged-in user's identity (role + cm_profile.tier) once per
  // authenticated session. The CM UI gates on this.
  onMount(() => {
    loadCurrentUser();
  });

  return (
    <ProtectedRoute>
      <Layout>{props.children}</Layout>
    </ProtectedRoute>
  );
}

function App() {
  return (
    <ThemeProvider>
      <SidebarProvider>
        <Router root={Root}>
          {/* Public routes — no layout, no auth guard.
              "/" is the marketing intro for reports.aajneeti.social; its CTAs
              link to /login, and the app itself now lives at /dashboard. The
              ProtectedLayout branch below deliberately has NO index child, so
              "/" only ever matches this route. */}
          <Route path="/login" component={Login} />
          <Route path="/" component={ReportingIntro} />

          {/*  All protected routes share ONE Layout instance via nesting.
               Header and Sidebar mount once and never remount on navigation. */}
          <Route path="/" component={ProtectedLayout}>
            {/* The app home. Static segments outrank dynamic ones in the
                router's scoring, so this always wins over the
                "/:client-nomen-name" client route further down. */}
            <Route path="/dashboard" component={RoleHome} />
            <Route path="/cm-alerts" component={AlertsPanel} />
            {/* CM daily report — page-gated to campaign managers; the backend
                scopes clients to the CM's own assigned accounts. */}
            <Route
              path="/cm-daily-report"
              component={() => (
                <AdminRoute roles={["campaign_manager", "admin"]}>
                  <CMDailyReport />
                </AdminRoute>
              )}
            />
            <Route path="/account-funding" component={AccountFunding} />
            <Route path="/funds-added" component={FundsAdded} />
            <Route path="/spend-segregation" component={SpendSegregation} />
            <Route path="/allowed-budget" component={AllowedBudget} />
            {/* Budget Guard approval queue — ADMIN ONLY, and deliberately not
                widened to the roles that can otherwise write campaigns. This is
                the screen that puts a campaign the guard stopped back on air at
                its original daily budget; the endpoints 403 every other role. */}
            <Route
              path="/budget-guard"
              component={() => (
                <AdminRoute roles={["admin"]}>
                  <BudgetGuard />
                </AdminRoute>
              )}
            />
            <Route path="/manager-performance" component={ManagerPerformance} />
            <Route
              path="/campaign-managers"
              component={() => (
                <AdminRoute>
                  <AdminCampaignManagers />
                </AdminRoute>
              )}
            />
            <Route
              path="/campaign-manager-clients"
              component={() => (
                <AdminRoute>
                  <CampaignManagerClients />
                </AdminRoute>
              )}
            />
            {/* Admin roster of sales managers + their clients/payments. */}
            <Route
              path="/sales-managers"
              component={() => (
                <AdminRoute roles={["admin"]}>
                  <SalesManagers />
                </AdminRoute>
              )}
            />
            {/* Admin sales-manager leaderboard (billed vs collected). */}
            <Route
              path="/sales-leaderboard"
              component={() => (
                <AdminRoute roles={["admin"]}>
                  <SalesLeaderboard />
                </AdminRoute>
              )}
            />
            {/* Bulk campaign ops — route-gated to write-capable roles; the page
                further gates Tier-2 CMs out via canWriteCampaigns(). "accounts"
                is deliberately absent: they run the payments desk and never
                write campaigns, so a direct URL redirects rather than rendering
                a page whose every control is disabled. */}
            <Route
              path="/bulk-campaign-operations"
              component={() => (
                <AdminRoute
                  roles={["admin", "coordination", "campaign_manager"]}
                >
                  <BulkCampaignOperations />
                </AdminRoute>
              )}
            />
            {/* Sales manager pages — sales-gated the same way the home
                dashboard branches to SalesDashboard for role "sales". */}
            <Route
              path="/sales/clients"
              component={() => (
                <AdminRoute roles={["sales"]}>
                  <SalesClients />
                </AdminRoute>
              )}
            />
            {/* Client Payments — ONE payments-overview screen for every role
                that reads this ledger. It replaced three near-identical pages
                (this one, /sales/payments and /payment-billing) that all called
                GET /billing/admin/payments-overview/ and differed only in
                chrome. The roles list is wide because the BACKEND scopes the
                response per caller: sales get their onboarded clients, a CM
                gets their tier-aware visible clients, admin/coordination/
                accounts get everything. The two retired paths redirect here
                rather than 404 — bookmarks and old links are still in the wild. */}
            <Route
              path="/client-payments"
              component={() => (
                <AdminRoute
                  roles={[
                    "admin",
                    "coordination",
                    "accounts",
                    "campaign_manager",
                    "sales",
                  ]}
                >
                  <ClientBilling />
                </AdminRoute>
              )}
            />
            <Route
              path="/sales/payments"
              component={() => <Navigate href="/client-payments" />}
            />
            {/* ── Payments desk ────────────────────────────────────────────
                Accounts + admin get the ledger and the needs-docs queue;
                Record Payment is shared with tier-1 CMs; My Entries is
                tier-1-CM-only. PaymentsRoute gates on role AND tier (a tier-2
                CM is bounced even though their role matches), and waits for
                /auth/me rather than guessing a CM's tier. The API 403s stay
                the backstop underneath. */}
            <Route
              path="/payments"
              component={() => (
                <PaymentsRoute allow="accounts">
                  <PaymentsList />
                </PaymentsRoute>
              )}
            />
            <Route
              path="/payments/record"
              component={() => (
                <PaymentsRoute allow="record">
                  <RecordPayment />
                </PaymentsRoute>
              )}
            />
            <Route
              path="/payments/needs-docs"
              component={() => (
                <PaymentsRoute allow="accounts">
                  <NeedsDocs />
                </PaymentsRoute>
              )}
            />
            <Route
              path="/payments/my-entries"
              component={() => (
                <PaymentsRoute allow="cm">
                  <MyPaymentEntries />
                </PaymentsRoute>
              )}
            />
            <Route path="/account-monitor" component={AccountMonitor} />
            <Route path="/my-work" component={MyWork} />
            <Route path="/client-workspace/:nomenId" component={ClientWorkspace} />
            <Route path="/cpl-rules" component={CplRules} />
            {/* Lead replacements — the record + audit surface. Route-gated to
                admin + CM; the RECORD action inside is further gated to admin
                and tier-1 CMs (canRecordReplacement), and revoke/audit-log to
                admin only. A tier-2 CM still gets the read-only list, which the
                backend scopes to their own + their team's batches. */}
            <Route
              path="/lead-replacements"
              component={() => (
                <AdminRoute roles={["admin", "campaign_manager"]}>
                  <LeadReplacements />
                </AdminRoute>
              )}
            />
            {/* Lead disqualifications — the CPL-only twin of the above, gated
                identically: route to admin + CM, the RECORD action to admin and
                tier-1 CMs, revoke/audit-log to admin. */}
            <Route
              path="/lead-disqualifications"
              component={() => (
                <AdminRoute roles={["admin", "campaign_manager"]}>
                  <LeadDisqualifications />
                </AdminRoute>
              )}
            />
            <Route path="/activity" component={Activity} />
            <Route path="/:client-nomen-name" component={MainDashboard} />
            <Route path="/add-project" component={AddProject} />
            <Route path="/billing" component={Billing} />
            <Route path="/daily-reports" component={DailyReports} />
            {/* Client-only; the endpoint 404s for every other role. Static
                segment, so it outranks the "/:client-nomen-name" catch-all. */}
            <Route path="/my-team" component={MyTeam} />
            <Route path="/client-delivery" component={ClientDelivery} />
            <Route path="/performing-projects" component={PerformingProjects} />
            <Route path="/settings" component={Settings} />
            <Route path="/notifications" component={Notifications} />
            <Route path="/project/:id" component={ProjectDetails} />
            <Route path="/campaign/:id" component={CampaignDetails} />
            <Route path="/leads-performance" component={LeadsPage} />
            <Route path="/leads" component={Leads} />
            <Route path="/follow-up" component={FollowUp} />
            {/* admin pages */}
            <Route
              path="/clients"
              component={() => (
                <AdminRoute roles={["admin", "campaign_manager"]}>
                  <Clients />
                </AdminRoute>
              )}
            />
            <Route
              path="/project-display-config"
              component={() => (
                <AdminRoute roles={["admin", "campaign_manager"]}>
                  <ProjectDisplayConfig />
                </AdminRoute>
              )}
            />
            {/* Onboarding wizard — creates a login + its role profile in one
                atomic call. Admin + coordination ONLY: the endpoint 403s every
                other role, so a CM reaching this URL is bounced rather than
                shown a form that can only fail. */}
            <Route
              path="/onboarding"
              component={() => (
                <AdminRoute roles={["admin", "coordination"]}>
                  <OnboardingWizard />
                </AdminRoute>
              )}
            />
            {/* CM ↔ client assignments — the screen that decides which clients
                each manager can see. Admin + coordination ONLY, same gate as
                onboarding; the endpoints 403 every other role. */}
            <Route
              path="/assignments"
              component={() => (
                <AdminRoute roles={["admin", "coordination"]}>
                  <Assignments />
                </AdminRoute>
              )}
            />
            <Route
              path="/client-nomen"
              component={() => (
                <AdminRoute roles={["admin", "campaign_manager"]}>
                  <ClientNomen />
                </AdminRoute>
              )}
            />
            {/* Engagement-status board. Open to admin + CM; the endpoint scopes
                the roster itself (admin: all, CM: their assigned clients) and
                403s a CM who tries to set a status outside their book. */}
            <Route
              path="/client-status"
              component={() => (
                <AdminRoute roles={["admin", "campaign_manager"]}>
                  <ClientStatusBoard />
                </AdminRoute>
              )}
            />
            {/* Value-tier board. Admin + coordination ONLY — deliberately NOT the
                same gate as the engagement board above: the tier is an INTERNAL
                commercial classification, a CM never sees it, and the endpoints
                403 every other role. */}
            <Route
              path="/client-value-tier"
              component={() => (
                <AdminRoute roles={["admin", "coordination"]}>
                  <ValueTierBoard />
                </AdminRoute>
              )}
            />
            <Route
              path="/campaigns"
              component={() => (
                <AdminRoute>
                  <Campaigns />
                </AdminRoute>
              )}
            />
            <Route
              path="/projects-nomen"
              component={() => (
                <AdminRoute>
                  <Projects />
                </AdminRoute>
              )}
            />
            <Route
              path="/ad-accounts"
              component={() => (
                <AdminRoute roles={["admin", "campaign_manager"]}>
                  <AdAccounts />
                </AdminRoute>
              )}
            />
            <Route
              path="/ad-account-clients"
              component={() => (
                <AdminRoute roles={["admin", "campaign_manager"]}>
                  <AdAccountClients />
                </AdminRoute>
              )}
            />
            <Route
              path="/ad-accounts/:id"
              component={() => (
                <AdminRoute roles={["admin", "campaign_manager"]}>
                  <AdAccountCampaigns />
                </AdminRoute>
              )}
            />
            <Route
              path="/feeded-leads"
              component={() => (
                <AdminRoute roles={["admin", "campaign_manager"]}>
                  <ManualBatches />
                </AdminRoute>
              )}
            />
            {/* Retired: the coordination payments dashboard was a third copy of
                /client-payments. It was also gated by a bare <AdminRoute> whose
                default roles=["admin"] locked the coordination team out of
                their own screen; the merged route's roles list fixes that. */}
            <Route
              path="/payment-billing"
              component={() => <Navigate href="/client-payments" />}
            />
          </Route>
        </Router>
      </SidebarProvider>
    </ThemeProvider>
  );
}

export default App;
