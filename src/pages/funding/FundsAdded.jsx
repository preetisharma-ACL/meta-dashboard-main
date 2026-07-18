import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { fetchFundsAdded } from "../../services/funding";
import { scopeKey } from "../../stores/cmScope";
import Avatar from "../../components/common/Avatar";
import useColumnSort from "../../components/Columnsorting";
import ClientTypeFilter, {
  DEFAULT_CLIENT_TYPES,
  toggleClientTypeIn,
} from "../../components/funding/ClientTypeFilter";

// ─────────────────────────────────────────────────────────────────────────────
// "Funds Added by Date" — a SEPARATE page (sidebar submenu under Accounts &
// Funding), distinct from the main Account Funding table. Shows how much money
// was LOADED into each ad account on a chosen date: a total card on top (matches
// the funding page's summary-card design) + a per-account breakdown below.
//
// Switch-mode aware and same auth as the funding page — admins see all accounts,
// CMs see their scoped accounts (handled server-side). Resource keyed on scope +
// date so it refetches on either change.
//
// Data is FORWARD-ONLY — "funds added on a day" needs balance snapshots from
// BEFORE that day. For the first ~1-2 days after snapshotting began, accounts
// return added:null and total_added:"0.00" with a high accounts_without_data.
// That's expected, not a bug — we show a friendly "collecting data" note instead
// of an empty/zero table. Project palette follows AccountFunding (navy ink
// #14233A, brand red #AC2334, green #15966A, slate text).
// ─────────────────────────────────────────────────────────────────────────────

// ─── Money / null discipline (mirrors AccountFunding) ─────────────────────────
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

// A "dust" amount — displayably zero (< ₹0.01). Used to omit zero-portion type
// chips and to hide zero-value rows behind the "show zero rows" link. null (a
// no-data row) is never dust — those keep their own "no data" state.
const isDust = (v) => {
  if (v == null) return false;
  const n = parseFloat(v);
  return isFinite(n) && Math.abs(n) < 0.01;
};

// ─── Type-breakdown chips + expander ──────────────────────────────────────────
// The backend attributes each day's loads across client types in proportion to
// that day's spend (attribution: "spend-share"). Each per_account row carries a
// type_breakdown[] of { client_type, day_spend, portion } whose portions sum to
// added_full exactly. client_type is one of cpl/hybrid/retainer, plus "unknown"
// (spend on an account with no typed client) and "unattributed" (loads made
// before any spend that day — not yet attributable). Chip palette mirrors
// AccountFunding's per-client TYPE_CHIP, extended with the two synthetic types.
const TB_META = {
  cpl: { label: "CPL", chip: "bg-[#E9F7F1] text-[#15966A] dark:bg-teal-900/30 dark:text-teal-300" },
  hybrid: { label: "Hybrid", chip: "bg-[#ECF2FA] text-[#3E6FB0] dark:bg-indigo-900/30 dark:text-indigo-300" },
  retainer: { label: "Retainer", chip: "bg-[#FBF3E2] text-[#B07A14] dark:bg-amber-900/30 dark:text-amber-300" },
  unknown: { label: "Untyped", chip: "bg-[#EEF2F7] text-[#54657E] dark:bg-gray-700 dark:text-gray-300" },
  unattributed: { label: "Pending", chip: "bg-[#F1F4F9] text-[#8593A8] dark:bg-gray-800 dark:text-gray-400" },
};
const tbMeta = (t) =>
  TB_META[t] ?? { label: t || "—", chip: "bg-[#EEF2F7] text-[#54657E] dark:bg-gray-700 dark:text-gray-300" };
const sumMoney = (items, key) =>
  items.reduce((s, b) => s + (parseFloat(b[key]) || 0), 0);

// Per-account "Pending" (unattributed) portion — loads with no spend yet to
// attribute against. Summed across accounts this drives the total-card note.
const rowUnattributed = (r) =>
  (Array.isArray(r.type_breakdown) ? r.type_breakdown : [])
    .filter((b) => b.client_type === "unattributed")
    .reduce((s, b) => s + (parseFloat(b.portion) || 0), 0);

