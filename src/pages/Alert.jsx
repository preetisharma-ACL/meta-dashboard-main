import { createSignal, createMemo, For, Show } from "solid-js";

const ICONS = {
  message: (
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
    </svg>
  ),
  alert: (
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  update: (
    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  ),
  bell: (
    <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  ),
  check: (
    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  trash: (
    <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  ),
};

const ICON_STYLES = {
  message: "bg-indigo-100 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400",
  alert:   "bg-orange-100 text-orange-500 dark:bg-orange-500/20 dark:text-orange-400",
  update:  "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
};

export default function Notifications() {
  const [notifications, setNotifications] = createSignal([
    {
      id: 1,
      title: "New Message",
      description: "You received a message from a client requesting a project update.",
      time: "2 min ago",
      read: false,
      type: "message",
    },
    {
      id: 2,
      title: "Server Alert",
      description: "CPU usage exceeded 90% threshold on the production server.",
      time: "10 min ago",
      read: false,
      type: "alert",
    },
    {
      id: 3,
      title: "Project Update",
      description: 'The Q4 dashboard project has been moved to "In Review" status.',
      time: "1 hour ago",
      read: true,
      type: "update",
    },
  ]);

  const [activeTab, setActiveTab] = createSignal("all");
  const [dropdownOpen, setDropdownOpen] = createSignal(false);

  const filteredNotifications = createMemo(() =>
    activeTab() === "unread"
      ? notifications().filter((n) => !n.read)
      : notifications()
  );

  const unreadCount = createMemo(() =>
    notifications().filter((n) => !n.read).length
  );

  const markAsRead = (id) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const deleteNotification = (id) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-8">

      {/* ─── Header Bar ─── */}
      <div class=" mx-auto mb-6 flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-gray-100 tracking-tight">
            Notifications
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {unreadCount() > 0
              ? `You have ${unreadCount()} unread notification${unreadCount() > 1 ? "s" : ""}`
              : "You're all caught up!"}
          </p>
        </div>  
      </div>

      {/* ─── Main Panel ─── */}
      <div class="mx-auto bg-white dark:bg-gray-900 rounded-2xl border border-gray-50 dark:border-gray-800 shadow-sm overflow-hidden">

        {/* Tabs + Mark All */}
        <div class="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-100 dark:border-gray-800">
          <div class="flex gap-1.5">
            <button
              onClick={() => setActiveTab("all")}
              class={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                activeTab() === "all"
                  ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              All
            </button>
            <button
              onClick={() => setActiveTab("unread")}
              class={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                activeTab() === "unread"
                  ? "bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                  : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`}
            >
              Unread
              <Show when={unreadCount() > 0}>
                <span class={`text-[11px] font-semibold px-1.5 py-0.5 rounded-md tabular-nums ${
                  activeTab() === "unread"
                    ? "bg-white/20 dark:bg-gray-900/20"
                    : "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-400"
                }`}>
                  {unreadCount()}
                </span>
              </Show>
            </button>
          </div>

          <Show when={unreadCount() > 0}>
            <button
              onClick={markAllRead}
              class="text-xs font-medium text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors duration-150"
            >
              Mark all as read
            </button>
          </Show>
        </div>

        {/* Notification List */}
        <div class="divide-y divide-gray-100 dark:divide-gray-800">
          <For each={filteredNotifications()}>
            {(item) => (
              <div
                class={`group flex gap-4 px-5 py-4 transition-colors duration-150 ${
                  !item.read
                    ? "bg-indigo-50/40 dark:bg-indigo-500/[0.04] hover:bg-indigo-50/70 dark:hover:bg-indigo-500/[0.07]"
                    : "hover:bg-gray-50 dark:hover:bg-gray-800/50"
                }`}
              >
                {/* Unread dot */}
                <div class="flex-shrink-0 flex items-center pt-1">
                  <span class={`w-1.5 h-1.5 rounded-full transition-colors ${
                    !item.read
                      ? "bg-indigo-500 dark:bg-indigo-400"
                      : "bg-transparent"
                  }`} />
                </div>

                {/* Icon */}
                <div class={`flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${ICON_STYLES[item.type]}`}>
                  {ICONS[item.type]}
                </div>

                {/* Body */}
                <div class="flex-1 min-w-0">
                  <p class={`text-sm font-medium leading-snug ${
                    item.read
                      ? "text-gray-600 dark:text-gray-300"
                      : "text-gray-900 dark:text-gray-100"
                  }`}>
                    {item.title}
                  </p>
                  <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                    {item.description}
                  </p>
                  <p class="text-xs text-gray-400 dark:text-gray-500 mt-1.5 font-mono">
                    {item.time}
                  </p>
                </div>

                {/* Actions */}
                <div class="flex-shrink-0 flex items-start gap-1.5 pt-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  <Show when={!item.read}>
                    <button
                      onClick={() => markAsRead(item.id)}
                      title="Mark as read"
                      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 text-white transition-colors duration-150"
                    >
                      {ICONS.check}
                      Read
                    </button>
                  </Show>
                  <button
                    onClick={() => deleteNotification(item.id)}
                    title="Delete"
                    class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400 transition-colors duration-150"
                  >
                    {ICONS.trash}
                    Delete
                  </button>
                </div>
              </div>
            )}
          </For>
        </div>

        {/* Empty State */}
        <Show when={filteredNotifications().length === 0}>
          <div class="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div class="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4 text-gray-400 dark:text-gray-500">
              {ICONS.bell}
            </div>
            <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {activeTab() === "unread" ? "No unread notifications" : "No notifications"}
            </p>
            <p class="text-xs text-gray-400 dark:text-gray-500">
              {activeTab() === "unread"
                ? "All caught up — nothing left to read."
                : "New alerts and messages will appear here."}
            </p>
          </div>
        </Show>
      </div>
    </div>
  );
}