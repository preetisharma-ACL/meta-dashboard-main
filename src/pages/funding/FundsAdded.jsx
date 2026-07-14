import { createSignal, createResource, For, Show } from "solid-js";
import { fetchFundsAdded } from "../../services/funding";
import { scopeKey } from "../../stores/cmScope";
import Avatar from "../../components/common/Avatar";

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

export default function FundsAdded() {
  const today = todayYMD();
  const [date, setDate] = createSignal(today);

  // Refetch on scope change (switch-mode) OR when the picked date changes.
  const [funds] = createResource(
    () => ({ scope: scopeKey(), date: date() }),
    async (s) => (await fetchFundsAdded(s.date)) ?? null,
  );

  const perAccount = () =>
    Array.isArray(funds()?.per_account) ? funds().per_account : [];
  const withData = () => Number(funds()?.accounts_with_data) || 0;
  const withoutData = () => Number(funds()?.accounts_without_data) || 0;
  const totalAdded = () => funds()?.total_added ?? "0.00";

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
        <div class="block bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] overflow-auto">
          <table class="min-w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr class="bg-[#F8FAFC] dark:bg-gray-800 text-[#54657E] dark:text-gray-400 uppercase text-xs font-semibold tracking-wider">
                <th class="p-4 text-center whitespace-nowrap w-16 border-b border-[#D4DDE9] dark:border-gray-700">
                  S.No
                </th>
                <th class="p-4 text-left whitespace-nowrap min-w-[220px] border-b border-[#D4DDE9] dark:border-gray-700">
                  Account
                </th>
                <th class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">
                  Balance Start
                </th>
                <th class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">
                  Balance End
                </th>
                <th class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">
                  Spend
                </th>
                <th class="p-4 text-right whitespace-nowrap border-b border-[#D4DDE9] dark:border-gray-700">
                  Funds Added
                </th>
              </tr>
            </thead>
            <tbody>
              <For each={perAccount()}>
                {(r, i) => {
                  const hasData = () => r.added != null;
                  return (
                    <tr class="group transition-colors hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40">
                      <td class="px-4 py-2.5 text-center align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                        <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#E9F7F1] dark:bg-green-900/30 text-[#15966A] dark:text-green-300 text-xs font-extrabold">
                          {i() + 1}
                        </span>
                      </td>
                      <td class="px-4 py-2.5 align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                        <div class="flex items-center gap-3">
                          <Avatar name={r.name} />
                          <div class="min-w-0">
                            <span
                              class="block text-blue-900 dark:text-gray-100 font-semibold truncate"
                              title={r.name}
                            >
                              {r.name}
                            </span>
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
                        </td>
                      </Show>
                    </tr>
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

      {/* No accounts at all (in scope) for this date, but not the collecting state */}
      <Show when={!funds.loading && !collecting() && perAccount().length === 0 && funds()}>
        <div class="bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 py-16 text-center text-[#8593A8] dark:text-gray-500">
          No accounts to show for this date.
        </div>
      </Show>
    </div>
  );
}
