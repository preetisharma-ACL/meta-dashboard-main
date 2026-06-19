import { createSignal, createEffect, For, Show, on } from "solid-js";
import Swal from "sweetalert2";
import { fetchAlerts, acknowledgeAlert } from "../services/alert-service";
import { asTeamMemberId } from "../stores/cmScope";

// Severity styling keyed off the API `type` field.
const TYPE_CONFIG = {
  danger: {
    wrap: "border-red-200 dark:border-red-800/60",
    bar: "bg-red-500",
    icon: "bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400",
    badge: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  },
  warning: {
    wrap: "border-amber-200 dark:border-amber-800/60",
    bar: "bg-amber-500",
    icon: "bg-amber-100 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
    badge: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300",
  },
  info: {
    wrap: "border-blue-200 dark:border-blue-800/60",
    bar: "bg-blue-500",
    icon: "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400",
    badge: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300",
  },
};
const DEFAULT_CFG = {
  wrap: "border-gray-200 dark:border-gray-700",
  bar: "bg-gray-400",
  icon: "bg-gray-100 text-gray-600 dark:bg-gray-500/20 dark:text-gray-400",
  badge: "bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300",
};

const TABS = [
  { key: "false", label: "Unacknowledged" },
  { key: "true", label: "Acknowledged" },
  { key: "all", label: "All" },
];

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

