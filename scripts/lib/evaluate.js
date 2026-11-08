// scripts/lib/evaluate.js
// Pure: evaluate one stock's BASE-CASE valuation exactly as app.js seeds it.
// Returns a ranked-row object, or { excluded: true, reason } when un-rankable.
const {
  deriveFcf, deriveMultiYearGrowth, deriveDividendGrowth,
  getMarketBetaFloor, isBankOrInsurance, isFinancialSector, chooseFinancialModel,
  isUtility, isCyclical, isConglomerate, isReit,
} = require('../../www/utils.js');
const { calculateWACC } = require('../../www/calc/wacc.js');
const { calculateDCF } = require('../../www/calc/dcf.js');
const { calculateFadingGrowthDCF } = require('../../www/calc/fadingGrowthDcf.js');
const { calculateDDM } = require('../../www/calc/ddm.js');
const { calculateExcessReturn } = require('../../www/calc/excessReturn.js');
const { cyclicalBaseFcf } = require('../../www/calc/cyclicalNormalization.js');
const sectorMarginLookup = require('../../www/sector-margins.json');
const { applyHoldcoDiscount } = require('../../www/calc/holdcoDiscount.js');
const { HOLDCO_DISCOUNT } = require('../../www/config.js');
const { alignFiscalYears } = require('../../www/calc/fiscalYearAlign.js');
const { altmanZScore } = require('../../www/calc/altmanZ.js');
const { piotroskiScore, piotroskiTrend } = require('../../www/calc/piotroski.js');
const { heavyCapexForAssumptions, heavyCapexExistingFcf, heavyCapexValuation } = require('../../www/calc/heavyCapex.js');
const { isAirline } = require('../../www/utils.js');
const { THREE_STAGE_DCF_ENABLED, threeStageInputs, threeStageScenarioSeeds, threeStageScenario, threeStageEligible, threeStageLender } = require('../../www/calc/threeStageDcf.js');

const DEFAULT_TERMINAL_GROWTH = 0.025;
const PROJECTION_YEARS = 5;

function latestSeriesVal(series) {
  if (!Array.isArray(series) || !series.length) return null;
  const v = series[series.length - 1]?.value;
  return (v != null && isFinite(v)) ? v : null;
}

// Altman Z-Score + Piotroski F-Score, computed here for every row.
// Piotroski F-Score is display-only (never gates ranking/qualification).
// Altman Z-Score IS a qualification input as of 2026-09-17 — scripts/lib/
// rank.js's passesSolvencyFloor() drops any row with a CONFIRMED Distress
// Zone score (a null score here, from isFinancialSector()/isReit() below or
// insufficient history, is exempted, not treated as a fail). This reverses
// an earlier decision ("a Z-Score qualification filter was discussed and
// explicitly discarded in favor of just showing both scores transparently")
// after a post-ship spot-check found 20-30% of top-20 rows landing in
// Distress Zone despite being flagged undervalued. Same isFinancialSector()/
// isReit() exclusion, same alignFiscalYears() field mapping, and same
// calc/altmanZ.js + calc/piotroski.js modules ticker-page.js's
// buildSolvencyScaleCard() and www/evaluate/app.js's computeSolvencyCheck()
// already use — a fourth consumer of the same Phase-1 Solvency Check calc
// layer, not a new implementation of it.
function computeSolvency(data) {
  if (isFinancialSector(data.sector) || isReit(data.sector, data.industry)) {
    return { altmanZ: null, piotroskiF: null };
  }

  const years = alignFiscalYears({
    netIncome: data.annualNetIncomeHistory,
    totalAssets: data.annualTotalAssetsHistory,
    fcf: data.annualFcfHistory,
    capex: data.annualCapexHistory,
    totalDebt: data.annualTotalDebtHistory,
    totalLiabilities: data.annualTotalLiabilitiesHistory,
    currentAssets: data.annualCurrentAssetsHistory,
    currentLiabilities: data.annualCurrentLiabilitiesHistory,
    shares: data.annualSharesHistory,
    revenue: data.annualRevenueHistory,
    grossProfit: data.annualGrossProfitHistory,
  });

  const altman = altmanZScore({
    totalAssets: years[0] ? years[0].totalAssets : null,
    currentAssets: years[0] ? years[0].currentAssets : null,
    currentLiabilities: years[0] ? years[0].currentLiabilities : null,
    retainedEarnings: latestSeriesVal(data.annualRetainedEarningsHistory),
    ebit: data.ebit,
    marketCap: data.marketCap,
    totalLiabilities: years[0] ? years[0].totalLiabilities : null,
    revenue: years[0] ? years[0].revenue : null,
  });

  let piotroski = null;
  let trend = null;
  if (years.length >= 2) {
    piotroski = piotroskiScore(years[0], years[1]);
    if (years.length >= 3) trend = piotroskiTrend(piotroski, piotroskiScore(years[1], years[2]));
  }

  return {
    altmanZ: altman.zScore != null ? { score: altman.zScore, zone: altman.zone } : null,
    piotroskiF: piotroski ? { score: piotroski.totalScore, maxScore: piotroski.maxScore, ...(trend ? { trend } : {}) } : null,
  };
}

