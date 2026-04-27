import { Router, Route } from '@solidjs/router';
import { ThemeProvider } from './context/ThemeContext';
import { SidebarProvider } from './context/SidebarContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Leads from './pages/Leads';
import FollowUp from './pages/FollowUp';
import ClientDelivery from './pages/Client-Delivery';
import { useSidebar } from './context/SidebarContext';
import ProjectDetails from './pages/ProjectDetails';
import ClientDashboard from './pages/ClientDashboard';
import CampaignDetails from './pages/CampaignDetails';
import AddProject from './pages/AddProjects';
import Billing from './pages/Billing';
import LeadPerformance from './pages/LeadPerformance';
import WhatIsPerforming from './pages/WhatisPerforming';
import Login from './pages/login/LoginForm';
import ProtectedRoute from './routes/ProtectedRoute';
import Notifications from './pages/Alert';

function Layout(props) {
  const { isCollapsed } = useSidebar();

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900">
      <Sidebar />
      <div
        class={`transition-all duration-300 ${isCollapsed() ? 'lg:ml-20' : 'lg:ml-64'
          }`}
      >
        <Header />
        <main class="min-h-[calc(100vh-4rem)]">
          {props.children}
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <SidebarProvider>
        <Router>
          {/* <Route path="/" component={() => <Layout><Dashboard /></Layout>} /> */}
          
          <Route path="/" component={() => <ProtectedRoute><Layout><ClientDashboard /></Layout></ProtectedRoute>} />
          <Route path="/add-project" component={() =>  <ProtectedRoute><Layout><AddProject /></Layout></ProtectedRoute>} />
          <Route path="/billing" component={() =><ProtectedRoute><Layout><Billing /></Layout></ProtectedRoute>} />
          <Route path="/client-delivery" component={() => <ProtectedRoute><Layout><ClientDelivery/></Layout></ProtectedRoute>} />
          <Route path="/leads-performance" component={() => <ProtectedRoute><Layout><LeadPerformance /></Layout></ProtectedRoute>} />
          <Route path="/what-is-performing" component={() => <ProtectedRoute><Layout><WhatIsPerforming /></Layout></ProtectedRoute>} />
          <Route path="/leads" component={() => <ProtectedRoute><Layout><Leads /></Layout></ProtectedRoute>} />
          <Route path="/follow-up" component={() => <ProtectedRoute><Layout><FollowUp /></Layout></ProtectedRoute>} />
          <Route path="/settings" component={() =><ProtectedRoute><Layout><Settings /></Layout></ProtectedRoute>} />
          <Route path="/notifications" component={() => <ProtectedRoute><Layout><Notifications /></Layout></ProtectedRoute>} />
          <Route path="/project/:id" component={() => <ProtectedRoute><Layout><ProjectDetails /></Layout></ProtectedRoute>} />
          <Route path="/campaign/:id" component={() => <ProtectedRoute><Layout> <CampaignDetails /> </Layout></ProtectedRoute>} />
          <Route path="/login" component={() => <Login />} />
        </Router>
      </SidebarProvider>
    </ThemeProvider>
  );
}

export default App;