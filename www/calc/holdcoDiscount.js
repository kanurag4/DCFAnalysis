// www/dcf/calc/holdcoDiscount.js -- post-processing step applied on top of
// whichever model a conglomerate ticker's normal dispatch already selected
// (DCF/DDM/Excess Return/REIT/Airline). NOT a real segment-level
// sum-of-the-parts valuation -- Yahoo exposes no per-segment financials, so
// this is a documented flat discount instead (see config.js's
// HOLDCO_DISCOUNT and its own comment for the "why 15%, not calibrated"
// caveat). Pure, Node-testable.

// Discounts one scenario's intrinsicValue and recomputes the margin/CAGR
// figures that depend on it, leaving every other field (multiple/growthRate/
// wacc/whatever the underlying model attached) untouched. Never mutates the
// input.
function applyHoldcoDiscount(scenario, discount, currentPrice) {
  if (!scenario.result || scenario.result.intrinsicValue == null) return scenario;

  const discountedValue = scenario.result.intrinsicValue * (1 - discount);
  const updatedResult = { ...scenario.result, intrinsicValue: discountedValue, holdcoDiscountApplied: discount };

  if (currentPrice != null && isFinite(currentPrice) && currentPrice > 0) {
    updatedResult.marginOfSafety = (discountedValue - currentPrice) / currentPrice;
    updatedResult.cagr1yr = (discountedValue / currentPrice) - 1;
    updatedResult.cagr3yr = Math.pow(discountedValue / currentPrice, 1 / 3) - 1;
    updatedResult.cagr5yr = Math.pow(discountedValue / currentPrice, 1 / 5) - 1;
  }

  return { ...scenario, result: updatedResult };
}

// Applied at every one of computeScenarios()'s existing return points (see
// calc/assumptions.js) -- a true no-op (returns the same array reference)
// when discount is null, so non-conglomerate tickers pay zero cost for this
// step.
function applyHoldcoDiscountToScenarios(scenarios, discount, currentPrice) {
  if (discount == null) return scenarios;
  return scenarios.map(s => applyHoldcoDiscount(s, discount, currentPrice));
}

if (typeof module !== 'undefined') module.exports = { applyHoldcoDiscount, applyHoldcoDiscountToScenarios };
if (typeof window !== 'undefined') { window.applyHoldcoDiscount = applyHoldcoDiscount; window.applyHoldcoDiscountToScenarios = applyHoldcoDiscountToScenarios; }
