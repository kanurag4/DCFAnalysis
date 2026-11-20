function calculateDCF({
  fcf, growthRate, terminalGrowth, wacc,
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
  const terminalValue = terminalFcf * (1 + terminalGrowth) * terminalFcfFactor / (wacc - terminalGrowth);
  const terminalExponent = midYear ? projectionYears - 0.5 : projectionYears;
  const pvTerminal = terminalValue / Math.pow(1 + wacc, terminalExponent);

  const firmValue = sumPvFcfs + pvTerminal;
  const terminalValuePct = (pvTerminal / firmValue) * 100;

  const netDebt = (totalDebt || 0) - (totalCash || 0);
  const equityValue = firmValue - netDebt + nonOperatingNet;

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

// Single source of truth for the Undervalued/Fairly Valued/Overvalued
// threshold (±20% margin of safety) — previously inlined only in app.js's
// renderScenarios(), which is browser-only with no exports. That meant any
// other consumer needing the same verdict (the ticker-page generator, and
// now worker-watchlist) had no way to reuse it and had to reimplement the
// threshold by hand — the ticker-page generator did exactly that and its
// copy silently drifted to ±5% before being caught (see CLAUDE.md). This
// function is the fix: exactly one place the threshold can drift from.
function deriveVerdict(marginOfSafety) {
  if (marginOfSafety > 0.2) return 'Undervalued';
  if (marginOfSafety < -0.2) return 'Overvalued';
  return 'Fairly Valued';
}

if (typeof module !== 'undefined') module.exports = { calculateDCF, deriveVerdict };
