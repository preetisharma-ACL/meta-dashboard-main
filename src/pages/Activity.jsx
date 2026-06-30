import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { getActivities } from "../services/activityLog";

// ─── Activity Log ─────────────────────────────────────────────────────────────
// Read-only view of the append-only activity trail (GET /api/activity/). There is
// deliberately no edit or delete control — entries are immutable and reads are
// role-scoped server-side.

const ACTION_LABELS = {
  campaign_paused: "Paused campaign",
  campaign_resumed: "Resumed campaign",
};

// Known actions for the dropdown. `action` is an open string server-side, so new
// values still render fine via actionLabel(); this just seeds the filter.
const KNOWN_ACTIONS = ["campaign_paused", "campaign_resumed"];

const actionLabel = (a) =>
  ACTION_LABELS[a] ??
  String(a || "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

const fmtTime = (iso) => {
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const RESULT_STYLES = {
  success: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
  failure: "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
};

const PAGE_SIZE = 50;

export default function Activity() {
  const [search, setSearch] = createSignal("");
  const [debouncedSearch, setDebouncedSearch] = createSignal("");
  const [resultFilter, setResultFilter] = createSignal("all");
  const [actionFilter, setActionFilter] = createSignal("all");
  const [page, setPage] = createSignal(1);

  const [entries, setEntries] = createSignal([]);
  const [pagination, setPagination] = createSignal(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);

  // Debounce the search box so we don't fire a request per keystroke.
  createEffect(() => {
    const q = search();
    const t = setTimeout(() => {
      setPage(1);
      setDebouncedSearch(q);
    }, 350);
    onCleanup(() => clearTimeout(t));
  });

  // Refetch whenever page or any (debounced) filter changes.
  createEffect(() => {
    const params = {
      page: page(),
      pageSize: PAGE_SIZE,
      filters: {
        search: debouncedSearch(),
        action: actionFilter(),
        result: resultFilter(),
      },
    };

    let cancelled = false;
    setLoading(true);
    setError(null);
    getActivities(params)
      .then(({ entries, pagination }) => {
        if (cancelled) return;
        setEntries(entries);
        setPagination(pagination);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[Activity] load failed:", err);
        setError("Couldn't load the activity log. Please try again.");
        setEntries([]);
        setPagination(null);
      })
      .finally(() => !cancelled && setLoading(false));

    onCleanup(() => (cancelled = true));
  });

  const onFilterChange = (setter) => (value) => {
    setPage(1);
    setter(value);
  };

  const total = () => pagination()?.total ?? entries().length;
  const hasPrev = () => pagination()?.has_prev ?? page() > 1;
  const hasNext = () => pagination()?.has_next ?? false;

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 lg:p-8">

      {/* Header */}
      <div class="mb-4">
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
          Activity Log
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          A permanent, append-only record of actions taken in the dashboard.
        </p>
      </div>

      {/* Append-only notice */}
      <div class="flex items-start gap-2 mb-4 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50
                  dark:border-amber-900/50 dark:bg-amber-900/20 text-amber-800 dark:text-amber-200 text-sm">
        <svg class="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m0-10a2 2 0 012 2v1H10V9a2 2 0 012-2zM5 13h14v8H5z" />
        </svg>
        <span>
          Entries here are <b>never edited or deleted</b>. The log only ever grows as
          new actions are recorded.
        </span>
      </div>

      {/* Filters */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                  dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex w-[360px] max-w-full">
          <svg
            class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by target, user or action…"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white
                   focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>

        <select
          value={actionFilter()}
          onChange={(e) => onFilterChange(setActionFilter)(e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200
                 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          <option value="all">All actions</option>
          <For each={KNOWN_ACTIONS}>
            {(a) => <option value={a}>{actionLabel(a)}</option>}
          </For>
        </select>

        <select
          value={resultFilter()}
          onChange={(e) => onFilterChange(setResultFilter)(e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200
                 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          <option value="all">All results</option>
          <option value="success">Success</option>
          <option value="failure">Failure</option>
          <option value="info">Info</option>
        </select>

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {total()} entr{total() !== 1 ? "ies" : "y"}
        </span>
      </div>

      {/* Error */}
      <Show when={error()}>
        <div class="mb-4 px-4 py-3 rounded-xl border border-red-200 bg-red-50
                    dark:border-red-900/50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm">
          {error()}
        </div>
      </Show>

      {/* Table */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                  dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50
                       dark:bg-gray-800/60 text-gray-500 dark:text-gray-400
                       uppercase text-xs tracking-wider">
              <th class="p-3 text-left whitespace-nowrap">Time</th>
              <th class="p-3 text-left whitespace-nowrap">User</th>
              <th class="p-3 text-left whitespace-nowrap">Action</th>
              <th class="p-3 text-left">Target</th>
              <th class="p-3 text-left whitespace-nowrap">Change</th>
              <th class="p-3 text-left whitespace-nowrap">Result</th>
            </tr>
          </thead>

          <Show
            when={!loading()}
            fallback={
              <tbody>
                <For each={Array(8).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                      <For each={Array(6).fill(0)}>
                        {() => (
                          <td class="p-3"><div class="h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={entries()}>
                {(a, i) => (
                  <tr
                    class={`border-b border-gray-100 dark:border-gray-800
                            ${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/60 dark:bg-gray-800/30"}`}
                  >
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {fmtTime(a.timestamp)}
                    </td>
                    <td class="p-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      <div class="flex flex-col">
                        <span class="font-medium">{a.actor ?? "—"}</span>
                        <Show when={a.actorRole}>
                          <span class="text-xs text-gray-400 dark:text-gray-500">{a.actorRole}</span>
                        </Show>
                      </div>
                    </td>
                    <td class="p-3 text-gray-700 dark:text-gray-300 whitespace-nowrap font-medium">
                      {actionLabel(a.action)}
                    </td>
                    <td class="p-3 max-w-[320px]">
                      <Show
                        when={a.category === "campaign" && a.targetId != null}
                        fallback={<span class="text-gray-700 dark:text-gray-300 line-clamp-1">{a.target ?? "—"}</span>}
                      >
                        <A
                          href={`/campaign/${a.targetId}`}
                          class="text-purple-700 dark:text-purple-300 hover:underline line-clamp-1"
                          title={a.target}
                        >
                          {a.target ?? `#${a.targetId}`}
                        </A>
                      </Show>
                    </td>
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      <Show when={a.details?.from || a.details?.to} fallback={"—"}>
                        {a.details?.from ?? "?"} → {a.details?.to ?? "?"}
                      </Show>
                    </td>
                    <td class="p-3 whitespace-nowrap">
                      <span class={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${RESULT_STYLES[a.result] ?? RESULT_STYLES.info}`}>
                        {a.result}
                      </span>
                      <Show when={a.result === "failure" && a.details?.error}>
                        <span class="block text-xs text-red-500 dark:text-red-400 mt-1 max-w-[220px] line-clamp-2" title={a.details.error}>
                          {a.details.error}
                        </span>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>

              <Show when={entries().length === 0}>
                <tr>
                  <td colspan="6" class="py-16 text-center text-gray-400 dark:text-gray-500">
                    <svg class="w-10 h-10 mx-auto mb-3 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    No activity matches your filters
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>
        </table>
      </div>

      {/* Pagination */}
      <div class="mt-4 flex items-center justify-between gap-3 text-sm">
        <span class="text-gray-500 dark:text-gray-400">
          <Show when={pagination()} fallback={`${entries().length} shown`}>
            Page {pagination().page} of {pagination().total_pages || 1}
          </Show>
        </span>
        <div class="flex items-center gap-2">
          <button
            onClick={() => hasPrev() && setPage((p) => Math.max(1, p - 1))}
            disabled={!hasPrev() || loading()}
            class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300
                   hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-default"
          >
            Previous
          </button>
          <button
            onClick={() => hasNext() && setPage((p) => p + 1)}
            disabled={!hasNext() || loading()}
            class="px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300
                   hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-default"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
