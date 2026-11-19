import { api, BASE_URL } from "../api/api";
import { fetchPaymentClients } from "./payments";
import { fetchClientRosterWithStatus } from "./leadReplacement";

// ─── HDFC online payments ─────────────────────────────────────────────────────
// Credit card collection through the HDFC gateway, backend 3d5995a + 202e494.
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

// ── 1. Client: the Add funds flow ───────────────────────────────────────────

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

// The non-zero TDS percentages the server offers: tds_options with 0 removed,
// because 0 IS the unchecked state. Falls back to nothing rather than to a
// guessed list: an invented percentage would be deducted from a real payment.
export const tdsChoices = (summary) =>
  (Array.isArray(summary?.tds_options) ? summary.tds_options : [])
    .map((v) => payNum(v))
    .filter((v) => v !== null && v > 0);

// ── TDS is 2%, and only 2% (backend fd948f4) ────────────────────────────────
// pay/summary/ now returns tds_options: [0, 2] and the backend answers 400 to
// 1% everywhere: Add funds, payment links and bank transfers alike. So the
// control is a plain on/off and the RATE IS NEVER DERIVED FROM USER INPUT or
// from an array index.
//
// This is a hardcoded constant on purpose. The previous shape read
// choices()[0], which happens to be 2 today and would silently become whatever
// the server listed first if tds_options ever changed again. A rate that
// decides how much money is withheld from a real payment should not move
// because an array was reordered.
export const TDS_PCT = 2;

// The only two values this app may ever send. `true` means 2, anything else
// means 0; there is no third answer and no path that takes a number.
export const tdsPctFor = (deduct) => (deduct === true ? TDS_PCT : 0);

// Whether to OFFER the checkbox at all. The server must be listing exactly the
// rate we would send: if it ever offers some other set (say [0, 5]) the control
// is hidden rather than ticking a box that posts a 2 the backend will refuse.
// Hiding loses the ability to declare TDS; sending the wrong rate loses money.
export const tdsOffered = (summary) => {
  const choices = tdsChoices(summary);
  if (choices.length === 0) return false;
  if (choices.includes(TDS_PCT)) return true;
  console.warn(
    `[hdfcPay] pay/summary/ offers tds_options ${JSON.stringify(choices)}, ` +
      `which does not include the ${TDS_PCT}% this app sends. Hiding the TDS ` +
      `control rather than posting a rate the backend will refuse.`,
  );
  return false;
};

// The statutory note shown under the TDS checkbox on BOTH ways of paying.
// Verbatim from the backend ticket: it cites a section of the Act and names
// what the client has to do afterwards, so it is not ours to paraphrase.
export const TDS_NOTE =
  "TDS @ 2% under Section 393(1) [Table Sl. No. 6(i)] of the Income-tax Act, " +
  "2025 (earlier Section 194C). Deduct TDS only on the amount excluding GST, " +
  "and share the TDS certificate with our accounts team after filing.";

// ── The note under the method chip ──────────────────────────────────────────
// What the gateway accepts, and where to go for anything else. ONE note on the
// online tab, not two: it used to be duplicated under the Pay button, and the
// same sentence printed twice on one short dialog reads as a bug.
//
// TWO ENDINGS, because the second sentence names a destination that is not
// always there. The Bank transfer / UPI tab has its own independent switch, so
// with it off the note points at the accounts team instead. Telling a client to
// use a tab that is not on their screen sends them looking for it.
export const ONLINE_CARDS_ONLY = "Online payment accepts credit cards only.";

const CARDS_ELSEWHERE = "To pay by UPI, debit card or net banking,";

export const ONLINE_CARDS_NOTE_TAB =
  `${ONLINE_CARDS_ONLY} ${CARDS_ELSEWHERE} use the Bank transfer / UPI tab.`;

export const ONLINE_CARDS_NOTE_ACCOUNTS =
  `${ONLINE_CARDS_ONLY} ${CARDS_ELSEWHERE} please contact our accounts team.`;

