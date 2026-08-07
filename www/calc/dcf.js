function calculateDCF({
  fcf, growthRate, terminalGrowth, wacc,
  projectionYears = 5,
  totalDebt = 0, totalCash = 0,
  sharesOutstanding = null, currentPrice = null,
  midYear = false,
}) {
  if (!fcf || fcf <= 0) return null;
  if (!wacc || wacc <= terminalGrowth) return null;

  const forecastedFcfs = [];
  const pvFcfs = [];
  let runningFcf = fcf;

  for (let t = 1; t <= projectionYears; t++) {
    runningFcf = runningFcf * (1 + growthRate);
    forecastedFcfs.push(runningFcf);
    const exponent = midYear ? t - 0.5 : t;
    pvFcfs.push(runningFcf / Math.pow(1 + wacc, exponent));
  }

  const sumPvFcfs = pvFcfs.reduce((a, b) => a + b, 0);
  const terminalFcf = forecastedFcfs[projectionYears - 1];
  const terminalValue = terminalFcf * (1 + terminalGrowth) / (wacc - terminalGrowth);
  const terminalExponent = midYear ? projectionYears - 0.5 : projectionYears;
  const pvTerminal = terminalValue / Math.pow(1 + wacc, terminalExponent);

  const firmValue = sumPvFcfs + pvTerminal;
  const terminalValuePct = (pvTerminal / firmValue) * 100;

  const netDebt = (totalDebt || 0) - (totalCash || 0);
  const equityValue = firmValue - netDebt;

  // Net debt exceeds firm value — equity is worthless under DCF assumptions.
  // Return null intrinsicValue so the UI can show a meaningful message rather
  // than a nonsense negative share price.
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

if (typeof module !== 'undefined') module.exports = { calculateDCF };
