import { Router, Route } from '@solidjs/router';
import { ThemeProvider } from './context/ThemeContext';
import { SidebarProvider } from './context/SidebarContext';
import { useSidebar } from './context/SidebarContext';
import { useNavigate } from '@solidjs/router';
import { onMount, onCleanup } from 'solid-js';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import MainDashboard from './pages/ClientDashboard';
import AddProject from './pages/AddProjects';
import Billing from './pages/Billing';
import ClientDelivery from './pages/Client-Delivery';
import PerformingProjects from './pages/PerformingProjects';
import Settings from './pages/Settings';
import Notifications from './pages/Alert';
import ProjectDetails from './pages/ProjectDetails';
import CampaignDetails from './pages/CampaignDetails';
import Login from './pages/login/LoginForm';
import ProtectedRoute from './routes/ProtectedRoute';
import LeadsPage from './pages/LeadPerformance';
import Leads from './pages/Leads';
import FollowUp from './pages/FollowUp';
import DailyReports from './pages/DailyReports';
import Clients from './pages/admin/client/Clients';
import ImpersonationBanner from './pages/admin/component/ImpersonationBanner';
import ProjectDisplayConfig from './pages/admin/client/ProjectDisplayConfig';
import ClientNomen from './pages/admin/client/ClientNomen';
import Campaigns from './pages/admin/campaigns/Campaigns';
import AdAccounts from './pages/admin/client/AdAccounts';
import FeededLeads from './pages/admin/leads/FeededLeads';
import ManualBatches from './pages/admin/leads/FeededLeads';
import Projects from './pages/admin/projects/Projects';


//  Layout is a named component — SolidJS reuses the SAME instance across all
//    child route navigations, so Header and Sidebar mount exactly ONCE
function Layout(props) {
  const { isCollapsed } = useSidebar();

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
      <ImpersonationBanner />
      <Sidebar />
      <div class={`transition-all duration-300 ${isCollapsed() ? 'lg:ml-20' : 'lg:ml-64'}`}>
        <Header />
        <main class="min-h-[calc(100vh-4rem)]">
          {props.children}
        </main>
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
  return (
    <ProtectedRoute>
      <Layout>
        {props.children}
      </Layout>
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
            <Route path="/" component={MainDashboard} />
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
            <Route path="/clients" component={Clients} />
            <Route path="/project-display-config" component={ProjectDisplayConfig} />
            <Route path="/client-nomen" component={ClientNomen} />
            <Route path="/campaigns" component={Campaigns} />
            <Route path="/projects" component={Projects} />
            <Route path="/ad-accounts" component={AdAccounts} />
            <Route path="/feeded-leads" component={ManualBatches} />
          </Route>
        </Router>
      </SidebarProvider>
    </ThemeProvider>
  );
}

export default App;