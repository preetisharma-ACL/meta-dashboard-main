import { api } from "../api/api";
import { scopeQuery } from "../stores/cmScope";
import { fetchClientsForLeadAction } from "./leadReplacement";

// ─── Lead Disqualification service ────────────────────────────────────────────
// A "disqualification batch" records leads that are UNBILLABLE: junk, duplicate
// or out-of-scope leads the client is not charged for. It mirrors the
// replacement batch (services/leadReplacement.js) one for one, with two
// deliberate differences:
//
//   • COUNT ONLY — there is no cost field. A replacement credits money back
//     (replaced_cost); a disqualification simply removes the lead from the
//     billable count, and the money follows from the project's CPL rate. Never
//     send a cost here.
//   • CPL CLIENTS ONLY — replacements also apply to hybrid clients, but the
//     create endpoint 400s any non-CPL client.
//
// The billing side reads the result as the CPL project breakdown:
//     qualified = generated − replaced − disqualified
// and the backend enforces the mutual-exclusivity guardrail
// (replaced + disqualified ≤ generated), returning the max allowed in the 400
// message — which the modal surfaces verbatim.
//
// ENVELOPE: every endpoint answers { success, message, data } — read `.data`.

const MAX_PAGES = 50;

// ── Batches ──────────────────────────────────────────────────────────────────

// POST /leads/disqualification-batches/ — record a disqualification.
// Body: { target_client_id, project_id, disqualified_count, received_date?,
//         notes? }   ← no cost field, by design.
// The caller handles the documented validation failures:
//   400 — client is not CPL
//   400 — replaced + disqualified > generated (message states the max allowed)
//   403 — a tier-1 CM picked a client outside their book
// api() throws with .status and .message already lifted off the envelope.
export const createDisqualificationBatch = async (payload) => {
  return await api(`/leads/disqualification-batches/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

// GET /leads/disqualification-batches/ — list. Server-scoped: an admin sees
// every batch, a CM sees their own + their team's, sales sees their book.
// Results may arrive nested under data.results or flat on data.
export const listDisqualificationBatches = async ({
  page = 1,
  pageSize = 20,
  clientNomen,
} = {}) => {
  let url = `/leads/disqualification-batches/?page=${page}&page_size=${pageSize}`;
  if (clientNomen) url += `&client_nomen=${encodeURIComponent(clientNomen)}`;
  url += scopeQuery();

  const res = await api(url, { method: "GET" });
  const rows = Array.isArray(res?.data?.results)
    ? res.data.results
    : Array.isArray(res?.data)
      ? res.data
      : [];
  return { rows, pagination: res?.meta?.pagination ?? null };
};

// Sweep every page — for a roll-up that needs the whole set rather than one
// screen of it. The cap is a runaway guard, not an expected limit.
export const fetchAllDisqualificationBatches = async ({ clientNomen } = {}) => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { rows, pagination } = await listDisqualificationBatches({
      page,
      pageSize: 200,
      clientNomen,
    });
    all.push(...rows);
    if (rows.length === 0 || !pagination?.has_next) break;
  }
  return all;
};

// GET /leads/my-disqualifications/ — the CLIENT-safe list. The admin/CM list
// above is not readable by a client login; this returns the logged-in client's
// OWN batches and nothing else, pre-filtered to non-revoked ones (so rows carry
// no is_revoked flag, and isLiveDisqualification() reading a missing flag as
// live is exactly right here).
export const fetchMyDisqualifications = async () => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await api(
      `/leads/my-disqualifications/?page=${page}&page_size=200`,
      { method: "GET" },
    );
    const rows = Array.isArray(res?.data?.results)
      ? res.data.results
      : Array.isArray(res?.data)
        ? res.data
        : [];
    all.push(...rows);
    // Stop on the last page, on an empty page, or when the envelope carries no
    // pagination block at all (unpaginated response → the first page is all).
    if (rows.length === 0 || !res?.meta?.pagination?.has_next) break;
  }
  return all;
};

// POST /leads/disqualification-batches/{id}/revoke/ — admin + tier-1 CM.
export const revokeDisqualificationBatch = async (id, revokeReason) => {
  return await api(`/leads/disqualification-batches/${id}/revoke/`, {
    method: "POST",
    body: JSON.stringify({ revoke_reason: revokeReason }),
  });
};

// GET /leads/disqualification-batches/{id}/audit-log/ — admin only.
export const fetchDisqualificationAuditLog = async (id) => {
  const res = await api(`/leads/disqualification-batches/${id}/audit-log/`, {
    method: "GET",
  });
  return Array.isArray(res?.data?.results)
    ? res.data.results
    : Array.isArray(res?.data)
      ? res.data
      : [];
};

// ── Per-project roll-up (mirrors replacedLeadsByProject) ─────────────────────

// The day a batch belongs to. received_date is what the operator recorded it
// against; created_at / recorded_at are merely when they typed it in, so they
// are the fallback, never the primary. (The admin/CM list names that timestamp
// created_at, the client-safe list names it recorded_at — both are read here so
// a batch lands on the same day for either viewer.)
export const disqualificationDay = (b) =>
  b?.received_date ||
  b?.created_at?.split("T")[0] ||
  b?.recorded_at?.split("T")[0] ||
  null;

// A revoked batch was reversed: its leads go back to being billable and must
// not be counted anywhere. Compared against `true` rather than truthiness — a
// MISSING flag must not read as revoked.
export const isLiveDisqualification = (b) => b?.is_revoked !== true;

const disqualificationInRange = (b, from, to) => {
  if (!from || !to) return true;
  const day = disqualificationDay(b);
  return !!day && day >= from && day <= to;
};

// { [projectId]: disqualifiedLeads } for the range. Revoked batches excluded.
// Keys are strings — read them with String(projectId).
export const disqualifiedLeadsByProject = (batches, from, to) => {
  const out = {};
  for (const b of batches ?? []) {
    if (!isLiveDisqualification(b) || !disqualificationInRange(b, from, to))
      continue;
    const pid = b?.project ?? b?.project_id;
    if (pid == null) continue;
    const key = String(pid);
    out[key] = (out[key] || 0) + (Number(b.disqualified_count) || 0);
  }
  return out;
};

// ── Client picker source (CPL only) ──────────────────────────────────────────
// Same roster + same PK-vs-nomen normalisation as the replacement picker
// (target_client_id is the CLIENT PK, never the client nomen id), narrowed to
// CPL: the create endpoint 400s hybrid and retainer clients alike, so offering
// one is offering a guaranteed failure. Clients whose type the roster doesn't
// report are still offered — the backend stays the authority, and a missing
// field must not empty the picker.
const DISQUALIFIABLE_TYPES = new Set(["cpl"]);

export const fetchDisqualifiableClients = async () =>
  await fetchClientsForLeadAction(DISQUALIFIABLE_TYPES);
