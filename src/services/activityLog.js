import { api } from "../api/api";

// ─── Activity log API ─────────────────────────────────────────────────────────
// Append-only audit trail, backed by the live backend endpoints:
//
//   POST /api/activity/          — append one entry (server stamps id/timestamp/actor)
//   GET  /api/activity/          — newest-first, paginated, server-side filtered
//   GET  /api/activity/summary/  — counts over a date window (glance header)
//   GET  /api/activity/logins/   — login history + per-user last login (ADMIN ONLY)
//
// There is intentionally no update/delete — entries are immutable. Reads are
// role-scoped server-side (admins/coordination/accounts see all; CMs see only
// their own), so the frontend just renders whatever the call returns.
//
// Note: campaign pause/resume is auto-logged by the backend on its own endpoints,
// so the frontend does NOT call recordActivity for those. Call recordActivity
// only for other actions you want logged that aren't auto-logged server-side.

// ─── Freshness ────────────────────────────────────────────────────────────────
// This is an audit trail: a stale read is worse than no read, because it looks
// authoritative. Every GET below therefore defeats caching on BOTH axes:
//
//   cache: "no-store"  — tells the browser not to consult or populate its HTTP
//                        cache for this request. api() spreads its options
//                        straight into fetch(), so this rides through as-is.
//   _ts=<epoch ms>     — a unique URL per call, so anything that keys on the URL
//                        and ignores the fetch hint (a CDN/proxy in front of the
//                        API, a stale service worker) can't return a prior body
//                        either. The backend ignores unknown query params.
//
// Deliberately NOT sent as Cache-Control / Pragma request headers: neither is a
// CORS-safelisted header and neither is in django-cors-headers' default
// CORS_ALLOW_HEADERS, so adding them would fail the preflight and break every
// activity read outright. The two measures above need no server change.
const NO_STORE = { cache: "no-store" };

const bust = () => `_ts=${Date.now()}`;

// Map a server entry (snake_case) → the camelCase shape the UI uses.
const normalize = (e = {}) => ({
  id: e.id,
  timestamp: e.timestamp,
  actor: e.actor ?? null,
  actorRole: e.actor_role ?? null,
  actorId: e.actor_id ?? null,
  category: e.category ?? "general",
  action: e.action ?? "unknown",
  target: e.target ?? null,
  targetId: e.target_id ?? null,
  details: e.details ?? null,
  result: e.result ?? "info",
});

// ── Append (fire-and-forget) ──────────────────────────────────────────────────
// A logging failure must NEVER break the underlying user action, so this always
// resolves — it returns the created entry on success, or null on any failure.
//   entry = { category, action, target, targetId, details, result, eventKey }
export const recordActivity = async (entry = {}) => {
  try {
    const body = {
      category: entry.category,
      action: entry.action,
      target: entry.target,
      target_id: entry.targetId ?? entry.target_id,
      details: entry.details,
      result: entry.result,
      event_key: entry.eventKey ?? entry.event_key,
    };
    // Only send what the caller provided; the server owns/ignores the rest.
    Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);
    const res = await api(`/activity/`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return res?.data ? normalize(res.data) : null;
  } catch (err) {
    console.error("[activityLog] Failed to record activity:", err);
    return null;
  }
};

// ── List (read-only, paginated, server-filtered) ──────────────────────────────
// Returns { entries: [...camelCase], pagination }.
//   opts = { page, pageSize, filters: { search, action, category, result, actor,
//                                        actorRole, targetId, startDate, endDate } }
// actorRole filters by WHO acted (admin / campaign_manager / accounts / sales /
// coordination / client); targetId filters by WHICH client the event was about
// (the client_nomen id carried on the entry's target_id).
export const getActivities = async ({ page = 1, pageSize = 50, filters = {} } = {}) => {
  const params = new URLSearchParams();
  params.append("page", page);
  params.append("page_size", pageSize);

  const add = (key, val) => {
    const v = typeof val === "string" ? val.trim() : val;
    if (v != null && v !== "" && v !== "all") params.append(key, v);
  };
  add("search", filters.search);
  add("action", filters.action);
  add("category", filters.category);
  add("result", filters.result);
  add("actor", filters.actor);
  add("actor_role", filters.actorRole);
  add("target_id", filters.targetId);
  add("start_date", filters.startDate);
  add("end_date", filters.endDate);

  const res = await api(`/activity/?${params.toString()}&${bust()}`, {
    method: "GET",
    ...NO_STORE,
  });

  // Backend returns data as the entries array; tolerate a { results } shape too.
  const rows = Array.isArray(res?.data)
    ? res.data
    : Array.isArray(res?.data?.results)
      ? res.data.results
      : [];

  return {
    entries: rows.map(normalize),
    pagination: res?.meta?.pagination ?? null,
  };
};

