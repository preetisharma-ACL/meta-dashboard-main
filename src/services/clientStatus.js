import { api } from "../api/api";

// ─── Client engagement status ─────────────────────────────────────────────────
// A MANUAL label a CM or admin puts on a client: active / hold / completed /
// dead, or UNSET (null) when nobody has marked it yet.
//
// DEAD (backend 69b8461): picking "dead" with no active campaign makes the
// client dead at once (it leaves every list for the Dead Clients section).
// With a campaign still live the status is saved but the client stays visible,
// FLAGGED (dead_blocked) until its campaigns stop, then turns dead hourly.
// Completed turns dead after 20 days of zero spend + zero leads with no live
// campaign. Hold / Active / Unset never go dead. Moving off Dead or Completed
// revives at once.
//
// This is NOT `is_active`. That flag is the account's own live/disabled state
// and is set elsewhere; this one is an operational judgement ("we've paused this
// engagement while the budget is reviewed"). The two are shown in separate
// columns and must never be conflated — a client can be is_active=true and on
// hold at the same time, which is exactly the case this exists to record.
//
// SCOPE IS SERVER-SIDE. An admin may set any client's status; a CM only their
// assigned ones, and the backend 403s anything else. We never filter by role
// here — the UI just surfaces whatever the API returns or refuses.
//
// ENVELOPE: every endpoint answers { success, message, data } — read `.data`.

export const STATUS_UNSET = "unset";

// The three real statuses, in the order they read as a lifecycle. `unset` is
// deliberately NOT in here: it is the absence of a status, not one you can pick.
export const CLIENT_STATUSES = [
  { key: "active", label: "Active" },
  { key: "hold", label: "Hold" },
  { key: "completed", label: "Completed" },
  { key: "dead", label: "Dead" },
];

// Tabs / filters, including the "not yet marked" bucket and All.
export const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "hold", label: "Hold" },
  { key: "completed", label: "Completed" },
  { key: "dead", label: "Dead" },
  { key: STATUS_UNSET, label: "Unset" },
];

// Zeroed tally with a key for every bucket — a local count that indexes by
// status would otherwise hit NaN on a status it didn't list.
export const emptyStatusCounts = () => {
  const acc = { total: 0, [STATUS_UNSET]: 0 };
  for (const s of CLIENT_STATUSES) acc[s.key] = 0;
  return acc;
};

// Badge styling. Unset is deliberately the faintest thing on the row — it is an
// absence, and dressing it up as a fourth state would imply somebody chose it.
export const STATUS_BADGE = {
  active:
    "bg-green-100 text-green-700 ring-1 ring-green-300 dark:bg-green-900/30 dark:text-green-300 dark:ring-green-800",
  hold: "bg-amber-100 text-amber-700 ring-1 ring-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800",
  completed:
    "bg-slate-200 text-slate-700 ring-1 ring-slate-300 dark:bg-slate-700/40 dark:text-slate-300 dark:ring-slate-600",
  // Outlined rather than filled so the black dot stays visible on it.
  dead: "bg-white text-gray-900 ring-1 ring-gray-900 dark:bg-gray-900 dark:text-gray-100 dark:ring-gray-300",
  [STATUS_UNSET]:
    "bg-transparent text-gray-400 ring-1 ring-dashed ring-gray-300 dark:text-gray-500 dark:ring-gray-700",
};

// Small colour dot for tabs / legends.
export const STATUS_DOT = {
  active: "bg-green-500",
  hold: "bg-amber-500",
  completed: "bg-slate-400",
  dead: "bg-gray-900 dark:bg-gray-100",
  [STATUS_UNSET]: "bg-gray-300 dark:bg-gray-600",
};

// null / "" / unknown all normalise to the unset bucket, so one key drives the
// badge, the filter and the counts.
export const normaliseStatus = (s) => {
  const k = String(s ?? "").toLowerCase();
  return CLIENT_STATUSES.some((x) => x.key === k) ? k : STATUS_UNSET;
};

export const statusLabel = (s) => {
  const k = normaliseStatus(s);
  if (k === STATUS_UNSET) return "Not set";
  return CLIENT_STATUSES.find((x) => x.key === k).label;
};

