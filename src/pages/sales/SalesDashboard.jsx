import { createSignal, createResource, createMemo, For, Show, onMount } from "solid-js";
import { useNavigate, A } from "@solidjs/router";
import { DateRangeFilter } from "../../components/DateRangeFilter";
import {
  fetchSalesClients,
  fetchSalesSummary,
  fetchSalesPayments,
} from "../../services/sales";
import { currentUser } from "../../stores/currentUser";
import {
  fmtMoney,
  fmtNum,
  isMissing,
  remainingTile,
} from "../../components/sales/salesFormat";

// Current month as "YYYY-MM" for the payments strip.
const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Money → number | null (never coerce a missing money field to 0 — a missing
// figure must render "—", not a healthy ₹0).
const numOrNull = (v) => {
  if (isMissing(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
// CPL: 2-decimal money; missing → "—".
const fmtCPL = (val) => fmtMoney(val, 2);

// A client route is "/:client-nomen-name" where the slug is the raw nomen name
// lowercased with runs of whitespace collapsed to "-" (see Clients.jsx:413 and
// ClientDashboard's slugify). Reproduce that transform exactly so the card links
// resolve through ensureClientContextFromRoute's sales branch.
const slugify = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-");

// Format a Date as "YYYY-MM-DD" for the from/to signals (local, no UTC shift).
const formatDate = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// { from, to } Date objects for a quick-pick preset.
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

// Client-type badge palette (house tones).
const TYPE_BADGE = {
  cpl: "bg-[#ECF2FA] text-[#3E6FB0] dark:bg-blue-900/40 dark:text-blue-300",
  hybrid: "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300",
  retainer: "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300",
};
const typeBadge = (t) =>
  TYPE_BADGE[String(t || "").toLowerCase()] ??
  "bg-[#F1F4F9] text-[#54657E] dark:bg-gray-700 dark:text-gray-300";

// project_status_summary has no existing consumer, so normalise defensively:
// accept either an object ({ active: 3, paused: 1, … }) or an array
// ([{ status/label, count }, …]) and emit a flat [{ label, count }] for chips.
const STATUS_CHIP = {
  active: "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300",
  paused: "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300",
  completed: "bg-[#F1F4F9] text-[#54657E] dark:bg-gray-700 dark:text-gray-300",
};
const statusChip = (label) =>
  STATUS_CHIP[String(label || "").toLowerCase()] ??
  "bg-[#F1F4F9] text-[#54657E] dark:bg-gray-700 dark:text-gray-300";

const normalizeStatusSummary = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((r) => ({
        label: r?.status ?? r?.label ?? r?.name ?? "",
        count: Number(r?.count ?? r?.value ?? 0) || 0,
      }))
      .filter((r) => r.label);
  }
  if (typeof raw === "object") {
    return Object.entries(raw).map(([label, count]) => ({
      label,
      count: Number(count) || 0,
    }));
  }
  return [];
};

export default function SalesDashboard() {
  const navigate = useNavigate();

  // Month-to-date default (matches the other dashboards' preset).
  const monthToDate = getDateRangeForValue("thisMonth");
  const [fromDate, setFromDate] = createSignal(formatDate(monthToDate.from));
  const [toDate, setToDate] = createSignal(formatDate(monthToDate.to));
  const [activePreset, setActivePreset] = createSignal("thisMonth");

  // Sales "/" is the manager's own merged view — never a drilled-in client.
  // Clear any leftover client context so a stale selection from an earlier
  // card click can't linger. (handleCardClick re-writes them before navigating.)
  onMount(() => {
    localStorage.removeItem("selectedClientNomen");
    localStorage.removeItem("selectedClientNomenId");
    localStorage.removeItem("selectedClientId");
    localStorage.removeItem("selectedClientName");
  });

  // ── Merged summary across the manager's onboarded book ──────────────────────
  const [summaryRes] = createResource(
    () => ({ start: fromDate() || undefined, end: toDate() || undefined }),
    async (s) => {
      const res = await fetchSalesSummary(s.start, s.end);
      return res?.data ?? {};
    },
  );

  const summary = createMemo(() => {
    const d = summaryRes() ?? {};
    const spend = numOrNull(d.total_spend); // money → null when absent, never 0
    const leads = Number(d.total_leads) || 0; // count — 0 is meaningful
    return {
      budget: numOrNull(d.total_budget),
      spend,
      leads,
      // Prefer the server's avg_cpl; else derive from spend/leads. null when
      // neither is available so the tile shows "—", not ₹0.
      cpl: !isMissing(d.avg_cpl)
        ? numOrNull(d.avg_cpl)
        : spend != null && leads > 0
          ? spend / leads
          : null,
      impressions: Number(d.total_impressions) || 0,
      clicks: Number(d.total_clicks) || 0,
      active: Number(d.active_campaigns) || 0,
      statuses: normalizeStatusSummary(d.project_status_summary),
    };
  });

  const summaryLoading = () => summaryRes.loading;
  const utilPct = () => {
    const b = summary().budget;
    const s = summary().spend;
    return b && b > 0 && s != null ? Math.min((s / b) * 100, 100) : 0;
  };

  // ── Roster of onboarded clients ─────────────────────────────────────────────
  const [clientsRes] = createResource(async () => {
    try {
      return await fetchSalesClients();
    } catch (err) {
      console.error("[SalesDashboard] failed to load sales clients", err);
      return [];
    }
  });
  const clients = () => clientsRes() ?? [];

  // ── Compact payments strip (current month) → links to /sales/payments ────────
  // Same feed as SalesPayments; no refresh param here (server cache is fine).
  const [paymentsRes] = createResource(async () => {
    try {
      const res = await fetchSalesPayments(currentMonthStr());
      return res?.data?.totals ?? {};
    } catch (err) {
      console.error("[SalesDashboard] failed to load payments totals", err);
      return {};
    }
  });
  const paymentsTotals = () => paymentsRes() ?? {};
  // TOTALS use closing_inc_gst (no "balance" — the per-client rows use
  // closing_balance_inc_gst). Reading the row-style name here was the live bug:
  // undefined → 0 → a false green "Remaining ₹0". remainingTile keeps "—" for
  // missing and red "Owes ₹X" for negative.
  const remainingTileData = () =>
    remainingTile("Remaining", paymentsTotals().closing_inc_gst);

  const handleCardClick = (client) => {
    const name = client.client_nomen_name;
    // Sales scopes purely by nomen. Write name + nomen id + display name; do NOT
    // write selectedClientId — that Client PK feeds as_client_id ("preview as
    // client"), which is admin-only.
    localStorage.setItem("selectedClientNomen", name);
    localStorage.setItem("selectedClientNomenId", client.client_nomen);
    localStorage.setItem("selectedClientName", name);
    navigate(`/${slugify(name)}`);
  };

  // ── Hero tiles ──────────────────────────────────────────────────────────────
  const TILE_SKELETON = (
    <span class="inline-block h-7 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse align-middle" />
  );
  const tiles = createMemo(() => [
    { label: "Total spend", value: fmtMoney(summary().spend), tone: "text-[#14233A] dark:text-white" },
    { label: "Leads generated", value: fmtNum(summary().leads), tone: "text-[#14233A] dark:text-white" },
    {
      label: "Average CPL",
      value: summary().leads > 0 ? fmtCPL(summary().cpl) : "—",
      tone: "text-[#14233A] dark:text-white",
    },
    { label: "Active campaigns", value: fmtNum(summary().active), tone: "text-[#15966A]" },
  ]);

  return (
    <section class="w-full px-4 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ════════ HEADER ════════ */}
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Sales manager · Live view
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Sales Dashboard
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400">
            {currentUser.email}
          </p>
        </div>
        <DateRangeFilter
          fromDate={fromDate}
          toDate={toDate}
          setFromDate={(v) => {
            setActivePreset(null);
            setFromDate(v);
          }}
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
      </div>

      {/* ════════ HERO TILES ════════ */}
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <For each={tiles()}>
          {(t) => (
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5">
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                {t.label}
              </p>
              <p class={`text-2xl font-bold mt-1.5 ${t.tone}`}>
                <Show when={!summaryLoading()} fallback={TILE_SKELETON}>
                  {t.value}
                </Show>
              </p>
            </div>
          )}
        </For>
      </div>

      {/* ════════ BUDGET RAIL + STATUS CHIPS ════════ */}
      <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-6 mb-8">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
              Spend against budget
            </p>
            <p class="text-sm text-[#54657E] dark:text-gray-400 mt-1">
              <b class="text-[#14233A] dark:text-white">{fmtMoney(summary().spend)}</b>
              {" "}spent
              <Show when={summary().budget > 0}>
                {" "}of{" "}
                <b class="text-[#14233A] dark:text-white">{fmtMoney(summary().budget)}</b>
                {" "}budgeted · {utilPct().toFixed(1)}% utilised
              </Show>
            </p>
          </div>
          <div class="flex gap-6 text-right">
            <div>
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Impressions
              </p>
              <p class="text-lg font-bold text-[#14233A] dark:text-white mt-0.5">
                {fmtNum(summary().impressions)}
              </p>
            </div>
            <div>
              <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Clicks
              </p>
              <p class="text-lg font-bold text-[#14233A] dark:text-white mt-0.5">
                {fmtNum(summary().clicks)}
              </p>
            </div>
          </div>
        </div>

        <Show when={summary().budget > 0}>
          <div class="mt-5">
            <div class="relative h-4 rounded-full bg-[#EAEFF6] dark:bg-gray-900 border border-[#E2E8F1] dark:border-gray-700">
              <div
                class="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-[#AC2334] to-[#C9374B] transition-all duration-700"
                style={`width:${utilPct()}%`}
              ></div>
            </div>
          </div>
        </Show>

        {/* project-status chips */}
        <Show when={summary().statuses.length > 0}>
          <div class="flex flex-wrap items-center gap-2 mt-5 pt-4 border-t border-[#E2E8F1] dark:border-gray-700">
            <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-500 mr-1">
              Projects
            </span>
            <For each={summary().statuses}>
              {(s) => (
                <span
                  class={`inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold uppercase tracking-wide rounded-full ${statusChip(s.label)}`}
                >
                  {s.label}
                  <span class="font-extrabold">{fmtNum(s.count)}</span>
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>

      {/* ════════ THIS MONTH · PAYMENTS (compact, links to /sales/payments) ════════ */}
      <A
        href="/sales/payments"
        class="group flex flex-wrap items-center gap-x-6 gap-y-2 bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 mb-8 hover:border-[#AC2334]/40 transition-all"
      >
        <span class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
          This month
        </span>
        <span class="text-sm text-[#54657E] dark:text-gray-300">
          Received{" "}
          <b class="text-[#15966A] dark:text-green-300">
            {fmtMoney(paymentsTotals().received_inc_gst)}
          </b>
        </span>
        <span class="text-sm text-[#54657E] dark:text-gray-300">
          Billed{" "}
          <b class="text-[#14233A] dark:text-white">
            {fmtMoney(paymentsTotals().utilized_inc_gst)}
          </b>
        </span>
        <span class="text-sm text-[#54657E] dark:text-gray-300">
          Remaining <b class={remainingTileData().tone}>{remainingTileData().value}</b>
        </span>
        <span class="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-[#AC2334] group-hover:gap-2 transition-all">
          Payments
          <svg
            class="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 5l7 7-7 7"
            />
          </svg>
        </span>
      </A>

      {/* ════════ MY CLIENTS ════════ */}
      <div class="flex items-center gap-3 mb-4 text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334]">
        <span>My clients</span>
        <span class="flex-1 h-px bg-[#D4DDE9] dark:bg-gray-700"></span>
        <span class="text-[#8593A8] dark:text-gray-400 font-bold normal-case tracking-normal">
          {clients().length} onboarded
        </span>
      </div>

      <Show
        when={!clientsRes.loading}
        fallback={
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <For each={Array(6).fill(0)}>
              {() => (
                <div class="h-24 bg-gray-100 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl animate-pulse" />
              )}
            </For>
          </div>
        }
      >
        <Show
          when={clients().length > 0}
          fallback={
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-10 text-center text-[#8593A8] dark:text-gray-500">
              No onboarded clients yet.
            </div>
          }
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <For each={clients()}>
              {(client) => (
                <button
                  onClick={() => handleCardClick(client)}
                  class="text-left bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 hover:border-[#AC2334]/40 hover:shadow-md transition-all duration-200 group"
                >
                  <div class="flex items-start justify-between gap-3">
                    <h3 class="text-base font-bold text-[#14233A] dark:text-white group-hover:text-[#AC2334] dark:group-hover:text-red-300 transition line-clamp-2">
                      {client.client_nomen_name}
                    </h3>
                    <Show when={client.client_type}>
                      <span
                        class={`flex-none inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${typeBadge(client.client_type)}`}
                      >
                        {client.client_type}
                      </span>
                    </Show>
                  </div>
                  <p class="text-sm text-[#54657E] dark:text-gray-400 mt-3 flex items-center gap-1.5">
                    Open dashboard
                    <svg
                      class="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </p>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </section>
  );
}
