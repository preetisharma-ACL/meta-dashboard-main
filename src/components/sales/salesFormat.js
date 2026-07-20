// ─── Shared sales money/format helpers ────────────────────────────────────────
// One null discipline for EVERY sales page: a missing money field (null /
// undefined / "") renders "—", NEVER ₹0. A missing field must look missing, not
// healthy — this is the fix for the live "Remaining ₹0 green" bug, where a
// wrong/absent key was coerced to 0 and read as money in hand.

export const isMissing = (v) => v === null || v === undefined || v === "";

// Indian-grouped ₹. Missing / non-numeric → "—". Negative keeps its sign.
// `decimals`: 0 for tiles/strips, 2 for table cells.
export const fmtMoney = (v, decimals = 0) => {
  if (isMissing(v)) return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n).toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return `${n < 0 ? "-" : ""}₹${abs}`;
};

// Counts (leads / client counts) — a genuine 0 is meaningful, so 0 is fine here.
export const fmtNum = (v) => (Number(v) || 0).toLocaleString("en-IN");

// Sum a money column across rows. Arithmetic (not a display read): a row that
// lacks the field contributes nothing rather than poisoning the sum with NaN.
export const sumMoney = (rows, key) =>
  (rows || []).reduce((s, r) => {
    if (isMissing(r?.[key])) return s;
    const n = Number(r[key]);
    return Number.isFinite(n) ? s + n : s;
  }, 0);

// True only for a present, negative money value (so "—" never colours red).
export const isNegativeMoney = (v) => {
  if (isMissing(v)) return false;
  const n = Number(v);
  return Number.isFinite(n) && n < 0;
};

// ─── Tone tokens (house palette) ──────────────────────────────────────────────
export const TONE_RED = "text-[#AC2334] dark:text-red-300";
export const TONE_GREEN = "text-[#15966A] dark:text-green-300";
export const TONE_NAVY = "text-[#14233A] dark:text-white";
export const TONE_MUTED = "text-[#8593A8] dark:text-gray-500";

// Build the "Remaining" tile ({label, value, tone}): missing → "—" muted,
// negative → red "Owes ₹X", otherwise green balance. Shared by the sales
// Payments strip/tile and the per-manager money tiles.
export const remainingTile = (label, v) => {
  if (isMissing(v) || !Number.isFinite(Number(v)))
    return { label, value: "—", tone: TONE_MUTED };
  const n = Number(v);
  if (n < 0) return { label, value: `Owes ${fmtMoney(Math.abs(n), 0)}`, tone: TONE_RED };
  return { label, value: fmtMoney(n, 0), tone: TONE_GREEN };
};

// ─── Client-type badge ────────────────────────────────────────────────────────
export const TYPE_BADGE = {
  cpl: "bg-[#ECF2FA] text-[#3E6FB0] dark:bg-blue-900/40 dark:text-blue-300",
  hybrid: "bg-[#FBF3E2] text-[#B07A14] dark:bg-yellow-900/30 dark:text-yellow-300",
  retainer: "bg-[#E9F7F1] text-[#15966A] dark:bg-green-900/30 dark:text-green-300",
};
export const typeBadge = (t) =>
  TYPE_BADGE[String(t || "").toLowerCase()] ??
  "bg-[#F1F4F9] text-[#54657E] dark:bg-gray-700 dark:text-gray-300";
