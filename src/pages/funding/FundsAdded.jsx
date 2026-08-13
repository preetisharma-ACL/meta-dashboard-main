import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import { fetchFundsAdded } from "../../services/funding";
import { scopeKey } from "../../stores/cmScope";
import Avatar from "../../components/common/Avatar";
import useColumnSort from "../../components/Columnsorting";
import ClientTypeFilter, {
  CLIENT_TYPES,
  DEFAULT_CLIENT_TYPES,
  toggleClientTypeIn,
} from "../../components/funding/ClientTypeFilter";

// Every client type the filter knows about — the "unfiltered" selection used to
// source pending (unattributed) accounts, which belong to no type at all.
const ALL_CLIENT_TYPES = CLIENT_TYPES.map((t) => t.key);

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
// DD-MM-YYYY, matching the label the native date input used to show.
const dmy = (ymd) => {
  const p = ymd?.split("-");
  return p && p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : ymd || "";
};

// ─── Custom calendar field ────────────────────────────────────────────────────
// Drop-in replacement for <input type="date"> whose native dropdown can't be
// themed. Same contract as the native input — props.value is a YMD string,
// props.max caps the selectable day, props.onChange receives the chosen YMD — so
// the surrounding date logic is unchanged; only the presentation is redesigned.
const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const ymdParts = (ymd) => {
  const d = new Date(`${ymd}T00:00:00`);
  return isFinite(d.getTime())
    ? { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() }
    : null;
};

