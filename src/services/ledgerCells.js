// ── One named key per cell ───────────────────────────────────────────────────
// The shared reader behind /daily-reports and /cm-daily-report. Both pages draw
// the same table from the same endpoint, and both of them used to build it by
// reducing something in the browser. This module is what they build it from now.
//
// readKey(source, key) is the single accessor. `source` is ONE payload object —
// one ledger row, or the response's own `totals` block — and `key` is the wire
// key as the backend sent it. It reads, it coerces, it returns null when the key
// isn't there. It does not divide, sum, or reach into a second source.
//
// That is the whole rule, and it is a rule because the alternative shipped four
// separate times:
//   • CPL printed premium_spend ÷ billable_leads. Both figures were correct and
//     they were scoped differently — billable_leads counts every lead on the
//     campaigns the client owns TODAY, premium_spend covers only the days they
//     actually owned them. ₹66.16 on a contract billed at ₹188.00, and it looks
//     cheap, so nobody queries it until the invoice lands.
//   • A TOTAL row printed raw spend ÷ (meta_leads + fed_leads): ₹137.13 under a
//     ₹147.05 project row, on a ONE-ROW table. Fed leads are hand-entered and
//     were never paid for with ad spend, so they cannot sit in a raw-CPL
//     denominator.
//   • The CM report counted Meta leads off a campaign sweep scoped by each
//     campaign's CURRENT owner. Campaigns move between clients, and the backend
//     scopes raw insights by who owned the campaign ON EACH DAY, so 104 leads
//     read as 333 — the difference belonging to whoever held the campaign
//     before. Same for spend: ₹20,880.06 read as ₹52,255.26.
//   • The same report summed ManualLeadBatch rows by project without filtering
//     target_client, so ten of one client's fed leads were printed on another
//     client's report. That is not a rounding difference; that is client data
//     crossing between clients.
//
// None of those was a wrong number arriving from the server. Every one of them
// was arithmetic performed on the way to the screen, over figures that had never
// agreed about what they were counting or whose they were.
//
// So: a missing value is information and prints "—". A reconstructed one is a
// guess wearing a currency symbol.

export const DASH = "—";

