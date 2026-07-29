import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { useNavigate, useSearchParams } from "@solidjs/router";
import Avatar from "../../../components/common/Avatar";
import { fetchSalesManagers, fetchSalesPayments } from "../../../services/sales";
import {
  fmtMoney,
  fmtNum,
  sumMoney,
  remainingTile,
  typeBadge,
  TONE_GREEN,
  TONE_NAVY,
} from "../../../components/sales/salesFormat";
import { CMChips, MoneyTilesRow, PaymentsTable } from "../../../components/sales/salesUI";

const slugify = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-");

const currentMonthStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Friendly name fallback from the email local-part.
const labelFor = (m) =>
  m?.name?.trim() ||
  (m?.email ? m.email.split("@")[0] : "") ||
  "—";

export default function SalesManagers() {
  const navigate = useNavigate();
  // Selection lives in the URL so a Back-navigation from a client dashboard
  // returns to the same manager instead of the bare roster.
  const [searchParams, setSearchParams] = useSearchParams();

  const [managersRes] = createResource(async () => {
    try {
      return await fetchSalesManagers();
    } catch (err) {
      console.error("[SalesManagers] failed to load sales managers", err);
      return [];
    }
  });
  // Server order preserved (count desc); zero-client managers stay listed.
  const managers = () => managersRes() ?? [];

  const selectedId = () => searchParams.manager ?? null;
  const selected = createMemo(() => {
    const id = selectedId();
    if (id == null) return null;
    return managers().find((m) => String(m.user_id) === String(id)) ?? null;
  });

  const openManager = (m) => setSearchParams({ manager: m.user_id });
  const backToRoster = () => setSearchParams({ manager: null });

  const RoleBadge = (props) =>
    props.role === "admin" ? (
      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300">
        Admin
      </span>
    ) : (
      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide bg-[#ECF2FA] text-[#3E6FB0] dark:bg-blue-900/40 dark:text-blue-300">
        Sales
      </span>
    );

  // ── Client navigation from the detail grid ──────────────────────────────────
  // Plain slug navigate ONLY. The admin route resolver
  // (ClientDashboard.ensureClientContextFromRoute) backfills the full context —
  // including the Client PK for as_client_id — from the admin roster. Writing
  // localStorage keys here would fight that (and a nomen/PK mismatch would zero
  // the ledger), so we hand-write nothing.
  const openClient = (client) => navigate(`/${slugify(client.client_nomen_name)}`);

  // ════════ MANAGER-DETAIL MONEY ════════
  const [month, setMonth] = createSignal(currentMonthStr());
  const [refreshing, setRefreshing] = createSignal(false);

  // Fetch the (admin-wide) overview only while a manager is open; keyed on month
  // so switching months refetches. Same feed as SalesPayments — admin tokens get
  // ALL clients, which is exactly what we filter to this manager's client_ids.
  const moneySource = createMemo(() => (selected() ? month() : null));
  const [overview, { refetch }] = createResource(moneySource, async (m, info) => {
    const refresh = info?.refetching === true;
    const res = await fetchSalesPayments(m, refresh);
    return res?.data ?? {};
  });
  const moneyLoading = () => overview.loading;

  // Filter overview.clients[] to this manager's client_ids, preserving server
  // order (debtors first).
  const managerRows = createMemo(() => {
    const m = selected();
    if (!m) return [];
    const ids = new Set((m.client_ids ?? []).map(String));
    return (overview()?.clients ?? []).filter((c) => ids.has(String(c.client_id)));
  });

  // THREE tiles = client-side sums over the FILTERED rows ONLY (row-name keys —
  // never the server totals object).
  const tiles = createMemo(() => {
    const rows = managerRows();
    return [
      { label: "Received", value: fmtMoney(sumMoney(rows, "received_inc_gst"), 0), tone: TONE_GREEN },
      {
        label: "Billed spend (incl. S.C + GST)",
        value: fmtMoney(sumMoney(rows, "utilized_inc_gst"), 0),
        tone: TONE_NAVY,
      },
      remainingTile("Remaining", sumMoney(rows, "closing_balance_inc_gst")),
    ];
  });

  const managerClientTotal = () => {
    const m = selected();
    if (!m) return 0;
    return m.client_ids?.length ?? Number(m.client_count) ?? 0;
  };

  const monthLabel = createMemo(() => {
    const [y, mo] = String(month()).split("-");
    if (!y || !mo) return month();
    return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
  });

  const handleMonthChange = (value) => {
    if (!value) return;
    if (value > currentMonthStr()) value = currentMonthStr();
    setMonth(value);
  };

  const handleRefresh = async () => {
    if (moneyLoading() || refreshing()) return;
    setRefreshing(true);
    try {
      await refetch(true);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <section class="w-full px-4 sm:px-6 lg:px-8 py-6 bg-gray-50 dark:bg-gray-900 min-h-screen">
      {/* ══════════════════ ROSTER VIEW ══════════════════ */}
      <Show when={!selected()}>
        <div class="mb-6">
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Admin · Team
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white mb-1">
            Sales Managers
          </h1>
          <p class="text-md text-[#54657E] dark:text-gray-400">
            {managers().length} on the roster · open one to see their clients and
            this month's payments.
          </p>
        </div>

        <Show
          when={!managersRes.loading}
          fallback={
            <div class="space-y-2">
              <For each={Array(5).fill(0)}>
                {() => (
                  <div class="h-16 bg-gray-100 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl animate-pulse" />
                )}
              </For>
            </div>
          }
        >
          <Show
            when={managers().length > 0}
            fallback={
              <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-10 text-center text-[#8593A8] dark:text-gray-500">
                No sales managers found.
              </div>
            }
          >
            <div class="space-y-3">
              <For each={managers()}>
                {(m) => (
                  <div class="group grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_120px_120px_150px] items-center gap-4 rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-5 py-4 transition-all hover:border-[#AC2334]/30 hover:shadow-[0_8px_24px_-14px_rgba(16,29,49,.4)]">
                    {/* Manager */}
                    <div class="flex items-center gap-3.5 min-w-0">
                      <Avatar name={m.email || m.name} size="w-11 h-11" />
                      <div class="min-w-0">
                        <p class="font-semibold text-gray-900 dark:text-gray-100 truncate">
                          {labelFor(m)}
                        </p>
                        <p class="text-[13px] text-gray-500 dark:text-gray-400 truncate" title={m.email}>
                          {m.email}
                        </p>
                      </div>
                    </div>
                    {/* Clients */}
                    <div class="flex items-center gap-2">
                      <span class="text-xl font-bold text-gray-900 dark:text-white tabular-nums">
                        {fmtNum(m.client_count)}
                      </span>
                      <span class="text-xs text-[#8593A8] dark:text-gray-400">clients</span>
                    </div>
                    {/* Role */}
                    <div>
                      <RoleBadge role={m.role} />
                    </div>
                    {/* Action */}
                    <div class="md:text-right">
                      <button
                        onClick={() => openManager(m)}
                        class="inline-flex items-center gap-1.5 px-4 py-2.5 text-sm rounded-lg bg-[#14233A] text-white font-semibold hover:bg-[#1d3252] transition-colors shadow-sm whitespace-nowrap"
                      >
                        View clients
                        <svg class="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>

      {/* ══════════════════ MANAGER DETAIL ══════════════════ */}
      <Show when={selected()}>
        <button
          onClick={backToRoster}
          class="group inline-flex items-center gap-1.5 mb-4 text-sm font-semibold text-[#54657E] dark:text-gray-400 hover:text-[#14233A] dark:hover:text-white transition-colors"
        >
          <svg class="w-4 h-4 transition-transform group-hover:-translate-x-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All managers
        </button>

        {/* Identity */}
        <div class="flex items-center gap-4 mb-6">
          <Avatar name={selected().email || selected().name} size="w-14 h-14" textSize="text-lg" />
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h1 class="text-xl font-bold text-[#14233A] dark:text-white truncate">
                {labelFor(selected())}
              </h1>
              <RoleBadge role={selected().role} />
            </div>
            <p class="text-sm text-[#54657E] dark:text-gray-400 truncate" title={selected().email}>
              {selected().email} · {fmtNum(selected().client_count)} clients
            </p>
          </div>
        </div>

        {/* Clients grid */}
        <div class="flex items-center gap-3 mb-3 text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334]">
          <span>Onboarded clients</span>
          <span class="flex-1 h-px bg-[#D4DDE9] dark:bg-gray-700"></span>
        </div>
        <Show
          when={(selected().clients ?? []).length > 0}
          fallback={
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl p-8 text-center text-[#8593A8] dark:text-gray-500 mb-8">
              This manager has no onboarded clients.
            </div>
          }
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            <For each={selected().clients}>
              {(client) => (
                <button
                  onClick={() => openClient(client)}
                  class="text-left bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05)] p-5 hover:border-[#AC2334]/40 hover:shadow-md transition-all group"
                >
                  <div class="flex items-start justify-between gap-3">
                    <h3 class="text-base font-bold text-[#14233A] dark:text-white group-hover:text-[#AC2334] dark:group-hover:text-red-300 transition line-clamp-2">
                      {client.client_nomen_name}
                    </h3>
                    <Show when={client.client_type}>
                      <span class={`flex-none inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wide ${typeBadge(client.client_type)}`}>
                        {client.client_type}
                      </span>
                    </Show>
                  </div>
                  <div class="mt-3">
                    <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-500 mb-1.5">
                      Campaign managers
                    </p>
                    <CMChips managers={client.campaign_managers} />
                  </div>
                </button>
              )}
            </For>
          </div>
        </Show>

        {/* Money */}
        <div class="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-3">
          <div class="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334]">
            <span>Payments · {monthLabel()}</span>
          </div>
          <div class="flex items-center gap-3 flex-wrap">
            <input
              type="month"
              value={month()}
              max={currentMonthStr()}
              onInput={(e) => handleMonthChange(e.currentTarget.value)}
              class="border border-[#E2E8F1] dark:border-gray-600 px-3 py-2 rounded-lg bg-white dark:bg-gray-800 text-sm text-[#1A2B45] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
            />
            <button
              onClick={handleRefresh}
              disabled={refreshing()}
              class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#14233A] text-white text-sm font-semibold hover:bg-[#1d3252] disabled:opacity-60 disabled:cursor-default transition-colors"
            >
              <svg class={"w-4 h-4 " + (refreshing() ? "animate-spin" : "")} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h5M20 20v-5h-5M5.5 9a7 7 0 0112.9-2M18.5 15a7 7 0 01-12.9 2" />
              </svg>
              {refreshing() ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <Show when={overview.error}>
          <div class="mb-4 rounded-xl border border-[#AC2334]/25 bg-[#FBEEF0] dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300">
            Could not load payments overview. Please try again.
          </div>
        </Show>

        <div class="mb-2">
          <MoneyTilesRow tiles={tiles} loading={moneyLoading} />
        </div>
        <p class="text-sm text-[#8593A8] dark:text-gray-400 mb-6">
          {fmtNum(managerRows().length)} of {fmtNum(managerClientTotal())} clients
        </p>

        <PaymentsTable
          rows={managerRows}
          loading={moneyLoading}
          storageKey="salesManagerClientsRowsPerPage"
          emptyHint="None of this manager's clients have payments data this month."
        />
      </Show>
    </section>
  );
}
