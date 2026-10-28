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
import {
  Building2,
  UsersRound,
  Wallet,
  Gem,
  CalendarClock,
} from "lucide-solid";
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
  expectColdLoad,
  CACHE_TTL_MINUTES,
  isDormant,
  DELIVERY_WINDOW_LABEL,
  inr,
  inrRate,
  inrCompact,
  count,
  isoDate,
  fmtRange,
  DASH,
  CM_SCOPES,
  canOpenClient,
  adAccountStatus,
  adAccountBalance,
} from "../../services/commandRules";
import Avatar from "../../components/common/Avatar";
import StatTile from "../../components/common/StatTile";
import DeadToggle from "../../components/common/DeadToggle";
import { isTier1CM } from "../../stores/currentUser";
import { isSwitched, scopeKey } from "../../stores/cmScope";
import { openClientPage } from "../../utils/openClientPage";
import {
  DEAD_BLOCKED_LABEL,
  DEAD_BLOCKED_TITLE,
} from "../../services/clientStatus";
import RowsPerPageSelect from "../../components/common/RowsPerPageSelect";
import { loadErrorMessage } from "../../utils/apiErrors";

// ─── Command ──────────────────────────────────────────────────────────────────
// One row per client, every operational number the desk works from in the
// morning: what's live, what it's spending, what it's returning, what's owed and
// who owns it. Admin + coordination + Tier 1 CMs; the endpoint 403s everyone
// else. A Tier 1 CM sees ALL clients by default (with a team/own toggle), but
// rows outside their team (in_my_team === false) are view-only — the client
// page itself refuses them.
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

