import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { fetchManagerPerformance } from "../../services/performance";
import Avatar from "../../components/common/Avatar";

// ─── Formatters ───────────────────────────────────────────────────────────────
const money0 = (v) => {
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
// Compact lakh/crore for the hero summary stat (₹13.6L).
const moneyCompact = (v) => {
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)}L`;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};
const pct = (v) => {
  if (v == null) return "—";
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
};
const num = (v) => (Number(v) || 0).toLocaleString("en-IN");
// Friendly manager name from the email local-part (presentation only).
const labelFromEmail = (email) => {
  const local = String(email ?? "").split("@")[0] || "—";
  return local.charAt(0).toUpperCase() + local.slice(1);
};
// Share-panel palette — mirrors the ClientDashboard "lead share" chart.
const SHARE_COLORS = ["#3E6FB0", "#7FA8D8", "#15966A", "#AC2334"];
const OTHERS_COLOR = "#D8DFE9";
// Roster client count. `assigned_client_count` = all CPL+Hybrid clients assigned
// to the manager (true roster); `client_count` = active subset with spend this
// month. Prefer assigned, fall back to active for backends without the field.
const assignedCount = (r) =>
  r?.assigned_client_count != null ? Number(r.assigned_client_count) : Number(r?.client_count) || 0;
const profitTone = (v) => {
  const n = parseFloat(v);
  if (!isFinite(n)) return "text-gray-500 dark:text-gray-400";
  return n >= 0 ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400";
};

// ─── Month options: last 12 months (no Date arithmetic surprises) ─────────────
const monthOptions = () => {
  const now = new Date();
  const opts = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    opts.push({ key, label });
  }
  return opts;
};
const currentMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// ─── Coverage indicator — the load-bearing caveat ─────────────────────────────
// Profit is computed only on PRICED projects. Low coverage means a negative
// profit is most likely a data-coverage artifact, not a real loss. Make the
// priced/total ratio obvious and surface coverage_note on hover.
function Coverage(props) {
  const total = () => Number(props.total) || 0;
  const priced = () => Number(props.priced) || 0;
  const full = () => total() > 0 && priced() >= total();
  const ratio = () => (total() > 0 ? priced() / total() : 1);
  const tone = () =>
    full()
      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
      : ratio() < 0.5
      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"
      : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300";
  return (
    <span
      class={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold whitespace-nowrap ${tone()}`}
      title={props.note || (full() ? "All projects priced — profit is complete." : "Some projects are unpriced; profit is partial.")}
    >
      <Show when={!full()}>
        <svg class="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
        </svg>
      </Show>
      {num(priced())}/{num(total())} priced
    </span>
  );
}

