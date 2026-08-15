// Excess Return Model — used instead of DDM for banks/insurers/NBFCs whose payout
// ratio is too low relative to sustainable payout for DDM to be reliable (DDM only
// sees the dividend paid out, not the value created by reinvesting the rest at a
// high ROE). Pure, Node-testable. See docs/superpowers/specs/
// 2026-08-15-excess-return-model-financials-design.md for the full design.
//
// Value of Equity = Book Value of Equity(0) + sum of PV(Excess Return) for years 1..N
// Excess Return(t) = (roe - costOfEquity) * BookValue(t-1)
// BookValue(t) = BookValue(t-1) * (1 + growthRate)
//
// Deliberately NO terminal-value component -- a persisting excess return assumes
// ROE stays above cost of equity forever, which the design explicitly rejects (see
// spec's "Calc engine mechanics" for the reasoning). Value creation is scoped to the
// explicit projection window only.

function calculateExcessReturn({
  bookValue, roe, costOfEquity, growthRate,
  projectionYears = 5,
  currentPrice = null,
  midYear = false,
}) {
  if (!bookValue || bookValue <= 0) return null;
  if (!roe || roe <= 0) return null;
  if (!costOfEquity || costOfEquity <= 0) return null;

  const excessReturns = [];
  const pvExcessReturns = [];
  const bookValues = [];
  let runningBve = bookValue;

  for (let t = 1; t <= projectionYears; t++) {
    const excessReturn = (roe - costOfEquity) * runningBve;
    excessReturns.push(excessReturn);
    // Same mid-year convention as calc/ddm.js -- each year's excess return is an
    // economic-profit measure generated continuously through the fiscal year, not
    // a lump sum at year-end, so the same t-0.5 exponent applies equally here.
    const exponent = midYear ? t - 0.5 : t;
    pvExcessReturns.push(excessReturn / Math.pow(1 + costOfEquity, exponent));
    runningBve = runningBve * (1 + growthRate);
    bookValues.push(runningBve);
  }

  const sumPvExcessReturns = pvExcessReturns.reduce((a, b) => a + b, 0);
  const intrinsicValue = bookValue + sumPvExcessReturns;

  // Same model-agnostic CAGR-to-fair-value formula as calc/dcf.js and calc/ddm.js
  // (assumes price converges to intrinsicValue over N years) -- kept here rather
  // than in a shared helper since dcf.js/ddm.js each inline it identically too.
  let marginOfSafety = null, cagr1yr = null, cagr3yr = null, cagr5yr = null;
  if (currentPrice !== null && currentPrice > 0) {
    marginOfSafety = (intrinsicValue - currentPrice) / currentPrice;
    cagr1yr = (intrinsicValue / currentPrice) - 1;
    cagr3yr = Math.pow(intrinsicValue / currentPrice, 1 / 3) - 1;
    cagr5yr = Math.pow(intrinsicValue / currentPrice, 1 / 5) - 1;
  }

  return {
    intrinsicValue, excessReturns, pvExcessReturns, bookValues, marginOfSafety,
    cagr1yr, cagr3yr, cagr5yr,
  };
}

if (typeof module !== 'undefined') module.exports = { calculateExcessReturn };
if (typeof window !== 'undefined') window.calculateExcessReturn = calculateExcessReturn;
