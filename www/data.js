// Yahoo Finance fetcher for DCF tool. DOM-free.
// interestExpense from Yahoo is negative (expense convention) — wacc.js uses Math.abs().

async function fetchDCFData(ticker, isASX = false, _u1 = '', _u2 = '', yahooProxyUrl = '') {
  if (!yahooProxyUrl) throw new Error('Missing Yahoo proxy URL in config.js');

  const raw = ticker.trim().toUpperCase();
  const symbol = raw.includes('.') ? raw : (isASX ? `${raw}.AX` : raw);
  const base = yahooProxyUrl.replace(/\/$/, '');
  const url = `${base}/quoteSummary/${encodeURIComponent(symbol)}?tool=dcf`;

  let res;
  try { res = await fetch(url); }
  catch (_) { throw new Error("Couldn't reach the data service. Check your internet connection."); }

  if (!res.ok) throw new Error(explainStatus(res.status, symbol));

  let body;
  try { body = await res.json(); }
  catch (_) { throw new Error('The data service returned an unreadable response. Please try again.'); }

  const data = mapQuoteSummary(body, symbol);

  // Best-effort — /timeseries must never block or fail the DCF. Uses the
  // same resolved `symbol` as the quoteSummary call above, not the raw
  // ticker (see the Known Traps note on this exact class of bug).
  let dilutedSharesOutstanding = null;
  let ebit = null;
  let interestExpenseTs = null;
  let annualFcf = null;
  try {
    const tsRes = await fetch(`${base}/timeseries/${encodeURIComponent(symbol)}`);
    if (tsRes.ok) {
      const tsBody = await tsRes.json();
      if (!tsBody.error) {
        dilutedSharesOutstanding = latestSeriesValue(tsBody.annualDilutedAverageShares);
        ebit = latestSeriesValue(tsBody.annualOperatingIncome);
        const rawInterestExpense = latestSeriesValue(tsBody.annualInterestExpense);
        // fundamentals-timeseries reports this as a positive magnitude, unlike
        // incomeStatementHistory's negative expense convention (see file-top
        // comment) — negate so both sources share one sign convention.
        interestExpenseTs = (rawInterestExpense != null) ? -rawInterestExpense : null;
        // Last-resort FCF fallback — see utils.js's deriveFcf() for why this
        // tier exists and why it's ordered last (only used when quoteSummary's
        // TTM-based freeCashflow/operatingCashflow are both unavailable).
        annualFcf = latestSeriesValue(tsBody.annualFreeCashFlow);
      }
    }
  } catch (_) {
    // all four stay null — app.js falls back to the basic share count /
    // incomeStatementHistory's interestExpense / book-yield cost of debt /
    // "no usable free cash flow" respectively.
  }

  // incomeStatementHistory's interestExpense is frequently an empty object
  // for ASX tickers (confirmed BHP.AX, 2026-08-08) even though Yahoo's own
  // fundamentals-timeseries has it — prefer the /timeseries value when present.
  const interestExpense = (interestExpenseTs != null) ? interestExpenseTs : data.interestExpense;

  return { ...data, dilutedSharesOutstanding, ebit, interestExpense, annualFcf };
}

// Pure: returns the most recent { date, value } entry's value from a Yahoo
// /timeseries series (already ascending by date), or null if the series is
// missing, empty, or the last entry's value isn't a finite number.
function latestSeriesValue(series) {
  if (!Array.isArray(series) || series.length === 0) return null;
  const v = series[series.length - 1]?.value;
  return (v != null && isFinite(v)) ? v : null;
}

