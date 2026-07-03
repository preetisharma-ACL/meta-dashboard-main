import { api } from "../api/api";
import { scopeQuery, applyMeta } from "../stores/cmScope";

// ─── Worklog service layer (tasks + complaints + activity) ────────────────────
// Wires the Client Workspace surfaces to the live backend under /api/worklog/.
// All endpoints return the standard { success, message, data, meta } envelope
// (api() already unwraps errors + success:false). This layer maps snake_case ↔
// camelCase so the SolidJS pages only ever deal with camelCase.
//
// Two DIFFERENT axes — deliberately not conflated:
//   • My Work  ?view=own|all  — a PERSONAL axis (mine vs everyone's). own = items
//     assigned to / owned by ME; all = the whole team (senior roles only). This
//     is independent of the CM switch-mode scope, so my-work does NOT thread
//     scopeQuery.
//   • List views ?scope=own — the CLIENT axis, identical to the dashboard's
//     "Just me" filter everywhere else. The complaints/tasks lists thread
//     scopeQuery({ supportsOwn: true }) so the same SwitchModeDropdown narrows a
//     Tier-1 lead to their own clients (and carries as_team_member_id in the
//     admin/lead view-as combos). Admin sees all regardless.
//
// BASE_URL already ends in /api, so every path here starts at /worklog/…

// ── Normalizers (server snake_case → UI camelCase) ────────────────────────────

// My Work queue item — the pre-sorted unified task+complaint row.
// NOTE: my-work returns client_nomen as the INTEGER nomen_id and
// client_nomen_name as the display name — the workspace route + worklog
// endpoints require that integer (a name 404s activity / 500s complaints).
const normalizeWorkItem = (r = {}) => ({
  kind: r.kind, // "task" | "complaint"
  id: r.id,
  title: r.title ?? "",
  clientNomen: r.client_nomen ?? null,
  clientNomenName: r.client_nomen_name ?? null,
  status: r.status ?? null,
  level: r.level ?? null, // priority (task) / severity (complaint)
  assigneeEmail: r.assignee_email ?? null,
  dueDate: r.due_date ?? null,
  overdue: !!r.overdue,
  fromComplaint: r.from_complaint ?? null, // task → complaint it resolves
  category: r.category ?? null, // complaints only
  urgency: r.urgency ?? null,
  createdAt: r.created_at ?? null,
});

// Activity timeline entry — merged campaign/task/complaint feed.
const normalizeActivityEntry = (r = {}) => ({
  node: r.node, // "green" | "gold" | "clay"
  kind: r.kind, // campaign_paused | task | complaint_raised | complaint_resolved | …
  timestamp: r.timestamp ?? null,
  title: r.title ?? "",
  actor: r.actor ?? null,
  refType: r.ref_type ?? null, // "campaign" | "task" | "complaint"
  refId: r.ref_id ?? null,
  meta: r.meta ?? {},
});

// A complaint.
const normalizeComplaint = (r = {}) => ({
  id: r.id,
  clientNomen: r.client_nomen ?? null,
  clientNomenName: r.client_nomen_name ?? null,
  title: r.title ?? "",
  description: r.description ?? "",
  category: r.category ?? null, // lead_quality | delivery | billing | communication | other
  severity: r.severity ?? null, // low | medium | high | critical
  status: r.status ?? null, // open | in_progress | resolved | closed
  owner: r.owner ?? null,
  raisedBy: r.raised_by ?? null,
  project: r.project ?? null,
  slaDue: r.sla_due ?? null,
  resolvedAt: r.resolved_at ?? null,
  resolution: r.resolution ?? null,
  openTaskCount: r.open_task_count ?? 0,
  createdAt: r.created_at ?? null,
  updatedAt: r.updated_at ?? null,
});

// A task.
const normalizeTask = (r = {}) => ({
  id: r.id,
  clientNomen: r.client_nomen ?? null,
  clientNomenName: r.client_nomen_name ?? null,
  title: r.title ?? "",
  description: r.description ?? "",
  assignedTo: r.assigned_to ?? null,
  assignedBy: r.assigned_by ?? null,
  priority: r.priority ?? null, // low | medium | high | urgent
  status: r.status ?? null, // open | in_progress | done | …
  project: r.project ?? null,
  campaign: r.campaign ?? null,
  dueDate: r.due_date ?? null,
  completedAt: r.completed_at ?? null,
  sourceComplaint: r.source_complaint ?? null,
  createdAt: r.created_at ?? null,
  updatedAt: r.updated_at ?? null,
});

// Tolerate either a bare array or a paginated { results: [...] } in data.
const rowsOf = (res) =>
  Array.isArray(res?.data)
    ? res.data
    : Array.isArray(res?.data?.results)
      ? res.data.results
      : [];

