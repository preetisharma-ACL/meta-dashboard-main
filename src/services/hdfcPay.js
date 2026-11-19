import { api, BASE_URL } from "../api/api";
import { fetchPaymentClients } from "./payments";
import { fetchClientRosterWithStatus } from "./leadReplacement";

// ─── HDFC online payments ─────────────────────────────────────────────────────
// Card / UPI collection through the HDFC gateway, backend 3d5995a + 202e494.
// Everything lives under /billing/pay/ and speaks the same ok/fail envelope as
// the rest of /billing/: { success, message, error:{ code, detail, fields },
// data }. api() already lifts that into a thrown Error, so the authenticated
// calls below are thin.
//
// FOUR SURFACES, and the difference between them is WHO IS LOGGED IN:
//   1. client's own Billing page   → authenticated, client login only
//   2. /payment-result             → PUBLIC route; authenticated OR link-token
//   3. /pay/:token                 → PUBLIC route, no login at all
//   4. staff payment links         → authenticated, four staff roles
//
// Verb set confirmed by unauthenticated OPTIONS probes against prod
// (19 Nov 2026) — an unauthenticated OPTIONS answers `Allow` alongside its 401:
//   pay/summary/                       GET
//   pay/quote/                         GET
//   pay/start/                         POST            (401 without a token)
//   pay/orders/ , pay/orders/<id>/     GET             (401 without a token)
//   pay/links/                         GET, POST       (401 without a token)
//   pay/links/<t>/                     GET   → 404, NOT 401, so PUBLIC
//   pay/links/<t>/orders/<order_id>/   GET   → 404, NOT 401, so PUBLIC
//   pay/links/<t>/start/               POST  → OPTIONS 200, so PUBLIC
//   pay/links/<t>/cancel/              POST  → 401, so STAFF ONLY
//
// That last distinction is the whole reason for publicGet/publicPost below: the
// three public endpoints must be called with NO Authorization header. Routing
// them through api() would be wrong twice over — it attaches whatever token
// happens to be in localStorage, and on a 401 it soft-logs-out the session and
// fires auth-logout, which would throw a staff member off the app because a
// payment link they were previewing had expired.

const PAY = "/billing/pay";

// ── Coercion ────────────────────────────────────────────────────────────────
// Money arrives as STRINGS. Same null discipline as the rest of billing: a
// missing value is null (renders "—"), never 0. On a payment screen a 0 reads
// as "nothing to pay", which is the one thing it must never say by accident.
export const payNum = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Whole-rupee integer out of a text input. Returns null for anything that is
// not a positive whole number, so the Pay button can stay disabled rather than
// posting NaN.
export const wholeRupees = (v) => {
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
};

