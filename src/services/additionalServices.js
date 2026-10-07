import { api } from "../api/api";
import { fetchClientRosterWithStatus } from "./leadReplacement";

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
// GET /billing/overview/ ALWAYS carries (confirmed against the backend):
//   additional_services: { rows: [...], total_ex_gst, gst_amount, total_inc_gst }
//
// Returns null whenever there is nothing to SHOW — rows empty, which is the
// common case, or the block missing despite the guarantee. Callers render the
// section only on a non-null, so a client with no services sees no section at
// all rather than an empty table or a row of zeroes. The block being always
// present is why this gates on rows.length and not on the key.
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
// Returns 0 when the block is absent. The backend always sends it, so that is
// a guard rather than an expected path — and 0 is still the right answer for
// it, because a null would blank out an otherwise complete statement. Returns
// null only when the block IS there and its total cannot be read, so the ledger
// says "this doesn't close" instead of quietly dropping a charge the client is
// being billed for.
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

// ── Client picker roster ────────────────────────────────────────────────────
// TWO sources, in this order (verified per role on prod):
//   1) GET /payments/clients/   — accounts 200 (277 rows), admin 200 (277),
//                                 tier-1 CM 200 (27), coordination 403,
//                                 tier-2 CM 403
//   2) GET /clients/admin/clients/ (via the shared lead-action roster, which
//      also falls back to the CM hierarchy) — covers coordination
// Tier-2 CMs get the read-only list and never a picker, so their 403 on both
// is expected rather than a failure to report.
//
// THE ID IS THE WHOLE PROBLEM HERE. /billing/additional-services/ takes
// client_id = the CLIENT PK. /payments/clients/ is a NOMEN roster: its `id` is
// the nomen, which POST /payments/add-funds/ sends as `client_nomen` (see
// normalizeClientOption + addFunds in services/payments.js), and its 277 rows
// outnumber the ~168 clients because one client can hold several nomens. The
// two ids differ for all but one client, so reading `id` as a PK here would
// book a non-ad charge against the WRONG client's balance — silently, with a
// plausible name on screen.
//
// The payload carries BOTH: `client_id` (the PK, NULLABLE) beside the nomen
// `id`, plus a nullable `organization_id`. Several nomens can resolve to one
// client, and 84 of the 277 resolve to none at all (checked against the DB on
// 7 Oct 2026, 0 mismatches). Worked example: nomen 66 is client 6.
//
// So this reads `client_id` AND NOTHING ELSE — no fallback chain. A fallback
// would fire on exactly the rows whose client_id is null, i.e. the ones the
// backend has already said have no client behind them, and the likeliest thing
// it could find there is the nomen pk. A guess that only ever runs on those
// rows is a wrong-client write waiting to happen, so a null here means "skip
// this nomen" and never "look harder".
//
// If `client_id` vanishes from the payload altogether the source is REJECTED
// rather than guessed at: we fall through to the directory and the caller is
// told why. The directory's `id` IS the PK, which is why that normalisation
// stays in services/leadReplacement.js where the other three pickers share it.
const readPk = (row) => {
  const v = row?.client_id;
  // Tolerates a nested { id } should the field ever serialise as the object.
  const candidate = v && typeof v === "object" ? v.id : v;
  if (candidate === undefined || candidate === null || candidate === "")
    return null;
  const n = Number(candidate);
  return Number.isFinite(n) ? n : null;
};

const readName = (row) =>
  row?.name ||
  row?.client_nomen_name ||
  row?.client_name ||
  row?.nomen_name ||
  row?.label ||
  null;

