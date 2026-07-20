import { createSignal, createMemo, createEffect, onMount, For, Show } from "solid-js";
import { A, useParams, useNavigate } from "@solidjs/router";
import { fetchAdAccounts } from "../services/adAccount";
import { fetchAllAdminCampaigns, campaignMatchesAccount } from "../services/campaigns";
import { fetchBulkCampaignInsights } from "../../../services/campaigns";
import Avatar from "../../../components/common/Avatar";
import { DateRangeFilter } from "../../../components/DateRangeFilter";

const fmtSpend = (n) => `₹${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// Paused-at carries a full timestamp (mirrors ProjectDetails' "Paused Date").
const formatDateTime = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

// Campaigns running on a single ad account.
// Reached from the Ad Accounts list → /ad-accounts/:id
export default function AdAccountCampaigns() {
  const params = useParams();
  const navigate = useNavigate();

  const [account, setAccount]   = createSignal(null);
  const [campaigns, setCampaigns] = createSignal([]);
  const [loading, setLoading]   = createSignal(true);
  const [search, setSearch]     = createSignal("");
  const [statusFilter, setStatusFilter] = createSignal("all");
  // Date range (YYYY-MM-DD bounds; driven by the shared DateRangeFilter). When a
  // range is applied we re-slice each campaign's leads/spend to that window via
  // the bulk-insights endpoint, instead of showing lifetime totals.
  const [dateFrom, setDateFrom] = createSignal("");
  const [dateTo, setDateTo]     = createSignal("");

  // campaignId → { leads, spend } aggregated over the selected range.
  // null = no range applied → fall back to each campaign's lifetime totals.
  const [rangeMetrics, setRangeMetrics]   = createSignal(null);
  const [metricsLoading, setMetricsLoading] = createSignal(false);
  let metricsToken = 0;

  const clearDates = () => {
    setDateFrom("");
    setDateTo("");
  };

  // Refetch date-scoped insights whenever the range (or the campaign set) changes.
  createEffect(() => {
    const from = dateFrom();
    const to = dateTo();
    const camps = campaigns();

    if (!from || !to || camps.length === 0) {
      setRangeMetrics(null);
      setMetricsLoading(false);
      return;
    }

    const ids = camps.map((c) => c.id).filter((id) => id != null);
    const token = ++metricsToken;
    setMetricsLoading(true);

    // clientNomen: null → unscoped admin sweep. This account's campaigns span
    // many clients, and any stale `selectedClientNomen` in localStorage would
    // otherwise filter insights to one client → 0 leads / 0 spend for the rest.
    fetchBulkCampaignInsights(ids, { startDate: from, endDate: to, clientNomen: null })
      .then((res) => {
        if (token !== metricsToken) return; // a newer range superseded this fetch
        const map = new Map();
        for (const row of res?.data || []) {
          if (row.is_manual) continue; // mirror DailyReports/dashboard aggregation
          const key = String(row.campaign_id);
          const cur = map.get(key) || { leads: 0, spend: 0 };
          cur.leads += Number(row.leads) || 0;
          cur.spend += parseFloat(row.spend) || 0;
          map.set(key, cur);
        }
        setRangeMetrics(map);
      })
      .catch((err) => {
        if (token !== metricsToken) return;
        console.error("Failed to load range insights:", err);
        setRangeMetrics(new Map()); // range set but load failed → show 0s, not lifetime totals
      })
      .finally(() => {
        if (token === metricsToken) setMetricsLoading(false);
      });
  });

  // Leads/spend for a campaign — range-scoped when a range is applied, else lifetime.
  const leadsFor = (c) => {
    const m = rangeMetrics();
    if (!m) return c.leads_count ?? 0;
    return m.get(String(c.id))?.leads ?? 0;
  };
  const spendFor = (c) => {
    const m = rangeMetrics();
    if (!m) return Number(c.spend) || 0;
    return m.get(String(c.id))?.spend ?? 0;
  };

  const loadAll = async () => {
    setLoading(true);
    try {
      // Resolve the account (name / meta id) and sweep all campaigns in parallel.
      // Campaigns are cached + fetched in large pages, and the server ignores the
      // ad_account filter, so we keep the ones matching this account locally.
      const [accRes, all] = await Promise.all([
        fetchAdAccounts(),
        fetchAllAdminCampaigns(),
      ]);

      const accRaw = Array.isArray(accRes.data) ? accRes.data : [];
      const acc = accRaw.find((a) => String(a.id) === String(params.id)) ?? null;
      setAccount(acc);

      setCampaigns(acc ? all.filter((c) => campaignMatchesAccount(c, acc)) : []);
    } catch (err) {
      console.error("Failed to load ad account campaigns:", err);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => loadAll());

  const filtered = createMemo(() => {
    let data = campaigns();
    const q = search().trim().toLowerCase();
    if (q) data = data.filter((c) => c.name?.toLowerCase().includes(q));
    const s = statusFilter();
    if (s !== "all") data = data.filter((c) => c.status === s);
    return data;
  });

  const activeCount = () => campaigns().filter((c) => c.status === "active").length;

  // Totals across the visible rows (range-scoped when a range is applied).
  const totals = createMemo(() => {
    let leads = 0;
    let spend = 0;
    for (const c of filtered()) {
      leads += leadsFor(c);
      spend += spendFor(c);
    }
    return { leads, spend };
  });

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 lg:p-8">

      {/* Back link */}
      <button
        onClick={() => navigate("/ad-accounts")}
        class="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 hover:text-purple-600 mb-4"
      >
        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        Back to Ad Accounts
      </button>

      {/* Header */}
      <div class="mb-6 flex items-center gap-3">
        <Show when={account()} fallback={
          <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
            {loading() ? "Loading…" : "Ad Account"}
          </h1>
        }>
          <Avatar name={account().name} />
          <div>
            <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
              {account().name}
            </h1>
            <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              Meta Account ID: {account().meta_account_id ?? "—"}
              <Show when={!loading()}>
                {" · "}{campaigns().length} campaign{campaigns().length !== 1 ? "s" : ""}
                {" · "}{activeCount()} active
                <Show when={dateFrom() && dateTo()}>
                  {" · "}
                  <span class="text-purple-600 dark:text-purple-400">
                    leads &amp; spend scoped to selected range
                  </span>
                </Show>
              </Show>
            </p>
          </div>
        </Show>
      </div>

      {/* Filters */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                  dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex w-[400px]">
          <svg
            class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search campaigns…"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white
                   focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>

        <select
          value={statusFilter()}
          onChange={(e) => setStatusFilter(e.target.value)}
          class="px-3 py-2 text-sm rounded-lg border border-gray-200
                 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
        </select>

        {/* Date range on campaign start date — shared calendar component */}
        <DateRangeFilter
          fromDate={dateFrom}
          toDate={dateTo}
          setFromDate={setDateFrom}
          setToDate={setDateTo}
        />

        <Show when={dateFrom() || dateTo() || search() || statusFilter() !== "all"}>
          <button
            onClick={() => { setSearch(""); setStatusFilter("all"); clearDates(); }}
            class="px-3 py-2 text-sm rounded-lg bg-red-50 text-red-600 border border-red-200
                   hover:bg-red-100 hover:border-red-300
                   dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 transition-colors"
          >
            Clear
          </button>
        </Show>

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {filtered().length} result{filtered().length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                  dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50
                       dark:bg-gray-800/60 text-gray-500 dark:text-gray-400
                       uppercase text-xs tracking-wider">
              <th class="p-3 text-left">Campaign</th>
              <th class="p-3 text-left">Status</th>
              <th class="p-3 text-left">Start Date</th>
              <th class="p-3 text-left">Paused Date</th>
              <th class="p-3 text-right">Leads</th>
              <th class="p-3 text-right">Spend</th>
            </tr>
          </thead>

          <Show
            when={!loading()}
            fallback={
              <tbody>
                <For each={Array(6).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                      <td class="p-3"><div class="h-3 w-64 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                      <td class="p-3"><div class="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                      <td class="p-3"><div class="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                      <td class="p-3"><div class="h-3 w-20 bg-gray-200 dark:bg-gray-700 rounded" /></td>
                      <td class="p-3"><div class="h-3 w-10 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                      <td class="p-3"><div class="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded ml-auto" /></td>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={filtered()}>
                {(c, i) => (
                  <tr
                    class={`border-b border-gray-100 dark:border-gray-800 transition-colors
                            ${i() % 2 === 0
                              ? "bg-white dark:bg-gray-900"
                              : "bg-gray-50/60 dark:bg-gray-800/30"}`}
                  >
                    <td class="p-3 max-w-[420px]">
                      <div class="flex items-center gap-3">
                        <Avatar name={c.name} />
                        <A
                          href={`/campaign/${c.id}`}
                          class="text-purple-700 dark:text-purple-300 hover:underline font-medium line-clamp-2"
                          title={c.name}
                        >
                          {c.name}
                        </A>
                      </div>
                    </td>
                    <td class="p-3">
                      <span
                        class={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold
                          ${c.status === "active"
                            ? "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300"
                            : c.status === "paused"
                              ? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                              : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300"}`}
                      >
                        <span
                          class={`w-1.5 h-1.5 rounded-full inline-block
                            ${c.status === "active" ? "bg-green-500" : c.status === "paused" ? "bg-amber-500" : "bg-gray-400"}`}
                        />
                        {c.status_label ?? c.status ?? "—"}
                      </span>
                    </td>
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {formatDate(c.start_date)}
                    </td>
                    <td class="p-3 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {c.status === "paused" ? formatDateTime(c.paused_at) : "No Date"}
                    </td>
                    <td class="p-3 text-right text-gray-700 dark:text-gray-300">
                      <Show when={!metricsLoading()} fallback={<span class="text-gray-400">…</span>}>
                        {leadsFor(c)}
                      </Show>
                    </td>
                    <td class="p-3 text-right text-gray-700 dark:text-gray-300 whitespace-nowrap">
                      <Show when={!metricsLoading()} fallback={<span class="text-gray-400">…</span>}>
                        {fmtSpend(spendFor(c))}
                      </Show>
                    </td>
                  </tr>
                )}
              </For>

              <Show when={filtered().length === 0}>
                <tr>
                  <td colspan="6" class="py-16 text-center text-gray-400 dark:text-gray-500">
                    {account()
                      ? "No campaigns found for this ad account"
                      : "Ad account not found"}
                  </td>
                </tr>
              </Show>
            </tbody>

            {/* Totals — leads & spend across the visible rows (range-scoped when set) */}
            <Show when={filtered().length > 0}>
              <tfoot>
                <tr class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60 font-semibold text-gray-700 dark:text-gray-200">
                  <td class="p-3" colspan="4">
                    Total
                    <Show when={dateFrom() && dateTo()}>
                      <span class="ml-1 font-normal text-xs text-purple-600 dark:text-purple-400">
                        (selected range)
                      </span>
                    </Show>
                  </td>
                  <td class="p-3 text-right">
                    <Show when={!metricsLoading()} fallback={<span class="text-gray-400">…</span>}>
                      {totals().leads}
                    </Show>
                  </td>
                  <td class="p-3 text-right whitespace-nowrap">
                    <Show when={!metricsLoading()} fallback={<span class="text-gray-400">…</span>}>
                      {fmtSpend(totals().spend)}
                    </Show>
                  </td>
                </tr>
              </tfoot>
            </Show>
          </Show>
        </table>
      </div>
    </div>
  );
}
