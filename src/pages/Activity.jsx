import {
  createSignal,
  createEffect,
  createMemo,
  createResource,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { A } from "@solidjs/router";
import { getActivities } from "../services/activityLog";
import { fetchHierarchyClients } from "../services/cm";
import RowsPerPageSelect from "../components/common/RowsPerPageSelect";

// ─── Activity Log ─────────────────────────────────────────────────────────────
// Read-only view of the append-only activity trail (GET /api/activity/). There is
// deliberately no edit or delete control — entries are immutable and reads are
// role-scoped server-side.
//
// The feed carries more than campaign events now (auth logins, payment_*,
// leads_*). Rows render generically off actor/action/category/result/target/
// timestamp, so new categories need no per-type branch — only the Change column
// picks a sensible detail per shape (from→to, amount, ip, count).

// The canonical actions the backend emits, grouped for the filter's <optgroup>s.
// The dropdown is seeded from this so you can filter for an action that isn't on
// the page you're looking at. `action` is still an open string server-side, so
// actionOptions() also merges in anything the feed returns that isn't listed
// here — a new action type is never invisible.
//
// `result` is a SEPARATE axis: a failed login is action=login + result=failure,
// so failure variants never belong in this list — the result filter covers them.
const ACTION_GROUPS = [
  {
    category: "auth",
    label: "Auth",
    actions: [["login", "Login"]],
  },
  {
    category: "payment",
    label: "Payment",
    actions: [
      ["payment_created", "Payment recorded"],
      ["payment_updated", "Payment edited"],
      ["payment_docs_completed", "Docs completed"],
      ["payment_deleted", "Payment deleted"],
    ],
  },
  {
    category: "lead",
    label: "Lead",
    actions: [
      ["leads_fed", "Leads fed"],
      ["leads_updated", "Leads updated"],
      ["leads_revoked", "Leads revoked"],
    ],
  },
  {
    category: "campaign",
    label: "Campaign",
    actions: [
      ["campaign_paused", "Campaign paused"],
      ["campaign_resumed", "Campaign resumed"],
      ["campaign_budget_changed", "Budget changed"],
    ],
  },
];

const ACTION_LABELS = Object.fromEntries(
  ACTION_GROUPS.flatMap((g) => g.actions),
);

const KNOWN_ACTIONS = ACTION_GROUPS.flatMap((g) => g.actions.map(([v]) => v));

// actor_role filter — value sent verbatim as ?actor_role=<value>.
const ACTOR_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "campaign_manager", label: "Campaign Manager" },
  { value: "accounts", label: "Accounts" },
  { value: "sales", label: "Sales" },
  { value: "coordination", label: "Coordination" },
  { value: "client", label: "Client" },
];

const titleCase = (s) =>
  String(s || "")
    .replace(/_/g, " ")
    .replace(/^\w/, (c) => c.toUpperCase());

const actionLabel = (a) => ACTION_LABELS[a] ?? titleCase(a);

const roleLabel = (r) =>
  ACTOR_ROLES.find((x) => x.value === r)?.label ?? titleCase(r);

