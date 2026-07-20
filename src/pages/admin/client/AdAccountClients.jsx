import { createSignal, createMemo, onMount, For, Show } from "solid-js";
import { A } from "@solidjs/router";
import { fetchAdAccounts } from "../services/adAccount";
import { fetchAllAdminCampaigns, normAccountId } from "../services/campaigns";
import Avatar from "../../../components/common/Avatar";

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN · Ad Account Clients  (route: /ad-account-clients)
// A companion view to the Ad Accounts table: one card per ad account showing the
// FULL roster of clients running campaigns on it (the table only shows a capped
// "+N more" preview). Card design mirrors the Campaign Manager's Clients page.
// Data is assembled exactly like the Ad Accounts list — fetchAdAccounts() for the
// accounts + a single fetchAllAdminCampaigns() sweep to collect the distinct
// client_nomen_name set per account (keyed Meta-id-first, name as fallback,
// mirroring campaignMatchesAccount()).
// ─────────────────────────────────────────────────────────────────────────────

const isActive = (a) => Number(a?.account_status) === 1;

// How many clients to show before the per-card "Show all" expander.
const PREVIEW_COUNT = 8;

export default function AdAccountClients() {
  const [accounts, setAccounts] = createSignal([]);
  const [loading, setLoading]   = createSignal(true);
  const [search, setSearch]     = createSignal("");

  // account key → { count, clients: Set }, built from the campaign sweep.
  const [byId, setById]     = createSignal(new Map());
  const [byName, setByName] = createSignal(new Map());

  const loadAll = async () => {
    setLoading(true);
    try {
      const [accRes, all] = await Promise.all([
        fetchAdAccounts(),
        fetchAllAdminCampaigns(),
      ]);

      const raw = Array.isArray(accRes.data) ? accRes.data : [];
      setAccounts(
        raw.map((a) => ({
          id: a.id,
          name: a.name,
          meta_account_id: a.meta_account_id,
          account_status: a.account_status,
        })),
      );

      // Tally distinct clients per account key (Set dedupes across campaigns).
      const idMap = new Map();
      const nameMap = new Map();
      const add = (map, key, client) => {
        if (key == null || key === "") return;
        const k = String(key);
        let e = map.get(k);
        if (!e) { e = { count: 0, clients: new Set() }; map.set(k, e); }
        e.count += 1;
        if (client) e.clients.add(client);
      };
      for (const c of all) {
        const cId = normAccountId(c.ad_account_id);
        if (cId != null) add(idMap, cId, c.client_nomen_name);
        else add(nameMap, c.ad_account_name, c.client_nomen_name);
      }
      setById(idMap);
      setByName(nameMap);
    } catch (err) {
      console.error("Failed to load ad account clients:", err);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => loadAll());

  // Resolve an account's { count, clients[] }, mirroring campaignMatchesAccount()
  // resolution order: internal row id, then Meta id, then name fallback.
  const infoFor = (account) => {
    const accRowId = account.id != null ? String(account.id) : null;
    const accMetaId = normAccountId(account.meta_account_id);
    let e = null;
    if (accRowId != null && byId().has(accRowId)) e = byId().get(accRowId);
    else if (accMetaId != null && byId().has(accMetaId)) e = byId().get(accMetaId);
    else if (account.name != null && byName().has(String(account.name)))
      e = byName().get(String(account.name));
    const clients = e ? [...e.clients].sort((a, b) => a.localeCompare(b)) : [];
    return { count: e?.count ?? 0, clients };
  };

  // Filter accounts by name / Meta id / any client name. Cards carry the
  // search-narrowed client list so a client-name match highlights just the hit.
  const visibleCards = createMemo(() => {
    const q = search().trim().toLowerCase();
    return accounts()
      .map((account) => {
        const info = infoFor(account);
        return { account, count: info.count, clients: info.clients };
      })
      .filter(({ account, clients }) => {
        if (!q) return true;
        if (account.name?.toLowerCase().includes(q)) return true;
        if (account.meta_account_id?.toLowerCase().includes(q)) return true;
        return clients.some((c) => c.toLowerCase().includes(q));
      })
      .map(({ account, count, clients }) => {
        if (!q) return { account, count, clients };
        // If the match was on a client name, narrow the roster to matches.
        const nameHit =
          account.name?.toLowerCase().includes(q) ||
          account.meta_account_id?.toLowerCase().includes(q);
        const shown = nameHit
          ? clients
          : clients.filter((c) => c.toLowerCase().includes(q));
        return { account, count, clients: shown };
      });
  });

  const totalClients = createMemo(() => {
    const seen = new Set();
    for (const a of accounts())
      for (const c of infoFor(a).clients) seen.add(c);
    return seen.size;
  });

  return (
    <div class="min-h-screen bg-gray-50 dark:bg-gray-900 p-6 lg:p-8">

      {/* Page Header */}
      <div class="mb-4">
        <h1 class="text-2xl font-semibold text-gray-900 dark:text-white tracking-tight">
          Ad Account Clients
        </h1>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {accounts().length} account{accounts().length !== 1 ? "s" : ""} · every
          client running campaigns on each ad account
        </p>

        {/* View switcher — Accounts table ⇄ Clients by account */}
        <div class="inline-flex items-center gap-1 p-1 rounded-lg bg-gray-100 dark:bg-gray-800 mt-3">
          <A
            href="/ad-accounts"
            class="px-3.5 py-1.5 text-sm rounded-md font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            Accounts
          </A>
          <span class="px-3.5 py-1.5 text-sm rounded-md font-medium bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm">
            Clients by Account
          </span>
        </div>
      </div>

      {/* Search */}
      <div class="bg-white dark:bg-gray-900 rounded-xl border border-gray-200
                  dark:border-gray-700 p-4 mb-6 flex flex-wrap items-center gap-3">
        <div class="relative flex w-[500px] max-w-full">
          <svg
            class="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
            fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            type="text"
            placeholder="Search by account, Meta ID, or client name…"
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200
                   dark:border-gray-700 dark:bg-gray-800 dark:text-white
                   focus:outline-none focus:ring-1 focus:ring-purple-400 dark:focus:ring-gray-600"
          />
        </div>
        <Show when={search()}>
          <button
            onClick={() => setSearch("")}
            class="px-3 py-2 text-sm rounded-lg bg-red-50 text-red-600 border border-red-200
                   hover:bg-red-100 hover:border-red-300
                   dark:bg-gray-800 dark:text-gray-200 dark:border-gray-700 transition-colors"
          >
            Clear
          </button>
        </Show>
        <span class="ml-auto text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
          {visibleCards().length} account{visibleCards().length !== 1 ? "s" : ""}
          <Show when={!loading()}>{" · "}{totalClients()} clients</Show>
        </span>
      </div>

      {/* Loading skeleton (card-grid shaped) */}
      <Show
        when={!loading()}
        fallback={
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <For each={Array(4).fill(0)}>
              {() => (
                <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-5 animate-pulse">
                  <div class="flex items-center gap-3.5 mb-4">
                    <div class="w-11 h-11 rounded-full bg-gray-200 dark:bg-gray-700" />
                    <div class="flex-1 space-y-2">
                      <div class="h-3.5 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
                      <div class="h-2.5 w-44 bg-gray-100 dark:bg-gray-800 rounded" />
                    </div>
                    <div class="h-7 w-8 bg-gray-200 dark:bg-gray-700 rounded" />
                  </div>
                  <div class="space-y-3">
                    <For each={Array(5).fill(0)}>
                      {() => <div class="h-4 w-full bg-gray-100 dark:bg-gray-800 rounded" />}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </div>
        }
      >
        <Show
          when={visibleCards().length > 0}
          fallback={
            <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl py-16 px-5 text-center">
              <div class="font-sans font-semibold text-2xl text-gray-500 dark:text-gray-300 mb-1">
                No matches found
              </div>
              <div class="text-sm text-gray-400 dark:text-gray-500">
                Try a different account, Meta ID, or client name.
              </div>
            </div>
          }
        >
          <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <For each={visibleCards()}>
              {(card) => <AccountCard card={card} searching={!!search().trim()} />}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

// ── Account card — mirrors the Campaign Manager's Clients card design ──────────
function AccountCard(props) {
  const [expanded, setExpanded] = createSignal(false);
  // While searching, show every match; otherwise cap to the preview window.
  const capped = () => !props.searching && !expanded();
  const shown = () =>
    capped() ? props.card.clients.slice(0, PREVIEW_COUNT) : props.card.clients;
  const acc = () => props.card.account;

  return (
    <div class="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-sm overflow-hidden flex flex-col transition-shadow hover:shadow-md">
      {/* Header */}
      <div class="flex items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div class="flex items-center gap-3.5 min-w-0">
          <Avatar
            name={acc().name}
            size="w-11 h-11"
            textSize="text-base"
          />
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="font-sans font-bold text-[15px] text-gray-900 dark:text-white truncate" title={acc().name}>
                {acc().name}
              </span>
              <Show
                when={isActive(acc())}
                fallback={
                  <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300 flex-shrink-0">
                    <span class="w-1 h-1 rounded-full bg-red-500" />
                    Disabled
                  </span>
                }
              >
                <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300 flex-shrink-0">
                  <span class="w-1 h-1 rounded-full bg-green-500" />
                  Active
                </span>
              </Show>
            </div>
            <div class="text-[13px] font-mono text-gray-500 dark:text-gray-400 truncate mt-0.5" title={acc().meta_account_id}>
              {acc().meta_account_id ?? "—"}
            </div>
          </div>
        </div>
        <div class="text-right flex-shrink-0">
          <div class="text-[26px] font-bold text-gray-900 dark:text-white leading-none tabular-nums">
            {props.card.clients.length}
          </div>
          <div class="text-[10px] font-bold uppercase tracking-[0.12em] text-gray-400 dark:text-gray-500 mt-1">
            Clients
          </div>
        </div>
      </div>

      {/* Campaign count strip */}
      <div class="px-5 pb-3.5">
        <span class="text-[12px] text-gray-500 dark:text-gray-400">
          <b class="text-gray-700 dark:text-gray-300 tabular-nums font-semibold">{props.card.count}</b>
          {" "}campaign{props.card.count !== 1 ? "s" : ""} on this account
        </span>
      </div>

      {/* Client roster */}
      <div class="border-t border-gray-100 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
        <Show
          when={props.card.clients.length > 0}
          fallback={
            <div class="px-5 py-4 text-[13px] italic text-gray-400 dark:text-gray-500">
              No clients found on this account.
            </div>
          }
        >
          <For each={shown()}>
            {(name) => (
              <div class="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors">
                <span class="text-[13.5px] font-medium text-gray-800 dark:text-gray-100 truncate">
                  {name}
                </span>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* Expander */}
      <Show when={!props.searching && props.card.clients.length > PREVIEW_COUNT}>
        <button
          onClick={() => setExpanded((v) => !v)}
          class="mt-auto w-full flex items-center gap-1.5 px-5 py-3 border-t border-gray-100 dark:border-gray-800 text-left text-[13px] font-semibold text-[#AC2334] hover:bg-[#AC2334]/[0.04] transition-colors"
        >
          {expanded() ? "Show less" : `Show all ${props.card.clients.length} clients`}
          <svg
            class={`w-3.5 h-3.5 transition-transform ${expanded() ? "rotate-180" : ""}`}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </Show>
    </div>
  );
}
