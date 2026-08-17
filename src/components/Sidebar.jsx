import { A, useLocation, useNavigate } from "@solidjs/router";
import { useSidebar } from "../context/SidebarContext";
import {
  createSignal,
  For,
  Show,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
} from "solid-js";
import { handleLogout } from "../pages/login/LoginForm";
import { clearClientDashboardContext } from "../cacheStore/appStore";
import { isTier1CM } from "../stores/currentUser";

// Expanded submenu group, remembered across reloads (see openMenu below).
const OPEN_MENU_KEY = "sidebarOpenMenu";

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

// Logo click: navigation to /dashboard is handled by the <A> itself. Here we
// only reset any drilled-in client context so /dashboard renders the admin's
// own dashboard instead of the last-opened client's. ("/" is the public
// marketing intro now, not the app home.) (Previously this called an undefined
// `navigate`, so it threw and was never wired up.)
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

// A solid caret, not an outlined chevron: the nav's own icons are all 2px
// strokes, so a filled mark reads as a control rather than as one more icon.
// Stroked in its own colour with round joins, which softens the three corners
// without needing a rounded-triangle path. No chip behind it — the colour
// swap (slate → crimson) carries the open state on its own.
const ChevronIcon = ({ open }) => (
  <svg
    class={
      "w-4 h-4 flex-shrink-0 transition-all duration-300 ease-out group-hover:scale-110 " +
      (open
        ? "text-[#AC2334] dark:text-red-300 drop-shadow-[0_1px_1px_rgba(172,35,52,.25)]"
        : "text-[#54657E] group-hover:text-[#AC2334] dark:text-gray-400 dark:group-hover:text-red-300")
    }
    style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)" }}
    viewBox="0 0 24 24"
    fill="currentColor"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linejoin="round"
  >
    <path d="M12 15.75L6 9.5h12L12 15.75z" />
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
// Crimson #AC2334 / navy #14233A / gold #D89A2B — the same palette every ledger
// and KPI card on this dashboard uses. The nav used to be blue-500/blue-50,
// which belonged to no other screen in the product.
const NAV_BASE =
  "group flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 relative outline-none focus-visible:ring-2 focus-visible:ring-[#AC2334]/30";

// Tinted wash + a hairline inset ring, so the active row reads as a raised
// surface rather than a flat colour block.
const NAV_ACTIVE =
  "bg-gradient-to-r from-[#FBEEF0] to-[#FBEEF0]/30 dark:from-[#AC2334]/25 dark:to-transparent text-[#AC2334] dark:text-red-300 shadow-[0_1px_2px_rgba(172,35,52,.08),inset_0_0_0_1px_rgba(172,35,52,.12)]";

const NAV_INACTIVE =
  "text-[#54657E] dark:text-gray-400 hover:bg-[#F6F9FC] dark:hover:bg-gray-800/70 hover:text-[#14233A] dark:hover:text-gray-100";

