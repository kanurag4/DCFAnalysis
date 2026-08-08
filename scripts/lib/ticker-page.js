// scripts/lib/ticker-page.js
// Reusable library for building single ticker pages. Extracted from
// scripts/generate-ticker-page.js so the bulk refresh batch script
// (scripts/refresh-ticker-pages.js) can reuse the same implementation.

const fs = require('fs');
const path = require('path');

const { mapQuoteSummary } = require('../../www/data.js');
const { calculateWACC } = require('../../www/calc/wacc.js');
const { calculateDCF } = require('../../www/calc/dcf.js');
const { calculateDDM } = require('../../www/calc/ddm.js');
const {
  deriveFcf, deriveBaseGrowth, deriveDividendGrowth,
  getMarketBetaFloor, isBankOrInsurance, isFinancialSector,
} = require('../../www/utils.js');
const { marketParamsFor } = require('./market.js');
const { fetchUsRf, fetchAusRf, fetchIndRf } = require('./rf.js');
const { batchHeaders } = require('./batch-auth.js');
const { verdict } = require('./verdict.js');
const { pageShell, escapeHtml, breadcrumbJsonLd, breadcrumbNav } = require('./page-shell.js');

// ── validation ───────────────────────────────────────────────────────────
const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-^]*$/;

// ── IO ──────────────────────────────────────────────────────────────────
async function getJSON(url) {
  const res = await fetch(url, { headers: batchHeaders() });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// ── market → folder/screen mapping (mirrors market.js's suffix logic) ────
const EUROZONE_SUFFIXES = ['.DE', '.PA', '.AS', '.MI', '.MC', '.BR', '.LS', '.VI', '.HE', '.IR'];
// Index tickers reused verbatim from each market's rank-<market>.js config —
// same ones already validated live by the undervalued-screen batches.
// `currencySymbol` here is only a FALLBACK — the real symbol comes from Yahoo's
// own `currency` field (see CURRENCY_SYMBOLS below). This matters most for the
// europe bucket, which spans EUR *and* GBP/GBp (London) and so has no single
// correct per-market symbol at all.
function marketMeta(ticker) {
  const t = ticker.toUpperCase();
  if (t.endsWith('.AX')) return { folder: 'asx', label: 'ASX', screenName: 'ASX 300 Most Undervalued', screenUrl: '/dcf/asx-undervalued/', currencySymbol: '$', indexTicker: '^AXJO', indexName: 'ASX 200' };
  if (t.endsWith('.NS') || t.endsWith('.BO')) return { folder: 'nifty', label: 'NIFTY 500', screenName: 'NIFTY 500 Most Undervalued', screenUrl: '/dcf/nifty-undervalued/', currencySymbol: '₹', indexTicker: '^NSEI', indexName: 'NIFTY 50' };
  if (t.endsWith('.KS')) return { folder: 'kospi', label: 'KOSPI 200', screenName: 'KOSPI 200 Most Undervalued', screenUrl: '/dcf/kospi-undervalued/', currencySymbol: '₩', indexTicker: '^KS11', indexName: 'KOSPI Composite' };
  if (t.endsWith('.T')) return { folder: 'nikkei', label: 'Nikkei 225', screenName: 'Nikkei 225 Most Undervalued', screenUrl: '/dcf/nikkei-undervalued/', currencySymbol: '¥', indexTicker: '^N225', indexName: 'Nikkei 225' };
  if (t.endsWith('.L') || EUROZONE_SUFFIXES.some(s => t.endsWith(s))) return { folder: 'europe', label: 'Europe', screenName: 'Europe Most Undervalued', screenUrl: '/dcf/europe-undervalued/', currencySymbol: '€', indexTicker: '^STOXX', indexName: 'STOXX Europe 600' };
  if (!t.includes('.')) return { folder: 'sp500', label: 'S&P 500', screenName: 'S&P 500 Most Undervalued', screenUrl: '/dcf/sp500-undervalued/', currencySymbol: '$', indexTicker: '^GSPC', indexName: 'S&P 500' };
  return { folder: 'other', label: null, screenName: null, screenUrl: null, currencySymbol: '$', indexTicker: null, indexName: null };
}

// Same map the live DCF tool uses (www/app.js) — keyed off Yahoo's own
// summaryDetail.currency, so a London listing quoted in pence renders 'p' and
// one quoted in pounds renders '£', rather than inheriting the europe bucket's
// '€'. mapQuoteSummary() already surfaces `currency` and already converts GBp
// dividends to pence, so the data is present; it just wasn't being read.
const CURRENCY_SYMBOLS = { USD: '$', AUD: '$', INR: '₹', KRW: '₩', JPY: '¥', GBP: '£', GBp: 'p', EUR: '€', HKD: 'HK$', SGD: 'S$' };

const slugify = (ticker) => ticker.toLowerCase().replace(/\./g, '-');

// ── formatting helpers ─────────────────────────────────────────────────
function money(v, sym, decimals = 2) {
  if (v == null || !isFinite(v)) return 'N/A';
  const sign = v < 0 ? '-' : '';
  return sign + sym + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function moneyB(v, sym) {
  if (v == null || !isFinite(v)) return 'N/A';
  const sign = v < 0 ? '-' : '';
  return sign + sym + (Math.abs(v) / 1e9).toFixed(2) + 'B';
}
function pct(v, decimals = 1) {
  if (v == null || !isFinite(v)) return 'N/A';
  return (v * 100).toFixed(decimals) + '%';
}
function pctSigned(v, decimals = 1) {
  if (v == null || !isFinite(v)) return 'N/A';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(decimals) + '%';
}

// ── Bear/Bull scenario derivation — mirrors www/dcf/app.js's buildScenarios()
// exactly (same 0.5x/1.5x growth multipliers, same +-1pp WACC/Re offset,
// same -5/30 and 0/12 growth clamps, AND the same 1dp/2dp rounding). Not
// currently exported from app.js (browser-only, DOM-coupled) so replicated
// here as pure math.
//
// The rounding is load-bearing, not cosmetic: the live tool rounds each seed
// to the precision it displays and then computes from the ROUNDED value
// (www/app.js:385-395). Skipping that step here made the page's assumptions
// table print a rounded number while the valuation beside it was computed from
// the full float — so a reader following the "open the interactive calculator"
// CTA got a different answer from the one the page had just given them. ──
const r1 = x => +x.toFixed(1);
const r2 = x => +x.toFixed(2);
function deriveScenarios({ method, baseGrowthPct, waccOrRePct }) {
  if (method === 'DDM') {
    return {
      growth: { bear: r1(Math.max(0, baseGrowthPct * 0.5)), base: baseGrowthPct, bull: r1(Math.min(12, baseGrowthPct * 1.5)) },
      discount: { bear: r2(waccOrRePct + 1), base: waccOrRePct, bull: r2(Math.max(1, waccOrRePct - 1)) },
    };
  }
  return {
    growth: { bear: r1(Math.max(-5, baseGrowthPct * 0.5)), base: baseGrowthPct, bull: r1(Math.min(30, baseGrowthPct * 1.5)) },
    discount: { bear: r2(waccOrRePct + 1), base: waccOrRePct, bull: r2(Math.max(1, waccOrRePct - 1)) },
  };
}

// ── SVG line chart (Node port of the locked artifact prototype's lineChart()) ──

// X positions spaced by DATE, not by array index. Financial series routinely
// have gaps (a quarter Yahoo has no data for is dropped by toPointSeries), and
// index-spacing draws a 2-quarter gap the same width as a 1-quarter step —
// silently misreporting the slope. Falls back to even index spacing only if the
// series carries no parseable dates.
function chartXs(series, padL, innerW) {
  const n = series.length;
  if (n === 1) return [padL + innerW / 2];
  const ts = series.map(d => (d.date ? Date.parse(d.date) : NaN));
  const usable = ts.every(t => isFinite(t)) && ts[n - 1] > ts[0];
  if (!usable) return series.map((_, i) => padL + (i / (n - 1)) * innerW);
  const t0 = ts[0], span = ts[n - 1] - t0;
  return ts.map(t => padL + ((t - t0) / span) * innerW);
}

function lineChart(series, { w, h, valueKey, labelKey, fmtFn }) {
  const pad = { t: 22, r: 8, b: labelKey ? 18 : 6, l: 8 };
  const vals = series.map(d => d[valueKey]);
  let max = Math.max(...vals), min = Math.min(...vals, 0);
  if (max === min) { max += 1; min -= 1; }
  const range = max - min;
  const innerW = w - pad.l - pad.r, innerH = h - pad.t - pad.b;
  const xs = chartXs(series, pad.l, innerW);
  const x = i => xs[i];
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

  // preserveAspectRatio must NOT be "none": these SVGs contain <text>, and a
  // non-uniform scale stretches the glyphs at any container width != w.
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
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
//
// REQUIRES the two series to be date-aligned and equal-length — call
// alignByBucket() first. This function used to derive all x positions from the
// stock series alone and read indexPct[n-1] unguarded, which produced an index
// line running off the plot (or a NaN endpoint dot) for any stock that listed
// mid-window or had a trading suspension.
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
  const xs = chartXs(stockSeries, pad.l, innerW);
  const x = i => xs[i];
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

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet">
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

// Inner-join two monthly-bucketed price series on their bucket key, so month i
// of one is guaranteed to be month i of the other. Two independent
// fetchPriceHistory() calls can differ in both length and coverage (a stock
// that listed mid-window, a suspension, an index with a different holiday
// calendar) — without this the comparison silently compares different months.
function alignByBucket(a, b) {
  const bByKey = new Map(b.map(p => [p.k, p]));
  const aa = [], bb = [];
  for (const p of a) {
    const q = bByKey.get(p.k);
    if (q) { aa.push(p); bb.push(q); }
  }
  return [aa, bb];
}

// Names the period the comparison starts from rather than saying the vague
// "vs first period" — each card's series can start at a different period
// (Yahoo's coverage differs per metric), so an unlabelled delta invites
// comparing two numbers that aren't measured over the same window.
function deltaSpan(first, last, firstLabel) {
  if (first == null || last == null || first === 0) return '';
  const p = ((last - first) / Math.abs(first)) * 100;
  const since = firstLabel ? `vs ${escapeHtml(firstLabel)}` : 'vs first period';
  return `<span class="delta ${p >= 0 ? 'up' : 'down'}">${p >= 0 ? '+' : ''}${p.toFixed(0)}% ${since}</span>`;
}

// Pure: returns the most recent { date, value } entry's value from a Yahoo
// /timeseries series (already ascending by date), or null if the series is
// missing, empty, or the last entry's value isn't a finite number. Used for
// calc-engine inputs (always the latest ANNUAL figure), deliberately
// separate from fetchHistorySeries's pick() below, which prefers quarterly
// data where available for the history charts.
function latestAnnual(series) {
  if (!Array.isArray(series) || series.length === 0) return null;
  const v = series[series.length - 1]?.value;
  return (v != null && isFinite(v)) ? v : null;
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
  //
  // Cadence is returned PER SERIES, not once for the page: a ticker can have
  // quarterly EPS but annual-only free cash flow, and labelling annual FCF
  // points "Q3 '24" (from a page-level cadence decided by EPS alone) is simply
  // wrong.
  const pick = (name) => {
    const q = series[`quarterly${name}`];
    if (q && q.length > 0) return { points: q, cadence: 'Quarterly' };
    return { points: series[`annual${name}`] || [], cadence: 'Annual' };
  };
  // fundamentals-timeseries reports interest expense as a positive
  // magnitude, unlike incomeStatementHistory's negative expense convention
  // (mapQuoteSummary's data.interestExpense) — negate so both sources share
  // one sign convention. Same fix already made in www/dcf/data.js.
  const rawInterestExpense = latestAnnual(series.annualInterestExpense);

  return {
    eps: pick('DilutedEPS'),
    fcf: pick('FreeCashFlow'),
    div: pick('CashDividendsPaid'),
    shares: pick('DilutedAverageShares'),
    // Bank/DDM pages chart ROE instead of FCF — FCF is structurally not
    // meaningful for banks regardless of sign, so showing it invites the wrong
    // question rather than answering one. Equity is annual-only on the Worker
    // today (no quarterly type requested) — fine, since every bank ticker seen
    // so far (CBA.AX, HDFCBANK.NS) is annual-cadence anyway. Both annual-only
    // and deliberately NOT cadence-matched via pick() — ROE needs net income
    // and equity from the SAME period; mixing a quarterly net income with
    // annual-only equity would produce a nonsense ratio.
    equity: series.annualStockholdersEquity || [],
    netIncome: series.annualNetIncome || [],
    // Calc-engine inputs — deliberately annual-only (not pick() above,
    // which is for the history charts) to match the cadence the live
    // tool's own /timeseries merge uses.
    dilutedSharesOutstanding: latestAnnual(series.annualDilutedAverageShares),
    ebit: latestAnnual(series.annualOperatingIncome),
    interestExpense: rawInterestExpense != null ? -rawInterestExpense : null,
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

// A quarterly series' headline value is ONE quarter — printed a few hundred
// pixels below a TTM stat tile for the same metric, that reads as a
// contradiction unless the card says which it is.
const periodBadge = (cadence) => `<span class="chart-period">${cadence === 'Quarterly' ? 'Per quarter' : 'Per year'}</span>`;

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
  // `k` is the month bucket key, kept so two series can be inner-joined on it
  // (see alignByBucket); `date` feeds the date-proportional x spacing.
  return Object.entries(buckets).map(([k, p]) => ({ y: p.date, v: p.close, k, date: p.date }));
}

// Given the base-case scenario result (or null) and the raw inputs that fed
// it, names which specific condition produced a null intrinsic value. There
// are 4 distinct real causes -- 2 from calculateDCF/calculateDDM returning a
// literal null (fcf/dividend <= 0; discount rate <= terminal growth), 2 more
// from calculateDCF returning a non-null OBJECT with intrinsicValue: null
// (negative equity; missing sharesOutstanding) -- previously collapsed into
// one generic message that didn't distinguish them. Returns null when
// baseResult already has a real intrinsicValue (nothing to explain).
function deriveNullReason({ isBank, baseResult, baseFcf, dividend, discountPct, terminalGrowth }) {
  if (baseResult?.intrinsicValue != null) return null;
  if (baseResult == null) {
    if (isBank) {
      return (dividend == null || dividend <= 0)
        ? 'starting dividend <= 0 or unavailable'
        : `cost of equity (${discountPct}%) <= terminal growth (${(terminalGrowth * 100).toFixed(1)}%)`;
    }
    return (baseFcf == null || baseFcf <= 0)
      ? 'starting free cash flow <= 0'
      : `WACC (${discountPct}%) <= terminal growth (${(terminalGrowth * 100).toFixed(1)}%)`;
  }
  // Non-null result object with intrinsicValue: null -- DCF-only cases.
  if (baseResult.negativeEquity) return 'net debt exceeds DCF firm value (equity worth zero under these assumptions)';
  return 'shares outstanding unavailable';
}

// ── Manifest management ─────────────────────────────────────────────────
// Reads a market's manifest.json, replaces any existing row for entry.ticker
// (or appends if new), re-sorts by ticker, and writes the file back. Used by
// both the single-ticket CLI and the bulk batch script, so a ticker's manifest
// entry is always updated the same way regardless of which path wrote it.
function upsertManifestEntry(manifestPath, entry) {
  let manifest = [];
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch (_) { manifest = []; }
  }
  manifest = manifest.filter(e => e.ticker !== entry.ticker);
  manifest.push(entry);
  manifest.sort((a, b) => a.ticker.localeCompare(b.ticker));
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}

// ── Core page building ──────────────────────────────────────────────────
// Generates a single static ticker page. Accepts a ticker string and options
// (proxyUrl, optional indexHistoryCache Map). Returns:
// - { status: 'ok', html: string, entry: {...}, market: {...} }
// - { status: 'skipped', ticker: string, market: string|null, reason: string }
async function buildTickerPage(ticker, { proxyUrl, indexHistoryCache } = {}) {
  const t = (ticker || '').trim().toUpperCase();
  if (!TICKER_RE.test(t)) {
    return { status: 'skipped', ticker: ticker, market: null, reason: `invalid ticker format "${ticker}"` };
  }
  const market = marketMeta(t);

  try {
    const qsUrl = `${proxyUrl.replace(/\/$/, '')}/quoteSummary/${encodeURIComponent(t)}?tool=dcf`;
    const rawBody = await getJSON(qsUrl);
    const data = mapQuoteSummary(rawBody, t);
    const synopsis = rawBody?.quoteSummary?.result?.[0]?.assetProfile?.longBusinessSummary || null;
    const currencySym = CURRENCY_SYMBOLS[data.currency] ?? market.currencySymbol;

    let live = {};
    if (t.endsWith('.AX')) live.ausRf = await fetchAusRf(proxyUrl);
    else if (t.endsWith('.NS') || t.endsWith('.BO')) live.indRf = await fetchIndRf(proxyUrl);
    else if (!t.includes('.')) live.usRf = await fetchUsRf(proxyUrl);
    const { rf, erp, terminalGrowth } = marketParamsFor(t, live);
    const isRfLive = !!(live.ausRf || live.indRf || live.usRf);

    const rawBeta = (data.beta != null && isFinite(data.beta) && data.beta > 0) ? data.beta : 1.0;
    const effectiveBeta = Math.max(rawBeta, getMarketBetaFloor(t));

    // Moved earlier (was after the scenario computation below) so the DCF
    // branch can use its diluted-shares/EBIT/interest-expense fields.
    const hist = await fetchHistorySeries(t, proxyUrl);

    const isBank = isBankOrInsurance(data.sector, data.industry);
    let method, scenarios, waccBreakdown = null, d0 = null, waccOrRePct = null;
    let fcfInfo = null, baseFcf = null, fcfNormalised = false;

    if (isBank) {
      const dividend = data.trailingAnnualDividendRate ?? data.dividendRate ?? ((data.price != null && data.dividendYield != null) ? data.price * data.dividendYield : null);
      d0 = dividend != null ? +(+dividend).toFixed(2) : null;
      const rePct = r2((rf + effectiveBeta * erp) * 100);
      waccOrRePct = rePct;
      const baseGrowthPct = r1(deriveDividendGrowth(data.earningsGrowth, data.revenueGrowth) * 100);
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
      fcfInfo = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures);
      baseFcf = fcfInfo.value;
      if (baseFcf != null) {
        if (isFinancialSector(data.sector) && baseFcf > 0) { baseFcf = baseFcf * 0.6; fcfNormalised = true; }
        baseFcf = Math.round(baseFcf);
      }
      // Prefer /timeseries-sourced diluted shares and interest expense over
      // the basic share count / incomeStatementHistory's frequently-empty
      // interestExpense — same precedence as www/dcf/app.js and
      // www/dcf/data.js in the live tool.
      const resolvedShares = (hist.dilutedSharesOutstanding != null && hist.dilutedSharesOutstanding > 0)
        ? hist.dilutedSharesOutstanding : data.sharesOutstanding;
      const resolvedInterestExpense = hist.interestExpense != null ? hist.interestExpense : data.interestExpense;
      const waccResult = calculateWACC({
        marketCap: data.marketCap, totalDebt: data.totalDebt, beta: effectiveBeta,
        interestExpense: resolvedInterestExpense, taxRate: data.taxRate, ebit: hist.ebit,
        riskFreeRate: rf, erp,
      });
      if (!waccResult) {
        return { status: 'skipped', ticker: t, market: market.folder, reason: 'WACC uncomputable (no market cap or debt data)' };
      }
      const waccPct = r2(waccResult.wacc * 100);
      waccOrRePct = waccPct;
      const baseGrowthPct = r1(deriveBaseGrowth(data.revenueGrowth, data.earningsGrowth) * 100);
      const s = deriveScenarios({ method: 'DCF', baseGrowthPct, waccOrRePct: waccPct });
      method = 'DCF';
      scenarios = ['bear', 'base', 'bull'].map(key => {
        const result = calculateDCF({
          fcf: baseFcf, growthRate: s.growth[key] / 100, terminalGrowth, wacc: s.discount[key] / 100,
          projectionYears: 5, totalDebt: data.totalDebt, totalCash: data.totalCash,
          sharesOutstanding: resolvedShares, currentPrice: data.price,
          midYear: true,
        });
        return { key, growthPct: s.growth[key], discountPct: s.discount[key], result };
      });
      waccBreakdown = { ...waccResult, isBank: false };
    }

    const priceSeriesRaw = await fetchPriceHistory(t, proxyUrl);
    let indexSeriesRaw;
    if (market.indexTicker) {
      if (indexHistoryCache && indexHistoryCache.has(market.indexTicker)) {
        indexSeriesRaw = indexHistoryCache.get(market.indexTicker);
      } else {
        indexSeriesRaw = await fetchPriceHistory(market.indexTicker, proxyUrl);
        if (indexHistoryCache) indexHistoryCache.set(market.indexTicker, indexSeriesRaw);
      }
    } else {
      indexSeriesRaw = [];
    }
    const [priceAligned, indexAligned] = alignByBucket(priceSeriesRaw, indexSeriesRaw);

    const epsSeries = toPointSeries(hist.eps.points, v => v, d => fyLabel(d, hist.eps.cadence));
    const fcfSeries = toPointSeries(hist.fcf.points, v => v, d => fyLabel(d, hist.fcf.cadence));
    const divRaw = hist.div.points, sharesRaw = hist.shares.points;
    const sharesByDate = {}; sharesRaw.forEach(p => { if (p?.value != null) sharesByDate[p.date] = p.value; });
    const divPS = divRaw
      .filter(p => p?.value != null && sharesByDate[p.date] != null)
      .map(p => ({ y: fyLabel(p.date, hist.div.cadence), v: Math.abs(p.value) / sharesByDate[p.date], date: p.date }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-8);

    const equityByDate = {}; hist.equity.forEach(p => { if (p?.value != null) equityByDate[p.date] = p.value; });
    const roeSeries = hist.netIncome
      .filter(p => p?.value != null && equityByDate[p.date] != null && equityByDate[p.date] !== 0)
      .map(p => ({ y: fyLabel(p.date, 'Annual'), v: (p.value / equityByDate[p.date]) * 100, date: p.date }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-8);

    const today = new Date().toISOString().slice(0, 10);
    const slug = slugify(t);
    const name = data.name || t;
    const sectorLine = [data.sector, data.industry].filter(Boolean).join(' · ');
    const baseResult = scenarios.find(s => s.key === 'base').result;
    const v = verdict(baseResult?.marginOfSafety);
    const nullReason = deriveNullReason({ isBank, baseResult, baseFcf, dividend: d0, discountPct: waccOrRePct, terminalGrowth });
    // Raw diagnostic snapshot -- only populated when the base case is null,
    // so the batch can print exactly which upstream field was the actual
    // cause (2026-08-05 incident: the same 10 tickers failed identically on
    // two separate live CI runs, but reproduced cleanly when the identical
    // code was run locally against the identical Worker -- this snapshot
    // exists to settle whether that's a CI-environment-specific data
    // difference, not to guess further).
    const nullDiagnostics = nullReason ? {
      isBank, method, baseFcf, dividend: d0, discountPct: waccOrRePct, terminalGrowth,
      sharesOutstanding: data.sharesOutstanding, price: data.price,
      revenueGrowth: data.revenueGrowth, earningsGrowth: data.earningsGrowth,
      marketCap: data.marketCap, totalDebt: data.totalDebt, totalCash: data.totalCash,
      negativeEquity: baseResult?.negativeEquity ?? null,
    } : null;

    const fcfMethodBadge = fcfInfo && fcfInfo.value != null
      ? (fcfInfo.method === 'proxy' ? ' <span class="stat-warn">⚠ est.</span>'
        : fcfInfo.method === 'derived' ? ' <span style="font-size:0.7rem;color:var(--kv-muted)">OCF−CapEx</span>' : '')
      : '';
    const fcfMethodNote = !fcfInfo ? ''
      : fcfInfo.method === 'reported' ? 'Reported free cash flow (Yahoo)'
      : fcfInfo.method === 'derived' ? 'Derived: operating cash flow − capital expenditure'
      : 'Rough estimate: operating cash flow × 0.8';

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
          ['Free Cash Flow', moneyB(fcfInfo?.value, currencySym) + fcfMethodBadge],
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
        <span class="sc-mos ${vv.cls}">${s.result?.marginOfSafety != null ? pctSigned(s.result.marginOfSafety) + ' ' : ''}${vv.label}</span>
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
         <div class="assump-item"><div class="al">Beta</div><div class="av">${effectiveBeta.toFixed(2)}</div><div class="an">${getMarketBetaFloor(t) > 0 ? 'Floored for non-US stocks' : 'Direct from Yahoo'}</div></div>
         <div class="assump-item"><div class="al">Equity risk premium</div><div class="av">${pct(erp, 2)}</div><div class="an">Market-specific seed</div></div>
         <div class="assump-item"><div class="al">Debt component</div><div class="av">None</div><div class="an">DDM discounts dividends at cost of equity only</div></div>
         <div class="assump-item"><div class="al">Starting dividend (D0)</div><div class="av">${d0 != null ? money(d0, currencySym) : 'N/A'}</div><div class="an">Annual, per share</div></div>
         <div class="assump-item"><div class="al">Projection horizon</div><div class="av">5 years</div><div class="an">+ terminal value beyond</div></div>`
      : `<div class="assump-item"><div class="al">Starting free cash flow</div><div class="av">${moneyB(baseFcf, currencySym)}</div><div class="an">${fcfMethodNote}${fcfNormalised ? ', then ×0.6 — the financial-sector haircut the DCF tool and every screen apply' : ''}</div></div>
         <div class="assump-item"><div class="al">Risk-free rate</div><div class="av">${pct(rf, 2)} ${isRfLive ? '<span class="live-badge">● LIVE</span>' : ''}</div><div class="an">${isRfLive ? 'Live 10-yr govt bond' : 'Fixed market seed'}</div></div>
         <div class="assump-item"><div class="al">Beta</div><div class="av">${effectiveBeta.toFixed(2)}</div><div class="an">${getMarketBetaFloor(t) > 0 ? 'Floored for non-US stocks' : 'Direct from Yahoo'}</div></div>
         <div class="assump-item"><div class="al">Equity risk premium</div><div class="av">${pct(erp, 2)}</div><div class="an">Market-specific seed</div></div>
         <div class="assump-item"><div class="al">Cost of debt</div><div class="av">${pct(waccBreakdown.rd, 2)}</div><div class="an">${
           waccBreakdown.rdMethod === 'synthetic'
             ? `Synthetic rating ${waccBreakdown.syntheticRating}, ICR ${waccBreakdown.icr.toFixed(1)}x`
             : waccBreakdown.isRdEstimated ? 'Estimated (no debt/interest data)' : 'From income statement'
         }</div></div>
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

    const canCompareIndex = priceAligned.length >= 2;
    const priceSeries = canCompareIndex ? priceAligned : priceSeriesRaw;
    const priceLast = priceSeries[priceSeries.length - 1]?.v;
    const priceFirstLabel = priceSeries[0]?.y?.slice(0, 7);
    const priceChartHtml = priceSeries.length >= 2
      ? (canCompareIndex
          ? `<div class="chart-card">
              <h3>Share price · last 2 years</h3>
              <div class="chart-latest">${money(priceLast, currencySym)} ${deltaSpan(priceSeries[0].v, priceLast, priceFirstLabel)}</div>
              ${dualLineChart(priceAligned, indexAligned, { w: 460, h: 120, fmtFn: x => money(x, currencySym), indexLabel: market.indexName })}
            </div>`
          : `<div class="chart-card">
              <h3>Share price · last 2 years</h3>
              <div class="chart-latest">${money(priceLast, currencySym)} ${deltaSpan(priceSeries[0].v, priceLast, priceFirstLabel)}</div>
              ${lineChart(priceSeries, { w: 460, h: 120, valueKey: 'v', labelKey: 'y', fmtFn: x => money(x, currencySym) })}
            </div>`)
      : '';
    const epsChartHtml = epsSeries.length >= 2
      ? `<div class="chart-card">
          <h3>Earnings per share (diluted) ${periodBadge(hist.eps.cadence)}</h3>
          <div class="chart-latest">${money(epsSeries[epsSeries.length - 1].v, currencySym)} ${deltaSpan(epsSeries[0].v, epsSeries[epsSeries.length - 1].v, epsSeries[0].y)}</div>
          ${lineChart(epsSeries, { w: 460, h: 120, valueKey: 'v', labelKey: 'y', fmtFn: x => money(x, currencySym) })}
        </div>` : '';
    const fcfLast = fcfSeries[fcfSeries.length - 1]?.v;
    const roeLast = roeSeries[roeSeries.length - 1]?.v;
    const fourthChartHtml = isBank
      ? (roeSeries.length >= 2
          ? `<div class="chart-card">
              <h3>Return on equity ${periodBadge('Annual')}</h3>
              <div class="chart-latest">${roeLast.toFixed(1)}% ${deltaSpan(roeSeries[0].v, roeLast, roeSeries[0].y)}</div>
              ${lineChart(roeSeries, { w: 460, h: 120, valueKey: 'v', labelKey: 'y', fmtFn: x => x.toFixed(1) + '%' })}
            </div>`
          : '<div class="chart-card"><h3>Return on equity</h3><p style="color:var(--kv-muted);font-size:0.82rem">No equity history available.</p></div>')
      : (fcfSeries.length >= 2
          ? `<div class="chart-card">
              <h3>Free cash flow ${periodBadge(hist.fcf.cadence)}</h3>
              <div class="chart-latest">${moneyB(fcfLast, currencySym)} ${deltaSpan(fcfSeries[0].v, fcfLast, fcfSeries[0].y)}</div>
              ${lineChart(fcfSeries, { w: 460, h: 120, valueKey: 'v', labelKey: 'y', fmtFn: x => moneyB(x, currencySym) })}
            </div>` : '');
    const divChartHtml = divPS.length >= 2
      ? `<div class="chart-card">
          <h3>Dividend per share ${periodBadge(hist.div.cadence)}</h3>
          <div class="chart-latest">${money(divPS[divPS.length - 1].v, currencySym)} ${deltaSpan(divPS[0].v, divPS[divPS.length - 1].v, divPS[0].y)}</div>
          ${lineChart(divPS, { w: 460, h: 120, valueKey: 'v', labelKey: 'y', fmtFn: x => money(x, currencySym) })}
        </div>` : '<div class="chart-card"><h3>Dividend per share</h3><p style="color:var(--kv-muted);font-size:0.82rem">No dividend history available.</p></div>';

    const cadenceNote = hist.eps.cadence === 'Quarterly'
      ? "Each card is labelled with its own reporting period — quarterly where Yahoo provides it for this market, annual otherwise."
      : "Annual reporting periods — this market does not have reliable quarterly data on Yahoo (either it isn't required, or coverage is incomplete), so annual is the most granular consistent series across free cash flow and dividends.";

    const synopsisHtml = synopsis
      ? `<section class="synopsis">
          <h2>About ${escapeHtml(name)}</h2>
          <p>${escapeHtml(synopsis.split(/(?<=[.!?])\s+/).slice(0, 3).join(' '))}</p>
          <p class="src">Source: Yahoo Finance company profile · factual description, not KashVector commentary</p>
        </section>`
      : '';

    const canonical = `https://kashvector.com/dcf/stocks/${market.folder}/${slug}/`;
    const crumbs = [{ name: 'DCF Valuation', path: '/dcf/', url: 'https://kashvector.com/dcf/' }];
    if (market.screenUrl) crumbs.push({ name: market.screenName, path: market.screenUrl, url: `https://kashvector.com${market.screenUrl}` });
    crumbs.push({ name: t, path: canonical, url: canonical });

    const calcHref = `/dcf/?ticker=${encodeURIComponent(t)}${market.folder === 'asx' ? '&amp;asx=1' : ''}${market.folder === 'nifty' ? '&amp;nse=1' : ''}`;

    const mainHtml = `    <p class="ticker-freshness"><span class="dot"></span>Valuation as at ${today}${market.screenUrl ? ` · see also the <a href="${market.screenUrl}">${escapeHtml(market.screenName)}</a> screen` : ''}</p>

      ${synopsisHtml}

      <section class="summary">
        <h2>${escapeHtml(name)} <span class="symbol">${escapeHtml(t)}</span></h2>
        <p class="sector">${escapeHtml(sectorLine)}</p>
        <div class="stats">
          ${stats.map(([l, v2]) => `<div class="stat"><div class="stat-label">${l}</div><div class="stat-value">${v2}</div></div>`).join('\n        ')}
        </div>
      </section>

      <section class="history-charts">
        <h2>${escapeHtml(t)}'s price &amp; financial trends</h2>
        <p class="cadence-note">${cadenceNote}</p>
        <p class="refresh-note"><span class="dot"></span>Data as at ${today}</p>
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
        <span>These numbers come from running ${escapeHtml(name)}'s ${method === 'DCF' ? 'cash flows' : 'dividends'} through the mechanical ${method} formula and assumptions above — not from any view on the news, management, or ${escapeHtml(t)}'s competitive position. <a href="/glossary/">What is ${method}?</a></span>
      </p>

      <p class="ticker-cta"><span>Want to test your own ${method === 'DCF' ? 'growth or discount-rate' : 'dividend growth or cost-of-equity'} assumptions?</span><a href="${calcHref}">Open the full interactive calculator, pre-filled with ${escapeHtml(t)} &rarr;</a></p>

      <section class="other-tickers">
        <h2>More ${market.label ? escapeHtml(market.label) + ' ' : ''}stocks we've valued</h2>
        <div class="ticker-chip-row">
          <a class="ticker-chip" href="/dcf/stocks/${market.folder}/">Browse every stock we've valued in this market &rarr;</a>
        </div>
      </section>

      <p class="disclaimer"><strong>Not financial advice.</strong> ${method} valuations are highly sensitive to assumptions — small changes in growth rate or discount rate produce large swings in output. This is a mechanical calculation, not a recommendation to buy, hold, or sell.</p>

      <section class="tool-info">
        <div class="tool-about">
          <h2>About this valuation</h2>
          <p>Computed on ${today} from Yahoo Finance data, using the same engine as the <a href="/dcf/">full DCF tool</a>${market.screenUrl ? ` and the <a href="${market.screenUrl}">${escapeHtml(market.screenName)}</a> screen` : ''}. Every figure above is a point-in-time snapshot of that date — change any assumption yourself in the interactive tool for a live one.</p>
        </div>
        <div class="tool-faq">
          <h2>Frequently asked questions</h2>
          <details class="faq-item"><summary>Is ${escapeHtml(t)} undervalued?</summary>
            <p>The Base-case ${method} estimates intrinsic value at ${money(baseResult?.intrinsicValue, currencySym)} vs a price of ${money(data.price, currencySym)} on ${today} — a ${pctSigned(baseResult?.marginOfSafety)} margin, so the Base case reads ${v.text.toLowerCase()}. This is a mechanical output, not advice.</p>
          </details>
        </div>
      </section>`;

    const html = pageShell({
      title: `${name} (${t}) ${method} Valuation — Is ${t} Undervalued? | KashVector`,
      description: `${name} (${t}) intrinsic value via ${method === 'DCF' ? 'Discounted Cash Flow' : 'Dividend Discount Model'}: Bear ${money(scenarios[0].result?.intrinsicValue, currencySym)}, Base ${money(scenarios[1].result?.intrinsicValue, currencySym)}, Bull ${money(scenarios[2].result?.intrinsicValue, currencySym)} vs a price of ${money(data.price, currencySym)} on ${today}. Free, no sign-up.`,
      canonical,
      h1: `${name} (${t})`,
      subtitle: `${method} Valuation · ${escapeHtml(sectorLine)}`,
      jsonLd: [breadcrumbJsonLd(crumbs)],
      breadcrumbHtml: breadcrumbNav(crumbs),
      mainHtml,
    });

    const entry = {
      ticker: t, slug, name, sector: data.sector, method,
      intrinsic: baseResult?.intrinsicValue ?? null,
      price: data.price,
      marginOfSafety: baseResult?.marginOfSafety ?? null,
      updated: today,
    };

    return { status: 'ok', html, entry, market, nullReason, nullDiagnostics };
  } catch (err) {
    return { status: 'skipped', ticker: t, market: market.folder, reason: `fetch failed: ${err.message}` };
  }
}

module.exports = { buildTickerPage, upsertManifestEntry, deriveNullReason, latestAnnual };
