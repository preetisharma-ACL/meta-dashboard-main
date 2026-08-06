import { api } from "../api/api";
import { scopeQuery, applyMeta } from "../stores/cmScope";
import { fetchAllAdminClients } from "../pages/admin/services/fetchClients";
import { fetchHierarchyClients } from "./cm";

// ─── Lead Replacement service ─────────────────────────────────────────────────
// A "replacement batch" records leads the agency has agreed to replace for a
// client: N leads worth ₹X are credited back, so the client is billed for
// (generated − replaced) leads instead of everything Meta delivered.
//
// The backend surfaces the resulting breakdown in three places — the dashboard
// summary, the monthly billing overview, and the per-project billing block —
// always as the same trio of fields:
//
//     generated_leads  → what Meta (+ fed) actually delivered
//     replaced_leads   → what we agreed to replace
//     billable_leads   → generated − replaced, i.e. what the client pays for
//
// Every read here goes through readLeadBreakdown(), which returns `null` when
// the block is genuinely absent (retainer clients have no replacement concept)
// rather than a confident set of zeros. A zeroed breakdown and a missing one
// look identical downstream otherwise, and "Replaced: 0" on a client that can
// never have replacements is noise, not information.
//
// ENVELOPE: every endpoint answers { success, message, data } — read `.data`.

// ── Breakdown reader ─────────────────────────────────────────────────────────

const int = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

const money = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Pull { generated, replaced, billable } off any block that carries them.
// Returns null when the block carries none of the three (retainer / older
// payload) so callers can hide the columns instead of printing zeros.
export const readLeadBreakdown = (block) => {
  if (!block || typeof block !== "object") return null;

  const generated = int(block.generated_leads);
  const replaced = int(block.replaced_leads);
  const billable = int(block.billable_leads);

  if (generated == null && replaced == null && billable == null) return null;

  // Derive whichever leg the payload omitted — the identity is fixed
  // (generated − replaced = billable), so a partial block is still usable.
  const g = generated ?? (billable != null && replaced != null ? billable + replaced : null);
  const r = replaced ?? (generated != null && billable != null ? generated - billable : 0);
  const b = billable ?? (generated != null ? generated - (r ?? 0) : null);

  return {
    generated: g,
    replaced: r ?? 0,
    billable: b,
    // The credited amount actually billed to the client. Distinct from
    // total_spent (true ad spend) — utilization % and CPL stay on total_spent.
    // Named billed_amount on the monthly billing block and billed_spend on the
    // range-scoped report's lead_breakdown; both mean the same figure.
    billedAmount: money(block.billed_amount) ?? money(block.billed_spend),
    adSpend: money(block.total_spent),
  };
};

// A CPL/hybrid client always sees the progression (it's how they're billed,
// even at zero replacements). Everyone else only sees it once a replacement
// has actually happened. Retainer clients never see it.
export const showsReplacement = (breakdown, clientType) => {
  if (!breakdown) return false;
  const type = String(clientType || "").toLowerCase();
  if (type === "retainer") return false;
  if (type === "cpl" || type === "hybrid") return true;
  return (breakdown.replaced ?? 0) > 0;
};

// ── Dashboard summary ────────────────────────────────────────────────────────
// GET /dashboard/summary/ — totals now carry the lead breakdown alongside the
// existing leads/spend. Scoped exactly the way the rest of the app scopes a
// dashboard read: the selected client nomen for admin/CM/sales (the backend
// intersects it with what the caller may see, so it can never widen), nothing
// at all for a client's own login (server-scoped by their token).
const dashboardClientNomen = () => {
  try {
    const auth = JSON.parse(localStorage.getItem("auth") || "{}");
    if (
      auth?.role === "admin" ||
      auth?.role === "campaign_manager" ||
      auth?.role === "sales"
    ) {
      return localStorage.getItem("selectedClientNomen") || null;
    }
    return auth?.clientNomen || null;
  } catch {
    return null;
  }
};

