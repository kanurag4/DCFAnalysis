// scripts/lib/evaluate.js
// Pure: evaluate one stock's BASE-CASE valuation exactly as app.js seeds it.
// Returns a ranked-row object, or { excluded: true, reason } when un-rankable.
const {
  deriveFcf, deriveBaseGrowth, deriveDividendGrowth,
  getMarketBetaFloor, isBankOrInsurance, isFinancialSector,
} = require('../../www/utils.js');
const { calculateWACC } = require('../../www/calc/wacc.js');
const { calculateDCF } = require('../../www/calc/dcf.js');
const { calculateDDM } = require('../../www/calc/ddm.js');

const TERMINAL_GROWTH = 0.025;
const PROJECTION_YEARS = 5;

function evaluateStock(data, params) {
  const { rf, erp } = params;
  const rawBeta = (data.beta != null && isFinite(data.beta) && data.beta > 0) ? data.beta : 1.0;
  const effectiveBeta = Math.max(rawBeta, getMarketBetaFloor(data.ticker));

  const base = {
    ticker: data.ticker, name: data.name, sector: data.sector,
    snapshotPrice: data.price, currency: data.currency, trailingPE: data.trailingPE,
    marketCap: data.marketCap, operatingMargin: data.operatingMargins, analystTarget: data.targetMeanPrice,
  };

  // Banks/insurers → DDM (FCF-based DCF is structurally broken for them).
  if (isBankOrInsurance(data.sector, data.industry)) {
    const dividend = data.trailingAnnualDividendRate
      ?? data.dividendRate
      ?? ((data.price != null && data.dividendYield != null) ? data.price * data.dividendYield : null);
    const re = rf + effectiveBeta * erp;
    const result = calculateDDM({
      dividend,
      growthRate: deriveDividendGrowth(data.earningsGrowth, data.revenueGrowth),
      terminalGrowth: TERMINAL_GROWTH,
      costOfEquity: re,
      projectionYears: PROJECTION_YEARS,
      currentPrice: data.price,
    });
    if (!result || result.intrinsicValue == null || result.marginOfSafety == null) {
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
  const fcfInfo = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures);

  // Non-bank financial-sector stocks (exchanges, asset managers, card networks):
  // the live DCF tool seeds a normalised FCF of fcf × 0.6, because reported FCF
  // overstates owner earnings for financials. Mirror it so the batch's base case
  // matches the tool. Banks/insurers never reach here — they use DDM above — so
  // isFinancialSector() alone is the right guard at this point.
  let baseFcf = fcfInfo.value;
  if (isFinancialSector(data.sector) && baseFcf != null && baseFcf > 0) {
    baseFcf = Math.round(baseFcf * 0.6);
  }

  const waccResult = calculateWACC({
    marketCap: data.marketCap, totalDebt: data.totalDebt, beta: effectiveBeta,
    interestExpense: data.interestExpense, taxRate: data.taxRate,
    riskFreeRate: rf, erp,
  });
  if (!waccResult) return { ...base, excluded: true, reason: 'no-wacc' };

  const result = calculateDCF({
    fcf: baseFcf,
    growthRate: deriveBaseGrowth(data.revenueGrowth, data.earningsGrowth),
    terminalGrowth: TERMINAL_GROWTH,
    wacc: waccResult.wacc,
    projectionYears: PROJECTION_YEARS,
    totalDebt: data.totalDebt, totalCash: data.totalCash,
    sharesOutstanding: data.sharesOutstanding, currentPrice: data.price,
  });
  if (!result || result.intrinsicValue == null || result.marginOfSafety == null) {
    return { ...base, excluded: true, reason: 'dcf-unavailable' };
  }
  return {
    ...base, method: 'DCF', fcfMethod: fcfInfo.method,
    intrinsic: result.intrinsicValue,
    marginOfSafety: result.marginOfSafety,
    wacc: waccResult.wacc,
    terminalValuePct: result.terminalValuePct,
  };
}

module.exports = { evaluateStock };
