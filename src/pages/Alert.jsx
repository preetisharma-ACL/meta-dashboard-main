import { createSignal, createMemo, For, Show, onMount, createEffect, untrack } from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchAlerts, fetchAllSuspensionAlerts } from "../services/alert-service";
import { setHeaderCache, headerCache } from "../cacheStore/appStore";

// Which alerts this panel surfaces: the existing info-only view, PLUS
// account-suspension alerts (type "danger") so they're consistent with the
// banner. categoryKey mirrors the API `category` field.
const isPanelVisible = (n) =>
  TYPE_CONFIG[n.type]?.label?.toLowerCase() === "info" ||
  n.categoryKey === "account_suspended";


const ICONS = {
  danger: (
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  warning: (
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  info: (
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  bell: (
    <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  ),
  check: (
    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  trash: (
    <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
  refresh: (
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
    </svg>
  ),
  chevronLeft: (
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  ),
  chevronRight: (
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  ),
};

// Maps API `type` field → colors & labels
const TYPE_CONFIG = {
  danger: {
    icon: "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400",
    badge: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
    bar: "bg-red-500",
    dot: "bg-red-500",
    label: "Danger",
  },
  warning: {
    icon: "bg-orange-100 text-orange-500 dark:bg-orange-500/20 dark:text-orange-400",
    badge: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-300",
    bar: "bg-orange-500",
    dot: "bg-orange-500",
    label: "Warning",
  },
  info: {
    icon: "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
    bar: "bg-blue-500",
    dot: "bg-blue-500",
    label: "Info",
  },
};

// Fallback config for unknown types
const DEFAULT_CONFIG = {
  icon: "bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400",
  badge: "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300",
  bar: "bg-gray-400",
  dot: "bg-gray-400",
  label: "Alert",
};

function formatTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
}
// API alert → view model. Shared by the mixed feed and the suspension tab so
// both render identically.
const mapAlert = (item, readIds) => ({
  id: item.id,
  title: item.type_label,
  category: item.category_label,
  description: item.message,
  project: item.project_name,
  campaign: item.campaign_name,
  time: formatTime(item.created_at),
  rawTime: item.created_at,
  read: readIds.includes(item.id) || item.is_acknowledged,
  type: item.type,
  categoryKey: item.category,
});

export default function Notifications() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  const [activeTab, setActiveTab] = createSignal("all");
  const [categoryFilter, setCategoryFilter] = createSignal("all");
  const [page, setPage] = createSignal(1);
  const [totalPages, setTotalPages] = createSignal(1);
  const [total, setTotal] = createSignal(0);
  const [hasNext, setHasNext] = createSignal(false);
  const [hasPrev, setHasPrev] = createSignal(false);
  const [allNotifications, setAllNotifications] = createSignal([]);
  // Source for the "Ad Account Suspension" tab — see loadSuspensions().
  const [suspensions, setSuspensions] = createSignal([]);

  //  FIX 1: signal, not plain variable
  const [prevIds, setPrevIds] = createSignal([]);

  const notificationSound = new Audio("/notification.mp3");
  let isUnlocked = false;
  fetch("/notification.mp3").then(r => console.log("File status:", r.status, r.ok))

  //  Request notification permission
  onMount(() => {
    if (Notification.permission !== "granted") {
      Notification.requestPermission();
    }
  });

  //  Unlock audio on first user click (browser requirement)
  onMount(() => {
    const unlock = () => {
      if (!isUnlocked) {
        notificationSound.play().then(() => {
          notificationSound.pause();
          notificationSound.currentTime = 0;
          isUnlocked = true;
        }).catch(() => { });
      }
    };
    window.addEventListener("click", unlock);
    return () => window.removeEventListener("click", unlock);
  });

  //  FIX 2: Properly detect new notifications using signal
  createEffect(() => {
    const current = notifications().map(n => n.id); //  tracked — re-runs when notifications change

    //  untrack prevIds so reading it doesn't re-trigger this effect
    const prev = untrack(() => prevIds());

    if (prev.length > 0) {
      const newOnes = current.filter(id => !prev.includes(id));
      if (newOnes.length > 0) {
        console.log("🔊 Playing sound for", newOnes.length, "new alerts");
        notificationSound.currentTime = 0;
        notificationSound.play()
          .then(() => console.log(" Sound played!"))
          .catch(e => console.error("❌ Sound error:", e));

        if (Notification.permission === "granted") {
          new Notification("New Alert", {
            body: `You have ${newOnes.length} new alert${newOnes.length > 1 ? "s" : ""}`,
          });
        }
      }
    }

    //  update prevIds — safe because we used untrack() above
    setPrevIds(current);
  });

  // Suspension alerts come from the category-filtered endpoint (all pages,
  // acknowledged included) instead of the paginated mixed feed, which only ever
  // returns page 1 of unacknowledged alerts. Failure is non-fatal — the rest of
  // the page still renders.
  const loadSuspensions = async () => {
    try {
      const data = await fetchAllSuspensionAlerts();
      const readIds = JSON.parse(localStorage.getItem("readAlerts") || "[]");
      setSuspensions(data.map((item) => mapAlert(item, readIds)));
    } catch (err) {
      console.error("Failed to fetch suspension alerts:", err);
    }
  };

  const loadAlerts = async (pageNo = 1) => {
    setLoading(true);
    setError(null);
    loadSuspensions(); // same trigger points: mount, Refresh, 30s poll, paging
    try {
      const res = await fetchAlerts(pageNo);

      //  FIX 3: Handle undefined response (401 redirect case)
      if (!res) return;

      const data = res?.data || [];
      const readIds = JSON.parse(localStorage.getItem("readAlerts") || "[]");

      const mapped = data.map((item) => mapAlert(item, readIds));

      setNotifications(mapped);

      const meta = res?.meta?.pagination;
      if (meta) {
        setPage(meta.page);
        setTotalPages(meta.total_pages);
        setTotal(meta.total);
        setHasNext(meta.has_next);
        setHasPrev(meta.has_prev);
      }
    } catch (err) {
      console.error("Failed to fetch alerts:", err);
      setError("Failed to load notifications. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  let hasLoadedAll = false;

  const loadAllAlerts = async () => {
    if (hasLoadedAll) return;
    //  FIX 4: wrap in try/catch + reset flag on failure
    try {
      hasLoadedAll = true;
      let pageNo = 1;
      let allData = [];

      while (true) {
        const res = await fetchAlerts(pageNo);
        if (!res) return; //  stop if redirected to login
        const data = res?.data || [];
        allData = [...allData, ...data];
        if (!res?.meta?.pagination?.has_next) break;
        pageNo++;
      }

      const readIds = JSON.parse(localStorage.getItem("readAlerts") || "[]");
      const mapped = allData.map((item) => ({
        id: item.id,
        read: readIds.includes(item.id) || item.is_acknowledged,
      }));
      setAllNotifications(mapped);
    } catch (err) {
      hasLoadedAll = false; //  allow retry on next visit
      console.error("loadAllAlerts failed:", err);
    }
  };

  onMount(() => {
    loadAlerts(1);
    loadAllAlerts();

    //  FIX 5: Poll every 30s, only when tab is visible
    const interval = setInterval(() => {
      if (!document.hidden) {
        loadAlerts(page());
      }
    }, 30000);

    return () => clearInterval(interval);
  });

  // All unique categories from current data for filter tabs
  const categories = createMemo(() => {
    const cats = new Map();
    notifications().filter(isPanelVisible).forEach((n) => {
      if (!cats.has(n.categoryKey)) {
        cats.set(n.categoryKey, n.category);
      }
    });
    return Array.from(cats.entries()); // [[key, label], ...]
  });

  const filteredNotifications = createMemo(() => {
    // Dedicated suspension tab: only account-suspension alerts, regardless of
    // read/ack state so a critical suspension never hides.
    if (activeTab() === "suspension") {
      return suspensions();
    }

    // Info alerts + account-suspension alerts (see isPanelVisible)
    let list = notifications().filter(isPanelVisible);

    if (activeTab() === "unread") {
      list = list.filter((n) => !n.read);
    }

    if (categoryFilter() !== "all") {
      list = list.filter((n) => n.categoryKey === categoryFilter());
    }

    return list;
  });
  const infoTotal = createMemo(() =>
    notifications().filter(isPanelVisible).length
  );

  const unreadCount = createMemo(() =>
    notifications().filter((n) => !n.read && isPanelVisible(n)).length
  );

  // Unacknowledged account-suspension alerts — drives the red count on the tab.
  const suspensionCount = createMemo(() =>
    suspensions().filter((n) => !n.read).length
  );

  const markAsRead = (id) => {

    // current page
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );

    // all pages
    setAllNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );

    // suspension tab (separate source)
    setSuspensions((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );

    // header dropdown notifications
    setHeaderCache("notifications",
      headerCache.notifications.map((n) =>
        n.id === id ? { ...n, unread: false } : n
      )
    );
    setHeaderCache("unreadTotal",
      Math.max(0, (headerCache.unreadTotal || 0) - 1)
    );

    // localStorage
    const readIds = JSON.parse(localStorage.getItem("readAlerts") || "[]");

    if (!readIds.includes(id)) {
      localStorage.setItem("readAlerts", JSON.stringify([...readIds, id]));
    }
  };

  const markAllRead = () => {

    // current page
    setNotifications((prev) =>
      prev.map((n) => ({ ...n, read: true }))
    );

    // all pages
    setAllNotifications((prev) =>
      prev.map((n) => ({ ...n, read: true }))
    );

    // suspension tab (separate source)
    setSuspensions((prev) =>
      prev.map((n) => ({ ...n, read: true }))
    );

    // header notifications
    setHeaderCache("notifications",
      headerCache.notifications.map((n) => ({
        ...n,
        unread: false,
      }))
    );
    setHeaderCache("unreadTotal", 0);

    // localStorage
    const allIds = allNotifications().map((n) => n.id);
    localStorage.setItem("readAlerts", JSON.stringify(allIds));
  };

  const deleteNotification = (id) =>
    setNotifications((prev) => prev.filter((n) => n.id !== id));

  {/* Description formatter */ }
  const formatDescription = (text) => {
    if (!text) return "";

    const parts = text.split("|").map((p) => p.trim());

    const lastPart = parts[parts.length - 1] || "";

    // sirf sentence wale dot ke baad ka content
    const dotIndex = lastPart.indexOf(". ");

    const afterDot =
      dotIndex !== -1
        ? lastPart.substring(dotIndex + 2).trim()
        : lastPart;

    if (parts.length >= 3) {
      return `${parts[0]} | ${parts[1]} | ${afterDot}`;
    }

    return text;
  };

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-8">
      <div class="mx-auto space-y-6">

        {/* ── Header ── */}
        <div class="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 class="text-2xl font-semibold text-gray-900 dark:text-gray-100 tracking-tight">
              Notifications
            </h1>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {loading()
                ? "Loading alerts..."
                : unreadCount() > 0
                  ? `${unreadCount()} unread alert${unreadCount() > 1 ? "s" : ""} need attention`
                  : "You're all caught up — nice work!"}
            </p>
          </div>

          <div class="flex items-center gap-2">
            {/* Total badge */}
            <Show when={!loading() && infoTotal() > 0}>
              <div class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-green-50 dark:bg-green-500/10 border border-green-200 dark:border-green-500/20">
                <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span class="text-sm font-semibold text-green-700 dark:text-green-300">
                  {infoTotal()} total
                </span>
              </div>
            </Show>

            {/* Refresh button */}
            <button
              onClick={() => loadAlerts(page())}
              disabled={loading()}
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              <span classList={{ "animate-spin": loading() }}>
                {ICONS.refresh}
              </span>
              Refresh
            </button>
            {/* ── TEMP TEST BUTTON — remove after testing ── */}
            {/* <button
              onClick={() => {
                setNotifications(prev => [
                  {
                    id: Date.now(), // fake unique ID
                    title: "Test Alert",
                    category: "Test",
                    description: "This is a test notification to check sound",
                    project: "Test Project",
                    campaign: "Test Campaign",
                    time: "Just now",
                    rawTime: new Date().toISOString(),
                    read: false,
                    type: "danger",
                    categoryKey: "test",
                  },
                  ...prev,
                ]);
              }}
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-green-600 text-white hover:bg-green-700"
            >
              + Test Sound
            </button> */}
          </div>
        </div>

        {/* ── Error state ── */}
        <Show when={error()}>
          <div class="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300 text-sm">
            {ICONS.danger}
            {error()}
            <button
              onClick={() => loadAlerts(1)}
              class="ml-auto underline font-medium"
            >
              Retry
            </button>
          </div>
        </Show>

        {/* ── Main Panel ── */}
        <div class="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 overflow-hidden">

          {/* ── Tabs row ── */}
          <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 flex-wrap gap-3">

            {/* Read / Unread / Suspension tabs */}
            <div class="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl">
              <For each={[
                { key: "all", label: "All" },
                { key: "unread", label: "Unread" },
                { key: "suspension", label: "Ad Account Suspension" },
              ]}>
                {(t) => (
                  <button
                    onClick={() => setActiveTab(t.key)}
                    class={`relative px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${activeTab() === t.key
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                      }`}
                  >
                    {t.label}
                    <Show when={t.key === "unread" && unreadCount() > 0}>
                      <span class="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
                        {unreadCount()}
                      </span>
                    </Show>
                    <Show when={t.key === "suspension" && suspensionCount() > 0}>
                      <span class="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
                        {suspensionCount()}
                      </span>
                    </Show>
                  </button>
                )}
              </For>
            </div>

            {/* Mark all read */}
            <Show when={unreadCount() > 0}>
              <button
                onClick={markAllRead}
                class="flex items-center gap-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
              >
                {ICONS.check}
                Mark all read
              </button>
            </Show>
          </div>

          {/* ── Category filter chips ── */}
          <Show when={categories().length > 1}>
            <div class="flex items-center gap-2 px-5 py-3 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
              <button
                onClick={() => setCategoryFilter("all")}
                class={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${categoryFilter() === "all"
                  ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                  }`}
              >
                All categories
              </button>
              <For each={categories()}>
                {([key, label]) => (
                  <button
                    onClick={() => setCategoryFilter(key)}
                    class={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-colors ${categoryFilter() === key
                      ? "bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
                      }`}
                  >
                    {label}
                  </button>
                )}
              </For>
            </div>
          </Show>

          {/* ── Loading skeleton ── */}
          <Show when={loading()}>
            <div class="divide-y divide-gray-100 dark:divide-gray-800">
              <For each={[1, 2, 3, 4, 5]}>
                {() => (
                  <div class="flex gap-4 px-5 py-4 animate-pulse">
                    <div class="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex-shrink-0" />
                    <div class="flex-1 space-y-2 py-1">
                      <div class="flex gap-2">
                        <div class="h-3 bg-gray-100 dark:bg-gray-800 rounded w-20" />
                        <div class="h-3 bg-gray-100 dark:bg-gray-800 rounded w-16" />
                      </div>
                      <div class="h-3 bg-gray-100 dark:bg-gray-800 rounded w-full" />
                      <div class="h-3 bg-gray-100 dark:bg-gray-800 rounded w-3/4" />
                      <div class="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-16" />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* ── Notification list ── */}
          <Show when={!loading()}>
            <div class="divide-y divide-gray-100 dark:divide-gray-800/70">
              <For each={filteredNotifications()}>
                {(item) => {
                  const cfg = TYPE_CONFIG[item.type] || DEFAULT_CONFIG;
                  const isSuspension = item.categoryKey === "account_suspended";
                  return (
                    <div
                      onClick={() => {
                        // Account-suspension alerts deep-link to the disabled
                        // ad-accounts view; other categories are unchanged.
                        if (isSuspension) navigate("/ad-accounts?status=disabled");
                      }}
                      class={`group relative flex gap-4 px-5 py-4 transition-colors duration-150 ${isSuspension ? "cursor-pointer" : ""} ${!item.read
                        ? "bg-red-50/30 dark:bg-red-500/[0.03] hover:bg-red-50/60 dark:hover:bg-red-500/[0.06]"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800/40"
                        }`}
                    >
                      {/* Left accent bar */}
                      <Show when={!item.read}>
                        <div class={`absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full ${cfg.bar}`} />
                      </Show>



                      {/* Body */}
                      <div class="flex-1 min-w-0 space-y-1">

                        {/* Title row */}
                        {/* Title row */}
                        <div class="flex items-center gap-2 flex-wrap">
                          <p class={`text-sm font-semibold leading-snug ${item.read
                            ? "text-gray-600 dark:text-gray-300"
                            : "text-gray-900 dark:text-gray-100"
                            }`}>
                            {item.project}
                          </p>

                          {/* Info label — plus the danger badge for suspensions */}
                          <Show when={cfg.label?.toLowerCase() === "info" || isSuspension}>
                            <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${cfg.badge}`}>
                              {cfg.label}
                            </span>
                          </Show>

                          <span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 uppercase tracking-wide">
                            {item.category}
                          </span>

                          <Show when={!item.read}>
                            <span class={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
                          </Show>
                        </div>

                        {/* Message */}
                        <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
                          {formatDescription(item.description)}
                        </p>

                        {/* Time */}
                        <p class="text-xs text-gray-400 dark:text-gray-500">
                          {item.time}
                        </p>
                      </div>

                      {/* Actions */}
                      <div class="flex-shrink-0 flex items-start gap-1.5 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                        <Show when={!item.read}>
                          <button
                            onClick={(e) => { e.stopPropagation(); markAsRead(item.id); }}
                            class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-gray-700 hover:bg-gray-800 dark:bg-gray-600 dark:hover:bg-gray-500 text-white transition-colors"
                          >
                            {ICONS.check}
                            Read
                          </button>
                        </Show>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteNotification(item.id); }}
                          class="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-400 dark:text-gray-500 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 transition-colors"
                        >
                          {ICONS.trash}
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>

          {/* ── Empty state ── */}
          <Show when={!loading() && filteredNotifications().length === 0}>
            <div class="flex flex-col items-center justify-center py-20 px-6 text-center">
              <div class="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4 text-gray-400 dark:text-gray-500">
                {ICONS.bell}
              </div>
              <p class="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">
                {activeTab() === "unread"
                  ? "No unread notifications"
                  : activeTab() === "suspension"
                    ? "No account suspensions"
                    : "No notifications"}
              </p>
              <p class="text-xs text-gray-400 dark:text-gray-500 max-w-xs leading-relaxed">
                {activeTab() === "unread"
                  ? "All caught up — nothing left to read."
                  : activeTab() === "suspension"
                    ? "No ad accounts are currently suspended."
                    : "New alerts will appear here when they arrive."}
              </p>
            </div>
          </Show>

          {/* ── Footer: count + pagination ── */}
          <Show when={!loading() && notifications().length > 0}>
            <div class="px-5 py-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between flex-wrap gap-3">

              <p class="text-xs text-gray-400 dark:text-gray-500">
                Showing {filteredNotifications().length} of{" "}
                {activeTab() === "suspension" ? suspensions().length : infoTotal()} alerts
              </p>

              {/* Pagination */}
              <div class="flex items-center gap-2">
                <button
                  onClick={() => { if (hasPrev()) loadAlerts(page() - 1); }}
                  disabled={!hasPrev() || loading()}
                  class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-default transition-colors"
                >
                  {ICONS.chevronLeft}
                  Prev
                </button>

                <span class="text-xs text-gray-500 dark:text-gray-400 px-1">
                  Page 1 of 1
                </span>
                <Show when={infoTotal() > 0}>
                <button
                  onClick={() => { if (hasNext()) loadAlerts(page() + 1); }}
                  disabled={!hasNext() || loading()}
                  class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 dark:bg-gray-700 text-white hover:bg-gray-900 dark:hover:bg-gray-600 disabled:opacity-40 disabled:cursor-default transition-colors"
                >
                  Next
                  {ICONS.chevronRight}
                </button>
                </Show>
              </div>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}