// Heavy capex spending (TODO P32, 2026-11-05) -- spec: StockAnalysis docs/superpowers/specs/2026-11-05-heavy-capex-spending-design.md.
//
// When a company's capex surges and crushes its free cash flow, while it pays for the spending from its own cash flow
// and is not in financial distress, value it as:
//   existing business  = the normal DCF scenarios run on (operating cash flow - maintenance capex)
//   + growth capex     = (capex - maintenance capex), continued for PROGRAM_YEARS, each dollar earning return R a year
//                        in perpetuity from the year after it is spent.
// Value of $1 spent in year t at time 0: ((R / w) / (1 + w) - 1) / (1 + w)^t. Base R = w: the spending pays for itself
// and nothing more ("capex is capex"). Bear / Bull: R = w -/+ RETURN_SPREAD. The return today's price implies is solved
// in closed form from the Base case.
//
// Maintenance capex = the larger of depreciation and the company's pre-build capex level (average capex / revenue of
// its two earliest fiscal years x trailing revenue): depreciation alone lags a fresh build and overstates what the
// existing business throws off.
//
// Pure: no DOM, no fetch. One copy of the method for every surface (/evaluate/, /dcf/, native, ticker pages, screens,
// Watchlist). Authored in DCFAnalysis www/calc/, vendored byte-identical into StockAnalysis www/dcf/calc/.

const HEAVY_CAPEX = {
  MIN_CAPEX_PCT_REVENUE: 0.15,
  MIN_CAPEX_TO_DEPRECIATION: 2,
  CRUSHED_FCF_SHARE: 0.5,
  MAX_CAPEX_TO_OCF: 1.5,
  PROGRAM_YEARS: 5,
  RETURN_SPREAD: 0.03,
  HIGH_IMPLIED_MULTIPLE: 2,
};

function hcFinite(v) { return (v != null && isFinite(v)) ? v : null; }

// Average capex / revenue of the two earliest fiscal years that have both, matched by calendar year of period end.
function hcPreBuildIntensity(capexHistory, revenueHistory) {
  const revByYear = {};
  (revenueHistory || []).forEach(e => {
    if (e && hcFinite(e.value) != null && e.value > 0) revByYear[String(e.date).slice(0, 4)] = e.value;
  });
  const ratios = (capexHistory || [])
    .filter(e => e && hcFinite(e.value) != null && revByYear[String(e.date).slice(0, 4)])
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map(e => Math.abs(e.value) / revByYear[String(e.date).slice(0, 4)]);
  return ratios.length >= 2 ? (ratios[0] + ratios[1]) / 2 : null;
}

// opts.ownModel: the company already has its own model or modifier (bank/insurer, REIT, airline, regulated utility,
// cyclical, financial sector). opts.altmanZone: 'safe' | 'grey' | 'distress' | null. opts.engineFcf: the FCF the DCF
// already values on -- that is what the capex crushes in the valuation; true cash FCF (OCF - capex) is the fallback.
function heavyCapexCheck(data, opts) {
  data = data || {};
  opts = opts || {};
  const capex = hcFinite(data.ttmCapex);
  const revenue = hcFinite(data.totalRevenue);
  const ocf = hcFinite(data.ttmOcf) ?? hcFinite(data.operatingCashflow);
  const depreciation = hcFinite(data.ttmDepreciation);
  const fcfNow = hcFinite(opts.engineFcf) ?? (capex != null && ocf != null ? ocf - capex : null);
  const fcfHistory = (data.annualFcfHistory || []).map(e => e && hcFinite(e.value)).filter(v => v != null);
  const bestFcf = fcfHistory.length ? Math.max(...fcfHistory) : null;
  const preBuildIntensity = hcPreBuildIntensity(data.annualCapexHistory, data.annualRevenueHistory);
  const preBuildMaintenance = preBuildIntensity != null && revenue > 0 ? preBuildIntensity * revenue : null;
  const maintenance = depreciation == null ? null
    : (preBuildMaintenance != null ? Math.max(depreciation, preBuildMaintenance) : depreciation);
  const metrics = {
    capex, revenue, ocf, depreciation, maintenance, preBuildIntensity, fcfNow, bestFcf,
    lastQuarterCapex: hcFinite(data.lastQuarterCapex),
    capexPctRevenue: capex != null && revenue > 0 ? capex / revenue : null,
    capexToDepreciation: capex != null && depreciation > 0 ? capex / depreciation : null,
    capexToOcf: capex != null && ocf > 0 ? capex / ocf : null,
    fcfShareOfBest: fcfNow != null && bestFcf > 0 ? fcfNow / bestFcf : null,
  };
  const H = HEAVY_CAPEX;
  const tests = [
    { key: 'model', label: 'No sector-specific model already applies', pass: !opts.ownModel },
    { key: 'size', label: 'Capex is at least 15% of revenue', pass: metrics.capexPctRevenue != null && metrics.capexPctRevenue >= H.MIN_CAPEX_PCT_REVENUE },
    { key: 'surge', label: 'Capex is at least twice depreciation', pass: metrics.capexToDepreciation != null && metrics.capexToDepreciation >= H.MIN_CAPEX_TO_DEPRECIATION },
    { key: 'crushed', label: 'Free cash flow is negative or below half its best recent year', pass: fcfNow != null && (fcfNow <= 0 || (metrics.fcfShareOfBest != null && metrics.fcfShareOfBest < H.CRUSHED_FCF_SHARE)) },
    { key: 'funded', label: 'Capex is at most 1.5 times operating cash flow', pass: metrics.capexToOcf != null && metrics.capexToOcf <= H.MAX_CAPEX_TO_OCF },
    { key: 'solvent', label: 'Altman Z-Score is not in the Distress Zone', pass: opts.altmanZone !== 'distress' },
  ];
  return { applies: tests.every(t => t.pass) && maintenance != null, tests, metrics };
}

