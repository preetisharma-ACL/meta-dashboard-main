import { api } from "../api/api";

// ─── Payments service (accounts desk + tier-1 CM payment entry) ───────────────
// Wires the Accounts Dashboard and the tier-1 CM entry screens to the live
// backend under /api/payments/. BASE_URL already ends in /api, so every path
// here starts at /payments/…
//
// SCOPING IS SERVER-SIDE, ALWAYS. We never filter by role on the frontend:
//   • GET /payments/          → accounts/admin get every payment; a tier-1 CM
//                               gets only their own visible set.
//   • GET /payments/clients/  → the picker, already narrowed to what the caller
//                               may pay against (403 for anyone else).
//   • PATCH/DELETE            → accounts/admin only; a CM gets 403.
// The UI gates (see utils/PaymentsRoute + currentUser) only decide which
// CONTROLS to render — the API is the authority and stays the backstop.
//
// FIELD-NAME DISCIPLINE: every read below goes through `first(row, [...])`,
// which returns the first key that is actually present. Payment rows are money,
// and a money field read from a wrong/renamed key coerces to 0 and renders as a
// confident ₹0 — the exact class of bug that has bitten this codebase before.
// A missing field normalizes to null here and renders "—" downstream, never ₹0.

// ── Small readers ─────────────────────────────────────────────────────────────

const qs = (params) => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return parts.length ? `?${parts.join("&")}` : "";
};

// First key that carries a real value. Absent / null / "" all count as missing.
const first = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return null;
};

// Money/number read: missing stays missing (null), never 0.
const num = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// created_by can arrive as a display string, a bare id, or a nested user object.
const personName = (v) => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "object")
    return first(v, ["name", "full_name", "username", "email"]);
  return String(v);
};

// ── Normalizers (server snake_case → UI camelCase) ────────────────────────────

// One payment row. `raw` is kept so a screen can surface a field this
// normalizer doesn't know about yet without another round trip.
export const normalizePayment = (r = {}) => ({
  id: first(r, ["id", "payment_id"]),

  // The nomen the payment is booked against, plus its display name.
  clientNomen: first(r, ["client_nomen", "client_nomen_id", "client_id", "client"]),
  clientName: first(r, [
    "client_nomen_name",
    "client_name",
    "client_display_name",
    "nomen_name",
  ]),

  // Money — the inputs the form sends…
  baseAmount: num(first(r, ["base_amount"])),
  tdsApplied: r.tds_applied === true || r.tds_applied === "true",
  tdsAmount: num(first(r, ["tds_amount"])),
  gstPct: num(first(r, ["gst_pct", "gst_percentage", "gst_percent"])),

  // …and the figures the SERVER computed from them (source of truth).
  excludingGst: num(first(r, ["excluding_gst", "amount_excluding_gst"])),
  gstAmount: num(first(r, ["gst_amount", "gst"])),
  includingGst: num(first(r, ["including_gst", "amount_including_gst"])),
  finalAmount: num(first(r, ["final_amount", "total_amount", "amount"])),

  method: first(r, ["method", "payment_method"]),
  status: first(r, ["status", "payment_status"]),
  docsStatus: first(r, ["docs_status"]),

  project: first(r, ["project_name", "project_nomen_name", "project"]),
  referenceId: first(r, ["reference_id", "reference"]),
  invoiceUrl: first(r, ["invoice_url", "invoice"]),
  notes: first(r, ["notes", "note", "remarks"]),

  paidAt: first(r, ["paid_at", "payment_date", "date", "created_at"]),
  createdAt: first(r, ["created_at"]),
  createdBy: personName(
    first(r, ["created_by_name", "created_by_email", "created_by", "recorded_by"]),
  ),

  raw: r,
});

// Picker option: { id, name }. The spec's picker serves (id, name) per nomen;
// the id is what add-funds wants as `client_nomen`.
const normalizeClientOption = (c = {}) => ({
  id: first(c, ["id", "client_nomen", "client_nomen_id", "nomen_id", "value"]),
  name:
    first(c, [
      "name",
      "client_nomen_name",
      "client_name",
      "nomen_name",
      "label",
    ]) ?? null,
});

// A list body can be a bare array, a DRF page ({count, results}) or an
// envelope wrapping either. Normalize all of them to { rows, count }.
const unwrapList = (res) => {
  const d = res?.data ?? res;
  if (Array.isArray(d)) return { rows: d, count: d.length };
  for (const key of ["results", "payments", "items"]) {
    if (Array.isArray(d?.[key]))
      return { rows: d[key], count: num(d.count) ?? d[key].length };
  }
  if (Array.isArray(res?.results))
    return { rows: res.results, count: num(res.count) ?? res.results.length };
  return { rows: [], count: 0 };
};

