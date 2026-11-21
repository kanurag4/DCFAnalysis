// Yahoo Finance fetcher for DCF tool. DOM-free.
// interestExpense from Yahoo is negative (expense convention) — wacc.js uses Math.abs().

// extraHeaders is only ever non-empty from a Node-side caller (the batch key
// header, see scripts/lib/batch-auth.js / worker-watchlist/batch-auth.js) --
// the live browser tool always calls this with 5 args, so it stays {}.
// Mirrors the same param growth/data.js's fetchGrowthData already has.
// toolTag overrides the default 'dcf' value sent as ?tool= — see the same
// param on stock/data.js's fetchStockData for why (native app's onboarding
// example-ticker chips only).
async function fetchDCFData(ticker, isASX = false, _u1 = '', _u2 = '', yahooProxyUrl = '', extraHeaders = {}, toolTag = 'dcf') {
  if (!yahooProxyUrl) throw new Error('Missing Yahoo proxy URL in config.js');

  const raw = ticker.trim().toUpperCase();
  const symbol = raw.includes('.') ? raw : (isASX ? `${raw}.AX` : raw);
  const base = yahooProxyUrl.replace(/\/$/, '');
  const url = `${base}/quoteSummary/${encodeURIComponent(symbol)}?tool=${encodeURIComponent(toolTag)}`;

  let res;
  try { res = await fetch(url, { headers: extraHeaders }); }
  catch (_) { throw new Error("Couldn't reach the data service. Check your internet connection."); }

  if (!res.ok) throw new Error(explainStatus(res.status, symbol));

  let body;
  try { body = await res.json(); }
  catch (_) { throw new Error('The data service returned an unreadable response. Please try again.'); }

  return fetchDCFDataFromBody(body, symbol, base, extraHeaders);
}

