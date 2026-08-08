// Dividend Discount Model — used for banks and insurers, where FCF-based DCF is
// structurally broken (deposits/reserves aren't owner earnings). Pure, Node-testable.
//
// Multi-stage: project the current annual dividend (D0) forward `projectionYears`
// at `growthRate`, then a Gordon-growth terminal value at `terminalGrowth`, all
// discounted at the cost of equity (re). DDM values equity per share directly —
// no net-debt or shares-outstanding step.

function calculateDDM({
  dividend, growthRate, terminalGrowth, costOfEquity,
  projectionYears = 5,
  currentPrice = null,
  midYear = false,
}) {
  if (!dividend || dividend <= 0) return null;
  if (!costOfEquity || costOfEquity <= terminalGrowth) return null;

  const dividends = [];
  const pvDividends = [];
  let runningDiv = dividend;

  for (let t = 1; t <= projectionYears; t++) {
    runningDiv = runningDiv * (1 + growthRate);
    dividends.push(runningDiv);
    const exponent = midYear ? t - 0.5 : t;
    pvDividends.push(runningDiv / Math.pow(1 + costOfEquity, exponent));
  }

  const sumPvDividends = pvDividends.reduce((a, b) => a + b, 0);
  const terminalDiv = dividends[projectionYears - 1];
  const terminalValue = terminalDiv * (1 + terminalGrowth) / (costOfEquity - terminalGrowth);
  const terminalExponent = midYear ? projectionYears - 0.5 : projectionYears;
  const pvTerminal = terminalValue / Math.pow(1 + costOfEquity, terminalExponent);

  // DDM produces a per-share value directly (dividend per share in → value per share out).
  const intrinsicValue = sumPvDividends + pvTerminal;
  const terminalValuePct = (pvTerminal / intrinsicValue) * 100;

  let marginOfSafety = null, cagr1yr = null, cagr3yr = null, cagr5yr = null;
  if (currentPrice !== null && currentPrice > 0) {
    marginOfSafety = (intrinsicValue - currentPrice) / currentPrice;
    cagr1yr = (intrinsicValue / currentPrice) - 1;
    cagr3yr = Math.pow(intrinsicValue / currentPrice, 1 / 3) - 1;
    cagr5yr = Math.pow(intrinsicValue / currentPrice, 1 / 5) - 1;
  }

  return {
    intrinsicValue, sumPvDividends, pvTerminal, terminalValuePct,
    dividends, pvDividends, marginOfSafety,
    cagr1yr, cagr3yr, cagr5yr,
  };
}

if (typeof module !== 'undefined') module.exports = { calculateDDM };
