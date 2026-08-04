// scripts/generate-ticker-page.js
// Generate one static, pre-rendered SEO page for a single ticker — the
// per-ticker page pilot (docs/superpowers/plans/2026-08-04-per-ticker-seo-pages.md
// in StockAnalysis). Reuses the exact same calc engines and market-parameter
// logic the live DCF tool and the 6 undervalued-screen batches already use —
// see evaluate.js/market.js/rf.js for the established pattern this mirrors.
//
// Usage:
//   node scripts/generate-ticker-page.js BHP.AX
//   node scripts/generate-ticker-page.js AAPL
//   node scripts/generate-ticker-page.js RELIANCE.NS
//
// Writes www/stocks/<market>/<slug>/index.html — which becomes
// www/dcf/stocks/<market>/<slug>/ once xcopy'd into StockAnalysis, same
// publish step every other screen uses. This script only WRITES a local file;
// it never commits or pushes — that is a separate, explicit step.

const fs = require('fs');
const path = require('path');

const { mapQuoteSummary } = require('../www/data.js');
const { calculateWACC } = require('../www/calc/wacc.js');
const { calculateDCF } = require('../www/calc/dcf.js');
const { calculateDDM } = require('../www/calc/ddm.js');
const {
  deriveFcf, deriveBaseGrowth, deriveDividendGrowth,
  getMarketBetaFloor, isBankOrInsurance, isFinancialSector,
} = require('../www/utils.js');
const { marketParamsFor } = require('./lib/market.js');
const { fetchUsRf, fetchAusRf, fetchIndRf } = require('./lib/rf.js');
const { batchHeaders } = require('./lib/batch-auth.js');

