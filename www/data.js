// Yahoo Finance fetcher for DCF tool. DOM-free.
// interestExpense from Yahoo is negative (expense convention) — wacc.js uses Math.abs().

async function fetchDCFData(ticker, isASX = false, _u1 = '', _u2 = '', yahooProxyUrl = '') {
  if (!yahooProxyUrl) throw new Error('Missing Yahoo proxy URL in config.js');

  const raw = ticker.trim().toUpperCase();
  const symbol = raw.includes('.') ? raw : (isASX ? `${raw}.AX` : raw);
  const url = `${yahooProxyUrl.replace(/\/$/, '')}/quoteSummary/${encodeURIComponent(symbol)}`;

  let res;
  try { res = await fetch(url); }
  catch (_) { throw new Error("Couldn't reach the data service. Check your internet connection."); }

  if (!res.ok) throw new Error(explainStatus(res.status, symbol));

  let body;
  try { body = await res.json(); }
  catch (_) { throw new Error('The data service returned an unreadable response. Please try again.'); }

  const result = body?.quoteSummary?.result?.[0];
  if (!result) throw new Error(`No data for "${symbol}". Check the ticker spelling and market suffix (e.g. .AX, .NS).`);

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
  if (status === 403) return "Data service declined the request. Verify the Worker's origin allowlist.";
  if (status === 401) return 'Data provider rejected the request. Please try again shortly.';
  if (status >= 500) return 'Yahoo Finance looks temporarily unavailable. Try again in a minute.';
  return `Data service error (HTTP ${status}). Please try again.`;
}