// ── Reads ─────────────────────────────────────────────────────────────────────

// GET /payments/ — the ledger. Accounts/admin see everything; a tier-1 CM sees
// their own visible set (same call, server narrows it).
//
// filters: { docs_status, status, method, project, date_from, date_to }
//   docs_status: "pending" → the needs-paperwork queue.
//   Anything falsy is dropped rather than sent as an empty param.
// Returns { rows: normalizedPayment[], count }.
export const fetchPayments = async (filters = {}) => {
  const res = await api(
    `/payments/${qs({
      docs_status: filters.docsStatus ?? filters.docs_status,
      status: filters.status,
      method: filters.method,
      project: filters.project,
      date_from: filters.dateFrom ?? filters.date_from,
      date_to: filters.dateTo ?? filters.date_to,
    })}`,
    { method: "GET" },
  );
  const { rows, count } = unwrapList(res);
  return { rows: rows.map(normalizePayment), count };
};

// GET /payments/clients/ — the client picker, already scoped server-side to the
// caller's payable set (403 for roles that may not record payments at all).
// Sorted by name so the dropdown is scannable; ids are preserved verbatim.
export const fetchPaymentClients = async () => {
  const res = await api(`/payments/clients/`, { method: "GET" });
  const { rows } = unwrapList(res);
  return rows
    .map(normalizeClientOption)
    .filter((c) => c.id !== null && c.id !== undefined)
    .map((c) => ({ ...c, name: c.name || `Client #${c.id}` }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
};

// ── Writes ────────────────────────────────────────────────────────────────────

// POST /payments/add-funds/ — record a payment.
//
// We send the INPUTS ONLY (base_amount, tds_applied, tds_amount, gst_pct,
// client_nomen, method, project, notes). Payment.save() computes excluding_gst
// / gst_amount / including_gst / final_amount server-side, so posting a
// client-computed total would either be ignored or fight the server. The form's
// live preview (components/payments/gst.js) mirrors that formula for the
// operator's benefit and is never transmitted.
//
// docs_status is set by the SERVER from the caller's role: accounts → complete,
// tier-1 CM → pending (and 403 for a client outside their set / for tier-2).
// Returns the created row, normalized.
export const recordPayment = async (input) => {
  const body = {
    client_nomen: input.clientNomen,
    base_amount: input.baseAmount,
    tds_applied: !!input.tdsApplied,
    // Only meaningful when the toggle is on; send 0 rather than null so a
    // server that requires the key still gets a valid number.
    tds_amount: input.tdsApplied ? input.tdsAmount : 0,
    gst_pct: input.gstPct,
    method: input.method,
  };
  if (input.project) body.project = input.project;
  if (input.notes) body.notes = input.notes;

  const res = await api(`/payments/add-funds/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  const row = res?.data ?? res;
  return row && typeof row === "object" ? normalizePayment(row) : null;
};

// PATCH /payments/<id>/ — accounts/admin only (a CM gets 403).
//
// Editable: reference_id, invoice_url, notes, method, paid_at, base_amount,
// tds_applied, tds_amount, gst_pct. Two server behaviours the UI must respect:
//   • Filling reference_id auto-flips docs_status pending → complete.
//   • An amount edit recomputes GST/final server-side — so callers must render
//     the RETURNED row, never a locally patched copy.
// Only keys present in `patch` are sent (a true partial update).
export const updatePayment = async (id, patch = {}) => {
  const body = {};
  const map = {
    referenceId: "reference_id",
    invoiceUrl: "invoice_url",
    notes: "notes",
    method: "method",
    paidAt: "paid_at",
    baseAmount: "base_amount",
    tdsApplied: "tds_applied",
    tdsAmount: "tds_amount",
    gstPct: "gst_pct",
  };
  for (const [camel, snake] of Object.entries(map)) {
    if (patch[camel] !== undefined) body[snake] = patch[camel];
  }

  const res = await api(`/payments/${encodeURIComponent(id)}/`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  const row = res?.data ?? res;
  return row && typeof row === "object" ? normalizePayment(row) : null;
};

// DELETE /payments/<id>/ — accounts/admin only (a CM gets 403).
export const deletePayment = async (id) =>
  await api(`/payments/${encodeURIComponent(id)}/`, { method: "DELETE" });