// Everything fetchDCFData does after its /quoteSummary call, for a caller that already has that body: /evaluate/
// and the native Home/Compare screens fetch /quoteSummary ONCE per lookup and build both the Stock Evaluator and
// the DCF shapes from it (www/evaluate/load-ticker.js), instead of fetching the same URL twice (2026-11-01).
// `symbol` must be the resolved symbol (.AX etc. applied), `base` the proxy URL without a trailing slash.
async function fetchDCFDataFromBody(body, symbol, base, extraHeaders = {}) {
  const data = mapQuoteSummary(body, symbol);
  // GBp tickers (LSE, quoted in pence): /timeseries reports financial-
  // statement aggregates in pounds, same as quoteSummary's financialData
  // module -- see mapQuoteSummary()'s gbpPenceScale() comment.
  const gbpToPence = gbpPenceScale(data.currency);

  // Best-effort — /timeseries must never block or fail the DCF. Uses the
  // same resolved `symbol` as the quoteSummary call above, not the raw
  // ticker (see the Known Traps note on this exact class of bug).
  let dilutedSharesOutstanding = null;
  let ebit = null;
  let interestExpenseTs = null;
  let annualFcf = null;
  let annualFcfHistory = [];
  let annualRevenueHistory = [];
  let annualNetIncomeHistory = [];
  let annualStockholdersEquityHistory = [];
  let annualDividendsPaidHistory = [];
  // Solvency Check (Altman Z-Score + Piotroski F-Score) inputs -- see
  // docs/superpowers/specs/2026-09-13-solvency-check-design.md. Share COUNT
  // is deliberately never GBp-scaled (see the return-object comment below).
  let annualTotalAssetsHistory = [];
  let annualCurrentAssetsHistory = [];
  let annualCurrentLiabilitiesHistory = [];
  let annualTotalLiabilitiesHistory = [];
  let annualRetainedEarningsHistory = [];
  let annualTotalDebtHistory = [];
  let annualSharesHistory = [];
  let annualCapexHistory = [];
  // Not in the original plan's field list -- Piotroski's gross-margin
  // criterion needs it, and Yahoo's /timeseries already returns
  // annualGrossProfit unconditionally (it was already in the Worker's
  // `types` list for other reasons, just never mapped into a history array
  // here before now).
  let annualGrossProfitHistory = [];
  // Heavy capex spending (2026-11-05): trailing-12-month capex / operating cash flow / depreciation -- see ttmFromTimeseries().
  let ttm = ttmFromTimeseries(null, gbpToPence);
  // Valuation method v2 (2026-11-21): FCFF inputs (fcffInputsFromTimeseries), same FX handling as everything below.
  let fcffInputs = fcffInputsFromTimeseries(null, gbpToPence);
  try {
    const tsRes = await fetch(`${base}/timeseries/${encodeURIComponent(symbol)}`, { headers: extraHeaders });
    if (tsRes.ok) {
      const tsBody = await tsRes.json();
      if (!tsBody.error) {
        ttm = ttmFromTimeseries(tsBody, gbpToPence);
        fcffInputs = fcffInputsFromTimeseries(tsBody, gbpToPence);
        dilutedSharesOutstanding = latestSeriesValue(tsBody.annualDilutedAverageShares);
        const rawEbit = latestSeriesValue(tsBody.annualOperatingIncome);
        ebit = (rawEbit != null) ? rawEbit * gbpToPence : null;
        const rawInterestExpense = latestSeriesValue(tsBody.annualInterestExpense);
        // fundamentals-timeseries reports this as a positive magnitude, unlike
        // incomeStatementHistory's negative expense convention (see file-top
        // comment) — negate so both sources share one sign convention.
        interestExpenseTs = (rawInterestExpense != null) ? -rawInterestExpense * gbpToPence : null;
        // Last-resort FCF fallback — see utils.js's deriveFcf() for why this
        // tier exists and why it's ordered last (only used when quoteSummary's
        // TTM-based freeCashflow/operatingCashflow are both unavailable).
        const rawAnnualFcf = latestSeriesValue(tsBody.annualFreeCashFlow);
        annualFcf = (rawAnnualFcf != null) ? rawAnnualFcf * gbpToPence : null;
        // Full multi-year series (not just the latest entry) -- used by
        // calc/cyclicalNormalization.js to average the FCF margin across a
        // real fiscal-year history instead of anchoring a DCF to whichever
        // single year happens to be a cycle peak or trough. Confirmed live
        // 2026-08-23: Yahoo's cashflowStatementHistory module only ever
        // returns {maxAge, endDate, netIncome} per year -- no capex, no
        // operating cash flow -- on every ticker checked; /timeseries is the
        // only source with real per-year FCF/revenue data.
        annualFcfHistory = scaleTimeseries(Array.isArray(tsBody.annualFreeCashFlow) ? tsBody.annualFreeCashFlow : [], gbpToPence);
        annualRevenueHistory = scaleTimeseries(Array.isArray(tsBody.annualTotalRevenue) ? tsBody.annualTotalRevenue : [], gbpToPence);
        // Full multi-year series for Damodaran's fundamental-growth seed
        // (retention x ROE) -- see utils.js's deriveMultiYearGrowth(). Same
        // /timeseries call already in flight; the Worker returns these three
        // fields unconditionally regardless of ?type= (see CLAUDE.md's Data
        // Fetching Contract), so no Worker change was needed.
        annualNetIncomeHistory = scaleTimeseries(Array.isArray(tsBody.annualNetIncome) ? tsBody.annualNetIncome : [], gbpToPence);
        annualStockholdersEquityHistory = scaleTimeseries(Array.isArray(tsBody.annualStockholdersEquity) ? tsBody.annualStockholdersEquity : [], gbpToPence);
        annualDividendsPaidHistory = scaleTimeseries(Array.isArray(tsBody.annualCashDividendsPaid) ? tsBody.annualCashDividendsPaid : [], gbpToPence);
        annualTotalAssetsHistory = scaleTimeseries(Array.isArray(tsBody.annualTotalAssets) ? tsBody.annualTotalAssets : [], gbpToPence);
        annualCurrentAssetsHistory = scaleTimeseries(Array.isArray(tsBody.annualCurrentAssets) ? tsBody.annualCurrentAssets : [], gbpToPence);
        annualCurrentLiabilitiesHistory = scaleTimeseries(Array.isArray(tsBody.annualCurrentLiabilities) ? tsBody.annualCurrentLiabilities : [], gbpToPence);
        annualTotalLiabilitiesHistory = scaleTimeseries(Array.isArray(tsBody.annualTotalLiabilitiesNetMinorityInterest) ? tsBody.annualTotalLiabilitiesNetMinorityInterest : [], gbpToPence);
        annualRetainedEarningsHistory = scaleTimeseries(Array.isArray(tsBody.annualRetainedEarnings) ? tsBody.annualRetainedEarnings : [], gbpToPence);
        annualTotalDebtHistory = scaleTimeseries(Array.isArray(tsBody.annualTotalDebt) ? tsBody.annualTotalDebt : [], gbpToPence);
        // Share COUNT, not a monetary aggregate -- never pence-scaled.
        annualSharesHistory = Array.isArray(tsBody.annualOrdinarySharesNumber) ? tsBody.annualOrdinarySharesNumber : [];
        annualCapexHistory = scaleTimeseries(Array.isArray(tsBody.annualCapitalExpenditure) ? tsBody.annualCapitalExpenditure : [], gbpToPence);
        annualGrossProfitHistory = scaleTimeseries(Array.isArray(tsBody.annualGrossProfit) ? tsBody.annualGrossProfit : [], gbpToPence);
      }
    }
  } catch (_) {
    // all stay at their initialized defaults (null/[]) -- app.js falls back
    // to the basic share count / incomeStatementHistory's interestExpense /
    // book-yield cost of debt / standard trailing-FCF DCF respectively.
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
  let annualFcfHistoryConverted = annualFcfHistory;
  let annualRevenueHistoryConverted = annualRevenueHistory;
  let annualNetIncomeHistoryConverted = annualNetIncomeHistory;
  let annualStockholdersEquityHistoryConverted = annualStockholdersEquityHistory;
  let annualDividendsPaidHistoryConverted = annualDividendsPaidHistory;
  let netIncomeConverted = data.netIncome;
  let depreciationConverted = data.depreciationAndAmortization;
  let ebitdaConverted = data.ebitda;
  // Solvency Check (Altman Z-Score + Piotroski F-Score) monetary inputs --
  // MUST go through the same FX conversion as every other financial field
  // here. Originally left out on the theory that these ratios are
  // "internally consistent within one currency already" -- true for X1/X2
  // (both operands are these same fields) but FALSE for X3 (ebit/assets),
  // X4 (marketCap/liabilities), and X5 (revenue/assets), which each pair
  // an ALREADY-CONVERTED pre-existing field (ebit, revenue, marketCap)
  // against an unconverted one, silently mixing currencies for any real
  // ADR (SONY-style). Same bug class this file's own FX guard exists to
  // prevent elsewhere. Piotroski's OCF (fcf - capex) is worse -- an
  // absolute subtraction of mismatched-currency values, not just a ratio.
  // annualSharesHistory is the one exception, correctly excluded: a share
  // COUNT is dimensionless and must never be FX-converted (same reasoning
  // as it's never GBp-pence-scaled either).
  let annualTotalAssetsHistoryConverted = annualTotalAssetsHistory;
  let annualCurrentAssetsHistoryConverted = annualCurrentAssetsHistory;
  let annualCurrentLiabilitiesHistoryConverted = annualCurrentLiabilitiesHistory;
  let annualTotalLiabilitiesHistoryConverted = annualTotalLiabilitiesHistory;
  let annualRetainedEarningsHistoryConverted = annualRetainedEarningsHistory;
  let annualTotalDebtHistoryConverted = annualTotalDebtHistory;
  let annualCapexHistoryConverted = annualCapexHistory;
  let annualGrossProfitHistoryConverted = annualGrossProfitHistory;

  // GBp/GBP is the same currency at two quote sub-units, already reconciled
  // by mapQuoteSummary()'s gbpPenceScale() and the /timeseries scaling above
  // -- not a real cross-currency mismatch. Treating it as one here would try
  // to fetch a nonexistent "GBPGBp=X" FX pair, fail, and null out every
  // financial field for every UK non-DDM stock (confirmed via a stubbed-
  // fetch reproduction before this fix).
  const isGbpPence = isGbpPenceCurrencyPair(data.currency, data.financialCurrency);
  if (!isGbpPence && data.currency && data.financialCurrency && data.currency !== data.financialCurrency) {
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
      annualFcfHistoryConverted = annualFcfHistory.map(e => ({ date: e.date, value: c(e.value) }));
      annualRevenueHistoryConverted = annualRevenueHistory.map(e => ({ date: e.date, value: c(e.value) }));
      annualNetIncomeHistoryConverted = annualNetIncomeHistory.map(e => ({ date: e.date, value: c(e.value) }));
      annualStockholdersEquityHistoryConverted = annualStockholdersEquityHistory.map(e => ({ date: e.date, value: c(e.value) }));
      annualDividendsPaidHistoryConverted = annualDividendsPaidHistory.map(e => ({ date: e.date, value: c(e.value) }));
      netIncomeConverted = c(netIncomeConverted);
      depreciationConverted = c(depreciationConverted);
      ebitdaConverted = c(ebitdaConverted);
      annualTotalAssetsHistoryConverted = annualTotalAssetsHistory.map(e => ({ date: e.date, value: c(e.value) }));
      annualCurrentAssetsHistoryConverted = annualCurrentAssetsHistory.map(e => ({ date: e.date, value: c(e.value) }));
      annualCurrentLiabilitiesHistoryConverted = annualCurrentLiabilitiesHistory.map(e => ({ date: e.date, value: c(e.value) }));
      annualTotalLiabilitiesHistoryConverted = annualTotalLiabilitiesHistory.map(e => ({ date: e.date, value: c(e.value) }));
      annualRetainedEarningsHistoryConverted = annualRetainedEarningsHistory.map(e => ({ date: e.date, value: c(e.value) }));
      annualTotalDebtHistoryConverted = annualTotalDebtHistory.map(e => ({ date: e.date, value: c(e.value) }));
      annualCapexHistoryConverted = annualCapexHistory.map(e => ({ date: e.date, value: c(e.value) }));
      annualGrossProfitHistoryConverted = annualGrossProfitHistory.map(e => ({ date: e.date, value: c(e.value) }));
      ttm = { ...ttm, ttmCapex: c(ttm.ttmCapex), ttmOcf: c(ttm.ttmOcf), ttmDepreciation: c(ttm.ttmDepreciation), lastQuarterCapex: c(ttm.lastQuarterCapex) };
      fcffInputs = convertFcffInputs(fcffInputs, c);
    } else {
      fxConversionFailed = true;
      fcffInputs = convertFcffInputs(fcffInputs, null);
      ttm = { ...ttm, ttmCapex: null, ttmOcf: null, ttmDepreciation: null, lastQuarterCapex: null };
      freeCashflow = null;
      operatingCashflow = null;
      capitalExpenditures = null;
      totalCash = null;
      totalDebt = null;
      totalRevenue = null;
      ebitConverted = null;
      interestExpenseConverted = null;
      annualFcfConverted = null;
      annualFcfHistoryConverted = [];
      annualRevenueHistoryConverted = [];
      annualNetIncomeHistoryConverted = [];
      annualStockholdersEquityHistoryConverted = [];
      annualDividendsPaidHistoryConverted = [];
      netIncomeConverted = null;
      depreciationConverted = null;
      ebitdaConverted = null;
      annualTotalAssetsHistoryConverted = [];
      annualCurrentAssetsHistoryConverted = [];
      annualCurrentLiabilitiesHistoryConverted = [];
      annualTotalLiabilitiesHistoryConverted = [];
      annualRetainedEarningsHistoryConverted = [];
      annualTotalDebtHistoryConverted = [];
      annualCapexHistoryConverted = [];
      annualGrossProfitHistoryConverted = [];
    }
  }

  return {
    ...data,
    freeCashflow, operatingCashflow, capitalExpenditures, totalCash, totalDebt, totalRevenue,
    dilutedSharesOutstanding,
    ebit: ebitConverted,
    interestExpense: interestExpenseConverted,
    annualFcf: annualFcfConverted,
    annualFcfHistory: annualFcfHistoryConverted,
    annualRevenueHistory: annualRevenueHistoryConverted,
    annualNetIncomeHistory: annualNetIncomeHistoryConverted,
    annualStockholdersEquityHistory: annualStockholdersEquityHistoryConverted,
    annualDividendsPaidHistory: annualDividendsPaidHistoryConverted,
    netIncome: netIncomeConverted,
    depreciationAndAmortization: depreciationConverted,
    ebitda: ebitdaConverted,
    fxConversionFailed,
    // Solvency Check (Altman Z-Score + Piotroski F-Score) inputs. Run
    // through the SAME FX conversion as every other financial field above
    // -- see the "let annualTotalAssetsHistoryConverted" comment for why
    // (a real ADR currency-mixing bug, found in peer review). Share COUNT
    // is the one field deliberately excluded: dimensionless, never
    // FX-converted or GBp-scaled.
    annualTotalAssetsHistory: annualTotalAssetsHistoryConverted,
    annualCurrentAssetsHistory: annualCurrentAssetsHistoryConverted,
    annualCurrentLiabilitiesHistory: annualCurrentLiabilitiesHistoryConverted,
    annualTotalLiabilitiesHistory: annualTotalLiabilitiesHistoryConverted,
    annualRetainedEarningsHistory: annualRetainedEarningsHistoryConverted,
    annualTotalDebtHistory: annualTotalDebtHistoryConverted,
    annualSharesHistory,
    annualCapexHistory: annualCapexHistoryConverted,
    annualGrossProfitHistory: annualGrossProfitHistoryConverted,
    // Heavy capex spending (calc/heavyCapex.js). Same FX conversion as every money field above.
    ttmCapex: ttm.ttmCapex, ttmOcf: ttm.ttmOcf, ttmDepreciation: ttm.ttmDepreciation, lastQuarterCapex: ttm.lastQuarterCapex,
    // Valuation method v2 (2026-11-21): FCFF inputs (FX-converted above) and the accounting regime.
    ...fcffInputs,
    reportingRegime: fcffReportingRegime(symbol, data.country, fcffInputs),
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

  // UK stocks quoted in pence (GBp): Yahoo returns price in pence but every
  // other monetary aggregate (dividend rates, FCF, revenue, debt, market
  // cap...) in GBP (pounds). Multiply all of them by 100 so every value
  // compared against price is on the same pence scale -- see
  // gbpPenceScale()'s comment above.
  const currency = result.summaryDetail?.currency ?? null;
  const gbpToPence = gbpPenceScale(currency);

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
    // Yahoo's instrument class (EQUITY / ETF / CRYPTOCURRENCY / INDEX / …) —
    // the ETF radar batch's crypto safety-net detector reads this. Null-safe;
    // no other consumer depends on it.
    quoteType:         result.quoteType?.quoteType ?? null,
    price:             rawVal(result.financialData?.currentPrice),
    marketCap:         rawMul(result.summaryDetail?.marketCap, gbpToPence),
    currency:          result.summaryDetail?.currency ?? null,
    // The currency financial-statement figures (FCF, revenue, debt...) are
    // reported in -- can legitimately differ from `currency` above (the
    // trading/listing currency) for ADRs and foreign private issuers, e.g.
    // SONY: currency USD, financialCurrency JPY. See fetchDCFData()'s
    // currency-conversion step, which uses this field.
    financialCurrency: result.financialData?.financialCurrency ?? null,
    sector:            result.assetProfile?.sector ?? null,
    country:           result.assetProfile?.country ?? null, // FCFF method: the accounting regime of US-listed foreign issuers
    industry:          result.assetProfile?.industry ?? null,
    // DCF core inputs -- GBp stocks: Yahoo reports these in GBP (pounds)
    // while price is in pence -- scale by gbpToPence (see the gbpPenceScale()
    // comment above) so calculateDCF's margin-of-safety comparison isn't off
    // by 100x.
    freeCashflow:      rawMul(result.financialData?.freeCashflow, gbpToPence),
    operatingCashflow: rawMul(result.financialData?.operatingCashflow, gbpToPence),
    capitalExpenditures: rawMul(cf?.capitalExpenditures, gbpToPence),  // negative in Yahoo (outflow); used for FCF = OCF − |CapEx|
    // REIT FFO/AFFO inputs (see calc/reit.js) -- GAAP net income and D&A,
    // both already fetched by the Worker's incomeStatementHistory/
    // cashflowStatementHistory modules but never previously extracted here.
    netIncome:                  rawMul(inc?.netIncome, gbpToPence),
    depreciationAndAmortization: rawMul(cf?.depreciation, gbpToPence),
    totalCash:         rawMul(result.financialData?.totalCash, gbpToPence),
    totalDebt:         rawMul(result.financialData?.totalDebt, gbpToPence),
    sharesOutstanding: rawVal(result.defaultKeyStatistics?.sharesOutstanding),
    // WACC inputs
    beta:              rawVal(result.summaryDetail?.beta),
    interestExpense:   rawMul(inc?.interestExpense, gbpToPence),  // negative in Yahoo
    taxRate,
    // Growth seeds
    revenueGrowth:     rawVal(result.financialData?.revenueGrowth),
    earningsGrowth:    rawVal(result.financialData?.earningsGrowth),
    // Key metrics display
    trailingPE:        rawVal(result.summaryDetail?.trailingPE),
    totalRevenue:      rawMul(result.financialData?.totalRevenue, gbpToPence),
    profitMargins:     rawVal(result.financialData?.profitMargins),
    operatingMargins:  rawVal(result.financialData?.operatingMargins),
    // Quote-type fields (dayHigh/Low-style) -- Yahoo already reports these on
    // the SAME pence scale as price for GBp tickers, unlike the fundamentals
    // above -- do not scale.
    targetMeanPrice:   rawVal(result.financialData?.targetMeanPrice),
    fiftyTwoWeekHigh:  rawVal(result.summaryDetail?.fiftyTwoWeekHigh),
    fiftyTwoWeekLow:   rawVal(result.summaryDetail?.fiftyTwoWeekLow),
    // Financial sector alternative multiples
    returnOnEquity:    rawVal(result.financialData?.returnOnEquity),
    ebitda:            rawMul(result.financialData?.ebitda, gbpToPence),
    dividendYield:     rawVal(result.summaryDetail?.dividendYield),
    priceToBook:       rawVal(result.defaultKeyStatistics?.priceToBook),
    // DDM inputs (banks/insurance) — annual dividend per share.
    // GBp stocks: Yahoo returns these in GBP (pounds) while price is in pence → multiply by 100.
    dividendRate:               rawMul(result.summaryDetail?.dividendRate, gbpToPence),
    trailingAnnualDividendRate: rawMul(result.defaultKeyStatistics?.trailingAnnualDividendRate, gbpToPence),
    // Excess Return Model's ROE fallback (trailingEps / bookValue) when Yahoo omits
    // returnOnEquity directly -- same GBp scaling as the dividend fields above,
    // since price is in pence for these tickers too.
    trailingEps:                rawMul(result.defaultKeyStatistics?.trailingEps, gbpToPence),
  };
}

