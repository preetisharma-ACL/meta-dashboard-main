/**
 * Builds a sorted markup history array from raw config API rows.
 * Backend already populates valid_to when a new config is created,
 * so we trust it directly — no frontend derivation needed.
 *
 * @param {Array} configRows - raw rows from /clients/admin/configs/
 * @returns {Array} sorted ascending by validFrom
 */
export const buildMarkupHistory = (configRows = []) => {
  return [...configRows]
    .filter((r) => r.valid_from)
    .map((r) => ({
      markupPct: parseFloat(r.rule_value ?? 0),
      validFrom: r.valid_from.split("T")[0],  // normalise to YYYY-MM-DD
      validTo: r.valid_to ? r.valid_to.split("T")[0] : null,
    }))
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
};

/**
 * Returns the markup percentage active on a given date.
 * Returns null if no config window covers that date
 * (i.e. date is before the earliest valid_from).
 *
 * @param {Array} markupHistory - output of buildMarkupHistory()
 * @param {string} dateStr - "YYYY-MM-DD"
 * @returns {number|null}
 */
export const getMarkupPctForDate = (markupHistory = [], dateStr) => {
  if (!markupHistory.length || !dateStr) return null;

  for (const entry of markupHistory) {
    const afterStart = dateStr >= entry.validFrom;
    const beforeEnd = !entry.validTo || dateStr <= entry.validTo;
    if (afterStart && beforeEnd) return entry.markupPct;
  }

  // Date is before earliest valid_from — no config covers it
  return null;
};

/**
 * Applies date-accurate markup to a single day's spend.
 * Returns null for both modifiedSpend and contribution to modifiedCPL
 * if no config covers that date.
 *
 * @param {number} daySpend
 * @param {number|null} markupPct
 * @returns {{ modifiedSpend: number|null, isNull: boolean }}
 */
export const applyMarkup = (daySpend, markupPct) => {
  if (markupPct === null) {
    return { modifiedSpend: null, isNull: true };
  }
  return {
    modifiedSpend: daySpend * (1 + markupPct / 100),
    isNull: false,
  };
};