export const onlineCardsNote = (bankTabOffered) =>
  bankTabOffered ? ONLINE_CARDS_NOTE_TAB : ONLINE_CARDS_NOTE_ACCOUNTS;

// The server's wording still wins whenever it sent any; ours is the default for
// a summary carrying an empty other_ways_note.
export const payMethodsNote = (summary, bankTabOffered) => {
  const note = String(summary?.other_ways_note ?? "").trim();
  return note || onlineCardsNote(bankTabOffered);
};

// ── Method names ────────────────────────────────────────────────────────────
// How a payment rail is written on screen. An explicit map, because the
// title-caser underneath gets the house spellings wrong in both directions:
// "upi" would read "Upi" and "credit_card" would read "Credit Card" rather than
// the "Credit card" the business writes. Anything outside the map still
// title-cases, so a rail added server-side renders legibly instead of blank.
const PAY_METHOD_LABELS = {
  credit_card: "Credit card",
  debit_card: "Debit card",
  card: "Card",
  upi: "UPI",
  net_banking: "Net banking",
  wallet: "Wallet",
};

export const payMethodLabel = (method) => {
  const raw = String(method ?? "").trim();
  if (!raw) return null;
  const known = PAY_METHOD_LABELS[raw.toLowerCase()];
  if (known) return known;
  return raw
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

// Method chips, display only. `methods` is a plain list of strings (backend
// confirmed), today ["credit_card"]; the object tolerance is kept because it
// costs nothing and this field is never computed from.
export const payMethodLabels = (summary) =>
  (Array.isArray(summary?.methods) ? summary.methods : [])
    .map((m) =>
      m && typeof m === "object" ? (m.label ?? m.name ?? m.value ?? null) : m,
    )
    .map((m) => payMethodLabel(m))
    .filter((m) => typeof m === "string" && m);

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

// The one-line breakdown under the staff form's amount box, built from a
// GET pay/quote/ payload. Pure and here rather than inline in the screen
// because it is exactly the shape that reads fine and is wrong: money
// formatting plus a clause that appears only sometimes.
//
// The TDS clause is included only when there is TDS to report, so a no-TDS
// link does not read "minus TDS ₹0.00". Every figure is the server's and
// nothing is derived; a null renders "—" through fmtRs rather than ₹0.
export const linkQuoteSentence = (quote) => {
  if (!quote) return null;
  const tds = payNum(quote.tds_amount);
  const tdsClause = tds !== null && tds > 0 ? `, minus TDS ${fmtRs(tds, 2)}` : "";
  return (
    `Client pays ${fmtRs(quote.amount_payable, 2)} ` +
    `(${fmtRs(quote.amount_ex_gst, 2)} + GST ${fmtRs(quote.gst_amount, 2)}${tdsClause}). ` +
    `Credited ${fmtRs(quote.credited, 2)}.`
  );
};

// Valid-days bounds, mirrored from the spec so the form can pre-validate. The
// server stays the authority and its message is what the operator is shown.
export const VALID_DAYS_DEFAULT = 7;
export const VALID_DAYS_MAX = 30;

// The TDS percentages the staff forms offer: none, or the single statutory
// rate. 1% was removed in backend fd948f4 and is now a 400 everywhere, so
// offering it would hand an operator a choice that can only fail.
//
// Hardcoded, like TDS_PCT above and for the same reason: there is no staff
// counterpart to pay/summary/ to read tds_options from, and a guessed
// percentage here is withheld from real money.
export const STAFF_TDS_OPTIONS = [0, TDS_PCT];

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
  lines.push("", "Payable by credit card.");
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

// ═══ BANK TRANSFER / UPI (backend 27bcdca) ═══════════════════════════════════
// The offline half of the same feature: the client moves money themselves (NEFT
// / RTGS / IMPS / UPI) and then REPORTS it with its UTR. Nothing is credited by
// submitting — accounts verify it first, which is why every piece of copy here
// says "will be added once verified" and never "paid".
//
// Verb set confirmed by unauthenticated OPTIONS probes against prod (19 Nov
// 2026), all 401 without a token:
//   pay/bank-details/                    GET, POST, PUT
//   pay/bank-transfers/                  GET, POST
//   pay/bank-transfers/<id>/verify/      POST
//   pay/bank-transfers/<id>/reject/      POST
//   pay/bank-transfers/<id>/proof/       GET          ← auth, so fetch as a blob

// GET pay/bank-details/ → { enabled, account_name, bank_name, account_number,
//   ifsc, branch, upi_id, note, has_qr, qr_url }
// Same master-switch discipline as pay/summary/: `enabled` is compared against
// true, so a missing key leaves the whole tab hidden.
export const fetchBankDetails = async () => {
  const res = await api(`${PAY}/bank-details/`, { method: "GET" });
  return res?.data ?? null;
};

export const isBankEnabled = (details) => details?.enabled === true;

// ── File URLs from the backend (qr_url, proof_url) ──────────────────────────
// These are paths relative to the API HOST, and they CARRY THEIR OWN /api
// SEGMENT: pay/bank-details/ sends "/api/billing/pay/bank-details/qr/?v=...".
//
// So they must be joined to the ORIGIN, not to BASE_URL. BASE_URL already ends
// in /api, and prefixing with it produced "/api/api/billing/..." which the
// server 404s. That was the broken QR on both the client tab and the staff
// preview; confirmed against prod both ways (the single-/api URL answers 200
// image/jpeg, the doubled one 404s).
//
// new URL() does the join: a path resolves against the origin, and an absolute
// URL passes through untouched, so a later move to a CDN address keeps working
// without producing "https://host/https://cdn/...".
const API_ORIGIN = (() => {
  try {
    return new URL(BASE_URL).origin;
  } catch {
    return "";
  }
})();

export const apiFileUrl = (path) => {
  if (!path) return null;
  try {
    return new URL(path, API_ORIGIN).href;
  } catch {
    return null;
  }
};

// The QR's absolute address, joined to the API ORIGIN (see apiFileUrl). The
// image is PUBLIC: prod serves it with `Cache-Control: public, max-age=300` and
// no Authorization header, so a plain <img src> is correct and a blob fetch
// would be pointless work.
//
// The ?v= cache-buster the backend appends rides along untouched, which is what
// makes a re-uploaded QR appear immediately instead of sitting behind that
// 5-minute cache.
export const bankQrSrc = (details) =>
  details?.has_qr === true ? apiFileUrl(details?.qr_url) : null;

// The minimum a bank transfer may be reported for, ex GST. HARDCODED from the
// spec at 50,000 and deliberately NOT read from pay/summary/.min_ex_gst, which
// is the ONLINE minimum and a different number (5,000 on prod today). Borrowing
// one for the other would either block a legitimate transfer or wave through
// one the server will reject. The server stays the authority and its message is
// what the client is shown; this only stops an obviously doomed submit.
export const BANK_MIN_EX_GST = 50_000;

// UTR rules from the spec: 10 to 40 letters or digits. Input is normalised
// before it is validated OR sent, so "  utr 1234 5678  " and "UTR12345678"
// are the same submission and a stray space cannot cause a duplicate-UTR
// rejection the client has no way to understand.
export const normaliseUtr = (v) =>
  String(v ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();

export const UTR_MIN = 10;
export const UTR_MAX = 40;

export const utrError = (v) => {
  const utr = normaliseUtr(v);
  if (!utr) return "Enter the UTR or transaction reference.";
  if (!/^[A-Z0-9]+$/.test(utr))
    return "The UTR can contain only letters and digits.";
  if (utr.length < UTR_MIN || utr.length > UTR_MAX)
    return `The UTR must be between ${UTR_MIN} and ${UTR_MAX} characters.`;
  return null;
};

// Transfer modes. The VALUES are the wire contract and the labels are ours;
// a row always prefers the server's mode_label where it sent one.
export const TRANSFER_MODES = [
  { value: "neft", label: "NEFT" },
  { value: "rtgs", label: "RTGS" },
  { value: "imps", label: "IMPS" },
  { value: "upi", label: "UPI" },
  { value: "other", label: "Other" },
];

const MODE_LABELS = Object.fromEntries(
  TRANSFER_MODES.map((m) => [m.value, m.label]),
);

export const transferModeLabel = (row) =>
  row?.mode_label || MODE_LABELS[String(row?.mode ?? "").toLowerCase()] || "—";

// Proof upload rules from the spec.
export const PROOF_MAX_BYTES = 3 * 1024 * 1024;
export const PROOF_ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const PROOF_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export const proofError = (file) => {
  if (!file) return null; // optional
  if (!PROOF_TYPES.has(String(file.type).toLowerCase()))
    return "The screenshot must be a JPG, PNG, WEBP or PDF.";
  if (file.size > PROOF_MAX_BYTES) return "The screenshot must be under 3 MB.";
  return null;
};

// QR upload rules (the staff settings form). PDF is NOT accepted here: this one
// is rendered in an <img> on the client's screen.
export const QR_MAX_BYTES = 2 * 1024 * 1024;
export const QR_ACCEPT = "image/jpeg,image/png,image/webp";
const QR_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export const qrError = (file) => {
  if (!file) return null;
  if (!QR_TYPES.has(String(file.type).toLowerCase()))
    return "The QR image must be a JPG, PNG or WEBP.";
  if (file.size > QR_MAX_BYTES) return "The QR image must be under 2 MB.";
  return null;
};

// ── Transfer dates ──────────────────────────────────────────────────────────
// Not in the future, at most 60 days back. Both bounds are produced as LOCAL
// "YYYY-MM-DD" strings rather than from toISOString(), which converts to UTC
// first: east of Greenwich that hands back yesterday for most of the evening,
// so an operator in India submitting at 7pm would be told today is in the past.
export const TRANSFER_MAX_DAYS_BACK = 60;

const pad2 = (n) => String(n).padStart(2, "0");

export const localDateKey = (d = new Date()) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const transferDateBounds = (today = new Date()) => {
  const back = new Date(today);
  back.setDate(back.getDate() - TRANSFER_MAX_DAYS_BACK);
  return { min: localDateKey(back), max: localDateKey(today) };
};

export const transferDateError = (value, today = new Date()) => {
  if (!value) return "Pick the date the transfer was made.";
  const { min, max } = transferDateBounds(today);
  // Plain string comparison is exact for zero-padded YYYY-MM-DD and avoids
  // re-parsing the value into a Date, which is where timezones creep back in.
  if (value > max) return "The transfer date cannot be in the future.";
  if (value < min)
    return `The transfer date cannot be more than ${TRANSFER_MAX_DAYS_BACK} days ago.`;
  return null;
};

// ── Bank transfer status ────────────────────────────────────────────────────
// A THIRD vocabulary, separate from order status and link status on purpose.
// "pending" here means a human has not looked at it yet, which is nothing like
// an order's "pending" (the bank has not answered). Sharing a pill between the
// two would tell a client their money is on its way when nobody has checked it.
export const TRANSFER_STATUS = {
  pending: { label: "Pending verification", tone: "amber" },
  verified: { label: "Verified", tone: "green" },
  rejected: { label: "Rejected", tone: "red" },
};

export const transferStatusLabel = (row) =>
  row?.status_label ||
  TRANSFER_STATUS[String(row?.status ?? "").toLowerCase()]?.label ||
  row?.status ||
  "—";

export const transferStatusTone = (status) =>
  TRANSFER_STATUS[String(status ?? "").toLowerCase()]?.tone ?? "gray";

export const TRANSFER_STATUS_TABS = [
  { value: "pending", label: "To verify" },
  { value: "verified", label: "Verified" },
  { value: "rejected", label: "Rejected" },
];

// ── Bank transfer calls ─────────────────────────────────────────────────────

// GET pay/bank-transfers/ — the client's own submissions, or (staff) a status
// queue optionally narrowed to one client.
export const fetchBankTransfers = async ({ status, clientNomen } = {}) => {
  const params = [];
  if (status) params.push(`status=${encodeURIComponent(status)}`);
  if (clientNomen !== undefined && clientNomen !== null && clientNomen !== "")
    params.push(`client_nomen=${encodeURIComponent(clientNomen)}`);
  const qs = params.length ? `?${params.join("&")}` : "";
  const res = await api(`${PAY}/bank-transfers/${qs}`, { method: "GET" });
  return listRows(res);
};

// POST pay/bank-transfers/ — multipart, because of the optional proof file.
//
// FormData is handed to api() as-is: buildHeaders() already skips the JSON
// Content-Type for a FormData body so the browser can set the multipart
// boundary itself. Setting it by hand produces a body the server cannot parse.
//
// Only fields with a value are appended. An empty `note` or a missing file sent
// as the string "undefined" is how optional multipart fields turn into
// validation errors nobody can explain.
export const submitBankTransfer = async ({
  amountExGst,
  tdsPct,
  utr,
  transferDate,
  mode,
  note,
  proof,
}) => {
  const form = new FormData();
  form.append("amount_ex_gst", String(amountExGst));
  form.append("tds_pct", String(tdsPct ?? 0));
  form.append("utr", normaliseUtr(utr));
  form.append("transfer_date", transferDate);
  form.append("mode", mode);
  const trimmed = String(note ?? "").trim();
  if (trimmed) form.append("note", trimmed);
  if (proof) form.append("proof", proof);

  const res = await api(`${PAY}/bank-transfers/`, {
    method: "POST",
    body: form,
  });
  return res?.data ?? null;
};

// POST pay/bank-transfers/<id>/verify/
// amount_ex_gst and tds_pct are OPTIONAL overrides for when the bank credited
// something other than what the client reported. Each is sent only when the
// caller actually passes it, so an untouched dialog posts {} plus the note and
// the server keeps its own figures.
export const verifyBankTransfer = async (id, { amountExGst, tdsPct, note } = {}) => {
  const body = {};
  if (amountExGst !== undefined && amountExGst !== null && amountExGst !== "")
    body.amount_ex_gst = amountExGst;
  if (tdsPct !== undefined && tdsPct !== null && tdsPct !== "")
    body.tds_pct = tdsPct;
  const trimmed = String(note ?? "").trim();
  if (trimmed) body.note = trimmed;

  const res = await api(`${PAY}/bank-transfers/${encodeURIComponent(id)}/verify/`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return res?.data ?? null;
};

// POST pay/bank-transfers/<id>/reject/ — the reason is REQUIRED and the CLIENT
// READS IT, which the dialog says out loud.
export const REJECT_REASON_MIN = 5;

export const rejectReasonError = (v) => {
  const reason = String(v ?? "").trim();
  if (reason.length < REJECT_REASON_MIN)
    return `Give a reason of at least ${REJECT_REASON_MIN} characters. The client sees it.`;
  return null;
};

export const rejectBankTransfer = async (id, reason) => {
  const res = await api(`${PAY}/bank-transfers/${encodeURIComponent(id)}/reject/`, {
    method: "POST",
    body: JSON.stringify({ reason: String(reason ?? "").trim() }),
  });
  return res?.data ?? null;
};

// The proof file. AUTHENTICATED (prod answers 401 without a token), so it
// cannot go in an <img src> or a plain link: it is fetched with the header,
// turned into a blob URL and opened. The caller revokes the URL.
export const fetchProofBlobUrl = async (row) => {
  // Joined through apiFileUrl for the same reason the QR is: proof_url is a
  // path under the API HOST that carries its own /api segment, so prefixing it
  // with BASE_URL produced "/api/api/..." and a 404. The QR is what got
  // reported, but this is the identical field shape from the identical
  // serializer and would have failed the same way the first time anyone
  // clicked "View proof".
  const url = apiFileUrl(row?.proof_url);
  if (!url) return null;

  const auth = JSON.parse(localStorage.getItem("auth") || "null");
  const res = await fetch(url, {
    headers: auth?.token ? { Authorization: `Bearer ${auth.token}` } : {},
  });
  if (!res.ok) {
    const err = new Error(
      res.status === 404
        ? "The proof file is no longer available."
        : "The proof file could not be opened.",
    );
    err.status = res.status;
    throw err;
  }
  return URL.createObjectURL(await res.blob());
};

// POST pay/bank-details/ — multipart, for the QR upload.
// `remove_qr` is sent ONLY when it is true. Sending remove_qr=false on every
// save is harmless today and is exactly the sort of always-present destructive
// flag that becomes harmful after a backend refactor.
export const saveBankDetails = async (fields, { qrFile, removeQr } = {}) => {
  const form = new FormData();
  for (const key of [
    "account_name",
    "bank_name",
    "account_number",
    "ifsc",
    "branch",
    "upi_id",
    "note",
  ]) {
    form.append(key, String(fields?.[key] ?? "").trim());
  }
  if (qrFile) form.append("qr", qrFile);
  if (removeQr === true) form.append("remove_qr", "true");

  const res = await api(`${PAY}/bank-details/`, { method: "POST", body: form });
  return res?.data ?? null;
};

// ── One payment history for the client ──────────────────────────────────────
// The Billing page shows online orders and bank transfers in ONE table, so both
// are normalised to the same row shape first.
//
// EACH ROW TAKES EVERY FIELD FROM ONE PAYLOAD ROW. That is the whole discipline
// here: an order's amount_paid and a transfer's amount_transferred are
// different keys for different things, and a row assembled from both sources
// is how two adjacent columns end up describing two different payments.
//
// `kind` is what the renderer branches on, so neither shape has to be sniffed.
export const asOnlineHistoryRow = (o) => ({
  kind: "online",
  key: `online-${o.order_id}`,
  at: o.created_at,
  reference: o.order_id,
  method: o.method,
  paid: o.amount_paid,
  credited: o.credited,
  status: o.status,
  raw: o,
});

export const asTransferHistoryRow = (t) => ({
  kind: "transfer",
  key: `transfer-${t.id}`,
  at: t.created_at,
  reference: t.utr,
  method: transferModeLabel(t),
  paid: t.amount_transferred,
  // A pending or rejected transfer has credited NOTHING. The server sends null
  // there and it must stay null so the column reads "—": a 0 in a Credited
  // column next to a real amount reads as "we took it and gave you nothing",
  // and a copied-across amount_transferred would claim money that has not been
  // credited yet.
  credited: t.credited,
  status: t.status,
  reviewNote: t.review_note,
  transferDate: t.transfer_date,
  raw: t,
});

// Newest first. Rows with no timestamp sink to the bottom rather than being
// dropped: a payment the client made is never hidden because a date is missing.
export const mergeHistory = (orders, transfers) =>
  [
    ...(Array.isArray(orders) ? orders : []).map(asOnlineHistoryRow),
    ...(Array.isArray(transfers) ? transfers : []).map(asTransferHistoryRow),
  ].sort((a, b) => {
    const ta = a.at ? Date.parse(a.at) : NaN;
    const tb = b.at ? Date.parse(b.at) : NaN;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });

// ═══ ONLINE PAYMENTS REPORT (accounts reconciliation) ════════════════════════
// GET pay/orders/report/ — every client's gateway orders over a date range, for
// reconciling against the HDFC settlement report. Verb set confirmed by an
// unauthenticated OPTIONS probe against prod (GET, HEAD, OPTIONS; 401 without a
// token).
//
// WHICH DATE A ROW IS FILTERED BY DEPENDS ON ITS STATUS: paid orders by their
// PAID date, everything else by their CREATED date. That asymmetry is the
// server's and it drives the sort and the date column here too (see
// effectiveOrderDate), because a table sorted on a key that is not the one the
// server filtered on puts rows in an order nobody can reconcile against.

export const REPORT_STATUSES = [
  { value: "charged", label: "Paid" },
  { value: "pending", label: "Pending" },
  { value: "created", label: "Created" },
  { value: "failed", label: "Failed" },
  { value: "mismatch", label: "Mismatch" },
  { value: "expired", label: "Expired" },
  { value: "all", label: "All statuses" },
];

export const REPORT_DEFAULT_STATUS = "charged";

// kind is ADMIN ONLY and exists to separate real client payments from test
// links. Absent means both.
export const REPORT_KINDS = [
  { value: "", label: "All" },
  { value: "client", label: "Add funds" },
  { value: "link", label: "Link" },
];

// What the desk calls each kind of order. The server sends kind: client | link.
// "Add funds" matches the button a client actually pressed to make it; it was
// "Pay now" until that button was renamed, and a report column naming a control
// that no longer exists is how a reconciliation gets queried.
export const orderKindLabel = (row) => {
  const k = String(row?.kind ?? "").toLowerCase();
  if (k === "client") return "Add funds";
  if (k === "link") return "Link";
  return "—";
};

// The server caps the span. Mirrored so an obviously doomed request never
// leaves the browser; the server stays the authority and ITS message is what
// the operator is shown when one slips through.
export const REPORT_MAX_DAYS = 92;

// Whole days between two "YYYY-MM-DD" keys, inclusive of both ends. Parsed from
// the parts into a UTC instant purely for the subtraction, which is safe here
// because BOTH sides are built the same way and no local date is derived back
// out of it.
const daysBetweenInclusive = (from, to) => {
  const [fy, fm, fd] = String(from).split("-").map(Number);
  const [ty, tm, td] = String(to).split("-").map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return null;
  const a = Date.UTC(fy, fm - 1, fd);
  const b = Date.UTC(ty, tm - 1, td);
  return Math.floor((b - a) / 86_400_000) + 1;
};

export const reportRangeError = (from, to) => {
  if (!from || !to) return "Pick both dates.";
  if (from > to) return "The start date is after the end date.";
  const days = daysBetweenInclusive(from, to);
  if (days === null) return "Pick both dates.";
  if (days > REPORT_MAX_DAYS)
    return `Pick a range of ${REPORT_MAX_DAYS} days or less. This one is ${days} days.`;
  return null;
};

// ── Quick picks ─────────────────────────────────────────────────────────────
// Every bound is built from LOCAL date parts through localDateKey(), never
// toISOString(): in IST the UTC version rolls to the previous day for most of
// the evening, so "Today" would ask the server for yesterday.
const monthStart = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

export const reportQuickPicks = (today = new Date()) => {
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  return [
    { key: "today", label: "Today", from: localDateKey(today), to: localDateKey(today) },
    {
      key: "yesterday",
      label: "Yesterday",
      from: localDateKey(yesterday),
      to: localDateKey(yesterday),
    },
    {
      key: "this_month",
      label: "This month",
      from: localDateKey(monthStart(today)),
      to: localDateKey(today),
    },
    {
      key: "last_month",
      label: "Last month",
      from: localDateKey(monthStart(lastMonthEnd)),
      to: localDateKey(lastMonthEnd),
    },
  ];
};

// The default the screen opens on: 1st of this month to today, which is also
// the server's default when from/to are omitted.
export const reportDefaultRange = (today = new Date()) => ({
  from: localDateKey(monthStart(today)),
  to: localDateKey(today),
});

export const fetchPayOrdersReport = async ({
  from,
  to,
  status,
  clientNomen,
  kind,
} = {}) => {
  const params = [];
  if (from) params.push(`from=${encodeURIComponent(from)}`);
  if (to) params.push(`to=${encodeURIComponent(to)}`);
  if (status) params.push(`status=${encodeURIComponent(status)}`);
  if (clientNomen !== undefined && clientNomen !== null && clientNomen !== "")
    params.push(`client_nomen=${encodeURIComponent(clientNomen)}`);
  if (kind) params.push(`kind=${encodeURIComponent(kind)}`);
  const qs = params.length ? `?${params.join("&")}` : "";
  const res = await api(`${PAY}/orders/report/${qs}`, { method: "GET" });
  return res?.data ?? null;
};

// The date a row is ordered and shown by: its PAID date when it has one, its
// CREATED date otherwise. That is exactly the axis the server filtered it on,
// so the two always agree.
//
// It returns WHICH field it used as well as the value, because the cell has to
// say so: a created date sitting silently under a "Paid on" heading is a
// settlement date that is not a settlement date, which is the one thing a
// reconciliation screen must never print.
export const effectiveOrderDate = (row) => {
  if (row?.paid_on) return { value: row.paid_on, field: "paid_on" };
  if (row?.created_at) return { value: row.created_at, field: "created_at" };
  return { value: null, field: null };
};

// Newest first. Rows with no date at all sink to the bottom rather than being
// dropped: a payment the gateway took is never hidden because a date is
// missing.
export const sortReportRows = (rows) =>
  [...(Array.isArray(rows) ? rows : [])].sort((a, b) => {
    const ta = Date.parse(effectiveOrderDate(a).value ?? "");
    const tb = Date.parse(effectiveOrderDate(b).value ?? "");
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });

// by_method is an OBJECT keyed by method, not a list: { upi: {count, paid} }.
// Returned sorted by amount so the biggest rail reads first, with the method
// title-cased the same way the client's method chips are.
export const readByMethod = (totals) => {
  const block = totals?.by_method;
  if (!block || typeof block !== "object") return [];
  return Object.entries(block)
    .map(([method, v]) => ({
      method,
      // The same spellings the client's own method chips use, so "UPI" and
      // "Credit card" read identically on both screens.
      label: payMethodLabel(method) ?? method,
      count: payNum(v?.count) ?? 0,
      paid: payNum(v?.paid),
    }))
    .sort((a, b) => (b.paid ?? 0) - (a.paid ?? 0));
};

// ── CSV ─────────────────────────────────────────────────────────────────────
// The columns on screen, in the same order, with AMOUNTS AS PLAIN NUMBERS:
// this file is opened in a spreadsheet and reconciled against HDFC's own
// export, so "₹5,900.00" would have to be un-formatted again by hand before it
// could be summed. A missing value is an EMPTY cell, never "—" and never 0.
export const REPORT_CSV_COLUMNS = [
  "Paid on",
  "Date field",
  "Client",
  "Order ID",
  "Bank ref",
  "Method",
  "Kind",
  "Amount received",
  "TDS",
  "Credited",
  "Status",
];

// Plain number for a money cell: the server's string passed through once it is
// confirmed numeric. Null/absent becomes "" so the column stays summable.
const csvNum = (v) => {
  const n = payNum(v);
  return n === null ? "" : String(n);
};

// Excel reads a bare YYYY-MM-DDTHH:MM:SSZ inconsistently across locales, so the
// timestamp is written as "YYYY-MM-DD HH:MM" in LOCAL time, which is the same
// instant the operator is reading off the screen.
const csvDateTime = (v) => {
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}`
  );
};

const csvEscape = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export const reportRowToCsv = (row) => {
  const d = effectiveOrderDate(row);
  return [
    csvDateTime(d.value),
    // Which field that timestamp came from, so a reconciliation against the
    // settlement report never silently treats a created date as a paid date.
    d.field === "paid_on" ? "paid_on" : d.field === "created_at" ? "created_at" : "",
    row?.client ?? "",
    row?.order_id ?? "",
    row?.bank_ref ?? "",
    row?.method ?? "",
    orderKindLabel(row) === "—" ? "" : orderKindLabel(row),
    csvNum(row?.amount_paid),
    csvNum(row?.tds_amount),
    csvNum(row?.credited),
    row?.status_label || row?.status || "",
  ];
};

export const buildReportCsv = (rows) =>
  [
    REPORT_CSV_COLUMNS.map(csvEscape).join(","),
    ...(rows ?? []).map((r) => reportRowToCsv(r).map(csvEscape).join(",")),
  ].join("\r\n");

export const reportCsvFilename = (from, to) =>
  `online-payments_${from}_${to}.csv`;

// Download helper. The BOM is what makes Excel read the ₹ in a client name as
// UTF-8 rather than mojibake; the rest of the app's exports do the same.
export const downloadCsv = (filename, csv) => {
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
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
