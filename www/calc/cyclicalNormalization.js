// www/dcf/calc/cyclicalNormalization.js -- averages a cyclical company's
// FCF margin across whatever real fiscal-year history is available (from
// /timeseries's annualFreeCashFlow/annualTotalRevenue -- see data.js's
// fetchDCFData()), then applies that average margin to trailing revenue to
// produce a normalized base-year FCF. Feeds the existing calc/dcf.js /
// calc/fadingGrowthDcf.js unmodified -- this is NOT a new valuation engine,
// just a different base-year input (Damodaran's rule for cyclicals: never
// project a DCF off a single year that might be a cycle peak or trough).
// Pure, Node-testable.
//
// Yahoo typically returns ~4 fiscal years via /timeseries -- short of a
// genuine multi-year commodity cycle (5-10yr), a real data-availability
// limitation surfaced to the user (see calc/assumptions.js's isCyclical
// dispatch and app.js's cyclical-note UI), not hidden.
function normalizeCyclicalFcf({ fcfHistory, revenueHistory, trailingRevenue, minYears = 2 }) {
  if (!Array.isArray(fcfHistory) || !Array.isArray(revenueHistory)) {
    return { value: null, marginUsed: null, yearsUsed: 0 };
  }

  // Pair by fiscal-year date, not array position -- the two series can come
  // back with different lengths or ordering from Yahoo, and pairing by
  // index would silently mismatch a year's FCF against a different year's
  // revenue.
  const revenueByDate = new Map(
    revenueHistory.filter(e => e && e.value != null && isFinite(e.value) && e.value > 0).map(e => [e.date, e.value])
  );

  const margins = [];
  for (const entry of fcfHistory) {
    if (!entry || entry.value == null || !isFinite(entry.value)) continue;
    const revenue = revenueByDate.get(entry.date);
    if (revenue == null) continue;
    margins.push(entry.value / revenue);
  }

  if (margins.length < minYears || !(trailingRevenue > 0)) {
    return { value: null, marginUsed: null, yearsUsed: margins.length };
  }

  const marginUsed = margins.reduce((a, b) => a + b, 0) / margins.length;
  return { value: marginUsed * trailingRevenue, marginUsed, yearsUsed: margins.length };
}

if (typeof module !== 'undefined') module.exports = { normalizeCyclicalFcf };
if (typeof window !== 'undefined') { window.normalizeCyclicalFcf = normalizeCyclicalFcf; }