// Pure: maps a Yahoo quoteSummary JSON body to the DCF tool's data shape.
// No network, no DOM — safe to import in Node for the batch ranking job.
function mapQuoteSummary(body, symbol) {
  const result = body?.quoteSummary?.result?.[0];
  if (!result) throw new Error(`No data returned for "${symbol}". The ticker may be delisted or temporarily unavailable — check the symbol and try again.`);

  const inc = result.incomeStatementHistory?.incomeStatementHistory?.[0];
  const cf  = result.cashflowStatementHistory?.cashflowStatements?.[0];

  // UK stocks quoted in pence (GBp): Yahoo returns price in pence but dividend
  // rates in GBP (pounds). Multiply dividends by 100 so all values are in pence.
  const currency = result.summaryDetail?.currency ?? null;
  const gbpToPence = currency === 'GBp' ? 100 : 1;

  // Derive tax rate so calc/wacc.js receives a plain 0–1 number
  const taxExpense = rawVal(inc?.incomeTaxExpense);
  const preTax     = rawVal(inc?.incomeBeforeTax);
  // Guard both values positive: negative taxExpense (tax benefit) or negative
  // preTax would produce an invalid tax rate that would silently distort WACC.
  const taxRate    = (taxExpense !== null && taxExpense > 0 && preTax !== null && preTax > 0)
    ? taxExpense / preTax : null;

  return {
    ticker:            symbol,
    name:              result.quoteType?.longName ?? result.quoteType?.shortName ?? symbol,
    price:             rawVal(result.financialData?.currentPrice),
    marketCap:         rawVal(result.summaryDetail?.marketCap),
    currency:          result.summaryDetail?.currency ?? null,
    sector:            result.assetProfile?.sector ?? null,
    industry:          result.assetProfile?.industry ?? null,
    // DCF core inputs
    freeCashflow:      rawVal(result.financialData?.freeCashflow),
    operatingCashflow: rawVal(result.financialData?.operatingCashflow),
    capitalExpenditures: rawVal(cf?.capitalExpenditures),  // negative in Yahoo (outflow); used for FCF = OCF − |CapEx|
    totalCash:         rawVal(result.financialData?.totalCash),
    totalDebt:         rawVal(result.financialData?.totalDebt),
    sharesOutstanding: rawVal(result.defaultKeyStatistics?.sharesOutstanding),
    // WACC inputs
    beta:              rawVal(result.summaryDetail?.beta),
    interestExpense:   rawVal(inc?.interestExpense),  // negative in Yahoo
    taxRate,
    // Growth seeds
    revenueGrowth:     rawVal(result.financialData?.revenueGrowth),
    earningsGrowth:    rawVal(result.financialData?.earningsGrowth),
    // Key metrics display
    trailingPE:        rawVal(result.summaryDetail?.trailingPE),
    totalRevenue:      rawVal(result.financialData?.totalRevenue),
    profitMargins:     rawVal(result.financialData?.profitMargins),
    operatingMargins:  rawVal(result.financialData?.operatingMargins),
    targetMeanPrice:   rawVal(result.financialData?.targetMeanPrice),
    fiftyTwoWeekHigh:  rawVal(result.summaryDetail?.fiftyTwoWeekHigh),
    fiftyTwoWeekLow:   rawVal(result.summaryDetail?.fiftyTwoWeekLow),
    // Financial sector alternative multiples
    returnOnEquity:    rawVal(result.financialData?.returnOnEquity),
    dividendYield:     rawVal(result.summaryDetail?.dividendYield),
    priceToBook:       rawVal(result.defaultKeyStatistics?.priceToBook),
    // DDM inputs (banks/insurance) — annual dividend per share.
    // GBp stocks: Yahoo returns these in GBP (pounds) while price is in pence → multiply by 100.
    dividendRate:               rawMul(result.summaryDetail?.dividendRate, gbpToPence),
    trailingAnnualDividendRate: rawMul(result.defaultKeyStatistics?.trailingAnnualDividendRate, gbpToPence),
  };
}

function rawVal(obj) {
  const v = obj?.raw;
  return (v != null && isFinite(v)) ? v : null;
}

function rawMul(obj, multiplier) {
  const v = rawVal(obj);
  return v !== null ? v * multiplier : null;
}

function explainStatus(status, symbol) {
  if (status === 404) return `Ticker "${symbol}" not found. Check the symbol and any suffix (.AX, .NS, .L).`;
  if (status === 429) return 'Too many requests. Please wait a minute and try again.';
  if (status === 403) return 'Access was denied by the data service. Please try again, or contact support if this keeps happening.';
  if (status === 401) return 'Data provider rejected the request. Please try again shortly.';
  if (status >= 500) return 'Yahoo Finance looks temporarily unavailable. Try again in a minute.';
  return `Data service error (HTTP ${status}). Please try again.`;
}

if (typeof module !== 'undefined') module.exports = { fetchDCFData, mapQuoteSummary, latestSeriesValue };
