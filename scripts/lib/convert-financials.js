// scripts/lib/convert-financials.js
// Shared FX conversion for financial-statement figures. Mirrors www/dcf/data.js's
// fetchDCFData() exactly: converts figures from a stock's reporting currency
// (financialCurrency) into its quote currency (currency) before evaluateStock().
// Called in run-screen.js (the undervalued screen engine) and etf/run-etf-radar.js.
//
// Fail-closed: if fetchFx returns null (rate unavailable) all statement figures
// are nulled so evaluateStock() treats the ticker as unvaluable rather than
// comparing, say, USD-denominated cash flows against an AUD quote price.
//
// GBp/GBP pairs (LSE pence-quoted stocks) are explicitly skipped — the
// pence scaling is already applied inside fetch-yahoo.js's enrichFromTimeseries()
// via gbpPenceScale(), matching www/dcf/data.js's isGbpPenceCurrencyPair() guard.
const { fetchFxRate } = require('../../www/data.js');
const { batchHeaders } = require('./batch-auth.js');

// Scalar financial-statement fields (from quoteSummary financialData /
// defaultKeyStatistics modules) that live in reporting currency.
const SCALAR_FIELDS = [
  'freeCashflow', 'operatingCashflow', 'capitalExpenditures', 'totalCash', 'totalDebt',
  'totalRevenue', 'ebit', 'interestExpense', 'annualFcf', 'netIncome',
  'depreciationAndAmortization', 'ebitda',
  // Heavy capex spending (www/calc/heavyCapex.js): trailing-12-month figures from /timeseries.
  'ttmCapex', 'ttmOcf', 'ttmDepreciation', 'lastQuarterCapex',
];

// Monetary history series from /timeseries enrichment that also need conversion.
// annualSharesHistory is a SHARE COUNT (dimensionless) — deliberately excluded.
const HISTORY_FIELDS = [
  'annualFcfHistory', 'annualRevenueHistory', 'annualNetIncomeHistory',
  'annualStockholdersEquityHistory', 'annualDividendsPaidHistory',
  // Solvency Check inputs (Altman Z + Piotroski F):
  'annualTotalAssetsHistory', 'annualCurrentAssetsHistory', 'annualCurrentLiabilitiesHistory',
  'annualTotalLiabilitiesHistory', 'annualRetainedEarningsHistory',
  'annualTotalDebtHistory', 'annualCapexHistory', 'annualGrossProfitHistory',
];

async function convertFinancials(data, { proxyUrl, fxCache, fetchFx = fetchFxRate }) {
  if (!data || !data.currency || !data.financialCurrency) return data;
  if (data.currency === data.financialCurrency) return data;
  // GBp (pence) / GBP (pounds) — pence scaling already done in enrichFromTimeseries.
  if (data.currency === 'GBp' && data.financialCurrency === 'GBP') return data;

  const key = `${data.financialCurrency}>${data.currency}`;
  let rate = fxCache.get(key);
  if (rate === undefined) {
    rate = await fetchFx(data.financialCurrency, data.currency, proxyUrl, batchHeaders());
    fxCache.set(key, rate);
  }

  const out = { ...data };
  if (rate == null) {
    for (const f of SCALAR_FIELDS) out[f] = null;
    for (const f of HISTORY_FIELDS) out[f] = [];
    out.fxConversionFailed = true;
    return out;
  }

  const c = (v) => (v != null && Number.isFinite(v) ? v * rate : v);
  for (const f of SCALAR_FIELDS) out[f] = c(data[f]);
  for (const f of HISTORY_FIELDS) {
    out[f] = (data[f] || []).map(e => ({ date: e.date, value: c(e.value) }));
  }
  return out;
}

module.exports = { convertFinancials };