// `== null` doesn't catch NaN (NaN == null is false in JS) -- a calc engine
// returning { intrinsicValue: NaN, marginOfSafety: NaN } under some edge
// case (seen live, KOSPI 200, 2026-08-22) silently passed every "is this
// result usable" guard below as if it were a valid number. rankRows()
// (scripts/lib/rank.js) then correctly dropped the row via its `> 0` check
// (NaN > 0 is also false), but rankFunnel()'s bucket comparisons have the
// same NaN-blindness and miscounted it as "qualified" -- so the funnel's
// displayed count (and the live page's "N qualified" copy) overstated the
// real number, even though the actual ranked/published list was unaffected.
// Fix it at the source: a row is only usable if both fields are finite.
const isUsableResult = (result) =>
  !!result && Number.isFinite(result.intrinsicValue) && Number.isFinite(result.marginOfSafety);

// The live tool runs its DCF/DDM off the values shown in the input boxes, which
// are rounded for display: growth/dividend-growth to 1 dp, WACC/Re to 2 dp, and
// the FCF/dividend inputs to integer / 2 dp respectively. To reproduce the
// calculator to the penny, the batch must round its seeds the same way before
// calling the calc engines.
const round1pct = (x) => +(x * 100).toFixed(1) / 100;  // 1 dp as a percent (growth)
const round2pct = (x) => +(x * 100).toFixed(2) / 100;  // 2 dp as a percent (WACC / Re)