// Yahoo quotes UK-listed (LSE) securities in pence (currency 'GBp') but
// reports their financial-statement aggregates (FCF, revenue, debt, market
// cap, EBITDA...) in pounds -- confirmed empirically: BP.L's raw
// freeCashflow (10,053,125,120) / sharesOutstanding (15,450,781,365) is
// ~£0.65/share, a sane FCF yield against its real £5.525 price, but
// calculateDCF was comparing that pounds-per-share figure directly against
// the raw pence price (552.5), producing a ~-97% "margin of safety" for a
// stock that isn't actually overvalued at all. The dividendRate/
// trailingEps scaling below already handled this for DDM/Excess-Return
// tickers (banks/insurers/utilities); this generalizes the same fix to
// every other monetary aggregate so the plain DCF/REIT/Airline/Cyclical
// paths get it too.
function gbpPenceScale(currency) {
  return currency === 'GBp' ? 100 : 1;
}

// Scales every {date, value} entry's `value` by `scale` -- used for
// /timeseries history arrays (annualFreeCashFlow, annualTotalRevenue, etc.)
// on GBp tickers. Returns the same array reference when scale is 1 (every
// non-GBp ticker), so this is a zero-cost no-op for ~95% of tickers.
function scaleTimeseries(series, scale) {
  if (scale === 1 || !Array.isArray(series)) return series;
  return series.map(e => (e && e.value != null) ? { ...e, value: e.value * scale } : e);
}

