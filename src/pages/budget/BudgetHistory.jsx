import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { fetchBudgetHistory } from "../../services/budgetHistory";
import Avatar from "../../components/common/Avatar";

// ─────────────────────────────────────────────────────────────────────────────
// BUDGET HISTORY — allocated budget + spend for a specific date (or range).
// Rendered as a tab inside Allowed Budget (admin / global-read only).
//
// TWO HONEST LIMITATIONS, both surfaced in the UI:
//   • Spend is backfilled → available for ANY past date, never carried.
//   • Allocated budget is only captured going forward from the day tracking
//     deployed. For earlier dates it was never recorded, so we show the note the
//     backend supplies — NEVER ₹0, which would read as "nothing allocated".
//   • Allocated budget is a STANDING value → it CARRIES FORWARD. For any date a
//     client's budget = their most recent captured value on/before that date.
//     So "today" shows the standing budget (carried from the last capture), not
//     a blank. When a value is carried, we show a "carried forward from {date}"
//     hint so it's clear it wasn't re-captured that day.
//
// FIELD NAMES DIFFER BY MODE (this is why almost everything branches on mode):
//   Single date → allocated_budget / allocated_carried_forward / allocated_source_date
//                 (overall: total_allocated_budget)
//   Date range  → allocated_daily_rate (standing rate as of range end)
//                 + allocated_total_over_range (sum of each day's carried budget)
//                 + allocated_source_date + days_with_budget
// The endpoint tells us when tracking began (allocated_budget_tracked_from) and
// whether the requested date/range has allocated data (allocated_budget_available_for_range).
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

// ─── Presentation helpers (DISPLAY-ONLY) ──────────────────────────────────────
// Avatars read better off the mailbox name than the whole address.
const mailName = (email) => String(email ?? "").split("@")[0] || "";

// Spend against the allocated figure the same row is showing — single date
// compares the standing budget, a range compares the summed budget over the
// range. Returns null whenever the comparison isn't meaningful (no allocated
// value, or a zero/negative one), so nothing is invented where the data is
// "Not tracked". No fetch, no new field: both numbers are already on the row.
const utilisation = (spend, budget) => {
  const s = parseFloat(spend);
  const b = parseFloat(budget);
  if (!isFinite(s) || !isFinite(b) || b <= 0) return null;
  return (s / b) * 100;
};
const utilTone = (pct) =>
  pct >= 100
    ? { bar: "bg-[#AC2334]", text: "text-[#AC2334] dark:text-red-400" }
    : pct >= 85
      ? { bar: "bg-[#B07A14]", text: "text-[#B07A14] dark:text-amber-300" }
      : { bar: "bg-[#15966A]", text: "text-[#15966A] dark:text-green-400" };

// Subtle "carried forward from {date}" hint — shown when the allocated value in a
// cell wasn't captured on the queried date but is the standing value from an
// earlier date. Renders nothing when the value was captured that day.
function CarriedHint(props) {
  return (
    <Show when={props.carried && props.sourceDate}>
      <span
        class="inline-flex items-center gap-1 mt-1 pl-1.5 pr-2 py-px rounded-full bg-[#F1F4F9] dark:bg-gray-800 text-[10px] font-semibold text-[#8593A8] dark:text-gray-400 whitespace-nowrap"
        title="This is the standing allocated budget — it wasn't re-captured on the queried date, it carried forward from the date shown."
      >
        <svg class="w-2.5 h-2.5 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        </svg>
        carried from {fmtDate(props.sourceDate)}
      </span>
    </Show>
  );
}