// ₹ with Indian grouping. `decimals` 0 for headline figures, 2 for breakdowns.
// Missing → "—" (the app-wide placeholder for an unknown value).
export const fmtRs = (v, decimals = 2) => {
  const n = payNum(v);
  if (n === null) return "—";
  const abs = Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${n < 0 ? "-" : ""}₹${abs}`;
};

// "19 Nov 2026, 4:05 pm". Missing → "—".
export const fmtPayDateTime = (v) => {
  if (v === undefined || v === null || v === "") return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

// Date only, for the history table and the links list.
export const fmtPayDate = (v) => {
  if (v === undefined || v === null || v === "") return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

// ── Order status ────────────────────────────────────────────────────────────
// The six states an order can be in. The backend sends status_label with every
// order, so every surface PREFERS that label and uses the map only as the
// fallback for an order that arrived without one. Colour comes from the raw
// `status` so a renamed label cannot change a receipt from green to red.
export const ORDER_STATUS = {
  created: { label: "Waiting for the bank", tone: "amber" },
  pending: { label: "Waiting for the bank", tone: "amber" },
  charged: { label: "Paid", tone: "green" },
  failed: { label: "Failed", tone: "red" },
  mismatch: { label: "Being verified", tone: "amber" },
  expired: { label: "Not completed", tone: "gray" },
};

export const orderStatusLabel = (order) =>
  order?.status_label ||
  ORDER_STATUS[String(order?.status ?? "").toLowerCase()]?.label ||
  order?.status ||
  "—";

export const orderStatusTone = (status) =>
  ORDER_STATUS[String(status ?? "").toLowerCase()]?.tone ?? "gray";

// The two states the bank has not answered on yet, and the only ones the result
// page polls. Everything else is terminal.
export const isAwaitingBank = (status) => {
  const s = String(status ?? "").toLowerCase();
  return s === "created" || s === "pending";
};

export const POLL_INTERVAL_MS = 5_000;
export const POLL_WINDOW_MS = 120_000;

// ── Payment link status ─────────────────────────────────────────────────────
// open → payable. paid / cancelled / expired → the button is hidden and the
// page says which. `enabled: false` on the link payload means online payment is
// switched off entirely and is treated the same way as a non-open link.
export const LINK_STATUS = {
  open: { label: "Open", tone: "green" },
  paid: { label: "Paid", tone: "blue" },
  cancelled: { label: "Cancelled", tone: "gray" },
  expired: { label: "Expired", tone: "gray" },
};

export const linkStatusLabel = (status) =>
  LINK_STATUS[String(status ?? "").toLowerCase()]?.label ?? (status || "—");

export const linkStatusTone = (status) =>
  LINK_STATUS[String(status ?? "").toLowerCase()]?.tone ?? "gray";

// TWO QUESTIONS, NOT ONE, and the difference is which payload is being read.
//
// isLinkOpen  — "has this link been spent or retired?". STATUS ONLY. This is
//   the question the staff list can answer: GET pay/links/ serves created /
//   amount_payable / note / status / expires_at / created_by and says nothing
//   about `enabled`, which belongs to the gateway rather than the link. Asking
//   for enabled===true here would read a missing field as false and hide the
//   Cancel action from every open link on the screen — a row the operator can
//   see and cannot retire.
//
// isLinkPayable — "can money be taken through this right now?". Status AND the
//   gateway switch, because the PUBLIC link payload (GET pay/links/<token>/)
//   does carry `enabled` and a switched-off gateway must not leave a Pay button
//   on a page a client is looking at. Compared against `true` and not
//   truthiness, so a missing flag there errs towards not offering payment.
export const isLinkOpen = (link) =>
  String(link?.status ?? "").toLowerCase() === "open";

export const isLinkPayable = (link) =>
  isLinkOpen(link) && link?.enabled === true;

// What to tell someone holding a link that is no longer payable. `enabled:
// false` on an otherwise open link is the gateway being off rather than the
// link being spent, so it borrows the "contact accounts" wording.
export const linkClosedMessage = (link) => {
  const status = String(link?.status ?? "").toLowerCase();
  if (status === "paid") return "This link has been paid";
  return "This link is no longer active. Please contact AAJneeti accounts.";
};

// ── Public (unauthenticated) transport ──────────────────────────────────────
// A deliberate second transport, NOT a shortcut around api(). It sends no
// Authorization header, never refreshes a token and never soft-logs-out, so a
// 404 on somebody else's expired link cannot end a staff member's session.
// The envelope is read exactly the way api() reads it, so callers of either one
// catch the same Error shape: message / status / code / fields / data.
const parsePublic = async (res) => {
  let body = null;
  try {
    body = await res.json();
  } catch {}

  if (!res.ok) {
    const err = new Error(
      body?.error?.detail ||
        body?.message ||
        body?.detail ||
        "Could not reach the payment service.",
    );
    err.status = res.status;
    err.code = body?.error?.code ?? body?.code;
    err.fields = body?.error?.fields ?? body?.fields;
    err.data = body;
    throw err;
  }

  // HTTP 200 with success:false is a real failure here too.
  if (body && body.success === false) {
    const err = new Error(
      body.error?.detail || body.message || "Request failed.",
    );
    err.code = body.error?.code;
    err.fields = body.error?.fields;
    err.data = body;
    throw err;
  }

  return body;
};

const publicGet = async (path) =>
  parsePublic(await fetch(`${BASE_URL}${path}`, { method: "GET" }));

const publicPost = async (path, payload) =>
  parsePublic(
    await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload ?? {}),
    }),
  );

