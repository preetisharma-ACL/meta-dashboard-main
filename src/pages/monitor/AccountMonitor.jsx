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
const isCard = (a) => a.is_prepay_account === false || a.balance === "card-funded";

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
    return accounts().filter((a) => {
      if (q && !a.name?.toLowerCase().includes(q)) return false;
      if (flaggedOnly() && !isFlagged(a)) return false;
      return true;
    });
  });

  const flaggedCount = createMemo(() => accounts().filter(isFlagged).length);

  return (
    <div class="font-sans min-h-screen bg-[#F4F6FA] dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div class="mb-5">
        <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">Coordination · Monitor</p>
        <h1 class="text-2xl font-bold text-[#14233A] dark:text-white tracking-tight">Account &amp; Budget Monitor</h1>
        <p class="text-sm text-[#54657E] dark:text-gray-400 mt-1">
          Account health — low balance, under-one-day, and budget-vs-delivery flags across all accounts.
        </p>
      </div>

      {/* 403 */}
      <Show when={forbidden()}>
        <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 py-16 px-6 text-center">
          <div class="mx-auto w-12 h-12 rounded-full bg-[#F1F4F9] dark:bg-gray-800 flex items-center justify-center mb-3">
            <svg class="w-6 h-6 text-[#8593A8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
          </div>
          <h3 class="text-base font-bold text-[#14233A] dark:text-gray-100">Available to admins only</h3>
          <p class="text-sm text-[#54657E] dark:text-gray-400 mt-1">This view is restricted to admin and global-read roles.</p>
        </div>
      </Show>

      <Show when={!forbidden()}>
        {/* Summary tiles */}
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
          <Show when={!data.loading && summary()} fallback={
            <For each={Array(3).fill(0)}>{() => <div class="h-24 rounded-2xl bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 animate-pulse" />}</For>
          }>
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] px-5 py-5">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Low-balance accounts</p>
              <p class="text-3xl font-extrabold text-[#AC2334] dark:text-red-400 mt-2 tabular-nums">{num(summary().low_balance_accounts)}</p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-1">need attention now</p>
            </div>
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] px-5 py-5">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Total daily budget</p>
              <p class="text-3xl font-extrabold text-[#14233A] dark:text-white mt-2 tabular-nums">{moneyWhole(summary().total_daily_budget)}</p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-1">across active campaigns</p>
            </div>
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] px-5 py-5">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Accounts</p>
              <p class="text-3xl font-extrabold text-[#14233A] dark:text-white mt-2 tabular-nums">{num(summary().accounts)}</p>
              <Show when={thresholds()}>
                <p class="text-[11px] text-[#8593A8] dark:text-gray-500 mt-1">
                  Thresholds · low &lt; {moneyWhole(thresholds().low_balance)} · under-delivery {thresholds().under_delivery_amber_pct}%/{thresholds().under_delivery_red_pct}%
                </p>
              </Show>
            </div>
          </Show>
        </div>

        {/* Filter toolbar */}
        <div class="bg-gray-50 dark:bg-gray-900 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-3.5 mb-4 flex flex-wrap items-center gap-3">
          <div class="relative flex-1 min-w-[220px]">
            <svg class="w-4 h-4 text-[#8593A8] absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
            <input type="text" placeholder="Search by account name…" value={search()} onInput={(e) => setSearch(e.target.value)}
              class="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 text-[#1A2B45] dark:text-white placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]" />
          </div>
          <button onClick={() => setFlaggedOnly((v) => !v)}
            class={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors ${flaggedOnly() ? "bg-[#AC2334] text-white border-[#AC2334]" : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#AC2334]/40"}`}>
            Flagged only
            <span class={`text-[11px] font-extrabold px-1.5 py-px rounded-full ${flaggedOnly() ? "bg-white/20 text-white" : "bg-[#F1F4F9] dark:bg-gray-700 text-[#8593A8]"}`}>{flaggedCount()}</span>
          </button>
          <span class="ml-auto text-sm font-bold text-[#8593A8] dark:text-gray-500 whitespace-nowrap"><b class="text-[#14233A] dark:text-white">{rows().length}</b> shown</span>
        </div>

        <Show when={data.error}>
          <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">Failed to load the monitor. Please try again.</div>
        </Show>

        {/* Desktop table */}
        <div class="hidden md:block bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] overflow-x-auto">
          <table class="min-w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr class="bg-[#F8FAFC] dark:bg-gray-800 text-[#54657E] dark:text-gray-400 uppercase text-xs font-bold tracking-wider">
                <th class="p-4 text-center whitespace-nowrap w-16 border-b border-[#D4DDE9] dark:border-gray-700">S.No</th>
                <th class="p-4 text-left whitespace-nowrap min-w-[220px] border-b border-[#D4DDE9] dark:border-gray-700">Account</th>
                <th class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">Balance</th>
                <th class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">Campaigns</th>
                <th class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">Daily Budget</th>
                <th class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">Spent Yesterday</th>
                <th class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">Spent Today</th>
                <th class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">Status</th>
              </tr>
            </thead>
            <Show when={!data.loading} fallback={
              <tbody>
                <For each={Array(8).fill(0)}>{() => <tr class="animate-pulse"><For each={Array(8).fill(0)}>{(_, idx) => <td class="p-4 border-b border-[#E2E8F1] dark:border-gray-800"><div class={`h-3 bg-gray-200 dark:bg-gray-700 rounded ${idx() === 1 ? "w-40" : "w-16 ml-auto"}`} /></td>}</For></tr>}</For>
              </tbody>
            }>
              <tbody>
                <For each={rows()}>
                  {(a, i) => (
                    <tr class={`group transition-colors ${isFlagged(a) ? "bg-[#FFF8F9] dark:bg-red-900/5 hover:bg-[#FDEFF1] dark:hover:bg-red-900/10" : "hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40"}`}>
                      <td class="p-4 text-center align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                        <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FBEEF0] dark:bg-red-900/30 text-[#AC2334] dark:text-red-300 text-xs font-extrabold">{i() + 1}</span>
                      </td>
                      <td class="p-4 align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                        <div class="flex items-center gap-4">
                          <Avatar name={a.name} />
                          <div class="min-w-0">
                            <span class="block text-blue-900 dark:text-gray-100 font-semibold truncate" title={a.name}>{a.name}</span>
                            <Show when={!(a.is_active && a.account_status === 1)}>
                              <span class="text-[11px] font-bold text-[#B07A14]">Inactive</span>
                            </Show>
                          </div>
                        </div>
                      </td>
                      <td class="p-4 text-right align-middle whitespace-nowrap border-b border-[#E2E8F1] dark:border-gray-800"><BalanceCell account={a} /></td>
                      <td class="p-4 text-right align-middle text-[#54657E] dark:text-gray-300 font-semibold tabular-nums border-b border-[#E2E8F1] dark:border-gray-800">{num(a.campaign_count)}</td>
                      <td class="p-4 text-right align-middle text-[#1A2B45] dark:text-gray-300 whitespace-nowrap tabular-nums border-b border-[#E2E8F1] dark:border-gray-800">{money2(a.daily_budget) ?? "—"}</td>
                      <td class="p-4 text-right align-middle text-[#54657E] dark:text-gray-400 whitespace-nowrap tabular-nums border-b border-[#E2E8F1] dark:border-gray-800">
                        <Show when={a.has_yesterday_data !== false} fallback={<span class="text-[#8593A8]">—</span>}>{money2(a.spent_yesterday) ?? "—"}</Show>
                      </td>
                      <td class="p-4 text-right align-middle whitespace-nowrap border-b border-[#E2E8F1] dark:border-gray-800">
                        <span class="text-[#54657E] dark:text-gray-400 tabular-nums">{money2(a.spent_today) ?? "—"}</span>
                        <span class="block text-[10px] text-[#8593A8] dark:text-gray-500 uppercase tracking-wide">so far</span>
                      </td>
                      <td class="p-4 text-right align-middle border-b border-[#E2E8F1] dark:border-gray-800"><StatusCell account={a} /></td>
                    </tr>
                  )}
                </For>
                <Show when={rows().length === 0}>
                  <tr><td colspan="8" class="py-16 text-center text-[#8593A8] dark:text-gray-500">{search().trim() || flaggedOnly() ? "No accounts match the current filters." : "No accounts to show."}</td></tr>
                </Show>
              </tbody>
            </Show>
          </table>
        </div>

        {/* Mobile cards */}
        <div class="md:hidden space-y-3">
          <Show when={!data.loading} fallback={<For each={Array(5).fill(0)}>{() => <div class="h-32 rounded-xl bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 animate-pulse" />}</For>}>
            <For each={rows()}>
              {(a, i) => (
                <div class={`rounded-xl border p-4 ${isFlagged(a) ? "border-[#AC2334]/25 bg-[#FFF8F9] dark:bg-red-900/5" : "border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-900"}`}>
                  <div class="flex items-center gap-3">
                    <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#FBEEF0] dark:bg-red-900/30 text-[#AC2334] dark:text-red-300 text-[11px] font-extrabold flex-none">{i() + 1}</span>
                    <Avatar name={a.name} size="w-9 h-9" />
                    <span class="font-semibold text-blue-900 dark:text-gray-100 truncate">{a.name}</span>
                  </div>
                  <div class="mt-3 pt-3 border-t border-[#E2E8F1] dark:border-gray-700 flex items-center justify-between">
                    <span class="text-xs font-semibold uppercase tracking-wide text-[#8593A8] dark:text-gray-400">Balance</span>
                    <BalanceCell account={a} />
                  </div>
                  <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <div class="flex justify-between"><span class="text-[#8593A8]">Daily budget</span><span class="font-semibold text-[#1A2B45] dark:text-gray-300 tabular-nums">{money2(a.daily_budget) ?? "—"}</span></div>
                    <div class="flex justify-between"><span class="text-[#8593A8]">Campaigns</span><span class="font-semibold text-[#1A2B45] dark:text-gray-300 tabular-nums">{num(a.campaign_count)}</span></div>
                    <div class="flex justify-between"><span class="text-[#8593A8]">Spent yest.</span><span class="font-semibold text-[#1A2B45] dark:text-gray-300 tabular-nums">{a.has_yesterday_data === false ? "—" : money2(a.spent_yesterday) ?? "—"}</span></div>
                    <div class="flex justify-between"><span class="text-[#8593A8]">Spent today</span><span class="font-semibold text-[#1A2B45] dark:text-gray-300 tabular-nums">{money2(a.spent_today) ?? "—"}</span></div>
                  </div>
                  <div class="mt-3 flex justify-end"><StatusCell account={a} /></div>
                </div>
              )}
            </For>
            <Show when={rows().length === 0}>
              <div class="py-16 text-center text-[#8593A8] dark:text-gray-500">{search().trim() || flaggedOnly() ? "No accounts match the current filters." : "No accounts to show."}</div>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  );
}
