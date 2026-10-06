import { api } from "../api/api";

// ─── Additional services (website development, SEO, …) ───────────────────────
// A one-time charge for work that is NOT Meta ad spend, deducted from the
// client's MAIN balance in the month of its charge_date.
//
// NAMING — this is "Additional services" everywhere a human can read it.
// "Service charge" means one thing in this product and one thing only: the
// 13%/15% levied on Meta ad spend. The two are different money and the UI must
// never blur them, so nothing in this feature may be labelled a service charge.
//
// Rules the BACKEND enforces (mirrored here only so the form can preview and
// pre-validate — the server stays the authority):
//   • 18% GST by default; 0 / 5 / 12 / 18 / 28 are the accepted slabs.
//   • NO service charge is ever added on an additional service.
//   • Replaced Credit Notes pay for ADS ONLY and never for these.
//   • Entries are one-time. A recurring service (SEO every month) is a new
//     entry each month, which is why the list is per client rather than
//     per subscription.
//
// Money arrives as STRINGS. Coerce with asNum() before any arithmetic, and let
// a null render as "—": a missing amount must not print as ₹0, which on a
// billing surface reads as "free" rather than "unknown".

// ── Coercion ────────────────────────────────────────────────────────────────
// String/number → finite number, or null when absent / unparsable. Same null
// discipline as cnNum() in services/creditNotes.js.
export const asNum = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// ── Service types ───────────────────────────────────────────────────────────
// The wire values and the labels to show for them. The backend sends
// service_type_label on every row, so a row ALWAYS prefers the server's label
// over this map (a type added server-side still reads correctly); this exists
// for the add/edit form's picker, which has no row to read from yet.
export const SERVICE_TYPES = [
  { value: "website_development", label: "Website Development" },
  { value: "seo", label: "SEO" },
  { value: "social_media", label: "Social Media Management" },
  { value: "content", label: "Content / Creatives" },
  { value: "other", label: "Other" },
];

const TYPE_LABEL = Object.fromEntries(
  SERVICE_TYPES.map((t) => [t.value, t.label]),
);

// service_name is REQUIRED when the type is "other" — there is nothing else to
// call the row. For every other type the name is optional and the type label
// names it.
export const needsServiceName = (serviceType) => serviceType === "other";

// What to call a row on screen. The backend's own `label` is the display field
// (it already folds service_name into the type label where there is one), then
// the free-text name, then the server's type label, then our map, then the raw
// value. Never a bare "—": a charge the client is paying for has to be named.
export const serviceLabel = (row) =>
  row?.label ||
  row?.service_name ||
  row?.service_type_label ||
  TYPE_LABEL[row?.service_type] ||
  row?.service_type ||
  "Additional service";

// ── GST ─────────────────────────────────────────────────────────────────────
// The slabs the backend accepts, and the default it applies when gst_pct is
// omitted. 0 is a legitimate choice, so every read of a percentage here tests
// for null rather than falsiness.
export const GST_PCT_OPTIONS = [0, 5, 12, 18, 28];
export const DEFAULT_GST_PCT = 18;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// The form's live preview: GST = amount × gst_pct / 100, total = amount + GST.
// A DISPLAY MIRROR of the backend's own sum, the same way components/payments/
// gst.js mirrors the payment formula — the POST sends the inputs (amount,
// gst_pct) and the saved row is re-read afterwards. Returns all-nulls until the
// inputs are a computable set, so a half-filled form shows "—" and not ₹0.
export const gstPreview = ({ amount, gstPct } = {}) => {
  const base = asNum(amount);
  const pct = asNum(gstPct);
  if (base === null || pct === null)
    return { amountExGst: null, gstAmount: null, totalIncGst: null };
  const gstAmount = round2((base * pct) / 100);
  return {
    amountExGst: round2(base),
    gstAmount,
    totalIncGst: round2(base + gstAmount),
  };
};

// ── Billing-overview block (the client's own page) ──────────────────────────
// GET /billing/overview/ carries:
//   additional_services: { rows: [...], total_ex_gst, gst_amount, total_inc_gst }
//
// Returns null whenever there is nothing to show — the key absent (a month that
// predates the feature) or rows empty. Callers render the section only on a
// non-null, so a client with no services sees no section at all rather than an
// empty table or a row of zeroes.
//
// The totals are the SERVER's: read straight off the payload, never summed from
// the row strings. The rows are already rounded to paise server-side and a
// re-derived footer is how two surfaces end up disagreeing about one invoice.
export const readAdditionalServices = (overview) => {
  const block = overview?.additional_services;
  if (!block || typeof block !== "object") return null;
  const rows = Array.isArray(block.rows) ? block.rows : [];
  if (rows.length === 0) return null;
  return {
    rows,
    totalExGst: asNum(block.total_ex_gst),
    gstAmount: asNum(block.gst_amount),
    totalIncGst: asNum(block.total_inc_gst),
  };
};

