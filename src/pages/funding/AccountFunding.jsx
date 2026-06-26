import { createSignal, createResource, createMemo, For, Show } from "solid-js";
import * as XLSX from "xlsx";
import { fetchFundingAccounts } from "../../services/funding";
import { asTeamMemberId } from "../../stores/cmScope";

// ─── Money / null discipline ──────────────────────────────────────────────────
// Money arrives as a STRING ("4779.00") or null. null ≠ 0 — it means
// "not set / not applicable / unknown" and must never render as ₹0.
// A real "0.00" DOES mean zero and renders as ₹0.00.

// Whole-rupee Indian grouping for the big summary stats (₹2,02,989).
const moneyWhole = (v) => {
  const n = parseFloat(v);
  if (!isFinite(n)) return "—";
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

// Paise-precise for per-account amounts (₹3,279.01) — matches the funding team's
// "load exactly ₹X" workflow. Returns null when the value is null/non-numeric so
// the caller can render a feature-specific label instead of ₹0.
const money2 = (v) => {
  if (v == null) return null;
  const n = parseFloat(v);
  if (!isFinite(n)) return null;
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const num = (v) => (Number(v) || 0).toLocaleString("en-IN");

// "as of 12m ago" relative time for balance_synced_at.
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
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
};

// ─── Funding state machine (the core of the screen) ───────────────────────────
// "card"    → card-funded; bills to a card, never runs dry. No top-up, no ₹0.
// "unknown" → balance not synced yet. Show budgets, render balance/shortfall "—".
// "needs"   → prepaid wallet, non-zero shortfall. Actionable, urgent (red).
// "funded"  → prepaid wallet covers the day (shortfall "0.00"). OK (green).
const fundingState = (a) => {
  if (a.is_prepay_account === false || a.funds_available === "card-funded") return "card";
  if (a.is_prepay_account == null) return "unknown";
  if (a.additional_required_24h == null) return "unknown";
  const n = parseFloat(a.additional_required_24h);
  if (isFinite(n) && n > 0) return "needs";
  return "funded";
};

const STATE_META = {
  needs: { label: "Needs funding", chip: "bg-red-100 text-red-700 ring-1 ring-red-300 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800" },
  funded: { label: "Funded", chip: "bg-green-100 text-green-700 ring-1 ring-green-300 dark:bg-green-900/30 dark:text-green-300 dark:ring-green-800" },
  card: { label: "Card-funded", chip: "bg-blue-100 text-blue-700 ring-1 ring-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800" },
  unknown: { label: "Not synced", chip: "bg-gray-100 text-gray-600 ring-1 ring-gray-300 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700" },
};

// ─── Available (wallet balance) cell ──────────────────────────────────────────
function AvailableCell(props) {
  const st = () => props.state;
  const a = () => props.account;
  return (
    <Show
      when={st() === "needs" || st() === "funded"}
      fallback={
        <Show when={st() === "card"} fallback={<span class="text-gray-400 dark:text-gray-500">—</span>}>
          <span class="text-gray-500 dark:text-gray-400 text-xs">No wallet</span>
        </Show>
      }
    >
      <span
        class="text-gray-700 dark:text-gray-300 font-medium"
        title={relTime(a().balance_synced_at) ? `Balance as of ${relTime(a().balance_synced_at)}` : undefined}
      >
        {money2(a().funds_available) ?? "—"}
      </span>
    </Show>
  );
}

// ─── To Load (24h) cell — the hero column ─────────────────────────────────────
function ToLoadCell(props) {
  const st = () => props.state;
  const a = () => props.account;
  return (
    <Show
      when={st() === "needs"}
      fallback={
        <Show
          when={st() === "funded"}
          fallback={
            <span class="text-gray-400 dark:text-gray-500 text-xs">
              {st() === "card" ? "No top-up needed" : "—"}
            </span>
          }
        >
          <span class="inline-flex items-center gap-1 text-green-600 dark:text-green-400 font-medium text-xs">
            <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Covered
          </span>
        </Show>
      }
    >
      <span class="inline-flex items-center font-bold text-red-600 dark:text-red-400">
        {money2(a().additional_required_24h)}
      </span>
    </Show>
  );
}

// ─── Status badge (account health) ────────────────────────────────────────────
function StatusBadge(props) {
  const ok = () => props.account.is_active && props.account.account_status === 1;
  return (
    <span
      class={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
        ok()
          ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
      }`}
    >
      <span class={`w-1.5 h-1.5 rounded-full inline-block ${ok() ? "bg-green-500" : "bg-amber-500"}`} />
      {ok() ? "Active" : "Inactive"}
    </span>
  );
}

// ─── Client chips (truncate with +N more) ─────────────────────────────────────
function Clients(props) {
  const list = () => (Array.isArray(props.clients) ? props.clients : []);
  const shown = () => list().slice(0, 2);
  const extra = () => Math.max(0, list().length - 2);
  return (
    <Show when={list().length > 0} fallback={<span class="text-gray-400 dark:text-gray-500">—</span>}>
      <div class="flex flex-wrap items-center gap-1" title={list().join(", ")}>
        <For each={shown()}>
          {(c) => (
            <span class="inline-block px-2 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 max-w-[140px] truncate">
              {c}
            </span>
          )}
        </For>
        <Show when={extra() > 0}>
          <span class="text-[11px] text-gray-400 dark:text-gray-500">+{extra()} more</span>
        </Show>
      </div>
    </Show>
  );
}

export default function AccountFunding() {
  const [search, setSearch] = createSignal("");
  const [needsOnly, setNeedsOnly] = createSignal(false);

  // Refetch when the switch scope changes (the server re-scopes the dataset).
  // The source returns an OBJECT (always truthy) — passing the raw signal would
  // make createResource skip the fetch whenever asTeamMemberId() is null (the
  // default, no switch mode), leaving the page permanently empty.
  const [data] = createResource(
    () => ({ scope: asTeamMemberId() }),
    async () => {
      const res = await fetchFundingAccounts();
      return res ?? { data: [], meta: null };
    },
  );

  const accounts = () => (Array.isArray(data()?.data) ? data().data : []);
  const summary = () => data()?.meta?.summary ?? null;

  // Display filter only — never re-sorted; the API order (shortfall desc) is
  // intentional and preserved.
  const rows = createMemo(() => {
    const q = search().trim().toLowerCase();
    return accounts().filter((a) => {
      if (q && !a.name?.toLowerCase().includes(q)) return false;
      if (needsOnly() && fundingState(a) !== "needs") return false;
      return true;
    });
  });

  const summaryCards = createMemo(() => {
    const s = summary();
    if (!s) return [];
    return [
      {
        label: "Total To Load (24h)",
        value: moneyWhole(s.total_additional_required_24h),
        sub: "prepaid shortfalls only",
        accent: "text-red-600 dark:text-red-400",
        bg: "bg-red-50 dark:bg-gray-800 border-red-200 dark:border-gray-700",
      },
      {
        label: "Total 24h Required",
        value: moneyWhole(s.total_daily_required),
        sub: "base + GST",
        accent: "text-gray-900 dark:text-white",
        bg: "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700",
      },
      {
        label: "Accounts",
        value: num(s.accounts),
        sub: `${num(s.prepaid_accounts)} prepaid · ${num(s.card_accounts)} card`,
        accent: "text-purple-600 dark:text-purple-400",
        bg: "bg-purple-50 dark:bg-gray-800 border-purple-200 dark:border-gray-700",
      },
      {
        label: "Total GST (18%)",
        value: moneyWhole(s.total_gst),
        sub: "on base daily budget",
        accent: "text-amber-600 dark:text-amber-400",
        bg: "bg-amber-50 dark:bg-gray-800 border-amber-200 dark:border-gray-700",
      },
    ];
  });

  const needsCount = createMemo(() => accounts().filter((a) => fundingState(a) === "needs").length);

  // ─── Download report (.xlsx) ────────────────────────────────────────────────
  // Exports exactly what's on screen (current search / needs-only filter) plus
  // the summary band. Money goes out as numbers so Excel can sum/sort; the
  // null-vs-zero distinction is preserved as labels (Card-funded / Not synced /
  // N/A) so a card account never reads as ₹0.
  const downloadReport = () => {
    const data = rows();
    if (!data.length) return;

    const stateLabel = { needs: "Needs funding", funded: "Funded", card: "Card-funded", unknown: "Not synced" };
    const numOrBlank = (v) => {
      if (v == null) return "";
      const n = parseFloat(v);
      return isFinite(n) ? n : "";
    };

    const header = [
      "Account", "Ad Account ID", "Clients", "Campaigns", "Base Daily", "GST",
      "Total Required", "Available", "To Load (24h)", "Funding State", "Status", "Balance Synced",
    ];

    const body = data.map((a) => {
      const st = fundingState(a);
      const available = st === "card" ? "Card-funded" : st === "unknown" ? "Not synced" : numOrBlank(a.funds_available);
      const toLoad = st === "needs" ? numOrBlank(a.additional_required_24h) : st === "funded" ? 0 : "N/A";
      return [
        a.name ?? "",
        a.ad_account_id ?? "",
        Array.isArray(a.clients) ? a.clients.join(", ") : "",
        Number(a.campaign_count) || 0,
        numOrBlank(a.base_daily_budget),
        numOrBlank(a.gst),
        numOrBlank(a.total_daily_required),
        available,
        toLoad,
        stateLabel[st],
        a.is_active && a.account_status === 1 ? "Active" : "Inactive",
        a.balance_synced_at ? new Date(a.balance_synced_at).toLocaleString("en-IN") : "",
      ];
    });

    const s = summary();
    const meta = [
      ["Account Funding Report"],
      ["Generated", new Date().toLocaleString("en-IN")],
      ...(needsOnly() || search().trim() ? [["Filter", `${needsOnly() ? "Needs funding only" : ""}${needsOnly() && search().trim() ? " · " : ""}${search().trim() ? `search: "${search().trim()}"` : ""}`]] : []),
      ...(s
        ? [
            ["Total 24h Required", parseFloat(s.total_daily_required) || 0],
            ["Total To Load (prepaid shortfalls)", parseFloat(s.total_additional_required_24h) || 0],
            ["Accounts", Number(s.accounts) || 0],
            ["Prepaid / Card", `${s.prepaid_accounts} / ${s.card_accounts}`],
          ]
        : []),
      [],
    ];

    const ws = XLSX.utils.aoa_to_sheet([...meta, header, ...body]);
    ws["!cols"] = [
      { wch: 24 }, { wch: 22 }, { wch: 32 }, { wch: 11 }, { wch: 13 }, { wch: 11 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Account Funding");
    const today = new Date().toISOString().split("T")[0];
    XLSX.writeFile(wb, `account-funding-${today}.xlsx`);
  };

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div class="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
            Account Funding
          </h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            GST-inclusive 24-hour funding requirement per ad account — sorted by shortfall.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <Show when={!data.loading && needsCount() > 0}>
            <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">
              <span class="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              {needsCount()} account{needsCount() !== 1 ? "s" : ""} need funding
            </span>
          </Show>
          <button
            onClick={downloadReport}
            disabled={data.loading || rows().length === 0}
            title="Download the current table as an Excel report"
            class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
            </svg>
            Download report
          </button>
        </div>
      </div>

      {/* Summary band */}
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Show
          when={!data.loading && summary()}
          fallback={
            <For each={Array(4).fill(0)}>
              {() => (
                <div class="px-5 py-6 rounded-xl shadow-sm border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700">
                  <div class="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                  <div class="h-7 w-28 mt-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                </div>
              )}
            </For>
          }
        >
          <For each={summaryCards()}>
            {(card) => (
              <div class={`px-5 py-6 rounded-xl shadow-sm border ${card.bg}`}>
                <p class="text-sm text-gray-500 dark:text-gray-400">{card.label}</p>
                <h3 class={`text-2xl font-semibold mt-2 ${card.accent}`}>{card.value}</h3>
                <Show when={card.sub}>
                  <p class="text-xs text-gray-400 dark:text-gray-500 mt-1">{card.sub}</p>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* Filters */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex-1 min-w-[220px]">
          <svg class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by account name…"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
        </div>
        <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={needsOnly()}
            onChange={(e) => setNeedsOnly(e.target.checked)}
            class="rounded border-gray-300 dark:border-gray-600 text-red-500 focus:ring-red-400"
          />
          Needs funding only
        </label>
        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {rows().length} account{rows().length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Error */}
      <Show when={data.error}>
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 mb-4 text-sm text-red-600 dark:text-red-400">
          Failed to load account funding. Please try again.
        </div>
      </Show>

      {/* Desktop table */}
      <div class="hidden md:block bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 uppercase text-xs tracking-wider">
              <th class="p-3 text-left whitespace-nowrap min-w-[180px]">Account</th>
              <th class="p-3 text-left whitespace-nowrap">Clients</th>
              <th class="p-3 text-right whitespace-nowrap">Campaigns</th>
              <th class="p-3 text-right whitespace-nowrap">Base Daily</th>
              <th class="p-3 text-right whitespace-nowrap">GST</th>
              <th class="p-3 text-right whitespace-nowrap">Total Required</th>
              <th class="p-3 text-right whitespace-nowrap">Available</th>
              <th class="p-3 text-right whitespace-nowrap">To Load (24h)</th>
              <th class="p-3 text-center whitespace-nowrap">Status</th>
            </tr>
          </thead>

          <Show
            when={!data.loading}
            fallback={
              <tbody>
                <For each={Array(8).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                      <For each={Array(9).fill(0)}>
                        {(_, idx) => (
                          <td class="p-3">
                            <div class={`h-3 bg-gray-200 dark:bg-gray-700 rounded ${idx() === 0 ? "w-40" : "w-16"}`} />
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={rows()}>
                {(a, i) => {
                  const st = fundingState(a);
                  return (
                    <tr
                      class={`border-b border-gray-100 dark:border-gray-800 transition-colors hover:bg-purple-50/40 dark:hover:bg-gray-800/40 ${
                        st === "needs"
                          ? "bg-red-50/40 dark:bg-red-900/10"
                          : i() % 2 === 0
                          ? "bg-white dark:bg-gray-900"
                          : "bg-gray-50/60 dark:bg-gray-800/30"
                      }`}
                    >
                      <td class="p-3 max-w-[220px]">
                        <div class="flex items-center gap-2">
                          <span class="font-medium text-gray-800 dark:text-gray-100 truncate" title={a.name}>{a.name}</span>
                          <span class={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${STATE_META[st].chip}`}>
                            {STATE_META[st].label}
                          </span>
                        </div>
                        <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 font-mono truncate" title={a.ad_account_id}>{a.ad_account_id}</p>
                      </td>
                      <td class="p-3"><Clients clients={a.clients} /></td>
                      <td class="p-3 text-right text-gray-700 dark:text-gray-300">{num(a.campaign_count)}</td>
                      <td class="p-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">{money2(a.base_daily_budget) ?? "—"}</td>
                      <td class="p-3 text-right text-gray-500 dark:text-gray-400 whitespace-nowrap">{money2(a.gst) ?? "—"}</td>
                      <td class="p-3 text-right text-gray-800 dark:text-gray-100 font-semibold whitespace-nowrap">{money2(a.total_daily_required) ?? "—"}</td>
                      <td class="p-3 text-right whitespace-nowrap"><AvailableCell account={a} state={st} /></td>
                      <td class="p-3 text-right whitespace-nowrap"><ToLoadCell account={a} state={st} /></td>
                      <td class="p-3 text-center"><StatusBadge account={a} /></td>
                    </tr>
                  );
                }}
              </For>

              <Show when={rows().length === 0}>
                <tr>
                  <td colspan="9" class="py-16 text-center text-gray-400 dark:text-gray-500">
                    {needsOnly() ? "No accounts currently need funding." : "No accounts to show."}
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>
        </table>
      </div>

      {/* Mobile card list */}
      <div class="md:hidden space-y-3">
        <Show
          when={!data.loading}
          fallback={
            <For each={Array(5).fill(0)}>
              {() => <div class="h-28 rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 animate-pulse" />}
            </For>
          }
        >
          <For each={rows()}>
            {(a) => {
              const st = fundingState(a);
              return (
                <div class={`rounded-xl border p-4 ${st === "needs" ? "border-red-200 dark:border-red-800 bg-red-50/40 dark:bg-red-900/10" : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900"}`}>
                  <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                      <p class="font-semibold text-gray-800 dark:text-gray-100 truncate">{a.name}</p>
                      <p class="text-[11px] text-gray-400 dark:text-gray-500 font-mono truncate">{a.ad_account_id}</p>
                    </div>
                    <span class={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${STATE_META[st].chip}`}>
                      {STATE_META[st].label}
                    </span>
                  </div>

                  <div class="mt-3 flex items-baseline justify-between">
                    <span class="text-xs text-gray-500 dark:text-gray-400">To Load (24h)</span>
                    <span class="text-lg"><ToLoadCell account={a} state={st} /></span>
                  </div>

                  <div class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div class="flex justify-between"><span class="text-gray-400 dark:text-gray-500">Total Req.</span><span class="text-gray-700 dark:text-gray-300">{money2(a.total_daily_required) ?? "—"}</span></div>
                    <div class="flex justify-between"><span class="text-gray-400 dark:text-gray-500">Available</span><span><AvailableCell account={a} state={st} /></span></div>
                    <div class="flex justify-between"><span class="text-gray-400 dark:text-gray-500">Base</span><span class="text-gray-700 dark:text-gray-300">{money2(a.base_daily_budget) ?? "—"}</span></div>
                    <div class="flex justify-between"><span class="text-gray-400 dark:text-gray-500">GST</span><span class="text-gray-700 dark:text-gray-300">{money2(a.gst) ?? "—"}</span></div>
                  </div>

                  <div class="mt-2"><Clients clients={a.clients} /></div>
                </div>
              );
            }}
          </For>
          <Show when={rows().length === 0}>
            <div class="py-16 text-center text-gray-400 dark:text-gray-500">
              {needsOnly() ? "No accounts currently need funding." : "No accounts to show."}
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
