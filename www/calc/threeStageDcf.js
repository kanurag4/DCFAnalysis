// Three-stage, cycle-normalised DCF ("method 4", Damodaran style) -- spec
// StockAnalysis docs/superpowers/specs/2026-11-07-dcf-three-stage-normalised-design.md.
//
//   revenue base     trailing-12-month revenue
//   margin           mean operating income / revenue over the latest 4 fiscal years, held flat
//   starting growth  the company's own revenue trend: the latest year-on-year rate x the average ratio of
//                    successive rates (never above the latest rate), clamped to [-5%, 15%]
//   shape            years 1-5 at the starting growth, years 6-10 a straight line to the market's terminal rate,
//                    terminal value from year 11
//   reinvestment     revenue added / sales-to-capital (own 4-year ratio, else Damodaran's industry figure);
//                    terminal reinvestment = g / ROC, ROC = margin x (1 - tax) x sales-to-capital
//   discount rate    WACC with a bottom-up beta: industry unlevered beta x (1 + (1 - t) x D/E)
//
// Pure: no DOM, no fetch. Reads industryBetas.js, utils.js (deriveMultiYearGrowth) and assumptions.js
// (detectMarket, MARKET_TGROWTH) as browser globals, or require()s them in Node. Authored in StockAnalysis
// www/dcf/calc/, vendored byte-identical into DCFAnalysis www/calc/ (manifest pair "dcf-three-stage-calc").

// Off until the user approves the before/after report (plan Task 13). Every consumer reads it from here.
const THREE_STAGE_DCF_ENABLED = false;

// Scope (user decision 2026-11-08): US market only; every other market keeps the classic DCF. "US" = a ticker with
// no exchange suffix -- assumptions.js detectMarket()'s 'us' rule (US-listed ADRs such as TSM count as US). Written
// out here rather than calling detectMarket, which reads browser globals Node consumers don't have.
function threeStageApplies(data) {
  const t = data && data.ticker;
  return typeof t === 'string' && t.length > 0 && !t.includes('.');
}

// Eligibility (peer review 2026-11-08): a US ticker AND positive trailing free cash flow (cycle-normalised fcfInfo),
// the rule /evaluate/'s chooseEvaluationModel already uses -- a negative-FCF company goes to Growth / stays excluded
// on every surface, so the screens' coverage does not widen. Every consumer passes its own fcfInfo.value.
function threeStageEligible(data, fcfValue) {
  return threeStageApplies(data) && fcfValue != null && isFinite(fcfValue) && fcfValue > 0;
}

// US lenders (user decision 2026-11-08): with the three-stage switch on, a US credit-services or mortgage firm whose
// interest expense is at least this share of revenue is valued with the bank models (DDM / Excess Return), as
// Damodaran does -- debt is a lender's raw material, so a revenue-driven FCFF with net debt subtracted wipes out
// the equity (COF: no value). Payment networks share the Yahoo industry but not the economics: COF 32%, SYF 42%,
// ALLY 80%, AXP 11% vs V 1.3%, MA 2.0%, PYPL 1.3% (2026-11-08). Non-US credit services keep the existing rule
// (utils.js isBankOrInsurance routes India's NBFCs).
const THREE_STAGE_LENDER_INTEREST_SHARE = 0.10;

function threeStageLender(data) {
  if (!threeStageApplies(data)) return false;
  if (!/^(credit services|mortgage finance)$/i.test(String(data.industry || ''))) return false;
  const interest = tsNum(data.interestExpense), revenue = tsNum(data.totalRevenue);
  return interest !== null && revenue > 0 && Math.abs(interest) / revenue >= THREE_STAGE_LENDER_INTEREST_SHARE;
}

