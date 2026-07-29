// ─── GST / TDS preview — a DISPLAY MIRROR, never the transmitted figure ───────
// Payment.save() computes the real numbers server-side. This module reproduces
// that formula so the operator can see what they are about to record before
// they commit; the form posts only the INPUTS (base_amount, tds_applied,
// tds_amount, gst_pct) and then renders whatever row the server returns.
//
// Mirrored formula:
//   excluding_gst = base_amount + (tds_amount if tds_applied else 0)
//   gst_amount    = excluding_gst * gst_pct / 100      (2 dp)
//   including_gst = excluding_gst + gst_amount
//   final_amount  = including_gst rounded to a whole rupee
//
// If the server formula ever changes, this preview drifts — that is why the
// form labels it a preview and re-reads the saved row after the write.

// Round half-up at 2 dp. The +EPSILON nudge stops binary artefacts like
// 1.005 → 1.00 (it stores as 1.00499…) from shaving a paisa off the preview.
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const toNum = (v) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// GST slabs the backend accepts. Anything else is rejected server-side.
export const GST_OPTIONS = [9, 18];

// Returns every intermediate figure, or all-nulls when the inputs aren't yet a
// computable set. Nulls render as "—" upstream so a half-filled form never
// shows a confident ₹0 total.
export const computeGstPreview = ({
  baseAmount,
  tdsApplied,
  tdsAmount,
  gstPct,
} = {}) => {
  const base = toNum(baseAmount);
  const pct = toNum(gstPct);
  const tds = toNum(tdsAmount);

  const empty = {
    excludingGst: null,
    gstAmount: null,
    includingGst: null,
    finalAmount: null,
  };

  if (base === null || pct === null) return empty;

  // TDS only participates when the toggle is on. With the toggle on but the
  // amount still blank, treat it as 0 — the operator is mid-entry, and the
  // preview should track what would be sent (tds_amount: 0), not blank out.
  const excludingGst = round2(base + (tdsApplied ? (tds ?? 0) : 0));
  const gstAmount = round2((excludingGst * pct) / 100);
  const includingGst = round2(excludingGst + gstAmount);
  const finalAmount = Math.round(includingGst);

  return { excludingGst, gstAmount, includingGst, finalAmount };
};