// The FCF every surface passes to its DCF for the existing business.
function heavyCapexExistingFcf(check) {
  return check.metrics.ocf - check.metrics.maintenance;
}

function hcAnnuity(w, years) {
  let s = 0;
  for (let t = 1; t <= years; t++) s += 1 / Math.pow(1 + w, t);
  return s;
}

const HC_EPS = 1e-12;

// dcfScenarios: [{ key: 'bear'|'base'|'bull', wacc, result: { intrinsicValue, ... } | null, ... }] -- the existing
// business, i.e. computeScenarios(data, 'dcf', seeds, { fcfRaw: heavyCapexExistingFcf(check), ... }) or equivalent.
function heavyCapexValuation(data, check, dcfScenarios) {
  const m = check.metrics;
  const shares = data.dilutedSharesOutstanding > 0 ? data.dilutedSharesOutstanding : data.sharesOutstanding;
  const growthCapex = m.capex - m.maintenance;
  const price = data.price;
  const spread = { bear: -HEAVY_CAPEX.RETURN_SPREAD, base: 0, bull: HEAVY_CAPEX.RETURN_SPREAD };
  const scenarios = (dcfScenarios || []).map((s) => {
    const existing = s.result ? hcFinite(s.result.intrinsicValue) : null;
    const w = s.wacc;
    if (existing == null || !(shares > 0) || !(w > 0)) return { ...s, result: null };
    const returnOnCapex = w + (spread[s.key] || 0);
    const pvCapexPerShare = growthCapex * hcAnnuity(w, HEAVY_CAPEX.PROGRAM_YEARS) / shares;
    const capexValuePerShare = pvCapexPerShare * ((returnOnCapex / w) / (1 + w) - 1);
    const intrinsicValue = existing + capexValuePerShare;
    return {
      ...s, returnOnCapex, existingValue: existing, pvCapexPerShare, capexValuePerShare,
      result: { ...s.result, intrinsicValue, marginOfSafety: price > 0 ? (intrinsicValue - price) / price : null },
    };
  });
  const base = scenarios.find(s => s.key === 'base');
  let implied = null;
  if (base && base.result && price > 0 && base.pvCapexPerShare > 0) {
    const w = base.wacc;
    const r = w * (1 + w) * (1 + (price - base.existingValue) / base.pvCapexPerShare);
    const status = r <= HC_EPS ? 'not-meaningful'
      : (r > HEAVY_CAPEX.HIGH_IMPLIED_MULTIPLE * w + HC_EPS ? 'high' : 'normal');
    implied = { returnOnCapex: r, costOfCapital: w, status, existingValue: base.existingValue, pvCapexPerShare: base.pvCapexPerShare };
  }
  return {
    scenarios, implied,
    existingFcf: heavyCapexExistingFcf(check), growthCapex,
    lastQuarterRunRate: m.lastQuarterCapex != null ? m.lastQuarterCapex * 4 : null,
  };
}

if (typeof module !== 'undefined') module.exports = { HEAVY_CAPEX, heavyCapexCheck, heavyCapexValuation, heavyCapexExistingFcf };
if (typeof window !== 'undefined') {
  window.HEAVY_CAPEX = HEAVY_CAPEX; window.heavyCapexCheck = heavyCapexCheck;
  window.heavyCapexValuation = heavyCapexValuation; window.heavyCapexExistingFcf = heavyCapexExistingFcf;
}