// Latest 4 fiscal years -- same window as utils.js's HISTORY_WINDOW_YEARS (own name: these files share one browser
// global scope; tests/history-window.test.js keeps them equal).
const THREE_STAGE_HISTORY_YEARS = 4;
const THREE_STAGE_GROWTH_MIN = -0.05;
const THREE_STAGE_GROWTH_MAX = 0.15;
const THREE_STAGE_HIGH_YEARS = 5;
const THREE_STAGE_FADE_YEARS = 5;
const THREE_STAGE_S2C_MIN = 0.5;
const THREE_STAGE_S2C_MAX = 10;
const THREE_STAGE_S2C_INDUSTRY_CAP = 3;
const THREE_STAGE_DEFAULT_TAX = 0.25;
const THREE_STAGE_NEGATIVE_MARGIN_NOTE = "Operating margin averaged over the last four years is negative — this model can't value it.";
const THREE_STAGE_NO_MARGIN_NOTE = "There is no operating margin history for this company — this model can't value it.";

function tsDeps() {
  if (typeof industryFor === 'function' && typeof deriveMultiYearGrowth === 'function' && typeof detectMarket === 'function'
    && typeof growthOffsetSpread === 'function') {
    return { industryFor, deriveMultiYearGrowth, detectMarket, MARKET_TGROWTH, MARKET_TGROWTH_DEFAULT, growthOffsetSpread, discountRateSpread };
  }
  const a = require('./assumptions.js');
  return {
    industryFor: require('./industryBetas.js').industryFor,
    deriveMultiYearGrowth: require('../utils.js').deriveMultiYearGrowth,
    detectMarket: a.detectMarket, MARKET_TGROWTH: a.MARKET_TGROWTH, MARKET_TGROWTH_DEFAULT: a.MARKET_TGROWTH_DEFAULT,
    growthOffsetSpread: a.growthOffsetSpread, discountRateSpread: a.discountRateSpread,
  };
}

// A percent with at most 2 decimals -> its exact fraction (5.27 -> 0.0527, never 0.052699999...).
function threeStagePctToFraction(pct) { return Math.round(pct * 100) / 10000; }

function tsNum(v) { return (v != null && isFinite(v)) ? v : null; }

// Entries with a date and a finite value, oldest first, the newest THREE_STAGE_HISTORY_YEARS of them.
function tsLatest(series) {
  const arr = (Array.isArray(series) ? series : []).filter(e => e && e.date && tsNum(e.value) !== null);
  return arr.slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-THREE_STAGE_HISTORY_YEARS);
}

function tsByDate(series) {
  const m = new Map();
  for (const e of (Array.isArray(series) ? series : [])) if (e && e.date && tsNum(e.value) !== null) m.set(String(e.date), e.value);
  return m;
}

function tsTax(taxRate) {
  return (taxRate != null && isFinite(taxRate) && taxRate >= 0 && taxRate < 1) ? taxRate : THREE_STAGE_DEFAULT_TAX;
}

function tsClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// An operating LOSS beside a net PROFIT, by more than 1% of revenue, is treated as a Yahoo data error: seen on WOW.AX
// (2026-11-08), operating income -$1.15B / -$1.04B against net income +$0.11B / +$0.96B, which gave Woolworths a
// negative four-year margin and no value. Narrowed after peer review: a real year with a one-off gain (operating
// income positive, net income higher) stays in, and so does a small loss beside a small profit. Such years are
// dropped (droppedYears counts them, and every surface shows it); a real loss year (net income negative too) stays
// in, so a boom-bust cycle still averages its bust.
const THREE_STAGE_SUSPECT_GAP = 0.01;
function tsOperatingIncomeSuspect(opInc, netIncome, revenue) {
  return netIncome != null && netIncome > 0 && opInc <= 0 && (netIncome - opInc) > THREE_STAGE_SUSPECT_GAP * revenue;
}

