import { createSignal, createResource, createMemo, For, Show, onCleanup } from "solid-js";
import Swal from "sweetalert2";
import * as XLSX from "xlsx";
import {
  fetchFundingAccounts,
  startFundingRefresh,
  getFundingRefreshStatus,
} from "../../services/funding";
import { scopeKey } from "../../stores/cmScope";
import { isGlobalRead } from "../../stores/currentUser";
import Avatar from "../../components/common/Avatar";
import useColumnSort from "../../components/Columnsorting";

// ─── "Refresh from Meta" copy ─────────────────────────────────────────────────
// Alok wants an on-demand balance refresh (the hourly sync feels slow). These
// messages are an inside joke — friendly, not literal. Keep them here so the
// roast level is easy to tune depending on who's watching. 😄
const REFRESH_COPY = {
  syncingTitle: "🧘 Patience, Alok! Your money is being loaded...",
  syncingBody: "Fetching fresh balances from Meta — this takes a few seconds.",
  cooldownTitle: "🫸 Easy there, Alok! You just refreshed.",
  cooldownBody: (secs) => `Have some patience — try again in ${secs}s.`,
  doneTitle: "Balances refreshed!",
  doneBody: (n) => `Synced ${n} account${n === 1 ? "" : "s"}.`,
  failedTitle: "Refresh hit a snag",
  failedBody:
    "Some accounts didn't sync. Try again shortly.",
  timeoutTitle: "Still working…",
  timeoutBody: "The sync is taking longer than usual — check back in a moment.",
};

// Poll cadence + safety cap for the background refresh job.
const REFRESH_POLL_MS = 3000;
const REFRESH_POLL_TIMEOUT_MS = 90000;

// Small corner toast — reuses the project's sweetalert2 pattern (see
// CampaignStatusControl) so refresh feedback matches the rest of the app.
const refreshToast = (icon, title, text) =>
  Swal.fire({
    icon,
    title,
    text,
    toast: true,
    position: "top-end",
    timer: icon === "error" ? 6000 : 4000,
    timerProgressBar: true,
    showConfirmButton: false,
  });

// ─────────────────────────────────────────────────────────────────────────────
// Themed to match the project (ClientDashboard family): navy ink (#14233A),
// brand red (#AC2334), slate text (#54657E/#8593A8), light surfaces. Layout —
// summary banner, funding-health bar, monogram avatars, S.No, vertical clients,
// filter chips — preserved. Font follows the project default (font-sans / Inter),
// the same as ClientDashboard.
// The funding state machine, money/null discipline, createResource, helpers and
// the API sort order are UNCHANGED. Display-only signals never fetch or write.
// NOTE: the table header is NOT sticky and the table has no fixed max-height
// scroll viewport — the page scrolls naturally.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Money / null discipline ──────────────────────────────────────────────────
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

// ─── Funding state machine (UNCHANGED) ────────────────────────────────────────
const fundingState = (a) => {
  if (a.is_prepay_account === false || a.funds_available === "card-funded")
    return "card";
  if (a.is_prepay_account == null) return "unknown";
  if (a.additional_required_24h == null) return "unknown";
  const n = parseFloat(a.additional_required_24h);
  if (isFinite(n) && n > 0) return "needs";
  return "funded";
};

const STATE_META = {
  needs: { label: "Needs funding", short: "Needs", color: "#AC2334" },
  funded: { label: "Funded", short: "Funded", color: "#15966A" },
  card: { label: "Card-funded", short: "Card", color: "#3E6FB0" },
  unknown: { label: "Not synced", short: "Not synced", color: "#C4CDDA" },
};

const STATE_ORDER = ["needs", "funded", "card", "unknown"];

// Client-type filter (v3): default CPL + Hybrid (the agency-funded view —
// retainer accounts are client-funded, so the agency never loads them).
const CLIENT_TYPES = [
  { key: "cpl", label: "CPL" },
  { key: "hybrid", label: "Hybrid" },
  { key: "retainer", label: "Retainer" },
];
const DEFAULT_CLIENT_TYPES = ["cpl", "hybrid"];

// Client-type chip (per-client breakdown rows) — project palette.
const TYPE_CHIP = {
  cpl: "bg-[#E9F7F1] text-[#15966A] dark:bg-teal-900/30 dark:text-teal-300",
  hybrid: "bg-[#ECF2FA] text-[#3E6FB0] dark:bg-indigo-900/30 dark:text-indigo-300",
  retainer: "bg-[#FBF3E2] text-[#B07A14] dark:bg-amber-900/30 dark:text-amber-300",
};
const TYPE_LABEL = { cpl: "CPL", hybrid: "Hybrid", retainer: "Retainer" };
const sumMoney = (items, key) =>
  items.reduce((s, b) => s + (parseFloat(b[key]) || 0), 0);

// Account name + avatar use the shared <Avatar> from ClientDashboard.

// ─── Ad-account id pill (click to copy) ───────────────────────────────────────
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
          <svg
            class="w-3 h-3 flex-none text-[#15966A]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
        }
      >
        <svg
          class="w-3 h-3 flex-none text-[#8593A8] group-hover/id:text-[#3E6FB0]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
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

// ─── "Synced X ago" freshness badge — dot colour signals how stale ────────────
function SyncedBadge(props) {
  const mins = () => {
    const t = new Date(props.iso).getTime();
    return isFinite(t) ? (Date.now() - t) / 60000 : null;
  };
  const dot = () => {
    const m = mins();
    if (m == null) return "#8593A8";
    if (m <= 30) return "#15966A"; // fresh
    if (m <= 360) return "#B07A14"; // a few hours
    return "#AC2334"; // stale
  };
  return (
    <Show when={relTime(props.iso)}>
      <span class="inline-flex items-center gap-1 mt-0.5 text-[10px] font-medium text-[#8593A8] dark:text-gray-500">
        <span
          class="w-1.5 h-1.5 rounded-full flex-none"
          style={`background:${dot()}`}
        />
        synced {relTime(props.iso)}
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
            <span class="text-[#8593A8] dark:text-gray-500 text-xs">
              {st() === "card" ? "No top-up needed" : "—"}
            </span>
          }
        >
          <span class="inline-flex items-center gap-1 text-[#15966A] dark:text-green-400 font-bold text-xs">
            <svg
              class="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            Covered
          </span>
        </Show>
      }
    >
      <span class="font-semibold text-[#AC2334] dark:text-red-400 ">
        {money2(a().additional_required_24h)}
      </span>
    </Show>
  );
}