// Pure (heavy capex spending, 2026-11-05): trailing-12-month capex, operating cash flow and depreciation from a
// /timeseries body. Each figure is the sum of its last 4 quarters when those are 4 consecutive quarters (each end
// date within 100 days of the previous); otherwise the latest fiscal year (semiannual filers such as BABA have no
// quarterly series). Capex is returned as a positive magnitude. ttmSource says where capex came from.
const TTM_MAX_QUARTER_GAP_DAYS = 100;
// Sum of the last 4 points when they are 4 consecutive quarters (each end date within TTM_MAX_QUARTER_GAP_DAYS of the
// previous), else null -- half-years (UK, ASX, Spain) are never summed as a year.
function lastFourQuarters(series) {
  const pts = (Array.isArray(series) ? series : []).filter(e => e && e.date && e.value != null && isFinite(e.value));
  if (pts.length < 4) return null;
  const four = pts.slice(-4);
  for (let i = 1; i < 4; i++) {
    const days = (Date.parse(four[i].date) - Date.parse(four[i - 1].date)) / 86400000;
    if (!(days > 0 && days <= TTM_MAX_QUARTER_GAP_DAYS)) return null;
  }
  return four.reduce((s, e) => s + e.value, 0);
}

function ttmFromTimeseries(tsBody, gbpToPence) {
  const scale = gbpToPence || 1;
  const body = tsBody || {};
  function figure(quarterlyKey, annualKey) {
    const qSum = lastFourQuarters(body[quarterlyKey]);
    if (qSum != null) return { value: qSum * scale, source: 'quarterly' };
    const annual = latestSeriesValue(body[annualKey]);
    if (annual != null) return { value: annual * scale, source: 'annual' };
    return { value: null, source: null };
  }
  const capex = figure('quarterlyCapitalExpenditure', 'annualCapitalExpenditure');
  const ocf = figure('quarterlyOperatingCashFlow', 'annualOperatingCashFlow');
  const dep = figure('quarterlyDepreciationAndAmortization', 'annualDepreciationAndAmortization');
  const lastQ = latestSeriesValue(body.quarterlyCapitalExpenditure);
  return {
    ttmCapex: capex.value != null ? Math.abs(capex.value) : null,
    ttmOcf: ocf.value,
    ttmDepreciation: dep.value,
    lastQuarterCapex: lastQ != null ? Math.abs(lastQ * scale) : null,
    ttmSource: capex.source,
  };
}

