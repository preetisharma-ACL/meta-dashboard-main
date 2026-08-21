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
  // Node refuses to load ".jsx". Columnsorting.jsx is a plain hook with no JSX
  // syntax in it, so treating it as an ES module is enough to import the real
  // sorter. If someone puts actual JSX in there, this fails loudly — which is
  // the right outcome, not a silent skip.
  load(url, context, nextLoad) {
    if (url.endsWith(".jsx")) {
      return nextLoad(url, { ...context, format: "module" });
    }
    return nextLoad(url, context);
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

const { readDashboardLedger, readClientLedger, premiumRollup, EMPTY_LEDGER } =
  await import("../src/services/dashboard.js");

let failures = 0;
const check = (name, cond, extra = "") => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : " " + extra}`);
  if (!cond) failures++;
};

// Renders a sorted result as "188.28,—,9.5" so a failure shows the actual order.
const fmtSort = (out) =>
  `(${out.map((r) => (r.modifiedCpl == null ? "—" : r.modifiedCpl)).join(",")})`;

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

// ── Privileged: spend / cpl are the RAW agency cost, premium_* sits beside it ─
console.log("\nprivileged payload → readDashboardLedger");
{
  // NoidaEvent, from the live admin payload: raw 126.69 → premium 188.28.
  const raw = {
    ...common,
    spend: "3320.60",
    cpl: "126.69",
    premium_spend: "282224.28",
    premium_cpl: "188.28",
  };
  const led = readDashboardLedger(envelope(raw, raw));
  const row = led.byProject["42"];

  check("spend read from `spend`", row.spend === 3320.6, `(${row.spend})`);
  check("cpl read from `cpl`", row.cpl === 126.69, `(${row.cpl})`);
  check("string money coerced to Number", typeof row.spend === "number");
  check(
    "premium_cpl → premiumCpl (what the Premium CPL column renders)",
    row.premiumCpl === 188.28,
    `(${row.premiumCpl})`,
  );
  check(
    "premium_spend → premiumSpend",
    row.premiumSpend === 282224.28,
    `(${row.premiumSpend})`,
  );
  check(
    "raw and premium stay DISTINCT — neither overwrites the other",
    row.cpl === 126.69 && row.premiumCpl === 188.28,
  );
  check("totals decoded the same way", led.totals.spend === 3320.6);
  check("loaded + settled", led.loaded === true && led.settled === true);
}

// ── The Daily Report row that was wrong three ways ──────────────────────────
// DholeraEvent / Emperor Home Solution, 1–21 Aug 2026. The old page showed
// 621 generated, −40 replaced, 381 billable and ₹1,12,431.59 spend: generated
// came from date-filtered insight rows (which leaked a July block), replaced and
// billable came from a different endpoint over a different window, and the spend
// matched neither the raw nor the client-facing figure. One payload row makes
// all of that arithmetically impossible, so the row is pinned here.
console.log("\nDholeraEvent: one row, one period, one lead set");
{
  const row = {
    project_id: 501,
    project_name: "DholeraEvent",
    meta_leads: 183,
    fed_leads: 199,
    total_leads: 382,
    replaced_leads: 40,
    billable_leads: 342,
    impressions: 0,
    clicks: 0,
    campaigns_total: 3,
    campaigns_active: 1,
    campaigns_paused: 2,
    campaigns_completed: 0,
    spend: "35819.60",
    cpl: "195.74",
    premium_spend: "71816.00",
    premium_leads: 382,
    premium_cpl: "187.99",
  };
  const r = readDashboardLedger(envelope(row, row)).byProject["501"];

  check(
    "fed leads are ADDITIVE: meta + fed = total (183 + 199 = 382)",
    r.metaLeads + r.fedLeads === r.totalLeads && r.totalLeads === 382,
    `(${r.metaLeads} + ${r.fedLeads} = ${r.totalLeads})`,
  );
  check(
    "the subtraction on screen holds: total − replaced = billable",
    r.totalLeads - r.replacedLeads === r.billableLeads,
    `(${r.totalLeads} − ${r.replacedLeads} ≠ ${r.billableLeads})`,
  );
  check(
    "generated and billable come from the SAME lead set",
    r.billableLeads === 342,
    `(${r.billableLeads})`,
  );
  check("raw spend is the agency cost", r.spend === 35819.6, `(${r.spend})`);
  check(
    "client-facing spend is the premium figure",
    r.premiumSpend === 71816,
    `(${r.premiumSpend})`,
  );
  check(
    "neither is the 1,12,431.59 the old pipeline produced",
    r.spend !== 112431.59 && r.premiumSpend !== 112431.59,
  );
}

// ── Missing premium is legitimate and must stay null, never 0 ───────────────
// ~299 of 448 live rows have no premium: retainer clients have no display config
// by design, and some client+project pairs are missing one. A 0 there would
// claim the client was billed nothing.
console.log("\nrows with no premium → null, not 0");
{
  const noPremium = {
    ...common,
    spend: "3320.60",
    cpl: "126.69",
    premium_spend: null,
    premium_cpl: null,
  };
  const row = readDashboardLedger(envelope(noPremium, noPremium)).byProject[
    "42"
  ];
  check("premium_cpl null → premiumCpl null", row.premiumCpl === null);
  check("premium_spend null → premiumSpend null", row.premiumSpend === null);
  check("raw side unaffected", row.cpl === 126.69 && row.spend === 3320.6);

  // The key absent entirely, not just null.
  const absent = { ...common, spend: "1", cpl: "1" };
  const row2 = readDashboardLedger(envelope(absent, absent)).byProject["42"];
  check("premium keys absent → null, not 0", row2.premiumCpl === null);
}

// ── A client never gets a second premium figure to compare against itself ───
console.log("\nclient rows carry no separate premium pair");
{
  const client = { ...common, premium_spend: "4316.79", premium_cpl: "0.72" };
  const row = readClientLedger(envelope(client, client)).byProject["42"];
  check("premiumCpl null on a client row", row.premiumCpl === null);
  check("premiumSpend null on a client row", row.premiumSpend === null);
  check("...while spend/cpl carry the premium figures", row.spend === 4316.79);
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

// ── The footer's premium roll-up ────────────────────────────────────────────
console.log("\npremiumRollup: Σ spend ÷ Σ premium LEADS");
{
  // The trap this guards: premium leads differ from Meta leads for a CPL
  // client, who is billed on their own lead basis. Divide by the wrong
  // denominator and the answer is plausible and quietly wrong, so the fixture
  // makes the two disagree sharply.
  const rows = [
    { premiumSpend: 282224.28, premiumLeads: 1499, metaLeads: 2228 }, // CPL
    { premiumSpend: 100000, premiumLeads: 500, metaLeads: 500 }, // hybrid
    { premiumSpend: null, premiumLeads: null, metaLeads: 900 }, // retainer
    { premiumSpend: null, premiumLeads: null, metaLeads: 40 }, // config missing
  ];

  const got = premiumRollup(rows);
  const expected = Number(((282224.28 + 100000) / (1499 + 500)).toFixed(2));

  check(
    "spend sums only priced rows",
    got.spend === 382224.28,
    `(${got.spend})`,
  );
  check("leads sum only priced rows", got.leads === 1999, `(${got.leads})`);
  check("cpl = Σ spend ÷ Σ leads", got.cpl === expected, `(${got.cpl})`);
  check(
    "covered counts the priced rows",
    got.covered === 2,
    `(${got.covered})`,
  );

  // Would the wrong denominator have been caught? Σ meta_leads is 2728.
  const wrong = Number((382224.28 / 2728).toFixed(2));
  check(
    "dividing by META leads gives a DIFFERENT number (so this test bites)",
    wrong !== got.cpl,
    `(${wrong} vs ${got.cpl})`,
  );

  // Not the average of per-row CPLs either — that is a third, wrong number.
  const meanOfCpls = Number(((282224.28 / 1499 + 100000 / 500) / 2).toFixed(2));
  check(
    "not the mean of per-row CPLs",
    meanOfCpls !== got.cpl,
    `(${meanOfCpls} vs ${got.cpl})`,
  );

  const none = premiumRollup([
    { premiumSpend: null, premiumLeads: null },
    { premiumSpend: null, premiumLeads: null },
  ]);
  check(
    "no priced rows → cpl null, not 0",
    none.cpl === null && none.covered === 0,
  );
  check("empty input → cpl null", premiumRollup([]).cpl === null);
  check("undefined input → cpl null", premiumRollup().cpl === null);

  // Spend present but zero leads: real billed money, nothing to divide by.
  const noLeads = premiumRollup([{ premiumSpend: 500, premiumLeads: 0 }]);
  check(
    "spend with 0 premium leads → cpl null, spend still counted",
    noLeads.cpl === null && noLeads.spend === 500 && noLeads.covered === 1,
  );

  // A half-populated row is not usable in a weighted average.
  const half = premiumRollup([{ premiumSpend: 500, premiumLeads: null }]);
  check(
    "spend without leads is skipped, not counted at an unknown rate",
    half.covered === 0 && half.spend === 0,
  );
}

// ── The rollup reads what the decoder wrote — end to end ────────────────────
console.log("\ndecoder → rollup, no hand-wiring in between");
{
  const mk = (id, spend, leads) => ({
    ...common,
    project_id: id,
    spend: "1",
    cpl: "1",
    premium_spend: spend,
    premium_leads: leads,
    premium_cpl: spend == null ? null : String(Number(spend) / Number(leads)),
  });
  const led = readDashboardLedger({
    data: {
      rows: [mk(1, "282224.28", 1499), mk(2, "100000", 500), mk(3, null, null)],
      totals: {},
    },
  });
  const got = premiumRollup(led.rows);
  check(
    "premium_leads survives the decoder into the rollup",
    got.leads === 1999,
    `(${got.leads})`,
  );
  check("covered = 2 of 3 rows", got.covered === 2, `(${got.covered})`);
  check(
    "rollup cpl matches Σ/Σ of the decoded rows",
    got.cpl === Number((382224.28 / 1999).toFixed(2)),
    `(${got.cpl})`,
  );
}

// ── Sorting a column that holds numbers AND blanks ──────────────────────────
// The Premium CPL column is the first to mix real numbers with nulls. The shared
// sorter's string fallback compares "" against "188.28", which scatters the
// blanks through the middle of a numeric order — so blanks now sort last in both
// directions. This imports the real hook, same as the readers above.
console.log("\nPremium CPL sorts numerically, blanks last");
{
  const { default: useColumnSort } =
    await import("../src/components/Columnsorting.jsx");
  const { handleSort, sortData } = useColumnSort();
  handleSort("modifiedCpl"); // first click on a numeric column → desc

  // Enough rows, interleaved, that an inconsistent comparator cannot land the
  // right answer by luck — the old code sorted number-vs-number numerically and
  // number-vs-null as text, which V8's sort resolves differently depending on
  // where the blanks start out.
  const rows = [
    { name: "a", modifiedCpl: 188.28 },
    { name: "b", modifiedCpl: null },
    { name: "c", modifiedCpl: 9.5 },
    { name: "d", modifiedCpl: 208.18 },
    { name: "e", modifiedCpl: null },
    { name: "f", modifiedCpl: 134.44 },
    { name: "g", modifiedCpl: null },
    { name: "h", modifiedCpl: 1017.5 },
  ];

  // The two invariants, asserted as properties rather than as one expected
  // permutation: blanks form an unbroken tail, and the values ahead of them are
  // in numeric order.
  const blanksLast = (out) => {
    const firstBlank = out.findIndex((r) => r.modifiedCpl == null);
    if (firstBlank === -1) return true;
    return out.slice(firstBlank).every((r) => r.modifiedCpl == null);
  };
  const ordered = (out, dir) => {
    const nums = out
      .filter((r) => r.modifiedCpl != null)
      .map((r) => r.modifiedCpl);
    return nums.every(
      (v, i) =>
        i === 0 || (dir === "asc" ? nums[i - 1] <= v : nums[i - 1] >= v),
    );
  };

  const desc = sortData(rows);
  check("desc: blanks form an unbroken tail", blanksLast(desc), fmtSort(desc));
  check(
    "desc: values in numeric order (9.5 below 188.28, not above it as text)",
    ordered(desc, "desc"),
    fmtSort(desc),
  );

  handleSort("modifiedCpl"); // second click → asc
  const asc = sortData(rows);
  check("asc: blanks STILL a tail, not a head", blanksLast(asc), fmtSort(asc));
  check("asc: values in numeric order", ordered(asc, "asc"), fmtSort(asc));

  // Text columns must be untouched by the change.
  const { handleSort: hs2, sortData: sd2 } = useColumnSort();
  hs2("name");
  const names = sd2([
    { name: "Rosemont" },
    { name: "" },
    { name: "DLFMagnolias" },
  ]).map((r) => r.name);
  check(
    "text column: empty string still sorts as text, first in asc",
    names[0] === "",
    `(${JSON.stringify(names)})`,
  );
}

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