export default function AlertsPanel() {
  const [tab, setTab] = createSignal("false");
  const [items, setItems] = createSignal([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);
  const [page, setPage] = createSignal(1);
  const [pagination, setPagination] = createSignal(null);
  const [unackTotal, setUnackTotal] = createSignal(0);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchAlerts(page(), tab());
      if (!res) return; // redirected to login
      setItems(Array.isArray(res.data) ? res.data : []);
      setPagination(res?.meta?.pagination ?? null);
    } catch (err) {
      console.error("[AlertsPanel] load failed:", err);
      setError("Failed to load alerts. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Unacknowledged count for the badge — fetched independently of the active
  // tab so the badge is always correct. Re-runs when the switch scope changes.
  const loadUnackCount = async () => {
    try {
      const res = await fetchAlerts(1, "false");
      setUnackTotal(res?.meta?.pagination?.total ?? (res?.data?.length || 0));
    } catch (err) {
      console.error("[AlertsPanel] unack count failed:", err);
    }
  };

  // Refetch list when tab, page, or switch scope changes.
  createEffect(on([tab, page, asTeamMemberId], () => load()));
  // Refetch badge when switch scope changes.
  createEffect(on(asTeamMemberId, () => loadUnackCount()));

  const onTab = (key) => {
    if (tab() === key) return;
    setPage(1);
    setTab(key);
  };

  const acknowledge = async (alert) => {
    const id = alert.id;
    // Optimistic: mark acknowledged in place; drop it from the Unacknowledged
    // tab. Decrement the badge.
    const prevItems = items();
    setItems((list) =>
      tab() === "false"
        ? list.filter((a) => a.id !== id)
        : list.map((a) => (a.id === id ? { ...a, is_acknowledged: true } : a)),
    );
    setUnackTotal((n) => Math.max(0, n - 1));

    try {
      await acknowledgeAlert(id);
    } catch (err) {
      if (err?.status === 404) {
        // Out of scope — it's gone for us anyway; keep it removed, just inform.
        Swal.fire({
          icon: "info",
          title: "Alert no longer available",
          toast: true,
          position: "top-end",
          timer: 3000,
          showConfirmButton: false,
        });
        return;
      }
      // Genuine failure — revert.
      console.error("[AlertsPanel] acknowledge failed:", err);
      setItems(prevItems);
      setUnackTotal((n) => n + 1);
      Swal.fire({
        icon: "error",
        title: "Couldn't acknowledge",
        text: "Please try again.",
        toast: true,
        position: "top-end",
        timer: 3000,
        showConfirmButton: false,
      });
    }
  };

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-8">
      <div class="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div class="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 class="text-2xl font-semibold text-gray-900 dark:text-gray-100 tracking-tight flex items-center gap-3">
              Alerts
              {/* Unacknowledged count badge (bell) */}
              <span class="relative inline-flex items-center justify-center w-9 h-9 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 01-3.46 0" />
                </svg>
                <Show when={unackTotal() > 0}>
                  <span class="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 bg-red-500 text-white text-[11px] font-bold rounded-full flex items-center justify-center">
                    {unackTotal() > 99 ? "99+" : unackTotal()}
                  </span>
                </Show>
              </span>
            </h1>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {unackTotal() > 0
                ? `${unackTotal()} unacknowledged alert${unackTotal() > 1 ? "s" : ""} need attention`
                : "You're all caught up."}
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading()}
            class="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            <span classList={{ "animate-spin": loading() }}>
              <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </span>
            Refresh
          </button>
        </div>

        {/* Filter tabs */}
        <div class="flex gap-1 p-1 bg-gray-100 dark:bg-gray-800 rounded-xl w-fit">
          <For each={TABS}>
            {(t) => (
              <button
                onClick={() => onTab(t.key)}
                class={`relative px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
                  tab() === t.key
                    ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
                }`}
              >
                {t.label}
                <Show when={t.key === "false" && unackTotal() > 0}>
                  <span class="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-red-500 text-white">
                    {unackTotal()}
                  </span>
                </Show>
              </button>
            )}
          </For>
        </div>

        {/* Error */}
        <Show when={error()}>
          <div class="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300 text-sm">
            {error()}
            <button onClick={load} class="ml-auto underline font-medium">Retry</button>
          </div>
        </Show>

        {/* Loading skeleton */}
        <Show when={loading()}>
          <div class="space-y-3">
            <For each={[1, 2, 3, 4]}>
              {() => (
                <div class="flex gap-4 p-4 rounded-xl border border-gray-100 dark:border-gray-800 animate-pulse">
                  <div class="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-800 flex-shrink-0" />
                  <div class="flex-1 space-y-2 py-1">
                    <div class="h-3 bg-gray-100 dark:bg-gray-800 rounded w-32" />
                    <div class="h-3 bg-gray-100 dark:bg-gray-800 rounded w-3/4" />
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* List */}
        <Show when={!loading()}>
          <div class="space-y-3">
            <For each={items()}>
              {(a) => {
                const cfg = TYPE_CONFIG[a.type] || DEFAULT_CFG;
                return (
                  <div class={`relative flex gap-4 p-4 rounded-xl border bg-white dark:bg-gray-900 ${cfg.wrap}`}>
                    <div class={`absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full ${cfg.bar}`} />
                    <div class={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${cfg.icon}`}>
                      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                    </div>
                    <div class="flex-1 min-w-0 space-y-1">
                      <div class="flex items-center gap-2 flex-wrap">
                        <span class={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${cfg.badge}`}>
                          {a.type_label ?? a.type}
                        </span>
                        <span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 uppercase tracking-wide">
                          {a.category_label ?? a.category}
                        </span>
                        <Show when={a.is_acknowledged}>
                          <span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300">
                            Acknowledged
                          </span>
                        </Show>
                      </div>
                      <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{a.message}</p>
                      <p class="text-xs text-gray-400 dark:text-gray-500">
                        <Show when={a.project_name}>
                          <span class="font-medium text-gray-500 dark:text-gray-400">{a.project_name}</span>
                        </Show>
                        <Show when={a.campaign_name}>
                          {a.project_name ? " · " : ""}
                          <ACampaign id={a.campaign_id} name={a.campaign_name} />
                        </Show>
                        <Show when={a.project_name || a.campaign_name}>{" · "}</Show>
                        {timeAgo(a.created_at)}
                      </p>
                    </div>
                    <Show when={!a.is_acknowledged}>
                      <button
                        onClick={() => acknowledge(a)}
                        class="flex-shrink-0 self-start flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 hover:bg-gray-900 dark:bg-gray-700 dark:hover:bg-gray-600 text-white transition-colors"
                      >
                        <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        Acknowledge
                      </button>
                    </Show>
                  </div>
                );
              }}
            </For>

            {/* Empty */}
            <Show when={items().length === 0}>
              <div class="flex flex-col items-center justify-center py-20 text-center">
                <div class="w-14 h-14 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4 text-gray-400">
                  <svg class="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 01-3.46 0" />
                  </svg>
                </div>
                <p class="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  {tab() === "false" ? "No unacknowledged alerts" : "No alerts"}
                </p>
              </div>
            </Show>
          </div>
        </Show>

        {/* Pagination */}
        <Show when={!loading() && pagination() && pagination().total_pages > 1}>
          <div class="flex items-center justify-between pt-2">
            <span class="text-xs text-gray-400 dark:text-gray-500">
              Page {pagination().page} of {pagination().total_pages} · {pagination().total} total
            </span>
            <div class="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={!pagination().has_prev || loading()}
                class="px-3 py-1.5 rounded-lg text-xs font-medium border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 transition-colors"
              >
                Prev
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={!pagination().has_next || loading()}
                class="px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800 dark:bg-gray-700 text-white hover:bg-gray-900 dark:hover:bg-gray-600 disabled:opacity-40 transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}

// Small inline link to a campaign (kept local to avoid extra imports churn).
function ACampaign(props) {
  return (
    <a href={`/campaign/${props.id}`} class="text-purple-600 dark:text-purple-400 hover:underline">
      {props.name}
    </a>
  );
}
