import { api, BASE_URL } from "../api/api";
import { createSignal } from "solid-js";
import { scopeQuery, applyMeta, isSwitched } from "../stores/cmScope";

// ─── Fund Requests (backend 48590cf) ──────────────────────────────────────────
// Replaces the WhatsApp "please add funds" group. The backend checks every
// prepaid wallet every 10 minutes, raises a request by itself under ₹500 and
// marks it Paid by itself once Meta records the top-up — so the queue changes
// under the page without anyone clicking. BASE_URL already includes /api.
//
// Every GET threads the Viewing switcher (scopeQuery). Writes never carry it.
// Roles are the backend's business: the page reads the can_* flags on each row
// and on meta, never a hard-coded role list.

const BASE = "/cm/fund-requests";

// ─── Tier 1 scope toggle ──────────────────────────────────────────────────────
// Shown when the queue answers meta.scope_toggle === true (active Tier 1 CMs).
// null = All accounts (default, no param) | "team" | "own". Module-level so the
// sidebar badge reads the same scope as the page. The Viewing switcher wins:
// while it is set, this param is not sent (and the page hides the toggle), so
// a request never carries two scope values.
const [fundScope, setFundScopeRaw] = createSignal(null);
export { fundScope };
export const setFundScope = (s) => setFundScopeRaw(s || null);

// Switcher params + the toggle's scope, for every Fund Requests GET.
const scoped = () => {
  let q = scopeQuery({ supportsOwn: true });
  const s = fundScope();
  if (s && !isSwitched()) q += `&scope=${encodeURIComponent(s)}`;
  return q;
};

// Queue: { data: { open:[…], closed_today:[…] }, meta: { counts, … } }.
// data.open is ALREADY in pay-first order — callers must not re-sort it.
export const fetchFundQueue = async ({ cmId } = {}) => {
  let q = `?1=1${scoped()}`;
  if (cmId != null && cmId !== "") q += `&cm_id=${encodeURIComponent(cmId)}`;
  const res = await api(`${BASE}/${q}`, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// Sidebar counter: data = { open, urgent, stopped }; the badge is urgent + stopped.
export const fetchFundBadge = async () => {
  const res = await api(`${BASE}/badge/?1=1${scoped()}`, { method: "GET" });
  const b = res?.data ?? {};
  return (Number(b.urgent) || 0) + (Number(b.stopped) || 0);
};

export const fetchFundRequest = async (id) => {
  const res = await api(`${BASE}/${encodeURIComponent(id)}/?1=1${scoped()}`, {
    method: "GET",
  });
  return res?.data ?? null;
};

// Accounts the raise picker offers (with can_raise / open_request_id per row).
export const fetchFundAccounts = async () => {
  const res = await api(`${BASE}/accounts/?1=1${scoped()}`, {
    method: "GET",
  });
  const d = res?.data;
  if (Array.isArray(d)) return d;
  return d?.accounts ?? d?.results ?? [];
};

// body: { ad_account_id, amount?, priority, note? }. data.merged → added to an
// already-open request for that account.
export const raiseFundRequest = async (body) =>
  api(`${BASE}/`, { method: "POST", body: JSON.stringify(body) });

// Only the changed fields: { amount?, priority?, note? }.
export const updateFundRequest = async (id, patch) =>
  api(`${BASE}/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });

// payer: { paid_by_user_id } | { paid_by_name } — always entered, never the login.
export const markFundRequestPaid = async (id, { amount, reference, payer }) =>
  api(`${BASE}/${encodeURIComponent(id)}/mark-paid/`, {
    method: "POST",
    body: JSON.stringify({ amount, reference, ...payer }),
  });

// ─── Who paid ─────────────────────────────────────────────────────────────────
// Whoever opens the payment page is not always the one paying, so every write
// below carries an ENTERED payer: { paid_by_user_id } or { paid_by_name }.

// data: { users:[{id,name,role}], other_names:[string], can_change_any }
export const fetchFundPayers = async () => {
  const res = await api(`${BASE}/payers/`, { method: "GET" });
  return res?.data ?? null;
};

// "I'm paying this now". 409 code "already_claimed" → someone else opened it;
// repeat with force:true to pay anyway. data.pay_url is where to send the tab.
export const claimFundRequest = async (id, payer, force = false) =>
  api(`${BASE}/${encodeURIComponent(id)}/claim/`, {
    method: "POST",
    body: JSON.stringify(force ? { ...payer, force: true } : payer),
  });

// paidBy: user id | "unset" | a name.
export const fetchFundTopups = async ({ from, to, adAccount, paidBy }) => {
  let q = `?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}`;
  if (adAccount) q += `&ad_account=${encodeURIComponent(adAccount)}`;
  if (paidBy != null && paidBy !== "") q += `&paid_by=${encodeURIComponent(paidBy)}`;
  return api(`${BASE}/topups/${q}${scoped()}`, { method: "GET" });
};

export const setTopupPayer = async (id, payer) =>
  api(`${BASE}/topups/${encodeURIComponent(id)}/payer/`, {
    method: "POST",
    body: JSON.stringify(payer),
  });

export const cancelFundRequest = async (id, reason) =>
  api(`${BASE}/${encodeURIComponent(id)}/cancel/`, {
    method: "POST",
    body: JSON.stringify({ reason }),
  });

// ─── Funds register ───────────────────────────────────────────────────────────
// ≤92 days per call (422 beyond). Same URL + &export=xlsx (NOT format=xlsx)
// returns the 3-sheet workbook.
const registerQuery = ({ from, to, adAccount, cmId, clientId }) => {
  let q = `?date_from=${encodeURIComponent(from)}&date_to=${encodeURIComponent(to)}`;
  if (adAccount) q += `&ad_account=${encodeURIComponent(adAccount)}`;
  if (cmId != null && cmId !== "") q += `&cm_id=${encodeURIComponent(cmId)}`;
  if (clientId != null && clientId !== "") q += `&client_id=${encodeURIComponent(clientId)}`;
  return q + scoped();
};

export const fetchFundRegister = async (filters) => {
  const res = await api(`${BASE}/register/${registerQuery(filters)}`, { method: "GET" });
  return res;
};

// api() parses JSON, so the workbook is fetched directly with the same bearer.
export const downloadFundRegister = async (filters) => {
  const auth = JSON.parse(localStorage.getItem("auth") || "null");
  const res = await fetch(`${BASE_URL}${BASE}/register/${registerQuery(filters)}&export=xlsx`, {
    headers: auth?.token ? { Authorization: `Bearer ${auth.token}` } : {},
  });
  if (!res.ok) {
    let msg = "Download failed.";
    try {
      const body = await res.json();
      msg = body?.error?.message || body?.message || body?.detail || msg;
    } catch {}
    const err = new Error(res.status === 401 ? "Session expired — reload the page and try again." : msg);
    err.status = res.status;
    throw err;
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : `funds-register-${filters.from}-to-${filters.to}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