// Pure (valuation method v2, 2026-11-21): the FCFF inputs from a /timeseries body (docs/superpowers/specs/
// 2026-11-20-fcff-damodaran-design.md). Money values are GBp-scaled like every other /timeseries field; the lease
// rate is a ratio and never scaled. Acquisitions become positive magnitudes. Stakes and minority interests are 0 when
// Yahoo has none (never null, so the equity bridge never breaks); the US lease series come only from SEC EDGAR.
function fcffInputsFromTimeseries(tsBody, gbpToPence) {
  const scale = gbpToPence || 1;
  const body = tsBody || {};
  const series = key => scaleTimeseries(Array.isArray(body[key]) ? body[key] : [], scale);
  const latest = key => { const v = latestSeriesValue(body[key]); return v != null ? v * scale : null; };
  const ttm = key => { const v = lastFourQuarters(body[key]); return v != null ? v * scale : null; };
  const stakes = latest('quarterlyInvestmentsAndAdvances')
    ?? (latest('quarterlyInvestmentinFinancialAssets') != null || latest('quarterlyLongTermEquityInvestment') != null
      ? (latest('quarterlyInvestmentinFinancialAssets') || 0) + (latest('quarterlyLongTermEquityInvestment') || 0) : null);
  return {
    annualOperatingIncomeHistory: series('annualOperatingIncome'),
    ttmOperatingIncome: ttm('quarterlyOperatingIncome'),
    ttmRevenue: ttm('quarterlyTotalRevenue'),
    annualRestructuringHistory: series('annualRestructuringAndMergernAcquisition'),
    annualOtherSpecialChargesHistory: series('annualOtherSpecialCharges'),
    annualTaxProvisionHistory: series('annualTaxProvision'),
    annualPretaxIncomeHistory: series('annualPretaxIncome'),
    annualAcquisitionsHistory: series('annualPurchaseOfBusiness').map(e => (e && e.value != null ? { ...e, value: Math.abs(e.value) } : e)),
    annualCashAndStHistory: series('annualCashCashEquivalentsAndShortTermInvestments'),
    annualCurrentDebtInclLeasesHistory: series('annualCurrentDebtAndCapitalLeaseObligation'),
    annualLeaseLiabilitiesHistory: series('annualCapitalLeaseObligations'),
    annualCurrentLeaseLiabilitiesHistory: series('annualCurrentCapitalLeaseObligation'),
    longTermInvestments: stakes ?? 0,
    minorityInterest: latest('quarterlyMinorityInterest') ?? latest('annualMinorityInterest') ?? 0,
    annualOperatingLeaseLiabilityHistory: series('annualOperatingLeaseLiability'),
    annualFinanceLeaseLiabilityHistory: series('annualFinanceLeaseLiability'),
    operatingLeaseRate: latestSeriesValue(body.annualOperatingLeaseRate),
    financeLeaseRouAmortization: latest('annualFinanceLeaseRouAmortization'),
    operatingLeaseCost: latest('annualOperatingLeaseCost'),
    ppeDepreciation: latest('annualPpeDepreciation'),
    reconciledDepreciation: latest('annualReconciledDepreciation'),
    // ROE on start-of-period equity (calc/roe.js, /dcf/ toggle): TTM net income and the equity a year earlier.
    quarterlyNetIncomeHistory: series('quarterlyNetIncome'),
    quarterlyStockholdersEquityHistory: series('quarterlyStockholdersEquity'),
  };
}