// Rows out of an envelope that may be paginated or flat — the same two shapes
// every other list endpoint here serves.
const listRows = (res) =>
  Array.isArray(res?.data?.results)
    ? res.data.results
    : Array.isArray(res?.data)
      ? res.data
      : Array.isArray(res?.results)
        ? res.results
        : [];

// ── 1. Client: the Pay now flow ─────────────────────────────────────────────

// GET pay/summary/ → { enabled, dues_ex_gst, min_ex_gst, min_including_gst,
//                      gst_pct, tds_options, methods, other_ways_note }
//
// `enabled` is the master switch: NOTHING about online payment renders until
// this comes back true. Compared against `true` and not truthiness, so a
// missing key leaves the button hidden rather than offering a client a gateway
// that is switched off.
export const fetchPaySummary = async () => {
  const res = await api(`${PAY}/summary/`, { method: "GET" });
  return res?.data ?? null;
};

export const isPayEnabled = (summary) => summary?.enabled === true;

// The TDS percentages to offer behind the "I will deduct TDS" checkbox: the
// server's tds_options with 0 removed, because 0 IS the unchecked state. Falls
// back to nothing rather than to a guessed [1, 2]: an invented percentage would
// be deducted from a real payment.
export const tdsChoices = (summary) =>
  (Array.isArray(summary?.tds_options) ? summary.tds_options : [])
    .map((v) => payNum(v))
    .filter((v) => v !== null && v > 0);

// The note under the breakdown. The server's wording wins whenever it sent any;
// ours is the default for a summary that carries an empty note.
export const PAY_METHODS_NOTE =
  "Card and UPI only. For net banking or bank transfer, please contact our accounts team.";

export const payMethodsNote = (summary) => {
  const note = String(summary?.other_ways_note ?? "").trim();
  return note || PAY_METHODS_NOTE;
};

// Method chips, display only. Tolerates a list of plain strings or of
// { value, label } objects, because this is the one field on the summary whose
// shape is not pinned down by the spec and nothing is computed from it.
export const payMethodLabels = (summary) =>
  (Array.isArray(summary?.methods) ? summary.methods : [])
    .map((m) =>
      m && typeof m === "object" ? (m.label ?? m.name ?? m.value ?? null) : m,
    )
    .filter((m) => typeof m === "string" && m.trim())
    .map((m) =>
      m
        .replace(/[_-]+/g, " ")
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    );

// GET pay/quote/?amount=<n>&tds=<pct> → the breakdown the client approves
// before paying: { amount_ex_gst, gst_pct, gst_amount, including_gst, tds_pct,
// tds_amount, amount_payable, credited }
//
// THE SERVER COMPUTES THIS, ALWAYS. The modal renders what comes back and never
// derives a figure of its own: a locally computed "You pay" that disagreed with
// the gateway by a rupee is a client being charged something they did not see.
export const fetchPayQuote = async (amountExGst, tdsPct) => {
  const qs =
    `?amount=${encodeURIComponent(amountExGst)}` +
    `&tds=${encodeURIComponent(tdsPct ?? 0)}`;
  const res = await api(`${PAY}/quote/${qs}`, { method: "GET" });
  return res?.data ?? null;
};

// POST pay/start/ { amount_ex_gst, tds_pct } → { order_id, payment_url }
// The caller sends the browser to payment_url; the gateway brings it back to
// /payment-result.
export const startPayment = async ({ amountExGst, tdsPct }) => {
  const res = await api(`${PAY}/start/`, {
    method: "POST",
    body: JSON.stringify({ amount_ex_gst: amountExGst, tds_pct: tdsPct ?? 0 }),
  });
  return res?.data ?? null;
};

// ── 2. Orders ───────────────────────────────────────────────────────────────

// GET pay/orders/ — the signed-in client's own online payments, newest first as
// the server orders them. Staff pass clientNomen (and optionally status) to read
// one client's orders instead.
export const fetchPayOrders = async ({ clientNomen, status } = {}) => {
  const params = [];
  if (clientNomen !== undefined && clientNomen !== null && clientNomen !== "")
    params.push(`client_nomen=${encodeURIComponent(clientNomen)}`);
  if (status) params.push(`status=${encodeURIComponent(status)}`);
  const qs = params.length ? `?${params.join("&")}` : "";
  const res = await api(`${PAY}/orders/${qs}`, { method: "GET" });
  return listRows(res);
};

