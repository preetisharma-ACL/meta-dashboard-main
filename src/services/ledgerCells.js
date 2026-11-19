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
// A money credit — the replaced-lead credit note — reads as a deduction:
// "−₹38,661.00". Zero prints "—" rather than "−₹0.00", because a credit of
// nothing is not a line on the client's statement. The minus is the same
// typographic U+2212 the Replaced count beside it uses, not a hyphen.
export const moneyCredit = (v) =>
  v == null || v === 0 ? DASH : `−${fmt(Math.abs(v))}`;
// The same value for a spreadsheet: a NEGATIVE number, so a credit column sums
// against the charges beside it instead of inflating them.
export const expCredit = (v) => (v == null ? "" : v === 0 ? 0 : -Math.abs(v));
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
//   scPct()       the client's service-charge RATE in percent, or NULL when it
//                 could not be resolved. The RATE, not a multiplier: the charge
//                 is rounded to the paisa on its own before it is added, and a
//                 1.13 cannot express that.
//   gstPct()      the GST rate in percent — flat 18 — or NULL
//   iscpl()       CPL clients pay per lead: GST applies, service charge doesn't
export const makeLedgerCells = ({
  hasRaw,
  clientType,
  scPct,
  gstPct,
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

  // What the S.C and GST columns are charged ON: billed_amount, the client's
  // spend AFTER the credit for replaced leads. One named key off the same row.
  //
  // The retainer branch is the same belt and braces as billedSpendOf's, and
  // rests on the fact the replacement columns already rest on: replacements
  // apply to CPL and hybrid clients only, so a retainer's billed figure IS
  // their billed spend — there is nothing to credit back. Nobody else falls
  // back. A hybrid row with no billed_amount has a genuinely unknown base, and
  // charging S.C on the pre-credit figure to fill that gap is the exact bug
  // this function exists to close.
  const billedBaseOf = (w) => {
    const billed = readKey(w, "billed_amount");
    if (billed != null) return billed;
    return clientType() === "retainer" ? billedSpendOf(w) : null;
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
    // ── The replacement credit, for a HYBRID client (backend fd51d0d) ──────
    // A hybrid client's ad spend is billed IN FULL; the leads that were
    // replaced come back as Replaced Credit Notes against the next charges.
    // The ledger used to show neither the credit nor what the period cost
    // after it, so a row reading "Net leads 584" beside a billed figure for
    // all 847 leads read as being charged for leads that had been replaced.
    //
    // All five are the SERVER's, on the same row as the spend they describe —
    // net_cost and net_cpl included. The subtraction and the division are the
    // backend's; this file does not redo either. net_cost is null with no
    // spend and net_cpl is null with nothing to divide, and both print "—"
    // there rather than a confident ₹0.00.
    replacedCredit: readKey(w, "replaced_credit"),
    replacedCreditSc: readKey(w, "replaced_credit_sc"),
    replacedCreditInc: readKey(w, "replaced_credit_inc"),
    netCost: readKey(w, "net_cost"),
    netCpl: readKey(w, "net_cpl"),
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
  // is ONE row's own figure plus that client's own rate on it.
  //
  // The ORDER and the per-step rounding are build_billing_overview's, because
  // the invoice is what these columns have to match: round the service charge
  // to the paisa, add it, round GST on THAT gross to the paisa, add it. One
  // multiplication at the end (base × 1.13 × 1.18) is the same arithmetic only
  // until a half-paisa turns up, and then the ledger and the invoice differ by
  // a paisa for no reason a reader can see.
  //
  // Null in → null out → "—", in BOTH directions: an unknown billed figure
  // can't surface as a confident ₹0.00 with tax on top, and an unresolved RATE
  // prints "—" rather than silently charging 0% service charge. A 0% fallback
  // is a confident wrong number, which is the one thing worse than a gap.
  const round2 = (n) => parseFloat(n.toFixed(2));
  const withSc = (base) => {
    const pct = scPct();
    if (base == null || pct == null) return null;
    return round2(base + round2((base * pct) / 100));
  };
  const withScGst = (base) => {
    const gst = gstPct();
    if (base == null || gst == null) return null;
    const gross = iscpl() ? base : withSc(base);
    if (gross == null) return null;
    return round2(gross + round2((gross * gst) / 100));
  };

  // ── GST on the billed amount, broken out (CPL clients) ───────────────────
  // A CPL client pays per lead: no service charge, so the only tax on their
  // report is GST, and it is charged on the billed figure itself. withScGst()
  // above already returns that gross for them; this is the TAX ON ITS OWN, so
  // the two can sit either side of the billed figure and a reader can add the
  // three across and land on the total.
  //
  // One rate, one named key underneath (billed_amount, which is what the S.C
  // columns load onto for every other client type), and the same rounding the
  // invoice does: the charge is rounded to the paisa on its own before it is
  // added. Null in, null out, in both directions: no tax on a billed figure
  // nobody has, and an unresolved rate prints as a gap rather than as 0%.
  const gstOn = (base) => {
    const pct = gstPct();
    if (base == null || pct == null) return null;
    return round2((base * pct) / 100);
  };

  // Rows and the TOTAL row are the same shape, so a cell written once reads
  // correctly at either level.
  //
  // The S.C and GST columns load onto billed_amount on every surface, and that
  // is not a per-page knob for the same reason nothing else here is: the two
  // candidate bases agree only where replaced_leads is 0, so a knob would be a
  // knob for making two reports of the same client disagree.
  //
  // They used to load onto `spent` — premium_spend, BEFORE the replacement
  // credit. A replaced lead is one the client does not owe for, so charging
  // 13% and then 18% on top of it billed them for a lead they had already been
  // credited: a row with 9 replacements printed ₹9,100.48 where the invoice
  // said ₹6,761.38, and a seven-project footer ran about ₹22,000 over. The
  // Billing page had it right the whole time — build_billing_overview takes
  // the replacement cost off FIRST, then service charge, then GST — so the
  // ledger was not merely high, it contradicted the client's own invoice.
  // ── The two NET money columns, for a hybrid client ───────────────────────
  // "Net + X% S.C" and "Net + X% S.C + 18% GST": the charge on spend billed in
  // full, less the credit note for the replaced leads, at each stage carrying
  // the same tax the stage above it does.
  //
  // THE BASE IS `spent` — premium_spend, Amount Spent, the figure in the column
  // the header names — and NOT billed_amount, which the pre-credit S.C columns
  // load onto. That is a deliberate difference and the one decision in here
  // worth checking:
  //   • A hybrid client's spend is billed in full, so Amount Spent IS what the
  //     service charge is levied on. Taking the credit off here, from a named
  //     server field, is what the invoice does.
  //   • billed_amount has historically meant premium_spend MINUS the replaced
  //     cost. Loading onto that AND subtracting replaced_credit_sc would take
  //     the same credit off twice — a row with ₹38,661.00 of replacements
  //     landing ~₹44,460 light, in the direction nobody queries because it
  //     flatters the client.
  // The arithmetic is linear in the base, so where the two agree — which is
  // what backend fd51d0d makes true for hybrid — the choice changes nothing;
  // where they disagree, only this one reproduces the invoice.
  //
  // The subtraction is the ONLY one on this path, it is re-rounded (a float
  // 125887.45 − 44460.15 lands on 81427.30000000001), and it is null-in →
  // null-out in both directions: an unresolved rate or a credit the payload
  // didn't send prints "—" rather than quietly charging the gross figure.
  const less = (gross, cr) =>
    gross == null || cr == null ? null : round2(gross - cr);

  // A project with no spend in the period has nothing to charge, and the whole
  // money half of its row reads "—": the server already sends net_cost and
  // net_cpl as null there. The two charge columns have to follow, or a row
  // reading "— / —" across Net cost and Net CPL ends with a confident ₹0.00
  // under "Net + 15% S.C", which reads as a charge of zero rather than as the
  // absence of one. Taken off the row's OWN spend, so nothing is inferred.
  const nothingSpent = (spent) => spent == null || spent === 0;

  const rowOf = (w) => {
    const cells = cellsOf(w);
    const base = billedBaseOf(w);
    const netSc = nothingSpent(cells.spent)
      ? null
      : less(withSc(cells.spent), cells.replacedCreditSc);
    const netScGst = nothingSpent(cells.spent)
      ? null
      : less(withScGst(cells.spent), cells.replacedCreditInc);
    // CPL only. Hybrid and retainer carry their tax in the S.C columns, and a
    // second GST figure on the same row would be the same money twice under
    // two headings. Both hang off billedAmount, so a row with no billed figure
    // gets a pair of gaps rather than tax on a number nobody has.
    const billedGst = iscpl() ? gstOn(cells.billedAmount) : null;
    const billedInclGst =
      billedGst == null ? null : round2(cells.billedAmount + billedGst);
    return {
      ...cells,
      spentwithServiceCharge: withSc(base),
      spentwithservice_gst: withScGst(base),
      netSpentwithSc: netSc,
      netSpentwithScGst: netScGst,
      billedGst,
      billedInclGst,
    };
  };

  // ── The two net charge columns on the TOTAL row ──────────────────────────
  // Σ of the rows' own charges, and this is NOT the re-summing this file
  // forbids. The ban is on reconstructing a figure the SERVER sent — leads,
  // spend, CPL, net cost — from some second source. These two columns are not
  // on the payload at all: the frontend computes them, at the row level and at
  // the totals level, from the same rate. So the only question is WHERE the
  // paisa gets rounded, and charging once on the period total is a different
  // answer from charging each project and adding:
  //
  //   per row, then summed   ₹1,67,259.88
  //   once on the total      ₹1,67,259.89
  //
  // Neither is wrong by a rule, but one of them is sitting under a column of
  // figures that visibly add up to the other, and a reader checking the sum is
  // right to think the footer is broken. The rows win.
  //
  // It sums the rows THE PAYLOAD SENT, not the rows on screen. The rest of the
  // footer describes the server's whole period, so summing a filtered subset
  // here would put two different project sets in one row — the exact shape
  // this file exists to prevent.
  //
  // Null means "don't print a sum": either nothing to add, or a row that HAS
  // spend but produced no charge (an unresolved rate, a credit the payload
  // omitted). Adding up the rest would quietly drop that project from a money
  // column, so the caller falls back to charging the totals block instead.
  const netTotalOf = (wireRows, key) => {
    let sum = 0;
    let counted = 0;
    for (const w of wireRows ?? []) {
      const r = rowOf(w);
      if (r[key] != null) {
        sum += r[key];
        counted += 1;
      } else if (!nothingSpent(r.spent)) {
        return null;
      }
    }
    return counted > 0 ? round2(sum) : null;
  };

  // ── The two CPL GST columns on the TOTAL row ─────────────────────────────
  // Same rule as netTotalOf, and for the same reason: the column above adds up
  // to the sum of its own rows, so the footer prints that sum rather than the
  // rate charged once on the period total. The two answers differ by a paisa,
  // and only one of them survives a reader adding the column up by hand.
  //
  // The guard is the row's OWN billed figure rather than its spend. These two
  // columns hang off billed_amount, so that is the thing whose presence says a
  // row should have contributed: a row carrying a billed figure and no GST
  // would otherwise drop out of the sum silently, and the footer would read
  // low under a complete-looking column. Null there, and the caller falls back
  // to charging the totals block.
  const billedTotalOf = (wireRows, key) => {
    let sum = 0;
    let counted = 0;
    for (const w of wireRows ?? []) {
      const r = rowOf(w);
      if (r[key] != null) {
        sum += r[key];
        counted += 1;
      } else if (readKey(w, "billed_amount") != null) {
        return null;
      }
    }
    return counted > 0 ? round2(sum) : null;
  };

  return {
    billedSpendOf,
    billedBaseOf,
    cellsOf,
    withSc,
    withScGst,
    rowOf,
    netTotalOf,
    billedTotalOf,
  };
};