function cycleAverageMargin(data) {
  const d = data || {};
  const opInc = tsByDate(d.annualOperatingIncomeHistory);
  const netInc = tsByDate(d.annualNetIncomeHistory);
  let droppedYears = 0;
  const matched = tsLatest((Array.isArray(d.annualRevenueHistory) ? d.annualRevenueHistory : [])
    .filter(e => e && e.date && tsNum(e.value) !== null && e.value > 0 && opInc.has(String(e.date))))
    .filter(e => {
      const k = String(e.date);
      if (tsOperatingIncomeSuspect(opInc.get(k), netInc.has(k) ? netInc.get(k) : null, e.value)) { droppedYears++; return false; }
      return true;
    })
    .map(e => ({ date: e.date, value: opInc.get(String(e.date)) / e.value }));
  const years = matched;
  if (years.length >= 2) {
    return { value: years.reduce((s, e) => s + e.value, 0) / years.length, years: years.length, source: 'history', droppedYears };
  }
  const ttm = tsNum(d.operatingMargins);
  if (ttm !== null) return { value: ttm, years: years.length, source: 'ttm', droppedYears };
  return { value: null, years: years.length, source: null, droppedYears };
}

// Trailing revenue (quoteSummary) and the annual revenue series (/timeseries) can be on different bases: MAR's
// trailing $7.6B excludes the cost reimbursements in its ~$25B annual series (2026-11-08). The margin comes from the
// annual series, so when trailing revenue is more than this share BELOW the latest annual figure AND the latest
// quarter shows no collapse (Yahoo's year-on-year revenueGrowth above THREE_STAGE_COLLAPSE), the annual figure is the
// base instead. A real collapse (memory or commodity bust) shows in revenueGrowth and keeps the trailing figure, so a
// company is never valued off pre-collapse revenue; no revenueGrowth = no evidence = trailing (peer review). One-sided:
// a fast grower's trailing revenue sits above its last fiscal year (NVDA $303B vs FY $216B) -- that is growth.
const THREE_STAGE_REVENUE_MISMATCH = 0.4;
const THREE_STAGE_COLLAPSE = -0.2;

function tsRevenueBase(d) {
  const ttm = tsNum(d.totalRevenue);
  const latest = tsLatest(d.annualRevenueHistory).filter(e => e.value > 0).pop();
  const quarterGrowth = tsNum(d.revenueGrowth);
  if (!(ttm > 0) && latest) return { revenue: latest.value, source: 'annual' };
  if (latest && ttm < latest.value * (1 - THREE_STAGE_REVENUE_MISMATCH) && quarterGrowth !== null && quarterGrowth > THREE_STAGE_COLLAPSE) {
    return { revenue: latest.value, source: 'annual' };
  }
  return { revenue: ttm, source: 'ttm' };
}

function revenueTrendGrowth(data) {
  const d = data || {};
  const rev = tsLatest(d.annualRevenueHistory).filter(e => e.value > 0);
  if (rev.length < 2) {
    return { value: tsDeps().deriveMultiYearGrowth(d), raw: null, source: 'fallback' };
  }
  const rates = [];
  for (let i = 1; i < rev.length; i++) rates.push(rev[i].value / rev[i - 1].value - 1);
  const latest = rates[rates.length - 1];
  // The ratio of one year's growth to the year before only means something when both are positive: a negative
  // year in between would flip the sign of the momentum.
  const ratios = [];
  for (let i = 1; i < rates.length; i++) if (rates[i] > 0 && rates[i - 1] > 0) ratios.push(rates[i] / rates[i - 1]);
  let raw = latest;
  if (latest > 0 && ratios.length) raw = Math.min(latest, latest * (ratios.reduce((s, r) => s + r, 0) / ratios.length));
  return { value: tsClamp(raw, THREE_STAGE_GROWTH_MIN, THREE_STAGE_GROWTH_MAX), raw, source: 'trend' };
}

// Revenue added over the window / net capex (|capex| - D&A) over the later years. null when it can't be measured:
// a later year without capex or D&A, revenue that didn't grow, or net capex that isn't positive.
function ownSalesToCapital(data) {
  const d = data || {};
  const rev = tsLatest(d.annualRevenueHistory);
  if (rev.length < 2) return null;
  const capex = tsByDate(d.annualCapexHistory);
  const dep = tsByDate(d.annualDepreciationHistory);
  let netCapex = 0;
  for (const e of rev.slice(1)) {
    const k = String(e.date);
    if (!capex.has(k) || !dep.has(k)) return null;
    netCapex += Math.abs(capex.get(k)) - dep.get(k);
  }
  const added = rev[rev.length - 1].value - rev[0].value;
  if (!(added > 0) || !(netCapex > 0)) return null;
  return tsClamp(added / netCapex, THREE_STAGE_S2C_MIN, THREE_STAGE_S2C_MAX);
}

