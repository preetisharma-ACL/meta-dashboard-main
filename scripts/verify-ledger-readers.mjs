// Verifies the two /dashboard/ledger/ decoders against the payload shapes the
// backend actually sends. Run: node scripts/verify-ledger-readers.mjs
//
// Why this exists: the privileged payload carries `spend` / `cpl` (RAW agency
// cost) and the client payload carries `premium_spend` / `premium_cpl` with the
// raw keys ABSENT. Reading a client payload with the privileged decoder would
// total ₹0; reading a privileged payload with the client decoder would do the
// same. Both are visible failures by design — but only if the mapping stays
// correct, and a silent regression here puts either agency cost on a client's
// screen or nothing at all on anyone's.
//
// It imports the REAL service module — no copied logic to drift out of date.
// The browser globals below are shims so api.js can be imported under Node.

import { registerHooks } from "node:module";

// Vite resolves extensionless relative imports ("../api/api"); Node does not.
// One resolve hook keeps the script able to import the REAL module.
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
globalThis.window ??= { dispatchEvent: () => {}, addEventListener: () => {} };
globalThis.atob ??= (b) => Buffer.from(b, "base64").toString("binary");

const { readDashboardLedger, readClientLedger, EMPTY_LEDGER } =
  await import("../src/services/dashboard.js");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " " + extra}`);
  if (!cond) failures++;
};

// Every field the two payloads share, with the campaign counts un-date-filtered.
const common = {
  project_id: 42,
  project_name: "SKAImperia",
  meta_leads: 6017,
  fed_leads: 221,
  total_leads: 6238,
  replaced_leads: 64,
  billable_leads: 6174,
  impressions: 1_250_000,
  clicks: 18_400,
  campaigns_total: 11,
  campaigns_active: 4,
  campaigns_paused: 6,
  campaigns_completed: 1,
};

const envelope = (row, totals) => ({
  success: true,
  data: {
    rows: [row],
    totals: { ...totals, project_count: 1 },
    date_range: { start: "2026-08-01", end: "2026-08-20" },
    scope: "1 nomens",
  },
});

// ── Privileged: spend / cpl are the RAW agency cost ─────────────────────────
console.log("\nprivileged payload → readDashboardLedger");
{
  const raw = { ...common, spend: "3320.60", cpl: "0.55" };
  const led = readDashboardLedger(envelope(raw, raw));
  const row = led.byProject["42"];

  check("spend read from `spend`", row.spend === 3320.6, `(${row.spend})`);
  check("cpl read from `cpl`", row.cpl === 0.55, `(${row.cpl})`);
  check("string money coerced to Number", typeof row.spend === "number");
  check("totals decoded the same way", led.totals.spend === 3320.6);
  check("loaded + settled", led.loaded === true && led.settled === true);
}

// ── Client: premium_spend / premium_cpl, raw keys ABSENT ────────────────────
console.log("\nclient payload → readClientLedger");
{
  const client = { ...common, premium_spend: "4316.79", premium_cpl: "0.72" };
  check(
    "fixture matches the backend: no raw keys present",
    !("spend" in client) && !("cpl" in client) && !("spend_raw" in client),
  );

  const led = readClientLedger(envelope(client, client));
  const row = led.byProject["42"];

  check(
    "premium_spend → the row's spend (what statsFromLedger maps to totalSpent)",
    row.spend === 4316.79,
    `(${row.spend})`,
  );
  check(
    "premium_cpl → the row's cpl (→ avgCPL; a client has no separate Premium CPL)",
    row.cpl === 0.72,
    `(${row.cpl})`,
  );
  check("totals decoded the same way", led.totals.spend === 4316.79);

  // The lead identity the ledger table prints: fed is INSIDE total, never added.
  check(
    "meta + fed === total, as returned",
    row.metaLeads + row.fedLeads === row.totalLeads,
    `(${row.metaLeads} + ${row.fedLeads} !== ${row.totalLeads})`,
  );
  check(
    "billable === total − replaced, as returned",
    row.billableLeads === row.totalLeads - row.replacedLeads,
  );
  check(
    "campaign counts survive intact (they drive project status)",
    row.campaignsTotal === 11 &&
      row.campaignsActive === 4 &&
      row.campaignsPaused === 6 &&
      row.campaignsCompleted === 1,
  );
  check(
    "impressions + clicks carried (the funnel reads them)",
    row.impressions === 1_250_000 && row.clicks === 18_400,
  );
}

// ── Crossing the decoders must fail LOUDLY (₹0), never quietly ──────────────
console.log("\nwrong decoder → a visible zero, not a plausible number");
{
  const client = { ...common, premium_spend: "4316.79", premium_cpl: "0.72" };
  const wrong = readDashboardLedger(envelope(client, client)).byProject["42"];
  check(
    "client payload through the privileged decoder totals 0",
    wrong.spend === 0,
  );
  check("...and its cpl is null, not a number", wrong.cpl === null);

  const raw = { ...common, spend: "3320.60", cpl: "0.55" };
  const other = readClientLedger(envelope(raw, raw)).byProject["42"];
  check(
    "privileged payload through the client decoder totals 0",
    other.spend === 0,
  );
  check("...and its cpl is null, not a number", other.cpl === null);
}

// ── cpl null vs 0 ───────────────────────────────────────────────────────────
console.log("\nnull cpl stays null (0 would read as free leads)");
{
  const noLeads = {
    ...common,
    meta_leads: 0,
    fed_leads: 0,
    total_leads: 0,
    premium_spend: "0.00",
    premium_cpl: null,
  };
  const row = readClientLedger(envelope(noLeads, noLeads)).byProject["42"];
  check("premium_cpl null → cpl null", row.cpl === null, `(${row.cpl})`);
  check("spend still 0, not null", row.spend === 0);
}

// ── The placeholder ─────────────────────────────────────────────────────────
console.log("\nEMPTY_LEDGER is a placeholder, not data");
{
  check("not loaded", EMPTY_LEDGER.loaded === false);
  check(
    "not settled — nothing may animate to it",
    EMPTY_LEDGER.settled === false,
  );
  check("zeroed totals", EMPTY_LEDGER.totals.spend === 0);
  check("no rows", EMPTY_LEDGER.rows.length === 0);
}

// ── Envelope robustness ─────────────────────────────────────────────────────
console.log("\nmalformed envelopes degrade instead of throwing");
{
  for (const [name, input] of [
    ["undefined", undefined],
    ["null data", { data: null }],
    ["rows not an array", { data: { rows: "nope" } }],
    ["no totals", { data: { rows: [] } }],
  ]) {
    let ok = true;
    try {
      const led = readClientLedger(input);
      ok = led.rows.length === 0 && led.totals.spend === 0;
    } catch {
      ok = false;
    }
    check(`${name} → empty rows, zero totals`, ok);
  }
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