// ── Payments desk links (accounts + admin) ──────────────────────────────────
// Declared once and rendered twice, because the two roles want different
// shapes: accounts work out of these screens all day, so they get them as flat
// top-level items; admin already has a long sidebar, so the same links are
// nested under one "Payments Desk" group. Only `d` (the icon path) is stored —
// each surface wraps it in Icon or SmallIcon at the right size.
const PAYMENT_DESK_LINKS = [
  {
    name: "Payments",
    path: "/payments",
    d: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
  },
  {
    name: "Record Payment",
    path: "/payments/record",
    d: "M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  {
    name: "Needs Docs",
    path: "/payments/needs-docs",
    d: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  {
    name: "Billing",
    path: "/client-payments",
    d: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
];

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

    navigate("/dashboard");
  };
  const [isLoggedIn, setIsLoggedIn] = createSignal(getAuthToken());
  const [userRole, setUserRole] = createSignal(getUserRole());
  // Which submenu group is expanded. Persisted so a browser refresh keeps the
  // section open: the route→group match below only recognises paths that appear
  // in subMenus, and the pages you drill into (/project/:id, /campaign/:id,
  // /ad-accounts/:id, /client-workspace/:nomenId) are not among them — so on a
  // reload there is nothing for it to match and the group would collapse while
  // the page itself stays put. Remembering the last-opened group covers every
  // drill-down without having to enumerate their routes.
  const [openMenu, setOpenMenu] = createSignal(
    localStorage.getItem(OPEN_MENU_KEY),
  );

  createEffect(() => {
    const name = openMenu();
    if (name) localStorage.setItem(OPEN_MENU_KEY, name);
    else localStorage.removeItem(OPEN_MENU_KEY);
  });

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
        // Sales sees Dashboard | Clients | Payments | Logout for v1.1; every
        // admin/CM/coordination item stays hidden because its roles list omits
        // "sales".
        roles: ["admin", "client", "sales"],
        icon: () => (
          <Icon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        ),
        path: "/dashboard",
        action: goToDashboard,
      },
      {
        name: "Dashboard",
        roles: ["campaign_manager"],
        icon: () => (
          <Icon d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        ),
        path: "/dashboard",
      },
      {
        name: "Clients",
        roles: ["admin", "campaign_manager"],
        icon: () => (
          <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0h-6m6 0a3 3 0 01-5.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M9 7a4 4 0 11-8 0 4 4 0 018 0zm0 0a4 4 0 015.536 3.536M15.536 10.536A5.967 5.967 0 0121 16.941M16.536 10.536A5.973 5.973 0 0012 16c0 .132 0 .263.012.391M12 16a5.973 5.973 0 00-4.536-2.464" />
        ),
        subMenus: [
          {
            name: "Clients",
            path: "/clients",
            roles: ["admin", "campaign_manager"],
            icon: () => (
              <SmallIcon d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            ),
          },
          {
            // Engagement status (active / hold / completed) — the manual label
            // the team sets, not the account's is_active flag.
            name: "Client Status",
            path: "/client-status",
            roles: ["admin", "campaign_manager"],
            icon: () => (
              <SmallIcon d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            ),
          },
          {
            name: "Client Nomen",
            path: "/client-nomen",
            roles: ["admin", "campaign_manager"],
            icon: () => (
              <SmallIcon d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
            ),
          },
          {
            name: "Project Display Config",
            path: "/project-display-config",
            roles: ["admin", "campaign_manager"],
            icon: () => (
              <SmallIcon d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            ),
          },
          {
            name: "Leed Feeding",
            path: "/feeded-leads",
            roles: ["admin", "campaign_manager"],
            icon: () => (
              <SmallIcon d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            ),
          },
          {
            // Recording is admin + tier-1 only, but the LIST is server-scoped
            // and useful to every CM (it's the audit trail for the credits
            // showing on their clients' bills), so the entry stays role-wide
            // and the page gates the Record action itself.
            name: "Lead Replacements",
            path: "/lead-replacements",
            roles: ["admin", "campaign_manager"],
            icon: () => (
              <SmallIcon d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            ),
          },
          {
            // Same reasoning as Lead Replacements above: the LIST is
            // server-scoped and useful to every CM, so the entry stays
            // role-wide and the page gates the Record action itself.
            name: "Lead Disqualifications",
            path: "/lead-disqualifications",
            roles: ["admin", "campaign_manager"],
            icon: () => (
              <SmallIcon d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            ),
          },
        ],
      },
      {
        // Sits next to Clients because creating a client login is the common
        // use of it. Top-level rather than a Clients sub-item: coordination
        // doesn't get the Clients group at all, and this is one of the few
        // screens they own — burying it under a group they can't see would
        // hide it from half its audience.
        name: "Onboarding",
        roles: ["admin", "coordination"],
        icon: () => (
          <Icon d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        ),
        path: "/onboarding",
      },
      {
        // Next to Onboarding, and gated identically: creating a user and
        // deciding what that user can see are the same job done in two steps.
        name: "Client Assignments",
        roles: ["admin", "coordination"],
        icon: () => (
          <Icon d="M13 16h-1v-4h-1m1-4h.01M9 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-4M16 3h5v5M21 3l-9 9" />
        ),
        path: "/assignments",
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
            name: "Funds Added",
            path: "/funds-added",
            roles: ["admin", "campaign_manager"],
            // Rupee, not dollar — every figure on this page is in ₹.
            icon: () => (
              <SmallIcon d="M15 8.25H9m6 3H9m3 6l-3-3h1.5a3 3 0 100-6M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            ),
          },
          {
            name: "Meta Ad Accounts",
            path: "/ad-accounts",
            roles: ["admin", "campaign_manager"],
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
            icon: () => <SmallIcon d="M3 12l2-2 4 4 6-6 4 4 2-2" />,
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
        name: "My Work",
        // No "accounts": My Work is a CM/admin operational tool. The accounts
        // sidebar is Payments · Record Payment · Needs Docs · Billing · Logout.
        roles: ["campaign_manager", "admin", "coordination"],
        icon: () => (
          <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        ),
        path: "/my-work",
      },
      {
        name: "Payments Desk",
        roles: ["admin"],
        icon: () => (
          <Icon d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        ),
        subMenus: PAYMENT_DESK_LINKS.filter(
          (l) => l.path !== "/client-payments",
        ).map((l) => ({
          name: l.name,
          path: l.path,
          roles: ["admin"],
          icon: () => <SmallIcon d={l.d} />,
        })),
      },
      // ── Sales manager nav (v1.1) ──────────────────────────────────────────
      {
        name: "Clients",
        roles: ["sales"],
        icon: () => (
          <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0h-6m6 0a3 3 0 01-5.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M9 7a4 4 0 11-8 0 4 4 0 018 0zm0 0a4 4 0 015.536 3.536M15.536 10.536A5.967 5.967 0 0121 16.941M16.536 10.536A5.973 5.973 0 0012 16c0 .132 0 .263.012.391M12 16a5.973 5.973 0 00-4.536-2.464" />
        ),
        path: "/sales/clients",
      },
      {
        name: "Payments",
        roles: ["sales"],
        icon: () => (
          <Icon d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        ),
        path: "/sales/payments",
      },
      // ── Accounts desk nav ─────────────────────────────────────────────────
      // Flat for accounts: the payments ledger IS their dashboard.
      ...PAYMENT_DESK_LINKS.map((l) => ({
        name: l.name,
        roles: ["accounts"],
        path: l.path,
        icon: () => <Icon d={l.d} />,
      })),
      // Same screens for admin, folded into one group so admin's already-long
      // sidebar doesn't grow four more top-level rows. "Billing" is dropped
      // here — admin reaches that page via the existing "Client Payments".

      // ── Campaign Manager nav ──────────────────────────────────────────────

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
        name: "Client Payments",
        roles: ["admin", "campaign_manager"],
        icon: () => (
          <Icon d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        ),
        path: "/client-payments",
      },
      // ── Tier-1 CM payment entry ───────────────────────────────────────────
      // TIER-1 ONLY. `roles` can't express this on its own — tier-2 CMs share
      // the role and must not see these — so the `when` predicate carries the
      // tier check. It reads the reactive currentUser store, so the entries
      // appear as soon as /auth/me resolves rather than needing a reload.
      {
        name: "Record Payment",
        roles: ["campaign_manager"],
        when: isTier1CM,
        icon: () => <Icon d="M12 9v6m3-3H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />,
        path: "/payments/record",
      },
      {
        name: "My Payment Entries",
        roles: ["campaign_manager"],
        when: isTier1CM,
        icon: () => (
          <Icon d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
        ),
        path: "/payments/my-entries",
      },
      //  {
      //   name: "Client Billing",
      //   roles: ["admin", "campaign_manager"],
      //   icon: () => (
      //     <Icon d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
      //   ),
      //   subMenus: [
      //     {
      //       name: "Client Payments",
      //       path: "/client-billing/payments",
      //       roles: ["admin", "campaign_manager"],
      //       icon: () => (
      //         <SmallIcon d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
      //       ),
      //     },
      //   ],
      // },

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
        name: "Sales Managers",
        roles: ["admin"],
        icon: () => (
          <Icon d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0h-6m6 0a3 3 0 01-5.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M9 7a4 4 0 11-8 0 4 4 0 018 0zm0 0a4 4 0 015.536 3.536M15.536 10.536A5.967 5.967 0 0121 16.941M16.536 10.536A5.973 5.973 0 0012 16c0 .132 0 .263.012.391M12 16a5.973 5.973 0 00-4.536-2.464" />
        ),
        path: "/sales-managers",
      },
      {
        name: "Sales Leaderboard",
        roles: ["admin"],
        icon: () => (
          <Icon d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        ),
        path: "/sales-leaderboard",
      },
      {
        name: "Bulk Campaign Ops",
        // No "accounts" — campaign writes are a CM/admin concern.
        roles: ["admin", "coordination", "campaign_manager"],
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
        icon: () => <Icon d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
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
        name: "Payment & Billing",
        roles: ["admin"],
        icon: () => (
          <Icon d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        ),
        path: "/payment-billing",
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
      {
        // Client-only: /clients/me/team/ is scoped to a client token and 404s
        // for every other role, so there is nothing here for admin/CM to see.
        name: "Meet Your Team",
        roles: ["client"],
        icon: () => (
          <Icon d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        ),
        path: "/my-team",
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
      // {
      //   name: "Settings",
      //   roles: ["admin"],
      //   icon: () => (
      //     <Icon
      //       d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      //       d2="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      //     />
      //   ),
      //   path: "/settings",
      // },
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
        // "accounts" added: the payments desk is a primary role now, and it was
        // the only signed-in role with no way to sign out of its own sidebar.
        roles: ["admin", "client", "campaign_manager", "sales", "accounts"],
        icon: () => (
          <Icon d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
        ),
        path: isLoggedIn() ? null : "/login",
        action: isLoggedIn() ? handleLogout : null,
      },
    ].filter(
      // `roles` is the coarse gate; the optional `when` predicate adds a second
      // axis for entries that role alone can't decide — today that's CM TIER
      // (payments are tier-1 only). `when` reads the reactive currentUser
      // store, so an item hidden during the pre-/auth/me window appears the
      // moment the tier lands, without a reload.
      (item) =>
        item.roles.includes(userRole()) && (item.when ? item.when() : true),
    ),
  );

  // Keep the submenu group that owns the active route expanded — including on a
  // fresh page load / refresh, where openMenu() would otherwise reset to null
  // and collapse the group even though we're still on one of its sub-pages.
  // Runs on mount and whenever the route changes; it only ever OPENS the owning
  // group, so a user manually collapsing a group while staying on the same page
  // (no pathname change) is left untouched.
  createEffect(() => {
    const path = location.pathname;
    const parent = menuItems().find((item) =>
      item.subMenus?.some((sub) => sub.path === path),
    );
    if (parent) setOpenMenu(parent.name);
  });

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
          bg-gradient-to-b from-white via-white to-[#FAFBFD] dark:from-gray-900 dark:via-gray-900 dark:to-gray-950
          border-r border-[#E2E8F1] dark:border-gray-800
          shadow-[1px_0_2px_rgba(16,29,49,.04),8px_0_28px_-16px_rgba(16,29,49,.18)] ${
            isCollapsed() ? "w-20" : "w-64"
          } ${
            isMobileOpen() ? "translate-x-0" : "-translate-x-full"
          } lg:translate-x-0`}
      >
        {/* Crimson hairline down the outer edge — the one flourish that marks
            this as Aajneeti chrome rather than a default shell. */}
        <span class="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-[#AC2334]/40 via-[#AC2334]/10 to-transparent" />

        {/* Logo — AAJneeti wordmark + gold "Reporting Dashboard" (all screens) */}
        <div class="relative flex-shrink-0 px-4 py-5 flex items-center justify-center">
          <Show
            when={!isCollapsed()}
            fallback={
              <>
                {/* Light theme */}
                <A
                  href="/dashboard"
                  onClick={handleLogoClick}
                  class="flex items-center justify-center"
                >
                  <img
                    src="/logo.webp"
                    alt="aajneeti"
                    class="block dark:hidden w-9 h-9 object-contain"
                  />
                </A>
                {/* Dark theme */}
                <A
                  href="/dashboard"
                  onClick={handleLogoClick}
                  class="flex items-center justify-center"
                >
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
              <A
                href="/dashboard"
                onClick={handleLogoClick}
                class="flex items-center justify-center"
              >
                <img
                  src="/logo.webp"
                  alt="Aajneeti"
                  class="block dark:hidden h-14 w-auto object-contain"
                />
              </A>
              {/* Dark theme */}
              <A
                href="/dashboard"
                onClick={handleLogoClick}
                class="flex items-center justify-center"
              >
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

        {/* Divider — a fading rule instead of a full-width border, so the
            wordmark sits on the same sheet as the nav rather than in a box. */}
        <div class="flex-shrink-0 h-px mx-4 bg-gradient-to-r from-transparent via-[#D4DDE9] to-transparent dark:via-gray-700" />

        {/* Navigation */}
        <nav class="sidebar-scroll p-3 space-y-1 flex-1 min-h-0 overflow-y-auto">
          <For each={menuItems()}>
            {(item) => (
              <Show
                when={item.subMenus}
                fallback={
                  <A
                    href={item.path ?? "#"}
                    onClick={item.action ?? undefined}
                    title={isCollapsed() ? item.name : undefined}
                    class={`${NAV_BASE} ${isCollapsed() ? "justify-center" : ""} ${
                      isActive(item.path) ? NAV_ACTIVE : NAV_INACTIVE
                    }`}
                  >
                    {/* Active indicator — crimson fading into the gold the
                        wordmark uses, so the rail echoes the masthead. */}
                    <Show when={isActive(item.path)}>
                      <span class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-7 rounded-r-full bg-gradient-to-b from-[#AC2334] to-[#D89A2B]" />
                    </Show>

                    <span
                      class={`flex-shrink-0 transition-all duration-200 group-hover:scale-110 ${
                        isActive(item.path)
                          ? "text-[#AC2334] dark:text-red-300"
                          : "text-[#8593A8] group-hover:text-[#AC2334] dark:group-hover:text-red-300"
                      }`}
                    >
                      {item.icon()}
                    </span>

                    <Show when={!isCollapsed()}>
                      <span
                        class={`flex-1 text-sm ${
                          isActive(item.path) ? "font-semibold" : "font-medium"
                        }`}
                      >
                        {item.name}
                      </span>
                      <Show when={item.badge}>
                        <span class="ml-auto inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-[#AC2334] rounded-full shadow-[0_1px_2px_rgba(172,35,52,.35)]">
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
                    title={isCollapsed() ? item.name : undefined}
                    class={`group w-full flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[#AC2334]/30
                      ${
                        openMenu() === item.name
                          ? "bg-[#F6F9FC] dark:bg-gray-800/70 text-[#14233A] dark:text-gray-100 shadow-[inset_0_0_0_1px_rgba(212,221,233,.9)] dark:shadow-[inset_0_0_0_1px_rgba(55,65,81,.6)]"
                          : NAV_INACTIVE
                      }`}
                    onClick={() =>
                      setOpenMenu(openMenu() === item.name ? null : item.name)
                    }
                  >
                    <div
                      class={`flex items-center gap-3 ${isCollapsed() ? "mx-auto" : ""}`}
                    >
                      <span
                        class={`flex-shrink-0 transition-all duration-200 group-hover:scale-110 ${
                          openMenu() === item.name
                            ? "text-[#AC2334] dark:text-red-300"
                            : "text-[#8593A8] group-hover:text-[#AC2334] dark:group-hover:text-red-300"
                        }`}
                      >
                        {item.icon()}
                      </span>
                      <Show when={!isCollapsed()}>
                        <span
                          class={`text-sm ${
                            openMenu() === item.name
                              ? "font-semibold"
                              : "font-medium"
                          }`}
                        >
                          {item.name}
                        </span>
                      </Show>
                    </div>
                    <Show when={!isCollapsed()}>
                      <ChevronIcon open={openMenu() === item.name} />
                    </Show>
                  </button>

                  {/* Animated submenu */}
                  <AnimatedCollapse open={openMenu() === item.name}>
                    <div class="mt-1 ml-4 pl-3 border-l border-[#E2E8F1] dark:border-gray-700 space-y-0.5 pb-1">
                      <For
                        each={item.subMenus.filter(
                          (sub) => !sub.roles || sub.roles.includes(userRole()),
                        )}
                      >
                        {(sub) => (
                          <A
                            href={sub.path}
                            class={`group relative flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[#AC2334]/30
                              ${
                                isActive(sub.path)
                                  ? "bg-[#FBEEF0] text-[#AC2334] dark:bg-[#AC2334]/20 dark:text-red-300 font-semibold"
                                  : "text-[#54657E] dark:text-gray-400 hover:bg-[#F6F9FC] dark:hover:bg-gray-800/70 hover:text-[#14233A] dark:hover:text-gray-200 hover:translate-x-0.5"
                              }`}
                          >
                            {/* Ties the row back to the group's rule on the left */}
                            <Show when={isActive(sub.path)}>
                              <span class="absolute -left-[13px] top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-full bg-[#AC2334]" />
                            </Show>

                            <span
                              class={`flex-shrink-0 transition-colors duration-150 ${isActive(sub.path) ? "text-[#AC2334] dark:text-red-300" : "text-[#8593A8] group-hover:text-[#AC2334] dark:group-hover:text-red-300"}`}
                            >
                              {sub.icon?.()}
                            </span>
                            <span>{sub.name}</span>
                            {/* Active dot */}
                            <Show when={isActive(sub.path)}>
                              <span class="ml-auto w-1.5 h-1.5 rounded-full bg-[#D89A2B]" />
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
          class={`flex-shrink-0 px-4 py-3 border-t border-[#E2E8F1] dark:border-gray-800 bg-[#F8FAFC]/90 dark:bg-gray-950/80 backdrop-blur-sm ${
            isCollapsed() ? "text-center" : ""
          }`}
        >
          <Show when={!isCollapsed()}>
            <p class="text-[11px] font-medium tracking-wide text-[#8593A8] dark:text-gray-500 leading-relaxed">
              Developed by Aajneeti Connect Ltd.
            </p>
            <p class="text-[11px] text-[#A9B6C7] dark:text-gray-600">
              © 2026 All rights reserved.
            </p>
          </Show>
        </div>
      </aside>
    </>
  );
}