export default function ManagerPerformance() {
  const [month, setMonth] = createSignal(currentMonthKey());

  const [data] = createResource(month, async (m) => {
    try {
      const res = await fetchManagerPerformance(m);
      return { rows: Array.isArray(res?.data) ? res.data : [], summary: res?.meta?.summary ?? null, forbidden: false };
    } catch (err) {
      if (err?.status === 403) return { rows: [], summary: null, forbidden: true };
      throw err;
    }
  });

  const forbidden = () => data()?.forbidden === true;
  const rows = () => data()?.rows ?? [];
  const summary = () => data()?.summary ?? null;
  const isLive = () => month() === currentMonthKey() && summary()?.finalized !== true;

  const cards = createMemo(() => {
    const s = summary();
    if (!s) return [];
    return [
      { label: "Total Profit", value: moneyCompact(s.total_profit), accent: profitTone(s.total_profit), bg: "bg-green-50 dark:bg-gray-800 border-green-200 dark:border-gray-700" },
      { label: "Total Billable", value: moneyCompact(s.total_net_billable), accent: "text-gray-900 dark:text-white", bg: "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700" },
      { label: "Total Spend", value: moneyCompact(s.total_actual_spend), accent: "text-amber-600 dark:text-amber-400", bg: "bg-amber-50 dark:bg-gray-800 border-amber-200 dark:border-gray-700" },
      { label: "Managers", value: num(s.managers), accent: "text-purple-600 dark:text-purple-400", bg: "bg-purple-50 dark:bg-gray-800 border-purple-200 dark:border-gray-700" },
    ];
  });

  // Bar chart scale — max absolute profit for proportional bars.
  const maxAbsProfit = createMemo(() => Math.max(1, ...rows().map((r) => Math.abs(parseFloat(r.profit) || 0))));

  // Average profit across managers — anchors the dashed "avg" marker + per-row
  // delta, mirroring the ClientDashboard CPL chart. Display-only.
  const avgProfit = createMemo(() => {
    const rs = rows();
    if (!rs.length) return 0;
    return rs.reduce((s, r) => s + (parseFloat(r.profit) || 0), 0) / rs.length;
  });

  // Net-billable share across managers (top 4 + Others) — analog of the
  // ClientDashboard "where the leads came from" panel. Pure presentation over
  // the same net_billable the table already shows.
  const billableShare = createMemo(() => {
    const withVal = rows()
      .map((r) => ({
        name: labelFromEmail(r.manager_email),
        val: Math.max(0, parseFloat(r.net_billable) || 0),
      }))
      .sort((a, b) => b.val - a.val);
    const total = withVal.reduce((s, x) => s + x.val, 0);
    if (total <= 0) return { total: 0, items: [] };
    const top = withVal.slice(0, 4);
    const rest = withVal.slice(4);
    const items = top.map((x, i) => ({
      name: x.name,
      count: x.val,
      pct: (x.val / total) * 100,
      color: SHARE_COLORS[i],
    }));
    if (rest.length) {
      const restVal = rest.reduce((s, x) => s + x.val, 0);
      items.push({
        name: `Others (${rest.length})`,
        count: restVal,
        pct: (restVal / total) * 100,
        color: OTHERS_COLOR,
      });
    }
    return { total, items };
  });

  // Pricing coverage across the whole roster — analog of "campaign health".
  const coverageTotals = createMemo(() => {
    const rs = rows();
    const priced = rs.reduce((s, r) => s + (Number(r.projects_priced) || 0), 0);
    const total = rs.reduce((s, r) => s + (Number(r.projects_total) || 0), 0);
    return { priced, total, unpriced: Math.max(0, total - priced) };
  });

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      <div class="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white tracking-tight">Manager Performance</h1>
          <p class="text-sm text-[#8593A8] dark:text-gray-400 mt-0.5">
            Monthly profitability per manager — revenue minus ad spend for CP + Hybrid clients.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <select value={month()} onChange={(e) => setMonth(e.target.value)}
            class="px-3 py-2 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-white dark:bg-gray-800 text-[#54657E] dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/30 cursor-pointer">
            <For each={monthOptions()}>{(o) => <option value={o.key}>{o.label}</option>}</For>
          </select>
          <Show when={!data.loading && summary()}>
            <span class={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold ${isLive() ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300" : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"}`}>
              <Show when={isLive()}><span class="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" /></Show>
              {isLive() ? "Live" : "Final"}
            </span>
          </Show>
        </div>
      </div>

      {/* 403 state */}
      <Show when={forbidden()}>
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 py-16 px-6 text-center">
          <div class="mx-auto w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-3">
            <svg class="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">Available to admins only</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">This view is restricted to admin and global-read roles.</p>
        </div>
      </Show>

      <Show when={!forbidden()}>
        {/* One summary card — every headline metric in a single divided panel */}
        <Show
          when={!data.loading && summary()}
          fallback={
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] overflow-hidden mb-6">
              <div class="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-[#E2E8F1] dark:divide-gray-700">
                <For each={Array(4).fill(0)}>
                  {() => (
                    <div class="p-5">
                      <div class="h-3.5 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                      <div class="h-7 w-28 mt-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                    </div>
                  )}
                </For>
              </div>
            </div>
          }
        >
          <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] overflow-hidden mb-6">
            <div class="grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-[#E2E8F1] dark:divide-gray-700">
              <For each={cards()}>
                {(c) => (
                  <div class="p-5">
                    <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">{c.label}</p>
                    <h3 class={`text-2xl font-bold mt-2 ${c.accent}`}>{c.value}</h3>
                  </div>
                )}
              </For>
            </div>
          </div>
        </Show>

        <Show when={isLive() && !data.loading}>
          <p class="text-xs text-gray-400 dark:text-gray-500 mb-4 -mt-2">Live — these figures update through the month and are finalized when the month closes.</p>
        </Show>

        <Show when={data.error}>
          <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4 text-sm text-red-600 dark:text-red-400">Failed to load manager performance. Please try again.</div>
        </Show>

        {/* ── How managers are performing (reference chart design) ── */}
        <Show when={!data.loading && rows().length > 0}>
          <p class="text-[11px] font-bold uppercase tracking-[0.14em] text-[#AC2334] mb-3">
            How managers are performing
          </p>
          <div class="grid grid-cols-1 lg:grid-cols-[1.25fr_1fr] gap-4 mb-6">
            {/* Left — Profit by manager */}
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-6">
              <h3 class="text-base font-bold text-[#14233A] dark:text-white">Profit by manager</h3>
              <p class="text-xs text-[#8593A8] dark:text-gray-400 mt-0.5 mb-3">
                Dashed line marks the average of {money0(avgProfit())} · {rows().length} managers
              </p>
              <div class="relative pt-1">
                <Show when={avgProfit() > 0}>
                  <div
                    class="hidden sm:block absolute top-0 bottom-5 border-l-2 border-dashed border-[#B9C5D6] dark:border-gray-600 pointer-events-none"
                    style={`left: calc(132px + (100% - 248px) * ${Math.max(0, Math.min(1, avgProfit() / maxAbsProfit()))})`}
                  ></div>
                  <span
                    class="hidden sm:block absolute -top-1.5 text-[10px] font-bold uppercase tracking-wide text-[#8593A8] pointer-events-none"
                    style={`left: calc(132px + (100% - 248px) * ${Math.max(0, Math.min(1, avgProfit() / maxAbsProfit()))} + 8px)`}
                  >
                    avg
                  </span>
                </Show>
                <For each={rows()}>
                  {(r) => {
                    const p = parseFloat(r.profit) || 0;
                    const width = (Math.abs(p) / maxAbsProfit()) * 100;
                    const avg = avgProfit();
                    const delta = avg ? Math.round(((p - avg) / Math.abs(avg)) * 100) : 0;
                    return (
                      <div class="grid grid-cols-[1fr_auto] sm:grid-cols-[120px_1fr_104px] gap-x-3 gap-y-1 items-center py-0.5">
                        <div class="text-[13px] leading-tight font-bold text-[#54657E] dark:text-gray-300 text-left sm:text-right truncate sm:row-start-1 sm:col-start-1" title={r.manager_email}>
                          {labelFromEmail(r.manager_email)}
                        </div>
                        <div class="col-span-2 sm:col-span-1 h-1.5 rounded-full bg-[#EDF1F7] dark:bg-gray-900 relative sm:row-start-1 sm:col-start-2">
                          <div
                            class={"absolute inset-y-0 left-0 rounded-full transition-all duration-700 " + (p >= 0 ? "bg-[#15966A]" : "bg-[#AC2334]")}
                            style={`width:${width}%`}
                          ></div>
                        </div>
                        <div class="row-start-1 col-start-2 sm:col-start-3 text-right leading-tight">
                          <span class={`text-[13px] font-bold ${profitTone(p)}`}>{money0(p)}</span>
                          <span class="block text-[9px] font-medium text-[#8593A8]">
                            {delta === 0 ? "at avg" : `${Math.abs(delta)}% ${delta > 0 ? "above" : "below"} avg`}
                          </span>
                        </div>
                      </div>
                    );
                  }}
                </For>
              </div>
            </div>

            {/* Right — Net billable share + pricing coverage */}
            <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-5 sm:p-6">
              <h3 class="text-base font-bold text-[#14233A] dark:text-white">Net billable share by manager</h3>
              <p class="text-xs text-[#8593A8] dark:text-gray-400 mt-0.5 mb-4">
                Share of billable across the roster
              </p>
              <Show
                when={billableShare().total > 0}
                fallback={<p class="text-sm text-[#8593A8] dark:text-gray-400 py-2">No billable in this range.</p>}
              >
                <div class="flex h-4 rounded-full overflow-hidden mb-4">
                  <For each={billableShare().items}>
                    {(item) => <div style={`width:${item.pct}%;background:${item.color}`}></div>}
                  </For>
                </div>
                <For each={billableShare().items}>
                  {(item) => (
                    <div class="flex items-center gap-2.5 py-2 border-b border-[#E2E8F1] dark:border-gray-700 last:border-b-0 text-sm">
                      <span class="w-2.5 h-2.5 rounded flex-none" style={`background:${item.color}`}></span>
                      <span class="flex-1 text-[#54657E] dark:text-gray-300 font-medium truncate">{item.name}</span>
                      <span class="font-bold text-[#14233A] dark:text-white">{money0(item.count)}</span>
                      <span class="w-12 text-right text-xs font-medium text-[#8593A8]">{item.pct.toFixed(1)}%</span>
                    </div>
                  )}
                </For>
              </Show>

              {/* Pricing coverage — analog of campaign health */}
              <div class="mt-5 pt-5 border-t border-[#E2E8F1] dark:border-gray-700">
                <p class="text-xs font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-2.5">
                  Pricing coverage
                </p>
                <div class="flex h-3.5 rounded-full overflow-hidden bg-[#EDF1F7] dark:bg-gray-900">
                  <div
                    class="bg-[#15966A]"
                    style={`width:${coverageTotals().total > 0 ? (coverageTotals().priced / coverageTotals().total) * 100 : 0}%`}
                  ></div>
                  <div class="bg-[#D89A2B] flex-1"></div>
                </div>
                <div class="flex justify-between mt-2 text-xs font-medium text-[#54657E] dark:text-gray-400">
                  <span><b class="text-[#14233A] dark:text-white">{num(coverageTotals().priced)}</b> priced</span>
                  <span><b class="text-[#14233A] dark:text-white">{num(coverageTotals().unpriced)}</b> unpriced</span>
                </div>
              </div>
            </div>
          </div>
        </Show>

        {/* Table — ClientDashboard theme */}
        <div class="overflow-auto max-h-[70vh] bg-gray-50 dark:bg-gray-800 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)]">
          <table class="w-full text-sm table-auto">
            <thead class="bg-[#F8FAFC] dark:bg-gray-800">
              <tr class="[&_th]:p-3 [&_th]:text-xs [&_th]:uppercase [&_th]:tracking-wider [&_th]:font-bold [&_th]:whitespace-nowrap [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-[#F8FAFC] dark:[&_th]:bg-gray-800 [&_th]:shadow-[0_1px_0_#D4DDE9] dark:[&_th]:shadow-[0_1px_0_#374151] text-[#54657E] dark:text-gray-300">
                <th class="w-12 text-center">S.No</th>
                <th class="text-left min-w-[200px]">Manager</th>
                <th class="text-right">Clients</th>
                <th class="text-right">Net Billable</th>
                <th class="text-right">Spend</th>
                <th class="text-right">Profit</th>
                <th class="text-right">Margin</th>
                <th class="text-right">Profit / Client</th>
                <th class="text-center">Coverage</th>
              </tr>
            </thead>
            <Show when={!data.loading} fallback={
              <tbody>
                <For each={Array(8).fill(0)}>{() => <tr class="border-t border-[#E2E8F1] dark:border-gray-700 animate-pulse"><For each={Array(9).fill(0)}>{(_, i) => <td class="p-3"><div class={`h-3 bg-gray-200 dark:bg-gray-700 rounded ${i() === 1 ? "w-44" : "w-16 mx-auto"}`} /></td>}</For></tr>}</For>
              </tbody>
            }>
              <tbody>
                <For each={rows()}>
                  {(r, i) => (
                    <tr class={`border-t border-[#E2E8F1] dark:border-gray-700 transition-colors [&_td]:p-3 [&_td]:whitespace-nowrap hover:bg-[#F3F6FA] dark:hover:bg-gray-800/60 ${i() % 2 === 0 ? "bg-gray-50 dark:bg-gray-800" : "bg-[#FAFBFD] dark:bg-gray-800"}`}>
                      <td class="text-center w-12">
                        <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FBEEF0] dark:bg-red-900/30 text-[#AC2334] dark:text-red-300 text-xs font-bold">{i() + 1}</span>
                      </td>
                      <td class="text-left">
                        <div class="flex items-center gap-2.5">
                          <Avatar name={r.manager_email} />
                          <span class="font-semibold text-[#14233A] dark:text-gray-100">{r.manager_email}</span>
                          <Show when={r.is_finalized === true}>
                            <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">Final</span>
                          </Show>
                        </div>
                      </td>
                      <td class="text-right text-[#54657E] dark:text-gray-300">
                        <span class="font-semibold">{num(assignedCount(r))}</span>
                        <Show when={r.client_count != null}>
                          <span class="text-[#8593A8] dark:text-gray-500 text-xs">{" · "}{num(r.client_count)} active</span>
                        </Show>
                      </td>
                      <td class="text-right text-[#54657E] dark:text-gray-300">{money0(r.net_billable)}</td>
                      <td class="text-right text-[#8593A8] dark:text-gray-400">{money0(r.actual_spend)}</td>
                      <td class={`text-right font-bold ${profitTone(r.profit)}`}>{money0(r.profit)}</td>
                      <td class="text-right text-[#54657E] dark:text-gray-300">{pct(r.margin_pct)}</td>
                      <td class="text-right text-[#54657E] dark:text-gray-300">{money0(r.profit_per_client)}</td>
                      <td class="text-center"><Coverage priced={r.projects_priced} total={r.projects_total} note={r.coverage_note} /></td>
                    </tr>
                  )}
                </For>
                <Show when={rows().length === 0}>
                  <tr><td colspan="9" class="py-16 text-center text-[#8593A8] dark:text-gray-500">No manager activity for this month.</td></tr>
                </Show>
              </tbody>
            </Show>
          </table>
        </div>

        {/* Coverage legend — explains why a negative profit may be a data artifact */}
        <Show when={!data.loading && rows().length > 0}>
          <p class="text-xs text-gray-400 dark:text-gray-500 mt-3 flex items-start gap-1.5">
            <svg class="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            Profit is computed only on priced projects. A negative profit with low coverage is most likely incomplete pricing data, not a real loss — hover the coverage badge for details.
          </p>
        </Show>
      </Show>
    </div>
  );
}
