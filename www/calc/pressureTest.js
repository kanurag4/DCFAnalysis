// www/dcf/calc/pressureTest.js — DOM-free. "Pressure test" on /dcf/ (P62,
// docs/superpowers/specs/2026-11-10-interactive-dcf-results-design.md): the single Base-case assumption (a "lever")
// that makes the Base value equal a target — today (year 0) or at year N (via calc/valuePath.js) — holding every
// other assumption where it is. Runs the EXISTING engines through computeScenarios() (calc/assumptions.js); no maths
// of its own beyond bisection. Also inverts the discount rate back to the beta it implies.
//
// Levers (units match the seeds): growth = the seeds' growth slot (FCF growth / dividend growth / ROE, percent),
// discount = WACC or cost of equity (percent), multiple = P/AFFO or EV/EBITDA, start = starting FCF / dividend per
// share / book value per share / AFFO per share / EBITDA (currency).
// Authored in StockAnalysis www/dcf/calc/, vendored byte-identical into DCFAnalysis www/calc/
// (scripts/shared-files-manifest.json pair "dcf-pressure-test-calc").

const PT_LEVERS = {
  dcf: ['growth', 'discount', 'start'],
  ddm: ['growth', 'discount', 'start'],
  'excess-return': ['growth', 'discount', 'start'],
  reit: ['multiple', 'start'],
  airline: ['multiple', 'start'],
};
const PT_SEED_KEY = { dcf: 'dcf', ddm: 'ddm', 'excess-return': 'excessReturn', reit: 'reit', airline: 'airline' };
const PT_ITERATIONS = 100;

function ptStartOf(model, seeds, options) {
  if (model === 'dcf') {
    if (options && options.fcfRaw > 0) return { field: 'fcfRaw', value: options.fcfRaw };
    if (options && options.normFcf != null && options.normFcf > 0) return { field: 'normFcf', value: options.normFcf };
    return null;
  }
  const key = { ddm: 'dividend', 'excess-return': 'bookValue', reit: 'affoPerShare', airline: 'ebitda' }[model];
  return seeds && seeds[key] > 0 ? { field: key, value: seeds[key] } : null;
}

function ptRange(model, seeds, options, lever) {
  if (lever === 'growth') return [-50, 150];
  if (lever === 'multiple') return [0.5, 200];
  if (lever === 'discount') {
    if (model === 'excess-return') return [0.5, 60];
    const tg = seeds && seeds.tgrowth ? seeds.tgrowth.base : 0;
    return [tg + 0.05, 60];
  }
  const st = ptStartOf(model, seeds, options);
  return st ? [st.value * 0.01, st.value * 30] : null;
}

// Base value at `year` with `lever` set to `x`; null when the model gives no value there.
function ptValueAt({ data, model, seeds, options, lever, year, pathCtx }, x) {
  const s = JSON.parse(JSON.stringify(seeds));
  const o = Object.assign({}, options);
  if (lever === 'growth') s.growth.base = x;
  else if (lever === 'discount') s.discount.base = x;
  else if (lever === 'multiple') s.multiple.base = x;
  else {
    const st = ptStartOf(model, seeds, options);
    if (!st) return null;
    if (model === 'dcf') o[st.field] = x; else s[st.field] = x;
  }
  const base = computeScenarios(data, model, s, o).find(sc => sc.key === 'base');
  if (!base || !base.result) return null;
  if (!year) {
    if (base.result.intrinsicValue != null) return base.result.intrinsicValue;
    return null;
  }
  const p = valuePath(base, model, pathCtx);
  return p ? p[year] : null;
}

// The lever value (same units as the seeds) at which the Base value at `year` equals `target`; null when no value in
// the lever's range reaches it. A point where the model gives no value counts as "below every target" (it sits at
// the low-value end of every lever: negative equity, no cash flow), and the answer is re-checked before returning.
function solveLever(args) {
  const { model, seeds, options, lever, target } = args;
  if (!PT_LEVERS[model] || PT_LEVERS[model].indexOf(lever) < 0) return null;
  if ((model === 'reit' || model === 'airline') && args.year) return null;
  if (!(target > 0) || !isFinite(target)) return null;
  const range = ptRange(model, seeds, options, lever);
  if (!range) return null;
  const gap = x => {
    const v = ptValueAt(args, x);
    return v == null || !isFinite(v) ? -Infinity : v - target;
  };
  let lo = range[0], hi = range[1];
  let flo = gap(lo), fhi = gap(hi);
  if (lever === 'discount') { // value falls as the discount rate rises: flip so the search runs uphill
    const t = lo; lo = hi; hi = t; const f = flo; flo = fhi; fhi = f;
  }
  if (!(flo < 0 && fhi >= 0)) return null;
  for (let i = 0; i < PT_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (gap(mid) < 0) lo = mid; else hi = mid;
  }
  const ans = hi;
  const v = ptValueAt(args, ans);
  if (v == null || Math.abs(v - target) > Math.max(0.005, Math.abs(target) * 1e-6)) return null;
  return ans;
}

// { rf, erp, eW, dW, rd, tc } from deriveDcfAssumptions()'s result (the parts the Base discount rate was built from).
function ptWaccParts(a) {
  const w = a && a.waccResult;
  return {
    rf: a ? a.rf : null, erp: a ? a.erp : null,
    eW: w ? w.eWeight : 1, dW: w ? w.dWeight : 0, rd: w ? w.rd : 0, tc: w ? w.tc : 0,
  };
}

// The beta a discount rate (percent) implies: CAPM for DDM / Excess Return, the WACC formula for DCF.
function impliedBeta({ discountPct, model, waccParts }) {
  const p = waccParts || {};
  if (!isFinite(discountPct) || !(p.erp > 0) || !isFinite(p.rf)) return null;
  const r = discountPct / 100;
  if (model === 'ddm' || model === 'excess-return') return (r - p.rf) / p.erp;
  if (model !== 'dcf' || !(p.eW > 0)) return null;
  return ((r - p.dW * p.rd * (1 - p.tc)) / p.eW - p.rf) / p.erp;
}

if (typeof module !== 'undefined') module.exports = { PT_LEVERS, PT_SEED_KEY, solveLever, impliedBeta, ptWaccParts };
if (typeof window !== 'undefined') { window.PT_LEVERS = PT_LEVERS; window.solveLever = solveLever; window.impliedBeta = impliedBeta; window.ptWaccParts = ptWaccParts; }
