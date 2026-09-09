import { api } from "../api/api";

// ─── Editing an already-onboarded client ──────────────────────────────────────
// The onboarding wizard CREATES a client (POST /auth/onboarding/users/) and then
// has nothing more to say about it — that endpoint answers `Allow: POST, OPTIONS`
// and has no per-user detail route at all. The client record itself, however, is
// a full REST resource:
//
//   OPTIONS /clients/admin/clients/      → Allow: GET, POST, HEAD, OPTIONS
//   OPTIONS /clients/admin/clients/{id}/ → Allow: GET, PUT, PATCH, DELETE, HEAD, OPTIONS
//
// (Both verified against the live API.) So the edit screen is built on the
// detail route, NOT on anything under /auth/onboarding/.
//
// DELETE is deliberately not wrapped here. It exists on the endpoint, but
// destroying a client takes its leads, spend and billing history with it, and
// nothing on this screen asks for that.
//
// ── Why the form is discovered, not hardcoded ────────────────────────────────
// We know the endpoint accepts PATCH; we do not have the serializer, and the
// LIST rows are a trimmed projection (no service_charge, no onboarded_by, no
// data_visible_from — grep the codebase, nothing reads them off a client row).
// Guessing writable field names here is precisely the mistake that keeps biting
// on this project, so the form asks the API what it accepts instead:
//
//   1. OPTIONS the detail route. DRF's SimpleMetadata answers with
//      `actions.PUT` — every writable field, its type, label, choices and
//      required flag — but ONLY when the caller is actually allowed to write.
//   2. GET the detail route for the current values.
//
// (1) is the authority when present. When it is absent — the backend strips
// metadata, or the caller may read but not write — the form degrades to the
// fields the GET actually returned, which is still the real shape rather than a
// guess. Either way no field is rendered that the payload didn't name.
//
// ENVELOPE: the client endpoints answer { success, message, data }; OPTIONS
// bodies are plain DRF metadata with no envelope, so both are unwrapped
// defensively rather than assumed.

const unwrap = (res) => res?.data ?? res ?? null;

// GET /clients/admin/clients/{id}/ — one client's full record.
export const fetchClientDetail = async (clientId) => {
  const res = await api(`/clients/admin/clients/${clientId}/`, {
    method: "GET",
  });
  return unwrap(res);
};

// OPTIONS /clients/admin/clients/{id}/ — the writable-field map, or null.
//
// Never fatal: a backend that hides metadata is not a broken screen, it is a
// screen that falls back to the GET shape. The caller distinguishes "no schema"
// from "no client" by the null.
export const fetchClientWriteSchema = async (clientId) => {
  let body = null;
  try {
    body = await api(`/clients/admin/clients/${clientId}/`, {
      method: "OPTIONS",
    });
  } catch (err) {
    console.warn("[clientEdit] OPTIONS metadata unavailable:", err?.message);
    return null;
  }

  // DRF nests the write map under actions.PUT (PATCH shares the serializer).
  const actions = body?.actions ?? body?.data?.actions ?? null;
  const fields = actions?.PUT ?? actions?.PATCH ?? null;
  if (!fields || typeof fields !== "object") return null;

  return fields;
};

// PATCH /clients/admin/clients/{id}/ — a PARTIAL update: only the keys the
// operator actually changed are sent. PUT is not used anywhere on this screen;
// a full replace would blank every field the discovered form doesn't render.
//
// A validation failure comes back as the standard nested field map, which the
// caller reads with utils/apiErrors — same plumbing as the onboarding wizard,
// so the two screens report a rejected value identically.
export const updateClient = async (clientId, patch) => {
  const res = await api(`/clients/admin/clients/${clientId}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return unwrap(res);
};

// ── Commercial history ───────────────────────────────────────────────────────
// GET /clients/{pk}/commercial-history/ (R8, 82bae0c) — the audit trail for the
// two fields on this form that move money.
//   data = [{ field, from_value, to_value, reason, changed_by, changed_at }]
//
// ONE ROW PER FIELD MOVED, so a PATCH touching both client_type and
// service_charge writes two. The view snapshots before and compares after rather
// than reading the request body, which means it also catches the service_charge
// the server clears on a switch to CPL — that lands as a real row with
// to_value null, not as a silent change. Django admin writes the same rows.
//
// Same envelope and scoping as /clients/{id}/status-history/, so this reader is
// that one's twin: sorted newest-first here rather than trusting server order,
// because newest-first is what the UI promises.
//
// `changed_by` is read with a fallback to `changed_by_email` — status-history
// uses the latter, and a row carrying either should render the same.
export const fetchCommercialHistory = async (clientId) => {
  const res = await api(`/clients/${clientId}/commercial-history/`, {
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

// Re-exported alongside the endpoints they belong to, exactly as onboarding.js
// does — the screens that write clients read their errors the same way.
export { collectFieldErrors, errorBanner, errorMessage } from "../utils/apiErrors";
