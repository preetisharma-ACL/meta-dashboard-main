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

// ── Reading the organization off a payment row ────────────────────────────────
// Wider than the usual first(row, [...]) discipline, deliberately, and ONLY
// here. The ledger's Organization column came up empty on every row, so the
// list serializer either omits the field or names it something these two didn't
// try. The keys below cover both spellings, the nested {id, name} form, and the
// "company" wording the invoice side uses.
//
// The relaxed matching is safe BECAUSE this is a label, not money: the worst a
// wrong key can do is print the wrong company name, which is visible and
// self-correcting. The FIELD-NAME DISCIPLINE note at the top of this file — a
// money field read from a wrong key becomes a confident ₹0 — still binds every
// amount here, and none of this goes anywhere near one.
//
// It never falls back to the CLIENT's organization. /payments/clients/ carries
// organization_id, so joining it in would fill the column — with a campaign-
// derived guess, printed beside a client name that came off the payment row
// itself. Two sources, one row: the column would look authoritative and
// disagree with the payment's own booking. An empty column is the honest
// answer; the fix belongs in the serializer.
const ORG_OBJECT_KEYS = [
  "organization",
  "organisation",
  "organization_detail",
  "organisation_detail",
  "organization_details",
  "org",
];

// The nested {id, name} object, if the row carries one.
const orgObject = (r) => {
  for (const k of ORG_OBJECT_KEYS) {
    const v = r?.[k];
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  }
  return null;
};

const orgId = (r) => {
  const nested = orgObject(r);
  if (nested) return first(nested, ["id", "organization_id", "org_id"]);
  return first(r ?? {}, [
    "organization",
    "organization_id",
    "organisation",
    "organisation_id",
    "org_id",
  ]);
};

const orgName = (r) => {
  const nested = orgObject(r);
  const nestedName = nested
    ? first(nested, ["name", "organization_name", "org_name", "title"])
    : null;
  if (nestedName) return nestedName;
  const flat = first(r ?? {}, [
    "organization_name",
    "organisation_name",
    "org_name",
    "organization_title",
    "client_organization_name",
    "company_name",
    "company",
  ]);
  if (flat) return flat;
  // Last resort: a differently-named string field that is plainly the company.
  // Scoped to keys that say so, and to string values, so it can't pick up an id
  // or an unrelated column.
  for (const [k, v] of Object.entries(r ?? {})) {
    if (typeof v !== "string" || v === "") continue;
    if (/^organi[sz]ation/.test(k) || /^company/.test(k)) return v;
  }
  return null;
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

  // TWO DIFFERENT STATUSES — deliberately kept apart:
  //   status / status_label      → payment PROCESSING (pending/succeeded/…):
  //                                "has the money settled with the bank".
  //   docs_status / docs_status_label → PAPERWORK (pending/complete):
  //                                "has accounts filled in the reference".
  // The whole CM-records → pending → accounts-completes workflow this
  // dashboard exists to run is the DOCS axis. Conflating the two is what made
  // an accounts entry look "pending" when only its settlement was pending, so
  // the ledger surfaces docsStatus and leaves settlement out of the table.
  status: first(r, ["status", "payment_status"]),
  statusLabel: first(r, ["status_label"]),
  docsStatus: first(r, ["docs_status"]),
  docsStatusLabel: first(r, ["docs_status_label"]),

  // The company the payment is booked under — now a ledger COLUMN and a filter,
  // not just a form field, so both halves have to survive every shape the
  // endpoint might use. `organization` can arrive as a bare id or as a nested
  // {id, name}: normalize it to the ID either way, because that is what the
  // edit form round-trips and what recordPayment posts back. A nested object
  // left as-is would post "[object Object]".
  organization: orgId(r),
  // …and the name, from whichever key the serializer used. Null when the row
  // carries no organization at all, or serves only the id — the table falls
  // back to "Organization #<id>" rather than inventing a name.
  organizationName: orgName(r),

  project: first(r, ["project_name", "project_nomen_name", "project"]),
  referenceId: first(r, ["reference_id", "reference"]),
  invoiceUrl: first(r, ["invoice_url", "invoice"]),
  notes: first(r, ["notes", "note", "remarks"]),

  paidAt: first(r, ["paid_at", "payment_date", "date", "created_at"]),
  createdAt: first(r, ["created_at"]),

  // "Recorded by" reads created_by_name ONLY. created_by is a user id, so
  // falling back to it would print a bare integer in a person column; a
  // historical row with no recorded author genuinely has null here and must
  // render "—". Same rule for the accounts user who completed the paperwork.
  createdById: first(r, ["created_by"]),
  createdBy: personName(first(r, ["created_by_name"])),
  completedById: first(r, ["completed_by"]),
  completedBy: personName(first(r, ["completed_by_name"])),

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
  // The client's REAL organization, carried on the picker payload so the record
  // form can pre-select it. Null for the handful of clients whose user has no
  // org — those stay blank for a manual pick rather than defaulting to
  // something plausible-but-wrong.
  organizationId: first(c, ["organization_id", "organization", "org_id"]),
});