function evaluateStockCore(data, params, opts = {}) {
  const { rf, erp, terminalGrowth = DEFAULT_TERMINAL_GROWTH } = params;
  const tsSwitch = opts.threeStage !== undefined ? opts.threeStage === true : THREE_STAGE_DCF_ENABLED;
  const rawBeta = (data.beta != null && isFinite(data.beta) && data.beta > 0) ? data.beta : 1.0;
  const effectiveBeta = Math.max(rawBeta, getMarketBetaFloor(data.ticker));

  const solvency = computeSolvency(data);
  const base = {
    ticker: data.ticker, name: data.name, sector: data.sector,
    snapshotPrice: data.price, currency: data.currency, trailingPE: data.trailingPE,
    marketCap: data.marketCap, operatingMargin: data.operatingMargins, analystTarget: data.targetMeanPrice,
    altmanZ: solvency.altmanZ, piotroskiF: solvency.piotroskiF,
  };

  // Regulated utilities always use Excess Return (rate-base-and-allowed-return
  // economics -- see www/dcf/calc/assumptions.js's isUtility() dispatch and
  // its own comment for why), unlike banks/insurers where chooseFinancialModel()
  // decides DDM vs Excess Return based on payout ratio. isUtility() already
  // excludes merchant/unregulated generation (Independent Power Producers),
  // so no separate guard is needed here.
  const isUtilityTicker = isUtility(data.sector, data.industry);

  // Banks/insurers/NBFCs/regulated utilities → DDM or Excess Return Model
  // (FCF-based DCF is structurally broken for lenders and rate-regulated
  // utilities alike). Which of the two depends on payout ratio vs.
  // sustainable payout for banks -- see chooseFinancialModel() -- but is
  // unconditional (always Excess Return) for utilities.
  // US lenders go to the bank models with the three-stage switch on (www/calc/threeStageDcf.js threeStageLender).
  if (isBankOrInsurance(data.sector, data.industry, data.ticker) || (tsSwitch && threeStageLender(data)) || isUtilityTicker) {
    const dividend = data.trailingAnnualDividendRate
      ?? data.dividendRate
      ?? ((data.price != null && data.dividendYield != null) ? data.price * data.dividendYield : null);
    const growth = deriveDividendGrowth(data.earningsGrowth, data.revenueGrowth);
    const re = round2pct(rf + effectiveBeta * erp);

    const roe = (data.returnOnEquity != null && isFinite(data.returnOnEquity) && data.returnOnEquity > 0)
      ? data.returnOnEquity
      : (data.trailingEps != null && data.priceToBook != null && data.price != null && data.priceToBook > 0
          ? data.trailingEps / (data.price / data.priceToBook)
          : null);

    const model = isUtilityTicker ? 'excess-return' : chooseFinancialModel({ roe, dividend, trailingEps: data.trailingEps, growth });

    if (model === 'excess-return') {
      const bookValue = data.price / data.priceToBook;
      const result = calculateExcessReturn({
        bookValue, roe, costOfEquity: re, growthRate: growth,
        projectionYears: PROJECTION_YEARS, currentPrice: data.price,
      });
      if (!isUsableResult(result)) {
        return { ...base, excluded: true, reason: 'excess-return-unavailable' };
      }
      return {
        ...base, method: 'ExcessReturn',
        intrinsic: result.intrinsicValue,
        marginOfSafety: result.marginOfSafety,
        wacc: re,
      };
    }

    const result = calculateDDM({
      dividend: dividend != null ? +(+dividend).toFixed(2) : dividend,
      growthRate: round1pct(growth),
      terminalGrowth,
      costOfEquity: re,
      projectionYears: PROJECTION_YEARS,
      currentPrice: data.price,
    });
    if (!isUsableResult(result)) {
      return { ...base, excluded: true, reason: 'ddm-unavailable' };
    }
    return {
      ...base, method: 'DDM',
      intrinsic: result.intrinsicValue,
      marginOfSafety: result.marginOfSafety,
      wacc: re,
      terminalValuePct: result.terminalValuePct,
    };
  }

  // Everyone else → DCF.
  let fcfInfo = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures, data.annualFcf);

  // Cyclical/commodity companies get a normalized base-year FCF (average FCF
  // margin across whatever real multi-year /timeseries history is available,
  // applied to the lower of trailing and average revenue) instead of the trailing figure above, same
  // as www/dcf/calc/assumptions.js's isCyclical dispatch -- falls back to the
  // standard fcfInfo untouched when there's too little history.
  if (isCyclical(data.sector, data.industry)) {
    const cyclicalFcf = cyclicalBaseFcf({
      fcfHistory: data.annualFcfHistory,
      revenueHistory: data.annualRevenueHistory,
      trailingRevenue: data.totalRevenue,
      sectorLookup: sectorMarginLookup,
      industry: data.industry,
      operatingMargin: data.operatingMargins,
    });
    if (cyclicalFcf) fcfInfo = cyclicalFcf;
  }

  // Non-bank financial-sector stocks (exchanges, asset managers, card networks):
  // the live DCF tool seeds a normalised FCF of fcf × 0.6, because reported FCF
  // overstates owner earnings for financials. Mirror it so the batch's base case
  // matches the tool. Banks/insurers never reach here — they use DDM above — so
  // isFinancialSector() alone is the right guard at this point.
  // The live tool seeds an integer FCF input (Math.round), and for non-bank
  // financials a normalised fcf × 0.6 (reported FCF overstates owner earnings).
  let baseFcf = fcfInfo.value;
  if (baseFcf != null) {
    if (isFinancialSector(data.sector) && baseFcf > 0) baseFcf = baseFcf * 0.6;
    baseFcf = Math.round(baseFcf);
  }

  // Heavy capex spending (www/calc/heavyCapex.js): the same six tests as every other surface. REITs and airlines
  // reach this DCF branch in the screens (their own models are the ETF radar's, see etf/sector-models.js) but have
  // their own model everywhere else, so they never qualify.
  const hcCheck = heavyCapexForAssumptions(data, {
    valuationModel: (isReit(data.sector, data.industry) || isAirline(data.sector, data.industry)) ? 'own-model' : 'dcf',
    isCyclical: isCyclical(data.sector, data.industry),
    fcfInfo,
  });
  const heavyCapex = hcCheck.applies ? hcCheck : null;
  if (heavyCapex) baseFcf = Math.round(heavyCapexExistingFcf(heavyCapex));

  const waccResult = calculateWACC({
    marketCap: data.marketCap, totalDebt: data.totalDebt, beta: effectiveBeta,
    interestExpense: data.interestExpense, taxRate: data.taxRate, ebit: data.ebit,
    riskFreeRate: rf, erp,
  });
  if (!waccResult) return { ...base, excluded: true, reason: 'no-wacc' };
  const waccUsed = round2pct(waccResult.wacc);

  // Prefer the /timeseries-sourced diluted share count over the basic
  // defaultKeyStatistics count when available — same precedence app.js's
  // prefillInputs() uses (see kashvector-lessons.md's deriveFcf/WACC-parity
  // entry for why a partial port of this enrichment previously produced a
  // materially wrong intrinsic value in worker-watchlist).
  const sharesForDcf = (data.dilutedSharesOutstanding != null && data.dilutedSharesOutstanding > 0)
    ? data.dilutedSharesOutstanding : data.sharesOutstanding;

  // Flag extreme leverage: when debt > 65% of total capital, WACC is weighted almost
  // entirely by cost of debt and understates equity risk — fair value needs extra caution.
  const totalDebtVal = data.totalDebt || 0;
  const mktCapVal = data.marketCap || 0;
  const capitalBase = totalDebtVal + mktCapVal;
  const highLeverage = capitalBase > 0 && (totalDebtVal / capitalBase) > 0.65;

  // Three-stage DCF (method 4, www/calc/threeStageDcf.js) -- the same engine and seeds as every other surface, on
  // the plain-DCF path only: heavy capex keeps its own method, and REITs/airlines (which reach this branch in the
  // screens) keep the classic DCF so the screen rankings for them don't move (they have their own models elsewhere).
  const threeStage = tsSwitch;
  // US market + positive trailing FCF only (threeStageEligible, 2026-11-08).
  if (threeStage && threeStageEligible(data, fcfInfo.value) && !heavyCapex && !isReit(data.sector, data.industry) && !isAirline(data.sector, data.industry)) {
    const inputs = threeStageInputs(data, { waccResult, terminalGrowth });
    if (inputs.note) return { ...base, excluded: true, reason: inputs.margin == null ? 'dcf-unavailable' : 'margin-negative' };
    const seed = threeStageScenarioSeeds(inputs).base;
    const s = threeStageScenario('base', inputs, seed, {
      totalDebt: data.totalDebt, totalCash: data.totalCash, shares: sharesForDcf, price: data.price,
    });
    if (!isUsableResult(s.result)) return { ...base, excluded: true, reason: 'dcf-unavailable' };
    return {
      ...base, method: 'DCF', fcfMethod: 'three-stage',
      intrinsic: s.result.intrinsicValue,
      marginOfSafety: s.result.marginOfSafety,
      wacc: seed.wacc,
      terminalValuePct: s.result.terminalValuePct,
      ...(highLeverage ? { highLeverage: true } : {}),
    };
  }

  // Fade growth toward the terminal rate instead of holding one flat rate
  // for the whole horizon whenever the base case itself is negative — same
  // auto-enable rule as the live tool's prefillInputs()/ticker-page.js (see
  // www/calc/assumptions.js's useMultiStage and CLAUDE.md's 2026-08-11 Known
  // Traps entry, Damodaran's transition-phase convention). Ported here
  // 2026-08-22 after TLC.AX (base growth -5.0%) surfaced the gap live: the
  // screen's flat-negative-growth DCF understated its margin (69.1%) enough
  // to duck under the screen's own 80% "inflated FCF" cap, when the correct
  // fading-growth value (102.3%, matching the live tool/ticker page exactly)
  // should have excluded it from qualifying at all.
  const baseGrowthPct = round1pct(deriveMultiYearGrowth(data));
  const useMultiStage = baseGrowthPct < 0;
  const dcfCommon = {
    terminalGrowth, wacc: waccUsed, projectionYears: PROJECTION_YEARS,
    totalDebt: data.totalDebt, totalCash: data.totalCash,
    sharesOutstanding: sharesForDcf, currentPrice: data.price,
  };
  const result = useMultiStage
    ? calculateFadingGrowthDCF({ ...dcfCommon, fcf: baseFcf, initialGrowth: baseGrowthPct })
    : calculateDCF({ ...dcfCommon, fcf: baseFcf, growthRate: baseGrowthPct });
  if (!isUsableResult(result)) {
    return { ...base, excluded: true, reason: 'dcf-unavailable' };
  }
  if (heavyCapex) {
    const v = heavyCapexValuation(data, heavyCapex, [{ key: 'base', wacc: waccUsed, result }]);
    const s = v.scenarios[0];
    const row = {
      ...base, method: 'DCF', fcfMethod: 'heavy-capex',
      intrinsic: s.result.intrinsicValue,
      marginOfSafety: s.result.marginOfSafety,
      wacc: waccUsed,
      terminalValuePct: result.terminalValuePct,
      impliedReturnOnCapex: v.implied ? v.implied.returnOnCapex : null,
      impliedReturnStatus: v.implied ? v.implied.status : null,
      heavyCapexTerm: s.capexValuePerShare,
      ...(highLeverage ? { highLeverage: true } : {}),
    };
    // Kept off the published JSON (non-enumerable): the check is for callers/tests, not the ranking files.
    Object.defineProperty(row, 'heavyCapexCheck', { value: heavyCapex, enumerable: false });
    return row;
  }
  return {
    ...base, method: 'DCF', fcfMethod: fcfInfo.method,
    intrinsic: result.intrinsicValue,
    marginOfSafety: result.marginOfSafety,
    wacc: waccUsed,
    terminalValuePct: result.terminalValuePct,
    ...(highLeverage ? { highLeverage: true } : {}),
  };
}

