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

// Damodaran's "sector average" normalization technique (Ups and Downs:
// Valuing Cyclical and Commodity Companies, p.14-15) -- when a company's
// own historical margin average is unreliable ("limited history or a
// history of operating changes"), use the sector/peer average instead.
// Here specifically: the own multi-year average (normalizeCyclicalFcf's
// marginUsed) came out NEGATIVE -- a real, non-null number, just one a
// single company's lumpy capex timing can produce even for a genuinely
// healthy cyclical business. sectorLookup is the precomputed, static
// {industry: {avgMargin, peerCount}} lookup from
// scripts/lib/sector-margin-tally.js (DCFAnalysis) -- nothing here fetches
// or computes anything on the fly. A negative sector average is used as-is,
// not further overridden -- a genuinely negative whole-industry average is
// real information (the sector's in a trough), not noise to normalize away
// again. See docs/superpowers/specs/2026-08-24-sector-average-cyclical-
// margin-design.md.
function resolveCyclicalMargin({ ownMargin, sectorLookup, industry, minPeers = 3 }) {
  if (ownMargin == null) return { marginUsed: null, source: null, peerCount: null };
  if (ownMargin >= 0) return { marginUsed: ownMargin, source: 'own', peerCount: null };
  const sector = sectorLookup && industry ? sectorLookup[industry] : null;
  if (sector && typeof sector.avgMargin === 'number' && typeof sector.peerCount === 'number' && sector.peerCount >= minPeers) {
    return { marginUsed: sector.avgMargin, source: 'sector', peerCount: sector.peerCount };
  }
  return { marginUsed: null, source: null, peerCount: null };
}

if (typeof module !== 'undefined') module.exports = { normalizeCyclicalFcf, resolveCyclicalMargin };
if (typeof window !== 'undefined') { window.normalizeCyclicalFcf = normalizeCyclicalFcf; window.resolveCyclicalMargin = resolveCyclicalMargin; }