const CATEGORY_STYLES = {
  campaign: "bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  auth: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  payment: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  lead: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

const fmtAmount = (n, currency) => {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  const amount = num.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  return currency && currency !== "INR" ? `${amount} ${currency}` : `₹${amount}`;
};

// One readable "what changed" line per entry, whatever the category:
// campaign status flips carry from/to, payments carry an amount, logins carry an
// ip, lead pushes carry a count. Falls back to nothing rather than raw JSON.
const changeSummary = (a) => {
  const d = a.details || {};
  if (d.from != null || d.to != null) return `${d.from ?? "?"} → ${d.to ?? "?"}`;
  if (d.amount != null) return fmtAmount(d.amount, d.currency);
  if (d.count != null) return `${d.count} lead${Number(d.count) === 1 ? "" : "s"}`;
  if (d.ip) return `IP ${d.ip}`;
  return null;
};

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

// Rows-per-page: 50 stays the default (this log is skimmed in bulk), but the
// size is user-selectable and remembered across visits.
const DEFAULT_PAGE_SIZE = 50;
const ROWS_PER_PAGE_OPTIONS = [25, 50, 100, 200];

export default function Activity() {
  const [search, setSearch] = createSignal("");
  const [debouncedSearch, setDebouncedSearch] = createSignal("");
  const [resultFilter, setResultFilter] = createSignal("all");
  const [actionFilter, setActionFilter] = createSignal("all");
  const [actorRoleFilter, setActorRoleFilter] = createSignal("all");
  const [targetId, setTargetId] = createSignal("");
  const [debouncedTargetId, setDebouncedTargetId] = createSignal("");
  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(
    Number(localStorage.getItem("activityRowsPerPage")) || DEFAULT_PAGE_SIZE,
  );

  const changePageSize = (size) => {
    setPageSize(size);
    localStorage.setItem("activityRowsPerPage", String(size));
    setPage(1); // the current page number can be past the end at a bigger size
  };

  const [entries, setEntries] = createSignal([]);
  const [seenActions, setSeenActions] = createSignal([]);
  const [pagination, setPagination] = createSignal(null);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal(null);

  // Client list for the target filter. Same source the Clients screens use, so
  // it's already visibility-scoped per role; if it's empty/unavailable the
  // control degrades to a plain client-id box (see the filter bar below).
  const [clients] = createResource(async () => {
    try {
      const res = await fetchHierarchyClients();
      const list = Array.isArray(res?.data) ? res.data : [];
      return list
        .map((c) => ({
          id: c.client_nomen_id,
          name: c.client_name || c.client_nomen_name || `Client #${c.client_nomen_id}`,
        }))
        .filter((c) => c.id != null)
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    } catch {
      return [];
    }
  });
  const hasClientList = () => (clients() ?? []).length > 0;

  // Debounce the search box so we don't fire a request per keystroke.
  createEffect(() => {
    const q = search();
    const t = setTimeout(() => {
      setPage(1);
      setDebouncedSearch(q);
    }, 350);
    onCleanup(() => clearTimeout(t));
  });

  // Same treatment for the typed client-id box (the <select> path sets both
  // signals at once, so picking from the list still costs only one request).
  createEffect(() => {
    const id = targetId();
    const t = setTimeout(() => {
      setPage(1);
      setDebouncedTargetId(id);
    }, 350);
    onCleanup(() => clearTimeout(t));
  });

  // Refetch whenever page or any (debounced) filter changes.
  createEffect(() => {
    const params = {
      page: page(),
      pageSize: pageSize(),
      filters: {
        search: debouncedSearch(),
        action: actionFilter(),
        result: resultFilter(),
        actorRole: actorRoleFilter(),
        targetId: debouncedTargetId(),
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
        // Top the action dropdown up with whatever the feed actually contains,
        // so new server-side actions become filterable without a code change.
        setSeenActions((prev) => {
          const next = new Set(prev);
          entries.forEach((e) => e.action && next.add(e.action));
          return next.size === prev.length ? prev : [...next];
        });
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

  // Picking from the client dropdown shouldn't wait on the typing debounce.
  const pickClient = (id) => {
    setPage(1);
    setTargetId(id);
    setDebouncedTargetId(id);
  };

  // Canonical groups first, then an "Other" group for anything the feed turned up
  // (or a filter value restored from elsewhere) that isn't in ACTION_GROUPS.
  const actionOptions = createMemo(() => {
    const extra = new Set(seenActions());
    if (actionFilter() !== "all") extra.add(actionFilter()); // keep the active one selectable
    KNOWN_ACTIONS.forEach((a) => extra.delete(a));

    const groups = ACTION_GROUPS.map((g) => ({ label: g.label, actions: g.actions }));
    if (extra.size) {
      groups.push({
        label: "Other",
        actions: [...extra]
          .sort((a, b) => actionLabel(a).localeCompare(actionLabel(b)))
          .map((a) => [a, actionLabel(a)]),
      });
    }
    return groups;
  });

  const filtersActive = () =>
    search() !== "" ||
    actionFilter() !== "all" ||
    resultFilter() !== "all" ||
    actorRoleFilter() !== "all" ||
    targetId() !== "";

  const clearFilters = () => {
    setPage(1);
    setSearch("");
    setDebouncedSearch("");
    setActionFilter("all");
    setResultFilter("all");
    setActorRoleFilter("all");
    setTargetId("");
    setDebouncedTargetId("");
  };

  const total = () => pagination()?.total ?? entries().length;
  const hasPrev = () => pagination()?.has_prev ?? page() > 1;
  const hasNext = () => pagination()?.has_next ?? false;

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-3 lg:p-8">

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
        <div class="relative flex w-[300px] max-w-full">
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
          <For each={actionOptions()}>
            {(g) => (
              <optgroup label={g.label}>
                <For each={g.actions}>
                  {([value, label]) => <option value={value}>{label}</option>}
                </For>
              </optgroup>
            )}
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

        {/* Who did it → ?actor_role= */}
        <select
          value={actorRoleFilter()}
          onChange={(e) => onFilterChange(setActorRoleFilter)(e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200
                 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          <option value="all">All roles</option>
          <For each={ACTOR_ROLES}>
            {(r) => <option value={r.value}>{r.label}</option>}
          </For>
        </select>

        {/* Which client it was about → ?target_id=<client_nomen id>. Falls back
            to a typed id when the client list isn't available for this role. */}
        <Show
          when={hasClientList()}
          fallback={
            <input
              type="text"
              inputmode="numeric"
              placeholder={clients.loading ? "Loading clients…" : "Filter by client ID"}
              value={targetId()}
              onInput={(e) => setTargetId(e.target.value)}
              class="w-[180px] px-3 py-2 text-sm rounded-lg border border-gray-200
                     dark:border-gray-700 dark:bg-gray-800 dark:text-white
                     focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
            />
          }
        >
          <select
            value={targetId()}
            onChange={(e) => pickClient(e.target.value)}
            class="max-w-[220px] px-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          >
            <option value="">All clients</option>
            <For each={clients()}>
              {(c) => <option value={String(c.id)}>{c.name}</option>}
            </For>
          </select>
        </Show>

        <Show when={filtersActive()}>
          <button
            onClick={clearFilters}
            class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700
                   text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700
                   whitespace-nowrap"
          >
            Clear filters
          </button>
        </Show>

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
                          <span class="text-xs text-gray-400 dark:text-gray-500">
                            {roleLabel(a.actorRole)}
                          </span>
                        </Show>
                      </div>
                    </td>
                    <td class="p-3 text-gray-700 dark:text-gray-300 whitespace-nowrap font-medium">
                      <div class="flex flex-col items-start gap-1">
                        <span>{actionLabel(a.action)}</span>
                        <Show when={a.category && a.category !== "general"}>
                          <span class={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide
                                        ${CATEGORY_STYLES[a.category] ?? "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"}`}>
                            {a.category}
                          </span>
                        </Show>
                      </div>
                    </td>
                    <td class="p-3 max-w-[320px]">
                      <div class="flex flex-col">
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
                        {/* Non-campaign targets are clients, so the id doubles as
                            a one-click "show everything about this client". */}
                        <Show when={a.category !== "campaign" && a.targetId != null}>
                          <button
                            onClick={() => pickClient(String(a.targetId))}
                            class="self-start text-xs text-gray-400 dark:text-gray-500 hover:text-purple-600
                                   dark:hover:text-purple-300 hover:underline"
                            title="Filter the log to this client"
                          >
                            #{a.targetId}
                          </button>
                        </Show>
                      </div>
                    </td>
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      <Show when={changeSummary(a)} fallback={"—"}>
                        {changeSummary(a)}
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
      <div class="mt-4 flex items-center justify-between gap-3 text-sm flex-wrap">
        <div class="flex items-center gap-3">
          <span class="text-gray-500 dark:text-gray-400">
            <Show when={pagination()} fallback={`${entries().length} shown`}>
              Page {pagination().page} of {pagination().total_pages || 1} ·{" "}
              {total()} total
            </Show>
          </span>
          <RowsPerPageSelect
            value={pageSize()}
            options={ROWS_PER_PAGE_OPTIONS}
            onChange={changePageSize}
          />
        </div>
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