// ─── Available (wallet balance) cell ──────────────────────────────────────────
function AvailableCell(props) {
  const st = () => props.state;
  const a = () => props.account;
  return (
    <Show
      when={st() === "needs" || st() === "funded"}
      fallback={
        <Show
          when={st() === "card"}
          fallback={<span class="text-[#8593A8] dark:text-gray-500">—</span>}
        >
          <span class="text-[#54657E] dark:text-gray-400 text-xs">
            No wallet
          </span>
        </Show>
      }
    >
      <div class="inline-flex flex-col items-end">
        <span class="text-[#1A2B45] dark:text-gray-300 font-semibold">
          {money2(a().funds_available) ?? "—"}
        </span>
        <SyncedBadge iso={a().balance_synced_at} />
      </div>
    </Show>
  );
}

// ─── Status badge (account health) ────────────────────────────────────────────
function StatusBadge(props) {
  const ok = () =>
    props.account.is_active && props.account.account_status === 1;
  return (
    <span
      class={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${
        ok()
          ? "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300"
          : "bg-[#FBF3E2] text-[#B07A14] dark:bg-amber-900/30 dark:text-amber-300"
      }`}
    >
      <span
        class={`w-1.5 h-1.5 rounded-full inline-block ${ok() ? "bg-[#15966A]" : "bg-[#B07A14]"}`}
      />
      {ok() ? "Active" : "Inactive"}
    </span>
  );
}

// ─── Clients — vertical plain-text list (no chips) ────────────────────────────
function Clients(props) {
  const list = () => (Array.isArray(props.clients) ? props.clients : []);
  return (
    <Show
      when={list().length > 0}
      fallback={<span class="text-[#8593A8] dark:text-gray-500">—</span>}
    >
      <div class="flex flex-col gap-0.5">
        <For each={list()}>
          {(c) => (
            <span class="text-[13px] text-[#54657E] dark:text-gray-300 font-medium leading-snug">
              {c}
            </span>
          )}
        </For>
      </div>
    </Show>
  );
}

// ─── Per-client breakdown sub-table (expanded account row) ────────────────────
// Renders a.client_breakdown — each client's slice of the account: active
// campaigns + base daily / GST / total required. Rows sum back to the account.
function ClientBreakdown(props) {
  const list = () => (Array.isArray(props.items) ? props.items : []);
  return (
    <Show
      when={list().length > 0}
      fallback={
        <p class="px-4 py-3 text-xs italic text-[#8593A8] dark:text-gray-500">
          Per-client breakdown isn’t available for this account yet.
        </p>
      }
    >
      <table class="min-w-full text-[13px]">
        <thead>
          <tr class="text-[#8593A8] dark:text-gray-400 uppercase text-[10px] font-bold tracking-wider">
            <th class="py-2 pl-4 pr-3 text-left">Client</th>
            <th class="py-2 px-3 text-right whitespace-nowrap">Active campaigns</th>
            <th class="py-2 px-3 text-right whitespace-nowrap">Base daily</th>
            <th class="py-2 px-3 text-right whitespace-nowrap">GST</th>
            <th class="py-2 pl-3 pr-4 text-right whitespace-nowrap">Total required</th>
          </tr>
        </thead>
        <tbody>
          <For each={list()}>
            {(b) => (
              <tr class="border-t border-[#E2E8F1] dark:border-gray-800">
                <td class="py-2 pl-4 pr-3 text-left">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="w-1.5 h-1.5 rounded-full bg-[#3E6FB0] flex-none" />
                    <span class="font-semibold text-[#1A2B45] dark:text-gray-200 truncate" title={b.client}>{b.client}</span>
                    <Show when={b.client_type}>
                      <span class={`flex-none text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase ${TYPE_CHIP[b.client_type] ?? TYPE_CHIP.retainer}`}>
                        {TYPE_LABEL[b.client_type] ?? b.client_type}
                      </span>
                    </Show>
                  </div>
                </td>
                <td class="py-2 px-3 text-right text-[#54657E] dark:text-gray-300 tabular-nums">{num(b.active_campaigns)}</td>
                <td class="py-2 px-3 text-right text-[#1A2B45] dark:text-gray-300 tabular-nums whitespace-nowrap">{money2(b.base_daily_budget) ?? "—"}</td>
                <td class="py-2 px-3 text-right text-[#54657E] dark:text-gray-400 tabular-nums whitespace-nowrap">{money2(b.gst) ?? "—"}</td>
                <td class="py-2 pl-3 pr-4 text-right font-bold text-[#14233A] dark:text-gray-100 tabular-nums whitespace-nowrap">{money2(b.total_daily_required) ?? "—"}</td>
              </tr>
            )}
          </For>
        </tbody>
        {/* Totals footer — reconciles to the account row above */}
        <tfoot>
          <tr class="border-t-2 border-[#D4DDE9] dark:border-gray-700 bg-white/60 dark:bg-gray-900/30">
            <td class="py-2 pl-4 pr-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">All clients</td>
            <td class="py-2 px-3 text-right font-bold text-[#14233A] dark:text-gray-100 tabular-nums">{num(list().reduce((s, b) => s + (Number(b.active_campaigns) || 0), 0))}</td>
            <td class="py-2 px-3 text-right font-bold text-[#14233A] dark:text-gray-100 tabular-nums whitespace-nowrap">{money2(String(sumMoney(list(), "base_daily_budget")))}</td>
            <td class="py-2 px-3 text-right font-bold text-[#14233A] dark:text-gray-100 tabular-nums whitespace-nowrap">{money2(String(sumMoney(list(), "gst")))}</td>
            <td class="py-2 pl-3 pr-4 text-right font-extrabold text-[#AC2334] dark:text-red-300 tabular-nums whitespace-nowrap">{money2(String(sumMoney(list(), "total_daily_required")))}</td>
          </tr>
        </tfoot>
      </table>
    </Show>
  );
}

export default function AccountFunding() {
  const [search, setSearch] = createSignal("");
  const [needsOnly, setNeedsOnly] = createSignal(false); // kept for compatibility
  const [stateFilter, setStateFilter] = createSignal("all"); // all | needs | funded | card | unknown
  const [statusFilter, setStatusFilter] = createSignal("all"); // all | active | inactive
  const [clientTypes, setClientTypes] = createSignal(DEFAULT_CLIENT_TYPES); // v3 multi-select

  // Toggle a client-type chip; never allow an empty selection.
  const toggleClientType = (key) => {
    setClientTypes((prev) => {
      const next = prev.includes(key)
        ? prev.filter((k) => k !== key)
        : [...prev, key];
      return next.length ? next : prev;
    });
  };

  // Refetch when the switch scope OR the client-type filter changes — the
  // backend re-scopes the dataset and recomputes all four summary tiles.
  const [data, { refetch }] = createResource(
    () => ({ scope: scopeKey(), types: clientTypes() }),
    async (s) => {
      const res = await fetchFundingAccounts(s.types);
      return res ?? { data: [], meta: null };
    },
  );

  const accounts = () => (Array.isArray(data()?.data) ? data().data : []);
  const summary = () => data()?.meta?.summary ?? null;

  // ─── "Refresh from Meta" — on-demand balance sync ─────────────────────────────
  // Admin / global-read only (backend enforces 403; we also gate the button's
  // visibility). Kicks off a background job, shows Alok's loading overlay, polls
  // to completion, then reloads the funding table with the fresh numbers. The
  // 60s cooldown is the real re-click guard; we also disable the button while a
  // refresh is in flight to avoid confusing double-triggers.
  const canRefresh = () => isGlobalRead();
  const [refreshing, setRefreshing] = createSignal(false); // overlay while syncing
  const [cooldownLeft, setCooldownLeft] = createSignal(0); // >0 → button on cooldown

  let pollTimer = null; // next status poll
  let cooldownTimer = null; // 1s countdown ticker
  let starting = false; // synchronous re-entrancy guard for the refresh POST
  onCleanup(() => {
    clearTimeout(pollTimer);
    clearInterval(cooldownTimer);
  });

  const startCooldown = (secs) => {
    clearInterval(cooldownTimer);
    setCooldownLeft(Math.max(0, Math.ceil(secs)));
    cooldownTimer = setInterval(() => {
      setCooldownLeft((n) => {
        if (n <= 1) {
          clearInterval(cooldownTimer);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
  };

  // Poll GET /funding/refresh/status until done/failed or the safety timeout.
  const pollRefresh = (taskId, startedAt) => {
    pollTimer = setTimeout(async () => {
      if (Date.now() - startedAt > REFRESH_POLL_TIMEOUT_MS) {
        setRefreshing(false);
        refreshToast("info", REFRESH_COPY.timeoutTitle, REFRESH_COPY.timeoutBody);
        return;
      }
      let st;
      try {
        st = await getFundingRefreshStatus(taskId);
      } catch {
        // Transient poll error — keep trying until the overall timeout.
        pollRefresh(taskId, startedAt);
        return;
      }
      if (st?.status === "done") {
        setRefreshing(false);
        const synced = Number(st?.summary?.synced) || 0;
        await refetch(); // reload the funding table with fresh numbers
        refreshToast("success", REFRESH_COPY.doneTitle, REFRESH_COPY.doneBody(synced));
        return;
      }
      if (st?.status === "failed") {
        setRefreshing(false);
        refreshToast("warning", REFRESH_COPY.failedTitle, REFRESH_COPY.failedBody);
        return;
      }
      // still "running" (or an unexpected shape) — poll again.
      pollRefresh(taskId, startedAt);
    }, REFRESH_POLL_MS);
  };

  const handleRefresh = async () => {
    // `starting` blocks a rapid 2nd click that lands BEFORE refreshing() is set
    // (during the in-flight POST) — otherwise two POSTs fire and click 1's loader
    // overlay hides click 2's cooldown banner.
    if (refreshing() || cooldownLeft() > 0 || starting) return;
    starting = true;
    let res;
    try {
      res = await startFundingRefresh();
    } catch (err) {
      if (err?.status === 403) {
        refreshToast("error", "Not allowed", "You don't have permission to refresh balances.");
      } else {
        refreshToast("error", "Couldn't start refresh", err?.message || "Please try again.");
      }
      return;
    } finally {
      starting = false;
    }

    // Read the status from the DATA object no matter how the layer wraps it: the
    // cooldown/started flag lives in `data`, never at the envelope top level. This
    // is robust whether startFundingRefresh returns the {success,message,data}
    // envelope OR the already-unwrapped data payload.
    const d = res?.data ?? res ?? {};
    const status = d.status;
    const seconds = d.seconds_remaining;

    if (status === "cooldown") {
      // Refreshed in the last 60s — show the banner + live countdown, NO new sync.
      startCooldown(Number(seconds) || 0);
      return;
    }

    if (status === "started" && d.task_id) {
      setRefreshing(true);
      pollRefresh(d.task_id, Date.now());
      return;
    }

    // Unexpected response shape — don't leave the user hanging.
    refreshToast("error", "Couldn't start refresh", "Unexpected response. Please try again.");
  };

  const isActive = (a) => a.is_active && a.account_status === 1;

  // Column sorting (same hook + ⇅/↑/↓ icons as the rest of the project). No
  // column selected → API order (shortfall desc) is preserved.
  const { columnSort, handleSort, getSortIcon } = useColumnSort();

  // Sort arrow next to a header label: brand-red when active, slate when idle.
  const SortIcon = (props) => (
    <span
      class={`ml-1 text-xs font-bold ${columnSort().key === props.col ? "text-[#AC2334] dark:text-red-400" : "text-[#8593A8] dark:text-gray-400"}`}
    >
      {getSortIcon(props.col)}
    </span>
  );

  // Sort accessor — money fields are strings, so parse them; null / "card-funded"
  // / unsynced values resolve to null and are pushed to the bottom either way.
  const sortValue = (a, key) => {
    switch (key) {
      case "name":
        return (a.name || "").toLowerCase();
      case "clients":
        return Array.isArray(a.clients) ? a.clients.length : 0;
      case "campaign_count":
        return Number(a.campaign_count) || 0;
      case "base_daily_budget":
      case "gst":
      case "total_daily_required":
      case "funds_available":
      case "additional_required_24h": {
        const n = parseFloat(a[key]);
        return isFinite(n) ? n : null;
      }
      case "status":
        return isActive(a) ? 1 : 0;
      default:
        return null;
    }
  };

  // Display filter only — API order preserved until a header is clicked.
  const rows = createMemo(() => {
    const q = search().trim().toLowerCase();
    const sf = stateFilter();
    const statusF = statusFilter();
    const filtered = accounts().filter((a) => {
      if (q) {
        const accountMatch = a.name?.toLowerCase().includes(q);

        const clientMatch = Array.isArray(a.clients)
          ? a.clients.some((client) => client?.toLowerCase().includes(q))
          : false;

        if (!accountMatch && !clientMatch) return false;
      }

      if (needsOnly() && fundingState(a) !== "needs") return false;
      if (sf === "available") {
        // "Available" isn't a funding state — it's any account with a positive
        // wallet balance (matches the Available column).
        const fa = parseFloat(a.funds_available);
        if (!(isFinite(fa) && fa > 0)) return false;
      } else if (sf !== "all" && fundingState(a) !== sf) return false;
      if (statusF === "active" && !isActive(a)) return false;
      if (statusF === "inactive" && isActive(a)) return false;

      return true;
    });

    const { key, direction } = columnSort();
    if (!key) return filtered; // preserve the API's shortfall-desc order

    const empty = (v) => v == null || (typeof v === "number" && !isFinite(v));
    return [...filtered].sort((a, b) => {
      const va = sortValue(a, key);
      const vb = sortValue(b, key);
      if (empty(va) && empty(vb)) return 0;
      if (empty(va)) return 1; // nulls/unknowns always last
      if (empty(vb)) return -1;
      if (typeof va === "number" && typeof vb === "number") {
        return direction === "asc" ? va - vb : vb - va;
      }
      return direction === "asc"
        ? String(va).localeCompare(String(vb), undefined, {
            sensitivity: "base",
          })
        : String(vb).localeCompare(String(va), undefined, {
            sensitivity: "base",
          });
    });
  });

  const stateCounts = createMemo(() => {
    const c = { all: 0, needs: 0, funded: 0, card: 0, unknown: 0, available: 0 };
    for (const a of accounts()) {
      c.all++;
      c[fundingState(a)]++;
      // "Available" cuts across funding state — any account with a positive
      // wallet balance (matches the Available column).
      const fa = parseFloat(a.funds_available);
      if (isFinite(fa) && fa > 0) c.available++;
    }
    return c;
  });

  const healthSegments = createMemo(() => {
    const c = stateCounts();
    const total = c.all || 1;
    return STATE_ORDER.map((k) => ({
      key: k,
      count: c[k],
      pct: (c[k] / total) * 100,
      color: STATE_META[k].color,
      label: STATE_META[k].label,
    }));
  });

  const needsCount = createMemo(
    () => accounts().filter((a) => fundingState(a) === "needs").length,
  );
  const needsPct = createMemo(() => {
    const t = accounts().length || 1;
    return Math.round((needsCount() / t) * 100);
  });

  // Totals for the sticky table footer — computed from the CURRENTLY VISIBLE
  // rows so they always match the active search / state / status / type filters
  // and the sort order.
  const totals = createMemo(() => {
    let campaigns = 0, base = 0, gst = 0, total = 0, avail = 0, toLoad = 0;
    for (const a of rows()) {
      campaigns += Number(a.campaign_count) || 0;
      base += parseFloat(a.base_daily_budget) || 0;
      gst += parseFloat(a.gst) || 0;
      total += parseFloat(a.total_daily_required) || 0;
      const fa = parseFloat(a.funds_available);
      if (isFinite(fa)) avail += fa;
      const tl = parseFloat(a.additional_required_24h);
      if (isFinite(tl)) toLoad += tl;
    }
    return { campaigns, base, gst, total, avail, toLoad, count: rows().length };
  });

  const anyFilter = () =>
    search().trim() ||
    stateFilter() !== "all" ||
    statusFilter() !== "all" ||
    needsOnly();

  const clearFilters = () => {
    setSearch("");
    setStateFilter("all");
    setStatusFilter("all");
    setNeedsOnly(false);
  };

  // ─── Download report (.xlsx) ────────────────────────────────────────────────
  // Exports exactly what's on screen (current search + state/status filters) plus
  // the summary band. Money goes out as numbers so Excel can sum/sort; the
  // null-vs-zero distinction is preserved as labels (Card-funded / Not synced /
  // N/A) so a card account never reads as ₹0.
  const downloadReport = () => {
    const list = rows();
    if (!list.length) return;

    const numOrBlank = (v) => {
      if (v == null) return "";
      const n = parseFloat(v);
      return isFinite(n) ? n : "";
    };

    const header = [
      "Account",
      "Ad Account ID",
      "Clients",
      "Campaigns",
      "Base Daily",
      "GST",
      "Total Required",
      "Available",
      "To Load (24h)",
      "Funding State",
      "Status",
      "Balance Synced",
    ];

    const body = list.map((a) => {
      const st = fundingState(a);
      const available =
        st === "card"
          ? "Card-funded"
          : st === "unknown"
            ? "Not synced"
            : numOrBlank(a.funds_available);
      const toLoad =
        st === "needs"
          ? numOrBlank(a.additional_required_24h)
          : st === "funded"
            ? 0
            : "N/A";
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
        STATE_META[st].label,
        a.is_active && a.account_status === 1 ? "Active" : "Inactive",
        a.balance_synced_at
          ? new Date(a.balance_synced_at).toLocaleString("en-IN")
          : "",
      ];
    });

    const filterBits = [];
    if (search().trim()) filterBits.push(`search: "${search().trim()}"`);
    if (stateFilter() !== "all")
      filterBits.push(
        `state: ${STATE_META[stateFilter()]?.label ?? stateFilter()}`,
      );
    if (statusFilter() !== "all") filterBits.push(`status: ${statusFilter()}`);

    const s = summary();
    const meta = [
      ["Account Funding Report"],
      ["Generated", new Date().toLocaleString("en-IN")],
      ...(filterBits.length ? [["Filter", filterBits.join(" · ")]] : []),
      ...(s
        ? [
            ["Total 24h Required", parseFloat(s.total_daily_required) || 0],
            [
              "Total To Load (prepaid shortfalls)",
              parseFloat(s.total_additional_required_24h) || 0,
            ],
            ["Accounts", Number(s.accounts) || 0],
            ["Prepaid / Card", `${s.prepaid_accounts} / ${s.card_accounts}`],
          ]
        : []),
      [],
    ];

    const ws = XLSX.utils.aoa_to_sheet([...meta, header, ...body]);
    ws["!cols"] = [
      { wch: 24 },
      { wch: 22 },
      { wch: 32 },
      { wch: 11 },
      { wch: 13 },
      { wch: 11 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 14 },
      { wch: 10 },
      { wch: 20 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Account Funding");
    const today = new Date().toISOString().split("T")[0];
    XLSX.writeFile(wb, `account-funding-${today}.xlsx`);
  };

  // ─── Per-client breakdown expand/collapse ───────────────────────────────────
  // Reads a.client_breakdown (per-client base_daily_budget / gst /
  // total_daily_required / active_campaigns that sum to the account totals).
  // The affordance only appears when the backend returns that array, so the
  // table is unchanged until the field ships.
  const [openRows, setOpenRows] = createSignal({});
  const rowId = (a) => a.ad_account_id ?? a.name;
  const isOpen = (a) => !!openRows()[rowId(a)];
  const toggleRow = (a) => setOpenRows((o) => ({ ...o, [rowId(a)]: !o[rowId(a)] }));
  const hasBreakdown = (a) => Array.isArray(a.client_breakdown) && a.client_breakdown.length > 0;

  return (
    <div class="font-sans min-h-screen bg-gray-50 dark:bg-gray-900 p-4 md:p-6 lg:p-8">
      {/* Header */}
      <div class="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p class="text-xs font-bold uppercase tracking-[0.12em] text-[#AC2334] mb-1.5">
            Coordination · Funding
          </p>
          <h1 class="text-2xl font-bold text-[#14233A] dark:text-white tracking-tight">
            Account Funding
          </h1>
          <p class="text-sm text-[#54657E] dark:text-gray-400 mt-1">
            GST-inclusive 24-hour funding requirement per ad account, sorted by
            shortfall.
          </p>
        </div>
        <div class="flex items-center gap-2.5 flex-wrap">
          {/* Refresh from Meta — admin / global-read only */}
          <Show when={canRefresh()}>
            <button
              onClick={handleRefresh}
              disabled={refreshing() || cooldownLeft() > 0}
              title={
                cooldownLeft() > 0
                  ? `Just refreshed — try again in ${cooldownLeft()}s`
                  : "Fetch fresh wallet balances from Meta"
              }
              class="group inline-flex items-center gap-2.5 pl-2.5 pr-4 py-2.5 rounded-xl text-sm font-bold text-[#14233A] dark:text-gray-100
                     bg-gray-50 dark:bg-gray-800 border border-[#D4DDE9] dark:border-gray-700 hover:border-[#14233A]/50 hover:bg-white dark:hover:bg-gray-700
                     shadow-[0_1px_2px_rgba(16,29,49,.06)] active:scale-[0.97]
                     disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100
                     transition-all duration-200"
            >
              <span class="flex items-center justify-center w-6 h-6 rounded-lg bg-[#EEF2F7] dark:bg-gray-700 group-hover:bg-[#E3EAF3] dark:group-hover:bg-gray-600 transition-colors">
                <svg
                  class={`w-4 h-4 ${refreshing() ? "animate-spin" : "transition-transform duration-500 group-hover:rotate-180"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M23 4v6h-6M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
                </svg>
              </span>
              {refreshing()
                ? "Refreshing…"
                : cooldownLeft() > 0
                  ? `Wait ${cooldownLeft()}s`
                  : "Refresh"}
            </button>
          </Show>

          <button
            onClick={downloadReport}
            disabled={data.loading || rows().length === 0}
            title="Download the current table as an Excel report"
            class="group inline-flex items-center gap-2.5 pl-2.5 pr-4 py-2.5 rounded-xl text-sm font-bold text-white
                   bg-[#14233A] hover:bg-[#1f3553] shadow-[0_1px_2px_rgba(16,29,49,.18),0_6px_16px_rgba(16,29,49,.14)]
                   hover:shadow-[0_2px_4px_rgba(16,29,49,.22),0_10px_22px_rgba(16,29,49,.18)] active:scale-[0.97]
                   disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none disabled:active:scale-100
                   transition-all duration-200"
          >
            <span class="flex items-center justify-center w-6 h-6 rounded-lg bg-white/15 group-hover:bg-white/25 transition-colors">
              <svg
                class="w-4 h-4 transition-transform duration-200 group-hover:translate-y-0.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                stroke-width="2.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
              </svg>
            </span>
            Download report
          </button>
        </div>
      </div>

      {/* ════ REFRESH LOADING OVERLAY — Alok's "patience" screen 🧘 ════ */}
      <Show when={refreshing()}>
        <div class="fixed inset-0 z-[120] flex items-center justify-center bg-[#0B1626]/55 backdrop-blur-sm px-4">
          <div class="w-full max-w-sm rounded-2xl bg-white dark:bg-gray-900 border border-[#E2E8F1] dark:border-gray-700 shadow-2xl px-7 py-8 text-center">
            <div class="mx-auto mb-5 w-14 h-14 rounded-full border-4 border-[#EEF2F7] dark:border-gray-700 border-t-[#AC2334] animate-spin" />
            <p class="text-base font-bold text-[#14233A] dark:text-white">
              {REFRESH_COPY.syncingTitle}
            </p>
            <p class="text-sm text-[#54657E] dark:text-gray-400 mt-2 leading-snug">
              {REFRESH_COPY.syncingBody}
            </p>
          </div>
        </div>
      </Show>

      {/* ════ REFRESH COOLDOWN NOTICE — clicked again within 60s 🫸 ════ */}
      <Show when={cooldownLeft() > 0}>
        <div class="fixed top-6 right-6 z-[130] w-[340px] max-w-[calc(100vw-3rem)] rounded-2xl border border-[#B07A14]/40 dark:border-amber-700/70 bg-[#FBF3E2] dark:bg-amber-950/40 shadow-xl px-4 py-3.5">
          <p class="text-sm font-bold text-[#8A5D10] dark:text-amber-300">
            {REFRESH_COPY.cooldownTitle}
          </p>
          <p class="text-sm text-[#7A6636] dark:text-amber-200/80 mt-0.5 leading-snug">
            {REFRESH_COPY.cooldownBody(cooldownLeft())}
          </p>
        </div>
      </Show>

      {/* ════ CLIENT-TYPE FILTER (v3) ════ */}
      <div class="flex flex-wrap items-center gap-2 mb-5">
        <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400 mr-1">
          Client type
        </span>
        <For each={CLIENT_TYPES}>
          {(t) => {
            const on = () => clientTypes().includes(t.key);
            return (
              <button
                onClick={() => toggleClientType(t.key)}
                aria-pressed={on()}
                class={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
                  on()
                    ? "bg-[#14233A] text-white border-[#14233A]"
                    : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
                }`}
              >
                <svg
                  class="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <Show
                    when={on()}
                    fallback={
                      <circle cx="12" cy="12" r="9" stroke-width="1.6" />
                    }
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </Show>
                </svg>
                {t.label}
              </button>
            );
          }}
        </For>
        <span class="text-xs text-[#8593A8] dark:text-gray-500 ml-1">
          Retainer accounts are client-funded; excluded by default.
        </span>
      </div>

      {/* ════ LIGHT SUMMARY BANNER ════ */}
      <Show
        when={!data.loading && summary()}
        fallback={
          <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-6 mb-5">
            <div class="h-9 w-40 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            <div class="h-3 w-full bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse mt-6" />
          </div>
        }
      >
        <div class="bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 rounded-2xl shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] px-5 sm:px-7 py-6 mb-5">
          {/* KPI strip */}
          <div class="flex flex-wrap items-stretch gap-y-5">
            <div class="px-0 sm:pr-7 flex-1 min-w-[160px]">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Total to load · next 24h
              </p>
              <p class="text-xl sm:text-2xl font-bold text-[#AC2334] dark:text-red-400   mt-2 ">
                {moneyWhole(summary().total_additional_required_24h)}
              </p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-2">
                prepaid shortfalls only
              </p>
            </div>
            <div class="px-5 sm:px-7 flex-1 min-w-[140px] border-l border-[#E2E8F1] dark:border-gray-700">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Total 24h required
              </p>
              <p class="text-xl font-bold text-gray-700 dark:text-white mt-2 ">
                {moneyWhole(summary().total_daily_required)}
              </p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-2">
                base + GST
              </p>
            </div>
            <div class="px-5 sm:px-7 flex-1 min-w-[140px] border-l border-[#E2E8F1] dark:border-gray-700">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Total base daily
              </p>
              <p class="text-xl font-bold text-gray-700 dark:text-white mt-2 ">
                {moneyWhole(summary().total_base_daily_budget)}
              </p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-2">
                before GST
              </p>
            </div>
            <div class="px-5 sm:px-7 flex-1 min-w-[140px] border-l border-[#E2E8F1] dark:border-gray-700">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Total GST (18%)
              </p>
              <p class="text-xl font-bold text-gray-700 dark:text-white  mt-2 ">
                {moneyWhole(summary().total_gst)}
              </p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-2">
                on base daily budget
              </p>
            </div>
            <div class="px-5 sm:pl-7 flex-1 min-w-[150px] border-l border-[#E2E8F1] dark:border-gray-700">
              <p class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Accounts
              </p>
              <p class="text-xl font-bold text-[#14233A] dark:text-white  mt-2 ">
                {num(summary().accounts)}
              </p>
              <p class="text-xs text-[#54657E] dark:text-gray-400 mt-2">
                <b class="text-[#1A2B45] dark:text-gray-200 font-bold">
                  {num(summary().prepaid_accounts)}
                </b>{" "}
                prepaid ·{" "}
                <b class="text-[#1A2B45] dark:text-gray-200 font-bold">
                  {num(summary().card_accounts)}
                </b>{" "}
                card
              </p>
            </div>
          </div>

          {/* Funding-health bar */}
          <div class="mt-6 pt-5 border-t border-[#E2E8F1] dark:border-gray-700">
            <div class="flex items-center justify-between mb-2.5">
              <span class="text-[11px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-400">
                Funding health across {num(accounts().length)} accounts
              </span>
              <span class="text-xs font-semibold text-[#54657E] dark:text-gray-400">
                {needsPct()}% need funding
              </span>
            </div>
            <div class="flex h-2 rounded-full overflow-hidden bg-[#E2E8F1] dark:bg-gray-700">
              <For each={healthSegments()}>
                {(seg) => (
                  <Show when={seg.pct > 0}>
                    <div
                      style={`width:${seg.pct}%;background:${seg.color}`}
                      title={`${seg.label}: ${seg.count}`}
                    />
                  </Show>
                )}
              </For>
            </div>
            <div class="flex flex-wrap gap-x-5 gap-y-1.5 mt-3">
              <For each={healthSegments()}>
                {(seg) => (
                  <span class="inline-flex items-center gap-2 text-xs font-medium text-[#54657E] dark:text-gray-400">
                    <span
                      class="w-2.5 h-2.5 rounded"
                      style={`background:${seg.color}`}
                    />
                    {seg.label}{" "}
                    <b class="text-[#14233A] dark:text-white font-extrabold tabular-nums">
                      {num(seg.count)}
                    </b>
                  </span>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      {/* ════ FILTER TOOLBAR ════ */}
      <div class="bg-gray-50 dark:bg-gray-900 rounded-xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-3.5 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex-1 min-w-[220px]">
          <svg
            class="w-4 h-4 text-[#8593A8] absolute left-3 top-1/2 -translate-y-1/2"
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
            placeholder="Search by account name or client..."
            value={search()}
            onInput={(e) => setSearch(e.target.value)}
            class="w-full pl-9 pr-3 py-2.5 text-sm rounded-lg border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 text-[#1A2B45] dark:text-white placeholder:text-[#8593A8] focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] focus:bg-gray-50"
          />
        </div>

        <div class="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => {
              setStateFilter("all");
              setNeedsOnly(false);
            }}
            class={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors ${
              stateFilter() === "all"
                ? "bg-[#14233A] text-white border-[#14233A]"
                : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
            }`}
          >
            All
            <span
              class={`text-[11px] font-extrabold px-1.5 py-px rounded-full ${stateFilter() === "all" ? "bg-white/20 text-white" : "bg-[#F1F4F9] dark:bg-gray-700 text-[#8593A8]"}`}
            >
              {stateCounts().all}
            </span>
          </button>

          <For each={STATE_ORDER}>
            {(key) => (
              <button
                onClick={() => {
                  setStateFilter(key);
                  setNeedsOnly(false);
                }}
                class={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors ${
                  stateFilter() === key
                    ? key === "needs"
                      ? "bg-[#AC2334] text-white border-[#AC2334]"
                      : "bg-[#14233A] text-white border-[#14233A]"
                    : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
                }`}
              >
                {STATE_META[key].short}
                <span
                  class={`text-[11px] font-extrabold px-1.5 py-px rounded-full ${stateFilter() === key ? "bg-white/20 text-white" : "bg-[#F1F4F9] dark:bg-gray-700 text-[#8593A8]"}`}
                >
                  {stateCounts()[key]}
                </span>
              </button>
            )}
          </For>

          {/* Available — cross-cutting: accounts with a positive wallet balance */}
          <button
            onClick={() => {
              setStateFilter(stateFilter() === "available" ? "all" : "available");
              setNeedsOnly(false);
            }}
            class={`inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[13px] font-semibold border transition-colors ${
              stateFilter() === "available"
                ? "bg-[#15966A] text-white border-[#15966A]"
                : "bg-gray-50 dark:bg-gray-800 text-[#54657E] dark:text-gray-300 border-[#E2E8F1] dark:border-gray-700 hover:border-[#14233A]/40"
            }`}
          >
            Available
            <span
              class={`text-[11px] font-extrabold px-1.5 py-px rounded-full ${stateFilter() === "available" ? "bg-white/20 text-white" : "bg-[#F1F4F9] dark:bg-gray-700 text-[#8593A8]"}`}
            >
              {stateCounts().available}
            </span>
          </button>
        </div>

        <div class="relative">
          <select
            value={statusFilter()}
            onChange={(e) => setStatusFilter(e.target.value)}
            class="appearance-none border border-[#E2E8F1] dark:border-gray-700 bg-[#F8FAFC] dark:bg-gray-800 rounded-lg pl-3 pr-9 py-2.5 text-[13px] font-semibold text-[#1A2B45] dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#AC2334]/25 focus:border-[#AC2334] cursor-pointer"
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <svg
            class="w-4 h-4 text-[#8593A8] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </div>

        <div class="flex items-center gap-3 ml-auto">
          <Show when={anyFilter()}>
            <button
              onClick={clearFilters}
              class="text-[13px] font-semibold text-[#AC2334] hover:underline"
            >
              Clear
            </button>
          </Show>
          <span class="text-sm font-bold text-[#8593A8] dark:text-gray-500 whitespace-nowrap">
            <b class="text-[#14233A] dark:text-white">{rows().length}</b> shown
          </span>
        </div>
      </div>

      {/* Error */}
      <Show when={data.error}>
        <div class="bg-[#FBEEF0] dark:bg-red-900/20 border border-[#AC2334]/25 dark:border-red-800 rounded-xl p-4 mb-4 text-sm font-medium text-[#AC2334] dark:text-red-400">
          Failed to load account funding. Please try again.
        </div>
      </Show>

      {/* ════ DESKTOP TABLE ════ */}
      <div class="hidden md:block bg-gray-50 dark:bg-gray-900 rounded-2xl border border-[#E2E8F1] dark:border-gray-700 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] overflow-auto max-h-[calc(100vh-130px)]">
        <table class="min-w-full text-sm border-separate border-spacing-0">
          <thead>
            <tr class="bg-[#F8FAFC] dark:bg-gray-800 text-[#54657E] dark:text-gray-400 uppercase text-xs font-semibold tracking-wider">
              <th class="p-4 text-center whitespace-nowrap w-16 sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-800 border-b border-[#D4DDE9] dark:border-gray-700">
                S.No
              </th>
              <th
                onClick={() => handleSort("name")}
                class="p-4 text-left whitespace-nowrap min-w-[220px] sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200 transition-colors"
              >
                Account
                <SortIcon col="name" />
              </th>
              <th
                onClick={() => handleSort("clients")}
                class="p-4 text-left whitespace-nowrap min-w-[200px] sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200 transition-colors"
              >
                Clients
                <SortIcon col="clients" />
              </th>
              <th
                onClick={() => handleSort("campaign_count")}
                class="p-4 text-right whitespace-nowrap sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200 transition-colors"
              >
                Campaigns
                <SortIcon col="campaign_count" />
              </th>
              <th
                onClick={() => handleSort("base_daily_budget")}
                class="p-4 text-right whitespace-nowrap sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200 transition-colors"
              >
                Base Daily
                <SortIcon col="base_daily_budget" />
              </th>
              <th
                onClick={() => handleSort("gst")}
                class="p-4 text-right whitespace-nowrap sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200 transition-colors"
              >
                GST
                <SortIcon col="gst" />
              </th>
              <th
                onClick={() => handleSort("total_daily_required")}
                class="p-4 text-right whitespace-nowrap sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200 transition-colors"
              >
                Total Required
                <SortIcon col="total_daily_required" />
              </th>
              <th
                onClick={() => handleSort("funds_available")}
                class="p-4 text-right whitespace-nowrap sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200 transition-colors"
              >
                Available
                <SortIcon col="funds_available" />
              </th>
              <th
                onClick={() => handleSort("additional_required_24h")}
                class="p-4 text-right whitespace-nowrap sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200 transition-colors"
              >
                To Load (24h)
                <SortIcon col="additional_required_24h" />
              </th>
              <th
                onClick={() => handleSort("status")}
                class="p-4 text-center whitespace-nowrap sticky top-0 z-20 bg-[#F8FAFC] dark:bg-gray-800 border-b border-[#D4DDE9] dark:border-gray-700 cursor-pointer select-none hover:text-[#14233A] dark:hover:text-gray-200 transition-colors"
              >
                Status
                <SortIcon col="status" />
              </th>
            </tr>
          </thead>

          <Show
            when={!data.loading}
            fallback={
              <tbody>
                <For each={Array(8).fill(0)}>
                  {() => (
                    <tr class="animate-pulse">
                      <For each={Array(10).fill(0)}>
                        {(_, idx) => (
                          <td class="p-4 border-b border-[#E2E8F1] dark:border-gray-800">
                            <div
                              class={`h-3 bg-gray-200 dark:bg-gray-700 rounded ${idx() === 1 ? "w-40" : idx() === 2 ? "w-32" : "w-16 ml-auto"}`}
                            />
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
                  const expandable = hasBreakdown(a);
                  return (
                    <>
                    <tr
                      onClick={() => expandable && toggleRow(a)}
                      class={`group transition-colors ${expandable ? "cursor-pointer select-none" : ""} ${isOpen(a) ? "bg-[#F6F9FC] dark:bg-gray-800/40" : "hover:bg-[#F6F9FC] dark:hover:bg-gray-800/40"}`}
                    >
                      {/* S.No */}
                      <td class="px-4 py-2.5 text-center align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                        <span class="inline-flex items-center justify-center w-7 h-7 rounded-full bg-[#FBEEF0] dark:bg-red-900/30 text-[#AC2334] dark:text-red-300 text-xs font-extrabold">
                          {i() + 1}
                        </span>
                      </td>
                      {/* Account — Avatar + name (ClientDashboard style) */}
                      <td class="px-4 py-2.5 align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                        <div class="flex items-center gap-3">
                          <Show when={expandable} fallback={<span class="w-4 flex-none" />}>
                            <svg
                              class="w-4 h-4 flex-none text-[#8593A8] transition-transform"
                              style={{ transform: isOpen(a) ? "rotate(90deg)" : "rotate(0deg)" }}
                              fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
                            >
                              <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </Show>
                          <Avatar name={a.name} />
                          <div class="min-w-0">
                            <span
                              class="block text-blue-900 dark:text-gray-100 font-semibold truncate"
                              title={a.name}
                            >
                              {a.name}
                            </span>
                            <Show when={a.ad_account_id}>
                              <AccountIdPill id={a.ad_account_id} />
                            </Show>
                          </div>
                        </div>
                      </td>
                      {/* Clients — vertical plain text */}
                      <td class="px-4 py-2.5 align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                        <Clients clients={a.clients} />
                      </td>
                      <td class="px-4 py-2.5 text-right align-middle text-[#54657E] dark:text-gray-300 font-semibold tabular-nums border-b border-[#E2E8F1] dark:border-gray-800">
                        {num(a.campaign_count)}
                      </td>
                      <td class="px-4 py-2.5 text-right align-middle text-[#1A2B45] dark:text-gray-300 whitespace-nowrap  border-b border-[#E2E8F1] dark:border-gray-800">
                        {money2(a.base_daily_budget) ?? "—"}
                      </td>
                      <td class="px-4 py-2.5 text-right align-middle text-[#54657E] dark:text-gray-400 whitespace-nowrap  border-b border-[#E2E8F1] dark:border-gray-800">
                        {money2(a.gst) ?? "—"}
                      </td>
                      <td class="px-4 py-2.5 text-right align-middle text-[#14233A] dark:text-gray-100 font-semibold whitespace-nowrap  border-b border-[#E2E8F1] dark:border-gray-800">
                        {money2(a.total_daily_required) ?? "—"}
                      </td>
                      <td class="px-4 py-2.5 text-right align-middle whitespace-nowrap border-b font-semibold border-[#E2E8F1] dark:border-gray-800">
                        <AvailableCell account={a} state={st} />
                      </td>
                      <td class="px-4 py-2.5 text-right align-middle whitespace-nowrap border-b font-semibold border-[#E2E8F1] dark:border-gray-800">
                        <ToLoadCell account={a} state={st} />
                      </td>
                      <td class="px-4 py-2.5 text-center align-middle border-b border-[#E2E8F1] dark:border-gray-800">
                        <StatusBadge account={a} />
                      </td>
                    </tr>
                    <Show when={expandable && isOpen(a)}>
                      <tr>
                        <td colspan="10" class="p-0 bg-[#F8FAFC] dark:bg-gray-800/40 border-b border-[#E2E8F1] dark:border-gray-800">
                          <div class="px-6 py-3">
                            <p class="text-[10px] font-bold uppercase tracking-wider text-[#8593A8] dark:text-gray-500 mb-1 pl-4">Per-client allocation</p>
                            <ClientBreakdown items={a.client_breakdown} />
                          </div>
                        </td>
                      </tr>
                    </Show>
                    </>
                  );
                }}
              </For>

              <Show when={rows().length === 0}>
                <tr>
                  <td
                    colspan="10"
                    class="py-16 text-center text-[#8593A8] dark:text-gray-500"
                  >
                    {anyFilter()
                      ? "No accounts match the current filters."
                      : "No accounts to show."}
                  </td>
                </tr>
              </Show>
            </tbody>
          </Show>

          {/* Sticky totals footer — reflects the current filters + sort */}
          <Show when={!data.loading && rows().length > 0}>
            <tfoot>
              <tr class="text-[13px]">
                <td class="sticky bottom-0 z-20 bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3" />
                <td class="sticky bottom-0 z-20 bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-[#54657E] dark:text-gray-300">
                  Totals · {num(totals().count)} account{totals().count !== 1 ? "s" : ""}
                </td>
                <td class="sticky bottom-0 z-20 bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3" />
                <td class="sticky bottom-0 z-20 bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3 text-right font-extrabold text-[#14233A] dark:text-gray-100 tabular-nums">{num(totals().campaigns)}</td>
                <td class="sticky bottom-0 z-20 bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3 text-right font-extrabold text-[#14233A] dark:text-gray-100 tabular-nums whitespace-nowrap">{money2(String(totals().base))}</td>
                <td class="sticky bottom-0 z-20 bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3 text-right font-extrabold text-[#14233A] dark:text-gray-100 tabular-nums whitespace-nowrap">{money2(String(totals().gst))}</td>
                <td class="sticky bottom-0 z-20 bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3 text-right font-extrabold text-[#14233A] dark:text-gray-100 tabular-nums whitespace-nowrap">{money2(String(totals().total))}</td>
                <td class="sticky bottom-0 z-20 bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3 text-right font-bold text-[#1A2B45] dark:text-gray-200 tabular-nums whitespace-nowrap">{money2(String(totals().avail))}</td>
                <td class="sticky bottom-0 z-20 bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3 text-right font-extrabold text-[#AC2334] dark:text-red-300 tabular-nums whitespace-nowrap">{money2(String(totals().toLoad))}</td>
                <td class="sticky bottom-0 z-20 bg-[#EEF2F7] dark:bg-gray-800 border-t-2 border-[#D4DDE9] dark:border-gray-700 px-4 py-3" />
              </tr>
            </tfoot>
          </Show>
        </table>
      </div>

      {/* ════ MOBILE CARD LIST ════ */}
      <div class="md:hidden space-y-3">
        <Show
          when={!data.loading}
          fallback={
            <For each={Array(5).fill(0)}>
              {() => (
                <div class="h-32 rounded-xl bg-gray-50 dark:bg-gray-800 border border-[#E2E8F1] dark:border-gray-700 animate-pulse" />
              )}
            </For>
          }
        >
          <For each={rows()}>
            {(a, i) => {
              const st = fundingState(a);
              return (
                <div class="rounded-xl border border-[#E2E8F1] dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shadow-[0_1px_2px_rgba(16,29,49,.05),0_4px_14px_rgba(16,29,49,.04)] p-4">
                  <div class="flex items-center gap-3">
                    <span class="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[#FBEEF0] dark:bg-red-900/30 text-[#AC2334] dark:text-red-300 text-[11px] font-extrabold flex-none">
                      {i() + 1}
                    </span>
                    <Avatar name={a.name} size="w-9 h-9" />
                    <div class="min-w-0">
                      <span class="block text-blue-900 dark:text-gray-100 font-semibold truncate">
                        {a.name}
                      </span>
                      <Show when={a.ad_account_id}>
                        <AccountIdPill id={a.ad_account_id} />
                      </Show>
                    </div>
                  </div>

                  <div class="mt-3 pt-3 border-t border-[#E2E8F1] dark:border-gray-700 flex items-baseline justify-between">
                    <span class="text-xs font-semibold uppercase tracking-wide text-[#8593A8] dark:text-gray-400">
                      To Load (24h)
                    </span>
                    <span class="text-base">
                      <ToLoadCell account={a} state={st} />
                    </span>
                  </div>

                  <div class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                    <div class="flex justify-between">
                      <span class="text-[#8593A8] dark:text-gray-500">
                        Total Req.
                      </span>
                      <span class="font-semibold text-[#1A2B45] dark:text-gray-300 tabular-nums">
                        {money2(a.total_daily_required) ?? "—"}
                      </span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-[#8593A8] dark:text-gray-500">
                        Available
                      </span>
                      <span>
                        <AvailableCell account={a} state={st} />
                      </span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-[#8593A8] dark:text-gray-500">
                        Base
                      </span>
                      <span class="font-semibold text-[#1A2B45] dark:text-gray-300 tabular-nums">
                        {money2(a.base_daily_budget) ?? "—"}
                      </span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-[#8593A8] dark:text-gray-500">GST</span>
                      <span class="font-semibold text-[#1A2B45] dark:text-gray-300 tabular-nums">
                        {money2(a.gst) ?? "—"}
                      </span>
                    </div>
                  </div>

                  <div class="mt-3 pt-3 border-t border-[#E2E8F1] dark:border-gray-700">
                    <p class="text-[10px] font-bold uppercase tracking-wide text-[#8593A8] dark:text-gray-500 mb-1.5">
                      Clients
                    </p>
                    <Clients clients={a.clients} />
                  </div>

                  <Show when={hasBreakdown(a)}>
                    <div class="mt-3 pt-3 border-t border-[#E2E8F1] dark:border-gray-700">
                      <button onClick={() => toggleRow(a)} class="flex items-center gap-1.5 text-xs font-bold text-[#3E6FB0] dark:text-blue-300">
                        <svg class="w-3.5 h-3.5 transition-transform" style={{ transform: isOpen(a) ? "rotate(90deg)" : "rotate(0deg)" }} fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
                        {isOpen(a) ? "Hide" : "Show"} per-client allocation
                      </button>
                      <Show when={isOpen(a)}>
                        <div class="mt-2 -mx-4 overflow-x-auto border-t border-[#E2E8F1] dark:border-gray-700">
                          <ClientBreakdown items={a.client_breakdown} />
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <div class="mt-3 flex justify-end">
                    <StatusBadge account={a} />
                  </div>
                </div>
              );
            }}
          </For>
          <Show when={rows().length === 0}>
            <div class="py-16 text-center text-[#8593A8] dark:text-gray-500">
              {anyFilter()
                ? "No accounts match the current filters."
                : "No accounts to show."}
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