// Payment networks (V, MA, PYPL) share Yahoo's "Credit Services" with lenders but not their economics; once lenders
// go to the bank models (threeStageLender), the rest take Damodaran's Information Services row instead of the
// lender-heavy "Financial Svcs." row (beta 0.33, S2C 0.07) -- peer review 2026-11-08 (V: beta 0.34, Base $202 -> $481).
const THREE_STAGE_NON_LENDER_PROXY = 'Financial Data & Stock Exchanges'; // the Yahoo industry mapped to Information Services
function tsBetaIndustry(data) {
  const ind = String((data && data.industry) || '');
  return /^(credit services|mortgage finance)$/i.test(ind) && !threeStageLender(data) ? THREE_STAGE_NON_LENDER_PROXY : ind;
}

function bottomUpBeta({ industry, marketCap, totalDebt, taxRate } = {}) {
  const ind = tsDeps().industryFor(industry);
  const debtToEquity = (marketCap > 0 && totalDebt > 0) ? totalDebt / marketCap : 0;
  const beta = ind.unleveredBeta * (1 + (1 - tsTax(taxRate)) * debtToEquity);
  return { beta, unlevered: ind.unleveredBeta, industry: ind.name, mapped: ind.mapped, debtToEquity, salesToCapital: ind.salesToCapital };
}

function calculateThreeStageDCF({
  revenue, startGrowth, terminalGrowth, margin, salesToCapital, wacc, taxRate,
  totalDebt = 0, totalCash = 0, shares = null, currentPrice = null,
} = {}) {
  if (!(revenue > 0) || !(margin > 0) || !(salesToCapital > 0)) return null;
  if (tsNum(startGrowth) === null || tsNum(terminalGrowth) === null) return null;
  if (!(wacc > 0) || wacc <= terminalGrowth) return null;
  const t = tsTax(taxRate);
  const years = THREE_STAGE_HIGH_YEARS + THREE_STAGE_FADE_YEARS;
  const revenues = [], growthRates = [], fcfs = [], pvFcfs = [];
  let prev = revenue;
  for (let y = 1; y <= years; y++) {
    const g = y <= THREE_STAGE_HIGH_YEARS
      ? startGrowth
      : startGrowth + (terminalGrowth - startGrowth) * (y - THREE_STAGE_HIGH_YEARS) / THREE_STAGE_FADE_YEARS;
    const rev = prev * (1 + g);
    const fcf = rev * margin * (1 - t) - (rev - prev) / salesToCapital;
    revenues.push(rev); growthRates.push(g); fcfs.push(fcf);
    pvFcfs.push(fcf / Math.pow(1 + wacc, y));
    prev = rev;
  }
  const roc = margin * (1 - t) * salesToCapital;
  const terminalFcf = roc <= terminalGrowth ? 0 : prev * (1 + terminalGrowth) * margin * (1 - t) * (1 - terminalGrowth / roc);
  const terminalValue = terminalFcf / (wacc - terminalGrowth);
  const pvTerminal = terminalValue / Math.pow(1 + wacc, years);
  const firmValue = pvFcfs.reduce((s, v) => s + v, 0) + pvTerminal;
  const terminalValuePct = firmValue !== 0 ? (pvTerminal / firmValue) * 100 : null;
  const netDebt = (totalDebt || 0) - (totalCash || 0);
  const equityValue = firmValue - netDebt;
  const base = { firmValue, equityValue, netDebt, revenues, growthRates, fcfs, forecastedFcfs: fcfs, pvFcfs,
    terminalFcf, terminalValue, pvTerminal, terminalValuePct, roc };
  if (equityValue < 0) return { ...base, intrinsicValue: null, marginOfSafety: null, negativeEquity: true };
  const intrinsicValue = (shares > 0) ? equityValue / shares : null;
  const marginOfSafety = (intrinsicValue !== null && currentPrice > 0) ? (intrinsicValue - currentPrice) / currentPrice : null;
  return { ...base, intrinsicValue, marginOfSafety, negativeEquity: false };
}

