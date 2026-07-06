import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { fetchMonitorAccounts } from "../../services/monitor";
import Avatar from "../../components/common/Avatar";

// ─────────────────────────────────────────────────────────────────────────────
// Account & Budget Monitor (admin-only). Health screen: which accounts are
// low on funds or under-delivering. Themed to the project (ClientDashboard
// family: navy ink / brand red / slate). API order (by urgency) is preserved.
// CRITICAL: under_delivery=null + has_yesterday_data=false → "No data yet"
// (neutral), NOT a flag. Card accounts carry no balance-urgency.
// ─────────────────────────────────────────────────────────────────────────────

const moneyWhole = (v) => {
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
const money2 = (v) => {
  if (v == null) return null;
  const n = parseFloat(v);
  if (!isFinite(n)) return null;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const num = (v) => (Number(v) || 0).toLocaleString("en-IN");
const relTime = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
};

const CHIP = {
  red: "bg-[#FBEEF0] text-[#AC2334] dark:bg-red-900/30 dark:text-red-300",
  amber: "bg-[#FBF3E2] text-[#B07A14] dark:bg-amber-900/30 dark:text-amber-300",
  green: "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300",
  grey: "bg-[#F1F4F9] text-[#8593A8] dark:bg-gray-800 dark:text-gray-400",
};

// Active flags for an account. "No data yet" is intentionally NOT a flag.
const flagsOf = (a) => {
  const s = a.status ?? {};
  const out = [];
  if (s.low_balance) out.push({ label: "Low balance", tone: "red" });
  if (s.under_one_day) out.push({ label: "Under 1 day", tone: "amber" });
  if (s.under_delivery === "red") out.push({ label: "Under-delivery", tone: "red" });
  else if (s.under_delivery === "amber") out.push({ label: "Under-delivery", tone: "amber" });
  return out;
};
const isNoData = (a) => (a.status?.under_delivery == null) && a.has_yesterday_data === false;
const isFlagged = (a) => flagsOf(a).length > 0;
// Positive status: no flags and not a "No data yet" account (matches the green "Healthy" chip).
const isHealthy = (a) => !isFlagged(a) && !isNoData(a);
const isCard = (a) => a.is_prepay_account === false || a.balance === "card-funded";
const isActive = (a) => Boolean(a.is_active) && a.account_status === 1;

// Sortable value for a given column key. Non-numeric / unsynced values sink.
const sortValue = (a, key) => {
  switch (key) {
    case "name": return (a.name || "").toLowerCase();
    case "campaign_count": return Number(a.campaign_count) || 0;
    case "balance":
    case "daily_budget":
    case "spent_yesterday":
    case "spent_today": {
      const n = parseFloat(a[key]);
      return isFinite(n) ? n : -Infinity;
    }
    default: return 0;
  }
};

function StatusCell(props) {
  const a = () => props.account;
  const fl = () => flagsOf(a());
  return (
    <Show
      when={fl().length > 0}
      fallback={
        <Show
          when={isNoData(a())}
          fallback={<span class={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${CHIP.green}`}><span class="w-1.5 h-1.5 rounded-full bg-[#15966A]" /> Healthy</span>}
        >
          <span class={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${CHIP.grey}`}>No data yet</span>
        </Show>
      }
    >
      <div class="flex flex-wrap gap-1 justify-end">
        <For each={fl()}>
          {(f) => <span class={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold ${CHIP[f.tone]}`}>{f.label}</span>}
        </For>
      </div>
    </Show>
  );
}

function BalanceCell(props) {
  const a = () => props.account;
  return (
    <Show
      when={!isCard(a())}
      fallback={<span class="text-[#54657E] dark:text-gray-400 text-xs font-medium">Card-funded</span>}
    >
      <Show when={money2(a().balance) != null} fallback={<span class="text-[#8593A8] dark:text-gray-500" title="Balance not synced">—</span>}>
        <span
          class={`font-bold tabular-nums ${a().status?.low_balance ? "text-[#AC2334] dark:text-red-400" : "text-[#1A2B45] dark:text-gray-300"}`}
          title={relTime(a().balance_synced_at) ? `Balance as of ${relTime(a().balance_synced_at)}` : undefined}
        >
          {money2(a().balance)}
        </span>
      </Show>
    </Show>
  );
}

export default function AccountMonitor() {
  const [search, setSearch] = createSignal("");
  const [flaggedOnly, setFlaggedOnly] = createSignal(false);
  const [healthyOnly, setHealthyOnly] = createSignal(false);
  const [statusFilter, setStatusFilter] = createSignal("active"); // active | inactive | all

  // Flagged and Healthy are opposite views — enabling one clears the other.
  const toggleFlagged = () => { const next = !flaggedOnly(); setFlaggedOnly(next); if (next) setHealthyOnly(false); };
  const toggleHealthy = () => { const next = !healthyOnly(); setHealthyOnly(next); if (next) setFlaggedOnly(false); };
  const [sortKey, setSortKey] = createSignal(null); // null → preserve API urgency order
  const [sortDir, setSortDir] = createSignal("asc");

  const toggleSort = (key) => {
    if (sortKey() === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  };

  // Clickable sortable header cell.
  const Th = (props) => {
    const active = () => sortKey() === props.sortKey;
    const alignCls = props.align === "left" ? "text-left" : props.align === "center" ? "text-center" : "text-right";
    return (
      <th
        class={`p-4 whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700 ${alignCls} ${props.class || ""} ${props.sortKey ? "cursor-pointer select-none hover:text-[#AC2334] transition-colors" : ""}`}
        onClick={props.sortKey ? () => toggleSort(props.sortKey) : undefined}
        aria-sort={props.sortKey ? (active() ? (sortDir() === "asc" ? "ascending" : "descending") : "none") : undefined}
      >
        <span class={`inline-flex items-center gap-1 ${props.align === "right" ? "flex-row-reverse" : ""}`}>
          {props.children}
          <Show when={props.sortKey}>
            <span class={`text-[10px] leading-none ${active() ? "text-[#AC2334]" : "text-[#C3CDDB] dark:text-gray-600"}`}>
              {active() ? (sortDir() === "asc" ? "▲" : "▼") : "⇅"}
            </span>
          </Show>
        </span>
      </th>
    );
  };

  const [data] = createResource(async () => {
    try {
      const res = await fetchMonitorAccounts();
      return { rows: Array.isArray(res?.data) ? res.data : [], summary: res?.meta?.summary ?? null, forbidden: false };
    } catch (err) {
      if (err?.status === 403) return { rows: [], summary: null, forbidden: true };
      throw err;
    }
  });

  const forbidden = () => data()?.forbidden === true;
  const accounts = () => data()?.rows ?? [];
  const summary = () => data()?.summary ?? null;
  const thresholds = () => summary()?.thresholds ?? null;

  const rows = createMemo(() => {
    const q = search().trim().toLowerCase();
    const sf = statusFilter();
    const filtered = accounts().filter((a) => {
      if (q && !a.name?.toLowerCase().includes(q)) return false;
      if (flaggedOnly() && !isFlagged(a)) return false;
      if (healthyOnly() && !isHealthy(a)) return false;
      if (sf === "active" && !isActive(a)) return false;
      if (sf === "inactive" && isActive(a)) return false;
      return true;
    });
    const key = sortKey();
    if (!key) return filtered;
    const dir = sortDir() === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, key), vb = sortValue(b, key);
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return 0;
    });
  });

  const flaggedCount = createMemo(() => accounts().filter(isFlagged).length);
  const healthyCount = createMemo(() => accounts().filter(isHealthy).length);
  const activeCount = createMemo(() => accounts().filter(isActive).length);
  const inactiveCount = createMemo(() => accounts().filter((a) => !isActive(a)).length);

  return (
    <div class="font-sans min-h-screen bg-[#F4F6FA] dark:bg-gray-900">
      {/* ─────────────── Masthead (light banner) ─────────────── */}
      <header class="relative bg-gray-50 dark:bg-gray-900 border-b border-[#E2E8F1] dark:border-gray-700 px-4 md:px-9">
        <span class="absolute inset-x-0 top-0 h-1 bg-[#AC2334]" />
        <div class="max-w-[1480px] mx-auto pt-6 pb-6">
          <nav
            class="flex items-center gap-2 text-[12px] font-bold tracking-[0.14em] uppercase text-[#8593A8] dark:text-gray-500 mb-3"
            aria-label="Breadcrumb"
          >
            
            <span class="text-[#AC2334]">Account &amp; Budget Monitor</span>
          </nav>
          <div class="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <h1 class="font-sans font-bold text-2xl leading-[1.05] text-[#14233A] dark:text-white">
                Account &amp; Budget Monitor
              </h1>
              <p class="mt-2 text-[13.5px] text-[#54657E] dark:text-gray-400 max-w-[620px]">
                Account health — low balance, under-one-day, and
                budget-vs-delivery flags across all accounts.{" "}
                <b class="text-[#14233A] dark:text-gray-200 font-semibold">
                  Critical rows need funding today.
                </b>
              </p>
            </div>
            <Show when={!forbidden()}>
              <div class="text-left md:text-right pb-1">
                <Show
                  when={summary()}
                  fallback={<div class="h-7 w-32 rounded bg-[#E7ECF4] dark:bg-gray-700 animate-pulse" />}
                >
                  <div class="text-2xl font-bold tabular-nums leading-none text-[#14233A] dark:text-white">
                    {moneyWhole(summary().total_daily_budget)}
                  </div>
                  <div class="mt-1.5 text-[10.5px] font-semibold tracking-[0.1em] uppercase text-gray-600 dark:text-gray-500">
                    Total daily budget · active campaigns
                  </div>
                  <Show when={thresholds()}>
                    <div class="mt-2 text-[11.5px] text-gray-500 dark:text-gray-500">
                      Thresholds · low &lt; {moneyWhole(thresholds().low_balance)}{" "}
                      · under-delivery {thresholds().under_delivery_amber_pct}% /{" "}
                      {thresholds().under_delivery_red_pct}%
                    </div>
                  </Show>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </header>

      <main class="max-w-[1480px] mx-auto px-4 md:px-9 pb-16">
        {/* 403 */}
        <Show when={forbidden()}>
          <div class="mt-6 bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 py-16 px-6 text-center">
            <div class="mx-auto w-12 h-12 rounded-full bg-[#F1F4F9] dark:bg-gray-800 flex items-center justify-center mb-3">
              <svg class="w-6 h-6 text-[#8593A8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
            </div>
            <h3 class="text-base font-bold text-[#14233A] dark:text-gray-100">Available to admins only</h3>
            <p class="text-sm text-[#54657E] dark:text-gray-400 mt-1">This view is restricted to admin and global-read roles.</p>
          </div>
        </Show>

        <Show when={!forbidden()}>
          {/* Overview — one card, all metrics inside */}
          <div class="mt-6">
            <Show
              when={!data.loading && summary()}
              fallback={
                <div class="h-[96px] rounded-2xl bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_16px_rgba(16,29,49,.05)] animate-pulse" />
              }
            >
              <div class="bg-gray-50 dark:bg-gray-900 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_16px_rgba(16,29,49,.05)] overflow-hidden">
                <div class="grid grid-cols-2 lg:grid-cols-4">
                  <SummarySeg
                    accent="#AC2334"
                    label="Low balance"
                    value={num(summary().low_balance_accounts)}
                    valueClass="text-[#AC2334] dark:text-red-400"
                    sub="need funding now"
                  />
                  <SummarySeg
                    class="border-l border-[#EEF1F6] dark:border-gray-800"
                    accent="#C9871B"
                    label="Flagged"
                    value={num(flaggedCount())}
                    valueClass="text-[#14233A] dark:text-white"
                    sub="need attention"
                  />
                  <SummarySeg
                    class="border-t lg:border-t-0 lg:border-l border-[#EEF1F6] dark:border-gray-800"
                    accent="#15966A"
                    label="Healthy"
                    value={num(healthyCount())}
                    valueClass="text-[#14233A] dark:text-white"
                    sub="funded & pacing"
                  />
                  <SummarySeg
                    class="border-t lg:border-t-0 border-l border-[#EEF1F6] dark:border-gray-800"
                    accent="#35507F"
                    label="Accounts"
                    value={num(summary().accounts)}
                    valueClass="text-[#14233A] dark:text-white"
                    sub="total monitored"
                  />
                </div>
              </div>
            </Show>
          </div>

          {/* Toolbar */}
          <div class="mt-6 mb-4 flex flex-wrap items-center gap-3">
            <div class="relative flex-1 min-w-[240px] max-w-[380px]">
              <svg class="w-4 h-4 text-[#8593A8] absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
              <input type="text" placeholder="Search by account name…" value={search()} onInput={(e) => setSearch(e.target.value)}
                class="w-full h-[38px] pl-9 pr-3 text-sm rounded-[10px] border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[#1A2B45] dark:text-white placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#14233A]/10 focus:border-[#14233A]" />
            </div>
            {/* Active / Inactive / All segment */}
            <div class="inline-flex items-center bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-[10px] p-[3px] gap-0.5">
              <For each={[["active", "Active", activeCount], ["inactive", "Inactive", inactiveCount], ["all", "All", () => accounts().length]]}>
                {([val, label, count]) => (
                  <button onClick={() => setStatusFilter(val)}
                    class={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[7px] text-[12.5px] font-semibold transition-colors ${statusFilter() === val ? "bg-[#14233A] text-white" : "text-[#54657E] dark:text-gray-300 hover:bg-[#F2F5FA] dark:hover:bg-gray-700"}`}>
                    {label}
                    <span class={`text-[11px] tabular-nums ${statusFilter() === val ? "text-white/65" : "text-[#8593A8]"}`}>{count()}</span>
                  </button>
                )}
              </For>
            </div>
            <button onClick={toggleFlagged}
              class={`inline-flex items-center gap-2 h-[38px] px-3.5 rounded-[10px] text-[12.5px] font-semibold border transition-colors ${flaggedOnly() ? "bg-[#AC2334] text-white border-[#AC2334]" : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#AC2334]/40"}`}>
              Flagged only
              <span class={`text-[11px] font-bold tabular-nums px-1.5 py-px rounded-full ${flaggedOnly() ? "bg-gray-50/20 text-white" : "bg-[#F1F4F9] dark:bg-gray-700 text-[#8593A8]"}`}>{flaggedCount()}</span>
            </button>
            <button onClick={toggleHealthy}
              class={`inline-flex items-center gap-2 h-[38px] px-3.5 rounded-[10px] text-[12.5px] font-semibold border transition-colors ${healthyOnly() ? "bg-[#15966A] text-white border-[#15966A]" : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#15966A]/40"}`}>
              Healthy only
              <span class={`text-[11px] font-bold tabular-nums px-1.5 py-px rounded-full ${healthyOnly() ? "bg-gray-50/20 text-white" : "bg-[#F1F4F9] dark:bg-gray-700 text-[#8593A8]"}`}>{healthyCount()}</span>
            </button>
            <span class="ml-auto text-[12.5px] text-[#8593A8] dark:text-gray-500 whitespace-nowrap"><b class="text-[#14233A] dark:text-white font-semibold tabular-nums">{rows().length}</b> shown</span>
          </div>

          <Show when={data.error}>
            <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">Failed to load the monitor. Please try again.</div>
          </Show>

          {/* Desktop ledger */}
          <div class="hidden md:block bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_16px_rgba(16,29,49,.05)] overflow-hidden">
            <div class="overflow-x-auto">
              <table class="min-w-full text-sm border-separate border-spacing-0">
                <thead>
                  <tr class="bg-[#F2F5FA] dark:bg-gray-800 text-gray-600 dark:text-gray-400 uppercase text-[12px] font-bold tracking-[0.12em]">
                    <th class="p-4 text-center whitespace-nowrap w-16 border-b border-[#E3E8F0] dark:border-gray-700">ID</th>
                    <Th align="left" class="min-w-[220px]" sortKey="name">Account</Th>
                    <Th align="right" sortKey="balance">Balance</Th>
                    <Th align="right" sortKey="campaign_count">Campaigns</Th>
                    <Th align="right" sortKey="daily_budget">Daily Budget</Th>
                    <Th align="right" sortKey="spent_yesterday">Spent Yesterday</Th>
                    <Th align="right" sortKey="spent_today">Spent Today</Th>
                    <th class="p-4 text-right whitespace-nowrap border-b border-[#E3E8F0] dark:border-gray-700">Status</th>
                  </tr>
                </thead>
                <Show when={!data.loading} fallback={
                  <tbody>
                    <For each={Array(8).fill(0)}>{() => <tr class="animate-pulse"><For each={Array(8).fill(0)}>{(_, idx) => <td class="p-4 border-b border-[#EEF1F6] dark:border-gray-800"><div class={`h-3 bg-gray-200 dark:bg-gray-700 rounded ${idx() === 1 ? "w-40" : "w-16 ml-auto"}`} /></td>}</For></tr>}</For>
                  </tbody>
                }>
                  <tbody>
                    <For each={rows()}>
                      {(a, i) => (
                        <tr class="group transition-colors hover:bg-[#F2F5FA] dark:hover:bg-gray-800/40">
                          <td class="p-4 text-center align-middle border-b border-[#EEF1F6] dark:border-gray-800">
                            <span class="text-[11.5px] text-[#7A849A] dark:text-gray-500 tabular-nums">{String(i() + 1).padStart(2, "0")}</span>
                          </td>
                          <td class="p-4 align-middle border-b border-[#EEF1F6] dark:border-gray-800">
                            <div class="flex items-center gap-3.5">
                              <Avatar name={a.name} />
                              <div class="min-w-0">
                                <span class="block text-[#1B2437] dark:text-gray-100 font-semibold truncate" title={a.name}>{a.name}</span>
                                <Show
                                  when={a.is_active && a.account_status === 1}
                                  fallback={<span class="text-[11px] font-bold text-[#B07A14]">Inactive</span>}
                                >
                                  <span class="text-[11.5px] text-[#7A849A] dark:text-gray-500">{num(a.campaign_count)} active campaign{Number(a.campaign_count) === 1 ? "" : "s"}</span>
                                </Show>
                              </div>
                            </div>
                          </td>
                          <td class="p-4 text-right align-middle whitespace-nowrap border-b border-[#EEF1F6] dark:border-gray-800"><BalanceCell account={a} /></td>
                          <td class="p-4 text-right align-middle text-[#4B5568] dark:text-gray-300 font-semibold tabular-nums border-b border-[#EEF1F6] dark:border-gray-800">{num(a.campaign_count)}</td>
                          <td class="p-4 text-right align-middle text-[#1B2437] dark:text-gray-300 whitespace-nowrap tabular-nums border-b border-[#EEF1F6] dark:border-gray-800">{money2(a.daily_budget) ?? "—"}</td>
                          <td class="p-4 text-right align-middle text-[#4B5568] dark:text-gray-400 whitespace-nowrap tabular-nums border-b border-[#EEF1F6] dark:border-gray-800">
                            <Show when={a.has_yesterday_data !== false} fallback={<span class="text-[#8593A8]">—</span>}>{money2(a.spent_yesterday) ?? "—"}</Show>
                          </td>
                          <td class="p-4 text-right align-middle whitespace-nowrap border-b border-[#EEF1F6] dark:border-gray-800">
                            <span class="text-[#4B5568] dark:text-gray-400 tabular-nums">{money2(a.spent_today) ?? "—"}</span>
                            <span class="block text-[10px] text-[#8593A8] dark:text-gray-500 uppercase tracking-wide">so far</span>
                          </td>
                          <td class="p-2 text-right align-middle border-b border-[#EEF1F6] dark:border-gray-800"><StatusCell account={a} /></td>
                        </tr>
                      )}
                    </For>
                    <Show when={rows().length === 0}>
                      <tr><td colspan="8" class="py-16 text-center text-[#8593A8] dark:text-gray-500">{search().trim() || flaggedOnly() || healthyOnly() || statusFilter() !== "all" ? "No accounts match the current filters." : "No accounts to show."}</td></tr>
                    </Show>
                  </tbody>
                </Show>
              </table>
            </div>
            {/* Ledger foot */}
            <Show when={!data.loading}>
              <div class="flex items-center justify-between gap-2 flex-wrap px-[22px] py-3 border-t border-[#E3E8F0] dark:border-gray-700 bg-[#F2F5FA] dark:bg-gray-800 text-[12px] text-[#7A849A] dark:text-gray-500">
                <span>Showing <b class="text-[#4B5568] dark:text-gray-300 font-semibold tabular-nums">{rows().length}</b> of <b class="text-[#4B5568] dark:text-gray-300 font-semibold tabular-nums">{accounts().length}</b> accounts</span>
                <div class="flex gap-4 flex-wrap">
                  <span class="inline-flex items-center gap-1.5"><span class="w-[7px] h-[7px] rounded-full bg-[#AC2334]" />Critical · fund today</span>
                  <span class="inline-flex items-center gap-1.5"><span class="w-[7px] h-[7px] rounded-full bg-[#C9871B]" />Warning · low balance or pacing</span>
                  <span class="inline-flex items-center gap-1.5"><span class="w-[7px] h-[7px] rounded-full bg-[#15966A]" />Healthy</span>
                </div>
              </div>
            </Show>
          </div>

          {/* Mobile cards */}
          <div class="md:hidden space-y-3">
            <Show when={!data.loading} fallback={<For each={Array(5).fill(0)}>{() => <div class="h-32 rounded-xl bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 animate-pulse" />}</For>}>
              <For each={rows()}>
                {(a, i) => (
                  <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
                    <div class="flex items-center gap-3">
                      <span class="text-[11px] text-[#7A849A] dark:text-gray-500 tabular-nums flex-none">{String(i() + 1).padStart(2, "0")}</span>
                      <Avatar name={a.name} size="w-9 h-9" />
                      <span class="font-semibold text-[#1B2437] dark:text-gray-100 truncate">{a.name}</span>
                    </div>
                    <div class="mt-3 pt-3 border-t border-[#E2E8F1] dark:border-gray-700 flex items-center justify-between">
                      <span class="text-xs font-semibold uppercase tracking-wide text-[#8593A8] dark:text-gray-400">Balance</span>
                      <BalanceCell account={a} />
                    </div>
                    <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                      <div class="flex justify-between"><span class="text-[#8593A8]">Daily budget</span><span class="font-semibold text-[#1B2437] dark:text-gray-300 tabular-nums">{money2(a.daily_budget) ?? "—"}</span></div>
                      <div class="flex justify-between"><span class="text-[#8593A8]">Campaigns</span><span class="font-semibold text-[#1B2437] dark:text-gray-300 tabular-nums">{num(a.campaign_count)}</span></div>
                      <div class="flex justify-between"><span class="text-[#8593A8]">Spent yest.</span><span class="font-semibold text-[#1B2437] dark:text-gray-300 tabular-nums">{a.has_yesterday_data === false ? "—" : money2(a.spent_yesterday) ?? "—"}</span></div>
                      <div class="flex justify-between"><span class="text-[#8593A8]">Spent today</span><span class="font-semibold text-[#1B2437] dark:text-gray-300 tabular-nums">{money2(a.spent_today) ?? "—"}</span></div>
                    </div>
                    <div class="mt-3 flex justify-end"><StatusCell account={a} /></div>
                  </div>
                )}
              </For>
              <Show when={rows().length === 0}>
                <div class="py-16 text-center text-[#8593A8] dark:text-gray-500">{search().trim() || flaggedOnly() || healthyOnly() || statusFilter() !== "all" ? "No accounts match the current filters." : "No accounts to show."}</div>
              </Show>
            </Show>
          </div>
        </Show>
      </main>
    </div>
  );
}

// ── Summary segment (one metric inside the single overview card) ─────────────
function SummarySeg(props) {
  return (
    <div class={`px-5 py-4 ${props.class || ""}`}>
      <div class="flex items-center gap-1.5 text-[10.5px] font-bold tracking-[0.12em] uppercase text-[#7A849A] dark:text-gray-400">
        <span class="w-2 h-2 rounded-full" style={{ background: props.accent }} />
        {props.label}
      </div>
      <div class={`mt-1.5 text-3xl font-extrabold tabular-nums leading-tight ${props.valueClass}`}>
        {props.value}
      </div>
      <div class="mt-0.5 text-xs text-[#7A849A] dark:text-gray-500">{props.sub}</div>
    </div>
  );
}