// Client click-through goes via openClientPage, which sets the dashboard's
// client context first — CMs and coordination don't re-derive it from the URL.

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
    <span class="text-[12px] italic text-gray-300 dark:text-gray-400">
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
  // 200 is the server's cap and there are 186 clients, so the default puts the
  // whole book on one page. That is not about scrolling — it is what makes the
  // config-gap count below a count of ALL unpriced clients rather than the
  // unpriced ones on page 1 of 4. The flag is the reason this screen exists; it
  // should be whole when the page opens, not after someone finds the page-size
  // control. Past 200 clients this degrades honestly on its own: the caption
  // goes back to saying "on this page".
  const [pageSize, setPageSize] = createSignal(200);

  // Server-side, and a FIXED seven-day window — not the range above it.
  //
  // Starts FALSE, i.e. dormant clients hidden, because that is the endpoint's
  // own default (92 of 186) and the one the page should open on: the 94 hidden
  // carry 2,911 leads and ₹3.1L over 30 days against 27,390 and ₹40.9L for the
  // 92 shown, so the default view holds ~90% of the leads and ~93% of the spend.
  // This toggle ADDS them back; it does not take them away.
  const [includeDormant, setIncludeDormant] = createSignal(false);

  // Dead clients (status Dead with no live campaign, or Completed with 20
  // quiet days and no live campaign) are hidden server-side. ON sends dead=only — ONLY dead clients —
  // and the server skips the dormant filter by itself, so the dormant toggle
  // steps aside while this is on.
  const [dead, setDead] = createSignal(false);

  // Tier 1 CMs only: null = all clients (default, no param) | "team".
  // Survives range, filters, search and paging — only page resets on change.
  // The global "Viewing" switcher wins: on Just me or a member, api.js sends
  // that scope and this toggle is hidden; it only exists on "My team".
  const [scope, setScope] = createSignal(null);
  const showScope = () => isTier1CM() && !isSwitched();

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
      includeDormant: includeDormant(),
      dead: dead(),
      scope: showScope() ? scope() : null,
      // Not sent by fetchCommandBoard — api.js adds the switcher. Here only so
      // a switch re-keys the resource.
      viewing: scopeKey(),
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

  // The window the server actually computed over, in its own timezone. Shown as
  // fact, never recomputed here — see readRange/fmtRange.
  const range = () => data()?.range ?? null;
  const rangeLabel = () => {
    const r = range();
    return r ? fmtRange(r.since, r.until) : null;
  };
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

  // Two signals, combined in expectColdLoad: has this tab already paid for this
  // range, and is it the kind of range anything pre-warms. A named preset is
  // refreshed server-side every ten minutes against a fifteen-minute TTL, so it
  // is warm continuously — presuming otherwise put a 15-second warning on the
  // most common event on this page, opening it, for a wait of 0.1s.
  const coldRange = () =>
    expectColdLoad({
      preset: preset(),
      fetchedInThisTab: isRangeWarm(
        rangeKeyOf({ preset: preset(), start: start(), end: end() }),
      ),
    });
  // Elapsed time overrides the guess in the only direction that matters: if a
  // "warm" range is still going at 3s, the task has failed and this IS a build.
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
  // Counted over the rows in hand, because there is no server param for it. At
  // the default 200 per page all 186 clients are in hand, so the count IS the
  // whole set and the caption says "N of 186 clients". Drop the page size, or
  // grow past 200 clients, and it says "N on this page" instead — the number is
  // never allowed to read as a total it isn't.
  //
  // For scale: 29 of the 186 are real gaps today (24 CPL, 5 hybrid).
  const gapRows = createMemo(() => rows().filter(isConfigGap));
  const wholeSetInView = () => {
    const t = pagination().total;
    return t != null && rows().length >= t;
  };
  const gapCaption = () =>
    wholeSetInView()
      ? `${gapRows().length} of ${pagination().total} clients`
      : `${gapRows().length} on this page`;

  // ── Meta ad account ────────────────────────────────────────────────────────
  // No server param either, so — like the gap — it narrows the rows in hand,
  // matched against each row's ad_account_list, and the caption says so when
  // the page doesn't hold the whole set. Keyed on the Meta account_id (falling
  // back to our PK), since one account can serve several clients.
  const [adAccount, setAdAccount] = createSignal("");
  const acctKey = (a) => String(a.account_id ?? a.id ?? "");
  const accountOptions = createMemo(() => {
    const byKey = new Map();
    for (const r of rows()) {
      for (const a of r.ad_account_list ?? []) {
        const k = acctKey(a);
        if (!k) continue;
        const cur = byKey.get(k);
        if (cur) cur.clients += 1;
        else byKey.set(k, { key: k, name: a.name, account_id: a.account_id, clients: 1 });
      }
    }
    return [...byKey.values()].sort((x, y) =>
      String(x.name ?? x.account_id).localeCompare(String(y.name ?? y.account_id)),
    );
  });
  const pickedAccount = () => accountOptions().find((o) => o.key === adAccount()) ?? null;
  // A selection the new rows no longer contain (range, type, search changed)
  // would silently empty the table — drop it instead.
  createEffect(() => {
    if (board.loading || !adAccount()) return;
    if (!pickedAccount()) setAdAccount("");
  });

  const visible = createMemo(() => {
    const base = gapOnly() ? gapRows() : rows();
    const k = adAccount();
    if (!k) return base;
    return base.filter((r) => (r.ad_account_list ?? []).some((a) => acctKey(a) === k));
  });

  // ── Dormancy ───────────────────────────────────────────────────────────────
  // The toggle wants to say how many rows it would ADD. When it's off those rows
  // aren't in the response, so the number can't be counted — it has to be
  // remembered from a request that did include them.
  //
  // Keyed on the narrowing filters only (type, search), NOT on the date range:
  // the dormancy test is a fixed 7-day window, so the set of dormant clients
  // doesn't move when the preset does, and a count learned on Last 7 is still
  // true on Last 30. Type and search DO change which clients are in scope, so a
  // count learned under one must never be shown under another.
  const dormantRows = createMemo(() => rows().filter(isDormant));
  const narrowKey = () =>
    `${type() ?? ""}|${q()}|${showScope() ? (scope() ?? "") : ""}|${scopeKey()}`;
  const [knownDormant, setKnownDormant] = createSignal({});

  createEffect(() => {
    // Only record a COMPLETE count. A paged response knows its own page's
    // dormant rows and nothing about the rest.
    if (dead() || !includeDormant() || !wholeSetInView()) return;
    const key = narrowKey();
    const n = dormantRows().length;
    setKnownDormant((prev) => (prev[key] === n ? prev : { ...prev, [key]: n }));
  });

  // Null until we've actually seen the number for this narrowing — the button
  // simply carries no count rather than a stale or invented one.
  const dormantTotal = () => {
    if (includeDormant() && wholeSetInView()) return dormantRows().length;
    return knownDormant()[narrowKey()] ?? null;
  };

  const toggleDormant = () => {
    setPage(1);
    setIncludeDormant((v) => !v);
  };

  const toggleDead = (on) => {
    setPage(1);
    setGapOnly(false);
    setDead(on);
  };

  const pickScope = (key) => {
    if (scope() === key) return;
    setPage(1);
    setScope(key);
  };

  const gotoPage = (n) => {
    const tp = pagination().totalPages;
    const target = Math.max(1, n);
    setPage(tp != null && tp >= 1 ? Math.min(target, tp) : target);
  };

  const rangeStart = () =>
    rows().length === 0 ? 0 : (page() - 1) * (pagination().pageSize || 0) + 1;
  const rangeEnd = () => rangeStart() + rows().length - (rows().length ? 1 : 0);

  const rowKey = (r, i) => r.client ?? r.email ?? `row-${i}`;
  // One drawer open at a time, per row AND kind ("projects" | "accounts").
  const toggleExpand = (key, kind) => {
    const id = `${kind}:${key}`;
    setExpanded((c) => (c === id ? null : id));
  };

  // The date range narrows the FIGURES, not the roster — a client with no spend
  // in the window still has a row. So only type and search can empty the table,
  // and only they belong in the "nothing matched" wording.
  // Narrowing the reader applied. Dormancy is deliberately NOT in here: it is on
  // by default, so counting it as a filter would make "no clients match these
  // filters" the answer to a question nobody asked.
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
              Campaign Analysis
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

      {/* ══ Tier 1 scope ══ — CMs only; admin and coordination always see
          everything and never get this control. */}
      <Show when={showScope()}>
        <div class="mb-4 flex flex-wrap items-center gap-3">
          <div
            role="group"
            aria-label="Which clients"
            class="inline-flex items-center gap-1 bg-white dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-600 rounded-full p-1"
          >
            <For each={CM_SCOPES}>
              {(s) => (
                <button
                  type="button"
                  onClick={() => pickScope(s.key)}
                  aria-pressed={scope() === s.key}
                  class={`px-4 py-1.5 rounded-full text-[13px] font-semibold transition-colors whitespace-nowrap ${
                    scope() === s.key
                      ? "bg-[#AC2334] text-white"
                      : "text-[#54657E] dark:text-gray-300 hover:text-[#14233A] dark:hover:text-white"
                  }`}
                >
                  {s.label}
                </button>
              )}
            </For>
          </div>
          <Show when={scope() === null}>
            <span class="text-[12px] text-gray-400 dark:text-gray-400">
              Clients outside your team are view-only.
            </span>
          </Show>
        </div>
      </Show>

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

          {/* What the server actually computed over, in its own timezone. A
              preset is a request; this is the answer, so it's shown as fact
              rather than as a restatement of the chip that's lit. */}
          <Show when={rangeLabel()}>
            <span class="ml-auto inline-flex items-center gap-2 text-[13px] whitespace-nowrap">
              <span class="text-gray-400 dark:text-gray-400">Computed over</span>
              <span class="font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                {rangeLabel()}
              </span>
            </span>
          </Show>
        </div>

        <Show when={preset() === "custom" && !(start() && end())}>
          <p class="mt-2.5 text-[12px] text-[#8A6410] dark:text-yellow-300">
            Pick both a start and an end date — a one-sided range isn't sent.
          </p>
        </Show>
      </div>

      {/* ══ Load failure ══ — up here, not only in the table, so a failure
          can't read as a page of dashes and "0 shown". */}
      <Show when={board.error && !parked()}>
        <div
          role="alert"
          class="mb-4 flex items-center justify-between gap-3 rounded-xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm font-medium text-[#AC2334] dark:text-red-300"
        >
          <span>
            {board.error?.status === 403
              ? "This page is for admin, coordination and Tier 1 campaign managers only."
              : `Could not load Campaign Analysis. ${loadErrorMessage(board.error)}`}
          </span>
          <Show when={board.error?.status !== 403}>
            <button
              type="button"
              onClick={() => refetch()}
              class="flex-none underline font-semibold"
            >
              Retry
            </button>
          </Show>
        </div>
      </Show>

      {/* ══ Totals ══ */}
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        {/* The totals follow the filter, and the filter is on by default — so
            this card reads 92, not 186, before anyone has touched a control.
            That is the number someone queries first, so the explanation is on
            the card rather than only in the footnote. */}
        <StatTile
          label="Clients"
          icon={Building2}
          tone="navy"
          value={count(totals().clients)}
          note={
            dead()
              ? "Dead clients only — every total here covers just them."
              : includeDormant()
              ? undefined
              : `Delivering clients only. Dormant clients — no leads and no spend in the ${DELIVERY_WINDOW_LABEL} — are excluded by default, and every total here excludes them too.`
          }
        />
        <StatTile
          label="Leads"
          icon={UsersRound}
          tone="emerald"
          value={count(totals().leads)}
        />
        <StatTile
          label="Raw spend"
          icon={Wallet}
          tone="slate"
          value={inrCompact(totals().raw_spend)}
        />
        <StatTile
          label="Premium spend"
          icon={Gem}
          tone="crimson"
          value={inrCompact(totals().premium_spend)}
          note="Only the clients that have one — retainers and unpriced days aren't in it."
        />
        <StatTile
          label="Daily budget"
          icon={CalendarClock}
          tone="gold"
          value={inrCompact(totals().daily_budget)}
        />
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

        {/* Dormancy. Server-side (?active_only=true), and the label states its
            OWN window every time, because that window is seven days no matter
            what the range chips say — a client dormant for a month stays hidden
            on Last 30 Days. "Delivering", never "Active": campaign_activity is
            already running/paused in this codebase, and the 14 clients that
            delivered this week off since-paused campaigns are precisely where
            those two answers diverge. */}
        <DeadToggle value={dead()} onChange={toggleDead} />

        <Show when={!dead()}>
        <button
          type="button"
          onClick={toggleDormant}
          aria-pressed={includeDormant()}
          title={`The page shows clients that delivered leads or spend in the ${DELIVERY_WINDOW_LABEL}. This turns the rest back on. The window is fixed at 7 days and does not follow the date range above.`}
          class={`inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold rounded-lg border transition-colors ${
            includeDormant()
              ? "bg-[#54657E] text-white border-[#54657E]"
              : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-[#54657E]/50"
          }`}
        >
          <span
            class={`h-1.5 w-1.5 rounded-full ${
              includeDormant() ? "bg-white" : "bg-gray-300 dark:bg-gray-600"
            }`}
            aria-hidden="true"
          />
          Include dormant
          {/* Only ever a number we have actually seen for this exact narrowing.
              When the toggle is off those rows aren't in the response at all,
              so there is nothing to count — the button carries no number rather
              than a guessed one. */}
          <Show when={dormantTotal() != null}>
            <span
              class={`text-[11px] font-bold tabular-nums ${
                includeDormant() ? "text-white/75" : "text-gray-400"
              }`}
            >
              ({includeDormant() ? "" : "+"}
              {dormantTotal()})
            </span>
          </Show>
        </button>
        </Show>

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

        <AdAccountPicker
          options={accountOptions()}
          value={adAccount()}
          onChange={setAdAccount}
        />

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-400 whitespace-nowrap">
          {visible().length} shown
          {/* The count lives on the toggle, not here as well. This only names
              the scope, which is otherwise invisible: the page is filtered
              before anyone touches a control. */}
          <Show
            when={!dead()}
            fallback={
              <>
                <span class="text-gray-300 dark:text-gray-400"> · </span>
                dead clients only
              </>
            }
          >
            <Show when={!includeDormant()}>
              <span class="text-gray-300 dark:text-gray-400"> · </span>
              <span title={`No leads and no spend in the ${DELIVERY_WINDOW_LABEL}`}>
                dormant hidden
              </span>
            </Show>
          </Show>
        </span>
      </div>

      <Show when={gapOnly() && !wholeSetInView()}>
        <div class="mb-4 px-4 py-2.5 rounded-lg bg-[#FBF3E2] dark:bg-yellow-900/15 border border-[#B07A14]/30 text-[13px] text-[#8A6410] dark:text-yellow-200">
          Showing the {gapRows().length} unpriced clients{" "}
          <b class="font-semibold">on this page</b> — the gap has no server
          filter yet. Set the page size to 200 to sweep the whole list at once.
        </div>
      </Show>

      <Show when={pickedAccount()}>
        <div class="mb-4 px-4 py-2.5 rounded-lg bg-[#ECF2FA] dark:bg-blue-900/20 border border-[#3E6FB0]/30 text-[13px] text-[#14233A] dark:text-blue-100">
          Clients on ad account{" "}
          <b class="font-semibold">{pickedAccount().name ?? pickedAccount().account_id}</b>
          <Show when={pickedAccount().name && pickedAccount().account_id}>
            <span class="font-mono text-[12px] text-gray-500 dark:text-gray-400">
              {" "}({pickedAccount().account_id})
            </span>
          </Show>
          {wholeSetInView() ? "" : " — on this page only"}. The totals cards
          above still cover every client in the list, not just this account.
        </div>
      </Show>

      {/* ══ Table ══ */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            {/* ── Which clock each column runs on ──────────────────────────
                The mismatch this page invites is a five-column block governed
                by the date filter sitting next to a balance that is always the
                current month. A footnote does not fix that — the reader is
                looking at the numbers, not the bottom of the page. So the
                window is stated over the columns it governs, and "Current
                month" over the one it doesn't, where they can't be conflated.

                Live (campaigns / ad accounts) is deliberately outside the
                dated block: the filter governs leads, spend, CPL and daily
                budget only, so grouping it under the range would claim
                something the endpoint never promised. */}
            <tr class="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/60">
              <th colspan="6" />
              <th
                colspan="5"
                class="px-3 pt-2.5 pb-1 text-center text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap border-x border-gray-200 dark:border-gray-700"
              >
                <Show when={rangeLabel()} fallback={<span>Selected range</span>}>
                  <span class="tabular-nums normal-case text-[12px] text-gray-700 dark:text-gray-200">
                    {rangeLabel()}
                  </span>
                </Show>
              </th>
              <th
                colspan="1"
                class="px-3 pt-2.5 pb-1 text-center text-[11px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap border-r border-gray-200 dark:border-gray-700"
              >
                Current month
              </th>
              <th colspan="1" />
            </tr>

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
              <th
                class={`${TH} text-right`}
                title="Active campaigns / ad accounts, as they stand now — the date filter does not govern this column"
              >
                Live
              </th>
              <SortableTh
                label="Daily budget"
                col="daily_budget"
                align="right"
                sortIcon={sortIcon}
                onSort={toggleSort}
              />
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
                        class="w-6 h-6 animate-spin text-[#AC2334] dark:text-red-300"
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
                            It's cached for {CACHE_TTL_MINUTES} minutes
                            afterwards, so sorting, filtering, searching and
                            paging are instant from then on.
                          </p>
                        </div>
                      </Show>
                      <Show when={elapsed() > 0}>
                        <p class="text-[12px] tabular-nums text-gray-400 dark:text-gray-400">
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
                  {/* The reason and Retry sit in the banner above the totals. */}
                  <td
                    colspan={COLS}
                    class="p-10 text-center text-sm text-gray-500 dark:text-gray-400"
                  >
                    Nothing loaded — see the error above.
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
                      <Match when={adAccount()}>
                        No clients in view use this ad account.
                      </Match>
                      <Match when={gapOnly()}>
                        Every client in view has a pricing config for these
                        dates.
                      </Match>
                      <Match when={dead()}>
                        No dead clients
                        {hasFilters() ? " match these filters" : ""}.
                      </Match>
                      {/* Named separately so the reader isn't left hunting for
                          a range filter that had nothing to do with it — this
                          one is a fixed 7-day window, and it is on before
                          anyone touches a control. */}
                      <Match when={!includeDormant()}>
                        Nothing has delivered leads or spend in the{" "}
                        {DELIVERY_WINDOW_LABEL}
                        {hasFilters() ? " under these filters" : ""}.{" "}
                        <button
                          type="button"
                          onClick={toggleDormant}
                          class="font-semibold text-[#3E6FB0] dark:text-blue-300 hover:underline"
                        >
                          Include dormant clients
                        </button>
                        .
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
                    const open = () => expanded() === `projects:${key}`;
                    const acctsOpen = () => expanded() === `accounts:${key}`;
                    const openable = () => canOpenClient(r);
                    const viewOnly = () => r.in_my_team === false;
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
                          {/* Client. A dormant row is de-emphasised rather than
                              badged: 94 of 186 are dormant, and a chip on half
                              the page is not a signal, it's a texture. Muting
                              the name answers "who disappears if I flip the
                              filter?" at a glance, and the count lives once, on
                              the toggle. */}
                          <td class="p-3">
                            <div
                              class="flex items-center gap-2.5 min-w-0"
                              title={
                                isDormant(r)
                                  ? `No leads and no spend in the ${DELIVERY_WINDOW_LABEL}`
                                  : undefined
                              }
                            >
                              <span class={isDormant(r) ? "opacity-45" : ""}>
                                <Avatar name={r.client || r.email} />
                              </span>
                              <div class="min-w-0">
                                {/* Outside a Tier 1 CM's team: no link — the
                                    client page would refuse them. */}
                                <Show
                                  when={openable()}
                                  fallback={
                                    <span
                                      class="flex items-center gap-1.5 max-w-[200px]"
                                      title={
                                        viewOnly()
                                          ? "Not in your team — view only. The client page is open to that client's own team."
                                          : undefined
                                      }
                                    >
                                      <span class="truncate font-medium text-gray-400 dark:text-gray-500 cursor-default">
                                        {r.client || DASH}
                                      </span>
                                      <Show when={viewOnly()}>
                                        <span class="flex-none text-[9px] font-bold uppercase tracking-wider px-1.5 py-[1px] rounded bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500">
                                          View only
                                        </span>
                                      </Show>
                                    </span>
                                  }
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openClientPage(navigate, {
                                        nomen: r.client,
                                        nomenId: r.client_nomen_id,
                                      })
                                    }
                                    class={`block max-w-[200px] truncate text-left font-medium hover:text-[#AC2334] dark:hover:text-[#E4566A] ${
                                      isDormant(r)
                                        ? "text-gray-400 dark:text-gray-400"
                                        : "text-gray-800 dark:text-gray-100"
                                    }`}
                                  >
                                    {r.client}
                                  </button>
                                </Show>
                                <p class="max-w-[200px] truncate text-xs text-gray-500 dark:text-gray-400">
                                  {r.email || DASH}
                                </p>
                                <Show when={r.dead_blocked}>
                                  <span
                                    class="mt-1 flex w-fit items-center gap-1 px-2 py-[2px] rounded-full text-[10px] font-semibold whitespace-nowrap bg-[#FBF3E2] text-[#8A6410] border border-[#B07A14]/40 dark:bg-yellow-900/25 dark:text-yellow-200"
                                    title={DEAD_BLOCKED_TITLE}
                                  >
                                    <span aria-hidden="true">⚠</span>
                                    {DEAD_BLOCKED_LABEL}
                                  </span>
                                </Show>
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
                                <span class="text-gray-300 dark:text-gray-400">
                                  {count(r.project_count)}
                                </span>
                              }
                            >
                              <button
                                type="button"
                                onClick={() => toggleExpand(key, "projects")}
                                aria-expanded={open()}
                                class="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#3E6FB0] dark:text-blue-300 hover:underline"
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

                          {/* Live: campaigns over ad accounts. Current state,
                              NOT date-scoped — which is why it sits outside the
                              range-headed block that starts at Daily budget. */}
                          <td class={NUM}>
                            <span class="text-gray-800 dark:text-gray-100">
                              {count(r.active_campaigns)}
                            </span>
                            <span class="text-xs text-gray-400 dark:text-gray-400">
                              {" "}/{" "}
                            </span>
                            <Show
                              when={r.ad_account_list.length > 0}
                              fallback={
                                <span
                                  class="text-xs text-gray-400 dark:text-gray-400"
                                  title="Ad accounts"
                                >
                                  {count(r.ad_accounts)}
                                </span>
                              }
                            >
                              <button
                                type="button"
                                onClick={() => toggleExpand(key, "accounts")}
                                aria-expanded={acctsOpen()}
                                title="Show ad accounts"
                                class={`inline-flex items-center gap-0.5 text-xs font-semibold hover:underline ${
                                  r.ad_account_list.some(
                                    (a) => !adAccountStatus(a.account_status).ok,
                                  )
                                    ? "text-[#B07A14] dark:text-yellow-300"
                                    : "text-[#3E6FB0] dark:text-blue-300"
                                }`}
                              >
                                {count(r.ad_accounts)}
                                <span
                                  class={`text-[9px] transition-transform ${acctsOpen() ? "rotate-180" : ""}`}
                                  aria-hidden="true"
                                >
                                  ▾
                                </span>
                              </button>
                            </Show>
                          </td>

                          {/* ── Everything from here to Premium spend is the
                              dated block the group header names ── */}

                          {/* Daily budget */}
                          <td
                            class={`${NUM} font-semibold text-gray-800 dark:text-gray-100 border-l border-gray-100 dark:border-gray-800`}
                          >
                            {inr(r.daily_budget)}
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
                              date filter says. Never summed. The vertical rules
                              close the dated block on its left, so the eye can
                              see this column is not in it. */}
                          <td
                            class={`${NUM} text-gray-800 dark:text-gray-100 border-x border-gray-100 dark:border-gray-800`}
                          >
                            <span
                              class="border-b border-dotted border-gray-300 dark:border-gray-600 cursor-help"
                              title={balanceSourceNote(r.balance_source)}
                            >
                              {inr(r.balance_inc_gst)}
                            </span>
                            {/* Hybrid on Credit Notes only — null otherwise. */}
                            <Show when={r.credit_notes_inc_gst != null}>
                              <div
                                class="text-[11px] font-normal text-[#3E6FB0] dark:text-blue-300"
                                title="Replaced Credit Notes left (inc GST). They pay this client's charges before the main balance."
                              >
                                + {inr(r.credit_notes_inc_gst)} replaced credit notes
                              </div>
                            </Show>
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

                        {/* Ad accounts — current state, not date-scoped. */}
                        <Show when={acctsOpen()}>
                          <tr class="bg-[#F6F9FC] dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                            <td colspan={COLS} class="px-3 py-3">
                              <AdAccountList accounts={r.ad_account_list} />
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
      <p class="mt-5 text-[12px] text-gray-400 dark:text-gray-400">
        The dated columns are computed in Asia/Kolkata by the server, and the
        header shows the window it resolved — not this browser's arithmetic.
        Balance is always the current month, so it matches what the client sees
        on their billing page and what accounts would quote. Hover a balance to
        see where it came from.
      </p>
      <p class="mt-1.5 text-[12px] text-gray-400 dark:text-gray-400">
        <b class="font-semibold">
          This page opens on delivering clients only
        </b>{" "}
        — leads or spend in the last 7 days — so the counts and every total
        above describe that set, not the full client list. Use{" "}
        <b class="font-semibold">Include dormant</b> for everyone. The 7 days is
        a fixed window that does not follow the date range, so a client dormant
        for a month stays hidden even on Last 30 Days. And it tests delivery,
        not campaign state: clients still producing leads from since-paused
        campaigns count as delivering.
      </p>
      <p class="mt-1.5 text-[12px] text-gray-400 dark:text-gray-400">
        Balance is deliberately not totalled: a CPL client bills per qualified
        lead with no service charge and no GST, a hybrid bills on spend plus
        both. Adding the column would produce a number that means nothing.
      </p>
      {/* Only once the backend sends the field — before the release this would
          describe a change no row on screen reflects. */}
      <Show when={rows().some((r) => r.credit_notes_inc_gst != null)}>
      <p class="mt-1.5 text-[12px] text-gray-400 dark:text-gray-400">
        From September 2026 a hybrid client's replaced leads go into Credit
        Notes instead of reducing the bill. Their balance is the main balance
        after this month's charge, with any Replaced Credit Notes left shown beneath it.
      </p>
      </Show>
      <p class="mt-1.5 text-[12px] text-gray-400 dark:text-gray-400">
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
          class="text-gray-300 dark:text-gray-400"
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
          class="text-gray-400 dark:text-gray-400 cursor-help"
          title="No client type on this row, so we can't tell whether the blank is a retainer (expected) or a missing pricing config (a problem)."
        >
          ?
        </span>
      </Match>
    </Switch>
  );
}

