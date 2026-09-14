// www/dcf/calc/altmanZ.js — Altman Z-Score (classic public-company 5-ratio
// formula). Pure: no DOM, no network. See
// docs/superpowers/specs/2026-09-13-solvency-check-design.md.
//
//   Z = 1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 1.0*X5
//     X1 = Working Capital / Total Assets   (WC = Current Assets - Current Liabilities)
//     X2 = Retained Earnings / Total Assets
//     X3 = EBIT / Total Assets
//     X4 = Market Value of Equity / Total Liabilities
//     X5 = Sales (Revenue) / Total Assets
//
// Bands fixed by the design spec: Safe Z > 2.99, Grey 1.81 <= Z <= 2.99,
// Distress Z < 1.81. Uses live market cap for X4 (not book equity, unlike
// the private-firm Z'/Z'' variants) -- viable since every KashVector-
// covered ticker has a real market cap.
//
// All 5 inputs feed one weighted sum -- unlike Piotroski's per-criterion
// skip-and-shrink, ANY missing input nulls the WHOLE score (a partial Z
// isn't a meaningful number).

function altmanZScore({ totalAssets, currentAssets, currentLiabilities, retainedEarnings, ebit, marketCap, totalLiabilities, revenue }) {
  const required = { totalAssets, currentAssets, currentLiabilities, retainedEarnings, ebit, marketCap, totalLiabilities, revenue };
  for (const v of Object.values(required)) {
    if (v == null || !isFinite(v)) return { zScore: null, zone: null, verdict: 'N/A', ratios: null };
  }
  if (totalAssets <= 0 || totalLiabilities <= 0) {
    return { zScore: null, zone: null, verdict: 'N/A', ratios: null };
  }

  const workingCapital = currentAssets - currentLiabilities;
  const x1 = workingCapital / totalAssets;
  const x2 = retainedEarnings / totalAssets;
  const x3 = ebit / totalAssets;
  const x4 = marketCap / totalLiabilities;
  const x5 = revenue / totalAssets;

  const zScore = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5;
  const zone = zScore > 2.99 ? 'safe' : (zScore >= 1.81 ? 'grey' : 'distress');
  const verdict = zone === 'safe' ? 'Safe Zone' : (zone === 'grey' ? 'Grey Zone' : 'Distress Zone');

  return { zScore, zone, verdict, ratios: { x1, x2, x3, x4, x5 } };
}

if (typeof module !== 'undefined') module.exports = { altmanZScore };