const normalizeOrgOption = (o = {}) => ({
  id: first(o, ["id", "organization_id", "org_id", "value"]),
  name: first(o, ["name", "organization_name", "org_name", "label"]) ?? null,
});

// Shared tail for both pickers: drop entries with no usable id, give the rest a
// readable fallback name, sort alphabetically.
//
// NOTE — nothing is filtered by NAME. "NA" (id 87) is a real organization for
// clients with no distinct company, not a placeholder, and dropping it would
// silently remove a legitimate choice from a 141-entry list. Seven clients sit
// under it today; a further 20 have no organization at all. Both are backend
// data cleanup in progress — neither is a reason to filter or default here.
const toOptions = (rows, normalize, noun) =>
  rows
    .map(normalize)
    .filter((o) => o.id !== null && o.id !== undefined)
    .map((o) => ({ ...o, name: o.name || `${noun} #${o.id}` }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );

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

// ── Pagination ────────────────────────────────────────────────────────────────
// The ledger is SERVER-paginated: a response carries one page of rows plus
//   meta.pagination = { page, page_size, total, total_pages, has_next, has_prev }
//
// `total` is the count across the WHOLE filtered set, which is the only honest
// number for a paginator or a count tile. Reading data.length instead gave the
// infamous "20 of 20" on a 264-row ledger — the page size masquerading as the
// total. So `total` here deliberately does NOT fall back to the row count: if
// the meta is missing we return null, and the UI shows the paginator as
// unknown rather than confidently understating it.
const readPagination = (res, rowCount) => {
  const p = res?.meta?.pagination ?? res?.pagination ?? null;
  return {
    page: num(p?.page) ?? 1,
    pageSize: num(p?.page_size) ?? rowCount,
    total: num(p?.total),
    totalPages: num(p?.total_pages),
    hasNext: p?.has_next ?? false,
    hasPrev: p?.has_prev ?? false,
  };
};

// ── Reads ─────────────────────────────────────────────────────────────────────

// GET /payments/ — the ledger. Accounts/admin see everything; a tier-1 CM sees
// their own visible set (same call, server narrows it).
//
// filters: { docsStatus, status, method, project, dateFrom, dateTo, client,
//            organization, organizationName, clientType, page, pageSize }
//   docsStatus  "pending" → the needs-paperwork queue.
//   client      case-insensitive client-NAME match (server-side ?client=).
//   organization      organization id → ?organization=, an EXACT match. What
//               the org picker sends once a company has been chosen.
//   organizationName  free text → ?organization_name=, a case-insensitive
//               SUBSTRING match. Deliberately a different param, not a fallback:
//               it can match several companies at once ("NA" returns 48 rows
//               where organization=87 returns 36), so a caller that shows a
//               count must describe it as "matching that text", never as one
//               organization's payments. Send one or the other, never both.
//   clientType  "cpl" | "hybrid" | "retainer".
//   Anything falsy is dropped rather than sent as an empty param.
//
// EVERY filter is a server param, including the search box. That matters under
// pagination: filtering the 20 rows of the current page client-side would
// search a twentieth of the ledger while the count tile claimed to describe all
// of it. Narrowing has to happen where the total is computed.
//
// Returns { rows: normalizedPayment[], pagination }.
export const fetchPayments = async (filters = {}) => {
  const res = await api(
    `/payments/${qs({
      docs_status: filters.docsStatus ?? filters.docs_status,
      status: filters.status,
      method: filters.method,
      project: filters.project,
      client: filters.client,
      organization: filters.organization,
      organization_name: filters.organizationName ?? filters.organization_name,
      client_type: filters.clientType ?? filters.client_type,
      date_from: filters.dateFrom ?? filters.date_from,
      date_to: filters.dateTo ?? filters.date_to,
      page: filters.page,
      page_size: filters.pageSize ?? filters.page_size,
    })}`,
    { method: "GET" },
  );
  const { rows } = unwrapList(res);
  return {
    rows: rows.map(normalizePayment),
    pagination: readPagination(res, rows.length),
  };
};

// Count-only probe: asks for the smallest possible page and reads
// meta.pagination.total. Used for the "awaiting paperwork" tile, which must
// describe the WHOLE filtered set — counting pending rows on the current page
// would report "3 awaiting" out of a visible 20 while 60 sat unseen on later
// pages. Returns null if the server didn't send a total, so the caller can
// render "—" instead of inventing a number.
export const fetchPaymentsCount = async (filters = {}) => {
  const { pagination } = await fetchPayments({
    ...filters,
    page: 1,
    pageSize: 1,
  });
  return pagination.total;
};

// GET /payments/clients/ — the client picker, already scoped server-side to the
// caller's payable set (403 for roles that may not record payments at all).
// Sorted by name so the dropdown is scannable; ids are preserved verbatim.
export const fetchPaymentClients = async () => {
  const res = await api(`/payments/clients/`, { method: "GET" });
  return toOptions(unwrapList(res).rows, normalizeClientOption, "Client");
};

// GET /payments/organizations/ — the full organization roster (~141), open to
// accounts AND tier-1 CMs; anyone else gets 403.
//
// This is NOT scoped or derived from the selected client. The client→org link
// is campaign-derived and unreliable, so auto-filling it from the client would
// book money against the wrong org some of the time — a deliberate pick from
// the full list is the safer contract. Leaving it unset is also safe: the
// backend falls back to deriving the org itself.
export const fetchPaymentOrganizations = async () => {
  const res = await api(`/payments/organizations/`, { method: "GET" });
  return toOptions(unwrapList(res).rows, normalizeOrgOption, "Organization");
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
//
// `method` must be one of the six PaymentMethod enum values — see
// PAYMENT_METHODS in components/payments/paymentsFormat. The forms only ever
// offer those, so anything else here is a bug, not user input.
//
// reference_id / invoice_url / paid_at are OPTIONAL and only sent when filled.
// (The endpoint used to drop them, which is why the record form omitted them;
// it accepts them as of the 655cc1e backend, so accounts can file the reference
// at record-time rather than only through Edit afterwards.) Omitting an empty
// one matters: posting "" would overwrite a server-side default such as
// paid_at=now with a blank.
//
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
  if (input.referenceId) body.reference_id = input.referenceId;
  if (input.invoiceUrl) body.invoice_url = input.invoiceUrl;
  if (input.paidAt) body.paid_at = input.paidAt;
  // Optional. Unset is SAFE and backward-compatible: the backend derives the
  // org from the client's campaigns when this is absent.
  if (input.organization !== null && input.organization !== undefined)
    body.organization = input.organization;
  // Accounts only — the CM form never renders a status control, so this is
  // simply absent for them and the server applies its "pending" default.
  if (input.status) body.status = input.status;

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
    // Included so accounts can correct a mis-orged or mis-statused row. If the
    // PATCH serializer doesn't accept one of these yet it's ignored server-side
    // — harmless, and it starts working the moment the field is whitelisted.
    organization: "organization",
    status: "status",
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