// ── Ad account picker ─────────────────────────────────────────────────────────
// Type to search by account name or Meta account id; options come from the rows
// in hand (see accountOptions). value is the account key, "" for all.
function AdAccountPicker(props) {
  const [open, setOpen] = createSignal(false);
  const [query, setQuery] = createSignal("");
  let wrap;
  let input;

  const onDocClick = (e) => {
    if (wrap && !wrap.contains(e.target)) setOpen(false);
  };
  document.addEventListener("mousedown", onDocClick);
  onCleanup(() => document.removeEventListener("mousedown", onDocClick));

  const label = (o) =>
    o.name && o.account_id ? `${o.name} · ${o.account_id}` : (o.name ?? o.account_id);
  const selected = () => props.options.find((o) => o.key === props.value) ?? null;
  const filtered = () => {
    const q = query().trim().toLowerCase();
    if (!q) return props.options;
    return props.options.filter((o) => String(label(o)).toLowerCase().includes(q));
  };
  const choose = (key) => {
    props.onChange(key);
    setQuery("");
    setOpen(false);
    input?.blur();
  };

  return (
    <div class="relative w-full sm:w-[300px]" ref={wrap}>
      <input
        ref={input}
        type="text"
        placeholder="All ad accounts — search…"
        value={open() ? query() : selected() ? label(selected()) : ""}
        onFocus={() => setOpen(true)}
        onInput={(e) => {
          setQuery(e.currentTarget.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            input?.blur();
          } else if (e.key === "Enter") {
            e.preventDefault();
            const first = filtered()[0];
            if (first) choose(first.key);
          }
        }}
        class={`w-full pl-3 pr-8 py-2 text-sm rounded-lg border dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600 ${
          selected()
            ? "border-[#3E6FB0] bg-[#ECF2FA]"
            : "border-gray-200 dark:border-gray-700"
        }`}
      />
      <Show
        when={selected()}
        fallback={
          <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
            ▾
          </span>
        }
      >
        <button
          type="button"
          title="All ad accounts"
          onClick={() => choose("")}
          class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-[#AC2334] text-lg leading-none px-1"
        >
          ×
        </button>
      </Show>
      <Show when={open()}>
        <div class="absolute z-50 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-xl">
          <Show
            when={filtered().length}
            fallback={
              <p class="px-3 py-3 text-sm text-gray-400">No ad accounts match.</p>
            }
          >
            <For each={filtered()}>
              {(o) => (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(o.key);
                  }}
                  class={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-sm text-gray-800 dark:text-gray-100 hover:bg-[#FBEEF0] dark:hover:bg-gray-800 ${
                    o.key === props.value ? "bg-[#FBEEF0] dark:bg-gray-800 font-semibold" : ""
                  }`}
                >
                  <span class="min-w-0">
                    <span class="block truncate">{o.name ?? o.account_id}</span>
                    <Show when={o.name && o.account_id}>
                      <span class="block font-mono text-[11px] text-gray-400">
                        {o.account_id}
                      </span>
                    </Show>
                  </span>
                  <span class="flex-none text-[11px] tabular-nums text-gray-400">
                    {o.clients} {o.clients === 1 ? "client" : "clients"}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  );
}

// ── Ad accounts ───────────────────────────────────────────────────────────────
// Status 1 is the only healthy one; every other code reads as a warning. A
// postpaid account has no balance to show — "Not prepaid", never ₹0.
function AdAccountList(props) {
  const ATH =
    "px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400 whitespace-nowrap";
  return (
    <div>
      <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">
        Ad accounts · as they stand now
      </p>
      <div class="max-w-4xl overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        <table class="min-w-full text-[13px]">
          <thead>
            <tr class="border-b border-gray-100 dark:border-gray-800">
              <th class={ATH}>Account</th>
              <th class={ATH}>Portfolio</th>
              <th class={ATH}>Status</th>
              <th class={`${ATH} text-right`}>Available balance</th>
              <th class={`${ATH} text-right`}>Active campaigns</th>
            </tr>
          </thead>
          <tbody>
            <For each={props.accounts}>
              {(a) => {
                const st = () => adAccountStatus(a.account_status);
                return (
                  <tr class="border-b last:border-0 border-gray-100 dark:border-gray-800">
                    <td class="px-3 py-2">
                      <p class="font-medium text-gray-800 dark:text-gray-100 max-w-[260px] truncate" title={a.name ?? ""}>
                        {a.name || <Missing>No name</Missing>}
                      </p>
                      <p class="text-[11px] tabular-nums text-gray-400">
                        {a.account_id || DASH}
                      </p>
                    </td>
                    <td class="px-3 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                      {a.portfolio || <Missing />}
                    </td>
                    <td class="px-3 py-2">
                      <span
                        class={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-[2px] rounded-full whitespace-nowrap ${
                          st().ok
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                            : "bg-[#FBF3E2] text-[#8A6410] border border-[#B07A14]/40 dark:bg-yellow-900/25 dark:text-yellow-200"
                        }`}
                        title={`Meta account_status ${a.account_status ?? "?"}`}
                      >
                        <Show when={!st().ok}>
                          <span aria-hidden="true">⚠</span>
                        </Show>
                        {st().label}
                      </span>
                    </td>
                    <td
                      class={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${
                        a.is_prepay
                          ? "font-semibold text-gray-800 dark:text-gray-100"
                          : "text-gray-400 dark:text-gray-500 italic"
                      }`}
                    >
                      {adAccountBalance(a)}
                    </td>
                    <td class="px-3 py-2 text-right tabular-nums text-gray-800 dark:text-gray-100">
                      {count(a.active_campaigns)}
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </div>
    </div>
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
          class="max-w-[170px] truncate text-xs text-gray-400 dark:text-gray-400"
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
              class="text-xs font-semibold text-[#3E6FB0] dark:text-blue-300 hover:underline"
            >
              Sheet ↗
            </a>
          </Show>
          <Show when={!isUnrecorded(r.destination_contact)}>
            <span
              class="max-w-[140px] truncate text-xs text-gray-400 dark:text-gray-400"
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
