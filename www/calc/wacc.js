// Damodaran-style synthetic credit rating: approximates market cost of debt
// from interest coverage (EBIT / |interest expense|) when no bond-market
// data is available — Yahoo doesn't expose bond prices or yields at all, so
// this is the most accurate of the "no market data" methods (vs. the flat
// interest-expense/total-debt book yield used as a fallback below). Table
// is illustrative and periodically drifts from Damodaran's published
// updates — same caveat this codebase already applies to its fixed
// Korea/Japan/UK/eurozone risk-free-rate constants; re-check occasionally,
// don't treat as exact.
const SYNTHETIC_RATING_TABLE = [
  { minIcr: 12.5, rating: 'AAA', spread: 0.0060 },
  { minIcr: 9.5,  rating: 'AA',  spread: 0.0080 },
  { minIcr: 7.5,  rating: 'A+',  spread: 0.0100 },
  { minIcr: 6.0,  rating: 'A',   spread: 0.0115 },
  { minIcr: 4.5,  rating: 'A-',  spread: 0.0130 },
  { minIcr: 4.0,  rating: 'BBB', spread: 0.0165 },
  { minIcr: 3.5,  rating: 'BB+', spread: 0.0225 },
  { minIcr: 3.0,  rating: 'BB',  spread: 0.0275 },
  { minIcr: 2.5,  rating: 'B+',  spread: 0.0325 },
  { minIcr: 2.0,  rating: 'B',   spread: 0.0400 },
  { minIcr: 1.5,  rating: 'B-',  spread: 0.0500 },
  { minIcr: 1.25, rating: 'CCC', spread: 0.0650 },
  { minIcr: 0.8,  rating: 'CC',  spread: 0.0850 },
  { minIcr: 0.5,  rating: 'C',   spread: 0.1100 },
  { minIcr: -Infinity, rating: 'D', spread: 0.1400 },
];

function syntheticRatingSpread(icr) {
  if (!isFinite(icr)) return null;
  for (const row of SYNTHETIC_RATING_TABLE) {
    if (icr >= row.minIcr) return row;
  }
  return SYNTHETIC_RATING_TABLE[SYNTHETIC_RATING_TABLE.length - 1];
}

function calculateWACC({
  marketCap, totalDebt, beta,
  interestExpense, taxRate, ebit = null,
  riskFreeRate = 0.045, erp = 0.055,
}) {
  const e = (marketCap > 0) ? marketCap : 0;
  const d = (totalDebt > 0) ? totalDebt : 0;
  // Equity weight can't be meaningfully computed without a market cap --
  // defaulting it to 0 (100% debt-financed) is wrong for any real,
  // exchange-listed company, not a reasonable degradation. Silently
  // producing that phantom WACC (instead of refusing) hid a real Yahoo
  // data gap behind a plausible-looking number (2026-08-05 incident).
  if (e === 0) return null;
  const v = e + d;

  const eWeight = e / v;
  const dWeight = d / v;

  const effectiveBeta = (beta != null && isFinite(beta) && beta > 0) ? beta : 1.0;
  const re = riskFreeRate + effectiveBeta * erp;

  const hasInterestExpense = interestExpense != null && interestExpense !== 0;
  const icr = (hasInterestExpense && ebit != null && isFinite(ebit) && ebit > 0)
    ? ebit / Math.abs(interestExpense) : null;
  const ratingRow = (icr != null) ? syntheticRatingSpread(icr) : null;

  let rd, rdMethod, syntheticRating = null;
  if (ratingRow) {
    rd = riskFreeRate + ratingRow.spread;
    rdMethod = 'synthetic';
    syntheticRating = ratingRow.rating;
  } else if (hasInterestExpense && d > 0) {
    // +0.5% spread over the historical book yield approximates the premium between
    // a company's new-issuance market cost of debt and its reported coupon rate.
    rd = Math.abs(interestExpense) / d + 0.005;
    rdMethod = 'bookYield';
  } else {
    rd = 0.05;
    rdMethod = 'default';
  }
  const isRdEstimated = rdMethod === 'default';

  const isTcEstimated = taxRate === null || taxRate === undefined || taxRate < 0 || taxRate >= 1;
  const tc = isTcEstimated ? 0.25 : taxRate;

  const wacc = (eWeight * re) + (dWeight * rd * (1 - tc));

  return {
    wacc, re, rd, tc, eWeight, dWeight, riskFreeRate, erp,
    isRdEstimated, isTcEstimated, rdMethod, syntheticRating, icr,
  };
}

if (typeof module !== 'undefined') module.exports = { calculateWACC };
