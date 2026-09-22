// campaignTotals.js — the arithmetic behind a campaign table's footer.
//
// Every footer total on a campaign table is a sum over rows from
// GET /api/campaigns/insights/bulk/, which the endpoint expects the frontend to
// add up itself. Two properties of that payload break a naive sum, and both are
// permanent:
//
//   1. MONEY ARRIVES AS A STRING. DRF serialises decimals that way, so a row
//      reads spend: "3595.03". `0 + "3595.03"` is the string "03595.03"; the
//      running total stops being a number and every later addition concatenates
//      onto it. The backend keeps sending strings deliberately — moving
//      decimals to floats would change every money value on the platform — so
//      the coercion belongs here, at the one place that does the arithmetic.
//
//   2. A CAMPAIGN WITH NO ACTIVITY HAS NO ROW AT ALL. The endpoint returns rows
//      only for campaigns that delivered: project 175 had 13 rows covering 84
//      campaigns on 21 Sep 2026. Anything that reaches for a value per campaign
//      gets undefined for the other 71, and `undefined + 18` is NaN — which
//      takes out an integer column like leads that never had a type problem of
//      its own.
//
// So: coerce on the way in, treat absent as zero, and never total by reaching
// for a value that may not be there. Extracted from ProjectDetails and imported
// rather than copied, because a footer sum is exactly the three-line derivation
// that reads fine and is wrong — scripts/verify-campaign-totals.mjs asserts THIS
// module against a real day's payload shapes.

// Absent, null, "" and anything unparseable are all zero. A row that carries no
// leads did not deliver any; there is no "unknown" in a sum.
export const toNumber = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// The spend a RAW total adds. Admin/CM rows fetched in preview-as-client mode
// (as_client_id) carry both `spend` — client-facing, markup / fixed-CPL applied
// — and `spend_raw`, the actual Meta charge, so the raw total takes spend_raw
// when it is there. A client's own rows have no spend_raw and their `spend` is
// already the billed figure. Premium/marked-up totals are not built from this;
// they come from the server-computed premium_metrics.
export const rawSpendOf = (row) =>
  toNumber(row?.spend_raw != null ? row.spend_raw : row?.spend);

// Sum a set of insight rows. Takes whatever it is handed — undefined, [], rows
// with keys missing — and always returns four numbers.
export const sumInsightRows = (rows) => {
  const totals = { leads: 0, clicks: 0, reach: 0, spend: 0 };
  for (const row of rows || []) {
    totals.leads += toNumber(row?.leads);
    totals.clicks += toNumber(row?.clicks);
    totals.reach += toNumber(row?.impressions);
    totals.spend += rawSpendOf(row);
  }
  return totals;
};

// CPL is ALWAYS Σ spend ÷ Σ leads — never the mean of the rows' own cpl values.
// Per-campaign lead counts differ by orders of magnitude, so averaging the
// per-row rates weights a campaign that produced one lead the same as one that
// produced two hundred. The endpoint sends a per-row cpl as a string too; it is
// there to display on its own row, not to be added up.
//
// Returns an exact number. Callers round for display — the footer to a fixed-2
// string, the per-row column to a 2dp number — so no total is rounded twice.
export const cplFrom = (spend, leads) => {
  const l = toNumber(leads);
  return l > 0 ? toNumber(spend) / l : 0;
};