export const fmt = (val) =>
  `₹${Number(val).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The accessor. Note what it does NOT do: coerce an absent key to 0. "The
// backend didn't send it" and "the backend counted none" are different facts and
// only the second is safe to print as a number.
export const readKey = (source, key) => {
  const v = source?.[key];
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// The renderers every cell goes through. Null → "—", everywhere, with no
// computed fallback behind it.
export const money = (v) => (v == null ? DASH : fmt(v));
export const count = (v) => (v == null ? DASH : v.toLocaleString("en-IN"));
// Replaced leads read as a credit: "−40" when there were any, "0" when the
// backend explicitly counted none, "—" when it didn't say.
export const credit = (v) => (v == null ? DASH : v > 0 ? `−${v}` : "0");
// Fed leads read as an addition to the Meta count beside them.
export const added = (v) => (v == null ? DASH : v > 0 ? `+${v}` : "0");
// The same values for the export sheets: a blank cell rather than an em dash, so
// a spreadsheet can still sum the column.
export const exp = (v) => (v == null ? "" : v);

// ── The cell map ─────────────────────────────────────────────────────────────
// Built per page, because two things legitimately differ between them: whether
// the viewer may see raw agency cost, and what the client's service-charge rate
// is. Everything else — which key feeds which column — is identical by
// construction, which is the point: the CM view and the admin view of the same
// client and range have to agree cell for cell, and the only way to guarantee
// that is for them to be reading the same names out of the same payload.
//
// All five inputs are ACCESSORS (called on read), so a Solid memo that calls
// cellsOf() tracks whatever they depend on.
//
//   hasRaw()      may this viewer see raw agency cost
//   clientType()  "cpl" | "hybrid" | "retainer" | "" — the VIEWED client's
//   scMult()      1 + S.C%/100, or NULL when the rate could not be resolved
//   gstMult()     1 + GST%/100, or NULL when it could not be resolved
//   iscpl()       CPL clients pay per lead: GST applies, service charge doesn't
export const makeLedgerCells = ({
  hasRaw,
  clientType,
  scMult,
  gstMult,
  iscpl,
}) => {
  // The spend the CLIENT is charged, as opposed to what the ads cost us.
  //
  // One key, both roles: premium_spend is on the CLIENT payload too (it is the
  // only spend key they get), so there is no role branch here — the decoder's
  // role split governs which keys exist, and this reads the one that means "the
  // client's money" on either payload.
  //
  // The retainer branch is BELT AND BRACES, not load-bearing. A retainer client
  // pays a flat fee, so raw IS their billed figure — and the backend already
  // substitutes it on the privileged payload, not just the client one. It is a
  // safety net for the day a retainer row comes back with a null premium. It
  // reads the SAME row, so it is a source choice, not a reconstruction.
  //
  // It does NOT fall back for anyone else. A missing display config on a
  // hybrid/CPL row means the billed figure is genuinely unknown, and printing
  // raw there would show agency cost — ~23% under the truth — under a column
  // headed "Client Billed". Unknown renders "—".
  const billedSpendOf = (w) => {
    const premium = readKey(w, "premium_spend");
    if (premium != null) return premium;
    return clientType() === "retainer" ? readKey(w, "spend") : null;
  };

  // ── One row of the payload → the cells of one row on screen ───────────────
  // Every column is one named key. The TOTAL row runs through this SAME
  // function against the response's `totals` block, which is what makes a
  // footer structurally incapable of disagreeing with the rows above it: they
  // are read the same way, from the same key names, at two levels of the same
  // payload.
  //
  // totals carries every key below EXCEPT campaigns_total / campaigns_paused /
  // campaigns_completed — so those come back null there and print "—". They are
  // deliberately not summed from the rows to fill the gap: a total the payload
  // didn't send is a total we don't know.
  //
  // Fields a given page doesn't render are mapped anyway, so that adding a
  // column is picking a name off this list — never writing an expression at a
  // render site.
  const cellsOf = (w) => ({
    // Leads
    leads: readKey(w, "total_leads"),
    metaLeads: readKey(w, "meta_leads"),
    fedLeads: readKey(w, "fed_leads"),
    replacedLeads: readKey(w, "replaced_leads"),
    billableLeads: readKey(w, "billable_leads"),
    // meta_leads and premium_leads are computed on different ownership models
    // in the backend and do NOT reconcile today (318 beside 120 on the same
    // row). That is a server-side bug being fixed there. Both are printed as
    // sent; making them agree here would only hide it, and would have to be
    // unwound when the fix lands.
    premiumLeads: readKey(w, "premium_leads"),
    // Money. CPL is premium_cpl — the client-facing one, the figure the
    // contract is written against. Raw CPL is cpl, the agency's own cost.
    // Neither is ever divided out of the columns beside it.
    cpl: readKey(w, "premium_cpl"),
    rawCpl: hasRaw() ? readKey(w, "cpl") : null,
    rawSpent: hasRaw() ? readKey(w, "spend") : null,
    spent: billedSpendOf(w),
    billedAmount: readKey(w, "billed_amount"),
    // Reach
    impressions: readKey(w, "impressions"),
    clicks: readKey(w, "clicks"),
    campaignsTotal: readKey(w, "campaigns_total"),
    campaignsActive: readKey(w, "campaigns_active"),
    campaignsPaused: readKey(w, "campaigns_paused"),
    campaignsCompleted: readKey(w, "campaigns_completed"),
  });

  // The S.C and GST columns are the one place a figure is computed, and they
  // are not the banned shape: no division, and no second column involved. Each
  // is ONE row's own figure times that client's own rate.
  //
  // Null in → null out → "—", in BOTH directions: an unknown billed figure
  // can't surface as a confident ₹0.00 with tax on top, and an unresolved RATE
  // prints "—" rather than silently charging 0% service charge. A 0% fallback
  // is a confident wrong number, which is the one thing worse than a gap.
  const withSc = (base) => {
    const sc = scMult();
    if (base == null || sc == null) return null;
    return parseFloat((base * sc).toFixed(2));
  };
  const withScGst = (base) => {
    const sc = scMult();
    const gst = gstMult();
    if (base == null || gst == null) return null;
    if (iscpl()) return parseFloat((base * gst).toFixed(2));
    if (sc == null) return null;
    return parseFloat((base * sc * gst).toFixed(2));
  };

  // Rows and the TOTAL row are the same shape, so a cell written once reads
  // correctly at either level.
  //
  // taxBase names which of this row's OWN figures the S.C / GST columns load
  // onto — "spent" (premium spend) on the client/admin report, "billedAmount"
  // (spend less the replacement credit) on the CM report, where that is the
  // column those charges are quoted against. Naming it here means the choice is
  // made once per page instead of at each of the four render paths.
  const rowOf = (w, { taxBase = "spent" } = {}) => {
    const cells = cellsOf(w);
    const base = cells[taxBase];
    return {
      ...cells,
      spentwithServiceCharge: withSc(base),
      spentwithservice_gst: withScGst(base),
    };
  };

  return { billedSpendOf, cellsOf, withSc, withScGst, rowOf };
};
