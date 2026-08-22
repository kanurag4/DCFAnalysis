// scripts/lib/evaluate.js
// Pure: evaluate one stock's BASE-CASE valuation exactly as app.js seeds it.
// Returns a ranked-row object, or { excluded: true, reason } when un-rankable.
const {
  deriveFcf, deriveBaseGrowth, deriveDividendGrowth,
  getMarketBetaFloor, isBankOrInsurance, isFinancialSector, chooseFinancialModel,
} = require('../../www/utils.js');
const { calculateWACC } = require('../../www/calc/wacc.js');
const { calculateDCF } = require('../../www/calc/dcf.js');
const { calculateFadingGrowthDCF } = require('../../www/calc/fadingGrowthDcf.js');
const { calculateDDM } = require('../../www/calc/ddm.js');
const { calculateExcessReturn } = require('../../www/calc/excessReturn.js');

const DEFAULT_TERMINAL_GROWTH = 0.025;
const PROJECTION_YEARS = 5;

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

function evaluateStock(data, params) {
  const { rf, erp, terminalGrowth = DEFAULT_TERMINAL_GROWTH } = params;
  const rawBeta = (data.beta != null && isFinite(data.beta) && data.beta > 0) ? data.beta : 1.0;
  const effectiveBeta = Math.max(rawBeta, getMarketBetaFloor(data.ticker));

  const base = {
    ticker: data.ticker, name: data.name, sector: data.sector,
    snapshotPrice: data.price, currency: data.currency, trailingPE: data.trailingPE,
    marketCap: data.marketCap, operatingMargin: data.operatingMargins, analystTarget: data.targetMeanPrice,
  };

  // Banks/insurers/NBFCs → DDM or Excess Return Model (FCF-based DCF is
  // structurally broken for lenders). Which of the two depends on payout ratio
  // vs. sustainable payout -- see chooseFinancialModel().
  if (isBankOrInsurance(data.sector, data.industry, data.ticker)) {
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

    const model = chooseFinancialModel({ roe, dividend, trailingEps: data.trailingEps, growth });

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
  const fcfInfo = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures, data.annualFcf);

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
  const baseGrowthPct = round1pct(deriveBaseGrowth(data.revenueGrowth, data.earningsGrowth));
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