// Every input the model needs for one company. waccResult = calculateWACC()'s output (its weights, cost of debt,
// tax and rates are reused; only the beta in the cost of equity is replaced). terminalGrowth (a fraction) may be
// passed by a caller that already has its market's rate; otherwise it comes from assumptions.js's MARKET_TGROWTH.
// Callers value nothing when `note` is set.
function threeStageInputs(data, { waccResult, terminalGrowth: tgIn } = {}) {
  const d = data || {};
  const deps = tsDeps();
  const terminalGrowth = tsNum(tgIn) !== null
    ? tgIn
    : (deps.MARKET_TGROWTH[deps.detectMarket(d.ticker)] ?? deps.MARKET_TGROWTH_DEFAULT) / 100;
  const margin = cycleAverageMargin(d);
  const growth = revenueTrendGrowth(d);
  const betaInfo = bottomUpBeta({ industry: tsBetaIndustry(d), marketCap: d.marketCap, totalDebt: d.totalDebt, taxRate: d.taxRate });
  // The company's own ratio counts bought-in revenue but not acquisition spend (no such series from the Worker), so
  // it is capped at THREE_STAGE_S2C_INDUSTRY_CAP x its industry's figure (peer review: NVDA and V both hit 10).
  const ownRaw = ownSalesToCapital(d);
  const ownCap = betaInfo.salesToCapital > 0 ? betaInfo.salesToCapital * THREE_STAGE_S2C_INDUSTRY_CAP : Infinity;
  const own = ownRaw !== null ? Math.min(ownRaw, ownCap) : null;
  const s2cCapped = ownRaw !== null && ownRaw > ownCap;
  const salesToCapital = own !== null ? own : betaInfo.salesToCapital;
  const taxRate = waccResult && tsNum(waccResult.tc) !== null ? waccResult.tc : tsTax(d.taxRate);
  const wacc = waccResult
    ? waccResult.eWeight * (waccResult.riskFreeRate + betaInfo.beta * waccResult.erp) + waccResult.dWeight * waccResult.rd * (1 - waccResult.tc)
    : null;
  const note = margin.value === null ? THREE_STAGE_NO_MARGIN_NOTE
    : (margin.value <= 0 ? THREE_STAGE_NEGATIVE_MARGIN_NOTE : null);
  const rev = tsRevenueBase(d);
  return {
    revenue: rev.revenue, revenueSource: rev.source, marginDroppedYears: margin.droppedYears, startGrowth: growth.value, startGrowthRaw: growth.raw, growthSource: growth.source,
    terminalGrowth, margin: margin.value, marginYears: margin.years, marginSource: margin.source,
    salesToCapital, s2cSource: own !== null ? 'own' : 'industry', s2cCapped,
    beta: betaInfo.beta, betaInfo, wacc, taxRate, note,
  };
}

// Bear / Base / Bull seeds from the inputs, rounded the way the Adjust boxes show them (starting growth and margin
// to 0.1 point, WACC to 0.01 point, sales-to-capital to 2 decimals) so re-running from the boxes gives the same
// number on every surface. Base starting growth is already clamped to [-5%, 15%]; Bear / Bull take growthOffsetSpread
// with its own bounds (-15%..30%), so Bull is not stuck at Base for every company at the cap (peer review); WACC via
// discountRateSpread. Margin, sales-to-capital and the long-run rate are the same in all three. wacc is null when
// the inputs have none.
function threeStageScenarioSeeds(inputs) {
  const deps = tsDeps();
  const gPct = +(inputs.startGrowth * 100).toFixed(1);
  const gs = deps.growthOffsetSpread(gPct);
  const wPct = inputs.wacc != null ? +(inputs.wacc * 100).toFixed(2) : null;
  const ws = wPct != null ? deps.discountRateSpread(wPct) : { bear: null, bull: null };
  const margin = inputs.margin != null ? threeStagePctToFraction(+(inputs.margin * 100).toFixed(1)) : null;
  const salesToCapital = inputs.salesToCapital != null ? Math.round(inputs.salesToCapital * 100) / 100 : null;
  const one = (g, w) => ({
    startGrowth: threeStagePctToFraction(g), wacc: w != null ? threeStagePctToFraction(w) : null,
    margin, salesToCapital, terminalGrowth: inputs.terminalGrowth,
  });
  return { bear: one(gs.bear, ws.bear), base: one(gPct, wPct), bull: one(gs.bull, ws.bull) };
}

