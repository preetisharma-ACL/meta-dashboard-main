import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import Swal from "sweetalert2";
import { DateRangeFilter } from "../components/DateRangeFilter";
import Avatar from "../components/common/Avatar";
import { fetchAllCampaignsScoped } from "../services/cm";
import { asTeamMemberId, clearScope } from "../stores/cmScope";
import { currentUser, cmTier } from "../stores/currentUser";

// ─── Formatting helpers (match existing dashboards) ───────────────────────────
const fmtMoney = (val) => {
  const n = parseFloat(val);
  if (!isFinite(n)) return "₹0";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
const fmtCPL = (val) => {
  if (val == null || val === "") return "—";
  const n = parseFloat(val);
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtNum = (val) => (Number(val) || 0).toLocaleString("en-IN");
const fmtDate = (iso) =>
  !iso
    ? "—"
    : new Date(iso).toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

const STATUS_COLORS = {
  active: "bg-green-100 text-green-700 ring-1 ring-green-300 dark:bg-green-900/30 dark:text-green-300",
  paused: "bg-amber-100 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-900/30 dark:text-amber-300",
  completed: "bg-gray-100 text-gray-600 ring-1 ring-gray-300 dark:bg-gray-800 dark:text-gray-300",
};
const PERF_COLORS = {
  good: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  bad: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  danger: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
};

export default function CMDashboard() {
  const [fromDate, setFromDate] = createSignal("");
  const [toDate, setToDate] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("all");
  const [search, setSearch] = createSignal("");

  // Resource source — refetch whenever the switch scope, dates, or status
  // change. Search is applied client-side (below) so typing doesn't refetch.
  const source = createMemo(() => ({
    scope: asTeamMemberId(),
    startDate: fromDate() || undefined,
    endDate: toDate() || undefined,
    status: statusFilter(),
  }));

  const [data] = createResource(source, async (s) => {
    try {
      const res = await fetchAllCampaignsScoped({
        startDate: s.startDate,
        endDate: s.endDate,
        status: s.status,
      });
      return res.data || [];
    } catch (err) {
      // Defensive: the switch dropdown only lists valid members, so a 403 here
      // shouldn't happen — but if it does, drop switch mode and notify.
      if (err?.status === 403 && asTeamMemberId() != null) {
        clearScope();
        Swal.fire({
          icon: "warning",
          title: "Can't view that team member",
          text: "Returned to your own view.",
          toast: true,
          position: "top-end",
          timer: 4000,
          showConfirmButton: false,
        });
        return [];
      }
      throw err;
    }
  });

  const allCampaigns = () => data() ?? [];

  // Client-side search over the scoped rows (search is a display filter, not an
  // authorization filter — the server already scoped which rows we can see).
  const campaigns = createMemo(() => {
    const q = search().trim().toLowerCase();
    if (!q) return allCampaigns();
    return allCampaigns().filter(
      (c) =>
        c.name?.toLowerCase().includes(q) ||
        c.project_name?.toLowerCase().includes(q) ||
        c.client_nomen_name?.toLowerCase().includes(q),
    );
  });

  // ─── Scoped summary cards (aggregated from the rows the server returned) ────
  const summary = createMemo(() => {
    const rows = campaigns();
    let spend = 0;
    let leads = 0;
    let active = 0;
    for (const c of rows) {
      spend += parseFloat(c.spend) || 0;
      leads += Number(c.leads_count) || 0;
      if (c.status === "active") active += 1;
    }
    return {
      spend,
      leads,
      cpl: leads > 0 ? spend / leads : 0,
      total: rows.length,
      active,
    };
  });

  const cards = createMemo(() => {
    const s = summary();
    return [
      { label: "Total Spend", value: fmtMoney(s.spend), accent: "text-green-600 dark:text-green-400", bg: "bg-green-50 dark:bg-gray-800 border-green-200 dark:border-gray-700" },
      { label: "Total Leads", value: fmtNum(s.leads), accent: "text-red-600 dark:text-red-400", bg: "bg-red-50 dark:bg-gray-800 border-red-200 dark:border-gray-700" },
      { label: "Avg CPL", value: s.leads > 0 ? fmtCPL(s.cpl) : "—", accent: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-gray-800 border-amber-200 dark:border-gray-700" },
      { label: "Campaigns", value: `${s.active} / ${s.total}`, sub: "active / total", accent: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-gray-800 border-purple-200 dark:border-gray-700" },
    ];
  });

  const tierLabel = () => (cmTier() === "tier_1" ? "Team Lead" : cmTier() === "tier_2" ? "Individual" : "");

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div class="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
            Campaign Manager Dashboard
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {currentUser.email}
            <Show when={tierLabel()}>
              <span class="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                {tierLabel()}
              </span>
            </Show>
          </p>
        </div>
        <DateRangeFilter
          fromDate={fromDate}
          toDate={toDate}
          setFromDate={setFromDate}
          setToDate={setToDate}
        />
      </div>

      {/* Summary cards */}
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <For each={cards()}>
          {(card) => (
            <div class={`px-5 py-6 rounded-xl shadow-sm border ${card.bg}`}>
              <p class="text-sm text-gray-500 dark:text-gray-400">{card.label}</p>
              <Show
                when={!data.loading}
                fallback={<div class="h-7 w-24 mt-2 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />}
              >
                <h3 class={`text-2xl font-semibold mt-2 ${card.accent}`}>{card.value}</h3>
              </Show>
              <Show when={card.sub}>
                <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">{card.sub}</p>
              </Show>
            </div>
          )}
        </For>
      </div>

      {/* Filters */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex-1 min-w-[220px]">
          <svg class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by campaign, project or client…"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </div>
        <select
          value={statusFilter()}
          onChange={(e) => setStatusFilter(e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="completed">Completed</option>
        </select>
        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {campaigns().length} campaign{campaigns().length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Error */}
      <Show when={data.error}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4 text-sm text-red-600 dark:text-red-400">
          Failed to load campaigns. Please try again.
        </div>
      </Show>

      {/* Campaigns table */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider">
              <th class="p-3 text-left whitespace-nowrap min-w-[220px]">Campaign</th>
              <th class="p-3 text-left whitespace-nowrap">Project</th>
              <th class="p-3 text-center whitespace-nowrap">Status</th>
              <th class="p-3 text-right whitespace-nowrap">Spend</th>
              <th class="p-3 text-right whitespace-nowrap">Budget</th>
              <th class="p-3 text-right whitespace-nowrap">Leads</th>
              <th class="p-3 text-right whitespace-nowrap">CPL</th>
              <th class="p-3 text-center whitespace-nowrap">Performance</th>
            </tr>
          </thead>

          <Show
            when={!data.loading}
            fallback={
              <tbody>
                <For each={Array(8).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                      <For each={Array(8).fill(0)}>
                        {(_, idx) => (
                          <td class="p-3">
                            <div class={`h-3 bg-gray-200 dark:bg-gray-700 rounded ${idx() === 0 ? "w-48" : "w-16"}`} />
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={campaigns()}>
                {(c, i) => (
                  <tr class={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-purple-50/40 dark:hover:bg-gray-800/40 ${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/60 dark:bg-gray-800/30"}`}>
                    <td class="p-3 max-w-[260px]">
                      <A href={`/campaign/${c.id}`} class="flex items-center gap-3 group">
                        <span class="flex-shrink-0">
                          <Avatar name={c.name} />
                        </span>
                        <span class="text-purple-700 dark:text-gray-200 font-medium line-clamp-2 group-hover:underline" title={c.name}>
                          {c.name}
                        </span>
                      </A>
                    </td>
                    <td class="p-3 text-gray-600 dark:text-gray-400 whitespace-nowrap">{c.project_name ?? "—"}</td>
                    <td class="p-3 text-center">
                      <span class={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                        <span class={`w-1.5 h-1.5 rounded-full inline-block ${c.status === "active" ? "bg-green-500" : c.status === "paused" ? "bg-amber-500" : "bg-gray-400"}`} />
                        {c.status_label ?? c.status}
                      </span>
                    </td>
                    <td class="p-3 text-right text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">{fmtMoney(c.spend)}</td>
                    <td class="p-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">{c.budget ? fmtMoney(c.budget) : "—"}</td>
                    <td class="p-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">{fmtNum(c.leads_count)}</td>
                    <td class="p-3 text-right text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">{fmtCPL(c.cpl)}</td>
                    <td class="p-3 text-center whitespace-nowrap">
                      <Show when={c.performance_label} fallback={<span class="text-gray-400">—</span>}>
                        <span class={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold ${PERF_COLORS[c.performance_tag] ?? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>
                          {c.performance_label}
                        </span>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>

              <Show when={campaigns().length === 0}>
                <tr>
                  <td colspan="8" class="py-16 text-center text-gray-400 dark:text-gray-500">
                    No campaigns to show.
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>
        </table>
      </div>
    </div>
  );
}
