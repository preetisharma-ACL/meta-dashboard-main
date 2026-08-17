import { api } from "../api/api";

// ─── CM ↔ Client assignment service ───────────────────────────────────────────
// Assignment is MANY-TO-MANY: a client can have several campaign managers, and a
// manager has many clients. There is no "the CM" for a client — every screen
// here works with lists on both sides.
//
// Assignment DRIVES DATA VISIBILITY. Assigning a client to a manager is what
// lets that manager see the client's spend, leads and campaigns; unassigning
// takes it away. It is not a labelling exercise, which is why both directions
// are confirmed before they run.
//
// Unassign is a SOFT REVOKE. The row is deactivated, not deleted: the audit log
// keeps the whole history, and re-assigning the same pair later REACTIVATES the
// original row rather than creating a second one. Nothing in this service (or
// the UI above it) should describe it as a delete.
//
// VISIBILITY IS WIDER THAN THIS TABLE for tier-1 managers: a tier-1 lead also
// sees the clients assigned to their tier-2 reports. So a tier-1 can legitimately
// see clients that never appear in their own `clients` list here. Any hint shown
// to the operator has to be worded for that — "assigned to" and "can see" are
// not the same set.
//
// ENVELOPE: every endpoint answers { success, message, data } — read `.data`.
// api() throws with .status set, the parsed body on .data (4xx) and the field
// map on .fields (200-with-success:false); utils/apiErrors reads both.

const BASE = "/cm/assignments";

// The list endpoints answer a bare array on `data`, but tolerate the paginated
// shape too so a server-side change to page these doesn't blank the screen.
const rows = (res) =>
  Array.isArray(res?.data?.results)
    ? res.data.results
    : Array.isArray(res?.data)
      ? res.data
      : [];

const num = (v) => (v == null || v === "" ? null : Number(v));

// ── Normalised shapes ────────────────────────────────────────────────────────
// ids are coerced to numbers ONCE, here, so nothing downstream has to guess
// whether it is comparing "7" with 7. Everything else keeps the server's wording.

const toClient = (c) => ({
  clientId: num(c?.client_id),
  nomen: c?.client_nomen ?? null,
  email: c?.client_email ?? null,
  clientType: c?.client_type ?? null,
  isActive: c?.is_active !== false,
});

const toManager = (m) => ({
  cmId: num(m?.cm_id),
  email: m?.cm_email ?? null,
  name: m?.cm_name ?? null,
  tier: m?.tier ?? null,
  teamLeadId: num(m?.team_lead_id),
  isActive: m?.is_active !== false,
});

// GET /cm/assignments/by-cm/ — every campaign manager with the clients assigned
// to them. `client_count` is the server's own count; it is read rather than
// derived from clients.length so the two can't disagree after a partial payload.
export const fetchAssignmentsByCm = async () => {
  const res = await api(`${BASE}/by-cm/`, { method: "GET" });
  return rows(res).map((r) => ({
    ...toManager(r),
    clients: (Array.isArray(r?.clients) ? r.clients : []).map(toClient),
    clientCount: num(r?.client_count) ?? (r?.clients?.length ?? 0),
  }));
};

// GET /cm/assignments/by-client/ — every client with the managers assigned to it.
export const fetchAssignmentsByClient = async () => {
  const res = await api(`${BASE}/by-client/`, { method: "GET" });
  return rows(res).map((r) => ({
    ...toClient(r),
    campaignManagers: (Array.isArray(r?.campaign_managers)
      ? r.campaign_managers
      : []
    ).map(toManager),
    cmCount: num(r?.cm_count) ?? (r?.campaign_managers?.length ?? 0),
  }));
};

// Both directions in one round trip. The two lists are the same table read two
// ways, so they are always fetched together — refetching only one after a write
// would leave the other tab showing stale counts.
export const fetchAssignments = async () => {
  const [byCm, byClient] = await Promise.all([
    fetchAssignmentsByCm(),
    fetchAssignmentsByClient(),
  ]);
  return { byCm, byClient };
};

// POST /cm/assignments/assign/ — grants the manager visibility of the client.
// Re-assigning a previously revoked pair REACTIVATES that row (it does not
// create a duplicate), which is why the UI can offer it again after a removal.
// Documented rejections the caller must route rather than crash on:
//   409 the client is already assigned to that manager
//   400 the target user is not a campaign manager
//   404 client or manager not found
//   403 caller is neither admin nor coordination
export const assignClientToCm = async ({ clientId, cmId, notes }) => {
  const body = {
    client_id: Number(clientId),
    campaign_manager_id: Number(cmId),
  };
  const trimmed = typeof notes === "string" ? notes.trim() : "";
  if (trimmed) body.notes = trimmed;

  return await api(`${BASE}/assign/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

// POST /cm/assignments/unassign/ — SOFT revoke. The pair's history survives and
// a later re-assign reactivates it.
//   404 no ACTIVE assignment between this client and manager
//   403 caller is neither admin nor coordination
export const unassignClientFromCm = async ({ clientId, cmId, notes }) => {
  const body = {
    client_id: Number(clientId),
    campaign_manager_id: Number(cmId),
  };
  const trimmed = typeof notes === "string" ? notes.trim() : "";
  if (trimmed) body.notes = trimmed;

  return await api(`${BASE}/unassign/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
};

// GET /cm/assignments/audit-log/?client_id=&campaign_manager_id=
// The full assign/unassign trail. Filter by either side (or both). action is
// "assigned" | "unassigned"; both are kept forever, which is what makes the
// soft revoke auditable.
export const fetchAssignmentAuditLog = async ({ clientId, cmId } = {}) => {
  const params = new URLSearchParams();
  if (clientId != null && clientId !== "")
    params.set("client_id", String(clientId));
  if (cmId != null && cmId !== "")
    params.set("campaign_manager_id", String(cmId));
  const qs = params.toString();

  const res = await api(`${BASE}/audit-log/${qs ? `?${qs}` : ""}`, {
    method: "GET",
  });

  return rows(res).map((r) => ({
    id: r?.id,
    clientId: num(r?.client_id),
    clientNomen: r?.client_nomen ?? null,
    cmId: num(r?.campaign_manager_id),
    cmEmail: r?.campaign_manager_email ?? null,
    action: r?.action ?? null, // "assigned" | "unassigned"
    performedByEmail: r?.performed_by_email ?? null,
    notes: r?.notes ?? null,
    createdAt: r?.created_at ?? null,
  }));
};
