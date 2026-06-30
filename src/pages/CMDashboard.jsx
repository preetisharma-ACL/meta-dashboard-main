import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import Swal from "sweetalert2";
import { DateRangeFilter } from "../components/DateRangeFilter";
import Avatar from "../components/common/Avatar";
import { fetchAllCampaignsScoped, fetchHierarchyClients } from "../services/cm";
import { asTeamMemberId, ownScope, clearScope } from "../stores/cmScope";
import { currentUser, cmTier } from "../stores/currentUser";
import CMHierarchy from "../components/CMHierarchy";

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

// Display threshold for the "Needs attention" CPL rule (presentation only).
const HOT_CPL_RATIO = 1.4; // CPL > 140% of scoped average -> "running hot"

// ── Quick-pick helpers (pure, copied from MainDashboard) ─────────────────────
// Return { from, to } as Date objects for a preset value.
const getDateRangeForValue = (value) => {
  const today = new Date();
  let from,
    to = new Date();

  switch (value) {
    case "today":
      from = new Date();
      break;
    case "yesterday":
      from = new Date();
      from.setDate(today.getDate() - 1);
      to = new Date(from);
      break;
    case "last7":
      // Exclude today: to = yesterday, from = 7 days before today
      to = new Date();
      to.setDate(today.getDate() - 1);
      from = new Date();
      from.setDate(today.getDate() - 7);
      break;
    case "thisMonth":
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case "lastMonth":
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      to = new Date(today.getFullYear(), today.getMonth(), 0);
      break;
    default:
      from = new Date();
  }
  return { from, to };
};

// Format a Date as "YYYY-MM-DD" for the fromDate/toDate signals.
const formatDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// ── Status + performance palette (house navy/crimson) ────────────────────────
const STATUS_COLORS = {
  active: "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300",
  paused: "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300",
  completed: "bg-[#F1F4F9] text-[#54657E] dark:bg-gray-700 dark:text-gray-300",
};
const STATUS_DOT = {
  active: "bg-[#15966A]",
  paused: "bg-[#B07A14]",
  completed: "bg-[#8593A8]",
};
const PERF_COLORS = {
  good: "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300",
  warning: "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300",
  bad: "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300",
  danger: "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300",
};