// ── Summary (counts over a date window) ───────────────────────────────────────
// GET /api/activity/summary/ — honours the same start_date/end_date params as
// the feed and defaults to the last 30 days server-side when they're omitted.
// Returns a camelCase shape; every list is normalised to [{ key, count }] so the
// header can render them all through one chip component.
//   opts = { startDate, endDate }

const toChips = (rows, keyField) =>
  (Array.isArray(rows) ? rows : [])
    .map((r) => ({
      key: r?.[keyField] ?? null,
      count: Number(r?.count) || 0,
    }))
    .filter((r) => r.key != null);

// The date window is the only thing the summary and logins reads are scoped by,
// and both take it as the same plain YYYY-MM-DD pair, so build it in one place.
// Always carries the cache-buster, so the query string is never empty (the
// server still defaults the window when start/end are absent).
const dateQuery = ({ startDate, endDate } = {}) => {
  const params = new URLSearchParams();
  const add = (key, val) => {
    const v = typeof val === "string" ? val.trim() : val;
    if (v != null && v !== "") params.append(key, v);
  };
  add("start_date", startDate);
  add("end_date", endDate);
  const qs = params.toString();
  return qs ? `?${qs}&${bust()}` : `?${bust()}`;
};

// Tolerate both the { data: {...} } envelope and a bare body.
const unwrap = (res) => (res && typeof res === "object" && res.data ? res.data : res) ?? {};

export const getActivitySummary = async (range = {}) => {
  const res = await api(`/activity/summary/${dateQuery(range)}`, {
    method: "GET",
    ...NO_STORE,
  });
  const d = unwrap(res);

  return {
    totalEvents: Number(d.total_events) || 0,
    activeUsers: Number(d.active_users) || 0,
    failedLogins: Number(d.failed_logins) || 0,
    byCategory: toChips(d.by_category, "category"),
    byActorRole: toChips(d.by_actor_role, "actor_role"),
    byResult: toChips(d.by_result, "result"),
    topActors: toChips(d.top_actors, "actor"),
    // Daily counts for the time-series chart. SPARSE by design — the server only
    // emits days that had events, so consumers must not assume the days are
    // consecutive (the chart fills the gaps with zeroes itself).
    byDay: (Array.isArray(d.by_day) ? d.by_day : [])
      .map((r) => ({ day: r?.day ?? null, count: Number(r?.count) || 0 }))
      .filter((r) => r.day),
    window: {
      start: d.window?.start ?? null,
      end: d.window?.end ?? null,
    },
  };
};

// ── Logins (ADMIN ONLY) ───────────────────────────────────────────────────────
// GET /api/activity/logins/ — 403s for every other role, so callers must gate the
// UI on role before firing this. Honours the same start_date/end_date pair as the
// feed and the summary.
//
// Everything except perUser/neverLoggedIn is scoped to the window; the per-user
// last-login roster and the never_logged_in count are ALL-TIME by design (a user
// who last signed in before the window still needs a real date, not a "Never").
//   opts = { startDate, endDate }
export const getLogins = async (range = {}) => {
  const res = await api(`/activity/logins/${dateQuery(range)}`, {
    method: "GET",
    ...NO_STORE,
  });
  const d = unwrap(res);
  const s = d.stats ?? {};

  return {
    window: {
      start: d.window?.start ?? null,
      end: d.window?.end ?? null,
    },
    stats: {
      totalLogins: Number(s.total_logins) || 0,
      failedAttempts: Number(s.failed_attempts) || 0,
      uniqueUsers: Number(s.unique_users) || 0,
      neverLoggedIn: Number(s.never_logged_in) || 0,
    },
    // SPARSE, like the summary's by_day — only days that saw a login attempt are
    // emitted, so the chart fills the gaps itself.
    byDay: (Array.isArray(d.by_day) ? d.by_day : [])
      .map((r) => ({
        day: r?.day ?? null,
        success: Number(r?.success) || 0,
        failure: Number(r?.failure) || 0,
      }))
      .filter((r) => r.day),
    // Newest first, capped server-side (~100).
    recent: (Array.isArray(d.recent) ? d.recent : []).map((r) => ({
      actor: r?.actor ?? null,
      actorRole: r?.actor_role ?? null,
      timestamp: r?.timestamp ?? null,
      ip: r?.ip ?? null,
      result: r?.result ?? "info",
    })),
    // Server order is meaningful (never-logged-in first, then oldest first), so
    // this is deliberately NOT re-sorted here.
    perUser: (Array.isArray(d.per_user) ? d.per_user : []).map((r) => ({
      email: r?.email ?? null,
      role: r?.role ?? null,
      lastLogin: r?.last_login ?? null,
      // null means "never" — keep it distinct from a genuine 0 (logged in today).
      daysSince: r?.days_since == null ? null : Number(r.days_since),
    })),
  };
};