// ── Status board ─────────────────────────────────────────────────────────────
// GET /clients/status-board/[?status=]
//   data.counts  { active, hold, completed, unset, total }
//   data.clients [{ id, email, client_nomen, client_type, engagement_status,
//                   latest_change: { from_status, to_status, reason,
//                                    changed_by_email, changed_at } | null }]
// Server-scoped: admin sees everything, a CM only their assigned clients.
// Dead clients are hidden unless `dead` is true (then ONLY dead ones come back).
// `status` must be a string — createResource(fetchStatusBoard) hands it
// `true`, which used to go out as ?status=true.
export const fetchStatusBoard = async (status, { dead = false } = {}) => {
  const sp = new URLSearchParams();
  if (typeof status === "string" && status && status !== "all") {
    sp.set("status", status);
  }
  if (dead === true) sp.set("dead", "only");
  const qs = sp.toString() ? `?${sp}` : "";
  const res = await api(`/clients/status-board/${qs}`, { method: "GET" });
  const data = res?.data ?? {};
  return {
    counts: data.counts ?? {},
    clients: Array.isArray(data.clients) ? data.clients : [],
  };
};

// ── Set a status ─────────────────────────────────────────────────────────────
// PATCH /clients/{id}/status/  { status, reason }
// `id` is the CLIENT PK — the same id /clients/admin/clients/ serves as `id` and
// the CM hierarchy serves as `client_id`, NOT the client nomen id (they differ
// for all but one client). A reason is mandatory: this is an audited change and
// "who changed it and why" is the entire point of the history below.
// A CM patching a client outside their book gets 403; callers surface the
// message rather than swallowing it.
export const updateClientStatus = async (clientId, { status, reason }) => {
  return await api(`/clients/${clientId}/status/`, {
    method: "PATCH",
    body: JSON.stringify({ status, reason }),
  });
};

// What a status save did to the client's dead state. PATCH now answers with
// is_dead, dead_blocked and warning (non-null = marked Dead but a campaign is
// still live). Read from data, falling back to the top level.
export const readStatusOutcome = (res) => {
  const d = res?.data ?? {};
  const pick = (k) => d?.[k] ?? res?.[k];
  const warning = pick("warning");
  return {
    isDead: pick("is_dead") === true,
    deadBlocked: pick("dead_blocked") === true,
    warning: typeof warning === "string" && warning.trim() ? warning : null,
  };
};

export const DEAD_BLOCKED_LABEL = "Dead, campaign live";
export const DEAD_BLOCKED_TITLE =
  "Marked Dead, but a campaign is still live. It stays in the lists until its campaigns stop, then moves to Dead clients automatically (hourly).";

// ── Per-client history ───────────────────────────────────────────────────────
// GET /clients/{id}/status-history/
//   data = [{ from_status, to_status, reason, changed_by_email, changed_at }]
// Returned newest-first for the drawer; we sort defensively rather than trust
// the server's order, since "newest first" is what the UI promises.
export const fetchClientStatusHistory = async (clientId) => {
  const res = await api(`/clients/${clientId}/status-history/`, {
    method: "GET",
  });
  const rows = Array.isArray(res?.data?.results)
    ? res.data.results
    : Array.isArray(res?.data)
      ? res.data
      : [];
  return [...rows].sort(
    (a, b) => new Date(b.changed_at ?? 0) - new Date(a.changed_at ?? 0),
  );
};

// ── Display helpers for `latest_change` ──────────────────────────────────────

// "Shresth" from "shresth@aajneeti.social" — the same rule the manager roster
// uses, so a person reads the same way on every screen.
export const changedByLabel = (email) => {
  const local = String(email ?? "").split("@")[0];
  if (!local) return "—";
  return local.charAt(0).toUpperCase() + local.slice(1);
};

export const changedAtLabel = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

// One-line caption: Hold · "budget review" · Shresth · 7 Aug
export const latestChangeCaption = (change) => {
  if (!change) return null;
  const parts = [statusLabel(change.to_status)];
  if (change.reason) parts.push(`“${change.reason}”`);
  parts.push(changedByLabel(change.changed_by_email));
  parts.push(changedAtLabel(change.changed_at));
  return parts.join(" · ");
};