// GET pay/orders/<order_id>/ — one order, for a LOGGED-IN reader.
export const fetchPayOrder = async (orderId) => {
  const res = await api(`${PAY}/orders/${encodeURIComponent(orderId)}/`, {
    method: "GET",
  });
  return res?.data ?? null;
};

// GET pay/links/<token>/orders/<order_id>/ — the same order for somebody who
// holds the link and has no login. PUBLIC: no Authorization header.
export const fetchLinkOrder = async (token, orderId) =>
  (
    await publicGet(
      `${PAY}/links/${encodeURIComponent(token)}/orders/${encodeURIComponent(orderId)}/`,
    )
  )?.data ?? null;

// Which of the two reads a result page should use. `t` present → the link read,
// which needs no session; absent → the authenticated one.
export const fetchResultOrder = async ({ orderId, token }) =>
  token ? await fetchLinkOrder(token, orderId) : await fetchPayOrder(orderId);

// ── 3. Payment links, public side ───────────────────────────────────────────

// GET pay/links/<token>/ → { client, note, status, expires_at, enabled,
//   amount_ex_gst, gst_amount, including_gst, tds_pct, tds_amount,
//   amount_payable, credited }
export const fetchPaymentLink = async (token) =>
  (await publicGet(`${PAY}/links/${encodeURIComponent(token)}/`))?.data ?? null;

// POST pay/links/<token>/start/ → { payment_url }
export const startLinkPayment = async (token) =>
  (await publicPost(`${PAY}/links/${encodeURIComponent(token)}/start/`))?.data ??
  null;

// ── 4. Payment links, staff side ────────────────────────────────────────────

// POST pay/links/ { client_nomen, amount_ex_gst, tds_pct, note, valid_days }
//   → { url, token, status, amount_payable, ... }
// client_nomen is the NOMEN id, not the Client PK (see the roster note below).
export const createPaymentLink = async ({
  clientNomen,
  amountExGst,
  tdsPct,
  note,
  validDays,
}) => {
  const res = await api(`${PAY}/links/`, {
    method: "POST",
    body: JSON.stringify({
      client_nomen: clientNomen,
      amount_ex_gst: amountExGst,
      tds_pct: tdsPct ?? 0,
      note: note ?? "",
      valid_days: validDays,
    }),
  });
  return res?.data ?? null;
};

// GET pay/links/?client_nomen=<id> — the links already issued for one client.
export const fetchPaymentLinks = async (clientNomen) => {
  const qs =
    clientNomen !== undefined && clientNomen !== null && clientNomen !== ""
      ? `?client_nomen=${encodeURIComponent(clientNomen)}`
      : "";
  const res = await api(`${PAY}/links/${qs}`, { method: "GET" });
  return listRows(res);
};

// POST pay/links/<token>/cancel/ — staff only (the public twin of this path
// does not exist; an unauthenticated OPTIONS on it answers 401).
export const cancelPaymentLink = async (token) =>
  await api(`${PAY}/links/${encodeURIComponent(token)}/cancel/`, {
    method: "POST",
  });

// Valid-days bounds, mirrored from the spec so the form can pre-validate. The
// server stays the authority and its message is what the operator is shown.
export const VALID_DAYS_DEFAULT = 7;
export const VALID_DAYS_MAX = 30;

// The TDS percentages the staff form offers. HARDCODED from the spec, which
// states 0 / 1 / 2, and deliberately not inferred from anything: there is no
// staff counterpart to pay/summary/ to read tds_options from, and a guessed
// percentage here would be deducted from a real payment. If the backend ever
// adds a slab this list is the one line to change.
export const STAFF_TDS_OPTIONS = [0, 1, 2];

