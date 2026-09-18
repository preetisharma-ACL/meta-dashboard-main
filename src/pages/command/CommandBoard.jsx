import {
  createResource,
  createSignal,
  createMemo,
  createEffect,
  onCleanup,
  For,
  Show,
  Switch,
  Match,
} from "solid-js";
import { useNavigate } from "@solidjs/router";
import { fetchCommandBoard, isRangeWarm } from "../../services/command";
import {
  PRESETS,
  DEFAULT_PRESET,
  CLIENT_TYPES,
  SORTABLE,
  PREMIUM,
  premiumSpendState,
  isConfigGap,
  balanceSourceNote,
  isUnrecorded,
  humanise,
  asList,
  rangeKeyOf,
  inr,
  inrRate,
  inrCompact,
  count,
  isoDate,
  DASH,
} from "../../services/commandRules";
import Avatar from "../../components/common/Avatar";
import RowsPerPageSelect from "../../components/common/RowsPerPageSelect";

// ─── Command ──────────────────────────────────────────────────────────────────
// One row per client, every operational number the desk works from in the
// morning: what's live, what it's spending, what it's returning, what's owed and
// who owns it. Admin + coordination; the endpoint 403s everyone else.
//
// SORT, FILTER, SEARCH AND PAGE ARE ALL SERVER PARAMS. The response is one page
// of a larger set, so narrowing the rows in hand would search a fraction of the
// list while the header claimed to describe all of it. The single exception is
// the config-gap toggle, which has no server param — it is labelled with what it
// actually covers, every time, rather than left to read as the whole book.
//
// THE FLAG. premium_spend arrives null for two unrelated reasons and this page
// exists partly to tell them apart: a retainer has no configs by design and gets
// a neutral "n/a"; a CPL or hybrid client with no config covering those days is
// being delivered leads nobody has priced, and gets a warning. See
// premiumSpendState() — the distinction lives there, not in this file.

// A client route is "/:client-nomen-name" — nomen name lowercased, whitespace
// runs collapsed to "-" (matches SalesClients and ClientDashboard's slugify).
const slugify = (name) =>
  String(name ?? "")
    .toLowerCase()
    .replace(/\s+/g, "-");

const TYPE_CHIP = {
  hybrid:
    "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300",
  cpl: "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300",
  retainer:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};
const typeLabel = (t) =>
  t === "cpl" ? "CPL" : t ? `${t[0].toUpperCase()}${t.slice(1)}` : DASH;

const TH =
  "p-3 text-left text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap";

// Columns the reader scans for size read better right-aligned and tabular.
const NUM = "p-3 text-right tabular-nums whitespace-nowrap";

const COLS = 13;

// A value the records simply don't carry yet. Rendered as absence, not as text:
// sales person is empty for 79 of 186 clients and lead destination for all 186,
// and both are facts about the records rather than failures of the page.
function Missing(props) {
  return (
    <span class="text-[12px] italic text-gray-300 dark:text-gray-600">
      {props.children ?? "Not recorded"}
    </span>
  );
}

