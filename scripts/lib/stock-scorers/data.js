// Yahoo Finance fetcher via a user-deployed Cloudflare Worker. DOM-free.
// The worker handles Yahoo's cookie/crumb handshake and CORS.
//
// debtToEquity is returned as a PERCENTAGE (Yahoo's convention, e.g. 53.2
// means 53.2%). Scorers divide by 100 before comparing against thresholds.

// toolTag overrides the default 'stock' value sent as ?tool= — only the
// native app's onboarding example-ticker chips pass a non-default value
// (a tag not in the Worker's STATS_TOOLS allowlist), so those taps don't
// get counted toward /popular/'s ranking the same way a real typed search
// does. Every other caller stays on the default, unchanged behavior.
async function fetchStockData(ticker, isASX = false, _useCorsProxy = true, _unused = '', yahooProxyUrl = '', toolTag = 'stock') {
  if (!yahooProxyUrl) throw new Error("Missing Yahoo proxy URL in config.js");

  const raw = ticker.trim().toUpperCase();
  const symbol = raw.includes('.')
    ? raw
    : isASX ? `${raw}.AX` : raw;

  const url = `${yahooProxyUrl.replace(/\/$/, '')}/quoteSummary/${encodeURIComponent(symbol)}?tool=${encodeURIComponent(toolTag)}`;

  let res;
  try {
    res = await fetch(url);
  } catch (_) {
    throw new Error("Couldn't reach the data service. Check your internet connection and try again.");
  }

  if (!res.ok) throw new Error(explainStatus(res.status, symbol));

  let body;
  try {
    body = await res.json();
  } catch (_) {
    throw new Error("The data service returned an unreadable response. Please try again shortly.");
  }

  const result = body?.quoteSummary?.result?.[0];
  if (!result) {
    throw new Error(`No data for "${symbol}". Yahoo may not list this ticker — check the spelling, and for non-US markets add a suffix (e.g. .AX, .NS, .L, .DE).`);
  }

  return mapStockData(result, symbol);
}

// Pure: maps a Yahoo quoteSummary `result[0]` object to the Stock Evaluator's
// data shape. No network, no DOM — split out of fetchStockData() so Node
// callers that already have a fetched quoteSummary body (e.g. the per-ticker
// SEO page generators) can map it without a second network round-trip.
// Mirrors the DCF tool's mapQuoteSummary() (www/dcf/data.js), which is
// already structured this way for the same reason.
function mapStockData(result, symbol) {
  return {
    ticker: symbol,
    name: result.quoteType?.longName ?? result.quoteType?.shortName ?? symbol,
    price: rawVal(result.financialData?.currentPrice),
    marketCap: rawVal(result.summaryDetail?.marketCap),
    trailingPE: rawVal(result.summaryDetail?.trailingPE),
    forwardPE: rawVal(result.summaryDetail?.forwardPE),
    pegRatio: rawVal(result.defaultKeyStatistics?.pegRatio),
    priceToBook: rawVal(result.defaultKeyStatistics?.priceToBook),
    eps: rawVal(result.defaultKeyStatistics?.trailingEps),
    returnOnEquity: rawVal(result.financialData?.returnOnEquity),
    debtToEquity: rawVal(result.financialData?.debtToEquity),
    currentRatio: rawVal(result.financialData?.currentRatio),
    dividendYield: rawVal(result.summaryDetail?.dividendYield),
    beta: rawVal(result.summaryDetail?.beta),
    revenueGrowth: rawVal(result.financialData?.revenueGrowth),
    earningsGrowth: rawVal(result.financialData?.earningsGrowth),
    profitMargins: rawVal(result.financialData?.profitMargins),
    operatingMargins: rawVal(result.financialData?.operatingMargins),
    totalRevenue: rawVal(result.financialData?.totalRevenue),
    freeCashflow: rawVal(result.financialData?.freeCashflow),
    earningsQuarterlyGrowth: rawVal(result.defaultKeyStatistics?.earningsQuarterlyGrowth),
    enterpriseValue: rawVal(result.defaultKeyStatistics?.enterpriseValue),
    fiftyTwoWeekHigh: rawVal(result.summaryDetail?.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: rawVal(result.summaryDetail?.fiftyTwoWeekLow),
    currency: result.summaryDetail?.currency ?? null,
    sector: result.assetProfile?.sector ?? null,
    industry: result.assetProfile?.industry ?? null,
    businessSummary: result.assetProfile?.longBusinessSummary ?? null,
    targetMeanPrice: rawVal(result.financialData?.targetMeanPrice),
    targetHighPrice: rawVal(result.financialData?.targetHighPrice),
    targetLowPrice: rawVal(result.financialData?.targetLowPrice),
    numberOfAnalystOpinions: rawVal(result.financialData?.numberOfAnalystOpinions),
    epsHistory: (result.earningsHistory?.history ?? [])
      .map(h => rawVal(h.epsActual))
      .filter(v => v !== null),
    ebit: rawVal(result.financialData?.ebit),
    totalAssets: rawVal(result.balanceSheetHistory?.balanceSheetStatements?.[0]?.totalAssets),
    totalCurrentLiabilities: rawVal(result.balanceSheetHistory?.balanceSheetStatements?.[0]?.totalCurrentLiabilities),
    heldPercentInsiders: rawVal(result.defaultKeyStatistics?.heldPercentInsiders),
    auditRisk: (result.esgScores?.auditRisk != null && isFinite(result.esgScores.auditRisk))
      ? result.esgScores.auditRisk : null,
    boardRisk: (result.esgScores?.boardRisk != null && isFinite(result.esgScores.boardRisk))
      ? result.esgScores.boardRisk : null,
    compensationRisk: (result.esgScores?.compensationRisk != null && isFinite(result.esgScores.compensationRisk))
      ? result.esgScores.compensationRisk : null,
  };
}

function rawVal(obj) {
  const v = obj?.raw;
  return (v != null && isFinite(v)) ? v : null;
}

function explainStatus(status, symbol) {
  if (status === 404) return `Ticker "${symbol}" not found. Double-check the symbol and any market suffix (e.g. .AX, .NS, .L).`;
  if (status === 429) return "Too many requests in a short time. Please wait a minute and try again.";
  if (status === 403) return 'Access was denied by the data service. Please try again, or contact support if this keeps happening.';
  if (status === 401) return "The data provider rejected the request. Please try again in a moment.";
  if (status >= 500) return "Yahoo Finance looks temporarily unavailable. Please try again in a minute.";
  return `The data service returned an error (HTTP ${status}). Please try again.`;
}

// Node test/build-script access (e.g. the per-ticker SEO page generators'
// value-scale card, which already has a fetched quoteSummary body and only
// needs the mapping). No-op in the browser — `module` is undefined there.
if (typeof module !== 'undefined') module.exports = { fetchStockData, mapStockData };