function DateField(props) {
  const [open, setOpen] = createSignal(false);
  const [view, setView] = createSignal(null); // {y, m} month shown in the grid

  const openCal = () => {
    const s = ymdParts(props.value) ?? ymdParts(props.max) ?? ymdParts(todayYMD());
    setView({ y: s.y, m: s.m });
    setOpen(true);
  };
  const toggle = () => (open() ? setOpen(false) : openCal());

  // 6-week (42-cell) grid for the viewed month; leading/trailing days spill in
  // from the adjacent months and render greyed.
  const grid = createMemo(() => {
    const v = view();
    if (!v) return [];
    // Monday-first: shift Sun(0) to the end of the week.
    const startDow = (new Date(v.y, v.m, 1).getDay() + 6) % 7;
    const start = new Date(v.y, v.m, 1 - startDow);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { ymd: toYMD(d), day: d.getDate(), inMonth: d.getMonth() === v.m };
    });
  });

  const stepMonth = (delta) =>
    setView((v) => {
      const d = new Date(v.y, v.m + delta, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  const jumpMonth = (m) => setView((v) => ({ y: v.y, m }));

  const isFuture = (ymd) => props.max && ymd > props.max;
  const choose = (ymd) => {
    if (isFuture(ymd)) return;
    props.onChange?.(ymd);
    setOpen(false);
  };

  return (
    <div class="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open()}
        class={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 ${
          open()
            ? "border-[#AC2334] bg-white dark:bg-gray-800 text-[#14233A] dark:text-white ring-2 ring-[#AC2334]/25"
            : "border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 text-[#1A2B45] dark:text-gray-200 hover:border-[#14233A]/40"
        }`}
      >
        <span class="tabular-nums tracking-wide">{dmy(props.value)}</span>
        <svg
          class="w-4 h-4 text-[#AC2334]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <rect x="3" y="4" width="18" height="18" rx="2.5" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      </button>

      <Show when={open()}>
        {/* Click-away backdrop */}
        <div class="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div class="absolute right-0 mt-2 z-50 w-[264px] rounded-[20px] bg-[#F4F5FA] dark:bg-gray-800 shadow-[0_18px_40px_-12px_rgba(16,29,49,.28)] ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
          {/* Card */}
          <div class="rounded-[20px] bg-white dark:bg-gray-800 shadow-[0_8px_24px_-10px_rgba(16,29,49,.18)] px-4 pt-4 pb-3">
            {/* Header: month/year + red nav pills */}
            <div class="flex items-center justify-between mb-2.5">
              <div class="text-[16px] font-extrabold text-[#14233A] dark:text-white tracking-tight">
                <Show when={view()}>
                  {(v) => `${MONTHS[v().m]} ${v().y}`}
                </Show>
              </div>
              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => stepMonth(-1)}
                  aria-label="Previous month"
                  class="w-7 h-7 grid place-items-center rounded-[9px] text-white bg-[#AC2334] hover:bg-[#8f1c2b] shadow-sm shadow-[#AC2334]/30 active:scale-95 transition-all"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
                </button>
                <button
                  type="button"
                  onClick={() => stepMonth(1)}
                  aria-label="Next month"
                  class="w-7 h-7 grid place-items-center rounded-[9px] text-white bg-[#AC2334] hover:bg-[#8f1c2b] shadow-sm shadow-[#AC2334]/30 active:scale-95 transition-all"
                >
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                </button>
              </div>
            </div>

            <div class="h-px bg-[#EBEEF3] dark:bg-gray-700 -mx-4 mb-2" />

            {/* Weekday labels */}
            <div class="grid grid-cols-7">
              <For each={WEEKDAYS}>
                {(w) => (
                  <div class="h-7 grid place-items-center text-[11px] font-bold text-[#14233A] dark:text-gray-200">
                    {w}
                  </div>
                )}
              </For>
            </div>

            {/* Day grid */}
            <div class="grid grid-cols-7 gap-y-0.5">
              <For each={grid()}>
                {(cell) => {
                  const selected = () => cell.ymd === props.value;
                  const isTodayCell = () => cell.ymd === todayYMD();
                  const disabled = () => isFuture(cell.ymd);
                  return (
                    <button
                      type="button"
                      disabled={disabled()}
                      onClick={() => choose(cell.ymd)}
                      class={`relative h-8 grid place-items-center rounded-[9px] text-[12.5px] font-semibold transition-colors ${
                        selected()
                          ? "bg-[#F5333F] text-white shadow-md shadow-[#F5333F]/35"
                          : disabled()
                            ? "text-[#CFD7E2] dark:text-gray-600 cursor-not-allowed"
                            : cell.inMonth
                              ? "text-[#3A4A61] dark:text-gray-200 hover:bg-[#F4F5FA] dark:hover:bg-gray-700"
                              : "text-[#C7CFDB] dark:text-gray-600 hover:bg-[#F8F9FC] dark:hover:bg-gray-700/60"
                      }`}
                    >
                      {cell.day}
                      <Show when={isTodayCell() && !selected()}>
                        <span class="absolute bottom-[3px] w-[3px] h-[3px] rounded-full bg-[#F5333F]" />
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          {/* Month strip — jumps the calendar to that month (within the year) */}
          <div class="px-3 pt-2.5 pb-3">
            <div class="grid grid-cols-12 gap-0.5">
              <For each={MONTHS_SHORT}>
                {(mo, i) => {
                  const active = () => view()?.m === i();
                  return (
                    <button
                      type="button"
                      onClick={() => jumpMonth(i())}
                      class="group flex flex-col items-center gap-1 py-0.5"
                    >
                      <span
                        class={`text-[8.5px] font-semibold transition-colors ${
                          active()
                            ? "text-[#14233A] dark:text-white"
                            : "text-[#A9B4C4] dark:text-gray-500 group-hover:text-[#54657E]"
                        }`}
                      >
                        {mo}
                      </span>
                      <span
                        class={`w-1.5 h-1.5 rounded-full transition-colors ${
                          active()
                            ? "bg-[#F5333F]"
                            : "bg-[#D3DAE4] dark:bg-gray-600 group-hover:bg-[#AFB9C7]"
                        }`}
                      />
                    </button>
                  );
                }}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}

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
  // which never holds under all-three.) Only three type keys exist, so a
  // full-length selection is exactly the all-three view.
  const named = () => clientTypes().length < ALL_CLIENT_TYPES.length;

  // Pending (unattributed) loaded today — money loaded before any spend, so not
  // yet attributable to a type. This is a GLOBAL figure from meta: filtered
  // views drop the rows that carry pending money, so it can't be summed from
  // per_account. Shown as a note under the total card.
  const unattributedTotal = () =>
    parseFloat(funds()?.meta?.unattributed_total) || 0;

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

  // ─── "Pending only" chip — an INDEPENDENT axis, not a type subset ───────────
  // A row is Pending when part of its day's load was made before any spend and
  // so isn't yet attributed to a client type (the "unattributed" breakdown
  // entry, rendered as the "Pending" chip).
  //
  // Pending money belongs to NO client type by definition, so a narrowed
  // client-type selection drops those rows from per_account entirely — their
  // money surfaces only as meta.unattributed_total. That's why the Pending chip
  // used to read 0 under CPL+Hybrid or Retainer alone and only came alive with
  // all three selected. Pending is a separate filter, so it sources its rows
  // from the UNFILTERED (all-types) feed instead.
  //
  // The extra fetch runs only under a named selection — with all three types
  // selected per_account already carries the pending rows. Keyed on date+scope
  // only, so flipping between named selections (CPL ↔ CPL+Hybrid) reuses it.
  const [pendingOnly, setPendingOnly] = createSignal(false);
  const isPending = (r) =>
    tbEntries(r).some((b) => b.client_type === "unattributed");

  const [fundsAll] = createResource(
    () => (named() ? `${date()}|${scopeKey()}` : null),
    async (k) =>
      (await fetchFundsAdded(k.slice(0, k.indexOf("|")), ALL_CLIENT_TYPES)) ??
      null,
  );
  const pendingRows = createMemo(() => {
    const src = named() ? fundsAll()?.per_account : perAccount();
    return (Array.isArray(src) ? src : []).filter(isPending);
  });
  const pendingCount = () => pendingRows().length;
  const pendingLoading = () => named() && fundsAll.loading;

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

  // Rows the table works from: the type-filtered feed normally, the unfiltered
  // pending set when the Pending chip is on (pending money has no client type,
  // so the type chips can't narrow it).
  const baseRows = () => (pendingOnly() ? pendingRows() : perAccount());

  // Display filter (search by account name) + optional sort. API order preserved
  // until a header is clicked.
  const sorted = createMemo(() => {
    const q = search().trim().toLowerCase();
    const filtered = baseRows().filter(
      (r) => !q || r.name?.toLowerCase().includes(q),
    );

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

  // Under the Pending view the server's total_added covers the type-filtered
  // set, not the pending rows on screen — sum what's actually displayed.
  const visibleAddedTotal = () =>
    rows().reduce((s, r) => s + (parseFloat(r.added) || 0), 0);

  // "Still collecting" — snapshots haven't spanned a full day yet, so no account
  // can compute an "added" figure. total_added is "0.00" and nothing has data.
  // Pending rows count as data: if any exist, we have history to show.
  const collecting = () =>
    !funds.loading &&
    !!funds() &&
    (parseFloat(totalAdded()) || 0) === 0 &&
    withData() === 0 &&
    pendingCount() === 0;

  const isToday = () => date() === today;
  const isYesterday = () => date() === shiftYMD(today, -1);

  return (
    <div class="font-sans min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div class="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          {/* Same heading treatment as the dashboard: crimson→gold tile with
              this section's sidebar glyph, gradient wordmark, supporting lines
              indented by tile (36px) + gap (10px). */}
         
          <h1 class="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
            <span class="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#7E1522] via-[#AC2334] via-70% to-[#C4802B] text-white shadow-[0_2px_8px_rgba(126,21,34,.32)]">
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </span>
            <span class="inline-block pb-0.5 leading-tight bg-gradient-to-r from-[#7E1522] via-[#AC2334] via-72% to-[#C4802B] dark:from-[#D9455E] dark:via-[#E4566A] dark:to-[#E9AE5C] bg-clip-text text-transparent">
              Funds Added by Date
            </span>
          </h1>
          <p class="pl-[46px] text-sm text-[#54657E] dark:text-gray-400 mt-1">
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
          <DateField
            value={date()}
            max={today}
            onChange={(ymd) => ymd && setDate(ymd)}
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
      {/* Kept mounted while the Pending view is on even with nothing to show,
          so the chip that turns it off stays reachable. */}
      <Show
        when={
          !funds.loading &&
          !collecting() &&
          (perAccount().length > 0 || pendingCount() > 0 || pendingOnly())
        }
      >
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

          {/* Pending-only chip — accounts with money loaded before any spend
              that day (the "Pending" / unattributed portion). Independent of
              the client-type chips: pending money has no type yet. */}
          <button
            onClick={() => setPendingOnly((v) => !v)}
            title="Show only accounts with pending (unattributed) funds — independent of the client-type filter"
            class={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors ${
              pendingOnly()
                ? "bg-[#14233A] text-white border-[#14233A]"
                : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
            }`}
          >
            Pending
            <span
              class={`text-[11px] font-extrabold px-1.5 py-px rounded-full ${
                pendingOnly()
                  ? "bg-white/20 text-white"
                  : "bg-[#F1F4F9] dark:bg-gray-700 text-[#8593A8]"
              }`}
            >
              {pendingLoading() ? "…" : num(pendingCount())}
            </span>
          </button>

          <Show when={search() || pendingOnly()}>
            <span class="text-[13px] font-medium text-[#54657E] dark:text-gray-400">
              {num(rows().length)} of {num(baseRows().length)}{" "}
              {pendingOnly() ? "pending " : ""}account
              {baseRows().length !== 1 ? "s" : ""}
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

        {/* Pending rows come from the unfiltered feed, so their figures are the
            whole wallet — say so while a narrowed type selection is active. */}
        <Show when={pendingOnly() && named()}>
          <p class="-mt-1 mb-4 text-xs text-[#8593A8] dark:text-gray-500">
            Pending funds aren’t attributed to a client type yet, so this list
            ignores the client-type filter and shows each account’s full amount.
          </p>
        </Show>

        <Show
          when={rows().length > 0}
          fallback={
            <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 py-16 text-center text-[#8593A8] dark:text-gray-500">
              {pendingLoading()
                ? "Loading pending accounts…"
                : search()
                  ? `No accounts match “${search()}”.`
                  : pendingOnly()
                    ? "No accounts with pending funds on this day."
                    : "No accounts match your filters."}
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
                  {/* Under the Pending view the server total covers a different
                      set than the rows on screen — total the visible rows. */}
                  {pendingOnly()
                    ? `Pending · ${num(rows().length)} account${rows().length !== 1 ? "s" : ""}`
                    : `Total added · ${num(withData())} account${withData() !== 1 ? "s" : ""}`}
                </td>
                <td class="bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3" colspan="3" />
                <td class="bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3 text-right font-extrabold text-[#15966A] dark:text-green-400 tabular-nums whitespace-nowrap">
                  {pendingOnly()
                    ? money2(String(visibleAddedTotal()))
                    : money2(String(parseFloat(totalAdded()) || 0))}
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