export default function CommandBoard() {
  const navigate = useNavigate();

  // ── Filters (every one of them a server param) ─────────────────────────────
  const [preset, setPreset] = createSignal(DEFAULT_PRESET);
  const [start, setStart] = createSignal("");
  const [end, setEnd] = createSignal("");
  const [type, setType] = createSignal(null);
  const [query, setQuery] = createSignal(""); // what's in the box
  const [q, setQ] = createSignal(""); // what's been sent, debounced
  // Opens on the biggest daily budgets: a command screen is read top-down and
  // the largest live spend is the thing worth seeing without scrolling.
  const [sort, setSort] = createSignal("budget");
  const [dir, setDir] = createSignal("desc");
  const [page, setPage] = createSignal(1);
  const [pageSize, setPageSize] = createSignal(100);

  // ── View-only state ────────────────────────────────────────────────────────
  const [gapOnly, setGapOnly] = createSignal(false);
  const [expanded, setExpanded] = createSignal(null);

  // Searching is a server round-trip, so it waits for a pause in typing rather
  // than firing a request per keystroke.
  let qTimer;
  const onQueryInput = (v) => {
    setQuery(v);
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      setPage(1);
      setQ(v.trim());
    }, 350);
  };
  onCleanup(() => clearTimeout(qTimer));

  // A half-filled custom range is not a range: nothing is asked for until both
  // ends exist. Declared before everything that reads it — `rows()` below runs
  // inside a createMemo that evaluates eagerly, so a later `const` would be in
  // its temporal dead zone at that moment.
  const parked = () => preset() === "custom" && !(start() && end());

  // Returning false parks the resource rather than asking the server to guess
  // at the missing end of the range.
  const params = createMemo(() => {
    if (parked()) return false;
    return {
      preset: preset(),
      start: start(),
      end: end(),
      type: type(),
      q: q(),
      sort: sort(),
      dir: dir(),
      page: page(),
      pageSize: pageSize(),
    };
  });

  const [board, { refetch }] = createResource(params, fetchCommandBoard);

  // `latest` keeps the previous page on screen while the next one loads. Every
  // call after the first for a range is ~0.1s, and blanking the table for it
  // would flash harder than the wait it covers.
  //
  // Parked is the exception: the resource holds whatever range was loaded last,
  // and leaving those rows up under a chip that now reads "Custom" would put
  // one range's numbers under another range's label.
  const data = () => (board.error || parked() ? null : board.latest);
  const rows = () => data()?.rows ?? [];
  const pagination = () => data()?.pagination ?? {};
  const totals = () => data()?.totals ?? {};
  const firstLoad = () => board.loading && !board.latest;

  // ── How long this is taking, and what to say about it ──────────────────────
  // A cold range takes ~14s. Elapsed time is the honest signal; the warmth guess
  // only decides what we say in the first couple of seconds, so that a cached
  // range doesn't get warned about a wait that isn't coming.
  const [elapsed, setElapsed] = createSignal(0);
  createEffect(() => {
    if (!board.loading) {
      setElapsed(0);
      return;
    }
    const t0 = Date.now();
    const id = setInterval(
      () => setElapsed(Math.round((Date.now() - t0) / 1000)),
      250,
    );
    onCleanup(() => clearInterval(id));
  });

  const coldRange = () =>
    !isRangeWarm(rangeKeyOf({ preset: preset(), start: start(), end: end() }));
  const expectSlow = () => coldRange() || elapsed() >= 3;

  // ── Custom range ───────────────────────────────────────────────────────────
  const today = isoDate(new Date());
  const pickPreset = (key) => {
    setPage(1);
    setPreset(key);
    if (key !== "custom") {
      setStart("");
      setEnd("");
    }
  };
  // Keeping start <= end here rather than letting the server decide what an
  // inverted range means.
  const onStart = (v) => {
    setPage(1);
    setStart(v);
    if (end() && v > end()) setEnd(v);
  };
  const onEnd = (v) => {
    setPage(1);
    setEnd(v);
    if (start() && v < start()) setStart(v);
  };

  const pickType = (key) => {
    setPage(1);
    setType((cur) => (cur === key ? null : key));
  };

  // ── Sorting (server-side) ──────────────────────────────────────────────────
  // Only the seven columns the endpoint can order by get a control. The rest are
  // plain headers: a click that reordered the 100 rows in hand would look like
  // an ordering of all 186.
  const toggleSort = (col) => {
    const key = SORTABLE[col];
    if (!key) return;
    setPage(1);
    if (sort() === key) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
      return;
    }
    setSort(key);
    setDir(col === "client" ? "asc" : "desc");
  };

  const sortIcon = (col) => {
    const key = SORTABLE[col];
    if (sort() !== key) return "⇅";
    return dir() === "asc" ? "↑" : "↓";
  };

  // ── The config gap ─────────────────────────────────────────────────────────
  // Counted over the rows in hand, because there is no server param for it. When
  // the whole filtered set happens to fit on one page — 186 clients at 200 per
  // page does — the count IS the whole set, and the caption says so. Otherwise
  // it says "on this page", so the number is never read as a total it isn't.
  const gapRows = createMemo(() => rows().filter(isConfigGap));
  const wholeSetInView = () => {
    const t = pagination().total;
    return t != null && rows().length >= t;
  };
  const gapCaption = () =>
    wholeSetInView()
      ? `${gapRows().length} of ${pagination().total} clients`
      : `${gapRows().length} on this page`;

  const visible = createMemo(() => (gapOnly() ? gapRows() : rows()));

  const gotoPage = (n) => {
    const tp = pagination().totalPages;
    const target = Math.max(1, n);
    setPage(tp != null && tp >= 1 ? Math.min(target, tp) : target);
  };

  const rangeStart = () =>
    rows().length === 0 ? 0 : (page() - 1) * (pagination().pageSize || 0) + 1;
  const rangeEnd = () => rangeStart() + rows().length - (rows().length ? 1 : 0);

  const rowKey = (r, i) => r.client ?? r.email ?? `row-${i}`;
  const toggleExpand = (key) => setExpanded((c) => (c === key ? null : key));

  // The date range narrows the FIGURES, not the roster — a client with no spend
  // in the window still has a row. So only type and search can empty the table,
  // and only they belong in the "nothing matched" wording.
  const hasFilters = () => !!(type() || q());

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 sm:p-6 lg:p-8">
      {/* ══ Header ══ */}
      <div class="flex items-start justify-between gap-3 flex-wrap mb-6">
        <div>
          <h1 class="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7E1522] via-[#AC2334] via-70% to-[#C4802B] text-white shadow-[0_2px_8px_rgba(126,21,34,.32)]">
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M3 12h4l3 8 4-16 3 8h4" />
              </svg>
            </span>
            <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
              Command
            </span>
          </h1>
          <p class="pl-[46px] text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Every client on one page: what's live, what it spends, what it
            returns, what's owed and who owns it.
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={board.loading}
          class="px-3.5 py-2 text-sm font-semibold rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-[#AC2334]/40 disabled:opacity-50 transition"
        >
          {board.loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {/* ══ Date range ══ */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4">
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] font-bold uppercase tracking-wider text-gray-400 mr-1">
            Range
          </span>
          <For each={PRESETS}>
            {(p) => (
              <button
                type="button"
                onClick={() => pickPreset(p.key)}
                aria-pressed={preset() === p.key}
                class={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
                  preset() === p.key
                    ? "bg-[#14233A] text-white border-[#14233A]"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
                }`}
              >
                {p.label}
              </button>
            )}
          </For>
          <button
            type="button"
            onClick={() => pickPreset("custom")}
            aria-pressed={preset() === "custom"}
            class={`px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors whitespace-nowrap ${
              preset() === "custom"
                ? "bg-[#14233A] text-white border-[#14233A]"
                : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
            }`}
          >
            Custom
          </button>

          <Show when={preset() === "custom"}>
            <div class="flex items-center gap-2 ml-1">
              <input
                type="date"
                max={today}
                value={start()}
                onInput={(e) => onStart(e.currentTarget.value)}
                class="px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
              <span class="text-gray-400">→</span>
              <input
                type="date"
                max={today}
                value={end()}
                onInput={(e) => onEnd(e.currentTarget.value)}
                class="px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
              />
            </div>
          </Show>

          <span class="ml-auto text-[12px] text-gray-400 dark:text-gray-500">
            Leads, spend, CPL and daily budget only — the balance column is
            always the current month.
          </span>
        </div>

        <Show when={preset() === "custom" && !(start() && end())}>
          <p class="mt-2.5 text-[12px] text-[#8A6410] dark:text-yellow-300">
            Pick both a start and an end date — a one-sided range isn't sent.
          </p>
        </Show>
      </div>

      {/* ══ Totals ══ */}
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <Tile label="Clients" value={count(totals().clients)} />
        <Tile label="Leads" value={count(totals().leads)} />
        <Tile label="Raw spend" value={inrCompact(totals().raw_spend)} />
        <Tile
          label="Premium spend"
          value={inrCompact(totals().premium_spend)}
          note="Only the clients that have one — retainers and unpriced days aren't in it."
        />
        <Tile label="Daily budget" value={inrCompact(totals().daily_budget)} />
      </div>

      {/* ══ Search · type · config gap ══ */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex w-full sm:w-[340px]">
          <svg
            class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
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
            placeholder="Client, email, sales person or CM…"
            value={query()}
            onInput={(e) => onQueryInput(e.currentTarget.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>

        <div class="flex items-center gap-1.5">
          <For each={CLIENT_TYPES}>
            {(t) => (
              <button
                type="button"
                onClick={() => pickType(t.key)}
                aria-pressed={type() === t.key}
                class={`px-3.5 py-2 rounded-lg text-[13px] font-semibold border transition-colors ${
                  type() === t.key
                    ? "bg-[#14233A] text-white border-[#14233A]"
                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#14233A]/40"
                }`}
              >
                {t.label}
              </button>
            )}
          </For>
        </div>

        {/* The flag, as a filter. Its label always names the set it counted —
            there is no server param for the gap, so this narrows the page in
            hand and must never read as a sweep of the whole list. */}
        <button
          type="button"
          onClick={() => setGapOnly((v) => !v)}
          aria-pressed={gapOnly()}
          disabled={gapRows().length === 0 && !gapOnly()}
          title="CPL and hybrid clients with no display config covering these dates — leads are being delivered at a price nobody has set"
          class={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg border transition-colors disabled:opacity-40 disabled:cursor-default ${
            gapOnly()
              ? "bg-[#B07A14] text-white border-[#B07A14]"
              : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#B07A14]/50"
          }`}
        >
          <svg
            class="w-4 h-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
          No pricing config
          <span
            class={`text-[11px] font-bold tabular-nums ${
              gapOnly() ? "text-white/75" : "text-gray-400"
            }`}
          >
            ({gapCaption()})
          </span>
        </button>

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {visible().length} shown
        </span>
      </div>

      <Show when={gapOnly() && !wholeSetInView()}>
        <div class="mb-4 px-4 py-2.5 rounded-lg bg-[#FBF3E2] dark:bg-yellow-900/15 border border-[#B07A14]/30 text-[13px] text-[#8A6410] dark:text-yellow-200">
          Showing the {gapRows().length} unpriced clients{" "}
          <b class="font-semibold">on this page</b> — the gap has no server
          filter yet. Set the page size to 200 to sweep the whole list at once.
        </div>
      </Show>

      {/* ══ Table ══ */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <SortableTh
                label="Client"
                col="client"
                sortIcon={sortIcon}
                onSort={toggleSort}
              />
              <th class={TH}>Type</th>
              <th class={TH}>Sales person</th>
              <th class={TH}>Team</th>
              <th class={TH}>Projects</th>
              <SortableTh
                label="Daily budget"
                col="daily_budget"
                align="right"
                sortIcon={sortIcon}
                onSort={toggleSort}
              />
              <th class={`${TH} text-right`}>Live</th>
              <SortableTh
                label="Leads"
                col="leads"
                align="right"
                sortIcon={sortIcon}
                onSort={toggleSort}
              />
              <SortableTh
                label="Raw spend"
                col="raw_spend"
                align="right"
                sortIcon={sortIcon}
                onSort={toggleSort}
              />
              <SortableTh
                label="Raw CPL"
                col="raw_cpl"
                align="right"
                sortIcon={sortIcon}
                onSort={toggleSort}
              />
              <SortableTh
                label="Premium spend"
                col="premium_spend"
                align="right"
                sortIcon={sortIcon}
                onSort={toggleSort}
              />
              {/* The header has to carry "current month": this figure ignores
                  the date filter above it, and a balance that disagrees with the
                  client's own billing page gets reported as a bug otherwise. */}
              <SortableTh
                label="Balance (current month)"
                col="balance_inc_gst"
                align="right"
                sortIcon={sortIcon}
                onSort={toggleSort}
              />
              <th class={TH}>Lead destination</th>
            </tr>
          </thead>

          <Switch>
            {/* Waiting on the second half of a custom range. Ahead of the
                loading arm: nothing has been asked for, so nothing is loading. */}
            <Match when={parked()}>
              <tbody>
                <tr>
                  <td
                    colspan={COLS}
                    class="p-12 text-center text-gray-500 dark:text-gray-400"
                  >
                    Pick a start and an end date to load the range.
                  </td>
                </tr>
              </tbody>
            </Match>

            {/* First load of a cold range is ~14 seconds. A bare spinner for
                that long reads as broken, so the wait says what it's doing and
                what it buys. */}
            <Match when={firstLoad()}>
              <tbody>
                <tr>
                  <td colspan={COLS} class="p-12 text-center">
                    <div class="inline-flex flex-col items-center gap-3">
                      <svg
                        class="w-6 h-6 animate-spin text-[#AC2334]"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          stroke-width="3"
                          class="opacity-20"
                        />
                        <path
                          d="M22 12a10 10 0 0 0-10-10"
                          stroke="currentColor"
                          stroke-width="3"
                          stroke-linecap="round"
                        />
                      </svg>
                      <Show
                        when={expectSlow()}
                        fallback={
                          <p class="text-sm text-gray-500 dark:text-gray-400">
                            Reading this range…
                          </p>
                        }
                      >
                        <div>
                          <p class="text-sm font-semibold text-gray-700 dark:text-gray-200">
                            Building this date range — about 15 seconds.
                          </p>
                          <p class="text-[13px] text-gray-500 dark:text-gray-400 mt-1">
                            It's cached for five minutes afterwards, so sorting,
                            filtering, searching and paging are instant from
                            then on.
                          </p>
                        </div>
                      </Show>
                      <Show when={elapsed() > 0}>
                        <p class="text-[12px] tabular-nums text-gray-400 dark:text-gray-500">
                          {elapsed()}s
                        </p>
                      </Show>
                    </div>
                  </td>
                </tr>
              </tbody>
            </Match>

            <Match when={board.error}>
              <tbody>
                <tr>
                  <td colspan={COLS} class="p-10 text-center">
                    <p class="text-sm font-medium text-[#AC2334]">
                      {board.error?.status === 403
                        ? "This page is for admin and coordination only."
                        : board.error?.message ||
                          "Could not load the command page."}
                    </p>
                    <Show when={board.error?.status !== 403}>
                      <button
                        onClick={() => refetch()}
                        class="mt-2 text-sm underline text-gray-500"
                      >
                        Retry
                      </button>
                    </Show>
                  </td>
                </tr>
              </tbody>
            </Match>

            <Match when={visible().length === 0}>
              <tbody>
                <tr>
                  <td
                    colspan={COLS}
                    class="p-12 text-center text-gray-500 dark:text-gray-400"
                  >
                    <Switch fallback="No clients to show.">
                      <Match when={gapOnly()}>
                        Every client in view has a pricing config for these
                        dates.
                      </Match>
                      <Match when={hasFilters()}>
                        No clients match these filters.
                      </Match>
                    </Switch>
                  </td>
                </tr>
              </tbody>
            </Match>

            <Match when={true}>
              <tbody class={board.loading ? "opacity-50 transition-opacity" : ""}>
                <For each={visible()}>
                  {(r, i) => {
                    const key = rowKey(r, i());
                    const gap = () => isConfigGap(r);
                    const open = () => expanded() === key;
                    return (
                      <>
                        <tr
                          class={`border-b border-gray-100 dark:border-gray-800 hover:bg-purple-50/60 dark:hover:bg-gray-800/40 transition-colors ${
                            gap()
                              ? "bg-[#FBF3E2]/50 dark:bg-yellow-900/10"
                              : i() % 2 === 0
                                ? "bg-white dark:bg-gray-900"
                                : "bg-gray-50/60 dark:bg-gray-800/30"
                          }`}
                        >
                          {/* Client */}
                          <td class="p-3">
                            <div class="flex items-center gap-2.5 min-w-0">
                              <Avatar name={r.client || r.email} />
                              <div class="min-w-0">
                                <button
                                  type="button"
                                  onClick={() =>
                                    r.client && navigate(`/${slugify(r.client)}`)
                                  }
                                  disabled={!r.client}
                                  class="block max-w-[200px] truncate text-left font-medium text-gray-800 dark:text-gray-100 hover:text-[#AC2334] dark:hover:text-[#E4566A] disabled:hover:text-inherit disabled:cursor-default"
                                >
                                  {r.client || DASH}
                                </button>
                                <p class="max-w-[200px] truncate text-xs text-gray-500 dark:text-gray-400">
                                  {r.email || DASH}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* Type — the billing basis, and the thing that makes
                              a null premium spend readable either way */}
                          <td class="p-3">
                            <span
                              class={`inline-block text-[10px] font-bold tracking-[0.08em] uppercase px-2.5 py-[3px] rounded-full ${
                                TYPE_CHIP[r.client_type] ??
                                "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                              }`}
                            >
                              {typeLabel(r.client_type)}
                            </span>
                          </td>

                          {/* Sales person — unset for 79 of 186; shown as the
                              gap it is rather than filled in */}
                          <td class="p-3 max-w-[150px] truncate">
                            <Show
                              when={!isUnrecorded(r.sales_person)}
                              fallback={<Missing>No sales person</Missing>}
                            >
                              <span class="text-gray-700 dark:text-gray-200">
                                {r.sales_person}
                              </span>
                            </Show>
                          </td>

                          {/* Team */}
                          <td class="p-3">
                            <People
                              managers={asList(r.campaign_managers)}
                              leads={asList(r.team_leads)}
                            />
                          </td>

                          {/* Projects — count opens the per-project budgets */}
                          <td class="p-3 whitespace-nowrap">
                            <Show
                              when={r.projects.length > 0}
                              fallback={
                                <span class="text-gray-300 dark:text-gray-600">
                                  {count(r.project_count)}
                                </span>
                              }
                            >
                              <button
                                type="button"
                                onClick={() => toggleExpand(key)}
                                aria-expanded={open()}
                                class="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#3E6FB0] hover:underline"
                              >
                                {count(r.project_count)}
                                <span
                                  class={`text-[10px] transition-transform ${open() ? "rotate-180" : ""}`}
                                  aria-hidden="true"
                                >
                                  ▾
                                </span>
                              </button>
                            </Show>
                          </td>

                          {/* Daily budget */}
                          <td
                            class={`${NUM} font-semibold text-gray-800 dark:text-gray-100`}
                          >
                            {inr(r.daily_budget)}
                          </td>

                          {/* Live: campaigns over ad accounts */}
                          <td class={NUM}>
                            <span class="text-gray-800 dark:text-gray-100">
                              {count(r.active_campaigns)}
                            </span>
                            <span
                              class="text-xs text-gray-400 dark:text-gray-500"
                              title="Ad accounts"
                            >
                              {" "}
                              / {count(r.ad_accounts)}
                            </span>
                          </td>

                          {/* Leads */}
                          <td class={`${NUM} text-gray-800 dark:text-gray-100`}>
                            {count(r.leads)}
                          </td>

                          {/* Raw spend / raw CPL — agency cost, internal */}
                          <td class={`${NUM} text-gray-700 dark:text-gray-200`}>
                            {inr(r.raw_spend)}
                          </td>
                          <td class={`${NUM} text-gray-700 dark:text-gray-200`}>
                            {inrRate(r.raw_cpl)}
                          </td>

                          {/* Premium spend — see premiumSpendState() */}
                          <td class={NUM}>
                            <PremiumSpend row={r} />
                          </td>

                          {/* Balance — always the current month, whatever the
                              date filter says. Never summed. */}
                          <td class={`${NUM} text-gray-800 dark:text-gray-100`}>
                            <span
                              class="border-b border-dotted border-gray-300 dark:border-gray-600 cursor-help"
                              title={balanceSourceNote(r.balance_source)}
                            >
                              {inr(r.balance_inc_gst)}
                            </span>
                          </td>

                          {/* Lead destination — "Not recorded yet" for all 186
                              right now; a real gap, shown as one */}
                          <td class="p-3 max-w-[200px]">
                            <Destination row={r} />
                          </td>
                        </tr>

                        {/* Projects, biggest daily budget first (the server's
                            order, kept as served) */}
                        <Show when={open()}>
                          <tr class="bg-[#F6F9FC] dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                            <td colspan={COLS} class="px-3 py-3">
                              <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">
                                Projects · biggest daily budget first
                              </p>
                              <div class="flex flex-wrap gap-2">
                                <For each={r.projects}>
                                  {(p) => (
                                    <span class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-[13px]">
                                      <span class="text-gray-700 dark:text-gray-200">
                                        {p.project_name ||
                                          `Project #${p.project_id ?? "?"}`}
                                      </span>
                                      <span class="tabular-nums font-semibold text-gray-800 dark:text-gray-100">
                                        {inr(p.daily_budget)}
                                      </span>
                                    </span>
                                  )}
                                </For>
                              </div>
                            </td>
                          </tr>
                        </Show>
                      </>
                    );
                  }}
                </For>
              </tbody>
            </Match>
          </Switch>
        </table>
      </div>

      {/* ══ Paginator (server-driven) ══ */}
      <Show when={!parked() && !firstLoad() && !board.error && rows().length > 0}>
        <div class="mt-5 flex items-center justify-between flex-wrap gap-3">
          <div class="flex items-center gap-3">
            <span class="text-sm text-[#8593A8] dark:text-gray-400">
              Showing {rangeStart()}–{rangeEnd()} of{" "}
              <Show when={pagination().total != null} fallback={<>many</>}>
                {pagination().total}
              </Show>{" "}
              clients
              <Show when={gapOnly()}>
                {" "}
                · {visible().length} unpriced in view
              </Show>
            </span>
            <RowsPerPageSelect
              value={pageSize()}
              options={[50, 100, 200]}
              onChange={(n) => {
                setPage(1);
                setPageSize(n);
              }}
            />
          </div>

          <Show when={pagination().hasNext || pagination().hasPrev}>
            <div class="flex items-center gap-2">
              <button
                type="button"
                onClick={() => gotoPage(page() - 1)}
                disabled={!pagination().hasPrev}
                class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-200 hover:bg-[#F6F9FC] disabled:opacity-35 disabled:cursor-default transition-colors"
              >
                Prev
              </button>
              <span class="text-sm text-[#8593A8] dark:text-gray-400 px-1">
                Page {page()}
                <Show when={pagination().totalPages != null}>
                  {" "}
                  of {pagination().totalPages}
                </Show>
              </span>
              <button
                type="button"
                onClick={() => gotoPage(page() + 1)}
                disabled={!pagination().hasNext}
                class="flex items-center gap-1.5 px-4 h-9 text-sm rounded-lg bg-[#AC2334] border border-[#AC2334] text-white hover:bg-[#8E1C2B] disabled:opacity-35 disabled:cursor-default transition-colors"
              >
                Next
              </button>
            </div>
          </Show>
        </div>
      </Show>

      {/* ══ Footnotes ══ */}
      <p class="mt-5 text-[12px] text-gray-400 dark:text-gray-500">
        The date range governs leads, spend, CPL and daily budget.{" "}
        <b class="font-semibold">Balance is always the current month</b>, so it
        matches what the client sees on their billing page and what accounts
        would quote. Hover a balance to see where it came from.
      </p>
      <p class="mt-1.5 text-[12px] text-gray-400 dark:text-gray-500">
        Balance is deliberately not totalled: a CPL client bills per qualified
        lead with no service charge and no GST, a hybrid bills on spend plus
        both. Adding the column would produce a number that means nothing.
      </p>
      <p class="mt-1.5 text-[12px] text-gray-400 dark:text-gray-500">
        A blank premium spend means two different things.{" "}
        <b class="font-semibold">n/a</b> on a retainer is by design — retainers
        carry no pricing configs.{" "}
        <b class="font-semibold text-[#8A6410] dark:text-yellow-300">
          No pricing config
        </b>{" "}
        on a CPL or hybrid client is the flag: leads are being delivered at a
        price nobody has set.
      </p>
    </div>
  );
}

// ── Totals tile ───────────────────────────────────────────────────────────────
function Tile(props) {
  return (
    <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 px-4 py-3">
      <p
        class="text-[11px] font-bold uppercase tracking-wider text-gray-400 truncate"
        title={props.note}
      >
        {props.label}
        <Show when={props.note}>
          <span class="ml-1 text-gray-300 cursor-help" aria-hidden="true">
            ⓘ
          </span>
        </Show>
      </p>
      <p class="mt-1 text-xl font-semibold tabular-nums text-gray-800 dark:text-gray-100">
        {props.value}
      </p>
    </div>
  );
}

// ── Sortable header ───────────────────────────────────────────────────────────
// Only rendered for the columns the ENDPOINT can order by; everything else stays
// a plain <th>, because a click that reordered the rows in hand would read as an
// ordering of the whole set.
function SortableTh(props) {
  return (
    <th class={`${TH} ${props.align === "right" ? "text-right" : ""}`}>
      <button
        type="button"
        onClick={() => props.onSort(props.col)}
        class="inline-flex items-center gap-1 uppercase tracking-wider hover:text-[#AC2334] dark:hover:text-[#E4566A] transition-colors"
      >
        {props.label}
        <span class="text-gray-400">{props.sortIcon(props.col)}</span>
      </button>
    </th>
  );
}

// ── Premium spend ─────────────────────────────────────────────────────────────
// The four states are deliberately four different things on screen. If "n/a" and
// the config gap ever look alike, the flag is wallpaper: every retainer would be
// carrying it and a genuinely unpriced client would read as one more grey row.
function PremiumSpend(props) {
  const state = () => premiumSpendState(props.row);
  return (
    <Switch>
      <Match when={state() === PREMIUM.VALUE}>
        <span class="font-semibold text-gray-800 dark:text-gray-100">
          {inr(props.row.premium_spend)}
        </span>
      </Match>

      {/* Retainer: no configs by design. Nothing is wrong, so nothing shouts. */}
      <Match when={state() === PREMIUM.NA}>
        <span
          class="text-gray-300 dark:text-gray-600"
          title="Retainers carry no pricing configs, so there is no premium spend to show. Nothing is wrong."
        >
          n/a
        </span>
      </Match>

      {/* CPL or hybrid with no config covering these days. This is the one. */}
      <Match when={state() === PREMIUM.GAP}>
        <span
          class="inline-flex items-center gap-1.5 px-2 py-[3px] rounded-md text-[12px] font-semibold bg-[#FBF3E2] dark:bg-yellow-900/25 text-[#8A6410] dark:text-yellow-200 border border-[#B07A14]/40"
          title="No pricing config covers these dates, so this client is being delivered leads at a price nobody has set."
        >
          <svg
            class="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <path d="M12 9v4M12 17h.01" />
          </svg>
          No config
        </span>
      </Match>

      {/* No client type on the row, so the two nulls can't be told apart. Never
          happens on a healthy payload; saying so beats inventing an alarm or
          hiding a real one. */}
      <Match when={state() === PREMIUM.UNKNOWN}>
        <span
          class="text-gray-400 dark:text-gray-500 cursor-help"
          title="No client type on this row, so we can't tell whether the blank is a retainer (expected) or a missing pricing config (a problem)."
        >
          ?
        </span>
      </Match>
    </Switch>
  );
}

// ── Team ──────────────────────────────────────────────────────────────────────
function People(props) {
  return (
    <div class="min-w-0">
      <Show
        when={props.managers.length > 0}
        fallback={<Missing>No CM</Missing>}
      >
        <p
          class="max-w-[170px] truncate text-[13px] text-gray-700 dark:text-gray-200"
          title={props.managers.join(", ")}
        >
          {props.managers.join(", ")}
        </p>
      </Show>
      <Show when={props.leads.length > 0}>
        <p
          class="max-w-[170px] truncate text-xs text-gray-400 dark:text-gray-500"
          title={props.leads.join(", ")}
        >
          TL: {props.leads.join(", ")}
        </p>
      </Show>
    </div>
  );
}

// ── Lead destination ──────────────────────────────────────────────────────────
// Reads "Not recorded yet" for all 186 clients today. That is a real gap in the
// records, and the page's job is to show it as missing — not to hide the column
// until someone fills it, and not to dress the placeholder up as a destination.
function Destination(props) {
  const r = props.row;
  const kind = () => humanise(r.lead_destination_kind);
  return (
    <Show
      when={!isUnrecorded(r.lead_destination)}
      fallback={<Missing>Not recorded yet</Missing>}
    >
      <div class="min-w-0">
        <div class="flex items-center gap-1.5 min-w-0">
          <span
            class="truncate text-[13px] text-gray-700 dark:text-gray-200"
            title={r.lead_destination}
          >
            {r.lead_destination}
          </span>
          <Show when={kind()}>
            <span class="flex-none text-[10px] font-bold uppercase tracking-wide px-1.5 py-[1px] rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
              {kind()}
            </span>
          </Show>
        </div>
        <div class="flex items-center gap-2 mt-0.5">
          <Show when={r.sheet_url}>
            <a
              href={r.sheet_url}
              target="_blank"
              rel="noopener noreferrer"
              class="text-xs font-semibold text-[#3E6FB0] hover:underline"
            >
              Sheet ↗
            </a>
          </Show>
          <Show when={!isUnrecorded(r.destination_contact)}>
            <span
              class="max-w-[140px] truncate text-xs text-gray-400 dark:text-gray-500"
              title={r.destination_contact}
            >
              {r.destination_contact}
            </span>
          </Show>
        </div>
      </div>
    </Show>
  );
}