// Non-zero-portion breakdown entries (chips/expander omit zero-portion ones).
const tbEntries = (r) =>
  (Array.isArray(r.type_breakdown) ? r.type_breakdown : []).filter(
    (b) => !isDust(b.portion),
  );

// ─── Date helpers (LOCAL time — never toISOString, which is UTC and can slip a
// day across the IST offset) ─────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, "0");
const toYMD = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayYMD = () => toYMD(new Date());
const shiftYMD = (ymd, days) => {
  const d = new Date(`${ymd}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toYMD(d);
};
const prettyYMD = (ymd) => {
  const d = new Date(`${ymd}T00:00:00`);
  if (!isFinite(d.getTime())) return ymd;
  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

// ─── Ad-account id pill (click to copy) — same affordance as AccountFunding ────
function AccountIdPill(props) {
  const [copied, setCopied] = createSignal(false);
  const copy = (e) => {
    e.stopPropagation();
    try {
      navigator.clipboard?.writeText(props.id);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  };
  return (
    <button
      onClick={copy}
      title="Click to copy account ID"
      class="group/id inline-flex items-center gap-1 mt-1 max-w-full pl-1.5 pr-2 py-0.5 rounded-md border border-[#E2E8F1] dark:border-gray-700 bg-[#EEF2F7] dark:bg-gray-800 hover:border-[#3E6FB0]/50 hover:bg-[#E7EEF7] dark:hover:bg-gray-700 transition-colors"
    >
      <Show
        when={!copied()}
        fallback={
          <svg class="w-3 h-3 flex-none text-[#15966A]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        }
      >
        <svg class="w-3 h-3 flex-none text-[#8593A8] group-hover/id:text-[#3E6FB0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" />
          <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
        </svg>
      </Show>
      <span class="font-mono text-[11px] leading-none text-[#54657E] dark:text-gray-400 group-hover/id:text-[#3E6FB0] dark:group-hover/id:text-blue-300 truncate">
        {copied() ? "Copied" : props.id}
      </span>
    </button>
  );
}

// Loads ARE now attributed across client types in proportion to that day's
// spend (backend attribution: "spend-share"), so the old "can't be split"
// caveat is obsolete. This is the info-icon tooltip on the client-type filter.
const MIXED_ACCOUNT_CAVEAT =
  "Each day's loads are attributed across client types in proportion to that day's spend on this account. Filtered totals show money for the selected types; loads made before any spend appear as 'Pending' until spend begins. Full-wallet figures stay visible per account.";

// ─── Per-account type-breakdown sub-table (expanded row) ──────────────────────
// Mirrors AccountFunding's ClientBreakdown: one line per breakdown entry
// (type, day spend, portion) plus an ALL line that equals added_full — the
// same visual reconciliation, since the portions sum to added_full exactly.
function TypeBreakdown(props) {
  const list = () => (Array.isArray(props.items) ? props.items : []);
  return (
    <Show
      when={list().length > 0}
      fallback={
        <p class="px-4 py-3 text-xs italic text-[#8593A8] dark:text-gray-500">
          No client-type breakdown for this account.
        </p>
      }
    >
      <table class="min-w-full text-[13px]">
        <thead>
          <tr class="text-[#8593A8] dark:text-gray-400 uppercase text-[10px] font-bold tracking-wider">
            <th class="py-2 pl-4 pr-3 text-left">Client type</th>
            <th class="py-2 px-3 text-right whitespace-nowrap">Day spend</th>
            <th class="py-2 pl-3 pr-4 text-right whitespace-nowrap">Attributed</th>
          </tr>
        </thead>
        <tbody>
          <For each={list()}>
            {(b) => (
              <tr class="border-t border-[#E2E8F1] dark:border-gray-800">
                <td class="py-2 pl-4 pr-3 text-left">
                  <span
                    class={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${tbMeta(b.client_type).chip}`}
                  >
                    {tbMeta(b.client_type).label}
                  </span>
                </td>
                <td class="py-2 px-3 text-right text-[#54657E] dark:text-gray-400 tabular-nums whitespace-nowrap">
                  {money2(b.day_spend) ?? "—"}
                </td>
                <td class="py-2 pl-3 pr-4 text-right font-semibold text-[#1A2B45] dark:text-gray-200 tabular-nums whitespace-nowrap">
                  {money2(b.portion) ?? "—"}
                </td>
              </tr>
            )}
          </For>
        </tbody>
        {/* ALL line — reconciles to added_full (== Σ of the portions above) */}
        <tfoot>
          <tr class="border-t-2 border-[#D4DDE9] dark:border-gray-700 bg-white/60 dark:bg-gray-900/30">
            <td class="py-2 pl-4 pr-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
              All types
            </td>
            <td class="py-2 px-3 text-right font-bold text-[#14233A] dark:text-gray-100 tabular-nums whitespace-nowrap">
              {money2(String(sumMoney(list(), "day_spend")))}
            </td>
            <td class="py-2 pl-3 pr-4 text-right font-extrabold text-[#15966A] dark:text-green-400 tabular-nums whitespace-nowrap">
              {money2(props.addedFull) ?? "—"}
            </td>
          </tr>
        </tfoot>
      </table>
    </Show>
  );
}

