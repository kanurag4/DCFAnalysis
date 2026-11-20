// www/dcf/calc/fadingGrowthDcf.js — DOM-free.
//
// FCF-growth-fade DCF: unlike calc/dcf.js's calculateDCF, which applies one
// constant growth rate for every forecast year before jumping straight to
// the terminal growth rate, this fades the growth rate linearly from
// `initialGrowth` (year 1) down to `terminalGrowth` (year N) -- closer to
// how a real company's growth actually decays. Same fade convention as
// www/growth/calc/multiStageDcf.js: frac = (t-1)/(N-1), so year 1 keeps the
// full initialGrowth and year N already equals terminalGrowth exactly,
// which is what makes the terminal-value formula valid immediately after
// year N.
//
// Return shape matches calculateDCF's exactly (intrinsicValue, firmValue,
// equityValue, netDebt, pvFcfs, pvTerminal, terminalValuePct,
// forecastedFcfs, marginOfSafety, cagr1yr/3yr/5yr, negativeEquity) so
// app.js's renderScenarios()/renderCharts() work unchanged regardless of
// which of the two functions produced a given scenario's result.
//
// Kept as a separate function from calculateDCF (not a mode flag on it) so
// the existing single-stage path is untouched for positive-base-growth
// tickers. Wired into every "Most Undervalued" screen's evaluate.js as of
// 2026-08-22 (previously only the live tool + per-ticker pages had it --
// see kashvector-lessons.md for the TLC.AX incident that surfaced the gap).

function calculateFadingGrowthDCF({
  fcf, initialGrowth, terminalGrowth, wacc,
  projectionYears = 5,
  totalDebt = 0, totalCash = 0,
  sharesOutstanding = null, currentPrice = null,
  midYear = false,
  // Valuation method v2 (2026-11-21, /dcf/ toggle only): terminalFcfFactor taxes the terminal year at the marginal
  // rate (calc/fcff.js); nonOperatingNet = stakes - minority interests, added to equity. Defaults = today exactly.
  terminalFcfFactor = 1, nonOperatingNet = 0,
}) {
  if (!fcf || fcf <= 0) return null;
  if (!wacc || wacc <= terminalGrowth) return null;
  if (!projectionYears || projectionYears < 2) return null;

  const forecastedFcfs = [];
  const pvFcfs = [];
  let runningFcf = fcf;

  for (let t = 1; t <= projectionYears; t++) {
    const frac = (t - 1) / (projectionYears - 1);
    const growthT = initialGrowth + (terminalGrowth - initialGrowth) * frac;
    runningFcf = runningFcf * (1 + growthT);
    forecastedFcfs.push(runningFcf);
    const exponent = midYear ? t - 0.5 : t;
    pvFcfs.push(runningFcf / Math.pow(1 + wacc, exponent));
  }

  const sumPvFcfs = pvFcfs.reduce((a, b) => a + b, 0);
  const terminalFcf = forecastedFcfs[projectionYears - 1];
  const terminalValue = terminalFcf * (1 + terminalGrowth) * terminalFcfFactor / (wacc - terminalGrowth);
  const terminalExponent = midYear ? projectionYears - 0.5 : projectionYears;
  const pvTerminal = terminalValue / Math.pow(1 + wacc, terminalExponent);

  const firmValue = sumPvFcfs + pvTerminal;
  const terminalValuePct = (pvTerminal / firmValue) * 100;

  const netDebt = (totalDebt || 0) - (totalCash || 0);
  const equityValue = firmValue - netDebt + nonOperatingNet;

  if (equityValue < 0) {
    return {
      intrinsicValue: null, firmValue, equityValue, netDebt,
      pvFcfs, pvTerminal, terminalValuePct,
      forecastedFcfs, marginOfSafety: null,
      cagr1yr: null, cagr3yr: null, cagr5yr: null,
      negativeEquity: true,
    };
  }

  let intrinsicValue = null;
  if (sharesOutstanding && sharesOutstanding > 0) {
    intrinsicValue = equityValue / sharesOutstanding;
  }

  let marginOfSafety = null, cagr1yr = null, cagr3yr = null, cagr5yr = null;
  if (intrinsicValue !== null && currentPrice !== null && currentPrice > 0) {
    marginOfSafety = (intrinsicValue - currentPrice) / currentPrice;
    cagr1yr = (intrinsicValue / currentPrice) - 1;
    cagr3yr = Math.pow(intrinsicValue / currentPrice, 1 / 3) - 1;
    cagr5yr = Math.pow(intrinsicValue / currentPrice, 1 / 5) - 1;
  }

  return {
    intrinsicValue, firmValue, equityValue, netDebt,
    pvFcfs, pvTerminal, terminalValuePct,
    forecastedFcfs, marginOfSafety,
    cagr1yr, cagr3yr, cagr5yr,
    negativeEquity: false,
  };
}

if (typeof module !== 'undefined') module.exports = { calculateFadingGrowthDCF };