// The Adjust boxes back into seeds: boxes = { growth, tgrowth, discount: { bear, base, bull } (percent), marginPct,
// salesToCapital }. An empty or invalid box (NaN / missing) keeps its seed. One helper for the web /dcf/ tool and the
// native DCF tab, so an edit means the same thing on both.
function threeStageSeedsFromBoxes(t, boxes) {
  const b = boxes || {};
  const ok = v => typeof v === 'number' && isFinite(v);
  const base = t.scenarios.base;
  const margin = ok(b.marginPct) ? threeStagePctToFraction(b.marginPct) : base.margin;
  const salesToCapital = ok(b.salesToCapital) ? b.salesToCapital : base.salesToCapital;
  const pick = (triple, key) => (triple && ok(triple[key]) ? threeStagePctToFraction(triple[key]) : undefined);
  const one = key => {
    const seed = t.scenarios[key];
    const g = pick(b.growth, key), tg = pick(b.tgrowth, key), w = pick(b.discount, key);
    return {
      startGrowth: g !== undefined ? g : seed.startGrowth,
      terminalGrowth: tg !== undefined ? tg : (seed.terminalGrowth ?? t.inputs.terminalGrowth),
      wacc: w !== undefined ? w : seed.wacc,
      margin, salesToCapital,
    };
  };
  return { inputs: t.inputs, eligible: t.eligible, scenarios: { bear: one('bear'), base: one('base'), bull: one('bull') } };
}

// One scenario's value. `company` = { totalDebt, totalCash, shares, price }. Returns the computeScenarios-shaped
// scenario object every surface renders.
function threeStageScenario(key, inputs, seed, company) {
  const out = { key, startGrowth: seed.startGrowth, growthRate: seed.startGrowth, wacc: seed.wacc,
    terminalGrowth: seed.terminalGrowth ?? inputs.terminalGrowth, margin: seed.margin, salesToCapital: seed.salesToCapital, threeStage: true };
  if (inputs.note) return { ...out, result: null, note: inputs.note };
  if (seed.wacc == null) return { ...out, result: null, noWacc: true };
  const result = calculateThreeStageDCF({
    revenue: inputs.revenue, startGrowth: seed.startGrowth, terminalGrowth: out.terminalGrowth, margin: seed.margin,
    salesToCapital: seed.salesToCapital, wacc: seed.wacc, taxRate: inputs.taxRate,
    totalDebt: company.totalDebt ?? 0, totalCash: company.totalCash ?? 0, shares: company.shares, currentPrice: company.price,
  });
  return { ...out, result };
}

if (typeof module !== 'undefined') {
  module.exports = {
    THREE_STAGE_DCF_ENABLED, THREE_STAGE_HISTORY_YEARS, THREE_STAGE_GROWTH_MIN, THREE_STAGE_GROWTH_MAX,
    THREE_STAGE_NEGATIVE_MARGIN_NOTE, THREE_STAGE_NO_MARGIN_NOTE, threeStagePctToFraction,
    cycleAverageMargin, revenueTrendGrowth, ownSalesToCapital, bottomUpBeta, calculateThreeStageDCF, threeStageInputs,
    threeStageScenarioSeeds, threeStageScenario, threeStageSeedsFromBoxes, threeStageApplies, threeStageLender, threeStageEligible,
    THREE_STAGE_LENDER_INTEREST_SHARE,
  };
}