// Holdco/conglomerate discount is independent of which model above produced
// the result (almost always DCF, but a bank- or utility-tagged conglomerate
// is possible) -- applied as a final post-processing step, same pattern as
// the live tool's computeScenarios()/applyHoldcoDiscountToScenarios(). Only
// wraps a successful (non-excluded) result; reuses calc/holdcoDiscount.js's
// single-scenario function directly rather than reimplementing the discount
// math a third time.
// opts.threeStage: true/false forces the three-stage DCF on/off; omitted = THREE_STAGE_DCF_ENABLED.
function evaluateStock(data, params, opts) {
  const result = evaluateStockCore(data, params, opts);
  if (result.excluded) return result;
  if (!isConglomerate(data.sector, data.industry, data.ticker)) return result;
  // Heavy capex: the discount applies to the existing business only (as computeScenarios does for /evaluate/), then
  // the growth capex term is added back.
  const term = result.heavyCapexTerm != null ? result.heavyCapexTerm : 0;
  const existing = result.intrinsic - term;
  const discounted = applyHoldcoDiscount(
    { result: { intrinsicValue: existing, marginOfSafety: data.price > 0 ? (existing - data.price) / data.price : null } },
    HOLDCO_DISCOUNT, data.price,
  );
  const intrinsic = discounted.result.intrinsicValue + term;
  const out = { ...result, intrinsic, marginOfSafety: term ? (data.price > 0 ? (intrinsic - data.price) / data.price : null) : discounted.result.marginOfSafety };
  if (result.heavyCapexCheck) Object.defineProperty(out, 'heavyCapexCheck', { value: result.heavyCapexCheck, enumerable: false });
  return out;
}

// computeSolvency is also exported standalone — scripts/_backfill-solvency-
// top20.js (a scoped one-off patch for already-published rankings.json rows)
// calls it directly rather than running the full valuation just to discard
// everything but these two fields.
module.exports = { evaluateStock, computeSolvency };