// Source 1. Returns { rows, status, skipped } where status is:
//   "ok"          → usable rows, each with a real Client PK
//   "forbidden"   → 403 (coordination, tier-2 CM) → try the directory
//   "no_pk"       → rows came back but none carried a Client PK, so this
//                   endpoint cannot answer client_id → try the directory
//   "error"       → anything else
// `skipped` counts the nomens dropped for having no client record, which the
// screen uses to explain a name the payments desk can see and this cannot.
const fetchPaymentsRosterForServices = async () => {
  let res;
  try {
    res = await api(`/payments/clients/`, { method: "GET" });
  } catch (err) {
    return { rows: [], status: err?.status === 403 ? "forbidden" : "error" };
  }

  const raw = Array.isArray(res?.data?.results)
    ? res.data.results
    : Array.isArray(res?.data)
      ? res.data
      : Array.isArray(res?.results)
        ? res.results
        : [];

  // Nomens whose client_id is null have no client record behind them — 84 of
  // the 277 on 7 Oct 2026 — and there is nothing to bill, so they are dropped.
  // That is the EXPECTED shape of this payload, not a fault: roughly two thirds
  // of the rows surviving is what a healthy response looks like here.
  const rows = raw
    .map((r) => ({
      id: readPk(r),
      nomenId: r?.client_nomen ?? r?.client_nomen_id ?? r?.nomen_id ?? r?.id ?? null,
      name: readName(r),
      email: r?.email ?? null,
      clientType: (r?.client_type || "").toLowerCase() || null,
    }))
    .filter((c) => c.id != null);

  // EVERY row lacking a PK is different: that is client_id gone from the
  // payload, not nomens without clients. Loud, because it is the case that
  // would otherwise get "fixed" by reading `id` — which is the nomen.
  if (raw.length > 0 && rows.length === 0) {
    console.warn(
      "[additionalServices] /payments/clients/ returned rows but not one " +
        "carried client_id. Its `id` is the NOMEN id, which client_id must " +
        "never receive. Falling back to the client directory.",
    );
    return { rows: [], status: "no_pk", skipped: 0 };
  }

  // Several nomens can map to one client; the picker lists clients, so collapse
  // duplicates on the PK and keep the first name seen.
  const byPk = new Map();
  for (const c of rows) if (!byPk.has(c.id)) byPk.set(c.id, c);

  return {
    rows: [...byPk.values()].sort((a, b) =>
      (a.name || `Client #${a.id}`).localeCompare(
        b.name || `Client #${b.id}`,
        undefined,
        { sensitivity: "base" },
      ),
    ),
    status: "ok",
    skipped: raw.length - rows.length,
  };
};

// The roster the staff screen picks from, plus WHY it is empty when it is.
// `source` names which endpoint answered, so a short list can be explained
// (a tier-1 CM's 27 clients is correct, not a truncated 277).
export const fetchServiceClientRoster = async () => {
  const payments = await fetchPaymentsRosterForServices();
  if (payments.status === "ok" && payments.rows.length > 0)
    return {
      rows: payments.rows,
      source: "payments",
      failed: false,
      // Nomens with no client record. The payments desk's own picker lists all
      // 277, so someone who works from that screen can look for a name this
      // one does not offer — the count lets the picker say why instead of
      // answering "no clients match".
      skippedNomens: payments.skipped ?? 0,
    };

  // Fall through on 403 (coordination), on a payload with no PK, on an error,
  // and on an empty 200 — the directory may still know this caller's clients.
  const directory = await fetchClientRosterWithStatus(null);
  if (directory.rows.length > 0)
    return { rows: directory.rows, source: "directory", failed: false };

  return {
    rows: [],
    source: null,
    // Only a genuine refusal from BOTH sides is a failure. A source that
    // answered an empty list has answered, and reporting that as broken access
    // would send someone looking in the wrong place.
    failed: payments.status !== "ok" && directory.failed,
    // Kept separate so the screen can say which of the two it was.
    pkMissing: payments.status === "no_pk",
  };
};

// ── Staff endpoints ─────────────────────────────────────────────────────────
// Verbs confirmed against the deployed API (OPTIONS → Allow):
//   /billing/additional-services/        GET, POST
//   /billing/additional-services/<id>/   PATCH
//   /billing/additional-services/<id>/revoke/   POST
//
// NO DETAIL GET AND NO DELETE, BY DESIGN. Revoke is the only removal path the
// API offers (a superadmin hard delete exists in Django admin and nowhere
// else), so the UI edits from the row the list already gave it and never offers
// a delete. An entry stays on the record and stops being charged.
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
