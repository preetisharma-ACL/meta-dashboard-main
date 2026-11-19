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

console.log(
  failures === 0
    ? "\nAll online-payment checks passed.\n"
    : `\n${failures} check(s) FAILED.\n`,
);
process.exit(failures === 0 ? 0 : 1);
