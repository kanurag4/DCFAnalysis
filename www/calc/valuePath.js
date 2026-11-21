// www/dcf/calc/valuePath.js — DOM-free. Value per share at each year t = 0..N for one scenario from
// computeScenarios() (calc/assumptions.js), for /dcf/'s year-by-year chart (P62,
// docs/superpowers/specs/2026-11-10-interactive-dcf-results-design.md).
//
// The value at year t is what the scenario's own remaining cash flows are worth at t, discounted with the engine's
// own convention carried forward: the same mid-year offset m (0.5 or 0) on every remaining flow and on the terminal
// value, so path[0] equals the engine's intrinsicValue to the cent (pinned by tests/dcf-value-path.test.js).
//   DCF / DDM:      V_t = sum_{k=t+1..N} F_k / (1+r)^(k-t-m) + TV / (1+r)^(N-t-m),  TV = F_N (1+g) / (r-g)
//                   DCF converts firm value to per share: (V_t - netDebt + nonOperatingNet) / shares, and its TV is
//                   multiplied by terminalFcfFactor (the FCFF method's terminal-year tax; both default to today's 1 / 0,
//                   valuation method v2). DDM is already per share.
//   Excess Return:  V_t = BV_t + sum_{k=t+1..N} (roe - r) BV_{k-1} / (1+r)^(k-t-m),  BV_t = BV_0 (1+bvg)^t
// Every point is multiplied by (1 - holdcoDiscount) when one is set. No path for REIT / airline (a multiple has no
// time path). Authored in StockAnalysis www/dcf/calc/, vendored byte-identical into DCFAnalysis www/calc/
// (scripts/shared-files-manifest.json pair "dcf-value-path-calc").

function valuePath(scenario, model, ctx) {
  if (!scenario || !scenario.result || scenario.result.intrinsicValue == null) return null;
  if (model !== 'dcf' && model !== 'ddm' && model !== 'excess-return') return null;
  const c = ctx || {};
  const years = c.years;
  const r = scenario.wacc;
  if (!(years >= 1) || !isFinite(r)) return null;
  const m = c.midYear ? 0.5 : 0;
  const keep = c.holdcoDiscount ? 1 - c.holdcoDiscount : 1;
  const out = [];

  if (model === 'excess-return') {
    const roe = scenario.roe;
    const bv0 = scenario.result.bookValues && scenario.result.bookValues.length
      ? scenario.result.bookValues[0] / (1 + (c.bookValueGrowthRate || 0)) : null;
    if (!(bv0 > 0) || !isFinite(roe)) return null;
    const bvg = c.bookValueGrowthRate || 0;
    const bv = t => bv0 * Math.pow(1 + bvg, t);
    for (let t = 0; t <= years; t++) {
      let v = bv(t);
      for (let k = t + 1; k <= years; k++) v += (roe - r) * bv(k - 1) / Math.pow(1 + r, k - t - m);
      out.push(v * keep);
    }
    return out;
  }

  const g = scenario.terminalGrowth;
  if (!isFinite(g) || r <= g) return null;
  const flows = model === 'dcf' ? scenario.result.forecastedFcfs : scenario.result.dividends;
  if (!Array.isArray(flows) || flows.length !== years) return null;
  const tvFactor = model === 'dcf' && isFinite(c.terminalFcfFactor) ? c.terminalFcfFactor : 1;
  const tv = flows[years - 1] * (1 + g) * tvFactor / (r - g);
  for (let t = 0; t <= years; t++) {
    let v = tv / Math.pow(1 + r, years - t - m);
    for (let k = t + 1; k <= years; k++) v += flows[k - 1] / Math.pow(1 + r, k - t - m);
    if (model === 'dcf') {
      if (!(c.shares > 0)) return null;
      v = (v - (c.netDebt || 0) + (c.nonOperatingNet || 0)) / c.shares;
    }
    out.push(v * keep);
  }
  return out;
}

if (typeof module !== 'undefined') module.exports = { valuePath };
if (typeof window !== 'undefined') window.valuePath = valuePath;