// An exchange suffix = IFRS. No suffix = US GAAP, except a company based outside the US with no US-GAAP lease
// figures from EDGAR: a 20-F filer reporting IFRS (TSM, ASML), whose leases then come from Yahoo like any IFRS filer.
// A foreign company filing US GAAP (BABA) has EDGAR lease figures and stays US GAAP (review 2026-11-21).
function fcffReportingRegime(symbol, country, inputs) {
  if (String(symbol || '').includes('.')) return 'ifrs';
  const usLeases = inputs && ((inputs.annualOperatingLeaseLiabilityHistory || []).length || (inputs.annualFinanceLeaseLiabilityHistory || []).length);
  return country && country !== 'United States' && !usLeases ? 'ifrs' : 'us-gaap';
}

const FCFF_RATIO_FIELDS = ['operatingLeaseRate'];
// FX-convert the FCFF inputs with c(v) (financial currency -> trading currency); c === null = the rate failed: every
// money input is nulled (histories emptied) so currencies are never mixed. Ratios pass through either way.
function convertFcffInputs(inputs, c) {
  const out = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (FCFF_RATIO_FIELDS.includes(k)) out[k] = v;
    else if (Array.isArray(v)) out[k] = c ? v.map(e => (e && e.value != null ? { date: e.date, value: c(e.value) } : e)) : [];
    else out[k] = c ? (v != null ? c(v) : v) : null;
  }
  return out;
}

