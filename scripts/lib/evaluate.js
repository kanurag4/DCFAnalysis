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

// The live tool runs its DCF/DDM off the values shown in the input boxes, which
// are rounded for display: growth/dividend-growth to 1 dp, WACC/Re to 2 dp, and
// the FCF/dividend inputs to integer / 2 dp respectively. To reproduce the
// calculator to the penny, the batch must round its seeds the same way before
// calling the calc engines.
const round1pct = (x) => +(x * 100).toFixed(1) / 100;  // 1 dp as a percent (growth)
const round2pct = (x) => +(x * 100).toFixed(2) / 100;  // 2 dp as a percent (WACC / Re)

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
    const re = round2pct(rf + effectiveBeta * erp);
    const result = calculateDDM({
      dividend: dividend != null ? +(+dividend).toFixed(2) : dividend,
      growthRate: round1pct(deriveDividendGrowth(data.earningsGrowth, data.revenueGrowth)),
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
  // The live tool seeds an integer FCF input (Math.round), and for non-bank
  // financials a normalised fcf × 0.6 (reported FCF overstates owner earnings).
  let baseFcf = fcfInfo.value;
  if (baseFcf != null) {
    if (isFinancialSector(data.sector) && baseFcf > 0) baseFcf = baseFcf * 0.6;
    baseFcf = Math.round(baseFcf);
  }

  const waccResult = calculateWACC({
    marketCap: data.marketCap, totalDebt: data.totalDebt, beta: effectiveBeta,
    interestExpense: data.interestExpense, taxRate: data.taxRate,
    riskFreeRate: rf, erp,
  });
  if (!waccResult) return { ...base, excluded: true, reason: 'no-wacc' };
  const waccUsed = round2pct(waccResult.wacc);

  // Flag extreme leverage: when debt > 65% of total capital, WACC is weighted almost
  // entirely by cost of debt and understates equity risk — fair value needs extra caution.
  const totalDebtVal = data.totalDebt || 0;
  const mktCapVal = data.marketCap || 0;
  const capitalBase = totalDebtVal + mktCapVal;
  const highLeverage = capitalBase > 0 && (totalDebtVal / capitalBase) > 0.65;

  const result = calculateDCF({
    fcf: baseFcf,
    growthRate: round1pct(deriveBaseGrowth(data.revenueGrowth, data.earningsGrowth)),
    terminalGrowth: TERMINAL_GROWTH,
    wacc: waccUsed,
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
    wacc: waccUsed,
    terminalValuePct: result.terminalValuePct,
    ...(highLeverage ? { highLeverage: true } : {}),
  };
}

module.exports = { evaluateStock };
