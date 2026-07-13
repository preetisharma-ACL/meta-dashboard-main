import {
  createSignal,
  Show,
  For,
  onMount,
  onCleanup,
  createEffect,
} from "solid-js";
import { useSidebar } from "../context/SidebarContext";
import { useTheme } from "../context/ThemeContext";
import { fetchUser } from "../services/userProfile";
import { handleLogout } from "../pages/login/LoginForm";
import { fetchAlerts } from "../services/alert-service";
import SwitchModeDropdown from "./SwitchModeDropdown";
import { useNavigate, useLocation } from "@solidjs/router";
import {
  headerCache,
  setHeaderCache,
  isHeaderCacheStale,
} from "../cacheStore/appStore";

export default function Header() {
  const { isCollapsed, toggleSidebar, toggleMobileSidebar } = useSidebar();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  // ── UI-only signals (dropdowns) — never cached, local only ────────────────
  const [showUserMenu, setShowUserMenu] = createSignal(false);
  const [showNotifications, setShowNotifications] = createSignal(false);

  // ── Read from global cache ────────────────────────────────────────────────
  const user = () => headerCache.user;
  const notifications = () => headerCache.notifications;
  const unreadTotal = () => headerCache.unreadTotal || 0;
  const loading = () => headerCache.loading;

  function formatTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    if (diffHours < 24)
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  }

  //  User profile loads on every page (incl. Billing) — not an alert call.
  onMount(async () => {
    if (headerCache.user) return;
    if (headerCache.loading) return;

    try {
      setHeaderCache("loading", true);

      const userRes = await fetchUser();

      setHeaderCache({
        ...headerCache,
        user: userRes.data,
        loading: false,
      });
    } catch (err) {
      console.error("[Header] Failed to load user:", err);
      setHeaderCache("loading", false);
    }
  });

  //  Notifications/alerts load — paginates through every alert page.
  const loadAlerts = async () => {
    try {
      const res = await fetchAlerts(1);

      if (!res) return;

      const readIds = JSON.parse(localStorage.getItem("readAlerts") || "[]");

      const allNotifications = (res.data || [])
        // Info alerts as before, PLUS account-suspension alerts (type "danger")
        // so the bell surfaces them consistently with the top banner.
        .filter(
          (item) =>
            item.type?.toLowerCase() === "info" ||
            item.category === "account_suspended",
        )
        .map((item) => ({
          id: item.id,
          title:
            item.category === "account_suspended"
              ? "Ad account suspended"
              : item.project_name || "Project",
          message: item.message,
          time: formatTime(item.created_at),
          unread: !readIds.includes(item.id) && !item.is_acknowledged,
          category: item.category,
        }));

      setHeaderCache({
        ...headerCache,
        notifications: allNotifications.slice(0, 5),
        unreadTotal: allNotifications.filter((n) => n.unread).length,
        lastFetched: Date.now(),
      });
    } catch (err) {
      alertsLoaded = false;
      console.error("[Header] Failed to load alerts:", err);
    }
  };

  //  Alerts are NEVER fetched on the Billing page. Header mounts once, so a
  //  route-aware effect skips Billing yet still loads on any other page.
  let alertsLoaded = false;
  createEffect(() => {
    if (location.pathname === "/billing") return; //  skip alerts on Billing
    if (alertsLoaded) return;
    if (!isHeaderCacheStale()) {
      alertsLoaded = true;
      return;
    } // cache fresh
    alertsLoaded = true;
    loadAlerts();
  });

  // ── Close dropdowns when clicking outside ─────────────────────────────────
  onMount(() => {
    const handleOutsideClick = (e) => {
      if (!e.target.closest(".header-user-menu")) setShowUserMenu(false);
      if (!e.target.closest(".header-notifications"))
        setShowNotifications(false);
    };
    document.addEventListener("click", handleOutsideClick);
    onCleanup(() => document.removeEventListener("click", handleOutsideClick));
  });

  const getInitials = (name) => {
    if (!name) return "";
    if (name.includes("@")) return name.charAt(0).toUpperCase();
    const words = name.trim().split(" ");
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
  };

  const unreadCount = () => unreadTotal();

  return (
    <header class="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-30">
      <div class="h-full px-4 flex items-center justify-between">
        {/* Left Section */}
        <div class="flex items-center gap-4">
          <button
            onClick={toggleMobileSidebar}
            class="lg:hidden p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg
              class="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <button
            onClick={toggleSidebar}
            class="hidden lg:block p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <svg
              class="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 6h16M4 12h16M4 18h16"
              />
            </svg>
          </button>
          <div class="hidden md:flex items-center gap-2 bg-gray-100 dark:bg-gray-700 rounded-lg px-4 py-2 w-96">
            <svg
              class="w-5 h-5 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              placeholder="Search..."
              class="bg-transparent border-none outline-none text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 w-full"
            />
          </div>
        </div>

        {/* Right Section */}
        <div class="flex items-center gap-3">
          {/* CM Tier-1 switch-mode dropdown (renders only for team leads) */}
          <SwitchModeDropdown />

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title={isDark() ? "Switch to light mode" : "Switch to dark mode"}
          >
            <Show
              when={isDark()}
              fallback={
                <svg
                  class="w-5 h-5 text-gray-600 dark:text-gray-300"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
              }
            >
              <svg
                class="w-5 h-5 text-gray-600 dark:text-gray-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            </Show>
          </button>

          {/* Notifications */}
          <div class="relative header-notifications">
            <button
              onClick={() => setShowNotifications(!showNotifications())}
              class="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors relative"
            >
              <svg
                class="w-5 h-5 text-gray-600 dark:text-gray-300"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
              </svg>
              {/* ✅ Badge shows real unread count */}
              <Show when={unreadCount() > 0}>
                <span class="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
                  {unreadCount()}
                </span>
              </Show>
            </button>

            <Show when={showNotifications()}>
              <div class="absolute right-0 mt-4 w-80 max-w-[calc(100vw-1.5rem)] bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden z-50">
                <div class="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <h3 class="font-semibold text-gray-900 dark:text-white">
                    Notifications
                  </h3>
                  <Show when={unreadCount() > 0}>
                    <span class="text-xs bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded-full font-medium">
                      {unreadCount()} unread
                    </span>
                  </Show>
                </div>
                <div class="max-h-96 overflow-y-auto">
                  <Show
                    when={notifications().length > 0}
                    fallback={
                      <p class="p-4 text-sm text-gray-500 text-center">
                        No new notifications
                      </p>
                    }
                  >
                    <For each={notifications()}>
                      {(notif) => (
                        <div
                          onClick={() => {
                            // Only account-suspension alerts navigate — to the
                            // disabled ad-accounts view. Others keep their
                            // existing (no-op) behavior.
                            if (notif.category === "account_suspended") {
                              setShowNotifications(false);
                              navigate("/ad-accounts?status=disabled");
                            }
                          }}
                          class={`p-4 border-b border-gray-100 dark:border-gray-700 hover:bg-blue-50 dark:hover:bg-gray-700 cursor-pointer transition-colors ${notif.unread ? "bg-gray-50 dark:bg-blue-900/10" : ""}`}
                        >
                          <div class="flex items-start gap-3">
                            <div
                              class={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${notif.unread ? "bg-blue-800" : "bg-gray-300"}`}
                            />
                            <div class="flex-1 min-w-0">
                              <h4 class="text-sm font-medium text-blue-800 dark:text-white truncate">
                                {notif.title}
                              </h4>
                              <p class="text-xs text-gray-700 dark:text-gray-400 mt-1 line-clamp-2">
                                {notif.message}
                              </p>
                              <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                {notif.time}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </For>
                  </Show>
                </div>
                <div class="p-3 text-center border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={() => {
                      setShowNotifications(false);
                      navigate("/notifications");
                    }}
                    class="text-sm text-blue-800 dark:text-blue-400 hover:underline"
                  >
                    View all notifications
                  </button>
                </div>
              </div>
            </Show>
          </div>

          {/* User Menu */}
          <div class="relative header-user-menu">
            <button
              onClick={() => setShowUserMenu(!showUserMenu())}
              class="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              {/* ✅ Show skeleton avatar while loading */}
              <Show
                when={!loading()}
                fallback={
                  <div class="w-8 h-8 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse" />
                }
              >
                <div class="w-8 h-8 bg-blue-900 rounded-full flex items-center justify-center text-white font-semibold text-sm">
                  {getInitials(user()?.username)}
                </div>
              </Show>
              <div class="hidden md:block text-left">
                <Show
                  when={!loading()}
                  fallback={
                    <div class="space-y-1">
                      <div class="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                      <div class="h-2 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                    </div>
                  }
                >
                  <p class="text-sm font-medium text-gray-900 dark:text-white">
                    {user()?.username}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {user()?.organization_name}
                  </p>
                </Show>
              </div>
              <svg
                class="w-4 h-4 text-gray-600 dark:text-gray-300"
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
            </button>

            <Show when={showUserMenu()}>
              <div class="absolute right-0 mt-2 w-70 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 overflow-hidden z-50">
                <div class="p-3 border-b border-gray-200 dark:border-gray-700">
                  <p class="text-sm font-medium text-gray-900 dark:text-white">
                    {user()?.username}
                  </p>
                  <p class="text-xs text-gray-500 dark:text-gray-400">
                    {user()?.organization_name}
                  </p>
                </div>
                <div class="py-2">
                  <button class="w-full text-left px-4 py-2 text-sm text-blue-800 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-gray-700 transition-colors">
                    Profile Settings
                  </button>
                </div>
                <div class="border-t border-gray-200 dark:border-gray-700">
                  <button
                    onClick={handleLogout}
                    class="w-full text-left px-4 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </header>
  );
}
