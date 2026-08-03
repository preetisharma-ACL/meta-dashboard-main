import { api } from "../api/api";

// ─── Activity log API ─────────────────────────────────────────────────────────
// Append-only audit trail, backed by the live backend endpoints:
//
//   POST /api/activity/          — append one entry (server stamps id/timestamp/actor)
//   GET  /api/activity/          — newest-first, paginated, server-side filtered
//   GET  /api/activity/summary/  — counts over a date window (glance header)
//
// There is intentionally no update/delete — entries are immutable. Reads are
// role-scoped server-side (admins/coordination/accounts see all; CMs see only
// their own), so the frontend just renders whatever the call returns.
//
// Note: campaign pause/resume is auto-logged by the backend on its own endpoints,
// so the frontend does NOT call recordActivity for those. Call recordActivity
// only for other actions you want logged that aren't auto-logged server-side.

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

  const res = await api(`/activity/?${params.toString()}`, { method: "GET" });

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

export const getActivitySummary = async ({ startDate, endDate } = {}) => {
  const params = new URLSearchParams();
  const add = (key, val) => {
    const v = typeof val === "string" ? val.trim() : val;
    if (v != null && v !== "" && v !== "all") params.append(key, v);
  };
  add("start_date", startDate);
  add("end_date", endDate);

  const qs = params.toString();
  const res = await api(`/activity/summary/${qs ? `?${qs}` : ""}`, { method: "GET" });

  // Tolerate both the { data: {...} } envelope and a bare body.
  const d = (res && typeof res === "object" && res.data ? res.data : res) ?? {};

  return {
    totalEvents: Number(d.total_events) || 0,
    activeUsers: Number(d.active_users) || 0,
    failedLogins: Number(d.failed_logins) || 0,
    byCategory: toChips(d.by_category, "category"),
    byActorRole: toChips(d.by_actor_role, "actor_role"),
    byResult: toChips(d.by_result, "result"),
    topActors: toChips(d.top_actors, "actor"),
    window: {
      start: d.window?.start ?? null,
      end: d.window?.end ?? null,
    },
  };
};
