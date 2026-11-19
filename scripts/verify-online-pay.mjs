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

console.log(
  failures === 0
    ? "\nAll online-payment checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
