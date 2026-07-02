import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { fetchManagerPerformance } from "../../services/performance";

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

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      <div class="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">Manager Performance</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Monthly profitability per manager — revenue minus ad spend for CP + Hybrid clients.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <select value={month()} onChange={(e) => setMonth(e.target.value)}
            class="px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-400 cursor-pointer">
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
        {/* Summary band */}
        <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Show when={!data.loading && summary()} fallback={
            <For each={Array(4).fill(0)}>{() => <div class="px-5 py-6 rounded-xl shadow-sm border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"><div class="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /><div class="h-7 w-28 mt-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" /></div>}</For>
          }>
            <For each={cards()}>
              {(c) => (
                <div class={`px-5 py-6 rounded-xl shadow-sm border ${c.bg}`}>
                  <p class="text-sm text-gray-500 dark:text-gray-400">{c.label}</p>
                  <h3 class={`text-2xl font-semibold mt-2 ${c.accent}`}>{c.value}</h3>
                </div>
              )}
            </For>
          </Show>
        </div>

        <Show when={isLive() && !data.loading}>
          <p class="text-xs text-gray-400 dark:text-gray-500 mb-4 -mt-2">Live — these figures update through the month and are finalized when the month closes.</p>
        </Show>

        <Show when={data.error}>
          <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4 text-sm text-red-600 dark:text-red-400">Failed to load manager performance. Please try again.</div>
        </Show>

        {/* Profit-by-manager bar chart */}
        <Show when={!data.loading && rows().length > 0}>
          <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-6">
            <h3 class="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">Profit by manager</h3>
            <div class="space-y-1.5">
              <For each={rows()}>
                {(r) => {
                  const p = parseFloat(r.profit) || 0;
                  const w = `${(Math.abs(p) / maxAbsProfit()) * 100}%`;
                  return (
                    <div class="flex items-center gap-2 text-xs">
                      <span class="w-40 truncate text-gray-500 dark:text-gray-400" title={r.manager_email}>{r.manager_email}</span>
                      <div class="flex-1 h-4 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
                        <div class={`h-full rounded ${p >= 0 ? "bg-green-400 dark:bg-green-500/70" : "bg-red-400 dark:bg-red-500/70"}`} style={{ width: w }} />
                      </div>
                      <span class={`w-24 text-right font-medium ${profitTone(p)}`}>{money0(p)}</span>
                    </div>
                  );
                }}
              </For>
            </div>
          </div>
        </Show>

        {/* Table */}
        <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider">
                <th class="p-3 text-left whitespace-nowrap min-w-[200px]">Manager</th>
                <th class="p-3 text-right whitespace-nowrap">Clients</th>
                <th class="p-3 text-right whitespace-nowrap">Net Billable</th>
                <th class="p-3 text-right whitespace-nowrap">Spend</th>
                <th class="p-3 text-right whitespace-nowrap">Profit</th>
                <th class="p-3 text-right whitespace-nowrap">Margin</th>
                <th class="p-3 text-right whitespace-nowrap">Profit / Client</th>
                <th class="p-3 text-center whitespace-nowrap">Coverage</th>
              </tr>
            </thead>
            <Show when={!data.loading} fallback={
              <tbody>
                <For each={Array(8).fill(0)}>{() => <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse"><For each={Array(8).fill(0)}>{(_, i) => <td class="p-3"><div class={`h-3 bg-gray-200 dark:bg-gray-700 rounded ${i() === 0 ? "w-44" : "w-16 ml-auto"}`} /></td>}</For></tr>}</For>
              </tbody>
            }>
              <tbody>
                <For each={rows()}>
                  {(r, i) => (
                    <tr class={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-purple-50/40 dark:hover:bg-gray-800/40 ${i() % 2 === 0 ? "bg-white dark:bg-gray-900" : "bg-gray-50/60 dark:bg-gray-800/30"}`}>
                      <td class="p-3">
                        <div class="flex items-center gap-2">
                          <span class="font-medium text-gray-800 dark:text-gray-100">{r.manager_email}</span>
                          <Show when={r.is_finalized === true}>
                            <span class="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">Final</span>
                          </Show>
                        </div>
                      </td>
                      <td class="p-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
                        <span class="font-medium">{num(assignedCount(r))}</span>
                        <Show when={r.client_count != null}>
                          <span class="text-gray-400 dark:text-gray-500 text-xs">{" · "}{num(r.client_count)} active</span>
                        </Show>
                      </td>
                      <td class="p-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">{money0(r.net_billable)}</td>
                      <td class="p-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">{money0(r.actual_spend)}</td>
                      <td class={`p-3 text-right font-bold whitespace-nowrap ${profitTone(r.profit)}`}>{money0(r.profit)}</td>
                      <td class="p-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">{pct(r.margin_pct)}</td>
                      <td class="p-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">{money0(r.profit_per_client)}</td>
                      <td class="p-3 text-center"><Coverage priced={r.projects_priced} total={r.projects_total} note={r.coverage_note} /></td>
                    </tr>
                  )}
                </For>
                <Show when={rows().length === 0}>
                  <tr><td colspan="8" class="py-16 text-center text-gray-400 dark:text-gray-500">No manager activity for this month.</td></tr>
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