// ── config / IO ─────────────────────────────────────────────────────────
function readProxyUrl() {
  if (process.env.YAHOO_PROXY_URL) return process.env.YAHOO_PROXY_URL;
  const src = fs.readFileSync(path.join(__dirname, '..', 'www', 'config.js'), 'utf8');
  const m = src.match(/YAHOO_PROXY_URL\s*[:=]\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('Could not find YAHOO_PROXY_URL in www/config.js');
  return m[1];
}

async function getJSON(url) {
  const res = await fetch(url, { headers: batchHeaders() });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// ── market → folder/screen mapping (mirrors market.js's suffix logic) ────
const EUROZONE_SUFFIXES = ['.DE', '.PA', '.AS', '.MI', '.MC', '.BR', '.LS', '.VI', '.HE', '.IR'];
// Index tickers reused verbatim from each market's rank-<market>.js config —
// same ones already validated live by the undervalued-screen batches.
function marketMeta(ticker) {
  const t = ticker.toUpperCase();
  if (t.endsWith('.AX')) return { folder: 'asx', screenName: 'ASX 300 Most Undervalued', screenUrl: '/dcf/asx-undervalued/', currencySymbol: '$', indexTicker: '^AXJO', indexName: 'ASX 200' };
  if (t.endsWith('.NS') || t.endsWith('.BO')) return { folder: 'nifty', screenName: 'NIFTY 500 Most Undervalued', screenUrl: '/dcf/nifty-undervalued/', currencySymbol: '₹', indexTicker: '^NSEI', indexName: 'NIFTY 50' };
  if (t.endsWith('.KS')) return { folder: 'kospi', screenName: 'KOSPI 200 Most Undervalued', screenUrl: '/dcf/kospi-undervalued/', currencySymbol: '₩', indexTicker: '^KS11', indexName: 'KOSPI Composite' };
  if (t.endsWith('.T')) return { folder: 'nikkei', screenName: 'Nikkei 225 Most Undervalued', screenUrl: '/dcf/nikkei-undervalued/', currencySymbol: '¥', indexTicker: '^N225', indexName: 'Nikkei 225' };
  if (t.endsWith('.L') || EUROZONE_SUFFIXES.some(s => t.endsWith(s))) return { folder: 'europe', screenName: 'Europe Most Undervalued', screenUrl: '/dcf/europe-undervalued/', currencySymbol: '€', indexTicker: '^STOXX', indexName: 'STOXX Europe 600' };
  if (!t.includes('.')) return { folder: 'sp500', screenName: 'S&P 500 Most Undervalued', screenUrl: '/dcf/sp500-undervalued/', currencySymbol: '$', indexTicker: '^GSPC', indexName: 'S&P 500' };
  return { folder: 'other', screenName: null, screenUrl: null, currencySymbol: '$', indexTicker: null, indexName: null };
}

const slugify = (ticker) => ticker.toLowerCase().replace(/\./g, '-');

// ── formatting helpers ─────────────────────────────────────────────────
function money(v, sym, decimals = 2) {
  if (v == null || !isFinite(v)) return 'N/A';
  return sym + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function moneyB(v, sym) {
  if (v == null || !isFinite(v)) return 'N/A';
  const sign = v < 0 ? '-' : '';
  return sign + sym + (Math.abs(v) / 1e9).toFixed(2) + 'B';
}
// For values ALREADY scaled to billions (e.g. fcfSeries, pre-divided for chart
// axis sizing) — moneyB() would divide by 1e9 a second time and silently show
// ~$0.00 for everything. Real bug hit on HDFCBANK.NS (2026-08-04): raw FCF was
// genuinely large (₹433B–₹1129B) but the chart showed all zeros from this
// double-division, not from a real data problem.
function moneyBAlreadyScaled(v, sym) {
  if (v == null || !isFinite(v)) return 'N/A';
  const sign = v < 0 ? '-' : '';
  return sign + sym + Math.abs(v).toFixed(2) + 'B';
}
function pct(v, decimals = 1) {
  if (v == null || !isFinite(v)) return 'N/A';
  return (v >= 0 ? '' : '') + (v * 100).toFixed(decimals) + '%';
}
function pctSigned(v, decimals = 1) {
  if (v == null || !isFinite(v)) return 'N/A';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(decimals) + '%';
}
function verdict(marginOfSafety) {
  if (marginOfSafety == null) return { label: 'N/A', cls: '' };
  if (marginOfSafety >= 0.05) return { label: '✅ Undervalued', cls: 'undervalued' };
  if (marginOfSafety <= -0.05) return { label: '❌ Overvalued', cls: 'overvalued' };
  return { label: '⚠️ Fairly Valued', cls: '' };
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Bear/Bull scenario derivation — mirrors www/dcf/app.js's buildScenarios()
// exactly (same 0.5x/1.5x growth multipliers, same +-1pp WACC/Re offset,
// same -5/30 and 0/12 growth clamps). Not currently exported from app.js
// (browser-only, DOM-coupled) so replicated here as pure math. ──
function deriveScenarios({ method, baseGrowthPct, waccOrRePct }) {
  if (method === 'DDM') {
    return {
      growth: { bear: Math.max(0, baseGrowthPct * 0.5), base: baseGrowthPct, bull: Math.min(12, baseGrowthPct * 1.5) },
      discount: { bear: waccOrRePct + 1, base: waccOrRePct, bull: Math.max(1, waccOrRePct - 1) },
    };
  }
  return {
    growth: { bear: Math.max(-5, baseGrowthPct * 0.5), base: baseGrowthPct, bull: Math.min(30, baseGrowthPct * 1.5) },
    discount: { bear: waccOrRePct + 1, base: waccOrRePct, bull: Math.max(1, waccOrRePct - 1) },
  };
}

// ── SVG line chart (Node port of the locked artifact prototype's lineChart()) ──
function lineChart(series, { w, h, valueKey, labelKey, fmtFn }) {
  const pad = { t: 22, r: 8, b: labelKey ? 18 : 6, l: 8 };
  const vals = series.map(d => d[valueKey]);
  let max = Math.max(...vals), min = Math.min(...vals, 0);
  if (max === min) { max += 1; min -= 1; }
  const range = max - min;
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const x = i => pad.l + (i / (series.length - 1)) * innerW;
  const y = v => pad.t + innerH - ((v - min) / range) * innerH;
  const zeroY = y(0);

  const pts = series.map((d, i) => `${x(i)},${y(d[valueKey])}`).join(' ');
  const areaPts = `${x(0)},${zeroY} ${pts} ${x(series.length - 1)},${zeroY}`;
  const isUp = vals[vals.length - 1] >= vals[0];
  const lineColor = isUp ? 'var(--kv-pass)' : 'var(--kv-fail)';

  let grid = '';
  if (min < 0 && max > 0) grid = `<line x1="${pad.l}" y1="${zeroY}" x2="${w - pad.r}" y2="${zeroY}" stroke="var(--kv-border)" stroke-width="1" stroke-dasharray="3,3"/>`;

  let dots = '', valueLabels = '';
  const skip = series.length > 12 ? Math.ceil(series.length / 8) : 1;
  series.forEach((d, i) => {
    const isEnd = i === series.length - 1;
    const cx = x(i), cy = y(d[valueKey]);
    dots += `<circle cx="${cx}" cy="${cy}" r="${isEnd ? 3.5 : 2}" fill="${isEnd ? lineColor : 'var(--kv-muted)'}"/>`;
    if (isEnd || i % skip === 0) {
      const labelY = cy - 8 < pad.t - 14 ? cy + 14 : cy - 8;
      valueLabels += `<text x="${cx}" y="${labelY}" text-anchor="middle" class="point-label">${escapeHtml(fmtFn(d[valueKey]))}</text>`;
    }
  });

  let labels = '';
  if (labelKey) {
    series.forEach((d, i) => {
      if (i % skip !== 0 && i !== series.length - 1) return;
      labels += `<text x="${x(i)}" y="${h - 4}" text-anchor="middle" class="bar-label">${escapeHtml(d[labelKey])}</text>`;
    });
  }

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <polygon points="${areaPts}" fill="${lineColor}" opacity="0.12"/>
    ${grid}
    <polyline points="${pts}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    ${dots}${valueLabels}${labels}
  </svg>`;
}

// Dual-line % change chart — stock vs its market index, same axis (percent
// return from the start of the window, since a stock price and an index level
// are on completely different scales and can't be plotted together directly).
// Stock: solid line + shaded area underneath, colored by trend (matches the
// single-series lineChart() style elsewhere on the page). Index: dotted line,
// no fill — so the two are distinguishable without relying on a legend alone.
function dualLineChart(stockSeries, indexSeries, { w, h, fmtFn, indexLabel }) {
  const pad = { t: 22, r: 8, b: 18, l: 8 };
  const stockPct = stockSeries.map(d => ((d.v / stockSeries[0].v) - 1) * 100);
  const indexPct = indexSeries.map(d => ((d.v / indexSeries[0].v) - 1) * 100);
  const allVals = [...stockPct, ...indexPct];
  let max = Math.max(...allVals, 0), min = Math.min(...allVals, 0);
  if (max === min) { max += 1; min -= 1; }
  const range = max - min;
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const n = stockSeries.length;
  const x = i => pad.l + (i / (n - 1)) * innerW;
  const y = v => pad.t + innerH - ((v - min) / range) * innerH;
  const zeroY = y(0);
  const stockColor = stockPct[n - 1] >= stockPct[0] ? 'var(--kv-pass)' : 'var(--kv-fail)';

  const skip = n > 10 ? Math.ceil(n / 6) : 1;
  let xLabels = '', stockValueLabels = '';
  stockSeries.forEach((d, i) => {
    if (i % skip !== 0 && i !== n - 1) return;
    xLabels += `<text x="${x(i)}" y="${h - 4}" text-anchor="middle" class="bar-label">${escapeHtml(d.y.slice(0, 7))}</text>`;
    // Label the real price (d.v), not the % position used to plot it.
    const cy = y(stockPct[i]);
    const labelY = cy - 8 < pad.t - 14 ? cy + 14 : cy - 8;
    stockValueLabels += `<text x="${x(i)}" y="${labelY}" text-anchor="middle" class="point-label">${escapeHtml(fmtFn(d.v))}</text>`;
  });

  const stockPts = stockPct.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  const stockAreaPts = `${x(0)},${zeroY} ${stockPts} ${x(n - 1)},${zeroY}`;
  const indexPts = indexPct.map((v, i) => `${x(i)},${y(v)}`).join(' ');

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
    <line x1="${pad.l}" y1="${zeroY}" x2="${w - pad.r}" y2="${zeroY}" stroke="var(--kv-border)" stroke-width="1" stroke-dasharray="3,3"/>
    <polygon points="${stockAreaPts}" fill="${stockColor}" opacity="0.12"/>
    <polyline points="${indexPts}" fill="none" stroke="var(--kv-muted)" stroke-width="1.5" stroke-dasharray="4,3" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(n - 1)}" cy="${y(indexPct[n - 1])}" r="2.5" fill="var(--kv-muted)"/>
    ${indexLabel ? `<text x="${x(n - 1) - 6}" y="${y(indexPct[n - 1]) + (y(indexPct[n - 1]) < y(stockPct[n - 1]) ? -6 : 12)}" text-anchor="end" class="index-end-label">${escapeHtml(indexLabel)}</text>` : ''}
    <polyline points="${stockPts}" fill="none" stroke="${stockColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(n - 1)}" cy="${y(stockPct[n - 1])}" r="3.5" fill="${stockColor}"/>
    ${stockValueLabels}
    ${xLabels}
  </svg>`;
}

function deltaSpan(first, last) {
  if (first == null || last == null || first === 0) return '';
  const p = ((last - first) / Math.abs(first)) * 100;
  return `<span class="delta ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}% vs first period</span>`;
}

// ── Timeseries: try quarterly first, fall back to annual per the agreed
// per-market cadence rule — implemented as a runtime data-driven fallback
// (US/India have real quarterly data on Yahoo, ASX/KOSPI/Nikkei/Europe don't),
// not a hardcoded market list, since not all 6 markets have been verified. ──
async function fetchHistorySeries(symbol, proxyUrl) {
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 3 * 365 * 24 * 60 * 60;
  const period2 = now + 60 * 24 * 60 * 60;
  // The Worker's /timeseries route ignores the `type` query param (it always
  // fetches its own hardcoded full set — see worker/yahoo-proxy.js) and
  // returns every series it knows about in one call, so one fetch covers both
  // cadences; per-market cadence is then a client-side pick, not a re-fetch.
  const url = `${proxyUrl.replace(/\/$/, '')}/timeseries/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}`;
  const series = (await getJSON(url)) || {};

  // NB: `series.quarterlyX || series.annualX` would be broken here — Yahoo
  // returns an empty ARRAY (not undefined) for a type it has no data for, and
  // [] is truthy in JS, so a bare `||` fallback would never reach the annual
  // data. Check length explicitly instead.
  const pick = (name) => {
    const q = series[`quarterly${name}`];
    if (q && q.length > 0) return q;
    return series[`annual${name}`] || [];
  };
  const cadence = (series.quarterlyDilutedEPS && series.quarterlyDilutedEPS.length >= 3) ? 'Quarterly' : 'Annual';
  return {
    cadence,
    eps: pick('DilutedEPS'),
    fcf: pick('FreeCashFlow'),
    div: pick('CashDividendsPaid'),
    shares: pick('DilutedAverageShares'),
    // Bank/DDM pages chart ROE instead of FCF (see moneyBAlreadyScaled's comment —
    // FCF is structurally not meaningful for banks regardless of sign, so showing
    // it invites the wrong question rather than answering one). Equity is
    // annual-only on the Worker today (no quarterly type requested) — fine, since
    // every bank ticker seen so far (CBA.AX, HDFCBANK.NS) is annual-cadence anyway.
    // Both annual-only and deliberately NOT cadence-matched via pick() — ROE
    // needs net income and equity from the SAME period; mixing a quarterly net
    // income with annual-only equity would produce a nonsense ratio.
    equity: series.annualStockholdersEquity || [],
    netIncome: series.annualNetIncome || [],
  };
}

// The Worker's /timeseries route already flattens Yahoo's response to
// {date, value} (see fetchTimeseries() in worker/yahoo-proxy.js) — NOT the
// raw {asOfDate, reportedValue:{raw}} shape Yahoo's own API returns.
function toPointSeries(rawSeries, valueTransform, labelFn) {
  return rawSeries
    .filter(p => p && p.value != null && isFinite(p.value))
    .map(p => ({ y: labelFn(p.date), v: valueTransform(p.value), date: p.date }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-8); // cap at 8 points either cadence (roughly 2 years quarterly, or all available annual)
}

function fyLabel(dateStr, cadence) {
  const d = new Date(dateStr);
  if (cadence === 'Annual') return 'FY' + String(d.getFullYear()).slice(-2);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} '${String(d.getFullYear()).slice(-2)}`;
}

async function fetchPriceHistory(symbol, proxyUrl) {
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 730 * 24 * 60 * 60;
  const url = `${proxyUrl.replace(/\/$/, '')}/history/${encodeURIComponent(symbol)}?period1=${period1}&period2=${now}`;
  const points = await getJSON(url);
  if (!Array.isArray(points) || !points.length) return [];
  const buckets = {};
  for (const p of points) {
    const d = new Date(p.date);
    buckets[`${d.getFullYear()}-${d.getMonth()}`] = p; // last write per month wins (ascending input)
  }
  return Object.values(buckets).map(p => ({ y: p.date, v: p.close }));
}

// ── main ──────────────────────────────────────────────────────────────
async function main() {
  const rawTicker = process.argv[2];
  if (!rawTicker) { console.error('Usage: node scripts/generate-ticker-page.js <TICKER>'); process.exit(1); }
  const ticker = rawTicker.trim().toUpperCase();
  const proxyUrl = readProxyUrl();
  const market = marketMeta(ticker);
  const currencySym = market.currencySymbol;

  console.log(`Fetching ${ticker}...`);
  const qsUrl = `${proxyUrl.replace(/\/$/, '')}/quoteSummary/${encodeURIComponent(ticker)}?tool=dcf`;
  const rawBody = await getJSON(qsUrl);
  const data = mapQuoteSummary(rawBody, ticker);
  const synopsis = rawBody?.quoteSummary?.result?.[0]?.assetProfile?.longBusinessSummary || null;

  // RF/ERP/terminalGrowth per market (live-fetch RF where a Yahoo ticker exists)
  let live = {};
  if (ticker.endsWith('.AX')) live.ausRf = await fetchAusRf(proxyUrl);
  else if (ticker.endsWith('.NS') || ticker.endsWith('.BO')) live.indRf = await fetchIndRf(proxyUrl);
  else if (!ticker.includes('.')) live.usRf = await fetchUsRf(proxyUrl);
  const { rf, erp, terminalGrowth } = marketParamsFor(ticker, live);
  const isRfLive = !!(live.ausRf || live.indRf || live.usRf);

  const rawBeta = (data.beta != null && isFinite(data.beta) && data.beta > 0) ? data.beta : 1.0;
  const effectiveBeta = Math.max(rawBeta, getMarketBetaFloor(ticker));
  const round1 = x => +(x * 100).toFixed(1) / 100;
  const round2 = x => +(x * 100).toFixed(2) / 100;

  const isBank = isBankOrInsurance(data.sector, data.industry);
  let method, scenarios, waccBreakdown = null, d0 = null;

  if (isBank) {
    const dividend = data.trailingAnnualDividendRate ?? data.dividendRate ?? ((data.price != null && data.dividendYield != null) ? data.price * data.dividendYield : null);
    d0 = dividend != null ? +(+dividend).toFixed(2) : null;
    const rePct = round2((rf + effectiveBeta * erp) * 100);
    const baseGrowthPct = round1(deriveDividendGrowth(data.earningsGrowth, data.revenueGrowth) * 100);
    const s = deriveScenarios({ method: 'DDM', baseGrowthPct, waccOrRePct: rePct });
    method = 'DDM';
    scenarios = ['bear', 'base', 'bull'].map(key => {
      const result = calculateDDM({
        dividend: d0, growthRate: s.growth[key] / 100, terminalGrowth, costOfEquity: s.discount[key] / 100,
        projectionYears: 5, currentPrice: data.price,
      });
      return { key, growthPct: s.growth[key], discountPct: s.discount[key], result };
    });
    waccBreakdown = { re: rf + effectiveBeta * erp, rf, beta: effectiveBeta, erp, isBank: true };
  } else {
    const fcfInfo = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures);
    let baseFcf = fcfInfo.value;
    if (baseFcf != null) {
      if (isFinancialSector(data.sector) && baseFcf > 0) baseFcf = baseFcf * 0.6;
      baseFcf = Math.round(baseFcf);
    }
    const waccResult = calculateWACC({
      marketCap: data.marketCap, totalDebt: data.totalDebt, beta: effectiveBeta,
      interestExpense: data.interestExpense, taxRate: data.taxRate, riskFreeRate: rf, erp,
    });
    if (!waccResult) { console.error('Could not compute WACC (no market cap or debt data) — aborting.'); process.exit(1); }
    const waccPct = round2(waccResult.wacc * 100);
    const baseGrowthPct = round1(deriveBaseGrowth(data.revenueGrowth, data.earningsGrowth) * 100);
    const s = deriveScenarios({ method: 'DCF', baseGrowthPct, waccOrRePct: waccPct });
    method = 'DCF';
    scenarios = ['bear', 'base', 'bull'].map(key => {
      const result = calculateDCF({
        fcf: baseFcf, growthRate: s.growth[key] / 100, terminalGrowth, wacc: s.discount[key] / 100,
        projectionYears: 5, totalDebt: data.totalDebt, totalCash: data.totalCash,
        sharesOutstanding: data.sharesOutstanding, currentPrice: data.price,
      });
      return { key, growthPct: s.growth[key], discountPct: s.discount[key], result };
    });
    waccBreakdown = { ...waccResult, isBank: false };
  }

  console.log(`Method: ${method} | fetching timeseries + price history...`);
  const hist = await fetchHistorySeries(ticker, proxyUrl);
  const priceSeries = await fetchPriceHistory(ticker, proxyUrl);
  const indexSeries = market.indexTicker ? await fetchPriceHistory(market.indexTicker, proxyUrl) : [];

  const epsSeries = toPointSeries(hist.eps, v => v, d => fyLabel(d, hist.cadence));
  const fcfSeries = toPointSeries(hist.fcf, v => v / 1e9, d => fyLabel(d, hist.cadence));
  const divRaw = hist.div, sharesRaw = hist.shares;
  const sharesByDate = {}; sharesRaw.forEach(p => { if (p?.value != null) sharesByDate[p.date] = p.value; });
  // Dividend per share isn't a direct Yahoo field — derived as
  // |cashDividendsPaid| / dilutedAverageShares for the same period, matched by date.
  const divPS = divRaw
    .filter(p => p?.value != null && sharesByDate[p.date] != null)
    .map(p => ({ y: fyLabel(p.date, hist.cadence), v: Math.abs(p.value) / sharesByDate[p.date], date: p.date }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-8);

  // ROE = net income / stockholders' equity, same period. Used in place of the
  // FCF chart for bank/DDM pages (see fetchHistorySeries's comment on `equity`).
  const equityByDate = {}; hist.equity.forEach(p => { if (p?.value != null) equityByDate[p.date] = p.value; });
  const roeSeries = hist.netIncome
    .filter(p => p?.value != null && equityByDate[p.date] != null && equityByDate[p.date] !== 0)
    .map(p => ({ y: fyLabel(p.date, 'Annual'), v: (p.value / equityByDate[p.date]) * 100, date: p.date }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-8);

  const today = new Date().toISOString().slice(0, 10);
  const slug = slugify(ticker);
  const name = data.name || ticker;
  const sectorLine = [data.sector, data.industry].filter(Boolean).join(' · ');
  const v = verdict(scenarios.find(s => s.key === 'base').result?.marginOfSafety);

  const stats = isBank
    ? [
        ['Price', money(data.price, currencySym)],
        ['Market Cap', moneyB(data.marketCap, currencySym)],
        ['Dividend Yield', pct(data.dividendYield)],
        ['Beta', effectiveBeta.toFixed(2)],
        ['P/E (TTM)', data.trailingPE != null ? data.trailingPE.toFixed(1) + 'x' : 'N/A'],
        ['52-Week Range', `${money(data.fiftyTwoWeekLow, currencySym)}–${money(data.fiftyTwoWeekHigh, currencySym)}`],
      ]
    : [
        ['Price', money(data.price, currencySym)],
        ['Market Cap', moneyB(data.marketCap, currencySym)],
        ['Free Cash Flow', moneyB(data.freeCashflow, currencySym)],
        ['Beta', effectiveBeta.toFixed(2)],
        ['P/E (TTM)', data.trailingPE != null ? data.trailingPE.toFixed(1) + 'x' : 'N/A'],
        ['52-Week Range', `${money(data.fiftyTwoWeekLow, currencySym)}–${money(data.fiftyTwoWeekHigh, currencySym)}`],
      ];

  const scenarioCardsHtml = scenarios.map(s => {
    const vv = verdict(s.result?.marginOfSafety);
    return `<div class="scenario-card ${s.key}">
      <div class="sc-header ${s.key}">${s.key.toUpperCase()}</div>
      <div class="sc-intrinsic">${s.result ? money(s.result.intrinsicValue, currencySym) : 'N/A'}</div>
      <div class="sc-price">vs current ${money(data.price, currencySym)}</div>
      <div class="sc-mos ${vv.cls}">${s.result?.marginOfSafety != null ? pctSigned(s.result.marginOfSafety) + ' ' : ''}${vv.label}</div>
    </div>`;
  }).join('');

  const assumptionRows = isBank
    ? `<tr><td>Dividend growth</td><td class="col-bear">${scenarios[0].growthPct.toFixed(1)}%</td><td class="col-base">${scenarios[1].growthPct.toFixed(1)}%</td><td class="col-bull">${scenarios[2].growthPct.toFixed(1)}%</td></tr>
       <tr><td>Terminal growth</td><td class="col-bear">${(terminalGrowth * 100).toFixed(1)}%</td><td class="col-base">${(terminalGrowth * 100).toFixed(1)}%</td><td class="col-bull">${(terminalGrowth * 100).toFixed(1)}%</td></tr>
       <tr><td>Cost of equity</td><td class="col-bear">${scenarios[0].discountPct.toFixed(2)}%</td><td class="col-base">${scenarios[1].discountPct.toFixed(2)}%</td><td class="col-bull">${scenarios[2].discountPct.toFixed(2)}%</td></tr>`
    : `<tr><td>5-yr FCF growth</td><td class="col-bear">${scenarios[0].growthPct.toFixed(1)}%</td><td class="col-base">${scenarios[1].growthPct.toFixed(1)}%</td><td class="col-bull">${scenarios[2].growthPct.toFixed(1)}%</td></tr>
       <tr><td>Terminal growth</td><td class="col-bear">${(terminalGrowth * 100).toFixed(1)}%</td><td class="col-base">${(terminalGrowth * 100).toFixed(1)}%</td><td class="col-bull">${(terminalGrowth * 100).toFixed(1)}%</td></tr>
       <tr><td>WACC (discount rate)</td><td class="col-bear">${scenarios[0].discountPct.toFixed(2)}%</td><td class="col-base">${scenarios[1].discountPct.toFixed(2)}%</td><td class="col-bull">${scenarios[2].discountPct.toFixed(2)}%</td></tr>`;

  const assumptionTiles = isBank
    ? `<div class="assump-item"><div class="al">Risk-free rate</div><div class="av">${pct(rf, 2)} ${isRfLive ? '<span class="live-badge">● LIVE</span>' : ''}</div><div class="an">${isRfLive ? 'Live 10-yr govt bond' : 'Fixed market seed'}</div></div>
       <div class="assump-item"><div class="al">Beta</div><div class="av">${effectiveBeta.toFixed(2)}</div><div class="an">${getMarketBetaFloor(ticker) > 0 ? 'Floored for non-US stocks' : 'Direct from Yahoo'}</div></div>
       <div class="assump-item"><div class="al">Equity risk premium</div><div class="av">${pct(erp, 2)}</div><div class="an">Market-specific seed</div></div>
       <div class="assump-item"><div class="al">Debt component</div><div class="av">None</div><div class="an">DDM discounts dividends at cost of equity only</div></div>
       <div class="assump-item"><div class="al">Starting dividend (D0)</div><div class="av">${d0 != null ? money(d0, currencySym) : 'N/A'}</div><div class="an">Annual, per share</div></div>
       <div class="assump-item"><div class="al">Projection horizon</div><div class="av">5 years</div><div class="an">+ terminal value beyond</div></div>`
    : `<div class="assump-item"><div class="al">Risk-free rate</div><div class="av">${pct(rf, 2)} ${isRfLive ? '<span class="live-badge">● LIVE</span>' : ''}</div><div class="an">${isRfLive ? 'Live 10-yr govt bond' : 'Fixed market seed'}</div></div>
       <div class="assump-item"><div class="al">Beta</div><div class="av">${effectiveBeta.toFixed(2)}</div><div class="an">${getMarketBetaFloor(ticker) > 0 ? 'Floored for non-US stocks' : 'Direct from Yahoo'}</div></div>
       <div class="assump-item"><div class="al">Equity risk premium</div><div class="av">${pct(erp, 2)}</div><div class="an">Market-specific seed</div></div>
       <div class="assump-item"><div class="al">Cost of debt</div><div class="av">${pct(waccBreakdown.rd, 2)}</div><div class="an">${waccBreakdown.isRdEstimated ? 'Estimated (no debt/interest data)' : 'From income statement'}</div></div>
       <div class="assump-item"><div class="al">Tax rate</div><div class="av">${pct(waccBreakdown.tc, 2)}</div><div class="an">${waccBreakdown.isTcEstimated ? 'Estimated default' : 'From income statement'}</div></div>
       <div class="assump-item"><div class="al">Capital structure</div><div class="av">E ${(waccBreakdown.eWeight * 100).toFixed(0)}% / D ${(waccBreakdown.dWeight * 100).toFixed(0)}%</div><div class="an">Market cap vs total debt</div></div>
       <div class="assump-item"><div class="al">Projection horizon</div><div class="av">5 years</div><div class="an">+ terminal value beyond</div></div>`;

  const formulaLine = isBank
    ? `Cost of Equity (CAPM) = Risk-free rate + Beta × Equity Risk Premium = ${pct(rf, 2)} + ${effectiveBeta.toFixed(2)} × ${pct(erp, 2)} = ${pct(rf + effectiveBeta * erp, 2)}`
    : `Cost of Equity = Risk-free rate + Beta × Equity Risk Premium = ${pct(rf, 2)} + ${effectiveBeta.toFixed(2)} × ${pct(erp, 2)} = ${pct(waccBreakdown.re, 2)} · WACC = weighted by ${(waccBreakdown.eWeight * 100).toFixed(0)}%/${(waccBreakdown.dWeight * 100).toFixed(0)}% capital structure`;

  const bankMetricsHtml = isBank ? `
    <section class="bank-metrics">
      <h3>🏦 Bank/Insurer — valued with the Dividend Discount Model</h3>
      <p>DCF is not used for bank/insurer stocks: deposits or reserves are a raw material rather than funding, so there's no clean free cash flow. This valuation uses the Dividend Discount Model (DDM) instead.</p>
      <div class="bank-metric-grid">
        <div class="stat"><div class="stat-label">P/B</div><div class="stat-value">${data.priceToBook != null ? data.priceToBook.toFixed(2) + 'x' : 'N/A'}</div></div>
        <div class="stat"><div class="stat-label">ROE</div><div class="stat-value">${pct(data.returnOnEquity)}</div></div>
        <div class="stat"><div class="stat-label">Div Yield</div><div class="stat-value">${pct(data.dividendYield)}</div></div>
      </div>
    </section>` : '';

  const canCompareIndex = indexSeries.length >= 2 && priceSeries.length >= 2;
  const priceLast = priceSeries[priceSeries.length - 1]?.v;
  const priceChartHtml = priceSeries.length >= 2
    ? (canCompareIndex
        ? `<div class="chart-card">
            <h3>Share price · last 2 years</h3>
            <div class="chart-latest">${money(priceLast, currencySym)} ${deltaSpan(priceSeries[0].v, priceLast)}</div>
            ${dualLineChart(priceSeries, indexSeries, { w: 460, h: 120, fmtFn: x => money(x, currencySym), indexLabel: market.indexName })}
          </div>`
        : `<div class="chart-card">
            <h3>Share price · last 2 years</h3>
            <div class="chart-latest">${money(priceLast, currencySym)} ${deltaSpan(priceSeries[0].v, priceLast)}</div>
            ${lineChart(priceSeries, { w: 460, h: 120, valueKey: 'v', labelKey: 'y', fmtFn: x => money(x, currencySym) })}
          </div>`)
    : '';
  const epsChartHtml = epsSeries.length >= 2
    ? `<div class="chart-card">
        <h3>Earnings per share (diluted)</h3>
        <div class="chart-latest">${money(epsSeries[epsSeries.length - 1].v, currencySym)} ${deltaSpan(epsSeries[0].v, epsSeries[epsSeries.length - 1].v)}</div>
        ${lineChart(epsSeries, { w: 460, h: 120, valueKey: 'v', labelKey: 'y', fmtFn: x => money(x, currencySym) })}
      </div>` : '';
  const fcfLast = fcfSeries[fcfSeries.length - 1]?.v;
  const roeLast = roeSeries[roeSeries.length - 1]?.v;
  // Banks/insurers get ROE instead of FCF — free cash flow is structurally not
  // meaningful for them (deposits/reserves distort it regardless of sign; see
  // the moneyBAlreadyScaled comment above for the HDFCBANK.NS incident that
  // surfaced this), whereas ROE is the standard bank profitability metric and
  // ties directly to the DDM assumptions (sustainable ROE ~ sustainable
  // dividend growth) — already shown as a single current stat in bank-metrics,
  // this is the same number charted over time.
  const fourthChartHtml = isBank
    ? (roeSeries.length >= 2
        ? `<div class="chart-card">
            <h3>Return on equity</h3>
            <div class="chart-latest">${roeLast.toFixed(1)}% ${deltaSpan(roeSeries[0].v, roeLast)}</div>
            ${lineChart(roeSeries, { w: 460, h: 120, valueKey: 'v', labelKey: 'y', fmtFn: x => x.toFixed(1) + '%' })}
          </div>`
        : '<div class="chart-card"><h3>Return on equity</h3><p style="color:var(--kv-muted);font-size:0.82rem">No equity history available.</p></div>')
    : (fcfSeries.length >= 2
        ? `<div class="chart-card">
            <h3>Free cash flow</h3>
            <div class="chart-latest">${moneyBAlreadyScaled(fcfLast, currencySym)} ${deltaSpan(fcfSeries[0].v, fcfLast)}</div>
            ${lineChart(fcfSeries, { w: 460, h: 120, valueKey: 'v', labelKey: 'y', fmtFn: x => moneyBAlreadyScaled(x, currencySym) })}
          </div>` : '');
  const divChartHtml = divPS.length >= 2
    ? `<div class="chart-card">
        <h3>Dividend per share</h3>
        <div class="chart-latest">${money(divPS[divPS.length - 1].v, currencySym)} ${deltaSpan(divPS[0].v, divPS[divPS.length - 1].v)}</div>
        ${lineChart(divPS, { w: 460, h: 120, valueKey: 'v', labelKey: 'y', fmtFn: x => money(x, currencySym) })}
      </div>` : '<div class="chart-card"><h3>Dividend per share</h3><p style="color:var(--kv-muted);font-size:0.82rem">No dividend history available.</p></div>';

  const cadenceNote = hist.cadence === 'Quarterly'
    ? 'Quarterly reporting periods — the most granular consistent series Yahoo provides for this market.'
    : 'Annual reporting periods — this market does not have reliable quarterly data on Yahoo (either it isn’t required, or coverage is incomplete), so annual is the most granular consistent series across free cash flow and dividends.';

  const synopsisHtml = synopsis
    ? `<section class="synopsis">
        <h2>About ${escapeHtml(name)}</h2>
        <p>${escapeHtml(synopsis.split(/(?<=[.!?])\s+/).slice(0, 3).join(' '))}</p>
        <p class="src">Source: Yahoo Finance company profile · factual description, not KashVector commentary</p>
      </section>`
    : '';

  const breadcrumbHtml = market.screenUrl
    ? `<nav class="ticker-breadcrumb"><a href="/dcf/">DCF Valuation</a><span class="sep">›</span><a href="${market.screenUrl}">${market.screenName}</a><span class="sep">›</span><span class="current">${escapeHtml(ticker)}</span></nav>`
    : `<nav class="ticker-breadcrumb"><a href="/dcf/">DCF Valuation</a><span class="sep">›</span><span class="current">${escapeHtml(ticker)}</span></nav>`;

  const html = `<!doctype html>
<html lang="en" class="dark tool-dcf">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0b1120">
  <title>${escapeHtml(name)} (${escapeHtml(ticker)}) ${method} Valuation — Is ${escapeHtml(ticker)} Undervalued? | KashVector</title>
  <meta name="description" content="${escapeHtml(name)} (${escapeHtml(ticker)}) intrinsic value via ${method === 'DCF' ? 'Discounted Cash Flow' : 'Dividend Discount Model'}: Bear ${money(scenarios[0].result?.intrinsicValue, currencySym)}, Base ${money(scenarios[1].result?.intrinsicValue, currencySym)}, Bull ${money(scenarios[2].result?.intrinsicValue, currencySym)} vs current price ${money(data.price, currencySym)}. Free calculator, updated regularly.">
  <link rel="canonical" href="https://kashvector.com/dcf/stocks/${market.folder}/${slug}/">
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[
    {"@type":"ListItem","position":1,"name":"DCF Valuation","item":"https://kashvector.com/dcf/"}${market.screenUrl ? `,
    {"@type":"ListItem","position":2,"name":"${market.screenName}","item":"https://kashvector.com${market.screenUrl}"},
    {"@type":"ListItem","position":3,"name":"${escapeHtml(ticker)}","item":"https://kashvector.com/dcf/stocks/${market.folder}/${slug}/"}` : `,
    {"@type":"ListItem","position":2,"name":"${escapeHtml(ticker)}","item":"https://kashvector.com/dcf/stocks/${market.folder}/${slug}/"}`}
  ]}
  </script>
  <script src="/kv-theme.js"></script>
  <link rel="stylesheet" href="/brand.css">
  <link rel="stylesheet" href="/kv-shared.css">
  <link rel="stylesheet" href="/dcf/style.css">
  <link rel="icon" type="image/svg+xml" href="/dcf-icon.svg">
</head>
<body>
  <header class="app-header">
    <a href="/" class="home-logo" aria-label="All KashVector tools">
      <img src="/logo.svg" alt="KashVector" width="32" height="32">
      <span class="home-logo-label">&larr; All tools</span>
    </a>
    <div class="app-header-center">
      <h1>${escapeHtml(name)} (${escapeHtml(ticker)})</h1>
      <p>${method} Valuation · ${escapeHtml(sectorLine)}</p>
    </div>
    <button class="theme-toggle" onclick="window.kvTheme.toggle()" aria-label="Toggle theme"></button>
  </header>
  <div id="kv-nav-placeholder" style="height:41px"></div>
  <script src="/kv-nav.js"></script>
  ${breadcrumbHtml}

  <main>
    <p class="ticker-freshness"><span class="dot"></span>Valuation as at ${today}${market.screenUrl ? ` · refreshed with the ${market.screenName} screen` : ''}</p>

    ${synopsisHtml}

    <section class="summary">
      <h2>${escapeHtml(name)} <span class="symbol">${escapeHtml(ticker)}</span></h2>
      <p class="sector">${escapeHtml(sectorLine)}</p>
      <div class="stats">
        ${stats.map(([l, v2]) => `<div class="stat"><div class="stat-label">${l}</div><div class="stat-value">${v2}</div></div>`).join('\n        ')}
      </div>
    </section>

    <section class="history-charts">
      <h2>${escapeHtml(ticker)}'s price &amp; financial trends</h2>
      <p class="cadence-note">${cadenceNote}</p>
      <p class="refresh-note"><span class="dot"></span>Data refreshed ${today}</p>
      <div class="chart-row">${priceChartHtml}${epsChartHtml}${fourthChartHtml}${divChartHtml}</div>
    </section>

    ${bankMetricsHtml}

    <section class="scenarios-results">
      <h3>Intrinsic value estimate · 5-year forecast</h3>
      <div class="scenario-cards">${scenarioCardsHtml}</div>
    </section>

    <section class="assumptions">
      <h2>Assumptions used in this valuation</h2>
      <p class="assumptions-sub">Every input below is either fetched live from Yahoo Finance or a documented default — nothing is hidden.</p>
      <div class="assump-grid">${assumptionTiles}</div>
      <table class="scenario-assump-table">
        <thead><tr><th></th><th class="col-bear">Bear</th><th class="col-base">Base</th><th class="col-bull">Bull</th></tr></thead>
        <tbody>${assumptionRows}</tbody>
      </table>
      <p class="assump-formula">${formulaLine}</p>
    </section>

    <p class="pure-maths-note">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
      <span>These numbers come from running ${escapeHtml(name)}'s ${method === 'DCF' ? 'cash flows' : 'dividends'} through the mechanical ${method} formula and assumptions above — not from any view on the news, management, or ${escapeHtml(ticker)}'s competitive position. <a href="/glossary/">What is ${method}?</a></span>
    </p>

    <p class="ticker-cta"><span>Want to test your own ${method === 'DCF' ? 'growth or discount-rate' : 'dividend growth or cost-of-equity'} assumptions?</span><a href="/dcf/?ticker=${encodeURIComponent(ticker)}${market.folder === 'asx' ? '&asx=1' : ''}${market.folder === 'nifty' ? '&nse=1' : ''}">Open the full interactive calculator, pre-filled with ${escapeHtml(ticker)} &rarr;</a></p>

    <section class="other-tickers">
      <h2>More ${market.screenName || 'valued'} stocks</h2>
      <div class="ticker-chip-row">
        <a class="ticker-chip" href="/dcf/stocks/${market.folder}/">Browse every stock we've valued in this market &rarr;</a>
      </div>
    </section>

    <p class="disclaimer"><strong>Not financial advice.</strong> ${method} valuations are highly sensitive to assumptions — small changes in growth rate or discount rate produce large swings in output. This is a mechanical calculation, not a recommendation to buy, hold, or sell.</p>

    <section class="tool-info">
      <div class="tool-about">
        <h2>About this valuation</h2>
        <p>${market.screenUrl ? `Refreshed on the same cycle as the ${market.screenName} screen. ` : ''}Change any assumption yourself in the full interactive tool.</p>
      </div>
      <div class="tool-faq">
        <h2>Frequently asked questions</h2>
        <details class="faq-item"><summary>Is ${escapeHtml(ticker)} undervalued?</summary>
          <p>The Base-case ${method} estimates intrinsic value at ${money(scenarios[1].result?.intrinsicValue, currencySym)} vs a current price of ${money(data.price, currencySym)} — a ${pctSigned(scenarios[1].result?.marginOfSafety)} margin, so the Base case reads ${verdict(scenarios[1].result?.marginOfSafety).label.replace(/^\S+\s/, '').toLowerCase()}. This is a mechanical output, not advice.</p>
        </details>
      </div>
    </section>
  </main>

  <footer>
    <p class="disclaimer">General information only, not financial advice. <a href="/privacy-site.html" id="privacy-link">Privacy Policy</a></p>
    <p><a href="/">&larr; All KashVector tools</a></p>
    <p>&copy; 2026 KashVector. All rights reserved.</p>
  </footer>
</body>
</html>
`;

  const outDir = path.join(__dirname, '..', 'www', 'stocks', market.folder, slug);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'index.html');
  fs.writeFileSync(outFile, html);

  // Upsert this ticker into its market's manifest — the source data for
  // generate-market-index.js. Keyed by ticker so re-running an existing
  // ticker updates its entry in place rather than duplicating it.
  const manifestFile = path.join(__dirname, '..', 'www', 'stocks', market.folder, 'manifest.json');
  let manifest = [];
  if (fs.existsSync(manifestFile)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch (_) { manifest = []; }
  }
  const entry = {
    ticker, slug, name, sector: data.sector, method,
    intrinsic: scenarios[1].result?.intrinsicValue ?? null,
    price: data.price,
    marginOfSafety: scenarios[1].result?.marginOfSafety ?? null,
    updated: today,
  };
  manifest = manifest.filter(e => e.ticker !== ticker);
  manifest.push(entry);
  manifest.sort((a, b) => a.ticker.localeCompare(b.ticker));
  fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

  console.log(`\nWrote ${outFile}`);
  console.log(`Method: ${method} | Cadence: ${hist.cadence} | Base verdict: ${v.label}`);
  console.log(`Manifest updated: ${manifestFile} (${manifest.length} ticker${manifest.length === 1 ? '' : 's'} in ${market.folder})`);
  console.log(`This file is NOT committed or published — review it locally, then commit/xcopy/deploy explicitly when ready.`);
  console.log(`Run 'node scripts/generate-market-index.js ${market.folder}' to refresh the /dcf/stocks/${market.folder}/ hub page.`);
}

main().catch(err => { console.error(err); process.exit(1); });
