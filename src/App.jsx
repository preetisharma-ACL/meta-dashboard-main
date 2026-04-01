import { Router, Route } from '@solidjs/router';
import { ThemeProvider } from './context/ThemeContext';
import { SidebarProvider } from './context/SidebarContext';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Leads from './pages/Leads';  
import FollowUp from './pages/FollowUp';

import { useSidebar } from './context/SidebarContext';
import ProjectDetails from './pages/ProjectDetails';
import ClientDashboard from './pages/ClientDashboard';
import CampaignDetails from './pages/CampaignDetails';
import AddProject from './pages/AddProjects';
import  Billing  from './pages/Billing';
import LeadPerformance from './pages/LeadPerformance';
import WhatIsPerforming from './pages/WhatisPerforming';

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
          <Route path="/" component={() => <Layout><ClientDashboard /></Layout>} />
          <Route path="/add-project" component={() => <Layout><AddProject /></Layout>} />
          <Route path="/billing" component={() => <Layout><Billing /></Layout>} />
          <Route path="/leads-performance" component={() => <Layout><LeadPerformance /></Layout>} />
          <Route path="/what-is-performing" component={() => <Layout><WhatIsPerforming /></Layout>} />
          <Route path="/leads" component={() => <Layout><Leads /></Layout>} />
          <Route path="/follow-up" component={() => <Layout><FollowUp/></Layout>} />
          <Route path="/settings" component={() => <Layout><Settings /></Layout>} />
          <Route path="/billing" component={() => <Layout><Billing /></Layout>} />
          <Route path="/all-campaigns" component={() => <Layout><ProjectDetails /></Layout>} />
          <Route path="/campaign/:id" component={() => <Layout> <CampaignDetails /> </Layout>} />
        </Router>
      </SidebarProvider>
    </ThemeProvider>
  );
}

export default App;