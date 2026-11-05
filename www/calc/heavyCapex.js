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

// Resolve a sibling module's export: the browser global when the page loaded it, else require() (Node, Workers bundle).
function hcDep(name, globalFn, path) {
  if (typeof globalFn === 'function') return globalFn;
  if (typeof require === 'function') return require(path)[name];
  return null;
}

// Altman Z zone ('safe' | 'grey' | 'distress' | null) from exactly the inputs /evaluate/'s Solvency Check uses
// (evaluate-core.js solvencyFor), so every surface blocks the same distressed companies.
function heavyCapexAltmanZone(data) {
  const isFin = hcDep('isFinancialSector', typeof isFinancialSector === 'function' ? isFinancialSector : null, '../utils.js');
  const isRe = hcDep('isReit', typeof isReit === 'function' ? isReit : null, '../utils.js');
  if ((isFin && isFin(data.sector)) || (isRe && isRe(data.sector, data.industry))) return null;
  const align = hcDep('alignFiscalYears', typeof alignFiscalYears === 'function' ? alignFiscalYears : null, './fiscalYearAlign.js');
  const altman = hcDep('altmanZScore', typeof altmanZScore === 'function' ? altmanZScore : null, './altmanZ.js');
  if (!align || !altman) return null;
  const years = align({
    netIncome: data.annualNetIncomeHistory, totalAssets: data.annualTotalAssetsHistory, fcf: data.annualFcfHistory,
    capex: data.annualCapexHistory, totalDebt: data.annualTotalDebtHistory, totalLiabilities: data.annualTotalLiabilitiesHistory,
    currentAssets: data.annualCurrentAssetsHistory, currentLiabilities: data.annualCurrentLiabilitiesHistory,
    shares: data.annualSharesHistory, revenue: data.annualRevenueHistory, grossProfit: data.annualGrossProfitHistory,
  });
  const re = data.annualRetainedEarningsHistory;
  const lastRe = Array.isArray(re) && re.length ? hcFinite(re[re.length - 1] && re[re.length - 1].value) : null;
  const y = years[0];
  const z = altman({
    totalAssets: y ? y.totalAssets : null, currentAssets: y ? y.currentAssets : null,
    currentLiabilities: y ? y.currentLiabilities : null, retainedEarnings: lastRe, ebit: data.ebit,
    marketCap: data.marketCap, totalLiabilities: y ? y.totalLiabilities : null, revenue: y ? y.revenue : null,
  });
  return z ? z.zone : null;
}

// THE entry point for every surface: the six tests for one company, from its deriveDcfAssumptions() result.
// Only a company whose model would be plain DCF (or Growth, its negative-FCF fallback) can qualify.
function heavyCapexForAssumptions(data, assumptions) {
  const isFin = hcDep('isFinancialSector', typeof isFinancialSector === 'function' ? isFinancialSector : null, '../utils.js');
  const ownModel = !assumptions || assumptions.valuationModel !== 'dcf' || !!assumptions.isCyclical
    || !!(isFin && isFin(data.sector));
  return heavyCapexCheck(data, {
    ownModel,
    altmanZone: heavyCapexAltmanZone(data),
    engineFcf: assumptions && assumptions.fcfInfo ? assumptions.fcfInfo.value : null,
  });
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

// The card's wording, written once for every surface (web /evaluate/, /dcf/, native, ticker pages). Plain text: the
// renderer escapes it. headline is [lead, emphasised figure, tail]. fmt: { money(perShare), moneyBig(total), pct(ratio) }.
// Never judges the implied return (AFSL): it says what the price assumes, not whether that is achievable.
function heavyCapexCardText(hc, fmt) {
  const m = hc.check.metrics, v = hc.valuation, i = v.implied;
  const base = (v.scenarios || []).find(s => s.key === 'base');
  const existingValue = i ? i.existingValue : (base ? base.existingValue : null);
  let headline;
  if (!i) {
    headline = ['', 'The implied return could not be worked out', ' for this company.'];
  } else if (i.status === 'not-meaningful') {
    headline = ['Implied return on the new spending: ', 'not meaningful',
      '. Our value for the existing business alone (' + fmt.money(existingValue) + ' a share) is already above today\'s price ('
      + fmt.money(fmt.price) + '), so the price says nothing positive about returns on the new spending.'];
  } else {
    let tail = ', against a cost of capital of ' + fmt.pct(i.costOfCapital) + '.';
    if (i.status === 'high') {
      tail += ' That is far above the cost of capital. Part of the gap is likely the market expecting faster growth from the '
        + 'existing business than this model assumes, not only returns on the new spending.';
    }
    headline = ['Today\'s price of ' + fmt.money(fmt.price) + ' assumes the new spending earns about ', fmt.pct(i.returnOnCapex) + ' a year', tail];
  }
  let facts = 'Capex of ' + fmt.moneyBig(m.capex) + ' over the last 12 months is ' + fmt.pct(m.capexPctRevenue) + ' of revenue, '
    + m.capexToDepreciation.toFixed(1) + 'x depreciation and ' + m.capexToOcf.toFixed(2) + 'x operating cash flow. '
    + 'Free cash flow used in the valuation: ' + fmt.moneyBig(m.fcfNow)
    + (m.bestFcf != null ? ', against ' + fmt.moneyBig(m.bestFcf) + ' in its best recent year.' : '.');
  if (v.lastQuarterRunRate != null) facts += ' The latest quarter runs at ' + fmt.moneyBig(v.lastQuarterRunRate) + ' a year.';
  const existing = 'Existing business: ' + fmt.money(existingValue) + ' a share, valued on operating cash flow minus the capex '
    + 'needed to keep it running (' + fmt.moneyBig(v.existingFcf) + ' a year). New spending above that: '
    + fmt.moneyBig(v.growthCapex) + ' a year, assumed for ' + HEAVY_CAPEX.PROGRAM_YEARS + ' years.';
  const method = 'Base assumes the new spending earns exactly its cost of capital, so it pays for itself and nothing more; '
    + 'Bear assumes ' + Math.round(HEAVY_CAPEX.RETURN_SPREAD * 100) + ' points less, Bull ' + Math.round(HEAVY_CAPEX.RETURN_SPREAD * 100)
    + ' points more. This shows what the price implies; it is not a view on whether that return is achievable.';
  return { title: 'Heavy capex spending', headline, facts, existing, method, tests: (hc.check.tests || []).map(t => ({ label: t.label, pass: t.pass })) };
}

if (typeof module !== 'undefined') module.exports = { HEAVY_CAPEX, heavyCapexCheck, heavyCapexValuation, heavyCapexExistingFcf, heavyCapexCardText, heavyCapexAltmanZone, heavyCapexForAssumptions };
if (typeof window !== 'undefined') {
  window.HEAVY_CAPEX = HEAVY_CAPEX; window.heavyCapexCheck = heavyCapexCheck;
  window.heavyCapexValuation = heavyCapexValuation; window.heavyCapexExistingFcf = heavyCapexExistingFcf;
  window.heavyCapexCardText = heavyCapexCardText; window.heavyCapexAltmanZone = heavyCapexAltmanZone;
  window.heavyCapexForAssumptions = heavyCapexForAssumptions;
}