const NotTracked = () => (
  <span
    class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-dashed border-[#D4DDE9] dark:border-gray-700 text-[11px] font-semibold text-[#8593A8] dark:text-gray-500"
    title="Allocated budget wasn't captured for this date — see the note above."
  >
    <span class="w-1.5 h-1.5 rounded-full bg-[#C4CDDA] dark:bg-gray-600 flex-none" />
    Not tracked
  </span>
);

// Allocated-budget table cell. Single date → one standing figure. Range → the
// daily rate as the headline plus the total-over-range beneath it (they answer
// different questions: rate = what's the budget; total = budget vs spend for the
// period). Either mode shows the carried-forward hint and falls back to
// "Not tracked" — never ₹0 (the note above the table explains why).
function AllocatedCell(props) {
  const a = () => props.alloc;
  return (
    <Show
      when={a().available && a().shown}
      fallback={<NotTracked />}
    >
      <Show
        when={props.mode === "range"}
        fallback={
          <div>
            <span class="font-semibold text-[#14233A] dark:text-gray-100 tabular-nums">{money2(a().value)}</span>
            <CarriedHint carried={a().carried} sourceDate={a().sourceDate} />
          </div>
        }
      >
        <div>
          <span class="font-semibold text-[#14233A] dark:text-gray-100 tabular-nums">
            {money2(a().dailyRate)}
            <span class="text-[10px] font-medium text-[#8593A8] dark:text-gray-500">/day</span>
          </span>
          <Show when={a().totalOverRange != null}>
            <span class="block text-[11px] font-medium text-[#54657E] dark:text-gray-400 tabular-nums mt-0.5">
              {money2(a().totalOverRange)}
              <Show when={a().daysWithBudget != null}> over {num(a().daysWithBudget)} day{a().daysWithBudget === 1 ? "" : "s"}</Show>
            </span>
          </Show>
          <CarriedHint carried={a().carried} sourceDate={a().sourceDate} />
        </div>
      </Show>
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

  // The queried "as of" date — for a range the standing rate is reported as of
  // the range end, so carry-forward is judged against endDate.
  const queriedDate = () => (mode() === "range" ? endDate() : date());

  // Per-row allocated accessor. Field names differ by mode; normalise here so the
  // table/cell JSX stays mode-agnostic. `carried` is true when the value came
  // from a prior date: single-date the backend flags it directly; range we infer
  // it from allocated_source_date being before the queried (range-end) date.
  const rowAlloc = (r) => {
    if (mode() === "single") {
      return {
        available: allocAvailable(),
        shown: r.allocated_budget != null,
        value: r.allocated_budget,
        carried: r.allocated_carried_forward === true,
        sourceDate: r.allocated_source_date,
      };
    }
    return {
      available: allocAvailable(),
      shown: r.allocated_daily_rate != null,
      dailyRate: r.allocated_daily_rate,
      totalOverRange: r.allocated_total_over_range,
      daysWithBudget: r.days_with_budget,
      sourceDate: r.allocated_source_date,
      carried: !!(r.allocated_source_date && queriedDate() && r.allocated_source_date < queriedDate()),
    };
  };

  // The honest note — prefer the backend's string, fall back to one built from
  // the tracking-start date. Only shown when allocated data isn't available
  // (a pre-tracking date/range, where even carry-forward has nothing to carry).
  const noteText = () => {
    if (allocAvailable()) return null;
    if (meta()?.note) return meta().note;
    const tf = trackedFrom();
    return tf
      ? `Allocated-budget history begins ${fmtDate(tf)} — spend is shown for all dates, but allocated budget wasn't captured before then.`
      : "Allocated budget wasn't captured for this date. Spend is shown; allocated budget is available only from the day tracking began.";
  };

  // Totals for the selected date/range. Spend is always known; allocated only
  // when the flag says it's available. Field shape (and which allocated numbers
  // exist) branches on single vs range — see the header comment.
  const totals = createMemo(() => {
    const single = mode() === "single";
    const o = overall();
    if (o) {
      const spend = parseFloat(o.total_spend) || 0;
      const clients = Number(o.distinct_clients) || 0;
      if (single) {
        return {
          spend, clients,
          alloc: o.total_allocated_budget != null ? parseFloat(o.total_allocated_budget) || 0 : 0,
          allocKnown: o.total_allocated_budget != null && allocAvailable(),
        };
      }
      return {
        spend, clients,
        dailyRate: o.allocated_daily_rate != null ? parseFloat(o.allocated_daily_rate) || 0 : 0,
        totalOverRange: o.allocated_total_over_range != null ? parseFloat(o.allocated_total_over_range) || 0 : 0,
        allocKnown: o.allocated_daily_rate != null && allocAvailable(),
      };
    }
    let spend = 0, alloc = 0, dailyRate = 0, totalOverRange = 0, allocKnown = false, clients = 0;
    for (const r of rows()) {
      spend += parseFloat(r.total_spend) || 0;
      clients += Number(r.distinct_clients) || 0;
      if (!allocAvailable()) continue;
      if (single) {
        if (r.allocated_budget != null) {
          alloc += parseFloat(r.allocated_budget) || 0;
          allocKnown = true;
        }
      } else {
        if (r.allocated_daily_rate != null) {
          dailyRate += parseFloat(r.allocated_daily_rate) || 0;
          allocKnown = true;
        }
        if (r.allocated_total_over_range != null) totalOverRange += parseFloat(r.allocated_total_over_range) || 0;
      }
    }
    return { spend, alloc, dailyRate, totalOverRange, allocKnown, clients };
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
          <div class="relative px-4 py-3 pl-5 rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shadow-[0_1px_2px_rgba(16,29,49,.04)] overflow-hidden">
            <span class="absolute left-0 top-0 bottom-0 w-1 bg-[#AC2334]" />
            <div class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 flex-none text-[#AC2334]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M21 7v6h-6"/></svg>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">Total spend</p>
            </div>
            <p class="text-xl font-bold text-[#14233A] dark:text-white tabular-nums mt-0.5">{moneyWhole(totals().spend)}</p>
          </div>
          <div class="relative px-4 py-3 pl-5 rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shadow-[0_1px_2px_rgba(16,29,49,.04)] overflow-hidden">
            <span class="absolute left-0 top-0 bottom-0 w-1 bg-[#3E6FB0]" />
            <div class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 flex-none text-[#3E6FB0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="13" rx="2.5"/><path d="M2 11h20M6 15h4"/></svg>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                {mode() === "range" ? "Allocated budget / day" : "Total allocated budget"}
              </p>
            </div>
            <Show
              when={totals().allocKnown}
              fallback={<p class="text-sm italic font-semibold text-[#8593A8] dark:text-gray-500 mt-1.5">Not tracked for this date</p>}
            >
              <Show
                when={mode() === "range"}
                fallback={<p class="text-xl font-bold text-[#14233A] dark:text-white tabular-nums mt-0.5">{moneyWhole(totals().alloc)}</p>}
              >
                <p class="text-xl font-bold text-[#14233A] dark:text-white tabular-nums mt-0.5">
                  {moneyWhole(totals().dailyRate)}<span class="text-xs font-semibold text-[#8593A8] dark:text-gray-500">/day</span>
                </p>
                <p class="text-[11px] font-medium text-[#54657E] dark:text-gray-400 tabular-nums mt-0.5">
                  {moneyWhole(totals().totalOverRange)} over range
                </p>
              </Show>
            </Show>
          </div>
          <div class="relative px-4 py-3 pl-5 rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800 shadow-[0_1px_2px_rgba(16,29,49,.04)] overflow-hidden">
            <span class="absolute left-0 top-0 bottom-0 w-1 bg-[#15966A]" />
            <div class="flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5 flex-none text-[#15966A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 20v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 20v-2a4 4 0 00-3-3.87"/></svg>
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                {groupBy() === "manager" ? "Managers" : "Clients"}
              </p>
            </div>
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
          <For each={Array(6).fill(0)}>
            {() => (
              <div class="flex items-center gap-3 px-5 py-3.5">
                <div class="w-7 h-7 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse flex-none" />
                <div class="w-9 h-9 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse flex-none" />
                <div class="h-3 w-44 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
                <div class="ml-auto h-3 w-24 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
                <div class="h-3 w-20 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
              </div>
            )}
          </For>
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
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                {mode() === "range" ? "Allocated budget / day" : "Allocated budget"}
              </p>
              {/* Single date → total_allocated_budget. Range → daily rate headline
                  plus total-over-range beneath (both null for a pre-tracking range). */}
              <Show
                when={mode() === "range"}
                fallback={
                  <Show
                    when={allocAvailable() && overall().total_allocated_budget != null}
                    fallback={<p class="text-base italic font-semibold text-[#8593A8] dark:text-gray-500 mt-2">Not tracked for this date</p>}
                  >
                    <p class="text-2xl font-bold text-[#14233A] dark:text-white tabular-nums mt-1">{money2(overall().total_allocated_budget)}</p>
                  </Show>
                }
              >
                <Show
                  when={allocAvailable() && overall().allocated_daily_rate != null}
                  fallback={<p class="text-base italic font-semibold text-[#8593A8] dark:text-gray-500 mt-2">Not tracked for this range</p>}
                >
                  <p class="text-2xl font-bold text-[#14233A] dark:text-white tabular-nums mt-1">
                    {money2(overall().allocated_daily_rate)}<span class="text-sm font-semibold text-[#8593A8] dark:text-gray-500">/day</span>
                  </p>
                  <Show when={overall().allocated_total_over_range != null}>
                    <p class="text-[12px] font-medium text-[#54657E] dark:text-gray-400 tabular-nums mt-1">
                      {money2(overall().allocated_total_over_range)} over range
                    </p>
                  </Show>
                </Show>
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
          <table class="min-w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr class="bg-[#F8FAFC] dark:bg-gray-800/60 text-[#8593A8] dark:text-gray-400 uppercase text-[10px] font-bold tracking-[0.09em]">
                <th class="pl-5 pr-2 py-3 text-center whitespace-nowrap w-12 border-b border-[#D4DDE9] dark:border-gray-700">#</th>
                <th class="px-3 py-3 text-left whitespace-nowrap min-w-[220px] border-b border-[#D4DDE9] dark:border-gray-700">{groupBy() === "manager" ? "Manager" : "Client"}</th>
                <th class="p-3.5 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">
                  {groupBy() === "manager" ? "Clients" : (mode() === "range" ? "Budget days" : "Days")}
                </th>
                <th class="p-3.5 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">{mode() === "range" ? "Allocated (rate · total)" : "Allocated budget"}</th>
                <th class="pl-3.5 pr-5 py-3 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">Spend</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(r, i) => {
                  // Label the row once — the avatar, the tooltip and the name
                  // cell all key off the same value.
                  const label = () =>
                    groupBy() === "manager"
                      ? (r.manager_email ? mailName(r.manager_email) : "Unassigned")
                      : (r.client_nomen_name ?? `#${r.client_nomen}`);
                  // Budget this row's spend is measured against: the standing
                  // value on a single date, the range sum over a range.
                  const allocBase = () =>
                    !allocAvailable()
                      ? null
                      : mode() === "range"
                        ? r.allocated_total_over_range
                        : r.allocated_budget;
                  const util = () => utilisation(r.total_spend, allocBase());
                  return (
                  <tr class="group bg-gray-50 dark:bg-gray-900 hover:bg-[#F6F9FC] dark:hover:bg-gray-800/60 transition-colors">
                    <td class="relative pl-5 pr-2 py-3 text-center align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                      {/* hover accent rail, pinned to the table's left edge */}
                      <span class="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-8 rounded-r-full bg-transparent group-hover:bg-[#AC2334] transition-colors" />
                      <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#F1F4F9] dark:bg-gray-800 text-[#54657E] dark:text-gray-400 text-[11px] font-extrabold tabular-nums group-hover:bg-[#E7EEF7] dark:group-hover:bg-gray-700 transition-colors">
                        {i() + 1}
                      </span>
                    </td>
                    <td class="px-3 py-3 align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                      <div class="flex items-center gap-3 min-w-0">
                        <Avatar name={label()} size="w-9 h-9" textSize="text-[11px]" class="ring-2 ring-white dark:ring-gray-900 shadow-sm" />
                        <Show
                          when={groupBy() === "manager"}
                          fallback={
                            <span class="font-bold text-[#14233A] dark:text-gray-100 truncate max-w-[280px]" title={label()}>
                              {r.client_nomen_name ?? `#${r.client_nomen}`}
                            </span>
                          }
                        >
                          <Show
                            when={r.manager_email}
                            fallback={<span class="italic font-semibold text-[#8593A8] dark:text-gray-500">Unassigned</span>}
                          >
                            <span class="min-w-0">
                              <span class="block font-bold text-[#14233A] dark:text-gray-100 truncate max-w-[280px] capitalize">{mailName(r.manager_email)}</span>
                              <span class="block text-[11px] text-[#8593A8] dark:text-gray-500 truncate max-w-[280px]" title={r.manager_email}>{r.manager_email}</span>
                            </span>
                          </Show>
                        </Show>
                      </div>
                    </td>
                    <td class="p-3.5 text-right align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                      <Show
                        when={groupBy() === "manager" || mode() === "range"}
                        fallback={<span class="text-[#C4CDDA] dark:text-gray-600 font-semibold">—</span>}
                      >
                        <span class="inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full bg-[#F1F4F9] dark:bg-gray-800 text-[12px] font-bold text-[#54657E] dark:text-gray-300 tabular-nums">
                          {groupBy() === "manager" ? num(r.distinct_clients) : num(r.days_with_budget)}
                        </span>
                      </Show>
                    </td>
                    <td class="p-3.5 text-right align-middle whitespace-nowrap border-b border-[#E2E8F1] dark:border-gray-800">
                      <AllocatedCell mode={mode()} alloc={rowAlloc(r)} />
                    </td>
                    <td class="pl-3.5 pr-5 py-3 text-right align-middle whitespace-nowrap border-b border-[#E2E8F1] dark:border-gray-800">
                      <span class="block font-bold text-[#1A2B45] dark:text-gray-200 tabular-nums">
                        {money2(r.total_spend) ?? "—"}
                      </span>
                      {/* Utilisation meter — spend against this row's allocated
                          budget. Hidden when there's nothing to compare against. */}
                      <Show when={util() != null}>
                        <span class="flex items-center justify-end gap-1.5 mt-1.5">
                          <span class="block w-16 h-1.5 rounded-full bg-[#E7ECF3] dark:bg-gray-700 overflow-hidden">
                            <span
                              class={`block h-full rounded-full ${utilTone(util()).bar}`}
                              style={`width:${Math.max(2, Math.min(100, util()))}%`}
                            />
                          </span>
                          <span class={`text-[10px] font-bold tabular-nums ${utilTone(util()).text}`}>
                            {Math.round(util())}%
                          </span>
                        </span>
                      </Show>
                    </td>
                  </tr>
                  );
                }}
              </For>
              <Show when={rows().length === 0}>
                <tr><td colspan="5" class="py-16 text-center">
                  <span class="inline-flex flex-col items-center gap-2 text-[#8593A8] dark:text-gray-500">
                    <span class="w-11 h-11 rounded-full grid place-items-center bg-[#F1F4F9] dark:bg-gray-800">
                      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2.5"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
                    </span>
                    <span class="text-sm font-semibold">No budget or spend data for {rangeLabel()}.</span>
                  </span>
                </td></tr>
              </Show>
            </tbody>
            <Show when={rows().length > 0}>
              <tfoot>
                <tr class="bg-[#EEF2F7] dark:bg-gray-800">
                  <td class="border-t-2 border-[#D4DDE9] dark:border-gray-700 pl-5 pr-2 py-3.5" />
                  <td class="border-t-2 border-[#D4DDE9] dark:border-gray-700 px-3 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-300">
                    Totals · {num(rows().length)} {groupBy() === "manager" ? "manager" : "client"}{rows().length !== 1 ? "s" : ""}
                  </td>
                  <td class="border-t-2 border-[#D4DDE9] dark:border-gray-700 p-3.5" />
                  <td class="border-t-2 border-[#D4DDE9] dark:border-gray-700 p-3.5 text-right whitespace-nowrap">
                    <Show when={totals().allocKnown} fallback={<span class="text-[11px] italic font-medium text-[#8593A8] dark:text-gray-500">Not tracked</span>}>
                      <Show
                        when={mode() === "range"}
                        fallback={<span class="font-extrabold text-[#14233A] dark:text-gray-100 tabular-nums">{money2(String(totals().alloc))}</span>}
                      >
                        <div>
                          <span class="font-extrabold text-[#14233A] dark:text-gray-100 tabular-nums">
                            {money2(String(totals().dailyRate))}<span class="text-[10px] font-semibold text-[#8593A8] dark:text-gray-500">/day</span>
                          </span>
                          <span class="block text-[11px] font-medium text-[#54657E] dark:text-gray-400 tabular-nums mt-0.5">
                            {money2(String(totals().totalOverRange))} over range
                          </span>
                        </div>
                      </Show>
                    </Show>
                  </td>
                  <td class="border-t-2 border-[#D4DDE9] dark:border-gray-700 pl-3.5 pr-5 py-3.5 text-right font-extrabold text-[#14233A] dark:text-gray-100 tabular-nums whitespace-nowrap">{money2(String(totals().spend))}</td>
                </tr>
              </tfoot>
            </Show>
          </table>
        </div>
      </Show>
    </div>
  );
}
