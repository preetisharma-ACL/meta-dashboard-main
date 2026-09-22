// Verifies the campaign footer arithmetic against the shapes
// GET /api/campaigns/insights/bulk/ actually sends.
// Run: node scripts/verify-campaign-totals.mjs
//
// Why this exists: a footer total is a three-line reduce, which is the kind of
// code that reads correctly and is wrong. Two properties of the payload break a
// naive sum and neither is going away:
//
//   • money is serialised as a STRING ("3595.03"), so `0 + row.spend` is the
//     string "03595.03" and every later addition concatenates onto it;
//   • a campaign that did not deliver has NO ROW, so anything reaching for a
//     value per campaign gets undefined, and `undefined + 18` is NaN — which
//     takes out leads, an int column with no type problem of its own.
//
// It imports the REAL module — no copied logic to drift — and checks it against
// project 175 on 21 Sep 2026: 84 campaigns, 13 with rows, footer leads 25,
// spend ₹6,030.35, avg CPL ₹241.21.

import {
  toNumber,
  rawSpendOf,
  sumInsightRows,
  cplFrom,
} from "../src/services/campaignTotals.js";

let failures = 0;
const group = (name) => console.log(`\n${name}`);
const check = (name, actual, expected) => {
  const ok = Object.is(actual, expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name}` +
      (ok ? "" : `\n          expected ${expected}, got ${actual}`),
  );
};

// ── The day itself ──────────────────────────────────────────────────────────
// 13 rows across 84 campaigns, decimals as strings, exactly as served. The
// leads add to 25 and the spend to 6030.35.
const ROWS = [
  { campaign_id: 901, date: "2026-09-21", leads: 4, clicks: 118, impressions: 9021, spend: "1203.11" },
  { campaign_id: 902, date: "2026-09-21", leads: 3, clicks: 96, impressions: 7740, spend: "812.40" },
  { campaign_id: 903, date: "2026-09-21", leads: 3, clicks: 77, impressions: 6110, spend: "744.02" },
  { campaign_id: 904, date: "2026-09-21", leads: 2, clicks: 64, impressions: 5233, spend: "596.18" },
  { campaign_id: 905, date: "2026-09-21", leads: 2, clicks: 51, impressions: 4187, spend: "521.73" },
  { campaign_id: 906, date: "2026-09-21", leads: 2, clicks: 49, impressions: 3908, spend: "480.55" },
  { campaign_id: 907, date: "2026-09-21", leads: 2, clicks: 44, impressions: 3502, spend: "437.90" },
  { campaign_id: 908, date: "2026-09-21", leads: 2, clicks: 38, impressions: 3011, spend: "398.64" },
  { campaign_id: 909, date: "2026-09-21", leads: 1, clicks: 31, impressions: 2456, spend: "301.22" },
  { campaign_id: 910, date: "2026-09-21", leads: 1, clicks: 27, impressions: 2104, spend: "218.09" },
  { campaign_id: 911, date: "2026-09-21", leads: 1, clicks: 22, impressions: 1877, spend: "154.71" },
  { campaign_id: 912, date: "2026-09-21", leads: 1, clicks: 19, impressions: 1502, spend: "101.80" },
  { campaign_id: 913, date: "2026-09-21", leads: 1, clicks: 14, impressions: 1190, spend: "60.00" },
];
const CAMPAIGN_IDS = Array.from({ length: 84 }, (_, i) => 901 + i); // 71 have no row
const money = (n) => Number(n.toFixed(2));

group("the reported footer, from the payload as served");
{
  // The page groups rows per campaign and sums each campaign's set — so the 71
  // silent campaigns are summed too, over nothing.
  const byCampaign = new Map();
  for (const row of ROWS) {
    if (!byCampaign.has(row.campaign_id)) byCampaign.set(row.campaign_id, []);
    byCampaign.get(row.campaign_id).push(row);
  }

  let leads = 0;
  let spend = 0;
  for (const id of CAMPAIGN_IDS) {
    const stats = sumInsightRows(byCampaign.get(id)); // undefined for 71 of 84
    leads += stats.leads;
    spend += stats.spend;
  }

  check("leads total is 25", leads, 25);
  check("spend total is 6030.35", money(spend), 6030.35);
  check("avg CPL is 241.21", cplFrom(spend, leads).toFixed(2), "241.21");
  check("spend stayed a number", typeof spend, "number");
  check("leads stayed a number", typeof leads, "number");
}

group("strings never become string concatenation");
{
  const s = sumInsightRows([{ spend: "3595.03" }, { spend: "1000.00" }]);
  check("two string decimals add", money(s.spend), 4595.03);
  check("one string decimal is its number", rawSpendOf({ spend: "3595.03" }), 3595.03);
  // The failure this replaces, spelled out: a bare + on the first row already
  // turns the running total into a string, and it never recovers.
  check("a naive sum concatenates instead", 0 + "3595.03", "03595.03");
  check("and keeps concatenating", 0 + "3595.03" + "1000.00", "03595.031000.00");
  // Leads are ints today, but they come off the same serialiser as spend.
  const l = sumInsightRows([{ leads: "18" }, { leads: "7" }]);
  check("string leads add as numbers", l.leads, 25);
}

group("a campaign with no row contributes zero, not NaN");
{
  check("undefined rows", sumInsightRows(undefined).leads, 0);
  check("null rows", sumInsightRows(null).spend, 0);
  check("empty rows", sumInsightRows([]).spend, 0);
  const s = sumInsightRows([{ leads: 18 }, {}, { leads: undefined }, null]);
  check("missing keys and null rows are skipped", s.leads, 18);
  check("and the spend beside them is 0", s.spend, 0);
  check("absent reads as zero", toNumber(undefined), 0);
  check("unparseable reads as zero", toNumber("n/a"), 0);
  check("null reads as zero", toNumber(null), 0);
  check('"" reads as zero', toNumber(""), 0);
}

group("spend_raw wins for a raw total when the row carries both");
{
  check("preview row uses spend_raw", rawSpendOf({ spend: "500.00", spend_raw: "400.00" }), 400);
  check("a client's own row uses spend", rawSpendOf({ spend: "500.00" }), 500);
  check("spend_raw of 0 is not skipped", rawSpendOf({ spend: "500.00", spend_raw: "0.00" }), 0);
}

group("CPL is the ratio of the totals, never an average of the rates");
{
  // Two campaigns, wildly different volumes: 1 lead at ₹500 and 200 at ₹100.
  const rows = [
    { leads: 1, spend: "500.00" },
    { leads: 200, spend: "20000.00" },
  ];
  const s = sumInsightRows(rows);
  // ₹20,500 over 201 leads.
  check("Σ spend ÷ Σ leads", money(cplFrom(s.spend, s.leads)), 101.99);
  // The mean of the per-row rates is (500 + 100) / 2 = 300 — three times the
  // real cost per lead, on the strength of one campaign with one lead in it.
  check("the mean of the rates would be 300", (500 + 100) / 2, 300);
  check("no leads is 0, not a division by zero", cplFrom(1234.5, 0), 0);
  check("no leads and no spend is 0", cplFrom(0, 0), 0);
}

console.log(
  failures === 0
    ? "\nAll checks passed."
    : `\n${failures} check${failures === 1 ? "" : "s"} FAILED.`,
);
process.exit(failures === 0 ? 0 : 1);