// Who issued a link. created_by_name is the NAME; created_by is a USER ID, so
// it is only shown when the payload happens to carry a string there. Falling
// back to the id unconditionally would print a bare integer in a person column
// — the same trap the payments ledger documents on its own created_by.
export const linkCreatedBy = (row) => {
  const name = row?.created_by_name ?? row?.created_by_username;
  if (typeof name === "string" && name.trim()) return name.trim();
  const raw = row?.created_by;
  if (typeof raw === "string" && raw.trim() && !/^\d+$/.test(raw.trim()))
    return raw.trim();
  if (raw && typeof raw === "object") {
    const nested = raw.name ?? raw.username ?? raw.email;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return "—";
};

// The order statuses the staff filter offers on the read-only orders table.
export const ORDER_STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "created", label: "Created" },
  { value: "pending", label: "Pending" },
  { value: "charged", label: "Charged" },
  { value: "failed", label: "Failed" },
  { value: "mismatch", label: "Mismatch" },
  { value: "expired", label: "Expired" },
];

// The absolute URL of a link. The backend sends `url` already built, so this
// only covers a payload that carried the token alone — a link whose address the
// operator cannot copy is worse than one built from the current origin.
export const linkUrl = (row) => {
  if (row?.url) return row.url;
  if (!row?.token) return null;
  const origin =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "";
  return `${origin}/pay/${row.token}`;
};

// The WhatsApp hand-off. wa.me with no number opens the contact picker, so the
// operator chooses who it goes to. Copy deliberately carries no dashes.
export const whatsappShareUrl = ({ url, clientName, amountPayable, note }) => {
  const lines = [
    clientName ? `Hello ${clientName},` : "Hello,",
    "",
    "Here is your secure payment link for AAJneeti:",
    url,
  ];
  const amount = payNum(amountPayable);
  if (amount !== null) lines.push("", `Amount payable: ${fmtRs(amount, 2)}`);
  const trimmed = String(note ?? "").trim();
  if (trimmed) lines.push("", trimmed);
  lines.push("", "Card and UPI are both accepted.");
  return `https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`;
};

// Copy to clipboard, with the execCommand fallback for the browsers that refuse
// navigator.clipboard outside a secure context. Returns true on success so the
// caller can show "Copied" only when it actually was.
export const copyToClipboard = async (text) => {
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
};

// ── Staff client roster (NOMEN ids) ─────────────────────────────────────────
// THE ID IS THE THING TO GET RIGHT. POST pay/links/ takes `client_nomen`, the
// NOMEN id — the same id POST /payments/add-funds/ wants, and NOT the Client PK
// that /billing/additional-services/ takes as client_id. The two differ for all
// but one client, so sending the wrong one would issue a payment link against
// somebody else's account with a plausible name printed on it.
//
// Two sources, in order, because no single endpoint serves all four staff roles:
//   1) GET /payments/clients/     — its `id` IS the nomen id (same field
//      normalizeClientOption feeds to add-funds as client_nomen). 200 for
//      accounts, admin and tier-1 CMs; 403 for coordination and tier-2 CMs.
//   2) the shared client directory (admin clients, then the CM hierarchy) —
//      covers coordination. Its rows carry the nomen as `nomenId`.
//
// Each row takes its id AND its name from ONE payload row in ONE source. That
// is the whole discipline here: an id from one list beside a name from another
// is how a correct-looking row ends up describing two different clients.
//
// A row with no nomen id is DROPPED, never patched up from another field. The
// only other id on either payload is the Client PK, which is a different
// client's nomen about 99% of the time.
const nomenOption = (id, name) => {
  const n = Number(id);
  if (!Number.isFinite(n)) return null;
  return { id: n, name: name || `Client #${n}` };
};

export const fetchPayLinkClients = async () => {
  // Source 1 — the payments desk picker. Already scoped server-side to the
  // caller's payable set, so a short list is usually correct rather than broken.
  try {
    const rows = (await fetchPaymentClients())
      .map((c) => nomenOption(c.id, c.name))
      .filter(Boolean);
    if (rows.length) return rows;
  } catch (err) {
    // Only a 403 is expected (coordination, tier-2 CM). Anything else still
    // falls through to the directory, but it is worth seeing in the console.
    if (err?.status !== 403)
      console.warn("[hdfcPay] /payments/clients/ failed:", err?.message);
  }

  // Source 2 — the client directory, which is what coordination can read.
  // allowedTypes omitted: a retainer client pays online like any other.
  const { rows } = await fetchClientRosterWithStatus();
  return rows
    .map((c) => nomenOption(c.nomenId, c.name))
    .filter(Boolean)
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
};
