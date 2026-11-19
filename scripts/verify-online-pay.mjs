// Checks the pure logic behind the HDFC online-payment screens, clause by
// clause against the backend spec. Run: node scripts/verify-online-pay.mjs
//
// WHY THIS EXISTS. Every rule asserted here is a three-line derivation sitting
// between a payload and a figure a client is charged, which is exactly the
// shape that reads fine and is wrong:
//
//   • payNum must send a MISSING amount to null and never to 0. A 0 on a
//     payment screen reads as "nothing to pay".
//   • tdsChoices must never invent a percentage. An invented 1% would be
//     deducted from a real payment.
//   • isLinkPayable must require open AND enabled, so a disabled gateway cannot
//     leave a Pay button on a public page.
//   • the login `next` guard must refuse "//host", which would otherwise turn
//     the login form into an open redirect.
//   • linkCreatedBy must never print the bare user id that sits in created_by.
//
// Imports the real modules; no copied logic. The browser globals below are a
// shim for api.js's module-load stale-token guard, nothing more — these modules
// are read, not exercised against a server.

import { registerHooks } from "node:module";

// Vite resolves extensionless relative imports ("../api/api"); Node does not.
// Same one resolve hook scripts/verify-ledger-readers.mjs uses, so the script
// imports the REAL modules rather than a copy that drifts.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
        return nextResolve(specifier + ".js", context);
      }
      throw err;
    }
  },
});

const noopStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
  clear: () => {},
};
globalThis.localStorage ??= noopStorage;
globalThis.sessionStorage ??= noopStorage;
globalThis.window ??= {
  location: { origin: "https://reports.aajneeti.social", search: "" },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
};
globalThis.atob ??= (b) => Buffer.from(b, "base64").toString("binary");

const {
  payNum,
  wholeRupees,
  tdsChoices,
  payMethodsNote,
  payMethodLabels,
  isAwaitingBank,
  orderStatusLabel,
  orderStatusTone,
  isLinkOpen,
  isLinkPayable,
  linkClosedMessage,
  linkCreatedBy,
  linkUrl,
  whatsappShareUrl,
  fmtRs,
  STAFF_TDS_OPTIONS,
  VALID_DAYS_DEFAULT,
  VALID_DAYS_MAX,
  POLL_INTERVAL_MS,
  POLL_WINDOW_MS,
  // ── bank transfer / UPI ──
  isBankEnabled,
  bankQrSrc,
  normaliseUtr,
  utrError,
  proofError,
  qrError,
  transferDateError,
  transferDateBounds,
  localDateKey,
  transferModeLabel,
  transferStatusLabel,
  transferStatusTone,
  rejectReasonError,
  mergeHistory,
  BANK_MIN_EX_GST,
  TRANSFER_MODES,
  TRANSFER_MAX_DAYS_BACK,
  PROOF_MAX_BYTES,
  QR_MAX_BYTES,
  // ── reconciliation report ──
  reportRangeError,
  reportQuickPicks,
  reportDefaultRange,
  effectiveOrderDate,
  sortReportRows,
  orderKindLabel,
  readByMethod,
  buildReportCsv,
  reportRowToCsv,
  reportCsvFilename,
  REPORT_CSV_COLUMNS,
  REPORT_MAX_DAYS,
  REPORT_DEFAULT_STATUS,
} = await import("../src/services/hdfcPay.js");

