import { createSignal, createMemo, createEffect, onMount, For, Show } from "solid-js";
import { useNavigate, useSearchParams, A } from "@solidjs/router";
import { fetchAdAccounts } from "../services/adAccount";
import { fetchAllAdminCampaigns, normAccountId } from "../services/campaigns";
import Avatar from "../../../components/common/Avatar";

// Meta's account_status codes: 1 = Active, anything else = Disabled/Suspended
// (2 disabled, 3 unsettled, 7/8/9/100/101/… all unusable). Treat it as a binary.
const isActive = (a) => Number(a?.account_status) === 1;

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AdAccounts() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [allAccounts, setAllAccounts] = createSignal([]);
  const [loading, setLoading]         = createSignal(true);
  const [search, setSearch]           = createSignal("");
  const [sortKey, setSortKey]         = createSignal("id");
  const [sortDir, setSortDir]         = createSignal("asc");

  // Status filter — "all" | "active" | "disabled". The URL is the source of
  // truth so the suspension banner / notifications can deep-link here with
  // ?status=disabled and land pre-filtered. An effect mirrors the URL into the
  // signal (also catches navigations that arrive while already on this page).
  const normStatus = (s) => (s === "active" || s === "disabled" ? s : "all");
  const [statusFilter, setStatusFilter] = createSignal(normStatus(searchParams.status));
  createEffect(() => setStatusFilter(normStatus(searchParams.status)));
  const setStatus = (v) =>
    setSearchParams({ status: v === "all" ? undefined : v });

  // Campaign counts per account (loaded in the background; non-blocking).
  // Tallied by Meta id first (names aren't unique), name only as a fallback —
  // mirrors campaignMatchesAccount().
  const [countsByKey, setCountsByKey]   = createSignal({ byId: new Map(), byName: new Map() });
  const [countsLoading, setCountsLoading] = createSignal(true);

  // ── Fetch all ad accounts ─────────────────────────────────────────────────
  const loadAccounts = async () => {
    setLoading(true);
    try {
      const res = await fetchAdAccounts();

      // API returns { success, data: [...] } — no pagination on this endpoint
      const raw = Array.isArray(res.data) ? res.data : [];

      // Keep only the fields we need (incl. account_status for the status filter)
      const trimmed = raw.map((a) => ({
        id:              a.id,
        name:            a.name,
        meta_account_id: a.meta_account_id,
        account_status:  a.account_status,
      }));

      setAllAccounts(trimmed);
    } catch (err) {
      console.error("Failed to load ad accounts:", err);
    } finally {
      setLoading(false);
    }
  };

  // ── Campaign counts per account ────────────────────────────────────────────
  // Sweep all campaigns once (cached + large pages) and tally per ad-account
  // identifier. Runs independently so the accounts table renders immediately.
  const loadCounts = async () => {
    setCountsLoading(true);
    try {
      const all = await fetchAllAdminCampaigns();
      // Mirror campaignMatchesAccount(): a campaign with a Meta id is tallied by
      // (normalised) id only; id-less campaigns fall back to a name tally. This
      // keeps two same-named accounts with different ids on separate counts.
      const byId = new Map();
      const byName = new Map();
      const bump = (map, key) => {
        if (key == null || key === "") return;
        const k = String(key);
        map.set(k, (map.get(k) ?? 0) + 1);
      };
      for (const c of all) {
        const cId = normAccountId(c.ad_account_id);
        if (cId != null) bump(byId, cId);
        else bump(byName, c.ad_account_name);
      }
      setCountsByKey({ byId, byName });
    } catch (err) {
      console.error("Failed to load campaign counts:", err);
    } finally {
      setCountsLoading(false);
    }
  };

  onMount(() => {
    loadAccounts();
    loadCounts();
  });

  const campaignCount = (account) => {
    const { byId, byName } = countsByKey();
    // Campaign ad_account_id may be the internal row id or the Meta id — check
    // both, mirroring campaignMatchesAccount().
    const accRowId = account.id != null ? String(account.id) : null;
    const accMetaId = normAccountId(account.meta_account_id);
    if (accRowId != null && byId.has(accRowId)) return byId.get(accRowId);
    if (accMetaId != null && byId.has(accMetaId)) return byId.get(accMetaId);
    if (account.name != null && byName.has(String(account.name)))
      return byName.get(String(account.name));
    return 0;
  };

  // Open the dedicated page listing every campaign on this ad account
  const openAccount = (account) => navigate(`/ad-accounts/${account.id}`);

  // ── Sort toggle ───────────────────────────────────────────────────────────
  const toggleSort = (key) => {
    if (sortKey() === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortIcon = (key) => {
    if (sortKey() !== key)
      return <span class="text-gray-300 ml-1">⇅</span>;
    return (
      <span class="ml-1 text-purple-600">
        {sortDir() === "asc" ? "↑" : "↓"}
      </span>
    );
  };

  // ── Client-side filter + sort ─────────────────────────────────────────────
  // Search-only pass (no status filter) so the status chips can show accurate
  // counts within the current search.
  const searched = createMemo(() => {
    const q = search().trim().toLowerCase();
    if (!q) return allAccounts();
    return allAccounts().filter(
      (a) =>
        a.name?.toLowerCase().includes(q) ||
        a.meta_account_id?.toLowerCase().includes(q),
    );
  });

  const statusCounts = createMemo(() => {
    let active = 0;
    for (const a of searched()) if (isActive(a)) active++;
    return { all: searched().length, active, disabled: searched().length - active };
  });

  const filtered = createMemo(() => {
    let data = [...searched()];

    // Status filter — active = account_status 1, disabled = everything else
    if (statusFilter() === "active") data = data.filter(isActive);
    else if (statusFilter() === "disabled") data = data.filter((a) => !isActive(a));

    // Sort
    data.sort((a, b) => {
      let va = a[sortKey()];
      let vb = b[sortKey()];

      if (sortKey() === "id") {
        va = Number(va);
        vb = Number(vb);
      } else {
        va = String(va ?? "").toLowerCase();
        vb = String(vb ?? "").toLowerCase();
      }

      if (va < vb) return sortDir() === "asc" ? -1 : 1;
      if (va > vb) return sortDir() === "asc" ? 1 : -1;
      return 0;
    });

    return data;
  });

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 lg:p-8">

      {/* Page Header */}
      <div class="mb-6">
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
          Ad Accounts
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {allAccounts().length} total · click a row to see its campaigns
        </p>

        {/* View switcher — Accounts table ⇄ Clients by account */}
        <div class="inline-flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800 mt-3">
          <span class="px-3.5 py-1.5 text-sm rounded-md font-medium bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm">
            Accounts
          </span>
          <A
            href="/ad-account-clients"
            class="px-3.5 py-1.5 text-sm rounded-md font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Clients by Account
          </A>
        </div>
      </div>

      {/* Filters Bar */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                  dark:border-gray-700 p-4 mb-4 flex flex-wrap items-center gap-3">

        {/* Search */}
        <div class="relative flex w-[500px]">
          <svg
            class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by name or Meta account ID…"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white
                   focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>

        {/* Status filter chips */}
        <div class="flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800">
          <For each={[
            { key: "all",      label: "All" },
            { key: "active",   label: "Active" },
            { key: "disabled", label: "Disabled" },
          ]}>
            {(opt) => (
              <button
                onClick={() => setStatus(opt.key)}
                class={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                  statusFilter() === opt.key
                    ? opt.key === "disabled"
                      ? "bg-red-600 text-white shadow-sm"
                      : "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                    : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                {opt.label}
                <span class="ml-1.5 text-xs opacity-70">
                  {statusCounts()[opt.key]}
                </span>
              </button>
            )}
          </For>
        </div>

        {/* Clear */}
        <button
          onClick={() => { setSearch(""); setSortKey("id"); setSortDir("asc"); setStatus("all"); }}
          class="px-3 py-2 text-sm rounded-lg
                 bg-red-50 text-red-600 border border-red-200
                 hover:bg-red-100 hover:border-red-300
                 dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700
                 transition-colors"
        >
          Clear All
        </button>

        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {filtered().length} result{filtered().length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Table */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                  dark:border-gray-700 overflow-x-auto">
        <table class="min-w-full text-sm">

          {/* Table Head */}
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 bg-gray-50
                       dark:bg-gray-800/60 text-gray-500 dark:text-gray-400
                       uppercase text-xs tracking-wider">
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("id")}
              >
                ID {sortIcon("id")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("name")}
              >
                Name {sortIcon("name")}
              </th>
              <th
                class="p-3 text-left cursor-pointer hover:text-purple-600 whitespace-nowrap"
                onClick={() => toggleSort("meta_account_id")}
              >
                Meta Account ID {sortIcon("meta_account_id")}
              </th>
              <th class="p-3 text-left whitespace-nowrap">Status</th>
              <th class="p-3 text-left whitespace-nowrap">Campaigns</th>
              <th class="p-3 text-right whitespace-nowrap" />
            </tr>
          </thead>

          {/* Loading Skeleton */}
          <Show
            when={!loading()}
            fallback={
              <tbody>
                <For each={Array(8).fill(0)}>
                  {() => (
                    <tr class="border-b border-gray-100 dark:border-gray-800 animate-pulse">
                      <td class="p-3">
                        <div class="h-3 w-10 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-56 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-44 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-8 bg-gray-200 dark:bg-gray-700 rounded" />
                      </td>
                      <td class="p-3">
                        <div class="h-3 w-6 bg-gray-200 dark:bg-gray-700 rounded ml-auto" />
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            }
          >
            <tbody>
              <For each={filtered()}>
                {(account, i) => (
                  <tr
                    onClick={() => openAccount(account)}
                    class={`border-b border-gray-100 dark:border-gray-800
                            hover:bg-purple-50/60 dark:hover:bg-gray-800/60 cursor-pointer transition-colors
                            ${!isActive(account)
                              ? "bg-red-50/40 dark:bg-red-500/[0.06]"
                              : i() % 2 === 0
                              ? "bg-white dark:bg-gray-900"
                              : "bg-gray-50/60 dark:bg-gray-800/30"}`}
                  >
                    {/* ID */}
                    <td class="p-3 text-purple-700 dark:text-gray-300 font-medium">
                      {account.id}
                    </td>

                    {/* Name */}
                    <td class="p-3">
                      <div class="flex items-center gap-2">
                        <Avatar name={account.name} />
                        <span class="text-purple-700 dark:text-gray-300 font-medium">
                          {account.name}
                        </span>
                      </div>
                    </td>

                    {/* Meta Account ID */}
                    <td class="p-3 font-medium text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {account.meta_account_id}
                    </td>

                    {/* Status */}
                    <td class="p-3 whitespace-nowrap">
                      <Show
                        when={isActive(account)}
                        fallback={
                          <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300">
                            <span class="w-1.5 h-1.5 rounded-full bg-red-500" />
                            Disabled
                          </span>
                        }
                      >
                        <span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300">
                          <span class="w-1.5 h-1.5 rounded-full bg-green-500" />
                          Active
                        </span>
                      </Show>
                    </td>

                    {/* Campaign count */}
                    <td class="p-3 whitespace-nowrap">
                      <span class="inline-flex items-center justify-center min-w-[1.75rem] px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700 dark:bg-gray-700 dark:text-gray-200">
                        <Show when={!countsLoading()} fallback={"…"}>
                          {campaignCount(account)}
                        </Show>
                      </span>
                    </td>

                    {/* View campaigns chevron */}
                    <td class="p-3 text-right whitespace-nowrap">
                      <span class="inline-flex items-center gap-1 text-sm text-purple-600 dark:text-purple-300">
                        View campaigns
                        <svg
                          class="w-4 h-4" fill="none" viewBox="0 0 24 24"
                          stroke="currentColor" stroke-width="2"
                        >
                          <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                    </td>
                  </tr>
                )}
              </For>

              {/* Empty State */}
              <Show when={filtered().length === 0}>
                <tr>
                  <td colspan="6" class="py-16 text-center text-gray-400 dark:text-gray-500">
                    <svg
                      class="w-10 h-10 mx-auto mb-3 opacity-30"
                      fill="none" viewBox="0 0 24 24" stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                        d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                      />
                    </svg>
                    No ad accounts match your filters
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>

          {/* Table Footer */}
          <tfoot>
            <tr class="border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/60">
              <td colspan="6" class="px-4 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                {filtered().length} result{filtered().length !== 1 ? "s" : ""}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Total count — no pagination needed (single-page API response) */}
      <div class="mt-4 text-sm text-gray-500 dark:text-gray-400">
        {allAccounts().length === 0
          ? "No ad accounts found"
          : `Showing all ${filtered().length} of ${allAccounts().length} ad accounts`}
      </div>
    </div>
  );
}
