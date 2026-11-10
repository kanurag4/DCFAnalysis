// scripts/fetch-yahoo.js
// IO: fetch one symbol's quoteSummary via the Cloudflare Worker proxy and map it.
// fetchImpl is injectable for testing; defaults to global fetch (Node 18+).
// Optional retries with linear backoff handle transient failures (429 rate-limit,
// Yahoo 5xx, network blips) — the Worker caps at 20 req/60s, so the batch also
// throttles between calls; retries catch the occasional straggler.
const { mapQuoteSummary, latestSeriesValue, gbpPenceScale, scaleTimeseries, ttmFromTimeseries } = require('../www/data.js');
const { batchHeaders } = require('./lib/batch-auth.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Best-effort /timeseries enrichment — mirrors www/data.js's fetchDCFData()
// exactly (annualFcf fallback, diluted share count, EBIT/interestExpense
// preferred over incomeStatementHistory's frequently-empty values) so the
// batch doesn't silently drop the WACC/FCF accuracy the live DCF tool already
// has. Deliberately calls fetchImpl directly rather than importing
// fetchDCFData() itself, since that function isn't fetchImpl-injectable and
// this keeps fetch-yahoo.js's existing test harness (stub fetchImpl, no real
// network) working unchanged for both calls. Never throws — a /timeseries
// failure must not block the quoteSummary result that's already in hand.
async function enrichFromTimeseries(mapped, symbol, { fetchImpl, proxyUrl }) {
  // Defaulted here (not just on the success path) so callers always get real
  // arrays regardless of /timeseries success/failure — mirrors www/data.js's
  // fetchDCFData(), and lets scripts/lib/evaluate.js's isCyclical branch
  // check .length without a null guard.
  const withHistoryDefaults = {
    ...mapped,
    annualFcfHistory: [], annualRevenueHistory: [],
    annualNetIncomeHistory: [], annualStockholdersEquityHistory: [], annualDividendsPaidHistory: [],
    // Solvency Check (Altman Z-Score + Piotroski F-Score) inputs — same 8
    // fields DCFAnalysis's own ticker-page.js fetchHistorySeries() already
    // pulls for the per-ticker SEO pages; evaluate.js's isFinancialSector/
    // isReit-gated computeSolvency() needs them too now the 6 undervalued
    // screens display both scores.
    annualTotalAssetsHistory: [], annualCurrentAssetsHistory: [], annualCurrentLiabilitiesHistory: [],
    annualTotalLiabilitiesHistory: [], annualRetainedEarningsHistory: [], annualTotalDebtHistory: [],
    annualSharesHistory: [], annualCapexHistory: [], annualGrossProfitHistory: [],
    ttmCapex: null, ttmOcf: null, ttmDepreciation: null, lastQuarterCapex: null,
  };
  try {
    const url = `${proxyUrl.replace(/\/$/, '')}/timeseries/${encodeURIComponent(symbol)}`;
    const res = await fetchImpl(url, { headers: batchHeaders() });
    if (!res || !res.ok) return withHistoryDefaults;
    const body = await res.json();
    if (!body || body.error) return withHistoryDefaults;

    // GBp tickers (LSE, quoted in pence): /timeseries reports financial-
    // statement aggregates in pounds, same as quoteSummary's financialData
    // module -- see www/data.js's mapQuoteSummary()/gbpPenceScale() comment.
    const gbpToPence = gbpPenceScale(mapped.currency);

    const dilutedSharesOutstanding = latestSeriesValue(body.annualDilutedAverageShares);
    const rawEbit = latestSeriesValue(body.annualOperatingIncome);
    const ebit = (rawEbit != null) ? rawEbit * gbpToPence : null;
    const rawInterestExpense = latestSeriesValue(body.annualInterestExpense);
    // fundamentals-timeseries reports this as a positive magnitude, unlike
    // incomeStatementHistory's negative expense convention — negate so both
    // sources share one sign convention (same as fetchDCFData()).
    const interestExpenseTs = (rawInterestExpense != null) ? -rawInterestExpense * gbpToPence : null;
    // Last-resort FCF fallback — see utils.js's deriveFcf() for why this tier
    // exists and why it's ordered last (only used when quoteSummary's
    // TTM-based freeCashflow/operatingCashflow are both unavailable, which
    // Yahoo does for a real, non-trivial share of NSE tickers — confirmed
    // live on TECHM.NS, 2026-08-15).
    const rawAnnualFcf = latestSeriesValue(body.annualFreeCashFlow);
    const annualFcf = (rawAnnualFcf != null) ? rawAnnualFcf * gbpToPence : null;
    // Full multi-year series (not just the latest entry) — used by
    // scripts/lib/evaluate.js's isCyclical branch to average the FCF margin
    // across a real fiscal-year history instead of anchoring the batch's
    // base case to whichever single year happens to be a cycle peak or
    // trough. Same source www/dcf/data.js's fetchDCFData() uses.
    const annualFcfHistory = scaleTimeseries(Array.isArray(body.annualFreeCashFlow) ? body.annualFreeCashFlow : [], gbpToPence);
    const annualRevenueHistory = scaleTimeseries(Array.isArray(body.annualTotalRevenue) ? body.annualTotalRevenue : [], gbpToPence);
    // Same three series Damodaran's fundamental-growth seed needs (see
    // www/utils.js's deriveMultiYearGrowth) -- mirrors www/dcf/data.js's
    // fetchDCFData() exactly. No FX conversion here, matching this file's
    // existing precedent for annualFcfHistory/annualRevenueHistory; the ETF
    // radar's own convertFinancials() handles conversion where it matters.
    const annualNetIncomeHistory = scaleTimeseries(Array.isArray(body.annualNetIncome) ? body.annualNetIncome : [], gbpToPence);
    const annualStockholdersEquityHistory = scaleTimeseries(Array.isArray(body.annualStockholdersEquity) ? body.annualStockholdersEquity : [], gbpToPence);
    const annualDividendsPaidHistory = scaleTimeseries(Array.isArray(body.annualCashDividendsPaid) ? body.annualCashDividendsPaid : [], gbpToPence);

    // Solvency Check inputs — same field names/scaling convention as
    // ticker-page.js's fetchHistorySeries(). annualSharesHistory is a share
    // COUNT, not a monetary value, so it deliberately skips gbpToPence —
    // same reasoning as dilutedSharesOutstanding above.
    const annualTotalAssetsHistory = scaleTimeseries(Array.isArray(body.annualTotalAssets) ? body.annualTotalAssets : [], gbpToPence);
    const annualCurrentAssetsHistory = scaleTimeseries(Array.isArray(body.annualCurrentAssets) ? body.annualCurrentAssets : [], gbpToPence);
    const annualCurrentLiabilitiesHistory = scaleTimeseries(Array.isArray(body.annualCurrentLiabilities) ? body.annualCurrentLiabilities : [], gbpToPence);
    const annualTotalLiabilitiesHistory = scaleTimeseries(Array.isArray(body.annualTotalLiabilitiesNetMinorityInterest) ? body.annualTotalLiabilitiesNetMinorityInterest : [], gbpToPence);
    const annualRetainedEarningsHistory = scaleTimeseries(Array.isArray(body.annualRetainedEarnings) ? body.annualRetainedEarnings : [], gbpToPence);
    const annualTotalDebtHistory = scaleTimeseries(Array.isArray(body.annualTotalDebt) ? body.annualTotalDebt : [], gbpToPence);
    const annualSharesHistory = Array.isArray(body.annualOrdinarySharesNumber) ? body.annualOrdinarySharesNumber : [];
    const annualCapexHistory = scaleTimeseries(Array.isArray(body.annualCapitalExpenditure) ? body.annualCapitalExpenditure : [], gbpToPence);
    const annualGrossProfitHistory = scaleTimeseries(Array.isArray(body.annualGrossProfit) ? body.annualGrossProfit : [], gbpToPence);

    return {
      ...mapped,
      dilutedSharesOutstanding,
      ebit,
      // incomeStatementHistory's interestExpense is frequently an empty
      // object for non-US tickers — prefer the /timeseries value when present.
      interestExpense: (interestExpenseTs != null) ? interestExpenseTs : mapped.interestExpense,
      annualFcf,
      annualFcfHistory,
      annualRevenueHistory,
      annualNetIncomeHistory,
      annualStockholdersEquityHistory,
      annualDividendsPaidHistory,
      annualTotalAssetsHistory,
      annualCurrentAssetsHistory,
      annualCurrentLiabilitiesHistory,
      annualTotalLiabilitiesHistory,
      annualRetainedEarningsHistory,
      annualTotalDebtHistory,
      annualSharesHistory,
      annualCapexHistory,
      annualGrossProfitHistory,
      // Heavy capex spending (www/calc/heavyCapex.js) -- same helper as www/data.js's fetchDCFData().
      ...(({ ttmCapex, ttmOcf, ttmDepreciation, lastQuarterCapex }) => ({ ttmCapex, ttmOcf, ttmDepreciation, lastQuarterCapex }))(ttmFromTimeseries(body, gbpToPence)),
    };
  } catch (_) {
    return withHistoryDefaults; // enrichment fields stay absent/empty — evaluate.js's existing fallbacks apply
  }
}

async function fetchSymbol(symbol, {
  fetchImpl = fetch, proxyUrl, retries = 0, backoffMs = 3000, sleepImpl = sleep,
} = {}) {
  const url = `${proxyUrl.replace(/\/$/, '')}/quoteSummary/${encodeURIComponent(symbol)}`;
  let lastStatus = 'network-error'; // logged on give-up so a 403/429 isn't indistinguishable from a genuine miss
  for (let attempt = 0; ; attempt++) {
    let res = null;
    try { res = await fetchImpl(url, { headers: batchHeaders() }); } catch (_) { res = null; }
    if (res) lastStatus = res.status;
    if (res && res.ok) {
      let body = null;
      try { body = await res.json(); } catch (_) { body = null; }
      if (body) {
        let mapped = null;
        try { mapped = mapQuoteSummary(body, symbol); } catch (_) { /* unmappable — treat as miss */ }
        if (mapped) return enrichFromTimeseries(mapped, symbol, { fetchImpl, proxyUrl });
      }
    }
    if (attempt >= retries) {
      console.warn(`fetchSymbol: giving up on ${symbol} after ${attempt + 1} attempt(s) — last HTTP status: ${lastStatus}`);
      return null;
    }
    await sleepImpl(backoffMs * (attempt + 1)); // linear backoff: 1×, 2×, 3× …
  }
}

module.exports = { fetchSymbol };