// The month's additional-services total (inc GST) for the ACCOUNT STATEMENT's
// arithmetic, as opposed to the section above which decides what to render.
//
// Returns 0 when the block is absent — a month that predates the feature, or a
// client with no services, genuinely had none, and a null there would blank out
// an otherwise complete statement. Returns null only when the block IS there
// and its total cannot be read, so the ledger says "this doesn't close" instead
// of quietly dropping a charge the client is being billed for.
export const additionalServicesTotalIncGst = (overview) => {
  const block = overview?.additional_services;
  if (!block || typeof block !== "object") return 0;
  return asNum(block.total_inc_gst);
};

// ── Dates ───────────────────────────────────────────────────────────────────
// charge_date is "YYYY-MM-DD". Parsed from its parts rather than handed to
// new Date(string) so it lands on the recorded day in every timezone, and a
// missing date reads "—" instead of 01 Jan 1970.
export const fmtChargeDate = (value) => {
  const [y, m, d] = String(value ?? "")
    .split("-")
    .map(Number);
  if (!y || !m || !d) return "—";
  return new Date(y, m - 1, d).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// ── Revoked rows ────────────────────────────────────────────────────────────
// Compared against `true`, never truthiness: the list omits revoked rows unless
// include_revoked=1 is asked for, so an ABSENT flag means live. Reading a
// missing flag as revoked would strike through every row on the default list.
export const isRevoked = (row) => row?.is_revoked === true;

// ── Staff endpoints ─────────────────────────────────────────────────────────
// Verbs confirmed against the deployed API (OPTIONS → Allow):
//   /billing/additional-services/        GET, POST
//   /billing/additional-services/<id>/   PATCH         (no detail GET, no DELETE
//                                                       — an entry is revoked,
//                                                       never deleted)
//   /billing/additional-services/<id>/revoke/   POST
//
// api() lifts `message`, `code` and `fields` off the envelope and attaches the
// HTTP status, so callers branch on err.code / err.status and show the server's
// own wording (422 validation_error, 409 needs_confirmation, 403 out of scope).

// GET — one client's entries, EVERY page of them. client_id is the Client PK
// (NOT the nomen id — the two differ for all but one client). Revoked entries
// are excluded unless includeRevoked is asked for.
//
// The sweep is not an optimisation to skip: the screen totals what it shows,
// and these entries span every month a client has ever been charged in. Reading
// page one only would quietly total a subset the moment a client passes one
// page of services — a number that looks right and is short. MAX_PAGES is a
// runaway guard, not an expected limit.
const MAX_PAGES = 25;

export const fetchAdditionalServices = async ({
  clientId,
  includeRevoked = false,
} = {}) => {
  const base = `/billing/additional-services/?client_id=${encodeURIComponent(clientId)}${
    includeRevoked ? "&include_revoked=1" : ""
  }`;

  const all = [];
  let pagination = null;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await api(`${base}&page=${page}&page_size=200`, {
      method: "GET",
    });
    // Paginated or flat — read both rather than guess, the same way the
    // replacement-batches list is unwrapped.
    const rows = Array.isArray(res?.data?.results)
      ? res.data.results
      : Array.isArray(res?.data)
        ? res.data
        : [];
    all.push(...rows);
    pagination = res?.meta?.pagination ?? pagination;
    // Stop on an empty page, on the last page, or when the envelope carries no
    // pagination block at all — an unpaginated response means page one is all
    // of it, and looping on a `page` param it ignores would fetch the same
    // rows forever.
    if (rows.length === 0 || !res?.meta?.pagination?.has_next) break;
  }
  return { rows: all, pagination };
};

// POST — record a service.
// Body: { client_id, service_type, service_name, description, amount, gst_pct,
//         charge_date (YYYY-MM-DD), notes, confirm? }
// `notes` is compulsory and `amount` must be > 0 (422 validation_error with the
// reasons under fields). A charge_date inside a CLOSED month answers 409
// needs_confirmation with fields.warnings; the caller confirms and resends the
// SAME body plus confirm: true.
export const createAdditionalService = async (payload) =>
  await api(`/billing/additional-services/`, {
    method: "POST",
    body: JSON.stringify(payload),
  });

// PATCH — edit any of the fields above. Same 422 / 409 contract.
export const updateAdditionalService = async (id, payload) =>
  await api(`/billing/additional-services/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });

// POST — revoke. The reason is required (422 without one). There is no DELETE:
// a revoked entry stays on the record and stops being charged.
export const revokeAdditionalService = async (id, revokeReason) =>
  await api(`/billing/additional-services/${id}/revoke/`, {
    method: "POST",
    body: JSON.stringify({ revoke_reason: revokeReason }),
  });
