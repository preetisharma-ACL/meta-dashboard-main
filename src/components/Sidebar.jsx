import { A, useLocation, useNavigate } from "@solidjs/router";
import { useSidebar } from "../context/SidebarContext";
import {
  createSignal,
  For,
  Show,
  createMemo,
  onMount,
  onCleanup,
} from "solid-js";
import { handleLogout } from "../pages/login/LoginForm";
import { clearClientDashboardContext } from "../cacheStore/appStore";

const getAuthToken = () => {
  try {
    return !!JSON.parse(localStorage.getItem("auth"))?.token;
  } catch {
    return false;
  }
};

const getUserRole = () => {
  try {
    return JSON.parse(localStorage.getItem("auth"))?.role ?? "client";
  } catch {
    return "client";
  }
};

// Logo click: navigation to "/" is handled by the <A href="/"> itself. Here we
// only reset any drilled-in client context so "/" renders the admin's own
// dashboard instead of the last-opened client's. (Previously this called an
// undefined `navigate`, so it threw and was never wired up.)
const handleLogoClick = () => {
  try {
    const role = JSON.parse(localStorage.getItem("auth") || "{}")?.role;
    if (role === "admin") clearClientDashboardContext();
  } catch {
    /* ignore malformed auth */
  }
};

// ── Icon helpers ────────────────────────────────────────────────────────────

const Icon = ({ d, d2 }) => (
  <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d={d}
    />
    {d2 && (
      <path
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke-width="2"
        d={d2}
      />
    )}
  </svg>
);

const SmallIcon = ({ d }) => (
  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d={d}
    />
  </svg>
);

const ChevronIcon = ({ open }) => (
  <svg
    class="w-4 h-4 transition-transform duration-300"
    style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width="2"
      d="M19 9l-7 7-7-7"
    />
  </svg>
);

// ── Animated collapse container ─────────────────────────────────────────────

function AnimatedCollapse(props) {
  let ref;
  return (
    <div
      ref={ref}
      style={{
        display: "grid",
        "grid-template-rows": props.open ? "1fr" : "0fr",
        transition: "grid-template-rows 300ms cubic-bezier(0.4, 0, 0.2, 1)",
        opacity: props.open ? 1 : 0,
        "transition-property": "grid-template-rows, opacity",
        "transition-duration": "300ms",
        "transition-timing-function": "cubic-bezier(0.4, 0, 0.2, 1)",
      }}
    >
      <div style={{ overflow: "hidden" }}>{props.children}</div>
    </div>
  );
}

// ── Nav item class sets (project theme) ───────────────────────────────────────
const NAV_BASE =
  "group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 relative";

const NAV_ACTIVE =
  "bg-blue-50 dark:bg-blue-900/25 text-blue-600 dark:text-blue-400 shadow-sm";

const NAV_INACTIVE =
  "text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100";

// ── Main component ──────────────────────────────────────────────────────────