// Strip undefined keys so we only send what the caller provided (the server
// owns/stamps the rest — assigned_by, raised_by, etc.).
const prune = (obj) => {
  const out = { ...obj };
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. My Work — unified task+complaint queue (pre-sorted, most urgent first)
// ═══════════════════════════════════════════════════════════════════════════
// view: "own" (default) | "all". Returns:
//   { items: [...camelCase], meta: { view, total, taskCount, complaintCount,
//                                     overdueCount } }
// The backend already sorts by urgency — callers MUST NOT re-sort.
export const fetchMyWork = async ({ view = "own" } = {}) => {
  const v = view === "all" ? "all" : "own";
  const res = await api(`/worklog/my-work/?view=${v}`, { method: "GET" });
  applyMeta(res?.meta);
  const m = res?.meta ?? {};
  return {
    items: rowsOf(res).map(normalizeWorkItem),
    meta: {
      view: m.view ?? v,
      total: m.total ?? 0,
      taskCount: m.task_count ?? 0,
      complaintCount: m.complaint_count ?? 0,
      overdueCount: m.overdue_count ?? 0,
    },
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// 2a. Per-client Activity timeline (newest-first merged feed)
// ═══════════════════════════════════════════════════════════════════════════
//   { entries: [...camelCase], meta: { greenCount, goldCount, clayCount, total } }
export const fetchClientActivity = async (nomenId, { limit = 100 } = {}) => {
  const res = await api(
    `/worklog/clients/${nomenId}/activity/?limit=${limit}`,
    { method: "GET" },
  );
  applyMeta(res?.meta);
  const m = res?.meta ?? {};
  return {
    entries: rowsOf(res).map(normalizeActivityEntry),
    meta: {
      greenCount: m.green_count ?? 0,
      goldCount: m.gold_count ?? 0,
      clayCount: m.clay_count ?? 0,
      total: m.total ?? 0,
    },
  };
};

// ═══════════════════════════════════════════════════════════════════════════
// 2b. Complaints
// ═══════════════════════════════════════════════════════════════════════════

// List (scoped + paginated). Pass clientNomen for the per-client tab; omit it
// for a global list. status filter optional. scope=own + as_team_member_id are
// threaded via the shared switch-mode store.
export const fetchComplaints = async ({
  clientNomen,
  status,
  page,
  pageSize,
} = {}) => {
  let url = `/worklog/complaints/?1=1`;
  if (clientNomen != null) url += `&client_nomen=${encodeURIComponent(clientNomen)}`;
  if (status && status !== "all") url += `&status=${encodeURIComponent(status)}`;
  if (page) url += `&page=${page}`;
  if (pageSize) url += `&page_size=${pageSize}`;
  url += scopeQuery({ supportsOwn: true });

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return {
    complaints: rowsOf(res).map(normalizeComplaint),
    pagination: res?.meta?.pagination ?? null,
  };
};

export const fetchComplaint = async (id) => {
  const res = await api(`/worklog/complaints/${id}/`, { method: "GET" });
  applyMeta(res?.meta);
  return res?.data ? normalizeComplaint(res.data) : null;
};

// Create — the "Log complaint" modal. raised_by is stamped server-side; do NOT
// send it. body = { clientNomen, title, description, category, severity,
//                   project?, slaDue? }
export const createComplaint = async (body = {}) => {
  const payload = prune({
    client_nomen: body.clientNomen,
    title: body.title,
    description: body.description,
    category: body.category,
    severity: body.severity,
    project: body.project,
    sla_due: body.slaDue,
  });
  const res = await api(`/worklog/complaints/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res?.data ? normalizeComplaint(res.data) : null;
};

// Partial update — status / owner / severity / category / slaDue.
export const updateComplaint = async (id, changes = {}) => {
  const payload = prune({
    status: changes.status,
    owner: changes.owner,
    severity: changes.severity,
    category: changes.category,
    sla_due: changes.slaDue,
    title: changes.title,
    description: changes.description,
  });
  const res = await api(`/worklog/complaints/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return res?.data ? normalizeComplaint(res.data) : null;
};

// Resolve action — body { resolution }.
export const resolveComplaint = async (id, resolution) => {
  const res = await api(`/worklog/complaints/${id}/resolve/`, {
    method: "POST",
    body: JSON.stringify({ resolution }),
  });
  return res?.data ? normalizeComplaint(res.data) : null;
};

// ═══════════════════════════════════════════════════════════════════════════
// 2c. Tasks
// ═══════════════════════════════════════════════════════════════════════════

export const fetchTasks = async ({
  clientNomen,
  status,
  priority,
  assignedTo,
  page,
  pageSize,
} = {}) => {
  let url = `/worklog/tasks/?1=1`;
  if (clientNomen != null) url += `&client_nomen=${encodeURIComponent(clientNomen)}`;
  if (status && status !== "all") url += `&status=${encodeURIComponent(status)}`;
  if (priority && priority !== "all") url += `&priority=${encodeURIComponent(priority)}`;
  if (assignedTo) url += `&assigned_to=${encodeURIComponent(assignedTo)}`;
  if (page) url += `&page=${page}`;
  if (pageSize) url += `&page_size=${pageSize}`;
  url += scopeQuery({ supportsOwn: true });

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return {
    tasks: rowsOf(res).map(normalizeTask),
    pagination: res?.meta?.pagination ?? null,
  };
};

export const fetchTask = async (id) => {
  const res = await api(`/worklog/tasks/${id}/`, { method: "GET" });
  applyMeta(res?.meta);
  return res?.data ? normalizeTask(res.data) : null;
};

// Create — the "assign task" modal. assigned_by is stamped server-side; do NOT
// send it. Set sourceComplaint when the task resolves a complaint. body =
//   { clientNomen, title, description, assignedTo, priority, project?,
//     campaign?, dueDate?, sourceComplaint? }
export const createTask = async (body = {}) => {
  const payload = prune({
    client_nomen: body.clientNomen,
    title: body.title,
    description: body.description,
    assigned_to: body.assignedTo,
    priority: body.priority,
    project: body.project,
    campaign: body.campaign,
    due_date: body.dueDate,
    source_complaint: body.sourceComplaint,
  });
  const res = await api(`/worklog/tasks/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res?.data ? normalizeTask(res.data) : null;
};

// Partial update — status → done auto-stamps completed_at server-side.
export const updateTask = async (id, changes = {}) => {
  const payload = prune({
    status: changes.status,
    priority: changes.priority,
    assigned_to: changes.assignedTo,
    due_date: changes.dueDate,
    title: changes.title,
    description: changes.description,
  });
  const res = await api(`/worklog/tasks/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  return res?.data ? normalizeTask(res.data) : null;
};