export default function CMDashboard() {
  const [fromDate, setFromDate] = createSignal("");
  const [toDate, setToDate] = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("all");
  const [search, setSearch] = createSignal("");
  const [view, setView] = createSignal("list"); // "list" | "hierarchy"
  // UI-only highlight for the quick-pick pills. Does not drive any fetch; the
  // pills set fromDate/toDate (which the resource already reacts to) and this
  // just remembers which pill is lit.
  const [activePreset, setActivePreset] = createSignal(null);

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

  // "Just me" narrowing for the flat campaigns list.
  // /api/campaigns/ is NOT scope=own-aware on the backend yet, so in "Just me"
  // mode it returns the full team set. We narrow it client-side to the lead's
  // OWN clients — the id set comes from the hierarchy clients endpoint, which IS
  // scope=own-aware. Safe: a Tier 1 is already authorized to see everything;
  // this is a focus filter, not an authorization gate. Member/team modes are
  // untouched (member uses as_team_member_id server-side; team is the full set).
  const [ownClients] = createResource(
    () =>
      ownScope()
        ? { startDate: fromDate() || undefined, endDate: toDate() || undefined }
        : null,
    async (args) => {
      try {
        const res = await fetchHierarchyClients(args);
        const list = res?.data ?? [];
        return {
          ids: new Set(list.map((c) => String(c.client_nomen_id))),
          names: new Set(
            list.map((c) => (c.client_name ?? "").trim().toLowerCase()),
          ),
        };
      } catch (err) {
        console.error("[CMDashboard] own-client set failed:", err);
        return { ids: new Set(), names: new Set() };
      }
    },
  );

  // Client-side filters: "Just me" narrowing + search. Both are display filters
  // (the lead is authorized to see all); they never widen visibility.
  const campaigns = createMemo(() => {
    let rows = allCampaigns();

    if (ownScope()) {
      const own = ownClients();
      if (!own) return []; // own-client set still loading — don't flash team rows
      rows = rows.filter(
        (c) =>
          own.ids.has(String(c.client_nomen)) ||
          own.names.has((c.client_nomen_name ?? "").trim().toLowerCase()),
      );
    }

    const q = search().trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (c) =>
          c.name?.toLowerCase().includes(q) ||
          c.project_name?.toLowerCase().includes(q) ||
          c.client_nomen_name?.toLowerCase().includes(q),
      );
    }
    return rows;
  });

  // ─── Scoped summary (aggregated from the rows the server returned) ──────────
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

  const tierLabel = () => (cmTier() === "tier_1" ? "Team Lead" : cmTier() === "tier_2" ? "Individual" : "");

  // ════════════════════════════════════════════════════════════════════════
  // DISPLAY-ONLY DERIVATIONS for the redesigned sections.
  // Everything below reads from campaigns() / summary() only. No fetches, no
  // cache writes, no changes to any existing calculation or API field.
  // ════════════════════════════════════════════════════════════════════════

  // True only on the very first load (no rows yet). Lets date-change refetches
  // keep the previous rows on screen instead of flashing skeletons.
  const firstLoad = () =>
    (data.loading && allCampaigns().length === 0) ||
    // In "Just me", keep skeletons up until the own-client set has resolved, so
    // we never flash the full team list before narrowing.
    (ownScope() && !ownClients());

  // Budget + status counts across the scoped rows (display only).
  const ledgerStats = createMemo(() => {
    const rows = campaigns();
    let budget = 0;
    let paused = 0;
    let completed = 0;
    for (const c of rows) {
      budget += parseFloat(c.budget) || 0;
      if (c.status === "paused") paused += 1;
      else if (c.status === "completed") completed += 1;
    }
    const spend = summary().spend;
    return {
      budget,
      paused,
      completed,
      utilPct: budget > 0 ? Math.min((spend / budget) * 100, 100) : 0,
    };
  });

  // Best / worst CPL among campaigns that actually generated leads.
  const cplExtremes = createMemo(() => {
    const rows = campaigns().filter(
      (c) => Number(c.leads_count) > 0 && isFinite(parseFloat(c.cpl)),
    );
    if (rows.length === 0) return { best: null, worst: null };
    let best = rows[0];
    let worst = rows[0];
    for (const c of rows) {
      if (parseFloat(c.cpl) < parseFloat(best.cpl)) best = c;
      if (parseFloat(c.cpl) > parseFloat(worst.cpl)) worst = c;
    }
    return { best, worst };
  });

  // CPL-by-campaign chart data: top 8 campaigns by spend (keeps the chart
  // readable; the rest stay in the ledger table).
  const cplChart = createMemo(() => {
    const avg = summary().cpl;
    const rows = [...campaigns()]
      .sort((a, b) => (parseFloat(b.spend) || 0) - (parseFloat(a.spend) || 0))
      .slice(0, 8);
    const maxCpl =
      Math.max(avg, ...rows.map((c) => parseFloat(c.cpl) || 0)) * 1.15 || 1;
    return {
      avg,
      avgPos: avg > 0 ? (avg / maxCpl) * 100 : 0,
      extra: Math.max(campaigns().length - rows.length, 0),
      rows: rows.map((c) => {
        const cpl = parseFloat(c.cpl) || 0;
        const hasLeads = Number(c.leads_count) > 0;
        const ratio = avg > 0 && hasLeads ? cpl / avg : 1;
        return {
          id: c.id,
          name: c.name,
          cplLabel: fmtCPL(c.cpl),
          hasLeads,
          width: hasLeads ? (cpl / maxCpl) * 100 : 2,
          tone: !hasLeads
            ? "none"
            : ratio < 0.85
              ? "green"
              : ratio <= 1.25
                ? "steel"
                : "red",
          deltaPct: avg > 0 && hasLeads ? Math.round((ratio - 1) * 100) : null,
        };
      }),
    };
  });

  // Lead-share band grouped by project (top 4 + "Others").
  const leadShare = createMemo(() => {
    const byProject = new Map();
    for (const c of campaigns()) {
      const key = c.project_name || "Unassigned";
      byProject.set(
        key,
        (byProject.get(key) || 0) + (Number(c.leads_count) || 0),
      );
    }
    const sorted = [...byProject.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
    const totalLeads = sorted.reduce((s, r) => s + r.count, 0);
    const top = sorted.slice(0, 4);
    const others = sorted.slice(4).reduce((s, r) => s + r.count, 0);
    const palette = ["#3E6FB0", "#7FA1CD", "#15966A", "#AC2334", "#D4DDE9"];
    const items = top.map((r, i) => ({
      name: r.name,
      count: r.count,
      pct: totalLeads > 0 ? (r.count / totalLeads) * 100 : 0,
      color: palette[i],
    }));
    if (others > 0)
      items.push({
        name: "Others",
        count: others,
        pct: totalLeads > 0 ? (others / totalLeads) * 100 : 0,
        color: palette[4],
      });
    return { totalLeads, items };
  });

  // "Needs attention" signal cards (max 3), built by display rules:
  //   paused campaign with idle budget -> amber
  //   CPL far above the scoped average -> red
  //   live campaign with zero spend in range -> red
  const signals = createMemo(() => {
    const out = [];
    const avg = summary().cpl;
    const rows = campaigns();

    const paused = rows
      .filter((c) => c.status === "paused")
      .map((c) => ({
        c,
        idle: Math.max(
          (parseFloat(c.budget) || 0) - (parseFloat(c.spend) || 0),
          0,
        ),
      }))
      .sort((a, b) => b.idle - a.idle);
    for (const { c, idle } of paused) {
      out.push({
        tone: "amber",
        tag: "Paused",
        title: `${c.name} is paused`,
        body: (
          <>
            {c.project_name ? <>{c.project_name} · </> : null}This campaign is
            paused.
            {parseFloat(c.budget) > 0 && (
              <>
                {" "}
                <b>{fmtMoney(idle)}</b> of its {fmtMoney(c.budget)} budget is
                sitting idle.
              </>
            )}
          </>
        ),
      });
    }

    const hot = rows
      .filter(
        (c) =>
          Number(c.leads_count) > 0 &&
          avg > 0 &&
          (parseFloat(c.cpl) || 0) > avg * HOT_CPL_RATIO,
      )
      .sort((a, b) => (parseFloat(b.cpl) || 0) - (parseFloat(a.cpl) || 0));
    for (const c of hot) {
      out.push({
        tone: "red",
        tag: "CPL running hot",
        title: `${c.name} is paying ${Math.round(((parseFloat(c.cpl) || 0) / avg - 1) * 100)}% over`,
        body: (
          <>
            Buying leads at <b>{fmtCPL(c.cpl)}</b> against a scoped average of{" "}
            {fmtCPL(avg)}. A creative and audience review could recover real
            money here.
          </>
        ),
      });
    }

    const zero = rows.filter(
      (c) => c.status === "active" && (parseFloat(c.spend) || 0) === 0,
    );
    for (const c of zero) {
      out.push({
        tone: "red",
        tag: "Zero delivery",
        title: `${c.name} is not spending`,
        body: (
          <>
            This campaign is live but <b>₹0 spend and 0 leads</b> are recorded
            in this range. Check ad review status, ad set delivery and the
            account spend limit.
          </>
        ),
      });
    }

    return out.slice(0, 3);
  });

  // Account brief: "What went well" + issues log, both rule-based from the
  // live scoped data shown on this page.
  const briefHighlights = createMemo(() => {
    const out = [];
    const { best, worst } = cplExtremes();
    const avg = summary().cpl;
    if (best && avg > 0) {
      const pct = Math.round((1 - (parseFloat(best.cpl) || 0) / avg) * 100);
      if (pct > 0)
        out.push({
          tone: "green",
          body: (
            <>
              <b>{best.name} is the best value in range.</b> CPL of{" "}
              {fmtCPL(best.cpl)} is {pct}% under the scoped average
              {best.project_name ? <> on {best.project_name}</> : null}.
            </>
          ),
        });
    }
    const volume = [...campaigns()].sort(
      (a, b) => (Number(b.leads_count) || 0) - (Number(a.leads_count) || 0),
    )[0];
    if (volume && Number(volume.leads_count) > 0) {
      const share =
        summary().leads > 0
          ? Math.round((Number(volume.leads_count) / summary().leads) * 100)
          : 0;
      out.push({
        tone: "green",
        body: (
          <>
            <b>
              {volume.name} leads on volume with {fmtNum(volume.leads_count)}{" "}
              leads
            </b>{" "}
            in this range, {share}% of everything in view.
          </>
        ),
      });
    }
    if (worst && avg > 0 && (parseFloat(worst.cpl) || 0) > avg * 1.25) {
      out.push({
        tone: "amber",
        body: (
          <>
            <b>{worst.name} needs a creative refresh.</b> CPL of{" "}
            {fmtCPL(worst.cpl)} is the costliest buying in view right now.
          </>
        ),
      });
    }
    return out;
  });

  const briefIssues = createMemo(() =>
    signals().map((sig) => ({
      state: sig.tag === "Paused" ? "prog" : "new",
      stateLabel: sig.tag === "Paused" ? "In progress" : "New",
      title: sig.title,
      body: sig.body,
    })),
  );

  // ── Reusable section eyebrow (house design language) ─────────────────────
  const Eyebrow = (props) => (
    <div class="flex items-center gap-3 mb-4 text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334]">
      <span>
        {props.label}
        <Show when={props.soft}>
          <span class="text-[#8593A8] dark:text-gray-400 font-bold normal-case tracking-normal">
            {" "}
            · {props.soft}
          </span>
        </Show>
      </span>
      <span class="flex-1 h-px bg-[#D4DDE9] dark:bg-gray-700"></span>
    </div>
  );

  // ── Loading skeleton for the campaign table (9 columns) ──────────────────
  const TableSkeleton = () => (
    <tbody>
      <For each={Array(8).fill(0)}>
        {() => (
          <tr class="border-t border-[#E2E8F1] dark:border-gray-700 animate-pulse">
            <td class="p-3">
              <div class="h-7 w-7 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto"></div>
            </td>
            <td class="p-3">
              <div class="flex items-center gap-3">
                <div class="h-8 w-8 bg-gray-200 dark:bg-gray-700 rounded-full"></div>
                <div class="h-4 w-44 bg-gray-200 dark:bg-gray-700 rounded"></div>
              </div>
            </td>
            <td class="p-3">
              <div class="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded"></div>
            </td>
            <td class="p-3">
              <div class="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto"></div>
            </td>
            <td class="p-3">
              <div class="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded ml-auto"></div>
            </td>
            <td class="p-3">
              <div class="h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded ml-auto"></div>
            </td>
            <td class="p-3">
              <div class="h-4 w-12 bg-gray-200 dark:bg-gray-700 rounded ml-auto"></div>
            </td>
            <td class="p-3">
              <div class="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded ml-auto"></div>
            </td>
            <td class="p-3">
              <div class="h-6 w-20 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto"></div>
            </td>
          </tr>
        )}
      </For>
    </tbody>
  );

  return (
    <section class="w-full px-4  py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Campaign manager · Live view
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Campaign Manager Dashboard
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400 flex items-center gap-2 flex-wrap">
            {currentUser.email}
            <Show when={tierLabel()}>
              <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#ECF2FA] text-[#3E6FB0] dark:bg-blue-900/40 dark:text-blue-300">
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

      {/* ════════ QUICK-PICK DATE PILLS ════════ */}
      <div class="flex flex-wrap gap-2 mb-6">
        <For
          each={[
            { label: "Today", value: "today" },
            { label: "Yesterday", value: "yesterday" },
            { label: "Last 7 Days", value: "last7" },
            { label: "This Month", value: "thisMonth" },
            { label: "Last Month", value: "lastMonth" },
          ]}
        >
          {(item) => (
            <button
              onClick={() => {
                setActivePreset(item.value);
                const { from, to } = getDateRangeForValue(item.value);
                setFromDate(formatDate(from));
                setToDate(formatDate(to));
              }}
              class={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 border ${
                activePreset() === item.value
                  ? "bg-[#AC2334] text-white border-[#AC2334] shadow-md"
                  : "bg-gray-50 text-[#54657E] border-[#E2E8F1] hover:border-[#AC2334]/40 hover:text-[#AC2334] dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600 dark:hover:bg-gray-700 dark:hover:text-white"
              }`}
            >
              {item.label}
            </button>
          )}
        </For>

        <button
          onClick={() => {
            setActivePreset(null);
            setFromDate("");
            setToDate("");
          }}
          class="px-4 py-2 rounded-full text-sm font-bold border border-[#AC2334]/25 text-[#AC2334] bg-[#FBEEF0] hover:bg-[#AC2334] hover:text-white transition dark:bg-red-900/30 dark:text-red-300 dark:border-red-700 dark:hover:bg-red-900/50"
        >
          Clear
        </button>
      </div>

      {/* ════════ HERO LEDGER ════════
          Replaces the four KPI cards; every old metric is mapped here:
            Spend  -> hero figure
            Budget -> "of ₹X budgeted" + utilisation rail
            Leads / Avg CPL / Campaigns -> side stats
            Active count -> eyebrow                                          */}
      <Eyebrow
        label="The ledger"
        soft={`${summary().active} of ${summary().total} campaigns live`}
      />
      <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-8 mb-8 grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-8 lg:gap-12 items-start">
        {/* Spend + budget rail */}
        <div>
          <p class="text-sm text-[#54657E] dark:text-gray-400 font-medium mb-1">
            Total spend in range
          </p>
          <h2 class="text-xl sm:text-2xl font-bold tracking-tight text-gray-700 dark:text-white">
            <Show
              when={!firstLoad()}
              fallback={
                <span class="inline-block h-8 w-44 bg-gray-200 dark:bg-gray-700 rounded animate-pulse align-middle" />
              }
            >
              {fmtMoney(summary().spend)}
            </Show>
          </h2>

          <Show when={ledgerStats().budget > 0}>
            <p class="text-sm text-[#54657E] dark:text-gray-400 mt-2">
              of{" "}
              <b class="text-[#14233A] dark:text-white">
                {fmtMoney(ledgerStats().budget)}
              </b>{" "}
              budgeted · {ledgerStats().utilPct.toFixed(1)}% utilised
            </p>

            <div class="mt-6">
              <div class="relative h-4 rounded-full bg-[#EAEFF6] dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700">
                <div
                  class="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#AC2334] to-[#C9374B] transition-all duration-700"
                  style={`width:${ledgerStats().utilPct}%`}
                ></div>
              </div>
              <div class="flex justify-between mt-2 text-xs font-medium text-[#8593A8] dark:text-gray-500">
                <span>₹0</span>
                <span>{fmtMoney(ledgerStats().budget)}</span>
              </div>
            </div>
          </Show>
        </div>

        {/* Side stats */}
        <div class="flex flex-col border-t lg:border-t-0 lg:border-l border-[#E2E8F1] dark:border-gray-700 pt-4 lg:pt-0 lg:pl-9">
          <div class="py-3.5 border-b border-[#E2E8F1] dark:border-gray-700">
            <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
              Leads generated
            </p>
            <p class="text-xl font-bold text-[#14233A] dark:text-white mt-1">
              <Show
                when={!firstLoad()}
                fallback={
                  <span class="inline-block h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse align-middle" />
                }
              >
                {fmtNum(summary().leads)}
              </Show>
            </p>
          </div>

          <div class="py-3.5 border-b border-[#E2E8F1] dark:border-gray-700">
            <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
              Average CPL
            </p>
            <p class="text-xl font-bold text-gray-700 dark:text-white mt-1">
              {summary().leads > 0 ? fmtCPL(summary().cpl) : "—"}
            </p>
            <Show when={cplExtremes().best && cplExtremes().worst}>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
                best {fmtCPL(cplExtremes().best.cpl)} · worst{" "}
                {fmtCPL(cplExtremes().worst.cpl)}
              </p>
            </Show>
          </div>

          <div class="py-3.5">
            <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
              Campaigns
            </p>
            <p class="text-xl font-bold mt-1">
              <span class="text-[#15966A]">{summary().active}</span>{" "}
              <span class="text-sm font-bold text-[#8593A8]">live</span>
              {" · "}
              <span class="text-[#B07A14]">{ledgerStats().paused}</span>{" "}
              <span class="text-sm font-bold text-[#8593A8]">paused</span>
            </p>
            <p class="text-xs text-[#54657E] dark:text-gray-400 mt-0.5">
              {summary().total} total in view
            </p>
          </div>
        </div>
      </div>

      {/* ════════ VIEW TABS ════════ */}
      <div class="inline-flex gap-1 p-1 bg-[#EEF2F7] dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 mb-6">
        <For
          each={[
            { k: "list", label: "Campaigns" },
            { k: "hierarchy", label: "Client → Project → Campaign" },
          ]}
        >
          {(t) => (
            <button
              onClick={() => setView(t.k)}
              class={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                view() === t.k
                  ? "bg-white dark:bg-gray-700 text-[#14233A] dark:text-gray-100 shadow-sm"
                  : "text-[#54657E] dark:text-gray-400 hover:text-[#AC2334] dark:hover:text-gray-200"
              }`}
            >
              {t.label}
            </button>
          )}
        </For>
      </div>

      {/* ── Hierarchy drill-down view (raw vs client-facing + coverage) ── */}
      <Show when={view() === "hierarchy"}>
        <CMHierarchy
          startDate={fromDate() || undefined}
          endDate={toDate() || undefined}
        />
      </Show>

      {/* ── Flat campaigns list view ── */}
      <Show when={view() === "list"}>
        {/* ════════ CAMPAIGN LEDGER ════════ */}
        <Eyebrow label="Campaign ledger" soft="full reference" />

        {/* Filters */}
        <div class="flex flex-wrap items-center gap-3 mb-4">
          <div class="relative flex-1 min-w-[220px]">
            <svg
              class="w-4 h-4 text-[#8593A8] absolute left-3 top-1/2 -translate-y-1/2"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Search by campaign, project or client…"
              value={search()}
              onInput={(e) => setSearch(e.target.value)}
              class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-600 bg-gray-50 dark:bg-gray-800 text-[#1A2B45] dark:text-gray-200 placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
            />
          </div>

          <div class="relative inline-block">
            <select
              value={statusFilter()}
              onChange={(e) => setStatusFilter(e.target.value)}
              class="border border-[#E2E8F1] dark:border-gray-600 px-3 py-2 pr-10 rounded-lg bg-gray-50 dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 appearance-none focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] cursor-pointer"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
              <option value="completed">Completed</option>
            </select>
            <div class="pointer-events-none absolute inset-y-0 right-3 flex items-center">
              <svg
                class="w-4 h-4 text-[#8593A8]"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>

          <span class="ml-auto text-sm font-medium text-[#8593A8] dark:text-gray-500 whitespace-nowrap">
            {campaigns().length} campaign{campaigns().length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Error */}
        <Show when={data.error}>
          <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">
            Failed to load campaigns. Please try again.
          </div>
        </Show>

        {/* Campaigns table */}
        <div class="overflow-auto max-h-[70vh] bg-gray-50 dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
          <table class="w-full text-sm table-auto">
            <thead class="bg-[#F8FAFC] dark:bg-gray-800">
              <tr class="text-[#54657E] dark:text-gray-300 border-b border-[#D4DDE9] dark:border-gray-700 [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:font-bold [&_th]:whitespace-nowrap [&_th]:sticky [&_th]:top-0 [&_th]:bg-[#F8FAFC] dark:[&_th]:bg-gray-800">
                <th class="p-3 w-12 text-center md:sticky md:left-0 md:z-30 bg-[#F8FAFC] dark:bg-gray-800">
                  S.No
                </th>
                <th class="p-3 text-left md:sticky md:left-[57px] md:z-30 bg-[#F8FAFC] dark:bg-gray-800 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.10)] min-w-[220px]">
                  Campaign
                </th>
                <th class="p-3 text-left">Project</th>
                <th class="p-3 text-center">Status</th>
                <th class="p-3 text-right">Spend</th>
                <th class="p-3 text-right">Budget</th>
                <th class="p-3 text-right">Leads</th>
                <th class="p-3 text-right">CPL</th>
                <th class="p-3 text-center">Performance</th>
              </tr>
            </thead>

            <Show when={!firstLoad()} fallback={<TableSkeleton />}>
              <tbody>
                <For each={campaigns()}>
                  {(c, i) => (
                    <tr
                      class={
                        "border-t border-[#E2E8F1] dark:border-gray-700 transition-colors group " +
                        (i() % 2 === 0
                          ? "bg-gray-50 dark:bg-gray-800"
                          : "bg-[#FAFBFD] dark:bg-gray-800")
                      }
                    >
                      {/* S.No */}
                      <td
                        class={
                          "px-1 py-2 w-12 text-center md:sticky md:left-0 md:z-10 " +
                          (i() % 2 === 0
                            ? "bg-gray-50 dark:bg-gray-800"
                            : "bg-[#FAFBFD] dark:bg-gray-800")
                        }
                      >
                        <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FBEEF0] dark:bg-red-900/30 text-[#AC2334] dark:text-red-300 text-xs font-bold">
                          {i() + 1}
                        </span>
                      </td>

                      {/* Campaign */}
                      <td
                        class={
                          "px-3 py-2 max-w-[280px] md:sticky md:left-[57px] md:z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)] " +
                          (i() % 2 === 0
                            ? "bg-gray-50 dark:bg-gray-800"
                            : "bg-[#FAFBFD] dark:bg-gray-800")
                        }
                      >
                        <A
                          href={`/campaign/${c.id}`}
                          class="flex items-center gap-3"
                        >
                          <span class="flex-shrink-0">
                            <Avatar name={c.name} />
                          </span>
                          <span
                            class="text-blue-900 dark:text-gray-100 font-semibold line-clamp-2 hover:text-[#AC2334] dark:hover:text-red-300 transition"
                            title={c.name}
                          >
                            {c.name}
                          </span>
                        </A>
                      </td>

                      {/* Project */}
                      <td class="px-4 py-3 text-left text-[#54657E] dark:text-gray-300 whitespace-nowrap">
                        {c.project_name ?? "—"}
                      </td>

                      {/* Status */}
                      <td class="px-4 py-3 text-center">
                        <span
                          class={
                            "inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wide rounded-full " +
                            (STATUS_COLORS[c.status] ?? STATUS_COLORS.completed)
                          }
                        >
                          <span
                            class={
                              "w-1.5 h-1.5 rounded-full " +
                              (STATUS_DOT[c.status] ?? STATUS_DOT.completed)
                            }
                          ></span>
                          {c.status_label ?? c.status}
                        </span>
                      </td>

                      {/* Spend */}
                      <td class="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-100 whitespace-nowrap">
                        {fmtMoney(c.spend)}
                      </td>

                      {/* Budget */}
                      <td class="px-4 py-3 text-right text-[#54657E] dark:text-gray-400 whitespace-nowrap">
                        {c.budget ? fmtMoney(c.budget) : "—"}
                      </td>

                      {/* Leads */}
                      <td class="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-100 whitespace-nowrap">
                        {fmtNum(c.leads_count)}
                      </td>

                      {/* CPL */}
                      <td class="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-100 whitespace-nowrap">
                        {fmtCPL(c.cpl)}
                      </td>

                      {/* Performance */}
                      <td class="px-4 py-3 text-center whitespace-nowrap">
                        <Show
                          when={c.performance_label}
                          fallback={<span class="text-[#8593A8]">—</span>}
                        >
                          <span
                            class={
                              "inline-flex px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide " +
                              (PERF_COLORS[c.performance_tag] ??
                                "bg-[#F1F4F9] text-[#54657E] dark:bg-gray-700 dark:text-gray-300")
                            }
                          >
                            {c.performance_label}
                          </span>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>

                <Show when={campaigns().length === 0}>
                  <tr>
                    <td
                      colspan="9"
                      class="py-16 text-center text-[#8593A8] dark:text-gray-500"
                    >
                      No campaigns to show.
                    </td>
                  </tr>
                </Show>
              </tbody>

              <Show when={campaigns().length > 0}>
                <tfoot class="bg-[#F8FAFC] dark:bg-gray-800 font-semibold text-gray-700 dark:text-white border-t-2 border-[#D4DDE9] dark:border-gray-600">
                  <tr>
                    <td class="px-1 py-3 w-12 md:sticky md:left-0 md:z-20 bg-[#F8FAFC] dark:bg-gray-800"></td>
                    <td class="px-3 py-3 text-left text-xs uppercase tracking-wider text-[#54657E] dark:text-gray-300 md:sticky md:left-[57px] md:z-20 bg-[#F8FAFC] dark:bg-gray-800 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.08)]">
                      Total
                    </td>
                    <td></td>
                    <td></td>
                    <td class="px-4 py-3 text-right">
                      {fmtMoney(summary().spend)}
                    </td>
                    <td class="px-4 py-3 text-right">
                      {fmtMoney(ledgerStats().budget)}
                    </td>
                    <td class="px-4 py-3 text-right">
                      {fmtNum(summary().leads)}
                    </td>
                    <td class="px-4 py-3 text-right">
                      {summary().leads > 0 ? fmtCPL(summary().cpl) : "—"}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </Show>
            </Show>
          </table>
        </div>

        {/* ════════ NEEDS ATTENTION (derived from live data) ════════ */}
        <Show when={signals().length > 0}>
          <div class="mt-8">
            <Eyebrow label="Needs attention" />
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-8">
              <For each={signals()}>
                {(sig) => (
                  <div class="relative overflow-hidden bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5">
                    <span
                      class={
                        "absolute left-0 top-0 bottom-0 w-1 " +
                        (sig.tone === "red" ? "bg-[#AC2334]" : "bg-[#D89A2B]")
                      }
                    ></span>
                    <p
                      class={
                        "text-xs font-bold uppercase tracking-wider " +
                        (sig.tone === "red"
                          ? "text-[#AC2334]"
                          : "text-[#B07A14]")
                      }
                    >
                      {sig.tag}
                    </p>
                    <h3 class="text-base font-bold text-[#14233A] dark:text-white mt-1.5 mb-1.5">
                      {sig.title}
                    </h3>
                    <p class="text-sm text-[#54657E] dark:text-gray-400 leading-relaxed [&_b]:text-[#1A2B45] dark:[&_b]:text-gray-100 [&_b]:font-bold">
                      {sig.body}
                    </p>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        {/* ════════ HOW THE PORTFOLIO IS BUYING ════════ */}
        <Show when={campaigns().length > 0}>
          <Eyebrow label="How the portfolio is buying" />
          <div class="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-4 mb-8">
            {/* CPL by campaign */}
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-6">
              <h3 class="text-base font-bold text-[#14233A] dark:text-white">
                Cost per lead, by campaign
              </h3>
              <p class="text-xs text-[#8593A8] dark:text-gray-400 mt-0.5 mb-5">
                Dashed line marks the scoped average of{" "}
                {summary().leads > 0 ? fmtCPL(summary().cpl) : "—"}
                <Show when={cplChart().extra > 0}>
                  {" "}
                  · top 8 by spend, {cplChart().extra} more in the ledger
                </Show>
              </p>
              <div class="relative pt-1.5">
                <Show when={cplChart().avg > 0}>
                  <div
                    class="absolute top-0 bottom-5 border-l-2 border-dashed border-[#B9C5D6] dark:border-gray-600"
                    style={`left:${cplChart().avgPos}%`}
                  ></div>
                  <span
                    class="absolute -top-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8593A8]"
                    style={`left:calc(${cplChart().avgPos}% + 8px)`}
                  >
                    avg
                  </span>
                </Show>
                <For each={cplChart().rows}>
                  {(r) => (
                    <div class="grid grid-cols-[1fr_auto] sm:grid-cols-[120px_1fr_104px] gap-x-3 gap-y-2 items-center py-2.5">
                      <div class="text-sm font-bold text-[#54657E] dark:text-gray-300 text-left sm:text-right truncate sm:row-start-1 sm:col-start-1">
                        {r.name}
                      </div>
                      <div class="col-span-2 sm:col-span-1 h-3 rounded-full bg-[#EDF1F7] dark:bg-gray-800 relative sm:row-start-1 sm:col-start-2">
                        <div
                          class={
                            "absolute inset-y-0 left-0 rounded-full transition-all duration-700 " +
                            (r.tone === "green"
                              ? "bg-[#15966A]"
                              : r.tone === "steel"
                                ? "bg-[#3E6FB0]"
                                : r.tone === "red"
                                  ? "bg-[#AC2334]"
                                  : "bg-[#D8DFE9] dark:bg-gray-700")
                          }
                          style={`width:${r.width}%`}
                        ></div>
                      </div>
                      <div class="row-start-1 col-start-2 sm:col-start-3 text-right">
                        <Show
                          when={r.hasLeads}
                          fallback={
                            <span class="text-sm font-bold text-[#8593A8]">
                              —{" "}
                              <span class="block sm:inline text-[10px] font-medium">
                                no delivery yet
                              </span>
                            </span>
                          }
                        >
                          <span class="text-sm font-bold text-[#14233A] dark:text-white">
                            {r.cplLabel}
                          </span>
                          <span class="block text-[10px] font-medium text-[#8593A8]">
                            {r.deltaPct === 0
                              ? "at avg"
                              : `${Math.abs(r.deltaPct)}% ${r.deltaPct > 0 ? "above" : "below"} avg`}
                          </span>
                        </Show>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>

            {/* Lead share + campaign health */}
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-6">
              <h3 class="text-base font-bold text-[#14233A] dark:text-white">
                Where the {fmtNum(leadShare().totalLeads)} leads came from
              </h3>
              <p class="text-xs text-[#8593A8] dark:text-gray-400 mt-0.5 mb-4">
                Share of leads by project in the selected range
              </p>
              <Show
                when={leadShare().totalLeads > 0}
                fallback={
                  <p class="text-sm text-[#8593A8] dark:text-gray-400 py-4">
                    No leads recorded in this range yet.
                  </p>
                }
              >
                <div class="flex h-4 rounded-full overflow-hidden mb-4">
                  <For each={leadShare().items}>
                    {(item) => (
                      <div
                        style={`width:${item.pct}%;background:${item.color}`}
                      ></div>
                    )}
                  </For>
                </div>
                <For each={leadShare().items}>
                  {(item) => (
                    <div class="flex items-center gap-2.5 py-2 border-b border-[#E2E8F1] dark:border-gray-700 last:border-b-0 text-sm">
                      <span
                        class="w-2.5 h-2.5 rounded flex-none"
                        style={`background:${item.color}`}
                      ></span>
                      <span class="flex-1 text-[#54657E] dark:text-gray-300 font-medium truncate">
                        {item.name}
                      </span>
                      <span class="font-bold text-[#14233A] dark:text-white">
                        {fmtNum(item.count)}
                      </span>
                      <span class="w-12 text-right text-xs font-medium text-[#8593A8]">
                        {item.pct.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </For>
              </Show>

              {/* Campaign health */}
              <div class="mt-5 pt-5 border-t border-[#E2E8F1] dark:border-gray-700">
                <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-2.5">
                  Campaign health
                </p>
                <div class="flex h-3.5 rounded-full overflow-hidden bg-[#EDF1F7] dark:bg-gray-700">
                  <div
                    class="bg-[#15966A]"
                    style={`width:${
                      summary().total > 0
                        ? (summary().active / summary().total) * 100
                        : 0
                    }%`}
                  ></div>
                  <div
                    class="bg-[#D89A2B]"
                    style={`width:${
                      summary().total > 0
                        ? (ledgerStats().paused / summary().total) * 100
                        : 0
                    }%`}
                  ></div>
                </div>
                <div class="flex justify-between mt-2 text-xs font-medium text-[#54657E] dark:text-gray-400">
                  <span>
                    <b class="text-[#14233A] dark:text-white">
                      {summary().active}
                    </b>{" "}
                    live
                  </span>
                  <span>
                    <b class="text-[#14233A] dark:text-white">
                      {ledgerStats().paused}
                    </b>{" "}
                    paused
                  </span>
                  <Show when={ledgerStats().completed > 0}>
                    <span>
                      <b class="text-[#14233A] dark:text-white">
                        {ledgerStats().completed}
                      </b>{" "}
                      completed
                    </span>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* ════════ ACCOUNT BRIEF (rule-based, derived from live data) ════════ */}
        <Show when={briefHighlights().length > 0}>
          <Eyebrow label="Account brief" soft="preview" />
          <div class="rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] bg-gradient-to-b from-[#192A45] to-[#101D31] border border-[#0D1828] p-5 sm:p-7 mb-8 text-[#C9D5E7]">
            <div class="flex items-center gap-3 flex-wrap">
              <h3 class="text-lg font-bold text-white">Daily brief</h3>
              <span class="text-[10px] font-bold uppercase tracking-wider rounded-full px-3 py-1 border border-white/20 text-[#AEBDD3]">
                Preview · rule-based
              </span>
            </div>
            <div class="grid grid-cols-1 lg:grid-cols-[1.15fr_1fr] gap-7 mt-5">
              <div>
                <p class="text-[11px] font-bold uppercase tracking-wider text-[#7E90AC] mb-2">
                  What went well
                </p>
                <For each={briefHighlights()}>
                  {(line) => (
                    <div class="flex gap-3 py-2.5 border-t border-white/10 text-sm leading-relaxed [&_b]:text-white [&_b]:font-bold">
                      <span
                        class={
                          "w-2 h-2 rounded-full flex-none mt-1.5 " +
                          (line.tone === "green"
                            ? "bg-[#3DD598]"
                            : "bg-[#E8B45A]")
                        }
                      ></span>
                      <div>{line.body}</div>
                    </div>
                  )}
                </For>
              </div>
              <div>
                <p class="text-[11px] font-bold uppercase tracking-wider text-[#7E90AC] mb-2">
                  Issues log · auto-tracked
                </p>
                <Show
                  when={briefIssues().length > 0}
                  fallback={
                    <div class="py-2.5 border-t border-white/10 text-sm text-[#AEBDD3]">
                      No open issues detected in this range.
                    </div>
                  }
                >
                  <For each={briefIssues()}>
                    {(iss) => (
                      <div class="flex gap-3 items-start py-2.5 border-t border-white/10">
                        <span
                          class={
                            "text-[9px] font-bold uppercase tracking-wide rounded px-2 py-1 flex-none mt-0.5 " +
                            (iss.state === "prog"
                              ? "bg-[#E8B45A] text-[#4A340B]"
                              : "bg-[#AC2334] text-white")
                          }
                        >
                          {iss.stateLabel}
                        </span>
                        <p class="text-sm leading-relaxed [&_b]:text-white [&_b]:font-bold">
                          <b>{iss.title}.</b> {iss.body}
                        </p>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
            <div class="mt-4 pt-3.5 border-t border-white/10 flex justify-between flex-wrap gap-2 text-[11px] font-medium text-[#7E90AC]">
              <span>Highlights derived from this range's data</span>
              <span>Numbers are restricted to the data shown on this page</span>
            </div>
          </div>
        </Show>
      </Show>
    </section>
  );
}