export default function Sidebar() {
  const { isCollapsed, isMobileOpen, closeMobileSidebar } = useSidebar();
  const location = useLocation();
  const navigate = useNavigate();
  const isActive = (path) => location.pathname === path;

  const goToDashboard = () => {
    const role = JSON.parse(localStorage.getItem("auth") || "{}")?.role;

    if (role === "admin") {
      clearClientDashboardContext();
    }

    navigate("/");
  };
  const [isLoggedIn, setIsLoggedIn] = createSignal(getAuthToken());
  const [userRole, setUserRole] = createSignal(getUserRole());
  const [openMenu, setOpenMenu] = createSignal(null);

  onMount(() => {
    const handleStorage = () => {
      setIsLoggedIn(getAuthToken());
      setUserRole(getUserRole());
    };
    window.addEventListener("storage", handleStorage);
    onCleanup(() => window.removeEventListener("storage", handleStorage));
  });

  const menuItems = createMemo(() =>
    [
      {
        name: userRole() === "admin" ? "Dashboard" : "Dashboard",
        roles: ["admin", "client"],
        icon: () => (
          <Icon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        ),
        path: "/",
        action: goToDashboard,
      },
      // ── Campaign Manager nav ──────────────────────────────────────────────
      {
        name: "Dashboard",
        roles: ["campaign_manager"],
        icon: () => (
          <Icon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        ),
        path: "/",
      },
      {
        name: "My Work",
        roles: ["campaign_manager", "admin", "coordination", "accounts"],
        icon: () => (
          <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        ),
        path: "/my-work",
      },
      {
        name: "Alerts",
        roles: ["campaign_manager"],
        icon: () => (
          <Icon d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 01-3 3H9a3 3 0 01-3-3v-1m6 0h6" />
        ),
        path: "/cm-alerts",
      },
      {
        name: "Daily Report",
        roles: ["campaign_manager"],
        icon: () => (
          <Icon d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        ),
        path: "/cm-daily-report",
      },
      {
        name: "Accounts & Funding",
        roles: ["admin", "campaign_manager"],
        icon: () => (
          <Icon d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        ),
        subMenus: [
          {
            name: "Account Funding",
            path: "/account-funding",
            roles: ["admin", "campaign_manager"],
            icon: () => (
              <SmallIcon d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            ),
          },
          {
            name: "Meta Ad Accounts",
            path: "/ad-accounts",
            roles: ["admin","campaign_manager"],
            icon: () => (
              <SmallIcon d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            ),
          },
          {
            name: "Spend Segregation",
            path: "/spend-segregation",
            roles: ["admin"],
            icon: () => (
              <SmallIcon d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
            ),
          },
          {
            name: "Account Monitor",
            path: "/account-monitor",
            roles: ["admin"],
            icon: () => (
              <SmallIcon d="M3 12l2-2 4 4 6-6 4 4 2-2" />
            ),
          },
        ],
      },
      {
        name: "Clients",
        roles: ["admin","campaign_manager"],
        icon: () => (
          <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0h-6m6 0a3 3 0 01-5.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M9 7a4 4 0 11-8 0 4 4 0 018 0zm0 0a4 4 0 015.536 3.536M15.536 10.536A5.967 5.967 0 0121 16.941M16.536 10.536A5.973 5.973 0 0012 16c0 .132 0 .263.012.391M12 16a5.973 5.973 0 00-4.536-2.464" />
        ),
        subMenus: [
          {
            name: "Clients",
            path: "/clients",
            roles: ["admin","campaign_manager"],
            icon: () => (
              <SmallIcon d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            ),
          },
          {
            name: "Client Nomen",
            path: "/client-nomen",
            roles: ["admin","campaign_manager"],
            icon: () => (
              <SmallIcon d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            ),
          },
          {
            name: "Project Display Config",
            path: "/project-display-config",
            roles: ["admin"], // admin-only for now (backend CM-scoping in progress)
            icon: () => (
              <SmallIcon d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            ),
          },
          {
            name: "Leed Feeding",
            path: "/feeded-leads",
            roles: ["admin","campaign_manager"],
            icon: () => (
              <SmallIcon d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            ),
          },
        ],
      },
      {
        name: "Allowed Budget",
        roles: ["admin", "campaign_manager"],
        icon: () => (
          <Icon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        ),
        path: "/allowed-budget",
      },
      {
        name: "Manager Performance",
        roles: ["admin"],
        icon: () => (
          <Icon d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        ),
        path: "/manager-performance",
      },
      {
        name: "Campaign Managers",
        roles: ["admin"],
        icon: () => (
          <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0h-6m6 0a3 3 0 01-5.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M9 7a4 4 0 11-8 0 4 4 0 018 0zm0 0a4 4 0 015.536 3.536M15.536 10.536A5.967 5.967 0 0121 16.941M16.536 10.536A5.973 5.973 0 0012 16c0 .132 0 .263.012.391M12 16a5.973 5.973 0 00-4.536-2.464" />
        ),
        path: "/campaign-managers",
      },
      {
        name: "Campaign Manager's Clients",
        roles: ["admin"],
        icon: () => (
          <Icon d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        ),
        path: "/campaign-manager-clients",
      },
      {
        name: "Bulk Campaign Ops",
        roles: ["admin", "coordination", "accounts", "campaign_manager"],
        icon: () => (
          <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        ),
        path: "/bulk-campaign-operations",
      },
      {
        name: "CPL Rules & Alerts",
        roles: ["admin", "campaign_manager"],
        icon: () => (
          <Icon d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        ),
        path: "/cpl-rules",
      },
      {
        name: "Activity Log",
        roles: ["admin", "campaign_manager"],
        icon: () => (
          <Icon d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        ),
        path: "/activity",
      },
      {
        name: "Campaigns",
        roles: ["admin"],
        icon: () => (
          <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0h-6m6 0a3 3 0 01-5.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M9 7a4 4 0 11-8 0 4 4 0 018 0zm0 0a4 4 0 015.536 3.536M15.536 10.536A5.967 5.967 0 0121 16.941M16.536 10.536A5.973 5.973 0 0012 16c0 .132 0 .263.012.391M12 16a5.973 5.973 0 00-4.536-2.464" />
        ),
        path: "/campaigns",
      },

      // {
      //   name: "Campaigns",
      //   roles: ["admin"],
      //   icon: () => (
      //     <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0h-6m6 0a3 3 0 01-5.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M9 7a4 4 0 11-8 0 4 4 0 018 0zm0 0a4 4 0 015.536 3.536M15.536 10.536A5.967 5.967 0 0121 16.941M16.536 10.536A5.973 5.973 0 0012 16c0 .132 0 .263.012.391M12 16a5.973 5.973 0 00-4.536-2.464" />
      //   ),
      //   subMenus: [
      //     {
      //       name: "Campaigns",
      //       path: "/campaigns",
      //       icon: () => (
      //         <SmallIcon d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      //       ),
      //     },
      //   ],
      // },
      {
        name: "Projects-Nomen",
        roles: ["admin"],
        icon: () => (
          <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0h-6m6 0a3 3 0 01-5.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M9 7a4 4 0 11-8 0 4 4 0 018 0zm0 0a4 4 0 015.536 3.536M15.536 10.536A5.967 5.967 0 0121 16.941M16.536 10.536A5.973 5.973 0 0012 16c0 .132 0 .263.012.391M12 16a5.973 5.973 0 00-4.536-2.464" />
        ),
        subMenus: [
          {
            name: "Projects Nomen",
            path: "/projects-nomen",
            icon: () => (
              <SmallIcon d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            ),
          },
          {
            name: "Performing Projects",
            path: "/performing-projects",
            icon: () => <Icon d="M13 10V3L4 14h7v7l9-11h-7z" />,
          },
        ],
      },
      // {
      //   name: "Leed Feeding",
      //   roles: ["admin"],
      //   icon: () => <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0h-6m6 0a3 3 0 01-5.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M9 7a4 4 0 11-8 0 4 4 0 018 0zm0 0a4 4 0 015.536 3.536M15.536 10.536A5.967 5.967 0 0121 16.941M16.536 10.536A5.973 5.973 0 0012 16c0 .132 0 .263.012.391M12 16a5.973 5.973 0 00-4.536-2.464" />,
      //   subMenus: [
      //     {
      //       name: "Feeded Leads",
      //       path: "/feeded-leads",
      //       icon: () => <SmallIcon d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />,
      //     },

      //   ],
      // },
      {
        name: "Co-ordination",
        roles: ["admin"],
        icon: () => (
          <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0h-6m6 0a3 3 0 01-5.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M9 7a4 4 0 11-8 0 4 4 0 018 0zm0 0a4 4 0 015.536 3.536M15.536 10.536A5.967 5.967 0 0121 16.941M16.536 10.536A5.973 5.973 0 0012 16c0 .132 0 .263.012.391M12 16a5.973 5.973 0 00-4.536-2.464" />
        ),
        subMenus: [
          {
            name: "Coordination Dashboard",
            path: "/coordination-dashboard",
            icon: () => (
              <SmallIcon d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            ),
          },
        ],
      },
      {
        name: "Billing",
        roles: ["client"],
        icon: () => (
          <Icon d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        ),
        path: "/billing",
      },
      {
        name: "Daily Reports",
        roles: ["admin", "client"],
        icon: () => (
          <Icon d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        ),
        path: "/daily-reports",
      },
      // {
      //   name: "Client Delivery",
      //   roles: ["admin"],
      //   icon: () => <Icon d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />,
      //   path: "/client-delivery",
      // },
      // {
      //   name: "Leads Performance",
      //   roles: ["admin"],
      //   icon: () => <Icon d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />,
      //   path: "/leads-performance",
      // },
      // {
      //   name: "Performing Projects",
      //   roles: ["admin",],
      //   icon: () => <Icon d="M13 10V3L4 14h7v7l9-11h-7z" />,
      //   path: "/performing-projects",
      // },
      // {
      //   name: "Leads",
      //   roles: ["admin"],
      //   icon: () => <Icon d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />,
      //   path: "/leads",
      //   badge: 12,
      // },
      // {
      //   name: "Follow Up",
      //   roles: ["admin"],
      //   icon: () => <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />,
      //   path: "/follow-up",
      // },
      {
        name: "Settings",
        roles: ["admin"],
        icon: () => (
          <Icon
            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            d2="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
        ),
        path: "/settings",
      },
      {
        name: "Alert & Notifications",
        roles: ["admin", "client"],
        icon: () => (
          <Icon d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 01-3 3H9a3 3 0 01-3-3v-1m6 0h6" />
        ),
        path: "/notifications",
      },
      {
        name: isLoggedIn() ? "Logout" : "Login",
        roles: ["admin", "client", "campaign_manager"],
        icon: () => (
          <Icon d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
        ),
        path: isLoggedIn() ? null : "/login",
        action: isLoggedIn() ? handleLogout : null,
      },
    ].filter((item) => item.roles.includes(userRole())),
  );

  return (
    <>
      {/* Mobile Overlay */}
      <Show when={isMobileOpen()}>
        <div
          class="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden transition-opacity"
          onClick={closeMobileSidebar}
        />
      </Show>

      {/* Sidebar */}
      <aside
        class={`fixed overflow-hidden flex flex-col top-0 left-0 h-full z-50 transition-all duration-300
          bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 ${
          isCollapsed() ? "w-20" : "w-64"
        } ${
          isMobileOpen() ? "translate-x-0" : "-translate-x-full"
        } lg:translate-x-0`}
      >
        {/* Logo — AAJneeti wordmark + gold "Reporting Dashboard" (all screens) */}
        <div class="flex-shrink-0 px-4 py-5 border-b border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center justify-center">
          <Show
            when={!isCollapsed()}
            fallback={
              <>
                {/* Light theme */}
                <A href="/" onClick={handleLogoClick} class="flex items-center justify-center">
                <img
                  src="/logo.webp"
                  alt="aajneeti"
                  class="block dark:hidden w-9 h-9 object-contain"
                />
                </A>
                {/* Dark theme */}
                <A href="/" onClick={handleLogoClick} class="flex items-center justify-center">
                <img
                  src="/V2-aajneeti-logo.png"
                  alt="aajneeti"
                  class="hidden dark:block w-9 h-9 object-contain"
                />
                </A>
              </>
            }
          >
            <div class="flex flex-col items-center justify-center gap-3 lg:gap-2">
              {/* Light theme */}
              <A href="/" onClick={handleLogoClick} class="flex items-center justify-center">
              <img
                src="/logo.webp"
                alt="Aajneeti"
                class="block dark:hidden h-14 w-auto object-contain"
              />
              </A>
              {/* Dark theme */}
              <A href="/" onClick={handleLogoClick} class="flex items-center justify-center">
              <img
                src="/V2-aajneeti-logo.png"
                alt="Aajneeti"
                class="hidden dark:block h-14 w-auto object-contain"
              />
              </A>
              <div class="flex items-center gap-2 lg:gap-1.5">
                <span class="h-px w-5 lg:w-3.5 bg-amber-500/80" />
                <span class="text-[12px] lg:text-[10px] font-bold uppercase tracking-[0.2em] lg:tracking-[0.15em] text-amber-600 whitespace-nowrap">
                  Reporting Dashboard
                </span>
              </div>
            </div>
          </Show>
        </div>

        {/* Navigation */}
        <nav class="p-3 space-y-0.5 flex-1 min-h-0 overflow-y-auto">
          <For each={menuItems()}>
            {(item) => (
              <Show
                when={item.subMenus}
                fallback={
                  <A
                    href={item.path ?? "#"}
                    onClick={item.action ?? undefined}
                    class={`${NAV_BASE} ${isActive(item.path) ? NAV_ACTIVE : NAV_INACTIVE}`}
                  >
                    {/* Active indicator bar */}
                    <Show when={isActive(item.path)}>
                      <span class="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-blue-500 rounded-r-full" />
                    </Show>

                    <span
                      class={`flex-shrink-0 transition-transform duration-200 group-hover:scale-110 ${isActive(item.path) ? "text-blue-500" : ""}`}
                    >
                      {item.icon()}
                    </span>

                    <Show when={!isCollapsed()}>
                      <span class="flex-1 font-medium text-sm">
                        {item.name}
                      </span>
                      <Show when={item.badge}>
                        <span class="ml-auto inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-blue-500 rounded-full">
                          {item.badge}
                        </span>
                      </Show>
                    </Show>
                  </A>
                }
              >
                {/* Parent with submenus */}
                <div>
                  <button
                    class={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200
                      ${
                        openMenu() === item.name
                          ? "bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400"
                          : NAV_INACTIVE
                      }`}
                    onClick={() =>
                      setOpenMenu(openMenu() === item.name ? null : item.name)
                    }
                  >
                    <div class="flex items-center gap-3">
                      <span class="flex-shrink-0">{item.icon()}</span>
                      <Show when={!isCollapsed()}>
                        <span class="font-medium text-sm">{item.name}</span>
                      </Show>
                    </div>
                    <Show when={!isCollapsed()}>
                      <ChevronIcon open={openMenu() === item.name} />
                    </Show>
                  </button>

                  {/* Animated submenu */}
                  <AnimatedCollapse open={openMenu() === item.name}>
                    <div class="mt-1 ml-3 pl-3 border-l-2 border-blue-100 dark:border-blue-900/50 space-y-0.5 pb-1">
                      <For each={item.subMenus.filter((sub) => !sub.roles || sub.roles.includes(userRole()))}>
                        {(sub) => (
                          <A
                            href={sub.path}
                            class={`group flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150
                              ${
                                isActive(sub.path)
                                  ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 font-medium"
                                  : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-800 dark:hover:text-gray-200"
                              }`}
                          >
                            <span
                              class={`flex-shrink-0 transition-colors duration-150 ${isActive(sub.path) ? "text-blue-500" : "text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300"}`}
                            >
                              {sub.icon?.()}
                            </span>
                            <span>{sub.name}</span>
                            {/* Active dot */}
                            <Show when={isActive(sub.path)}>
                              <span class="ml-auto w-1.5 h-1.5 rounded-full bg-blue-500" />
                            </Show>
                          </A>
                        )}
                      </For>
                    </div>
                  </AnimatedCollapse>
                </div>
              </Show>
            )}
          </For>
        </nav>

        {/* Footer */}
        <div
          class={`flex-shrink-0 px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50/80 dark:bg-gray-900/80 backdrop-blur-sm ${
            isCollapsed() ? "text-center" : ""
          }`}
        >
          <Show when={!isCollapsed()}>
            <p class="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
              Developed by Aajneeti Connect Ltd.
            </p>
            <p class="text-xs text-gray-300 dark:text-gray-600">
              © 2026 All rights reserved.
            </p>
          </Show>
        </div>
      </aside>
    </>
  );
}
