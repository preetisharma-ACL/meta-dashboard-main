import { Router, Route } from "@solidjs/router";
import { ThemeProvider } from "./context/ThemeContext";
import { SidebarProvider } from "./context/SidebarContext";
import { useSidebar } from "./context/SidebarContext";
import { useNavigate } from "@solidjs/router";
import { onMount, onCleanup } from "solid-js";
import Sidebar from "./components/Sidebar";
import Header from "./components/Header";
import CMBanner from "./components/CMBanner";
import MainDashboard from "./pages/ClientDashboard";
import AddProject from "./pages/AddProjects";
import Billing from "./pages/Billing";
import ClientDelivery from "./pages/Client-Delivery";
import PerformingProjects from "./pages/PerformingProjects";
import Settings from "./pages/Settings";
import Notifications from "./pages/Alert";
import ProjectDetails from "./pages/ProjectDetails";
import CampaignDetails from "./pages/CampaignDetails";
import Login from "./pages/login/LoginForm";
import ProtectedRoute from "./routes/ProtectedRoute";
import LeadsPage from "./pages/LeadPerformance";
import Leads from "./pages/Leads";
import FollowUp from "./pages/FollowUp";
import DailyReports from "./pages/DailyReports";
import Clients from "./pages/admin/client/Clients";
import ImpersonationBanner from "./pages/admin/component/ImpersonationBanner";
import ProjectDisplayConfig from "./pages/admin/client/ProjectDisplayConfig";
import ClientNomen from "./pages/admin/client/ClientNomen";
import Campaigns from "./pages/admin/campaigns/Campaigns";
import AdAccounts from "./pages/admin/client/AdAccounts";
import FeededLeads from "./pages/admin/leads/FeededLeads";
import ManualBatches from "./pages/admin/leads/FeededLeads";
import Projects from "./pages/admin/projects/Projects";
import AdminRoute from "./utils/AdminRoute";
import CoordinationDashboard from "./pages/coordination/pages/CoordinationDashboard";
import CMDashboard from "./pages/CMDashboard";
import AccountFunding from "./pages/funding/AccountFunding";
import SpendSegregation from "./pages/spend/SpendSegregation";
import AllowedBudget from "./pages/budget/AllowedBudget";
import ManagerPerformance from "./pages/performance/ManagerPerformance";
import AlertsPanel from "./components/AlertsPanel";
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
  return role === "campaign_manager" ? <CMDashboard /> : <MainDashboard />;
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

  return <>{props.children}</>;
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
          {/* Public route — no layout, no auth guard */}
          <Route path="/login" component={Login} />

          {/*  All protected routes share ONE Layout instance via nesting.
               Header and Sidebar mount once and never remount on navigation. */}
          <Route path="/" component={ProtectedLayout}>
            <Route path="/" component={RoleHome} />
            <Route path="/cm-alerts" component={AlertsPanel} />
            <Route path="/account-funding" component={AccountFunding} />
            <Route path="/spend-segregation" component={SpendSegregation} />
            <Route path="/allowed-budget" component={AllowedBudget} />
            <Route path="/manager-performance" component={ManagerPerformance} />
            <Route path="/:client-nomen-name" component={MainDashboard} />
            <Route path="/add-project" component={AddProject} />
            <Route path="/billing" component={Billing} />
            <Route path="/daily-reports" component={DailyReports} />
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
                <AdminRoute>
                  <Clients />
                </AdminRoute>
              )}
            />
            <Route
              path="/project-display-config"
              component={() => (
                <AdminRoute>
                  <ProjectDisplayConfig />
                </AdminRoute>
              )}
            />
            <Route
              path="/client-nomen"
              component={() => (
                <AdminRoute>
                  <ClientNomen />
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
              path="/projects"
              component={() => (
                <AdminRoute>
                  <Projects />
                </AdminRoute>
              )}
            />
            <Route
              path="/ad-accounts"
              component={() => (
                <AdminRoute>
                  <AdAccounts />
                </AdminRoute>
              )}
            />
            <Route
              path="/feeded-leads"
              component={() => (
                <AdminRoute>
                  <ManualBatches />
                </AdminRoute>
              )}
            />
             <Route
              path="/coordination-dashboard"
              component={() => (
                <AdminRoute>
                  <CoordinationDashboard/>
                </AdminRoute>
              )}
            />
          </Route>
        </Router>
      </SidebarProvider>
    </ThemeProvider>
  );
}

export default App;