// GBp (pence-quoted LSE stock) vs GBP (pounds, the SAME company's financial-
// statement reporting currency) is not a real cross-currency mismatch -- it's
// one currency at two different quote sub-units, already reconciled by
// gbpPenceScale() above. fetchDCFData()'s ADR/foreign-private-issuer FX-
// conversion guard (added 2026-08-12 for SONY: financials JPY, price USD)
// must not treat this pair as a mismatch requiring a live FX rate -- there is
// no "GBPGBp=X" ticker on Yahoo, so that fetch always fails and would
// otherwise null out every financial field for every UK non-DDM stock.
function isGbpPenceCurrencyPair(currency, financialCurrency) {
  return currency === 'GBp' && financialCurrency === 'GBP';
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
// scripts/lib/ticker-page.js's marketMeta()). Japanese (.T) and European
// (.L/eurozone) tickers file under 'other' — they keep their own currency/
// index/screen affiliation on the page itself, but there is no dedicated
// 'nikkei' or 'europe' folder on disk (confirmed 2026-08-12: only asx/
// sp500/nifty/other actually exist under www/stocks/). Keep this in sync
// with marketMeta()'s folder assignments — a stale mapping here fails
// closed (fetchTickerPageUrl returns null, no crash), which is exactly
// what silently broke the Share button for jpn/uk/eu tickers before this
// fix, undetected because the failure is invisible rather than an error.
const MARKET_STOCKS_FOLDER = {
  aus: 'asx', us: 'sp500', ind: 'nifty',
  kor: 'kospi', jpn: 'other', uk: 'other', eu: 'other',
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

if (typeof module !== 'undefined') module.exports = {
  fcffInputsFromTimeseries, convertFcffInputs, fcffReportingRegime,
  fetchDCFDataFromBody,
  fetchDCFData, mapQuoteSummary, latestSeriesValue, fetchTickerPageUrl, fetchFxRate, MARKET_STOCKS_FOLDER,
  gbpPenceScale, scaleTimeseries, isGbpPenceCurrencyPair, ttmFromTimeseries,
};