export default function FundsAdded() {
  const today = todayYMD();
  const [date, setDate] = createSignal(today);
  const [clientTypes, setClientTypes] = createSignal(DEFAULT_CLIENT_TYPES);

  const toggleClientType = (key) =>
    setClientTypes((prev) => toggleClientTypeIn(prev, key));

  // Refetch on scope change (switch-mode), on a new date, OR when the
  // client-type filter changes — the backend re-scopes which accounts are in
  // the set and recomputes total_added over them.
  const [funds] = createResource(
    () => ({ scope: scopeKey(), date: date(), types: clientTypes() }),
    async (s) => (await fetchFundsAdded(s.date, s.types)) ?? null,
  );

  const perAccount = () =>
    Array.isArray(funds()?.per_account) ? funds().per_account : [];
  const withData = () => Number(funds()?.accounts_with_data) || 0;
  const withoutData = () => Number(funds()?.accounts_without_data) || 0;
  const totalAdded = () => funds()?.total_added ?? "0.00";

  // "Named" = any selection short of all three types. Under all three the
  // backend reports each account's whole wallet (added == added_full), so the
  // "of ₹… total" suffix and the Pending note only make sense under a NAMED
  // selection. (The suffix is also self-guarding: it keys off added != added_full,
  // which never holds under all-three.) Only three type keys exist, so length 3
  // is exactly the all-three view.
  const named = () => clientTypes().length < 3;

  // Pending (unattributed) loaded today — money loaded before any spend, so not
  // yet attributable to a type. Summed from the per-account breakdown. On all
  // observed data this equals meta.unattributed_total (which funding.js does not
  // surface to the component); shown as a note under the total card.
  const unattributedTotal = () =>
    perAccount().reduce((s, r) => s + rowUnattributed(r), 0);

  // Display-only epsilon: rows whose `added` is < ₹0.01 are hidden behind a
  // "show zero rows" link. Data is untouched — totals still come from the server.
  const [showZero, setShowZero] = createSignal(false);

  // Per-account type-breakdown expander (mirrors AccountFunding's row expander).
  const [openRows, setOpenRows] = createSignal({});
  const rowKey = (r) => r.account_id ?? r.meta_account_id ?? r.name;
  const isOpen = (r) => !!openRows()[rowKey(r)];
  const toggleRow = (r) =>
    setOpenRows((o) => ({ ...o, [rowKey(r)]: !o[rowKey(r)] }));
  const expandable = (r) => tbEntries(r).length > 0;

  // ─── Search by account name + column sorting ────────────────────────────────
  const [search, setSearch] = createSignal("");

  // Same hook + ⇅/↑/↓ icons as the rest of the project. No column selected → API
  // order (funds-added desc) is preserved.
  const { columnSort, handleSort, getSortIcon } = useColumnSort();

  // Sort arrow next to a header label: brand-red when active, slate when idle.
  const SortIcon = (props) => (
    <span
      class={`ml-1 text-xs font-bold ${columnSort().key === props.col ? "text-[#AC2334] dark:text-red-400" : "text-[#8593A8] dark:text-gray-400"}`}
    >
      {getSortIcon(props.col)}
    </span>
  );

  // Sort accessor — money fields are strings, so parse them; no-data rows resolve
  // to null and are pushed to the bottom either way.
  const sortValue = (r, key) => {
    switch (key) {
      case "name":
        return (r.name || "").toLowerCase();
      case "available_start":
      case "available_end":
      case "spend":
      case "added": {
        const n = parseFloat(r[key]);
        return isFinite(n) ? n : null;
      }
      default:
        return null;
    }
  };

  // Display filter (search by account name) + optional sort. API order preserved
  // until a header is clicked.
  const sorted = createMemo(() => {
    const q = search().trim().toLowerCase();
    const filtered = q
      ? perAccount().filter((r) => r.name?.toLowerCase().includes(q))
      : perAccount();

    const { key, direction } = columnSort();
    if (!key) return filtered; // preserve the API's funds-added-desc order

    const empty = (v) => v == null || (typeof v === "number" && !isFinite(v));
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      if (empty(va) && empty(vb)) return 0;
      if (empty(va)) return 1; // nulls/no-data always last
      if (empty(vb)) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return direction === "asc" ? va - vb : vb - va;
      }
      return direction === "asc"
        ? String(va).localeCompare(String(vb), undefined, { sensitivity: "base" })
        : String(vb).localeCompare(String(va), undefined, { sensitivity: "base" });
    });
  });

  // Dust rows (added < ₹0.01, non-null) hidden unless "show zero rows" is on.
  // No-data rows (added == null) are never dust — they keep their own state.
  const hiddenDustCount = () => sorted().filter((r) => isDust(r.added)).length;
  const rows = createMemo(() =>
    showZero() ? sorted() : sorted().filter((r) => !isDust(r.added)),
  );

  // "Still collecting" — snapshots haven't spanned a full day yet, so no account
  // can compute an "added" figure. total_added is "0.00" and nothing has data.
  const collecting = () =>
    !funds.loading &&
    !!funds() &&
    (parseFloat(totalAdded()) || 0) === 0 &&
    withData() === 0;

  const isToday = () => date() === today;
  const isYesterday = () => date() === shiftYMD(today, -1);

  return (
    <div class="font-sans min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div class="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Coordination · Funding
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white tracking-tight">
            Funds Added by Date
          </h1>
          <p class="text-sm text-[#54657E] dark:text-gray-400 mt-1">
            Money loaded into ad accounts on the selected day — reflects wallet
            balance changes since snapshots began.
          </p>
        </div>

        {/* Date picker: quick Today / Yesterday + a specific date */}
        <div class="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setDate(today)}
            class={`px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors ${
              isToday()
                ? "bg-[#14233A] text-white border-[#14233A]"
                : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
            }`}
          >
            Today
          </button>
          <button
            onClick={() => setDate(shiftYMD(today, -1))}
            class={`px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors ${
              isYesterday()
                ? "bg-[#14233A] text-white border-[#14233A]"
                : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
            }`}
          >
            Yesterday
          </button>
          <input
            type="date"
            value={date()}
            max={today}
            onInput={(e) => e.target.value && setDate(e.target.value)}
            class="border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 rounded-lg px-3 py-2 text-[13px] font-semibold text-[#1A2B45] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] cursor-pointer"
          />
        </div>
      </div>

      {/* ════ CLIENT-TYPE FILTER (same chips + default as Account Funding) ════ */}
      <ClientTypeFilter
        value={clientTypes()}
        onToggle={toggleClientType}
        caveat={MIXED_ACCOUNT_CAVEAT}
      />

      {/* Error */}
      <Show when={funds.error}>
        <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">
          Couldn’t load funds-added data for this date. Please try again.
        </div>
      </Show>

      {/* ════ TOTAL CARD (matches the funding summary-card design) ════ */}
      <Show
        when={!funds.loading && funds()}
        fallback={
          <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-6 mb-4">
            <div class="h-9 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            <div class="h-3 w-64 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse mt-6" />
          </div>
        }
      >
        <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] px-5 sm:px-7 py-6 mb-5">
          <div class="flex flex-wrap items-stretch gap-y-5">
            <div class="px-0 sm:pr-7 flex-1 min-w-[200px]">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Total funds added · {prettyYMD(date())}
              </p>
              <p class="text-xl sm:text-2xl font-bold text-[#15966A] dark:text-green-400 mt-2">
                {moneyWhole(totalAdded())}
              </p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-2">
                loaded into ad accounts on this day
              </p>
            </div>
            <div class="px-5 sm:px-7 flex-1 min-w-[150px] border-l border-[#E2E8F1] dark:border-gray-700">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Accounts with data
              </p>
              <p class="text-xl font-bold text-[#14233A] dark:text-white mt-2">
                {num(withData())}
              </p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-2">
                had a comparable balance history
              </p>
            </div>
            <div class="px-5 sm:pl-7 flex-1 min-w-[150px] border-l border-[#E2E8F1] dark:border-gray-700">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Awaiting history
              </p>
              <p class="text-xl font-bold text-gray-700 dark:text-white mt-2">
                {num(withoutData())}
              </p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-2">
                no baseline before this day yet
              </p>
            </div>
          </div>

          {/* Pending (unattributed) — only under a NAMED selection, when there
              are loads made before any spend that can't yet be attributed. */}
          <Show when={named() && unattributedTotal() >= 0.01}>
            <p class="mt-4 pt-3 border-t border-[#E2E8F1] dark:border-gray-700 text-xs text-[#8593A8] dark:text-gray-400">
              + {money2(String(unattributedTotal()))} loaded today, not yet
              attributable (no spend yet)
            </p>
          </Show>
        </div>
      </Show>

      {/* ════ COLLECTING-DATA EMPTY STATE ════ */}
      <Show when={collecting()}>
        <div class="bg-[#FBF3E2] dark:bg-amber-950/30 border border-[#B07A14]/40 dark:border-amber-700/60 rounded-2xl p-6 flex items-start gap-3.5">
          <span class="flex items-center justify-center w-9 h-9 flex-none rounded-full bg-[#F6E2B8] dark:bg-amber-900/40 text-[#8A5D10] dark:text-amber-300">
            <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </span>
          <div>
            <p class="text-sm font-bold text-[#8A5D10] dark:text-amber-300">
              Funds-added data is being collected
            </p>
            <p class="text-sm text-[#7A6636] dark:text-amber-200/80 mt-1 leading-snug">
              Figures will appear once a full day of balance history is available.
              This feature compares balance snapshots from before the selected day,
              so please check back tomorrow.
            </p>
          </div>
        </div>
      </Show>

      {/* ════ PER-ACCOUNT BREAKDOWN ════ */}
      <Show when={!funds.loading && !collecting() && perAccount().length > 0}>
        {/* Search by account name */}
        <div class="mb-4 flex items-center gap-3 flex-wrap">
          <div class="relative flex-1 min-w-[220px] max-w-md">
            <svg class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#8593A8] dark:text-gray-500 pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={search()}
              onInput={(e) => setSearch(e.target.value)}
              placeholder="Search account by name…"
              class="w-full border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 rounded-lg pl-9 pr-8 py-2 text-[13px] font-medium text-[#1A2B45] dark:text-gray-200 placeholder:text-[#8593A8] dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334]"
            />
            <Show when={search()}>
              <button
                onClick={() => setSearch("")}
                title="Clear search"
                class="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded text-[#8593A8] dark:text-gray-500 hover:text-[#AC2334] dark:hover:text-red-400"
              >
                <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </Show>
          </div>
          <Show when={search()}>
            <span class="text-[13px] font-medium text-[#54657E] dark:text-gray-400">
              {num(rows().length)} of {num(perAccount().length)} account{perAccount().length !== 1 ? "s" : ""}
            </span>
          </Show>

          {/* Epsilon: reveal/hide near-zero (< ₹0.01) rows. Display-only. */}
          <Show when={showZero() || hiddenDustCount() > 0}>
            <button
              onClick={() => setShowZero((v) => !v)}
              class="ml-auto text-[13px] font-semibold text-[#3E6FB0] dark:text-blue-300 hover:underline whitespace-nowrap"
            >
              {showZero()
                ? "Hide zero rows"
                : `Show ${num(hiddenDustCount())} zero row${hiddenDustCount() !== 1 ? "s" : ""}`}
            </button>
          </Show>
        </div>

        <Show
          when={rows().length > 0}
          fallback={
            <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 py-16 text-center text-[#8593A8] dark:text-gray-500">
              No accounts match “{search()}”.
            </div>
          }
        >
        <div class="block bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] overflow-auto">
          <table class="min-w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr class="bg-[#F8FAFC] dark:bg-gray-800 text-[#54657E] dark:text-gray-400 uppercase text-xs font-semibold tracking-wider">
                <th class="p-4 text-center whitespace-nowrap w-16 border-b border-[#D4DDE9] dark:border-gray-700">
                  S.No
                </th>
                <th
                  onClick={() => handleSort("name")}
                  class="p-4 text-left whitespace-nowrap min-w-[220px] border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200"
                >
                  Account
                  <SortIcon col="name" />
                </th>
                <th
                  onClick={() => handleSort("available_start")}
                  class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200"
                >
                  Balance Start
                  <SortIcon col="available_start" />
                </th>
                <th
                  onClick={() => handleSort("available_end")}
                  class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200"
                >
                  Balance End
                  <SortIcon col="available_end" />
                </th>
                <th
                  onClick={() => handleSort("spend")}
                  class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200"
                >
                  Spend
                  <SortIcon col="spend" />
                </th>
                <th
                  onClick={() => handleSort("added")}
                  class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200"
                >
                  Funds Added
                  <SortIcon col="added" />
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>
                {(r, i) => {
                  const hasData = () => r.added != null;
                  const exp = () => expandable(r);
                  // Show the "of ₹… total" suffix only under a NAMED selection
                  // when the attributed amount is short of the whole wallet.
                  const partial = () =>
                    named() &&
                    r.added != null &&
                    r.added_full != null &&
                    Math.abs(parseFloat(r.added) - parseFloat(r.added_full)) >= 0.01;
                  return (
                    <>
                    <tr
                      onClick={() => exp() && toggleRow(r)}
                      class={`group transition-colors ${exp() ? "cursor-pointer select-none" : ""} ${isOpen(r) ? "bg-[#F6F9FC] dark:bg-gray-800/40" : "hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40"}`}
                    >
                      <td class="px-4 py-2.5 text-center align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                        <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#E9F7F1] dark:bg-green-900/30 text-[#15966A] dark:text-green-300 text-xs font-extrabold">
                          {i() + 1}
                        </span>
                      </td>
                      <td class="px-4 py-2.5 align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                        <div class="flex items-center gap-3">
                          <Show when={exp()} fallback={<span class="w-4 flex-none" />}>
                            <svg
                              class="w-4 h-4 flex-none text-[#8593A8] transition-transform"
                              style={{ transform: isOpen(r) ? "rotate(90deg)" : "rotate(0deg)" }}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                            >
                              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </Show>
                          <Avatar name={r.name} />
                          <div class="min-w-0">
                            <span
                              class="block text-blue-900 dark:text-gray-100 font-semibold truncate"
                              title={r.name}
                            >
                              {r.name}
                            </span>
                            {/* Type chips — one per non-zero breakdown portion */}
                            <Show when={tbEntries(r).length > 0}>
                              <div class="flex flex-wrap items-center gap-1 mt-1">
                                <For each={tbEntries(r)}>
                                  {(b) => (
                                    <span
                                      class={`text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide ${tbMeta(b.client_type).chip}`}
                                    >
                                      {tbMeta(b.client_type).label}
                                    </span>
                                  )}
                                </For>
                              </div>
                            </Show>
                            <Show when={r.meta_account_id}>
                              <AccountIdPill id={r.meta_account_id} />
                            </Show>
                          </div>
                        </div>
                      </td>
                      <Show
                        when={hasData()}
                        fallback={
                          <td
                            colspan="4"
                            class="px-4 py-2.5 text-right align-middle border-b border-[#E2E8F1] dark:border-gray-800"
                          >
                            <span
                              class="inline-flex items-center gap-1.5 text-[#8593A8] dark:text-gray-500 text-xs font-medium"
                              title={r.reason || "no baseline before this day"}
                            >
                              <span class="w-1.5 h-1.5 rounded-full bg-[#C4CDDA] dark:bg-gray-600 flex-none" />
                              no data
                            </span>
                          </td>
                        }
                      >
                        <td class="px-4 py-2.5 text-right align-middle text-[#54657E] dark:text-gray-300 tabular-nums whitespace-nowrap border-b border-[#E2E8F1] dark:border-gray-800">
                          {money2(r.available_start) ?? "—"}
                        </td>
                        <td class="px-4 py-2.5 text-right align-middle text-[#1A2B45] dark:text-gray-300 tabular-nums whitespace-nowrap border-b border-[#E2E8F1] dark:border-gray-800">
                          {money2(r.available_end) ?? "—"}
                        </td>
                        <td class="px-4 py-2.5 text-right align-middle text-[#54657E] dark:text-gray-400 tabular-nums whitespace-nowrap border-b border-[#E2E8F1] dark:border-gray-800">
                          {money2(r.spend) ?? "—"}
                        </td>
                        <td class="px-4 py-2.5 text-right align-middle font-bold text-[#15966A] dark:text-green-400 tabular-nums whitespace-nowrap border-b border-[#E2E8F1] dark:border-gray-800">
                          {money2(r.added) ?? "—"}
                          <Show when={partial()}>
                            <span class="block text-[10px] font-normal text-[#8593A8] dark:text-gray-500">
                              of {money2(r.added_full)} total
                            </span>
                          </Show>
                        </td>
                      </Show>
                    </tr>
                    {/* Expander — per-type reconciliation to added_full */}
                    <Show when={exp() && isOpen(r)}>
                      <tr>
                        <td colspan="6" class="p-0 bg-[#F8FAFC] dark:bg-gray-800/40 border-b border-[#E2E8F1] dark:border-gray-800">
                          <div class="px-6 py-3">
                            <p class="text-[10px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-500 mb-1 pl-4">
                              Attribution by client type
                            </p>
                            <TypeBreakdown items={tbEntries(r)} addedFull={r.added_full} />
                          </div>
                        </td>
                      </tr>
                    </Show>
                    </>
                  );
                }}
              </For>
            </tbody>
            <tfoot>
              <tr class="text-[13px]">
                <td class="bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3" />
                <td class="bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-300">
                  Total added · {num(withData())} account{withData() !== 1 ? "s" : ""}
                </td>
                <td class="bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3" colspan="3" />
                <td class="bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3 text-right font-extrabold text-[#15966A] dark:text-green-400 tabular-nums whitespace-nowrap">
                  {money2(String(parseFloat(totalAdded()) || 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        </Show>
      </Show>

      {/* No accounts at all (in scope) for this date, but not the collecting state */}
      <Show when={!funds.loading && !collecting() && perAccount().length === 0 && funds()}>
        <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 py-16 text-center text-[#8593A8] dark:text-gray-500">
          No accounts to show for this date.
        </div>
      </Show>
    </div>
  );
}
