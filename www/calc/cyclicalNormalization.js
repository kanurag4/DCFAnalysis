// www/dcf/calc/cyclicalNormalization.js -- averages a cyclical company's
// FCF margin across whatever real fiscal-year history is available (from
// /timeseries's annualFreeCashFlow/annualTotalRevenue -- see data.js's
// fetchDCFData()), then applies that average margin to a normalized revenue
// base -- the lower of trailing revenue and the average revenue over the
// same years for commodity-priced industries, trailing revenue for chipmakers
// and car makers (see cyclicalBaseFcf) -- to produce a normalized base-year
// FCF. Feeds the existing calc/dcf.js /
// calc/fadingGrowthDcf.js unmodified -- this is NOT a new valuation engine,
// just a different base-year input (Damodaran's rule for cyclicals: never
// project a DCF off a single year that might be a cycle peak or trough).
// Pure, Node-testable.
//
// Yahoo typically returns ~4 fiscal years via /timeseries -- short of a
// genuine multi-year commodity cycle (5-10yr), a real data-availability
// limitation surfaced to the user (see calc/assumptions.js's isCyclical
// dispatch and app.js's cyclical-note UI), not hidden.
// Latest 4 fiscal years only -- same window as utils.js's HISTORY_WINDOW_YEARS (own name: these files share
// one browser global scope). Our market-data store can hold more years than Yahoo's 4.
const CN_HISTORY_YEARS = 4;
function cnLatestYears(series) {
  if (series.length <= CN_HISTORY_YEARS) return series;
  return series.filter(e => e && e.date).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-CN_HISTORY_YEARS);
}

function normalizeCyclicalFcf({ fcfHistory, revenueHistory, trailingRevenue, minYears = 2, capRevenue = true }) {
  if (!Array.isArray(fcfHistory) || !Array.isArray(revenueHistory)) {
    return { value: null, marginUsed: null, yearsUsed: 0 };
  }
  fcfHistory = cnLatestYears(fcfHistory);
  revenueHistory = cnLatestYears(revenueHistory);

  // Pair by fiscal-year date, not array position -- the two series can come
  // back with different lengths or ordering from Yahoo, and pairing by
  // index would silently mismatch a year's FCF against a different year's
  // revenue.
  const revenueByDate = new Map(
    revenueHistory.filter(e => e && e.value != null && isFinite(e.value) && e.value > 0).map(e => [e.date, e.value])
  );

  const margins = [];
  const revenues = [];
  for (const entry of fcfHistory) {
    if (!entry || entry.value == null || !isFinite(entry.value)) continue;
    const revenue = revenueByDate.get(entry.date);
    if (revenue == null) continue;
    margins.push(entry.value / revenue);
    revenues.push(revenue);
  }

  if (margins.length < minYears || !(trailingRevenue > 0)) {
    return { value: null, marginUsed: null, yearsUsed: margins.length, baseRevenue: null, revenueCapped: false };
  }

  const marginUsed = margins.reduce((a, b) => a + b, 0) / margins.length;
  // Averaging the margin alone smooths a peak MARGIN but not a peak PRICE: at
  // a commodity high (gold, 2026) trailing revenue is itself the cycle top, so
  // an average margin x trailing revenue still values the miner off peak-year
  // sales. Cap the revenue base at its own average over the same years.
  // Deliberately one-sided -- a trough year keeps its (lower) trailing revenue,
  // so the screens never value a cyclical above what today's sales support.
  // capRevenue false (chipmakers, car makers -- see cyclicalBaseFcf) skips the cap.
  const avgRevenue = revenues.reduce((a, b) => a + b, 0) / revenues.length;
  const revenueCapped = capRevenue && avgRevenue < trailingRevenue;
  const baseRevenue = revenueCapped ? avgRevenue : trailingRevenue;
  return { value: marginUsed * baseRevenue, marginUsed, yearsUsed: margins.length, baseRevenue, revenueCapped };
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
//
// The sector average stands in for a healthy business whose cash flow is
// negative only because of capex timing -- so it is only lent to a company
// that is profitable at the operating line. A company losing money before
// capex (operatingMargin < 0: a pre-revenue developer like VUL.AX at
// -1408%) has no healthy margin to normalize towards; it gets no
// substitute and falls back to its own (negative) trailing FCF. A missing
// operatingMargin keeps the substitution (prior behaviour).
function resolveCyclicalMargin({ ownMargin, sectorLookup, industry, operatingMargin = null, minPeers = 3 }) {
  if (ownMargin == null) return { marginUsed: null, source: null, peerCount: null };
  if (ownMargin >= 0) return { marginUsed: ownMargin, source: 'own', peerCount: null };
  if (typeof operatingMargin === 'number' && isFinite(operatingMargin) && operatingMargin < 0) {
    return { marginUsed: null, source: null, peerCount: null };
  }
  const sector = sectorLookup && industry ? sectorLookup[industry] : null;
  if (sector && typeof sector.avgMargin === 'number' && typeof sector.peerCount === 'number' && sector.peerCount >= minPeers) {
    return { marginUsed: sector.avgMargin, source: 'sector', peerCount: sector.peerCount };
  }
  return { marginUsed: null, source: null, peerCount: null };
}

// The one place a cyclical company's normalized base-year FCF is built --
// every consumer (calc/assumptions.js, worker-watchlist/valuation.js, and
// DCFAnalysis's scripts/lib/evaluate.js + ticker-page.js) calls this instead
// of repeating the normalize -> resolve -> margin x revenue steps. Returns the
// fcfInfo-shaped object, or null when the caller should keep its standard
// (trailing) fcfInfo untouched.
// The revenue cap is for industries whose revenue follows a commodity price (metals, energy, chemicals,
// shipping rates). Chipmakers and car makers are cyclical in margin and volume, but their revenue can grow
// for years on real demand: capping it at a multi-year average valued NVDA off $109B of revenue against
// $303B trailing (2026-10-31). They keep the averaged margin and use trailing revenue.
const REVENUE_CAP_EXEMPT_INDUSTRIES = /^(Semiconductors|Auto Manufacturers|Auto Parts)$/i;

function cyclicalBaseFcf({ fcfHistory, revenueHistory, trailingRevenue, sectorLookup, industry, operatingMargin = null }) {
  const capRevenue = !REVENUE_CAP_EXEMPT_INDUSTRIES.test(industry || '');
  const normalized = normalizeCyclicalFcf({ fcfHistory, revenueHistory, trailingRevenue, capRevenue });
  if (normalized.value === null) return null;
  const resolved = resolveCyclicalMargin({ ownMargin: normalized.marginUsed, sectorLookup, industry, operatingMargin });
  if (resolved.marginUsed === null) return null;
  return {
    value: resolved.marginUsed * normalized.baseRevenue,
    method: 'normalized',
    marginUsed: resolved.marginUsed,
    yearsUsed: normalized.yearsUsed,
    source: resolved.source,
    peerCount: resolved.peerCount,
    baseRevenue: normalized.baseRevenue,
    revenueCapped: normalized.revenueCapped,
    trailingRevenue,
  };
}

if (typeof module !== 'undefined') module.exports = { normalizeCyclicalFcf, resolveCyclicalMargin, cyclicalBaseFcf, CN_HISTORY_YEARS };
if (typeof window !== 'undefined') { window.normalizeCyclicalFcf = normalizeCyclicalFcf; window.resolveCyclicalMargin = resolveCyclicalMargin; window.cyclicalBaseFcf = cyclicalBaseFcf; }
