import { api } from "../api/api";
import { scopeQuery, applyMeta } from "../stores/cmScope";

// ─── Account Funding service ──────────────────────────────────────────────────
// GET /cm/funding/accounts/  (BASE_URL already includes /api, so the spec's
// /api/cm/... maps to /cm/...). Returns every account in scope, ALREADY sorted
// by shortfall descending (most urgent to fund first) — callers must preserve
// that order. Switch-mode aware: threads ?as_team_member_id via scopeQuery().
//
// clientTypes (optional) — array of "cpl" | "hybrid" | "retainer". Sent as
// ?client_types=cpl,hybrid. Omitting it lets the backend default to cpl,hybrid
// (the agency-funded view that excludes client-funded retainer accounts).
export const fetchFundingAccounts = async (clientTypes) => {
  let url = `/cm/funding/accounts/?1=1`;
  if (Array.isArray(clientTypes) && clientTypes.length) {
    url += `&client_types=${encodeURIComponent(clientTypes.join(","))}`;
  }
  url += scopeQuery({ supportsOwn: true });

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// ─── "Refresh from Meta" — on-demand balance sync ─────────────────────────────
// Admin / global-read only (the backend enforces 403 otherwise). Balance sync
// across all ~78 prepaid accounts takes ~30-60s, so it runs as a background job:
// POST kicks it off (or reports a cooldown), then the caller polls the status
// endpoint until it's done. A 60s server-side cooldown stops rapid re-clicks
// from hammering Meta.
//
// POST returns the standard { success, data, message } envelope with data being
// either:
//   { status: "started",  task_id, cooldown_seconds }         — a sync kicked off
//   { status: "cooldown", seconds_remaining, last_task_id }   — synced <60s ago
export const startFundingRefresh = async () => {
  const res = await api(`/cm/funding/refresh/`, { method: "POST" });
  return res?.data ?? null;
};

// ─── "Funds Added by Date" — money loaded into ad accounts on a chosen day ────
// GET /cm/funding/funds-added/?date=YYYY-MM-DD  (BASE_URL already includes /api).
// A SEPARATE, additive feed from the main funding table: how much was loaded into
// each ad account on the picked date. Same auth/scope as the funding page — admins
// see all accounts, CMs see their scoped accounts (handled server-side). Switch-
// mode aware: threads the active scope via scopeQuery (supportsOwn like the accounts
// endpoint). `date` optional; omit to let the backend default to today (local).
//
// Response (envelope-unwrapped by api()):
//   { date, total_added, per_account:[{ account_id, name, meta_account_id, added,
//     available_start, available_end, spend, reason }], accounts_with_data,
//     accounts_without_data }
// per_account[].added is null when an account lacks snapshot history for that day
// (show "no data"/"—", never 0). Backend already sorts most-added first.
//
// clientTypes (optional) — same param, parser and default as the accounts
// endpoint above: ?client_types=cpl,hybrid, omit to let the backend default to
// cpl,hybrid. meta.client_types echoes the applied filter.
//
// NOTE: this endpoint filters ACCOUNTS by the client types they serve, then
// reports each one's wallet-balance delta in full. A balance delta is money
// loaded into the account, not into a campaign, so it can't be split by client
// type — an account serving both a retainer and a CPL/hybrid client reports its
// whole amount. That's why the totals here won't tie out with Account Funding
// (which filters campaigns before aggregating). Inherent, not a bug.
export const fetchFundsAdded = async (date, clientTypes) => {
  let url = `/cm/funding/funds-added/?1=1`;
  if (date) url += `&date=${encodeURIComponent(date)}`;
  if (Array.isArray(clientTypes) && clientTypes.length) {
    url += `&client_types=${encodeURIComponent(clientTypes.join(","))}`;
  }
  url += scopeQuery({ supportsOwn: true });

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return res?.data ?? res ?? null;
};

// GET the status of an in-flight refresh. data.status is
// "running" | "done" | "idle"; `summary` is present once "done":
//   { synced, failed, total_available_balance, duration_seconds }
// data.cooldown_remaining is the LIVE cooldown TTL in seconds (0 if none),
// already net of the sync duration — the caller uses it to show the proactive
// "Wait Ns" countdown on the button the moment the sync finishes.
export const getFundingRefreshStatus = async (taskId) => {
  const res = await api(
    `/cm/funding/refresh/status/?task_id=${encodeURIComponent(taskId)}`,
    { method: "GET" },
  );
  return res?.data ?? null;
};