const { nextAfterLogin } = await import("../src/utils/loginNext.js");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " " + extra}`);
  if (!cond) failures++;
};

console.log("\nmoney arrives as strings, and missing is never zero");
check("string parses", payNum("1234.50") === 1234.5);
check("number passes through", payNum(0) === 0);
check("null → null", payNum(null) === null);
check("undefined → null", payNum(undefined) === null);
check("empty string → null", payNum("") === null);
check("garbage → null", payNum("abc") === null);
check("missing renders as a dash, not ₹0", fmtRs(null) === "—", fmtRs(null));
check("a real zero renders as ₹0.00", fmtRs("0") === "₹0.00", fmtRs("0"));
check("indian grouping", fmtRs("150000") === "₹1,50,000.00", fmtRs("150000"));

console.log("\nthe amount box is whole rupees only");
check("plain integer", wholeRupees("25000") === 25000);
check("decimal refused", wholeRupees("250.50") === null);
check("zero refused", wholeRupees("0") === null);
check("negative refused", wholeRupees("-5") === null);
check("blank refused", wholeRupees("") === null);
check("spaces refused", wholeRupees("2 5") === null);

console.log("\nTDS choices come from the server and are never invented");
check("0 is dropped, it IS the unchecked state",
  JSON.stringify(tdsChoices({ tds_options: [0, 1, 2] })) === "[1,2]",
  JSON.stringify(tdsChoices({ tds_options: [0, 1, 2] })));
check("strings coerce", JSON.stringify(tdsChoices({ tds_options: ["0", "1"] })) === "[1]");
check("no options → empty, NOT a guessed [1,2]",
  JSON.stringify(tdsChoices({})) === "[]");
check("missing summary → empty", JSON.stringify(tdsChoices(null)) === "[]");
check("staff form offers exactly the spec's 0/1/2",
  JSON.stringify(STAFF_TDS_OPTIONS) === "[0,1,2]");

console.log("\nthe methods note prefers the server's wording");
check("server note wins",
  payMethodsNote({ other_ways_note: "Call us on 1800" }) === "Call us on 1800");
check("empty note falls back to ours",
  payMethodsNote({ other_ways_note: "   " }).startsWith("Card and UPI only."));
check("absent note falls back to ours",
  payMethodsNote({}).includes("accounts team"));
check("method strings title-case",
  JSON.stringify(payMethodLabels({ methods: ["card", "net_banking"] })) ===
    '["Card","Net Banking"]');
check("method objects read their label",
  JSON.stringify(payMethodLabels({ methods: [{ value: "upi", label: "UPI" }] })) ===
    '["UPI"]');
check("a non-array methods field is ignored",
  JSON.stringify(payMethodLabels({ methods: "card" })) === "[]");

console.log("\nonly created/pending are polled");
check("created polls", isAwaitingBank("created") === true);
check("pending polls", isAwaitingBank("pending") === true);
check("charged does not", isAwaitingBank("charged") === false);
check("failed does not", isAwaitingBank("failed") === false);
check("mismatch does not", isAwaitingBank("mismatch") === false);
check("expired does not", isAwaitingBank("expired") === false);
check("unknown does not", isAwaitingBank("weird") === false);
check("the window is 2 minutes of 5 s ticks",
  POLL_INTERVAL_MS === 5000 && POLL_WINDOW_MS === 120000);

console.log("\nstatus text is the server's, colour is the raw status's");
check("server label wins",
  orderStatusLabel({ status: "charged", status_label: "Settled" }) === "Settled");
check("our label is the fallback",
  orderStatusLabel({ status: "charged" }) === "Paid");
check("a renamed label cannot turn failed green",
  orderStatusTone("failed") === "red");
check("charged is green", orderStatusTone("charged") === "green");
check("mismatch is amber, not red", orderStatusTone("mismatch") === "amber");
check("unknown falls back to gray", orderStatusTone("weird") === "gray");

// The two questions are asked of DIFFERENT payloads, which is the whole reason
// they are separate functions. GET pay/links/ (the staff list) sends no
// `enabled` field; GET pay/links/<token>/ (the public page) does. Reading the
// staff list with the payable test hid Cancel from every open link.
console.log("\nis this link still open? (staff list: STATUS only)");
check("open", isLinkOpen({ status: "open" }) === true);
check("open with NO enabled field is still open",
  isLinkOpen({ status: "open", amount_payable: "100" }) === true);
check("paid is not", isLinkOpen({ status: "paid" }) === false);
check("cancelled is not", isLinkOpen({ status: "cancelled" }) === false);
check("expired is not", isLinkOpen({ status: "expired" }) === false);
check("a missing status is not", isLinkOpen({}) === false);

console.log("\ncan money be taken right now? (public page: open AND enabled)");
check("open + enabled", isLinkPayable({ status: "open", enabled: true }) === true);
check("open but gateway off",
  isLinkPayable({ status: "open", enabled: false }) === false);
check("enabled flag missing is NOT payable",
  isLinkPayable({ status: "open" }) === false);
check("paid", isLinkPayable({ status: "paid", enabled: true }) === false);
check("cancelled", isLinkPayable({ status: "cancelled", enabled: true }) === false);
check("expired", isLinkPayable({ status: "expired", enabled: true }) === false);
check("paid says paid",
  linkClosedMessage({ status: "paid" }) === "This link has been paid");
check("cancelled points at accounts",
  linkClosedMessage({ status: "cancelled" }).includes("no longer active"));
check("expired points at accounts",
  linkClosedMessage({ status: "expired" }).includes("no longer active"));
check("an open-but-disabled link does not claim to be paid",
  linkClosedMessage({ status: "open", enabled: false }).includes("no longer active"));

console.log("\ncreated_by is a USER ID and must never be printed as a name");
check("the name field is used",
  linkCreatedBy({ created_by: 42, created_by_name: "Preeti Sharma" }) ===
    "Preeti Sharma");
check("a bare id is refused",
  linkCreatedBy({ created_by: 42 }) === "—", linkCreatedBy({ created_by: 42 }));
check("a numeric string id is refused",
  linkCreatedBy({ created_by: "42" }) === "—");
check("a string username is accepted",
  linkCreatedBy({ created_by: "preeti" }) === "preeti");
check("a nested object is read",
  linkCreatedBy({ created_by: { id: 42, name: "Preeti" } }) === "Preeti");
check("nothing at all → dash", linkCreatedBy({}) === "—");

console.log("\nthe link address is the server's, built only as a last resort");
check("server url wins",
  linkUrl({ url: "https://x.test/pay/abc", token: "abc" }) ===
    "https://x.test/pay/abc");
check("token alone builds from the origin",
  linkUrl({ token: "abc" }) === "https://reports.aajneeti.social/pay/abc",
  linkUrl({ token: "abc" }));
check("neither → null", linkUrl({}) === null);

console.log("\nthe WhatsApp message carries the link and no long dashes");
{
  const msg = decodeURIComponent(
    whatsappShareUrl({
      url: "https://x.test/pay/abc",
      clientName: "Rosemont",
      amountPayable: "11800.00",
      note: "October service charge",
    }).replace("https://wa.me/?text=", ""),
  );
  check("opens the contact picker (no number)",
    whatsappShareUrl({ url: "u" }).startsWith("https://wa.me/?text="));
  check("the url is in the body", msg.includes("https://x.test/pay/abc"));
  check("the client is named", msg.includes("Rosemont"));
  check("the amount is stated", msg.includes("₹11,800.00"), msg);
  check("the note is carried", msg.includes("October service charge"));
  check("no em or en dash anywhere", !/[–—]/.test(msg), msg);
}
{
  const bare = decodeURIComponent(
    whatsappShareUrl({ url: "https://x.test/pay/abc" }).replace(
      "https://wa.me/?text=",
      "",
    ),
  );
  check("a missing amount is omitted, not printed as ₹0",
    !bare.includes("₹"), bare);
  check("a missing name does not print 'undefined'",
    !bare.includes("undefined"), bare);
}

console.log("\nthe post-login redirect refuses anything off-site");
const next = (search) => nextAfterLogin(search);
check("no param → dashboard", next("") === "/dashboard");
check("a relative path is honoured",
  next("?next=%2Fpayment-result%3Forder_id%3DABC") ===
    "/payment-result?order_id=ABC",
  next("?next=%2Fpayment-result%3Forder_id%3DABC"));
check("protocol-relative //evil.test is refused",
  next("?next=%2F%2Fevil.test") === "/dashboard");
check("an absolute url is refused",
  next("?next=https%3A%2F%2Fevil.test") === "/dashboard");
check("a bare path with no slash is refused",
  next("?next=dashboard") === "/dashboard");
check("javascript: is refused", next("?next=javascript%3Aalert(1)") === "/dashboard");

console.log("\nvalid-days bounds match the spec");
check("default 7", VALID_DAYS_DEFAULT === 7);
check("max 30", VALID_DAYS_MAX === 30);

// ════════════ BANK TRANSFER / UPI (backend 27bcdca) ════════════

console.log("\nthe bank tab has its own switch, independent of the gateway");
check("enabled true", isBankEnabled({ enabled: true }) === true);
check("enabled false", isBankEnabled({ enabled: false }) === false);
check("a missing flag keeps it hidden", isBankEnabled({}) === false);
check("null payload", isBankEnabled(null) === false);

console.log("\nthe QR src is built off the API root (verified on prod)");
check("relative path is prefixed with BASE_URL",
  bankQrSrc({ has_qr: true, qr_url: "/billing/pay/bank-details/qr/" }) ===
    "https://metadashboard.aajneeticonnectltd.com/api/billing/pay/bank-details/qr/",
  bankQrSrc({ has_qr: true, qr_url: "/billing/pay/bank-details/qr/" }));
check("a path without a leading slash still joins correctly",
  bankQrSrc({ has_qr: true, qr_url: "billing/pay/bank-details/qr/" }) ===
    "https://metadashboard.aajneeticonnectltd.com/api/billing/pay/bank-details/qr/");
check("an absolute url is passed through, NOT prefixed",
  bankQrSrc({ has_qr: true, qr_url: "https://cdn.test/qr.png" }) ===
    "https://cdn.test/qr.png");
check("has_qr false → nothing to show",
  bankQrSrc({ has_qr: false, qr_url: "/x/" }) === null);
check("has_qr true but no url → nothing to show",
  bankQrSrc({ has_qr: true }) === null);

console.log("\nthe bank minimum is the spec's 50,000, not the online one");
check("50000", BANK_MIN_EX_GST === 50000);

console.log("\nUTR is normalised before it is validated OR sent");
check("spaces stripped and uppercased",
  normaliseUtr("  axis r5202 4110712345 ") === "AXISR52024110712345");
check("a valid UTR passes", utrError("AXISR52024110712345") === null);
check("exactly 10 passes", utrError("ABCDE12345") === null);
check("9 is too short", /between 10 and 40/.test(utrError("ABCDE1234") ?? ""));
check("41 is too long", /between 10 and 40/.test(utrError("A".repeat(41)) ?? ""));
check("40 passes", utrError("A".repeat(40)) === null);
check("punctuation is refused",
  /letters and digits/.test(utrError("ABCDE-12345") ?? ""),
  utrError("ABCDE-12345"));
check("empty asks for one", /Enter the UTR/.test(utrError("") ?? ""));
check("a spaced UTR that is valid once stripped is ACCEPTED",
  utrError("AXIS R520 2411 0712 345") === null,
  utrError("AXIS R520 2411 0712 345"));

console.log("\ntransfer dates: not future, at most 60 days back, LOCAL time");
{
  // A fixed "today" so the test does not drift, and an evening hour: a
  // toISOString()-based bound would roll to tomorrow in IST and call today
  // the future.
  const today = new Date(2026, 10, 19, 23, 30); // 19 Nov 2026, 11:30pm local
  const b = transferDateBounds(today);
  check("max is today in LOCAL time, not UTC", b.max === "2026-11-19", b.max);
  check("min is 60 days back", b.min === "2026-09-20", b.min);
  check("today is accepted", transferDateError("2026-11-19", today) === null);
  check("tomorrow is refused",
    /cannot be in the future/.test(transferDateError("2026-11-20", today) ?? ""));
  check("exactly 60 days back is accepted",
    transferDateError("2026-09-20", today) === null);
  check("61 days back is refused",
    /more than 60 days/.test(transferDateError("2026-09-19", today) ?? ""));
  check("empty asks for a date", /Pick the date/.test(transferDateError("", today) ?? ""));
  check("localDateKey zero-pads",
    localDateKey(new Date(2026, 0, 5)) === "2026-01-05",
    localDateKey(new Date(2026, 0, 5)));
}

console.log("\nproof + QR upload rules");
const file = (type, size) => ({ type, size });
check("a 2 MB jpg proof passes", proofError(file("image/jpeg", 2e6)) === null);
check("a pdf proof passes", proofError(file("application/pdf", 1e6)) === null);
check("a webp proof passes", proofError(file("image/webp", 1e6)) === null);
check("over 3 MB is refused",
  /under 3 MB/.test(proofError(file("image/png", PROOF_MAX_BYTES + 1)) ?? ""));
check("a gif is refused",
  /JPG, PNG, WEBP or PDF/.test(proofError(file("image/gif", 1e3)) ?? ""));
check("no file is fine, it is optional", proofError(null) === null);
check("a pdf QR is refused, it is rendered in an img",
  /JPG, PNG or WEBP/.test(qrError(file("application/pdf", 1e3)) ?? ""));
check("a 1 MB png QR passes", qrError(file("image/png", 1e6)) === null);
check("over 2 MB QR is refused",
  /under 2 MB/.test(qrError(file("image/png", QR_MAX_BYTES + 1)) ?? ""));

console.log("\ntransfer modes and status are a THIRD vocabulary");
check("the five spec values",
  JSON.stringify(TRANSFER_MODES.map((m) => m.value)) ===
    '["neft","rtgs","imps","upi","other"]');
check("the server's mode_label wins",
  transferModeLabel({ mode: "neft", mode_label: "NEFT (SBI)" }) === "NEFT (SBI)");
check("our label is the fallback", transferModeLabel({ mode: "imps" }) === "IMPS");
check("neither → dash", transferModeLabel({}) === "—");
check("pending reads as awaiting a HUMAN, not awaiting a bank",
  transferStatusLabel({ status: "pending" }) === "Pending verification",
  transferStatusLabel({ status: "pending" }));
check("pending is amber", transferStatusTone("pending") === "amber");
check("verified is green", transferStatusTone("verified") === "green");
check("rejected is red", transferStatusTone("rejected") === "red");
check("the server's label wins",
  transferStatusLabel({ status: "verified", status_label: "Confirmed" }) ===
    "Confirmed");

console.log("\nthe reject reason is required and the client reads it");
check("4 characters is too short", rejectReasonError("abcd") !== null);
check("5 characters passes", rejectReasonError("abcde") === null);
check("whitespace does not count", rejectReasonError("   a   ") !== null);
check("the message says the client sees it",
  /client sees it/.test(rejectReasonError("") ?? ""));

console.log("\nmerged history: one row never mixes two sources");
{
  const orders = [
    {
      order_id: "ORD-1",
      created_at: "2026-11-18T10:00:00Z",
      method: "UPI",
      amount_paid: "5900.00",
      credited: "5900.00",
      status: "charged",
    },
  ];
  const transfers = [
    {
      id: 7,
      created_at: "2026-11-19T10:00:00Z",
      transfer_date: "2026-11-17",
      utr: "AXISR5202411",
      mode: "neft",
      mode_label: "NEFT",
      amount_transferred: "59000.00",
      credited: null,
      status: "pending",
      review_note: null,
    },
  ];
  const rows = mergeHistory(orders, transfers);
  check("both sources appear", rows.length === 2);
  check("newest first", rows[0].kind === "transfer" && rows[1].kind === "online");
  check("the transfer row reads amount_TRANSFERRED",
    rows[0].paid === "59000.00");
  check("the order row reads amount_PAID", rows[1].paid === "5900.00");
  check("a pending transfer credits NOTHING and keeps null",
    rows[0].credited === null,
    String(rows[0].credited));
  check("the order's credited is its own", rows[1].credited === "5900.00");
  check("the transfer's reference is its UTR", rows[0].reference === "AXISR5202411");
  check("the order's reference is its order id", rows[1].reference === "ORD-1");
  check("keys do not collide across sources",
    rows[0].key !== rows[1].key);
  check("the transfer keeps its own transfer_date",
    rows[0].transferDate === "2026-11-17");
  check("empty inputs are fine", mergeHistory(null, undefined).length === 0);
  check("one source alone works", mergeHistory(orders, []).length === 1);
}
{
  // A row with no timestamp must still be shown, at the bottom.
  const rows = mergeHistory(
    [{ order_id: "A", created_at: null, amount_paid: "1" }],
    [{ id: 1, created_at: "2026-11-19T10:00:00Z", utr: "U", amount_transferred: "2" }],
  );
  check("an undated row is kept, not dropped", rows.length === 2);
  check("and it sinks to the bottom", rows[1].reference === "A", rows[1].reference);
}

console.log("\nthe 60-day window matches the spec");
check("60", TRANSFER_MAX_DAYS_BACK === 60);

// ════════════ RECONCILIATION REPORT ════════════

console.log("\nthe report range is capped at 92 days, counted inclusively");
check("max is 92", REPORT_MAX_DAYS === 92);
check("the default status is Paid", REPORT_DEFAULT_STATUS === "charged");
check("a one-day range is 1 day, not 0",
  reportRangeError("2026-11-19", "2026-11-19") === null);
check("exactly 92 days is allowed",
  reportRangeError("2026-08-20", "2026-11-19") === null,
  reportRangeError("2026-08-20", "2026-11-19"));
check("93 days is refused",
  /92 days or less/.test(reportRangeError("2026-08-19", "2026-11-19") ?? ""),
  reportRangeError("2026-08-19", "2026-11-19"));
check("the message names the actual span",
  /93 days/.test(reportRangeError("2026-08-19", "2026-11-19") ?? ""),
  reportRangeError("2026-08-19", "2026-11-19"));
check("a reversed range is caught",
  /after the end date/.test(reportRangeError("2026-11-19", "2026-11-01") ?? ""));
check("a missing date is caught", reportRangeError("", "2026-11-19") !== null);
check("a leap-day span counts correctly",
  reportRangeError("2028-02-01", "2028-03-01") === null);

console.log("\nquick picks are built from LOCAL date parts");
{
  // 1 Jan at 11:30pm local: the UTC version of "today" is still 31 Dec, and in
  // IST it would also be the WRONG YEAR.
  const nye = new Date(2027, 0, 1, 23, 30);
  const p = Object.fromEntries(reportQuickPicks(nye).map((x) => [x.key, x]));
  check("Today is today, not yesterday in UTC",
    p.today.from === "2027-01-01" && p.today.to === "2027-01-01",
    JSON.stringify(p.today));
  check("Yesterday crosses the year boundary correctly",
    p.yesterday.from === "2026-12-31" && p.yesterday.to === "2026-12-31",
    JSON.stringify(p.yesterday));
  check("This month runs from the 1st to today",
    p.this_month.from === "2027-01-01" && p.this_month.to === "2027-01-01",
    JSON.stringify(p.this_month));
  check("Last month is the WHOLE of last month",
    p.last_month.from === "2026-12-01" && p.last_month.to === "2026-12-31",
    JSON.stringify(p.last_month));
}
{
  // A 31-day month following a 30-day one, to catch an end-of-month slip.
  const d = new Date(2026, 6, 15); // 15 Jul 2026
  const p = Object.fromEntries(reportQuickPicks(d).map((x) => [x.key, x]));
  check("Last month ends on the 30th for June",
    p.last_month.from === "2026-06-01" && p.last_month.to === "2026-06-30",
    JSON.stringify(p.last_month));
  check("every quick pick is inside the 92-day cap",
    reportQuickPicks(d).every((x) => reportRangeError(x.from, x.to) === null));
}
{
  const r = reportDefaultRange(new Date(2026, 10, 19));
  check("the default range is the 1st to today",
    r.from === "2026-11-01" && r.to === "2026-11-19", JSON.stringify(r));
}

console.log("\nthe date column shows WHICH date, because the server mixes them");
check("a paid order uses paid_on",
  effectiveOrderDate({ paid_on: "2026-11-18T10:00:00Z", created_at: "2026-11-17T09:00:00Z" })
    .field === "paid_on");
check("an unpaid order falls back to created_at AND says so",
  effectiveOrderDate({ paid_on: null, created_at: "2026-11-17T09:00:00Z" }).field ===
    "created_at");
check("the fallback carries the created value",
  effectiveOrderDate({ created_at: "2026-11-17T09:00:00Z" }).value ===
    "2026-11-17T09:00:00Z");
check("neither → no field, so the cell cannot claim a date it has not got",
  effectiveOrderDate({}).field === null);

console.log("\nsorting is newest first on the date the server filtered by");
{
  const rows = [
    { order_id: "A", paid_on: "2026-11-10T10:00:00Z" },
    { order_id: "B", paid_on: null, created_at: "2026-11-18T10:00:00Z" },
    { order_id: "C", paid_on: "2026-11-15T10:00:00Z" },
    { order_id: "D" },
  ];
  const s = sortReportRows(rows).map((r) => r.order_id);
  check("newest first across BOTH date fields",
    JSON.stringify(s.slice(0, 3)) === '["B","C","A"]', JSON.stringify(s));
  check("an undated row is kept, not dropped", s.length === 4);
  check("and sinks to the bottom", s[3] === "D", JSON.stringify(s));
  check("the input array is not mutated",
    rows[0].order_id === "A", JSON.stringify(rows.map((r) => r.order_id)));
}

console.log("\nkind reads as the two things the desk calls them");
check("client → Pay now", orderKindLabel({ kind: "client" }) === "Pay now");
check("link → Link", orderKindLabel({ kind: "link" }) === "Link");
check("missing → dash", orderKindLabel({}) === "—");

console.log("\nby_method is an OBJECT, not a list");
{
  const m = readByMethod({
    by_method: { card: { count: 2, paid: "1000.00" }, upi: { count: 9, paid: "9000.00" } },
  });
  check("both rails appear", m.length === 2);
  check("biggest first", m[0].method === "upi", JSON.stringify(m.map((x) => x.method)));
  check("the label is title-cased", m[0].label === "Upi");
  check("net_banking title-cases across the underscore",
    readByMethod({ by_method: { net_banking: { count: 1, paid: "5" } } })[0].label ===
      "Net Banking");
  check("a missing block is empty, not a crash", readByMethod({}).length === 0);
  check("a non-object block is empty", readByMethod({ by_method: [] }).length === 0);
}

console.log("\nthe CSV is for a spreadsheet, so amounts are PLAIN numbers");
{
  const row = {
    order_id: "ORD-1",
    client: "Rosemont",
    paid_on: "2026-11-18T10:05:00Z",
    created_at: "2026-11-18T09:00:00Z",
    method: "UPI",
    bank_ref: "HDFC998877",
    kind: "client",
    amount_paid: "5900.00",
    tds_amount: "0.00",
    credited: "5900.00",
    status: "charged",
    status_label: "Charged",
  };
  const cells = reportRowToCsv(row);
  check("the column count matches the header",
    cells.length === REPORT_CSV_COLUMNS.length,
    `${cells.length} vs ${REPORT_CSV_COLUMNS.length}`);
  check("amounts carry no ₹ and no grouping",
    cells.includes("5900") || cells.includes("5900.00"), JSON.stringify(cells));
  check("no rupee sign anywhere in the row",
    !cells.join(",").includes("₹"), JSON.stringify(cells));
  check("a real 0 is written as 0, not blank",
    cells[REPORT_CSV_COLUMNS.indexOf("TDS")] === "0", JSON.stringify(cells));
  check("the date field is named so a created date cannot pass as paid",
    cells[REPORT_CSV_COLUMNS.indexOf("Date field")] === "paid_on",
    JSON.stringify(cells));
}
{
  const cells = reportRowToCsv({ order_id: "ORD-2", created_at: "2026-11-18T09:00:00Z" });
  check("an unpaid row is marked created_at in the CSV",
    cells[REPORT_CSV_COLUMNS.indexOf("Date field")] === "created_at",
    JSON.stringify(cells));
  check("a MISSING amount is an empty cell, not 0",
    cells[REPORT_CSV_COLUMNS.indexOf("Amount received")] === "",
    JSON.stringify(cells));
  check("and never a dash, which a spreadsheet cannot sum",
    !cells.join(",").includes("—"), JSON.stringify(cells));
}
{
  // A client name with a comma and a quote is the classic CSV corruption.
  const csv = buildReportCsv([
    { order_id: "A", client: 'Lions "Property", Delhi', amount_paid: "1.50" },
  ]);
  const lines = csv.split("\r\n");
  check("the header is the column list",
    lines[0].startsWith("Paid on,Date field,Client"), lines[0]);
  check("a comma in a name is quoted",
    lines[1].includes('"Lions ""Property"", Delhi"'), lines[1]);
  check("rows are CRLF separated", csv.includes("\r\n"));
  check("an empty row list still writes a header",
    buildReportCsv([]).split("\r\n").length === 1);
}
check("the file name carries the range",
  reportCsvFilename("2026-11-01", "2026-11-19") ===
    "online-payments_2026-11-01_2026-11-19.csv",
  reportCsvFilename("2026-11-01", "2026-11-19"));

console.log(
  failures === 0
    ? "\nAll online-payment checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
