function calculateWACC({
  marketCap, totalDebt, beta,
  interestExpense, taxRate,
  riskFreeRate = 0.045, erp = 0.055,
}) {
  const e = (marketCap > 0) ? marketCap : 0;
  const d = (totalDebt > 0) ? totalDebt : 0;
  const v = e + d;
  if (v === 0) return null;

  const eWeight = e / v;
  const dWeight = d / v;

  const effectiveBeta = (beta != null && isFinite(beta) && beta > 0) ? beta : 1.0;
  const re = riskFreeRate + effectiveBeta * erp;

  const isRdEstimated = interestExpense === null || interestExpense === undefined || d === 0;
  // +0.5% spread over the historical book yield approximates the premium between
  // a company's new-issuance market cost of debt and its reported coupon rate.
  const rd = isRdEstimated ? 0.05 : (Math.abs(interestExpense) / d + 0.005);

  const isTcEstimated = taxRate === null || taxRate === undefined || taxRate < 0 || taxRate >= 1;
  const tc = isTcEstimated ? 0.25 : taxRate;

  const wacc = (eWeight * re) + (dWeight * rd * (1 - tc));

  return { wacc, re, rd, tc, eWeight, dWeight, riskFreeRate, erp, isRdEstimated, isTcEstimated };
}

if (typeof module !== 'undefined') module.exports = { calculateWACC };