export const fetchDashboardSummary = async ({ startDate, endDate } = {}) => {
  let url = `/dashboard/summary/?1=1`;
  if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`;
  if (endDate) url += `&end_date=${encodeURIComponent(endDate)}`;
  const nomen = dashboardClientNomen();
  if (nomen) url += `&client_nomen=${encodeURIComponent(nomen)}`;
  url += scopeQuery();

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  return res;
};

// The summary's totals block sits at data.totals on the documented shape, but
// some dashboard endpoints here answer the totals flat on `data`. Try both
// rather than guess — a wrong path reads as "no replacements", which is
// indistinguishable from a healthy client.
export const summaryLeadBreakdown = (res) => {
  const data = res?.data ?? {};
  return (
    readLeadBreakdown(data.totals) ??
    readLeadBreakdown(data.summary) ??
    readLeadBreakdown(data)
  );
};

// ── Replacement batches ──────────────────────────────────────────────────────

// POST /leads/replacement-batches/ — record a replacement.
// Body: { target_client_id, project_id, replaced_count, replaced_cost,
//         received_date?, reason }
// 201 on success. The caller handles the documented validation failures:
//   400 — client is on a retainer ("applies only to CPL and hybrid clients")
//   400 — replaced_count > generated leads (message states the max allowed)
//   403 — a tier-1 CM picked a client outside their book
// api() throws with .status and .message already lifted off the envelope.
export const createReplacementBatch = async (payload) => {
  return await api(`/leads/replacement-batches/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

// GET /leads/replacement-batches/ — list. Server-scoped: an admin sees every
// batch, a CM sees their own + their team's. Paginated the same way the manual
// (fed) batches list is, and unwrapped the same way — results may arrive nested
// under data.results or flat on data.
export const fetchReplacementBatches = async ({
  page = 1,
  pageSize = 20,
  clientNomen,
} = {}) => {
  let url = `/leads/replacement-batches/?page=${page}&page_size=${pageSize}`;
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

// Sweep every page — used where a roll-up needs the whole set rather than one
// screen of it. The cap is a runaway guard, not an expected limit.
const MAX_PAGES = 50;
export const fetchAllReplacementBatches = async ({ clientNomen } = {}) => {
  const all = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { rows, pagination } = await fetchReplacementBatches({
      page,
      pageSize: 200,
      clientNomen,
    });
    all.push(...rows);
    if (rows.length === 0 || !pagination?.has_next) break;
  }
  return all;
};

// ── Per-project roll-up (mirrors fedLeadsByProject) ──────────────────────────
// Replacements are recorded against a PROJECT, exactly like fed batches, so the
// project ledger is the level they can be shown at truthfully. These two
// helpers deliberately mirror services/fedLeads.js one for one — same day rule,
// same open-range convention, same revoked rule — so a batch can't land on a
// different day here than it does in the fed column beside it.

// The day a batch belongs to. received_date is what the operator recorded the
// replacement against; created_at is merely when they typed it in, so it is the
// fallback, never the primary.
export const replacementDay = (b) =>
  b?.received_date || b?.created_at?.split("T")[0] || null;

// A revoked batch was reversed: its leads go back to being billable and must
// not be counted anywhere. Compared against `true` rather than truthiness — a
// MISSING flag must not read as revoked.
export const isLiveReplacement = (b) => b?.is_revoked !== true;

// True when a batch's effective day falls inside [from, to] (inclusive, both
// "YYYY-MM-DD"). An open range (either bound missing) means "no date filter" —
// the same convention the dashboards use for an un-set calendar picker.
const replacementInRange = (b, from, to) => {
  if (!from || !to) return true;
  const day = replacementDay(b);
  return !!day && day >= from && day <= to;
};

// { [projectId]: replacedLeads } for the range. Revoked batches excluded.
// Keys are strings — read them with String(projectId).
export const replacedLeadsByProject = (batches, from, to) => {
  const out = {};
  for (const b of batches ?? []) {
    if (!isLiveReplacement(b) || !replacementInRange(b, from, to)) continue;
    const pid = b?.project ?? b?.project_id;
    if (pid == null) continue;
    const key = String(pid);
    out[key] = (out[key] || 0) + (Number(b.replaced_count) || 0);
  }
  return out;
};

// POST /leads/replacement-batches/{id}/revoke/ — admin only.
export const revokeReplacementBatch = async (id, revokeReason) => {
  return await api(`/leads/replacement-batches/${id}/revoke/`, {
    method: "POST",
    body: JSON.stringify({ revoke_reason: revokeReason }),
  });
};

// GET /leads/replacement-batches/{id}/audit-log/ — admin only.
export const fetchReplacementAuditLog = async (id) => {
  const res = await api(`/leads/replacement-batches/${id}/audit-log/`, {
    method: "GET",
  });
  return Array.isArray(res?.data?.results)
    ? res.data.results
    : Array.isArray(res?.data)
      ? res.data
      : [];
};

// ── Range-scoped per-project breakdown ───────────────────────────────────────
// GET /reports/project/{id}/?start_date&end_date — the project/daily report.
// Its top-level `lead_breakdown` block is scoped to the SELECTED DATE RANGE, so
// the daily report's Replaced / Billable / Billed columns line up with the
// Leads / CPL / spend columns beside them (and roll up to the monthly invoice).
// The monthly billing block is the invoice's source and stays where it belongs,
// on the Billing page.
//
// Returns null when the report carries no breakdown (retainer client, or no
// activity in the range) so callers hide the columns rather than print zeros.
export const fetchProjectLeadBreakdown = async (
  projectId,
  { startDate, endDate } = {},
) => {
  let url = `/reports/project/${projectId}/?1=1`;
  if (startDate) url += `&start_date=${encodeURIComponent(startDate)}`;
  if (endDate) url += `&end_date=${encodeURIComponent(endDate)}`;
  url += scopeQuery();

  const res = await api(url, { method: "GET" });
  applyMeta(res?.meta);
  // "Top-level" on the report payload — which is data.lead_breakdown inside the
  // standard envelope. Also accept it on the envelope root so a flat response
  // doesn't silently read as "no replacements".
  return (
    readLeadBreakdown(res?.data?.lead_breakdown) ??
    readLeadBreakdown(res?.lead_breakdown)
  );
};

// ── Client picker source (CPL / hybrid only) ─────────────────────────────────
// The form's target_client_id is the CLIENT PK — the same id the fed-leads
// ("Leed Feeding") form sends, and NOT the client nomen id; the two differ for
// all but one client, and sending a nomen there resolves to the wrong client or
// 404s.
//
// /clients/admin/clients/ carries the PK as `id` and is the primary source. It
// 403s campaign managers, so a tier-1 CM falls back to the CM-scoped hierarchy,
// which serves the PK as `client_id` alongside the `client_nomen_id` it keys
// its own rows by. Both paths therefore yield a real PK.
const REPLACEABLE_TYPES = new Set(["cpl", "hybrid"]);

const normaliseAdminClient = (c) => ({
  id: c.id, // Client PK — what target_client_id expects
  nomenId: c.client_nomen ?? null,
  name: c.client_nomen_name || c.organization_name || `Client #${c.id}`,
  email: c.email ?? null,
  clientType: (c.client_type || "").toLowerCase() || null,
});

const normaliseHierarchyClient = (c) => ({
  id: c.client_id, // Client PK — NOT client_nomen_id, which keys the row
  nomenId: c.client_nomen_id ?? null,
  name: c.client_name || c.client_nomen_name || `Client #${c.client_nomen_id}`,
  email: c.email ?? null,
  clientType: (c.client_type || "").toLowerCase() || null,
});

// Clients a replacement may be booked against, A→Z. Only CPL and hybrid — the
// backend 400s a retainer client, so offering one is offering a guaranteed
// failure. Clients whose type the roster doesn't report are kept (the backend
// remains the authority) so a missing field can't empty the picker.
export const fetchReplaceableClients = async () => {
  let rows = [];
  try {
    rows = (await fetchAllAdminClients()).map(normaliseAdminClient);
  } catch {
    try {
      const res = await fetchHierarchyClients();
      rows = (Array.isArray(res?.data) ? res.data : []).map(
        normaliseHierarchyClient,
      );
    } catch {
      rows = [];
    }
  }

  return rows
    .filter((c) => c.id != null)
    .filter((c) => !c.clientType || REPLACEABLE_TYPES.has(c.clientType))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
};
