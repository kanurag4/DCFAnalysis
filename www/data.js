// Yahoo Finance fetcher for DCF tool. DOM-free.
// interestExpense from Yahoo is negative (expense convention) — wacc.js uses Math.abs().

// extraHeaders is only ever non-empty from a Node-side caller (the batch key
// header, see scripts/lib/batch-auth.js / worker-watchlist/batch-auth.js) --
// the live browser tool always calls this with 5 args, so it stays {}.
// Mirrors the same param growth/data.js's fetchGrowthData already has.
async function fetchDCFData(ticker, isASX = false, _u1 = '', _u2 = '', yahooProxyUrl = '', extraHeaders = {}) {
  if (!yahooProxyUrl) throw new Error('Missing Yahoo proxy URL in config.js');

  const raw = ticker.trim().toUpperCase();
  const symbol = raw.includes('.') ? raw : (isASX ? `${raw}.AX` : raw);
  const base = yahooProxyUrl.replace(/\/$/, '');
  const url = `${base}/quoteSummary/${encodeURIComponent(symbol)}?tool=dcf`;

  let res;
  try { res = await fetch(url, { headers: extraHeaders }); }
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
    const tsRes = await fetch(`${base}/timeseries/${encodeURIComponent(symbol)}`, { headers: extraHeaders });
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

  // Currency guard: Yahoo can report financial-statement figures (FCF,
  // revenue, debt, EBIT...) in a different currency than the listing trades
  // in — confirmed live 2026-08-12: SONY (financials JPY, price USD) came
  // back with a base-case intrinsic value of $83,000.91 vs a $23.61 price,
  // roughly the JPY/USD scale. calc/dcf.js and calc/wacc.js are pure and
  // currency-agnostic — they just need every dollar-figure input already in
  // the same currency as `price`/`marketCap`/`sharesOutstanding`. Convert
  // every financial-currency-denominated field using a live FX rate; if the
  // rate can't be fetched, null those fields (not leave them unconverted) so
  // calculateDCF/calculateWACC correctly treat the ticker as uncomputable
  // instead of silently mixing currencies.
  let fxConversionFailed = false;
  let freeCashflow = data.freeCashflow;
  let operatingCashflow = data.operatingCashflow;
  let capitalExpenditures = data.capitalExpenditures;
  let totalCash = data.totalCash;
  let totalDebt = data.totalDebt;
  let totalRevenue = data.totalRevenue;
  let ebitConverted = ebit;
  let interestExpenseConverted = interestExpense;
  let annualFcfConverted = annualFcf;

  if (data.currency && data.financialCurrency && data.currency !== data.financialCurrency) {
    const rate = await fetchFxRate(data.financialCurrency, data.currency, base, extraHeaders);
    if (rate != null) {
      const c = v => (v != null ? v * rate : v);
      freeCashflow = c(freeCashflow);
      operatingCashflow = c(operatingCashflow);
      capitalExpenditures = c(capitalExpenditures);
      totalCash = c(totalCash);
      totalDebt = c(totalDebt);
      totalRevenue = c(totalRevenue);
      ebitConverted = c(ebitConverted);
      interestExpenseConverted = c(interestExpenseConverted);
      annualFcfConverted = c(annualFcfConverted);
    } else {
      fxConversionFailed = true;
      freeCashflow = null;
      operatingCashflow = null;
      capitalExpenditures = null;
      totalCash = null;
      totalDebt = null;
      totalRevenue = null;
      ebitConverted = null;
      interestExpenseConverted = null;
      annualFcfConverted = null;
    }
  }

  return {
    ...data,
    freeCashflow, operatingCashflow, capitalExpenditures, totalCash, totalDebt, totalRevenue,
    dilutedSharesOutstanding,
    ebit: ebitConverted,
    interestExpense: interestExpenseConverted,
    annualFcf: annualFcfConverted,
    fxConversionFailed,
  };
}

// Fetches a live FX rate to convert amounts from `fromCcy` into `toCcy`.
// Yahoo's quoteSummary endpoint accepts FX pair tickers directly (e.g.
// "JPYUSD=X") via the same Worker route already used for every other
// lookup — no new Worker endpoint needed. `regularMarketPrice` is preferred
// but frequently absent for FX pairs (confirmed live 2026-08-12, even for
// the already-shipped AUDUSD=X used by Gordon Growth Model's dividend
// conversion — this fetch is more defensive than that one on purpose),
// so falls back to the two flavors of previous-close. Returns null (never
// throws) on any failure — callers must fail closed: null the affected
// fields rather than use an unconverted value.
async function fetchFxRate(fromCcy, toCcy, base, extraHeaders) {
  if (!fromCcy || !toCcy) return null;
  if (fromCcy === toCcy) return 1;
  try {
    const pair = `${fromCcy}${toCcy}=X`;
    const res = await fetch(`${base}/quoteSummary/${encodeURIComponent(pair)}`, { headers: extraHeaders });
    if (!res.ok) return null;
    const body = await res.json();
    const sd = body?.quoteSummary?.result?.[0]?.summaryDetail;
    const rate = rawVal(sd?.regularMarketPrice) ?? rawVal(sd?.previousClose) ?? rawVal(sd?.regularMarketPreviousClose);
    return (rate != null && rate > 0) ? rate : null;
  } catch (_) {
    return null;
  }
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
    // The currency financial-statement figures (FCF, revenue, debt...) are
    // reported in -- can legitimately differ from `currency` above (the
    // trading/listing currency) for ADRs and foreign private issuers, e.g.
    // SONY: currency USD, financialCurrency JPY. See fetchDCFData()'s
    // currency-conversion step, which uses this field.
    financialCurrency: result.financialData?.financialCurrency ?? null,
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

// Maps app.js's `currentMarket` values to the /dcf/stocks/<folder>/ URL
// segment used by the per-ticker SEO page generator (DCFAnalysis's
// scripts/generate-market-index.js). 'other' has no folder — no pages
// are ever generated for it.
const MARKET_STOCKS_FOLDER = {
  aus: 'asx', us: 'sp500', ind: 'nifty',
  kor: 'kospi', jpn: 'nikkei', uk: 'europe', eu: 'europe',
};

const _tickerPageManifestCache = new Map(); // folder -> array, cached per session

// Best-effort lookup for a published per-ticker SEO page's URL — used so
// the Share button can link to a page with correct per-ticker canonical/
// title/description instead of the interactive tool's page (which
// deliberately uses one static canonical for every ?ticker= variant, so
// LinkedIn/Facebook silently rewrite a shared tool URL back to the bare
// /dcf/ page — see docs/superpowers/specs/2026-08-10-dcf-share-ticker-page-url-design.md).
// Never throws — any failure (unmapped market, missing manifest, network
// error, ticker not published) resolves to null.
async function fetchTickerPageUrl(ticker, currentMarket) {
  const folder = MARKET_STOCKS_FOLDER[currentMarket];
  if (!folder) return null;

  let manifest = _tickerPageManifestCache.get(folder);
  if (!manifest) {
    try {
      const res = await fetch(`/dcf/stocks/${folder}/manifest.json`);
      manifest = res.ok ? await res.json() : [];
    } catch (_) {
      manifest = [];
    }
    _tickerPageManifestCache.set(folder, manifest);
  }

  const entry = manifest.find(e => e.ticker === ticker);
  return entry ? `https://kashvector.com/dcf/stocks/${folder}/${entry.slug}/` : null;
}

if (typeof module !== 'undefined') module.exports = { fetchDCFData, mapQuoteSummary, latestSeriesValue, fetchTickerPageUrl, fetchFxRate, MARKET_STOCKS_FOLDER };
