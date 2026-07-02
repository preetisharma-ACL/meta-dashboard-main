import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { fetchBudgetHistory } from "../../services/budgetHistory";

// ─────────────────────────────────────────────────────────────────────────────
// BUDGET HISTORY — allocated budget + spend for a specific date (or range).
// Rendered as a tab inside Allowed Budget (admin / global-read only).
//
// THE HONEST LIMITATION (front and centre in the UI):
//   • Spend is backfilled → available for ANY past date.
//   • Allocated budget is only captured going forward from the day tracking
//     deployed. For earlier dates it was never recorded, so we show the note the
//     backend supplies — NEVER ₹0, which would read as "nothing allocated".
// The endpoint tells us when tracking began (allocated_budget_tracked_from) and
// whether the requested date has allocated data (allocated_budget_available_for_range).
// ─────────────────────────────────────────────────────────────────────────────

// ─── Money / null discipline (matches Allowed Budget) ─────────────────────────
const money2 = (v) => {
  if (v == null) return null;
  const n = parseFloat(v);
  if (!isFinite(n)) return null;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const moneyWhole = (v) => {
  if (v == null) return null;
  const n = parseFloat(v);
  if (!isFinite(n)) return null;
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
};
const num = (v) => (Number(v) || 0).toLocaleString("en-IN");
const todayISO = () => new Date().toISOString().split("T")[0];
const fmtDate = (iso) =>
  !iso ? "—" : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const GROUP_BYS = [
  { k: "client", l: "By client" },
  { k: "manager", l: "By manager" },
  { k: "overall", l: "Overall" },
];

// Allocated-budget cell. When allocated data isn't available for the row's date
// range, we render a muted "Not tracked" — never ₹0 (the note above the table
// explains why). `available` is the meta flag; `tracked` is the per-row flag
// (client grouping); either falsy → not tracked.
function AllocatedValue(props) {
  const shown = () =>
    props.available && props.tracked !== false && props.value != null;
  return (
    <Show
      when={shown()}
      fallback={
        <span
          class="text-[11px] italic font-medium text-[#8593A8] dark:text-gray-500"
          title="Allocated budget wasn't captured for this date — see the note above."
        >
          Not tracked
        </span>
      }
    >
      <span class="font-semibold text-[#14233A] dark:text-gray-100 tabular-nums">{money2(props.value)}</span>
    </Show>
  );
}

export default function BudgetHistory(props) {
  const [mode, setMode] = createSignal("single"); // single | range
  const [date, setDate] = createSignal(todayISO());
  const [startDate, setStartDate] = createSignal(todayISO());
  const [endDate, setEndDate] = createSignal(todayISO());
  const [groupBy, setGroupBy] = createSignal("client");

  // The page-level CLIENT TYPE chips (CPL / Hybrid / Retainer, CPL+Hybrid by
  // default) scope this tab too — the parent passes the current selection. The
  // backend defaults to cpl,hybrid so the allocated totals reconcile with the
  // Allowed Budget page; toggling Retainer on adds the client-funded budgets.
  const clientTypes = () =>
    Array.isArray(props.clientTypes) ? props.clientTypes : [];

  // Reactive param set — a new object only when a control actually changes, so
  // the resource refetches exactly once per change. Toggling a client-type chip
  // changes props.clientTypes, which refetches the re-scoped dataset.
  const params = createMemo(() => ({
    ...(mode() === "range"
      ? { start_date: startDate(), end_date: endDate() }
      : { date: date() }),
    groupBy: groupBy(),
    clientTypes: clientTypes(),
  }));

  const [res] = createResource(params, async (p) =>
    fetchBudgetHistory({
      date: p.date,
      startDate: p.start_date,
      endDate: p.end_date,
      groupBy: p.groupBy,
      clientTypes: p.clientTypes,
    }),
  );

  const meta = () => res()?.meta ?? null;
  const rows = () => (Array.isArray(res()?.data) ? res().data : []);
  const overall = () => {
    const d = res()?.data;
    return d && !Array.isArray(d) ? d : null;
  };
  const allocAvailable = () => meta()?.allocated_budget_available_for_range === true;
  const trackedFrom = () => meta()?.allocated_budget_tracked_from;

  // The honest note — prefer the backend's string, fall back to one built from
  // the tracking-start date. Only shown when allocated data isn't available.
  const noteText = () => {
    if (allocAvailable()) return null;
    if (meta()?.note) return meta().note;
    const tf = trackedFrom();
    return tf
      ? `Allocated-budget history begins ${fmtDate(tf)} — spend is shown for all dates, but allocated budget wasn't captured before then.`
      : "Allocated budget wasn't captured for this date. Spend is shown; allocated budget is available only from the day tracking began.";
  };

  // Totals for the selected date/range, summed from the visible rows (spend is
  // always known; allocated only when the flag says it's available).
  const totals = createMemo(() => {
    const o = overall();
    if (o) {
      return {
        spend: parseFloat(o.total_spend) || 0,
        alloc: o.total_allocated_budget != null ? parseFloat(o.total_allocated_budget) || 0 : 0,
        allocKnown: o.total_allocated_budget != null && allocAvailable(),
        clients: Number(o.distinct_clients) || 0,
      };
    }
    let spend = 0, alloc = 0, allocKnown = false, clients = 0;
    for (const r of rows()) {
      spend += parseFloat(r.total_spend) || 0;
      if (allocAvailable() && r.total_allocated_budget != null) {
        alloc += parseFloat(r.total_allocated_budget) || 0;
        allocKnown = true;
      }
      clients += Number(r.distinct_clients) || 0;
    }
    return { spend, alloc, allocKnown, clients };
  });

  const rangeLabel = () =>
    mode() === "range" ? `${fmtDate(startDate())} → ${fmtDate(endDate())}` : fmtDate(date());

  const inputClass =
    "px-3 py-2 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 text-[#1A2B45] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] cursor-pointer";

  return (
    <div>
      {/* ── Controls: date/range mode, date pickers, group-by ── */}
      <div class="bg-gray-50 dark:bg-gray-900 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-3.5 mb-4 flex flex-wrap items-end gap-4">
        {/* Single / range toggle */}
        <div>
          <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5">Period</p>
          <div class="inline-flex p-1 bg-[#F1F4F9] dark:bg-gray-800 rounded-xl">
            <For each={[{ k: "single", l: "Single date" }, { k: "range", l: "Date range" }]}>
              {(o) => (
                <button
                  onClick={() => setMode(o.k)}
                  class={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    mode() === o.k
                      ? "bg-[#14233A] text-white shadow-sm"
                      : "text-[#54657E] dark:text-gray-400 hover:text-[#14233A] dark:hover:text-gray-300"
                  }`}
                >
                  {o.l}
                </button>
              )}
            </For>
          </div>
        </div>

        {/* Date pickers */}
        <Show
          when={mode() === "range"}
          fallback={
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5">Date</p>
              <input type="date" max={todayISO()} value={date()} onInput={(e) => setDate(e.target.value)} class={inputClass} />
            </div>
          }
        >
          <div>
            <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5">From</p>
            <input type="date" max={endDate() || todayISO()} value={startDate()} onInput={(e) => setStartDate(e.target.value)} class={inputClass} />
          </div>
          <div>
            <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5">To</p>
            <input type="date" min={startDate()} max={todayISO()} value={endDate()} onInput={(e) => setEndDate(e.target.value)} class={inputClass} />
          </div>
        </Show>

        {/* Group-by */}
        <div>
          <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mb-1.5">Group by</p>
          <div class="inline-flex p-1 bg-[#F1F4F9] dark:bg-gray-800 rounded-xl">
            <For each={GROUP_BYS}>
              {(o) => (
                <button
                  onClick={() => setGroupBy(o.k)}
                  class={`px-3.5 py-1.5 rounded-lg text-sm font-semibold transition-all ${
                    groupBy() === o.k
                      ? "bg-[#14233A] text-white shadow-sm"
                      : "text-[#54657E] dark:text-gray-400 hover:text-[#14233A] dark:hover:text-gray-300"
                  }`}
                >
                  {o.l}
                </button>
              )}
            </For>
          </div>
        </div>

        <span class="ml-auto text-sm text-[#8593A8] dark:text-gray-500 whitespace-nowrap self-center">{rangeLabel()}</span>
      </div>

      {/* ── Honest note — allocated budget not tracked for this date/range ── */}
      <Show when={!res.loading && !res.error && noteText()}>
        <div class="flex items-start gap-2.5 bg-[#EEF4FB] dark:bg-blue-900/20 border border-[#CFE0F2] dark:border-blue-800/60 rounded-xl p-3.5 mb-4">
          <svg class="w-5 h-5 mt-0.5 flex-shrink-0 text-[#3E6FB0] dark:text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
          </svg>
          <p class="text-[13px] text-[#2C4B72] dark:text-blue-200 leading-relaxed">{noteText()}</p>
        </div>
      </Show>

      {/* ── Totals band ── */}
      <Show when={!res.loading && !res.error && (rows().length > 0 || overall())}>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
          <div class="px-4 py-3 rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Total spend</p>
            <p class="text-xl font-bold text-[#14233A] dark:text-white tabular-nums mt-0.5">{moneyWhole(totals().spend)}</p>
          </div>
          <div class="px-4 py-3 rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Total allocated budget</p>
            <Show
              when={totals().allocKnown}
              fallback={<p class="text-sm italic font-semibold text-[#8593A8] dark:text-gray-500 mt-1.5">Not tracked for this date</p>}
            >
              <p class="text-xl font-bold text-[#14233A] dark:text-white tabular-nums mt-0.5">{moneyWhole(totals().alloc)}</p>
            </Show>
          </div>
          <div class="px-4 py-3 rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800">
            <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
              {groupBy() === "manager" ? "Managers" : "Clients"}
            </p>
            <p class="text-xl font-bold text-[#14233A] dark:text-white tabular-nums mt-0.5">
              {num(groupBy() === "manager" ? rows().length : totals().clients || rows().length)}
            </p>
          </div>
        </div>
      </Show>

      {/* ── Error ── */}
      <Show when={res.error}>
        <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">
          Failed to load budget history. Please try again.
        </div>
      </Show>

      {/* ── Loading ── */}
      <Show when={res.loading}>
        <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 divide-y divide-[#E2E8F1] dark:divide-gray-800 overflow-hidden">
          <For each={Array(6).fill(0)}>{() => <div class="h-14 animate-pulse bg-[#FAFBFD] dark:bg-gray-800/40" />}</For>
        </div>
      </Show>

      {/* ── OVERALL view ── */}
      <Show when={!res.loading && !res.error && groupBy() === "overall" && overall()}>
        <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-6">
          <p class="text-sm font-semibold text-[#14233A] dark:text-gray-100 mb-4">Overall — {rangeLabel()}</p>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Spend</p>
              <p class="text-2xl font-bold text-[#14233A] dark:text-white tabular-nums mt-1">{money2(overall().total_spend) ?? "—"}</p>
            </div>
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Allocated budget</p>
              <Show
                when={allocAvailable() && overall().total_allocated_budget != null}
                fallback={<p class="text-base italic font-semibold text-[#8593A8] dark:text-gray-500 mt-2">Not tracked for this date</p>}
              >
                <p class="text-2xl font-bold text-[#14233A] dark:text-white tabular-nums mt-1">{money2(overall().total_allocated_budget)}</p>
              </Show>
            </div>
            <div>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Distinct clients</p>
              <p class="text-2xl font-bold text-[#14233A] dark:text-white tabular-nums mt-1">{num(overall().distinct_clients)}</p>
            </div>
          </div>
        </div>
      </Show>

      {/* ── CLIENT / MANAGER table ── */}
      <Show when={!res.loading && !res.error && groupBy() !== "overall"}>
        <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] overflow-x-auto">
          <table class="min-w-full text-sm">
            <thead>
              <tr class="border-b border-[#D4DDE9] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800/60 text-[#54657E] dark:text-gray-400 uppercase text-xs font-bold tracking-wider">
                <th class="p-3.5 text-left whitespace-nowrap min-w-[220px]">{groupBy() === "manager" ? "Manager" : "Client"}</th>
                <th class="p-3.5 text-right whitespace-nowrap">{groupBy() === "manager" ? "Clients" : "Days"}</th>
                <th class="p-3.5 text-right whitespace-nowrap">Allocated budget</th>
                <th class="p-3.5 text-right whitespace-nowrap">Spend</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(r, i) => (
                  <tr class={`border-b border-[#E2E8F1] dark:border-gray-800 ${i() % 2 === 0 ? "bg-gray-50 dark:bg-gray-900" : "bg-[#FAFBFD] dark:bg-gray-800/30"}`}>
                    <td class="p-3.5 font-semibold text-[#14233A] dark:text-gray-100">
                      <Show
                        when={groupBy() === "manager"}
                        fallback={r.client_nomen_name ?? `#${r.client_nomen}`}
                      >
                        {r.manager_email ?? <span class="italic font-medium text-[#8593A8] dark:text-gray-500">Unassigned</span>}
                      </Show>
                    </td>
                    <td class="p-3.5 text-right text-[#54657E] dark:text-gray-300 tabular-nums">
                      {num(groupBy() === "manager" ? r.distinct_clients : r.days_in_range)}
                    </td>
                    <td class="p-3.5 text-right whitespace-nowrap">
                      <AllocatedValue value={r.total_allocated_budget} available={allocAvailable()} tracked={r.allocated_budget_tracked} />
                    </td>
                    <td class="p-3.5 text-right font-semibold text-[#1A2B45] dark:text-gray-200 tabular-nums whitespace-nowrap">
                      {money2(r.total_spend) ?? "—"}
                    </td>
                  </tr>
                )}
              </For>
              <Show when={rows().length === 0}>
                <tr><td colspan="4" class="py-16 text-center text-[#8593A8] dark:text-gray-500">No budget or spend data for {rangeLabel()}.</td></tr>
              </Show>
            </tbody>
            <Show when={rows().length > 0}>
              <tfoot>
                <tr class="border-t-2 border-[#D4DDE9] dark:border-gray-700 bg-[#EEF2F7] dark:bg-gray-800">
                  <td class="p-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-300">
                    Totals · {num(rows().length)} {groupBy() === "manager" ? "manager" : "client"}{rows().length !== 1 ? "s" : ""}
                  </td>
                  <td class="p-3.5" />
                  <td class="p-3.5 text-right whitespace-nowrap">
                    <Show when={totals().allocKnown} fallback={<span class="text-[11px] italic font-medium text-[#8593A8] dark:text-gray-500">Not tracked</span>}>
                      <span class="font-extrabold text-[#14233A] dark:text-gray-100 tabular-nums">{money2(String(totals().alloc))}</span>
                    </Show>
                  </td>
                  <td class="p-3.5 text-right font-extrabold text-[#14233A] dark:text-gray-100 tabular-nums whitespace-nowrap">{money2(String(totals().spend))}</td>
                </tr>
              </tfoot>
            </Show>
          </table>
        </div>
      </Show>
    </div>
  );
}
