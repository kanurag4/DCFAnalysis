// scripts/lib/ticker-page.js
// Reusable library for building single ticker pages. Extracted from
// scripts/generate-ticker-page.js so the bulk refresh batch script
// (scripts/refresh-ticker-pages.js) can reuse the same implementation.

const fs = require('fs');
const path = require('path');

const { mapQuoteSummary, fetchFxRate, gbpPenceScale, scaleTimeseries, isGbpPenceCurrencyPair, ttmFromTimeseries } = require('../../www/data.js');
const { heavyCapexForAssumptions, heavyCapexExistingFcf, heavyCapexValuation, heavyCapexCardText } = require('../../www/calc/heavyCapex.js');
const { calculateWACC } = require('../../www/calc/wacc.js');
const { calculateDCF } = require('../../www/calc/dcf.js');
const { calculateFadingGrowthDCF } = require('../../www/calc/fadingGrowthDcf.js');
const { calculateDDM } = require('../../www/calc/ddm.js');
const { calculateExcessReturn } = require('../../www/calc/excessReturn.js');
const { deriveFfo, deriveAffo, calculateReitValue } = require('../../www/calc/reit.js');
const { calculateAirlineValue } = require('../../www/calc/airline.js');
const { cyclicalBaseFcf } = require('../../www/calc/cyclicalNormalization.js');
const sectorMarginLookup = require('../../www/sector-margins.json');
const { applyHoldcoDiscountToScenarios } = require('../../www/calc/holdcoDiscount.js');
const { REIT_SECTOR_MULTIPLES, AIRLINE_EV_EBITDA_MULTIPLE, HOLDCO_DISCOUNT } = require('../../www/config.js');
const {
  deriveFcf, deriveMultiYearGrowth, deriveDividendGrowth,
  getMarketBetaFloor, isBankOrInsurance, isFinancialSector, chooseFinancialModel, isReit, isAirline, isUtility, isCyclical, isConglomerate, isSaas,
} = require('../../www/utils.js');
const { marketParamsFor } = require('./market.js');
const { fetchUsRf, fetchAusRf, fetchIndRf } = require('./rf.js');
const { batchHeaders } = require('./batch-auth.js');
const { verdict } = require('./verdict.js');
const { THREE_STAGE_DCF_ENABLED, threeStageInputs, threeStageScenarioSeeds, threeStageScenario, threeStageEligible, threeStageLender } = require('../../www/calc/threeStageDcf.js');
const { buildValueScaleCard } = require('./value-scale.js');
const { buildSolvencyScaleCard } = require('./solvency-scale.js');
const { buildAiCorrelationCard, buildAiCorrelationFaqHtml } = require('./ai-correlation-card.js');
const { getAiCorrelations } = require('./ai-correlation-batch.js');
const { selectRelatedStocks, buildRelatedStocksHtml } = require('./related-stocks.js');
const { readGrowthManifest, listGrowthMarketFolders } = require('./growth-manifest-reader.js');
const { pageShell, escapeHtml, breadcrumbJsonLd, breadcrumbNav } = require('./page-shell.js');

// ── validation ───────────────────────────────────────────────────────────
const TICKER_RE = /^[A-Z0-9][A-Z0-9.\-^]*$/;

// ── IO ──────────────────────────────────────────────────────────────────
async function getJSON(url) {
  const res = await fetch(url, { headers: batchHeaders() });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

// A single buildTickerPage() call fires 4-6 Worker requests in sequence
// (quoteSummary, rf-rate, timeseries, FX rate, price history, index price
// history) -- callers only throttle BETWEEN tickers (3200ms, same
// convention as scripts/lib/run-screen.js), so with no spacing here that
// burst alone can blow past the Worker's per-isolate rate limit even
// before the next ticker starts. Confirmed live 2026-08-24: a bulk
// regeneration run hit HTTP 429 on 46/47 tickers with only inter-ticker
// throttling in place. Same 3200ms figure used everywhere else in this
// codebase for exactly this reason -- not a tunable, a known-safe pace.
const FETCH_SPACING_MS = 3200;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── market → folder/screen mapping (mirrors market.js's suffix logic) ────
const EUROZONE_SUFFIXES = ['.DE', '.PA', '.AS', '.MI', '.MC', '.BR', '.LS', '.VI', '.HE', '.IR'];
// Index tickers reused verbatim from each market's rank-<market>.js config —
// same ones already validated live by the undervalued-screen batches.
// `currencySymbol` here is only a FALLBACK — the real symbol comes from Yahoo's
// own `currency` field (see CURRENCY_SYMBOLS below). This matters most for the
// 'other' bucket, which spans EUR *and* GBP/GBp (London) today and will span
// more currencies as more non-dedicated markets (China A-shares, Hong Kong,
// etc.) are added — no single correct per-market symbol at all.
//
// 'other' is a deliberately shared catch-all folder (renamed from a
// Europe-only 'europe' folder 2026-08-11), not a dedicated market like
// asx/nifty/kospi/nikkei/sp500 — it's where any ticker without its own
// undervalued-screen/index-page infrastructure lands, starting with Europe
// and growing to include other markets over time. `.L` + the Eurozone
// suffixes still resolve to the Europe Most Undervalued screen/STOXX index
// for screenName/screenUrl/indexTicker below — that mapping is or­thogonal to
// the folder rename, since those tickers genuinely are covered by that
// screener regardless of which folder their SEO page lives in.
function marketMeta(ticker) {
  const t = ticker.toUpperCase();
  if (t.endsWith('.AX')) return { folder: 'asx', label: 'ASX', screenName: 'ASX 300 Most Undervalued', screenUrl: '/dcf/asx-undervalued/', currencySymbol: '$', indexTicker: '^AXJO', indexName: 'ASX 200' };
  if (t.endsWith('.NS') || t.endsWith('.BO')) return { folder: 'nifty', label: 'NIFTY 500', screenName: 'NIFTY 500 Most Undervalued', screenUrl: '/dcf/nifty-undervalued/', currencySymbol: '₹', indexTicker: '^NSEI', indexName: 'NIFTY 50' };
  // folder: 'other', not 'kospi'/'nikkei' -- same pattern as the Europe-suffix
  // rule below (folder 'other' + a real screen affiliation): the ticker-pages
  // system files Korean and Japanese stocks under Other Markets (grouped by
  // sub-market on that index page, see the 2026-08-18 "Group Other Markets
  // index page by sub-market" commit) even though the separate KOSPI/Nikkei
  // 225 ranking screens (their own batch/universe/refresh pipelines) still
  // exist and this page still cross-links to them. There has never been a
  // dedicated top-level 'kospi' folder in production -- this rule regressed
  // to one briefly on 2026-08-19 (stale code predating the sub-market
  // consolidation) and was caught before publishing; don't reintroduce it.
  if (t.endsWith('.KS')) return { folder: 'other', label: 'KOSPI 200', screenName: 'KOSPI 200 Most Undervalued', screenUrl: '/dcf/kospi-undervalued/', currencySymbol: '₩', indexTicker: '^KS11', indexName: 'KOSPI Composite' };
  if (t.endsWith('.T')) return { folder: 'other', label: 'Nikkei 225', screenName: 'Nikkei 225 Most Undervalued', screenUrl: '/dcf/nikkei-undervalued/', currencySymbol: '¥', indexTicker: '^N225', indexName: 'Nikkei 225' };
  if (t.endsWith('.L') || EUROZONE_SUFFIXES.some(s => t.endsWith(s))) return { folder: 'other', label: null, screenName: 'Europe Most Undervalued', screenUrl: '/dcf/europe-undervalued/', currencySymbol: '€', indexTicker: '^STOXX', indexName: 'STOXX Europe 600' };
  // Hong Kong / China A-shares: no dedicated undervalued screen exists (screenName/
  // screenUrl null, same as the generic fallback), but they get a real currency symbol
  // and index ticker rather than inheriting the fallback's '$'/null — same principle as
  // market.js's rf/erp seeds just above, ported from the same source (commit 98dc69d,
  // 2026-08-10) so this doesn't silently fall into the generic bucket either.
  if (t.endsWith('.HK')) return { folder: 'other', label: null, screenName: null, screenUrl: null, currencySymbol: 'HK$', indexTicker: '^HSI', indexName: 'Hang Seng Index' };
  if (t.endsWith('.SS') || t.endsWith('.SZ')) return { folder: 'other', label: null, screenName: null, screenUrl: null, currencySymbol: 'CN¥', indexTicker: '000001.SS', indexName: 'Shanghai Composite' };
  // ETF radar additions (2026-08-31 in market.js's WACC/growth seeds -- never
  // mirrored here until 2026-09-02, found live-testing RO.SW: it fell to the
  // generic catch-all below, which has indexTicker: null, so its page silently
  // had no comparison line on the price chart at all, unlike every other
  // European ticker. All 6 symbols below confirmed live against the Worker's
  // /history route before adding (Norway needed OSEBX.OL -- ^OSEBX returns
  // empty). Switzerland gets STOXX Europe 600, matching this file's existing
  // precedent of using that broad pan-European benchmark for the UK too
  // (line above), not a UK/Swiss-specific local index.
  if (t.endsWith('.SW')) return { folder: 'other', label: null, screenName: null, screenUrl: null, currencySymbol: 'CHF', indexTicker: '^STOXX', indexName: 'STOXX Europe 600' };
  if (t.endsWith('.TW')) return { folder: 'other', label: null, screenName: null, screenUrl: null, currencySymbol: 'NT$', indexTicker: '^TWII', indexName: 'Taiwan Weighted Index' };
  if (t.endsWith('.TA')) return { folder: 'other', label: null, screenName: null, screenUrl: null, currencySymbol: '₪', indexTicker: 'TA35.TA', indexName: 'Tel Aviv 35' };
  if (t.endsWith('.ST')) return { folder: 'other', label: null, screenName: null, screenUrl: null, currencySymbol: 'kr', indexTicker: '^OMX', indexName: 'OMX Stockholm 30' };
  if (t.endsWith('.OL')) return { folder: 'other', label: null, screenName: null, screenUrl: null, currencySymbol: 'kr', indexTicker: 'OSEBX.OL', indexName: 'Oslo Børs Benchmark' };
  if (t.endsWith('.SI')) return { folder: 'other', label: null, screenName: null, screenUrl: null, currencySymbol: 'S$', indexTicker: '^STI', indexName: 'Straits Times Index' };
  // KOSDAQ: same market as KOSPI (.KS above) for valuation-parameter purposes
  // -- see market.js's identical note -- so it gets the identical metadata too.
  if (t.endsWith('.KQ')) return { folder: 'other', label: 'KOSPI 200', screenName: 'KOSPI 200 Most Undervalued', screenUrl: '/dcf/kospi-undervalued/', currencySymbol: '₩', indexTicker: '^KS11', indexName: 'KOSPI Composite' };
  if (!t.includes('.')) return { folder: 'sp500', label: 'S&P 500', screenName: 'S&P 500 Most Undervalued', screenUrl: '/dcf/sp500-undervalued/', currencySymbol: '$', indexTicker: '^GSPC', indexName: 'S&P 500' };
  return { folder: 'other', label: null, screenName: null, screenUrl: null, currencySymbol: '$', indexTicker: null, indexName: null };
}

// Same map the live DCF tool uses (www/app.js) — keyed off Yahoo's own
// summaryDetail.currency, so a London listing quoted in pence renders 'p' and
// one quoted in pounds renders '£', rather than inheriting the europe bucket's
// '€'. mapQuoteSummary() already surfaces `currency` and already converts GBp
// dividends to pence, so the data is present; it just wasn't being read.
const CURRENCY_SYMBOLS = { USD: '$', AUD: '$', INR: '₹', KRW: '₩', JPY: '¥', GBP: '£', GBp: 'p', EUR: '€', HKD: 'HK$', SGD: 'S$', CNY: 'CN¥' };

// Display form for the internal `method` identifier ('DCF'/'DDM'/'ExcessReturn')
// wherever it's interpolated directly into page copy. DCF/DDM are already valid
// short-form abbreviations and pass through unchanged; ExcessReturn's internal
// identifier has no spaces and reads badly inline (e.g. "ExcessReturn Valuation",
// "mechanical ExcessReturn formula") -- fixed 2026-08-15, peer review finding.
const METHOD_SHORT = { DCF: 'DCF', DDM: 'DDM', ExcessReturn: 'Excess Return', REIT: 'FFO/AFFO', Airline: 'EV/EBITDA' };
// Where the "What is <method>?" footer link points — a dedicated glossary page
// where one exists, else the relevant glossary anchor.
const METHOD_GLOSSARY = {
  DCF: '/glossary/dcf-vs-ddm/',
  DDM: '/glossary/dcf-vs-ddm/',
  ExcessReturn: '/glossary/#excess-return-model',
  REIT: '/glossary/#p-affo-multiple',
  Airline: '/glossary/#ev-ebitda-multiple',
};

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
// exactly (same +-1pp WACC/Re offset, same 0/12 DDM growth clamp, AND the
// same 1dp/2dp rounding). Not currently exported from app.js (browser-only,
// DOM-coupled) so replicated here as pure math.
//
// The DCF growth spread (2026-08-11) is a magnitude offset from base
// (base +/- |base|*0.5), NOT the DDM branch's base*0.5/base*1.5 multiplier
// form. The multiplier form inverts direction once base is negative: halving
// a negative number moves it toward zero (an easier bear case, not harsher)
// and 1.5x-ing it pushes it further negative (a harsher bull case, not
// easier) -- see www/dcf/app.js's matching comment. Every already-published
// page for a shrinking company had bear/bull swapped until this fix.
//
// The rounding is load-bearing, not cosmetic: the live tool rounds each seed
// to the precision it displays and then computes from the ROUNDED value
// (www/app.js:385-395). Skipping that step here made the page's assumptions
// table print a rounded number while the valuation beside it was computed from
// the full float — so a reader following the "open the interactive calculator"
// CTA got a different answer from the one the page had just given them. ──
const r1 = x => +x.toFixed(1);
const r2 = x => +x.toFixed(2);

// The DCF base-case growth seed, in percent to 1dp. Pulled out of buildTickerPage() so the exact
// object handed to deriveMultiYearGrowth() can be unit-tested without a network fetch.
// sector/industry MUST be passed: deriveMultiYearGrowth() decides "cyclical -> retention x ROE
// alone" from them, and omitting them (as this call once did) silently put every cyclical page on
// the lower-of-two rule -- PSX read -5% here but +14.4% in the screens and the live tool.
function deriveBaseGrowthPct(data, hist) {
  return r1(deriveMultiYearGrowth({
    sector: data.sector, industry: data.industry,
    revenueGrowth: data.revenueGrowth, earningsGrowth: data.earningsGrowth,
    annualRevenueHistory: hist.annualRevenueHistory, annualFcfHistory: hist.annualFcfHistory,
    annualNetIncomeHistory: hist.annualNetIncomeHistory,
    annualStockholdersEquityHistory: hist.annualStockholdersEquityHistory,
    annualDividendsPaidHistory: hist.annualDividendsPaidHistory,
  }) * 100);
}

function deriveScenarios({ method, baseGrowthPct, waccOrRePct }) {
  if (method === 'DDM') {
    return {
      growth: { bear: r1(Math.max(0, baseGrowthPct * 0.5)), base: baseGrowthPct, bull: r1(Math.min(12, baseGrowthPct * 1.5)) },
      discount: { bear: r2(waccOrRePct + 1), base: waccOrRePct, bull: r2(Math.max(1, waccOrRePct - 1)) },
    };
  }
  if (method === 'ExcessReturn') {
    // "growth" slot holds ROE for this model -- same magnitude-offset shape as DCF's
    // growth spread (not DDM's x0.5/x1.5 multiplier, which inverts direction for
    // negative bases), but matching calc/assumptions.js's roeOffsetSpread() bounds
    // (floor 0, ceiling 60), NOT growthOffsetSpread()'s (-15/30). growthOffsetSpread's
    // 30% ceiling is far too low for a high-ROE financial -- a real NBFC checked while
    // building this sits at ~31.7% ROE, which that ceiling clamps *below* base,
    // inverting bull < base (fixed here 2026-08-15, peer review finding -- this file
    // had reintroduced the exact bug roeOffsetSpread() was built to fix, despite a
    // comment here previously claiming the two already matched). Kept as a separate,
    // from-scratch Node reimplementation rather than importing that browser-loaded
    // file -- same established pattern this generator already uses for DCF/DDM, see
    // CLAUDE.md's note on this exact drift risk.
    const roeOffset = Math.abs(baseGrowthPct) * 0.5;
    return {
      growth: {
        bear: r1(Math.max(0, baseGrowthPct - roeOffset)),
        base: baseGrowthPct,
        bull: r1(Math.min(60, baseGrowthPct + roeOffset)),
      },
      discount: { bear: r2(waccOrRePct + 1), base: waccOrRePct, bull: r2(Math.max(1, waccOrRePct - 1)) },
    };
  }
  const dcfGrowthOffset = Math.abs(baseGrowthPct) * 0.5;
  return {
    growth: {
      bear: r1(Math.max(-15, baseGrowthPct - dcfGrowthOffset)),
      base: baseGrowthPct,
      bull: r1(Math.min(30, baseGrowthPct + dcfGrowthOffset)),
    },
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
  // Both bounds forced to include 0, not just min -- the area fill's baseline
  // is y(0), so if the whole series sits on one side of zero (e.g. an
  // all-negative EPS run), 0 must still be a real point in the domain or y(0)
  // extrapolates far outside the plot (bug found live on RBLX's EPS chart,
  // 2026-09-04: an all-negative series left max at the least-negative value
  // instead of 0, producing a fill polygon baseline y=-116.67 against a
  // viewBox height of 120). Matches dualLineChart()'s already-correct
  // symmetric Math.max(...allVals, 0)/Math.min(...allVals, 0) pattern below.
  let max = Math.max(...vals, 0), min = Math.min(...vals, 0);
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

// Pure: picks quarterly vs. annual for one /timeseries field, per the agreed
// per-market cadence rule — implemented as a runtime data-driven fallback
// (US/India have real quarterly data on Yahoo, ASX/KOSPI/Nikkei/Europe don't),
// not a hardcoded market list, since not all 6 markets have been verified.
//
// NB: `series.quarterlyX || series.annualX` would be broken here — Yahoo
// returns an empty ARRAY (not undefined) for a type it has no data for, and
// [] is truthy in JS, so a bare `||` fallback would never reach the annual
// data. Check length explicitly instead.
//
// Quarterly is only preferred when it has >= 2 points — enough to draw a
// trend at all (toPointSeries requires >= 2 downstream). A single quarterly
// point is worse than useless: it silently vanishes the whole chart card
// rather than falling back to a perfectly good multi-year annual series.
// Confirmed live on FPH.AX (NZ-domiciled, dual-listed ASX): Yahoo reports
// exactly 1 quarterlyDilutedEPS point but 4 annualDilutedEPS points.
//
// Cadence is returned PER SERIES, not once for the page: a ticker can have
// quarterly EPS but annual-only free cash flow, and labelling annual FCF
// points "Q3 '24" (from a page-level cadence decided by EPS alone) is simply
// wrong.
function pickCadence(series, name) {
  const q = series[`quarterly${name}`] || [];
  if (q.length >= 2) return { points: q, cadence: 'Quarterly' };
  return { points: series[`annual${name}`] || [], cadence: 'Annual' };
}

// Gate for the revenue-normalised FCF fallback (a stand-in for "Yahoo has no
// FCF data at all"). Must NOT fire when the cyclical-normalization path
// (isCyclical dispatch above) already deliberately computed a real value
// that just happens to be negative -- overriding it here silently
// contradicted the page's own cyclical-note text, which still claimed the
// negative multi-year/sector margin was used (found 2026-08-24 on
// 096770.KS/SK Innovation -- see docs/superpowers/specs/2026-08-24-sector-
// average-cyclical-margin-design.md). A negative cyclical value now flows to
// calculateDCF()'s own `fcf <= 0 -> null` guard and this file's existing
// null-base-case retry/skip path instead.
// Assumptions-row note for the revenue-normalised fallback. reportedFcf is the pre-fallback figure: a number
// <= 0 means Yahoo DID report FCF, it was just negative (NEU.AX, 2026-11-05) -- not "unavailable".
function revenueFallbackNote(marginPct, reportedFcf) {
  const why = Number.isFinite(reportedFcf) && reportedFcf <= 0 ? 'negative' : 'unavailable';
  return `Revenue × ${marginPct}% target margin — reported FCF ${why}`;
}

function shouldApplyRevenueFallback({ baseFcf, fcfMethod, totalRevenue }) {
  return (baseFcf == null || (baseFcf <= 0 && fcfMethod !== 'normalized')) && totalRevenue > 0;
}

async function fetchHistorySeries(symbol, proxyUrl, currency) {
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 3 * 365 * 24 * 60 * 60;
  const period2 = now + 60 * 24 * 60 * 60;
  // The Worker's /timeseries route ignores the `type` query param (it always
  // fetches its own hardcoded full set — see worker/yahoo-proxy.js) and
  // returns every series it knows about in one call, so one fetch covers both
  // cadences; per-market cadence is then a client-side pick, not a re-fetch.
  const url = `${proxyUrl.replace(/\/$/, '')}/timeseries/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}`;
  const series = (await getJSON(url)) || {};

  const pick = (name) => pickCadence(series, name);
  // fundamentals-timeseries reports interest expense as a positive
  // magnitude, unlike incomeStatementHistory's negative expense convention
  // (mapQuoteSummary's data.interestExpense) — negate so both sources share
  // one sign convention. Same fix already made in www/dcf/data.js.
  const rawInterestExpense = latestAnnual(series.annualInterestExpense);
  // GBp tickers (LSE, quoted in pence): /timeseries reports financial-
  // statement aggregates in pounds, same as quoteSummary's financialData
  // module -- see www/data.js's mapQuoteSummary()/gbpPenceScale() comment.
  // Only the calc-engine-feeding fields below are scaled -- eps/fcf/div/
  // shares/equity/netIncome are chart-display series and are deliberately
  // left in native currency, same precedent the FX-conversion block further
  // down in buildTickerPage() already establishes for genuinely-different-
  // currency ADRs.
  const gbpToPence = gbpPenceScale(currency);
  const rawEbit = latestAnnual(series.annualOperatingIncome);
  const rawFcfAnnualLatest = latestAnnual(series.annualFreeCashFlow);

  // Dividend-per-share needs `div` (CashDividendsPaid) and `shares`
  // (DilutedAverageShares) at the SAME cadence, joined by exact date,
  // downstream in the divPS chart computation. Picking each independently via
  // pick() (as EPS/FCF do) can select cadences that individually cross
  // pickCadence's >=2-point bar yet share zero or one overlapping date — e.g.
  // annual-only dividends vs. quarterly share counts, or a sparse "quarterly"
  // dividend series (real payment dates, not clean quarter-ends) that barely
  // overlaps a quarter-end share series. Confirmed live 2026-08-11 (Europe
  // pilot): SHL.DE has annual-cadence dividends but quarterly-cadence shares
  // with zero matching dates; SAN.PA has the same pattern with exactly 1
  // matching date; FME.DE's "quarterly" dividend series only overlaps a
  // quarterly share series at 1 date. All three fully recover (3-4 matching
  // points) once both series use annual dates instead. Decide cadence at the
  // JOIN, not per-series — same principle already applied to equity/netIncome
  // below, just enforced where it actually matters.
  const overlapCount = (divPts, sharePts) => {
    const dates = new Set(sharePts.filter(p => p?.value != null).map(p => p.date));
    return divPts.filter(p => p?.value != null && dates.has(p.date)).length;
  };
  const qDiv = series.quarterlyCashDividendsPaid || [];
  const qShares = series.quarterlyDilutedAverageShares || [];
  const aDiv = series.annualCashDividendsPaid || [];
  const aShares = series.annualDilutedAverageShares || [];
  const useQuarterlyDiv = overlapCount(qDiv, qShares) >= 2;
  const divPick = useQuarterlyDiv
    ? { points: qDiv, cadence: 'Quarterly' }
    : { points: aDiv, cadence: 'Annual' };
  const sharesPick = useQuarterlyDiv
    ? { points: qShares, cadence: 'Quarterly' }
    : { points: aShares, cadence: 'Annual' };

  return {
    eps: pick('DilutedEPS'),
    fcf: pick('FreeCashFlow'),
    div: divPick,
    shares: sharesPick,
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
    ebit: rawEbit != null ? rawEbit * gbpToPence : null,
    interestExpense: rawInterestExpense != null ? -rawInterestExpense * gbpToPence : null,
    // Last-resort FCF fallback — see www/utils.js's deriveFcf() for why this
    // tier exists (Yahoo's financialData module only ever reports TTM, and
    // some tickers, e.g. TECHM.NS, have no TTM figure at all despite every
    // individual fiscal year having real data) and why it's ordered last.
    fcfAnnualLatest: rawFcfAnnualLatest != null ? rawFcfAnnualLatest * gbpToPence : null,
    // Full multi-year series (not just the latest entry) — used by the
    // isCyclical branch below to average the FCF margin across a real
    // fiscal-year history instead of anchoring the DCF to whichever single
    // year happens to be a cycle peak or trough. Same source www/dcf/data.js's
    // fetchDCFData() uses for the live tool.
    annualFcfHistory: scaleTimeseries(Array.isArray(series.annualFreeCashFlow) ? series.annualFreeCashFlow : [], gbpToPence),
    annualRevenueHistory: scaleTimeseries(Array.isArray(series.annualTotalRevenue) ? series.annualTotalRevenue : [], gbpToPence),
    // Same three series Damodaran's fundamental-growth seed needs (see
    // www/utils.js's deriveMultiYearGrowth) -- kept separate from the
    // `equity`/`netIncome` fields above (used only for the ROE chart, and
    // NOT run through the FX-conversion block below) so the growth seed
    // always gets a correctly-converted value regardless of chart handling.
    annualNetIncomeHistory: scaleTimeseries(Array.isArray(series.annualNetIncome) ? series.annualNetIncome : [], gbpToPence),
    annualStockholdersEquityHistory: scaleTimeseries(Array.isArray(series.annualStockholdersEquity) ? series.annualStockholdersEquity : [], gbpToPence),
    annualDividendsPaidHistory: scaleTimeseries(Array.isArray(series.annualCashDividendsPaid) ? series.annualCashDividendsPaid : [], gbpToPence),
    // Solvency Check (Altman Z-Score + Piotroski F-Score) inputs -- see
    // docs/superpowers/specs/2026-09-13-solvency-check-design.md. Mirrors
    // www/data.js's fetchDCFData() field-for-field.
    annualTotalAssetsHistory: scaleTimeseries(Array.isArray(series.annualTotalAssets) ? series.annualTotalAssets : [], gbpToPence),
    annualCurrentAssetsHistory: scaleTimeseries(Array.isArray(series.annualCurrentAssets) ? series.annualCurrentAssets : [], gbpToPence),
    annualCurrentLiabilitiesHistory: scaleTimeseries(Array.isArray(series.annualCurrentLiabilities) ? series.annualCurrentLiabilities : [], gbpToPence),
    annualTotalLiabilitiesHistory: scaleTimeseries(Array.isArray(series.annualTotalLiabilitiesNetMinorityInterest) ? series.annualTotalLiabilitiesNetMinorityInterest : [], gbpToPence),
    annualRetainedEarningsHistory: scaleTimeseries(Array.isArray(series.annualRetainedEarnings) ? series.annualRetainedEarnings : [], gbpToPence),
    annualTotalDebtHistory: scaleTimeseries(Array.isArray(series.annualTotalDebt) ? series.annualTotalDebt : [], gbpToPence),
    // Share COUNT, not a monetary aggregate -- never pence-scaled (same
    // reasoning as www/data.js's identical field).
    annualSharesHistory: Array.isArray(series.annualOrdinarySharesNumber) ? series.annualOrdinarySharesNumber : [],
    annualCapexHistory: scaleTimeseries(Array.isArray(series.annualCapitalExpenditure) ? series.annualCapitalExpenditure : [], gbpToPence),
    // Not in the plan's original field list -- Piotroski's gross-margin
    // criterion needs it (see www/data.js's identical addition).
    annualGrossProfitHistory: scaleTimeseries(Array.isArray(series.annualGrossProfit) ? series.annualGrossProfit : [], gbpToPence),
    // Three-stage DCF (www/calc/threeStageDcf.js): cycle-average operating margin and own sales-to-capital.
    annualOperatingIncomeHistory: scaleTimeseries(Array.isArray(series.annualOperatingIncome) ? series.annualOperatingIncome : [], gbpToPence),
    annualDepreciationHistory: scaleTimeseries(Array.isArray(series.annualDepreciationAndAmortization) ? series.annualDepreciationAndAmortization : [], gbpToPence),
    // Heavy capex spending (www/calc/heavyCapex.js): trailing-12-month capex / operating cash flow / depreciation.
    ttm: ttmFromTimeseries(series, gbpToPence),
  };
}

// Heavy capex spending: the shared six tests (www/calc/heavyCapex.js) from this generator's data + history. Only
// called from the plain-DCF branch (banks, utilities, REITs and airlines have returned earlier), so the model is 'dcf'.
function heavyCapexForTickerPage(data, hist, fcfInfo) {
  const t = (hist && hist.ttm) || {};
  const hcData = {
    ...data, ...t, ebit: hist.ebit,
    annualFcfHistory: hist.annualFcfHistory, annualRevenueHistory: hist.annualRevenueHistory, annualCapexHistory: hist.annualCapexHistory,
    annualNetIncomeHistory: hist.annualNetIncomeHistory, annualTotalAssetsHistory: hist.annualTotalAssetsHistory,
    annualCurrentAssetsHistory: hist.annualCurrentAssetsHistory, annualCurrentLiabilitiesHistory: hist.annualCurrentLiabilitiesHistory,
    annualTotalLiabilitiesHistory: hist.annualTotalLiabilitiesHistory, annualRetainedEarningsHistory: hist.annualRetainedEarningsHistory,
    annualTotalDebtHistory: hist.annualTotalDebtHistory, annualSharesHistory: hist.annualSharesHistory,
    annualGrossProfitHistory: hist.annualGrossProfitHistory,
  };
  return heavyCapexForAssumptions(hcData, { valuationModel: 'dcf', isCyclical: isCyclical(data.sector, data.industry), fcfInfo });
}

// The static card for the page -- the same wording as /evaluate/, /dcf/ and the apps.
function heavyCapexPageCardHtml(hc, price, sym) {
  const t = heavyCapexCardText(hc, {
    price,
    money: (v) => money(v, sym),
    moneyBig: (v) => moneyB(v, sym),
    pct: (v) => (v == null || !isFinite(v) ? 'N/A' : (v * 100).toFixed(1) + '%'),
  });
  return '<section class="heavy-capex-card">'
    + '<h3>' + escapeHtml(t.title) + '</h3>'
    + '<p class="hc-headline">' + escapeHtml(t.headline[0]) + '<strong>' + escapeHtml(t.headline[1]) + '</strong>' + escapeHtml(t.headline[2]) + '</p>'
    + '<p>' + escapeHtml(t.facts) + '</p><p>' + escapeHtml(t.existing) + '</p>'
    + '<p class="hc-method">' + escapeHtml(t.method) + ' <a href="/glossary/heavy-capex-spending/">How this works</a></p>'
    + '</section>';
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

// 730 days of raw daily /history points ({ date, close, adjClose? }), ascending.
// Kept separate from the monthly bucketing below so a caller can reuse the daily
// series (the AI Sector Correlation reads the stock's trailing year from it
// instead of fetching the same history a second time).
async function fetchDailyHistory(symbol, proxyUrl) {
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 730 * 24 * 60 * 60;
  const url = `${proxyUrl.replace(/\/$/, '')}/history/${encodeURIComponent(symbol)}?period1=${period1}&period2=${now}`;
  const points = await getJSON(url);
  return Array.isArray(points) ? points : [];
}

function bucketMonthly(points) {
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

async function fetchPriceHistory(symbol, proxyUrl) {
  return bucketMonthly(await fetchDailyHistory(symbol, proxyUrl));
}

// Given the base-case scenario result (or null) and the raw inputs that fed
// it, names which specific condition produced a null intrinsic value. There
// are 4 distinct real causes -- 2 from calculateDCF/calculateDDM returning a
// literal null (fcf/dividend <= 0; discount rate <= terminal growth), 2 more
// from calculateDCF returning a non-null OBJECT with intrinsicValue: null
// (negative equity; missing sharesOutstanding) -- previously collapsed into
// one generic message that didn't distinguish them. Returns null when
// baseResult already has a real intrinsicValue (nothing to explain).
function deriveNullReason({ isBank, isReitTicker, isAirlineTicker, isUtilityTicker, baseResult, baseFcf, affoPerShare, ebitda, bookValue, dividend, discountPct, terminalGrowth, fxConversionFailed }) {
  if (baseResult?.intrinsicValue != null) return null;
  if (fxConversionFailed) return 'financial statements are reported in a different currency than the trading price, and the live conversion rate could not be fetched';
  if (baseResult == null) {
    if (isReitTicker) {
      return (affoPerShare == null || affoPerShare <= 0)
        ? 'AFFO/share <= 0 or unavailable'
        : 'P/AFFO multiple <= 0';
    }
    if (isAirlineTicker) {
      return (ebitda == null || ebitda <= 0)
        ? 'EBITDA <= 0 or unavailable'
        : 'EV/EBITDA multiple <= 0';
    }
    if (isUtilityTicker) {
      return (bookValue == null || bookValue <= 0)
        ? 'book value per share <= 0 or unavailable (price/priceToBook)'
        : 'return on equity <= 0 or unavailable';
    }
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

function readManifestSafe(manifestPath) {
  if (!fs.existsSync(manifestPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    return [];
  }
}

function listMarketFolders(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  return fs.readdirSync(baseDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}

// Builds the cross-market, cross-tool candidate pool for the "Explore more
// DCF valuations" cards. DCF markets are read locally (this repo owns
// them); growth markets are read via growth-manifest-reader.js's
// CI-checkout/local-sibling resolution, since growth pages are generated in
// a different repo (StockAnalysis). See
// docs/superpowers/specs/2026-08-17-related-stocks-cards-design.md.
function buildRelatedStocksPool() {
  const pool = [];
  const dcfBase = path.join(__dirname, '..', '..', 'www', 'stocks');
  for (const folder of listMarketFolders(dcfBase)) {
    for (const e of readManifestSafe(path.join(dcfBase, folder, 'manifest.json'))) {
      pool.push({
        ticker: e.ticker, name: e.name, sector: e.sector, market: folder,
        method: e.method, marginOfSafety: e.marginOfSafety, marketCap: e.marketCap,
        url: `/dcf/stocks/${folder}/${e.slug}/`,
      });
    }
  }
  for (const folder of listGrowthMarketFolders()) {
    for (const e of readGrowthManifest(folder)) {
      pool.push({
        ticker: e.ticker, name: e.name, sector: e.sector, market: folder,
        method: 'Growth Model', marginOfSafety: e.marginOfSafety, marketCap: e.marketCap,
        url: `/growth/stocks/${folder}/${e.slug}/`,
      });
    }
  }
  return pool;
}

// ── Core page building ──────────────────────────────────────────────────
// Generates a single static ticker page. Accepts a ticker string and options
// (proxyUrl, optional indexHistoryCache Map). Returns:
// - { status: 'ok', html: string, entry: {...}, market: {...} }
// - { status: 'skipped', ticker: string, market: string|null, reason: string }
// threeStage: true/false forces the three-stage DCF (www/calc/threeStageDcf.js) on/off; omitted = THREE_STAGE_DCF_ENABLED.
async function buildTickerPage(ticker, { proxyUrl, indexHistoryCache, aiCorrelationCache, threeStage } = {}) {
  const threeStageOn = threeStage !== undefined ? threeStage === true : THREE_STAGE_DCF_ENABLED;
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
    if (t.endsWith('.AX')) { await sleep(FETCH_SPACING_MS); live.ausRf = await fetchAusRf(proxyUrl); }
    else if (t.endsWith('.NS') || t.endsWith('.BO')) { await sleep(FETCH_SPACING_MS); live.indRf = await fetchIndRf(proxyUrl); }
    else if (!t.includes('.')) { await sleep(FETCH_SPACING_MS); live.usRf = await fetchUsRf(proxyUrl); }
    const { rf, erp, terminalGrowth } = marketParamsFor(t, live);
    const isRfLive = !!(live.ausRf || live.indRf || live.usRf);

    const rawBeta = (data.beta != null && isFinite(data.beta) && data.beta > 0) ? data.beta : 1.0;
    const effectiveBeta = Math.max(rawBeta, getMarketBetaFloor(t));

    // Moved earlier (was after the scenario computation below) so the DCF
    // branch can use its diluted-shares/EBIT/interest-expense fields.
    await sleep(FETCH_SPACING_MS);
    const hist = await fetchHistorySeries(t, proxyUrl, data.currency);

    // Currency guard: see www/data.js's fetchDCFData() for the full
    // rationale (SONY confirmed live 2026-08-12: base-case intrinsic value
    // came back $83,000.91 vs a $23.61 price — financials in JPY, price in
    // USD). This generator doesn't call fetchDCFData() -- it reimplements
    // its own fetch/merge around the shared mapQuoteSummary() -- so the
    // same guard needs its own copy here. Mutates data/hist in place since
    // every downstream reference in this function reads from them by
    // property access.
    let fxConversionFailed = false;
    // GBp/GBP is the same currency at two quote sub-units, already reconciled
    // by fetchHistorySeries()'s/mapQuoteSummary()'s gbpPenceScale() above --
    // not a real cross-currency ADR mismatch. See www/data.js's fetchDCFData()
    // for the identical guard and full rationale.
    const isGbpPence = isGbpPenceCurrencyPair(data.currency, data.financialCurrency);
    if (!isGbpPence && data.currency && data.financialCurrency && data.currency !== data.financialCurrency) {
      await sleep(FETCH_SPACING_MS);
      const rate = await fetchFxRate(data.financialCurrency, data.currency, proxyUrl.replace(/\/$/, ''), batchHeaders());
      if (rate != null) {
        const c = v => (v != null ? v * rate : v);
        data.freeCashflow = c(data.freeCashflow);
        data.operatingCashflow = c(data.operatingCashflow);
        data.capitalExpenditures = c(data.capitalExpenditures);
        data.totalCash = c(data.totalCash);
        data.totalDebt = c(data.totalDebt);
        data.totalRevenue = c(data.totalRevenue);
        hist.ebit = c(hist.ebit);
        hist.interestExpense = c(hist.interestExpense);
        hist.fcfAnnualLatest = c(hist.fcfAnnualLatest);
        hist.annualFcfHistory = hist.annualFcfHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualRevenueHistory = hist.annualRevenueHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualNetIncomeHistory = hist.annualNetIncomeHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualStockholdersEquityHistory = hist.annualStockholdersEquityHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualDividendsPaidHistory = hist.annualDividendsPaidHistory.map(e => ({ date: e.date, value: c(e.value) }));
        // REIT FFO/AFFO inputs (see calc/reit.js) -- missed in the original
        // REIT wiring pass, same currency-mixing bug class as the SONY
        // incident above (net income/D&A left unconverted while capex above
        // was already converted, silently mixing two currencies/scales into
        // one FFO/AFFO figure). Caught in peer review, 2026-08-19.
        data.netIncome = c(data.netIncome);
        data.depreciationAndAmortization = c(data.depreciationAndAmortization);
        data.ebitda = c(data.ebitda);
        // Solvency Check (Altman Z-Score + Piotroski F-Score) monetary
        // inputs -- same currency-mixing bug class as the REIT FFO/AFFO
        // incident above, caught in peer review 2026-09-14. Originally left
        // unconverted on the theory that these are "internally consistent
        // within one currency already" -- true for Altman Z's X1/X2, false
        // for X3/X4/X5, which each pair an ALREADY-CONVERTED field (ebit,
        // revenue) against one of these. hist.annualSharesHistory is the
        // one deliberate exception: a share COUNT is dimensionless and must
        // never be FX-converted.
        hist.annualTotalAssetsHistory = hist.annualTotalAssetsHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualCurrentAssetsHistory = hist.annualCurrentAssetsHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualCurrentLiabilitiesHistory = hist.annualCurrentLiabilitiesHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualTotalLiabilitiesHistory = hist.annualTotalLiabilitiesHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualRetainedEarningsHistory = hist.annualRetainedEarningsHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualTotalDebtHistory = hist.annualTotalDebtHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualCapexHistory = hist.annualCapexHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualGrossProfitHistory = hist.annualGrossProfitHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualOperatingIncomeHistory = hist.annualOperatingIncomeHistory.map(e => ({ date: e.date, value: c(e.value) }));
        hist.annualDepreciationHistory = hist.annualDepreciationHistory.map(e => ({ date: e.date, value: c(e.value) }));
        if (hist.ttm) hist.ttm = { ...hist.ttm, ttmCapex: c(hist.ttm.ttmCapex), ttmOcf: c(hist.ttm.ttmOcf), ttmDepreciation: c(hist.ttm.ttmDepreciation), lastQuarterCapex: c(hist.ttm.lastQuarterCapex) };
      } else {
        fxConversionFailed = true;
        data.freeCashflow = null;
        data.operatingCashflow = null;
        data.capitalExpenditures = null;
        data.totalCash = null;
        data.totalDebt = null;
        data.totalRevenue = null;
        hist.ebit = null;
        hist.interestExpense = null;
        hist.fcfAnnualLatest = null;
        hist.annualFcfHistory = [];
        hist.annualRevenueHistory = [];
        hist.annualNetIncomeHistory = [];
        hist.annualStockholdersEquityHistory = [];
        hist.annualDividendsPaidHistory = [];
        data.netIncome = null;
        data.depreciationAndAmortization = null;
        data.ebitda = null;
        hist.annualTotalAssetsHistory = [];
        hist.annualCurrentAssetsHistory = [];
        hist.annualCurrentLiabilitiesHistory = [];
        hist.annualTotalLiabilitiesHistory = [];
        hist.annualRetainedEarningsHistory = [];
        hist.annualTotalDebtHistory = [];
        hist.annualCapexHistory = [];
        hist.annualGrossProfitHistory = [];
        hist.annualOperatingIncomeHistory = [];
        hist.annualDepreciationHistory = [];
        if (hist.ttm) hist.ttm = { ...hist.ttm, ttmCapex: null, ttmOcf: null, ttmDepreciation: null, lastQuarterCapex: null };
      }
    }

    // US lenders go to the bank models with the three-stage switch on (threeStageLender; /timeseries interest first,
    // the same precedence the WACC uses).
    const isBank = isBankOrInsurance(data.sector, data.industry, data.ticker)
      || (threeStageOn && threeStageLender({ ...data, interestExpense: hist.interestExpense != null ? hist.interestExpense : data.interestExpense }));
    const isReitTicker = !isBank && isReit(data.sector, data.industry);
    const isAirlineTicker = !isBank && !isReitTicker && isAirline(data.sector, data.industry);
    const isUtilityTicker = !isBank && !isReitTicker && !isAirlineTicker && isUtility(data.sector, data.industry);
    let method, scenarios, waccBreakdown = null, d0 = null, waccOrRePct = null;
    let fcfInfo = null, baseFcf = null, fcfNormalised = false, revenueNormalised = false, revenueTargetMarginPct = null;
    let heavyCapex = null, heavyCapexValued = null; // heavy capex spending (www/calc/heavyCapex.js)
    let threeStageInfo = null; // three-stage DCF (method 4): { inputs, seeds } when it ran
    let affoPerShare = null, reitMultiples = null, reitIndustryKey = null;
    let airlineMultiples = null;
    let utilityBookValue = null, utilityRoePct = null;

    if (isAirlineTicker) {
      const resolvedSharesForAirline = (hist.dilutedSharesOutstanding != null && hist.dilutedSharesOutstanding > 0)
        ? hist.dilutedSharesOutstanding : data.sharesOutstanding;
      airlineMultiples = {
        bear: +(AIRLINE_EV_EBITDA_MULTIPLE * 0.8).toFixed(1),
        base: AIRLINE_EV_EBITDA_MULTIPLE,
        bull: +(AIRLINE_EV_EBITDA_MULTIPLE * 1.2).toFixed(1),
      };
      method = 'Airline';
      scenarios = ['bear', 'base', 'bull'].map(key => {
        const result = calculateAirlineValue({
          ebitda: data.ebitda, multiple: airlineMultiples[key],
          totalDebt: data.totalDebt, totalCash: data.totalCash,
          sharesOutstanding: resolvedSharesForAirline, currentPrice: data.price,
        });
        return { key, multiplePct: airlineMultiples[key], result };
      });
      waccBreakdown = null; // no discount rate for this model at all
    } else if (isReitTicker) {
      const ffoInfo = deriveFfo({ netIncome: data.netIncome, depreciationAndAmortization: data.depreciationAndAmortization });
      const affoInfo = deriveAffo({ ffo: ffoInfo.value, capex: data.capitalExpenditures });
      const resolvedSharesForReit = (hist.dilutedSharesOutstanding != null && hist.dilutedSharesOutstanding > 0)
        ? hist.dilutedSharesOutstanding : data.sharesOutstanding;
      affoPerShare = (affoInfo.value != null && resolvedSharesForReit > 0) ? affoInfo.value / resolvedSharesForReit : null;
      reitIndustryKey = (data.industry && REIT_SECTOR_MULTIPLES[data.industry] != null) ? data.industry : 'DEFAULT';
      const reitBaseMultiple = REIT_SECTOR_MULTIPLES[reitIndustryKey];
      reitMultiples = { bear: +(reitBaseMultiple * 0.8).toFixed(1), base: reitBaseMultiple, bull: +(reitBaseMultiple * 1.2).toFixed(1) };
      method = 'REIT';
      scenarios = ['bear', 'base', 'bull'].map(key => {
        const result = calculateReitValue({ affoPerShare, multiple: reitMultiples[key], currentPrice: data.price });
        return { key, multiplePct: reitMultiples[key], result };
      });
      waccBreakdown = null; // no discount rate for this model at all
    } else if (isUtilityTicker) {
      // Regulated utilities always use Excess Return (rate-base-and-allowed-
      // return economics -- see www/dcf/calc/assumptions.js's isUtility()
      // dispatch), unlike banks where chooseFinancialModel() decides between
      // DDM and Excess Return based on payout ratio. Reused code shape from
      // the isBank branch's excess-return sub-case below, minus the
      // dividend/chooseFinancialModel machinery this model never needs.
      const rePct = r2((rf + effectiveBeta * erp) * 100);
      waccOrRePct = rePct;
      const roe = (data.returnOnEquity != null && isFinite(data.returnOnEquity) && data.returnOnEquity > 0)
        ? data.returnOnEquity
        : (data.trailingEps != null && data.priceToBook != null && data.price != null && data.priceToBook > 0
            ? data.trailingEps / (data.price / data.priceToBook)
            : null);
      utilityRoePct = roe != null ? r1(roe * 100) : null;
      const s = deriveScenarios({ method: 'ExcessReturn', baseGrowthPct: utilityRoePct ?? 0, waccOrRePct: rePct });
      method = 'ExcessReturn';
      utilityBookValue = (data.price != null && data.priceToBook != null && data.priceToBook > 0) ? data.price / data.priceToBook : null;
      scenarios = ['bear', 'base', 'bull'].map(key => {
        if (!(utilityBookValue > 0) || roe == null) return { key, growthPct: s.growth[key], discountPct: s.discount[key], result: null };
        const result = calculateExcessReturn({
          bookValue: utilityBookValue, roe: s.growth[key] / 100, costOfEquity: s.discount[key] / 100,
          growthRate: 0, // no separate book-value growth lever in the batch/ticker-page context -- matches the live tool's own bookValueGrowthPct default of 0 when unset
          projectionYears: 5, currentPrice: data.price,
        });
        return { key, growthPct: s.growth[key], discountPct: s.discount[key], result };
      });
      waccBreakdown = { re: rf + effectiveBeta * erp, rf, beta: effectiveBeta, erp, isBank: false, isUtility: true };
    } else if (isBank) {
      const dividend = data.trailingAnnualDividendRate ?? data.dividendRate ?? ((data.price != null && data.dividendYield != null) ? data.price * data.dividendYield : null);
      d0 = dividend != null ? +(+dividend).toFixed(2) : null;
      const rePct = r2((rf + effectiveBeta * erp) * 100);
      waccOrRePct = rePct;
      const growth = deriveDividendGrowth(data.earningsGrowth, data.revenueGrowth);

      const roe = (data.returnOnEquity != null && isFinite(data.returnOnEquity) && data.returnOnEquity > 0)
        ? data.returnOnEquity
        : (data.trailingEps != null && data.priceToBook != null && data.price != null && data.priceToBook > 0
            ? data.trailingEps / (data.price / data.priceToBook)
            : null);
      const financialModel = chooseFinancialModel({ roe, dividend, trailingEps: data.trailingEps, growth });

      if (financialModel === 'excess-return') {
        const roePct = r1(roe * 100);
        const s = deriveScenarios({ method: 'ExcessReturn', baseGrowthPct: roePct, waccOrRePct: rePct });
        method = 'ExcessReturn';
        const bookValue = data.price / data.priceToBook;
        scenarios = ['bear', 'base', 'bull'].map(key => {
          const result = calculateExcessReturn({
            bookValue, roe: s.growth[key] / 100, costOfEquity: s.discount[key] / 100, growthRate: growth,
            projectionYears: 5, currentPrice: data.price,
          });
          return { key, growthPct: s.growth[key], discountPct: s.discount[key], result };
        });
        waccBreakdown = { re: rf + effectiveBeta * erp, rf, beta: effectiveBeta, erp, isBank: true };
      } else {
        const baseGrowthPct = r1(growth * 100);
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
      }
    } else {
      fcfInfo = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures, hist.fcfAnnualLatest);
      // Cyclical/commodity companies get a normalized base-year FCF (average
      // FCF margin across whatever real multi-year /timeseries history is
      // available, applied to the lower of trailing and average revenue) instead of the trailing
      // figure above, same as www/dcf/calc/assumptions.js's isCyclical
      // dispatch -- falls back to the standard fcfInfo untouched when
      // there's too little history.
      const isCyclicalTicker = isCyclical(data.sector, data.industry);
      if (isCyclicalTicker) {
        const cyclicalFcf = cyclicalBaseFcf({
          fcfHistory: hist.annualFcfHistory,
          revenueHistory: hist.annualRevenueHistory,
          trailingRevenue: data.totalRevenue,
          sectorLookup: sectorMarginLookup,
          industry: data.industry,
          operatingMargin: data.operatingMargins,
        });
        if (cyclicalFcf) fcfInfo = cyclicalFcf;
      }
      baseFcf = fcfInfo.value;
      if (baseFcf != null) {
        if (isFinancialSector(data.sector) && baseFcf > 0) { baseFcf = baseFcf * 0.6; fcfNormalised = true; }
        baseFcf = Math.round(baseFcf);
      }
      // Revenue-normalised FCF fallback — mirrors www/dcf/app.js's normFcf logic
      // (shown whenever reported FCF is missing or negative and totalRevenue is
      // known) so a real, established company with a Yahoo data gap on FCF
      // doesn't just produce an N/A page. Seed matches the live tool exactly:
      // profitMargins if positive, else a flat 10% default.
      if (shouldApplyRevenueFallback({ baseFcf, fcfMethod: fcfInfo.method, totalRevenue: data.totalRevenue })) {
        revenueTargetMarginPct = (data.profitMargins != null && data.profitMargins > 0)
          ? +(data.profitMargins * 100).toFixed(1) : 10;
        baseFcf = Math.round(data.totalRevenue * (revenueTargetMarginPct / 100));
        revenueNormalised = true;
      }
      // Heavy capex spending: the existing business (operating cash flow minus maintenance capex) is the DCF's
      // starting cash flow; the growth capex is added per scenario after the holdco discount below.
      const hcCheck = heavyCapexForTickerPage(data, hist, fcfInfo);
      if (hcCheck.applies) {
        heavyCapex = hcCheck;
        baseFcf = Math.round(heavyCapexExistingFcf(hcCheck));
        revenueNormalised = false;
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
      // US + positive trailing FCF (threeStageEligible): fcfInfo after cyclical normalisation, before the revenue fallback.
      if (threeStageOn && threeStageEligible(data, fcfInfo.value) && !heavyCapex) {
      // Three-stage DCF (method 4): the shared engine and seeds, on the whole data object (lesson: a hand-built
      // input object silently drops fields a shared function reads -- the cyclical-growth bug, PSX 2026-10).
      const tsData = {
        ...data, dilutedSharesOutstanding: resolvedShares,
        annualRevenueHistory: hist.annualRevenueHistory, annualOperatingIncomeHistory: hist.annualOperatingIncomeHistory,
        annualDepreciationHistory: hist.annualDepreciationHistory, annualCapexHistory: hist.annualCapexHistory,
        annualFcfHistory: hist.annualFcfHistory, annualNetIncomeHistory: hist.annualNetIncomeHistory,
        annualStockholdersEquityHistory: hist.annualStockholdersEquityHistory, annualDividendsPaidHistory: hist.annualDividendsPaidHistory,
      };
      const inputs = threeStageInputs(tsData, { waccResult, terminalGrowth });
      if (inputs.note) return { status: 'skipped', ticker: t, market: market.folder, reason: inputs.note };
      const seeds = threeStageScenarioSeeds(inputs);
      threeStageInfo = { inputs, seeds };
      method = 'DCF';
      waccOrRePct = +(seeds.base.wacc * 100).toFixed(2);
      scenarios = ['bear', 'base', 'bull'].map(key => {
        const sc = threeStageScenario(key, inputs, seeds[key], { totalDebt: data.totalDebt, totalCash: data.totalCash, shares: resolvedShares, price: data.price });
        return { key, growthPct: seeds[key].startGrowth * 100, discountPct: seeds[key].wacc * 100, result: sc.result };
      });
      waccBreakdown = { ...waccResult, isBank: false };
      } else {
      const waccPct = r2(waccResult.wacc * 100);
      waccOrRePct = waccPct;
      const baseGrowthPct = deriveBaseGrowthPct(data, hist);
      const s = deriveScenarios({ method: 'DCF', baseGrowthPct, waccOrRePct: waccPct });
      method = 'DCF';
      // Fade growth toward the terminal rate instead of holding one flat
      // rate for the whole horizon whenever the base case itself is
      // negative — same auto-enable rule as the live tool's prefillInputs()
      // (see www/calc/assumptions.js's useMultiStage and CLAUDE.md's
      // 2026-08-11 Known Traps entry, Damodaran's transition-phase
      // convention). This was missing here entirely until now: a flat
      // negative rate held for 5 years understates intrinsic value for a
      // shrinking company, so every negative-base-growth DCF ticker page
      // generated before this fix has a Base case that's too pessimistic
      // versus the live tool.
      const useMultiStage = baseGrowthPct < 0;
      scenarios = ['bear', 'base', 'bull'].map(key => {
        const common = {
          terminalGrowth, wacc: s.discount[key] / 100, projectionYears: 5,
          totalDebt: data.totalDebt, totalCash: data.totalCash,
          sharesOutstanding: resolvedShares, currentPrice: data.price,
          // Matches the live tool's current default (2026-08-08: mid-year
          // discounting shipped as an opt-in toggle, default off) — do not
          // hardcode true here again without also flipping the live tool's
          // default, or this drifts out of sync silently like it just did.
        };
        const result = useMultiStage
          ? calculateFadingGrowthDCF({ ...common, fcf: baseFcf, initialGrowth: s.growth[key] / 100 })
          : calculateDCF({ ...common, fcf: baseFcf, growthRate: s.growth[key] / 100 });
        return { key, growthPct: s.growth[key], discountPct: s.discount[key], result };
      });
      waccBreakdown = { ...waccResult, isBank: false };
      }
    }

    // Holdco/conglomerate discount is independent of the model dispatch
    // above (isReitTicker/isAirlineTicker/isUtilityTicker/isBank all decide
    // WHICH model runs; a conglomerate can be any of them, almost always
    // plain DCF) -- applied uniformly to whatever scenarios came out of
    // whichever branch ran, same pattern the live tool's
    // computeScenarios()/applyHoldcoDiscountToScenarios() uses. NOT a real
    // segment-level sum-of-the-parts valuation -- Yahoo exposes no
    // per-segment financials -- see calc/holdcoDiscount.js.
    const isHoldcoTicker = isConglomerate(data.sector, data.industry, data.ticker);
    if (isHoldcoTicker) {
      scenarios = applyHoldcoDiscountToScenarios(scenarios, HOLDCO_DISCOUNT, data.price);
    }
    // Heavy capex spending: add the growth capex at its return to every scenario (after the holdco discount, which
    // applies to the existing business only -- same order as /evaluate/'s computeScenarios + heavyCapexValuation).
    if (heavyCapex) {
      const hcShares = (hist.dilutedSharesOutstanding != null && hist.dilutedSharesOutstanding > 0) ? hist.dilutedSharesOutstanding : data.sharesOutstanding;
      heavyCapexValued = heavyCapexValuation({ ...data, dilutedSharesOutstanding: hcShares }, heavyCapex,
        scenarios.map(sc => ({ ...sc, wacc: sc.discountPct / 100 })));
      scenarios = heavyCapexValued.scenarios;
    }

    await sleep(FETCH_SPACING_MS);
    const dailyHistory = await fetchDailyHistory(t, proxyUrl);
    const priceSeriesRaw = bucketMonthly(dailyHistory);
    let indexSeriesRaw;
    if (market.indexTicker) {
      if (indexHistoryCache && indexHistoryCache.has(market.indexTicker)) {
        indexSeriesRaw = indexHistoryCache.get(market.indexTicker);
      } else {
        await sleep(FETCH_SPACING_MS);
        indexSeriesRaw = await fetchPriceHistory(market.indexTicker, proxyUrl);
        if (indexHistoryCache) indexHistoryCache.set(market.indexTicker, indexSeriesRaw);
      }
    } else {
      indexSeriesRaw = [];
    }
    const [priceAligned, indexAligned] = alignByBucket(priceSeriesRaw, indexSeriesRaw);

    // AI Sector Correlation -- see
    // docs/superpowers/specs/2026-09-23-ai-sector-correlation-design.md.
    // AIQ/RSP/SMH are identical for every ticker in a batch run, so the helper
    // fetches them once into aiCorrelationCache (shared across the whole run,
    // every market -- unlike indexHistoryCache, which is per-market). The
    // stock's own daily history was just fetched above for the price chart, so
    // it is handed over (`stockHistory`) rather than fetched a second time; the
    // helper trims it to the trailing year. It never throws (a failure just
    // omits the card) and sleeps FETCH_SPACING_MS before each Worker call it makes.
    const { ai: aiCorrelation, hardware: aiHardwareCorrelation } =
      await getAiCorrelations(t, { proxyUrl, cache: aiCorrelationCache, throttleMs: FETCH_SPACING_MS, stockHistory: dailyHistory });
    const aiCorrelationHtml = buildAiCorrelationCard({ aiCorrelation, aiHardwareCorrelation });
    const aiCorrelationFaqHtml = buildAiCorrelationFaqHtml({ aiCorrelation, aiHardwareCorrelation });

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
    const nullReason = deriveNullReason({ isBank, isReitTicker, isAirlineTicker, isUtilityTicker, baseResult, baseFcf, affoPerShare, ebitda: data.ebitda, bookValue: utilityBookValue, dividend: d0, discountPct: waccOrRePct, terminalGrowth, fxConversionFailed });
    // Raw diagnostic snapshot -- only populated when the base case is null,
    // so the batch can print exactly which upstream field was the actual
    // cause (2026-08-05 incident: the same 10 tickers failed identically on
    // two separate live CI runs, but reproduced cleanly when the identical
    // code was run locally against the identical Worker -- this snapshot
    // exists to settle whether that's a CI-environment-specific data
    // difference, not to guess further).
    const nullDiagnostics = nullReason ? {
      isBank, isReitTicker, isAirlineTicker, isUtilityTicker, affoPerShare, ebitda: data.ebitda, bookValue: utilityBookValue, method, baseFcf, dividend: d0, discountPct: waccOrRePct, terminalGrowth,
      sharesOutstanding: data.sharesOutstanding, price: data.price,
      revenueGrowth: data.revenueGrowth, earningsGrowth: data.earningsGrowth,
      marketCap: data.marketCap, totalDebt: data.totalDebt, totalCash: data.totalCash,
      negativeEquity: baseResult?.negativeEquity ?? null,
      fxConversionFailed, financialCurrency: data.financialCurrency,
    } : null;

    // revenueNormalised checked first, same priority fcfMethodNote below
    // already uses -- fcfInfo.method can go stale (still 'normalized' or
    // 'derived' from before the fallback ran) when the revenue-normalisation
    // fallback overrides baseFcf after fcfInfo's own value came back <= 0
    // (e.g. a cyclical ticker whose multi-year average margin is itself
    // negative -- confirmed live on TM, 2026-08-24). Without this check the
    // badge would show a stale "Nyr avg margin"/"OCF−CapEx" tag next to a
    // value that's actually revenue-normalised.
    const fcfMethodBadge = (revenueNormalised || heavyCapex) ? ''
      : fcfInfo && fcfInfo.value != null
      ? (fcfInfo.method === 'proxy' ? ' <span class="stat-warn">⚠ est.</span>'
        : fcfInfo.method === 'derived' ? ' <span style="font-size:0.7rem;color:var(--kv-muted)">OCF−CapEx</span>'
        : fcfInfo.method === 'normalized' ? ` <span style="font-size:0.7rem;color:var(--kv-muted)">${fcfInfo.yearsUsed}yr avg margin</span>` : '')
      : '';
    const fcfMethodNote = heavyCapex
      ? 'Existing business: operating cash flow minus the capex needed to keep it running (heavy capex spending, see below)'
      : revenueNormalised
      ? revenueFallbackNote(revenueTargetMarginPct, fcfInfo?.value)
      : !fcfInfo ? ''
      : fcfInfo.method === 'reported' ? 'Reported free cash flow (Yahoo)'
      : fcfInfo.method === 'derived' ? 'Derived: operating cash flow − capital expenditure'
      // Cyclical/commodity company -- see calc/cyclicalNormalization.js.
      // Yahoo's /timeseries typically covers ~4 fiscal years, shorter than a
      // full commodity cycle (5-10yr) -- a real data-availability limitation
      // surfaced here, not hidden.
      : (fcfInfo.method === 'normalized' && fcfInfo.source === 'sector') ? `Cyclical company — this company's own multi-year FCF margin was negative, so this uses the ${fcfInfo.peerCount}-company industry average margin (${(fcfInfo.marginUsed * 100).toFixed(1)}% of revenue) instead${fcfInfo.revenueCapped ? `, applied to ${fcfInfo.yearsUsed}-year average revenue` : ''}`
      : fcfInfo.method === 'normalized' ? `Cyclical company — average FCF margin across the last ${fcfInfo.yearsUsed} years (${(fcfInfo.marginUsed * 100).toFixed(1)}% of revenue), not the latest year alone, to avoid over/under-valuing at a cycle extreme${fcfInfo.revenueCapped ? `, applied to ${fcfInfo.yearsUsed}-year average revenue` : ''}`
      : 'Rough estimate: operating cash flow × 0.8';

    // Three-stage DCF (method 4): what the page shows instead of the classic FCF-based inputs.
    const ts3 = threeStageInfo ? { i: threeStageInfo.inputs, s: threeStageInfo.seeds, b: threeStageInfo.seeds.base } : null;
    const ts3MarginNote = ts3 && (ts3.i.marginSource === 'history' ? `${ts3.i.marginYears}-year average` : 'Trailing 12 months (too little history to average)');
    const ts3BetaNote = ts3 && `${escapeHtml(ts3.i.betaInfo.industry)} industry beta ${ts3.i.betaInfo.unlevered.toFixed(2)} (Damodaran), re-levered on debt ÷ equity`;
    const stats = isReitTicker
      ? [
          ['Price', money(data.price, currencySym)],
          ['Market Cap', moneyB(data.marketCap, currencySym)],
          ['AFFO / Share', affoPerShare != null ? money(affoPerShare, currencySym) : 'N/A'],
          ['Beta', effectiveBeta.toFixed(2)],
          ['P/E (TTM)', data.trailingPE != null ? data.trailingPE.toFixed(1) + 'x' : 'N/A'],
          ['52-Week Range', `${money(data.fiftyTwoWeekLow, currencySym)}–${money(data.fiftyTwoWeekHigh, currencySym)}`],
        ]
      : isAirlineTicker
      ? [
          ['Price', money(data.price, currencySym)],
          ['Market Cap', moneyB(data.marketCap, currencySym)],
          ['EBITDA', data.ebitda != null ? moneyB(data.ebitda, currencySym) : 'N/A'],
          ['Beta', effectiveBeta.toFixed(2)],
          ['P/E (TTM)', data.trailingPE != null ? data.trailingPE.toFixed(1) + 'x' : 'N/A'],
          ['52-Week Range', `${money(data.fiftyTwoWeekLow, currencySym)}–${money(data.fiftyTwoWeekHigh, currencySym)}`],
        ]
      : isBank
      ? [
          ['Price', money(data.price, currencySym)],
          ['Market Cap', moneyB(data.marketCap, currencySym)],
          ['Dividend Yield', pct(data.dividendYield)],
          ['Beta', effectiveBeta.toFixed(2)],
          ['P/E (TTM)', data.trailingPE != null ? data.trailingPE.toFixed(1) + 'x' : 'N/A'],
          ['52-Week Range', `${money(data.fiftyTwoWeekLow, currencySym)}–${money(data.fiftyTwoWeekHigh, currencySym)}`],
        ]
      : isUtilityTicker
      ? [
          ['Price', money(data.price, currencySym)],
          ['Market Cap', moneyB(data.marketCap, currencySym)],
          ['Book Value / Share', utilityBookValue != null ? money(utilityBookValue, currencySym) : 'N/A'],
          ['Beta', effectiveBeta.toFixed(2)],
          ['P/E (TTM)', data.trailingPE != null ? data.trailingPE.toFixed(1) + 'x' : 'N/A'],
          ['52-Week Range', `${money(data.fiftyTwoWeekLow, currencySym)}–${money(data.fiftyTwoWeekHigh, currencySym)}`],
        ]
      : [
          ['Price', money(data.price, currencySym)],
          ['Market Cap', moneyB(data.marketCap, currencySym)],
          // baseFcf, not fcfInfo?.value -- when the revenue-normalisation
          // fallback overrides baseFcf (fcfInfo's own value came back <= 0),
          // fcfInfo.value stays stale at the original, unused figure; baseFcf
          // is always the actual number the DCF calc below runs on. Same
          // staleness class as fcfMethodBadge above, pre-existing (not
          // specific to Cyclical) but only surfaced live via TM's cyclical
          // normalization producing a negative multi-year average margin.
          ts3 ? ['Operating margin', pct(ts3.b.margin) + ` <span style="font-size:0.7rem;color:var(--kv-muted)">${ts3.i.marginSource === 'history' ? ts3.i.marginYears + 'yr avg' : 'TTM'}</span>`]
            : ['Free Cash Flow', moneyB(baseFcf, currencySym) + fcfMethodBadge],
          ['Beta', ts3 ? ts3.i.beta.toFixed(2) : effectiveBeta.toFixed(2)],
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

    const assumptionRows = isReitTicker
      ? `<tr><td>P/AFFO Multiple</td><td class="col-bear">${scenarios[0].multiplePct.toFixed(1)}x</td><td class="col-base">${scenarios[1].multiplePct.toFixed(1)}x</td><td class="col-bull">${scenarios[2].multiplePct.toFixed(1)}x</td></tr>`
      : isAirlineTicker
      ? `<tr><td>EV/EBITDA Multiple</td><td class="col-bear">${scenarios[0].multiplePct.toFixed(1)}x</td><td class="col-base">${scenarios[1].multiplePct.toFixed(1)}x</td><td class="col-bull">${scenarios[2].multiplePct.toFixed(1)}x</td></tr>`
      : method === 'ExcessReturn'
      // Excess Return has no terminal value (see calc/excessReturn.js) and its
      // "growth" slot holds ROE, not dividend growth -- was previously
      // conflated with DDM's row shape below (a pre-existing mislabeling bug,
      // fixed while wiring in the Utility model, which also uses this method
      // and would otherwise have inherited it).
      ? `<tr><td>ROE</td><td class="col-bear">${scenarios[0].growthPct.toFixed(1)}%</td><td class="col-base">${scenarios[1].growthPct.toFixed(1)}%</td><td class="col-bull">${scenarios[2].growthPct.toFixed(1)}%</td></tr>
         <tr><td>Cost of equity</td><td class="col-bear">${scenarios[0].discountPct.toFixed(2)}%</td><td class="col-base">${scenarios[1].discountPct.toFixed(2)}%</td><td class="col-bull">${scenarios[2].discountPct.toFixed(2)}%</td></tr>`
      : isBank
      ? `<tr><td>Dividend growth</td><td class="col-bear">${scenarios[0].growthPct.toFixed(1)}%</td><td class="col-base">${scenarios[1].growthPct.toFixed(1)}%</td><td class="col-bull">${scenarios[2].growthPct.toFixed(1)}%</td></tr>
         <tr><td><a href="/glossary/terminal-growth-rate/">Terminal growth</a></td><td class="col-bear">${(terminalGrowth * 100).toFixed(1)}%</td><td class="col-base">${(terminalGrowth * 100).toFixed(1)}%</td><td class="col-bull">${(terminalGrowth * 100).toFixed(1)}%</td></tr>
         <tr><td>Cost of equity</td><td class="col-bear">${scenarios[0].discountPct.toFixed(2)}%</td><td class="col-base">${scenarios[1].discountPct.toFixed(2)}%</td><td class="col-bull">${scenarios[2].discountPct.toFixed(2)}%</td></tr>`
      : ts3
      ? `<tr><td>Starting growth (yrs 1–5)</td><td class="col-bear">${scenarios[0].growthPct.toFixed(1)}%</td><td class="col-base">${scenarios[1].growthPct.toFixed(1)}%</td><td class="col-bull">${scenarios[2].growthPct.toFixed(1)}%</td></tr>
         <tr><td>Long-run growth (<a href="/glossary/terminal-growth-rate/">terminal</a>)</td><td class="col-bear">${(ts3.s.bear.terminalGrowth * 100).toFixed(1)}%</td><td class="col-base">${(ts3.s.base.terminalGrowth * 100).toFixed(1)}%</td><td class="col-bull">${(ts3.s.bull.terminalGrowth * 100).toFixed(1)}%</td></tr>
         <tr><td><a href="/glossary/wacc/">WACC</a> (discount rate)</td><td class="col-bear">${scenarios[0].discountPct.toFixed(2)}%</td><td class="col-base">${scenarios[1].discountPct.toFixed(2)}%</td><td class="col-bull">${scenarios[2].discountPct.toFixed(2)}%</td></tr>`
      : `<tr><td>5-yr FCF growth</td><td class="col-bear">${scenarios[0].growthPct.toFixed(1)}%</td><td class="col-base">${scenarios[1].growthPct.toFixed(1)}%</td><td class="col-bull">${scenarios[2].growthPct.toFixed(1)}%</td></tr>
         <tr><td><a href="/glossary/terminal-growth-rate/">Terminal growth</a></td><td class="col-bear">${(terminalGrowth * 100).toFixed(1)}%</td><td class="col-base">${(terminalGrowth * 100).toFixed(1)}%</td><td class="col-bull">${(terminalGrowth * 100).toFixed(1)}%</td></tr>
         <tr><td><a href="/glossary/wacc/">WACC</a> (discount rate)</td><td class="col-bear">${scenarios[0].discountPct.toFixed(2)}%</td><td class="col-base">${scenarios[1].discountPct.toFixed(2)}%</td><td class="col-bull">${scenarios[2].discountPct.toFixed(2)}%</td></tr>`;

    const assumptionTiles = isReitTicker
      ? `<div class="assump-item"><div class="al">Net income</div><div class="av">${data.netIncome != null ? moneyB(data.netIncome, currencySym) : 'N/A'}</div><div class="an">GAAP, from income statement</div></div>
         <div class="assump-item"><div class="al">+ Depreciation &amp; Amortization</div><div class="av">${data.depreciationAndAmortization != null ? moneyB(data.depreciationAndAmortization, currencySym) : 'N/A'}</div><div class="an">= FFO (gains on sale omitted — not broken out by Yahoo)</div></div>
         <div class="assump-item"><div class="al">− Capital Expenditure</div><div class="av">${data.capitalExpenditures != null ? moneyB(Math.abs(data.capitalExpenditures), currencySym) : 'N/A'}</div><div class="an">= AFFO (total reported capex, a conservative proxy for "recurring")</div></div>
         <div class="assump-item"><div class="al">AFFO / Share</div><div class="av">${affoPerShare != null ? money(affoPerShare, currencySym) : 'N/A'}</div><div class="an">AFFO ÷ diluted shares outstanding</div></div>
         <div class="assump-item"><div class="al">Sector P/AFFO multiple</div><div class="av">${reitMultiples.base}x</div><div class="an">${reitIndustryKey === 'DEFAULT' ? 'Default (no sector-specific seed)' : escapeHtml(reitIndustryKey)}</div></div>
         <div class="assump-item"><div class="al">Model</div><div class="av">FFO/AFFO</div><div class="an">Not a discounted model — no discount rate or terminal value</div></div>`
      : isAirlineTicker
      ? `<div class="assump-item"><div class="al">EBITDA</div><div class="av">${data.ebitda != null ? moneyB(data.ebitda, currencySym) : 'N/A'}</div><div class="an">Earnings before interest, tax, depreciation &amp; amortization</div></div>
         <div class="assump-item"><div class="al">Enterprise Value</div><div class="av">${scenarios[1].result?.ev != null ? moneyB(scenarios[1].result.ev, currencySym) : 'N/A'}</div><div class="an">= EBITDA × multiple</div></div>
         <div class="assump-item"><div class="al">Net Debt</div><div class="av">${scenarios[1].result?.netDebt != null ? moneyB(scenarios[1].result.netDebt, currencySym) : 'N/A'}</div><div class="an">Total debt − total cash</div></div>
         <div class="assump-item"><div class="al">EV/EBITDA multiple</div><div class="av">${airlineMultiples.base}x</div><div class="an">Mid-cycle placeholder — airlines have historically traded ~4x–8x+</div></div>
         <div class="assump-item"><div class="al">Model</div><div class="av">EV/EBITDA</div><div class="an">Not a discounted model — no discount rate or terminal value. Standard FCF-based DCF is unreliable for airlines (extreme cyclicality, high leverage).</div></div>`
      : method === 'ExcessReturn'
      // Same mislabeling fix as assumptionRows above -- ExcessReturn has no
      // dividend/D0 concept and no terminal value; shows book value + ROE
      // instead. Shared by bank/insurer/NBFC ExcessReturn tickers and
      // regulated utilities alike.
      ? `<div class="assump-item"><div class="al">Book value / share</div><div class="av">${utilityBookValue != null ? money(utilityBookValue, currencySym) : (data.priceToBook != null && data.priceToBook > 0 ? money(data.price / data.priceToBook, currencySym) : 'N/A')}</div><div class="an">Price ÷ price-to-book</div></div>
         <div class="assump-item"><div class="al">Return on equity</div><div class="av">${data.returnOnEquity != null ? pct(data.returnOnEquity) : 'N/A'}</div><div class="an">Trailing reported ROE${isUtilityTicker ? ' (proxy for regulator-allowed ROE — Yahoo has no field for the latter)' : ''}</div></div>
         <div class="assump-item"><div class="al">Cost of equity</div><div class="av">${pct(rf + effectiveBeta * erp, 2)}</div><div class="an">CAPM: risk-free rate + beta × ERP</div></div>
         <div class="assump-item"><div class="al">Beta</div><div class="av">${effectiveBeta.toFixed(2)}</div><div class="an">${getMarketBetaFloor(t) > 0 ? 'Floored for non-US stocks' : 'Direct from Yahoo'}</div></div>
         <div class="assump-item"><div class="al">Model</div><div class="av">Excess Return</div><div class="an">Not a discounted model in the terminal-value sense — no terminal growth rate; value = book value + PV of (ROE − cost of equity) × book value each year</div></div>`
      : isBank
      ? `<div class="assump-item"><div class="al">Risk-free rate</div><div class="av">${pct(rf, 2)} ${isRfLive ? '<span class="live-badge">● LIVE</span>' : ''}</div><div class="an">${isRfLive ? 'Live 10-yr govt bond' : 'Fixed market seed'}</div></div>
         <div class="assump-item"><div class="al">Beta</div><div class="av">${effectiveBeta.toFixed(2)}</div><div class="an">${getMarketBetaFloor(t) > 0 ? 'Floored for non-US stocks' : 'Direct from Yahoo'}</div></div>
         <div class="assump-item"><div class="al">Equity risk premium</div><div class="av">${pct(erp, 2)}</div><div class="an">Market-specific seed</div></div>
         <div class="assump-item"><div class="al">Debt component</div><div class="av">None</div><div class="an">DDM discounts dividends at cost of equity only</div></div>
         <div class="assump-item"><div class="al">Starting dividend (D0)</div><div class="av">${d0 != null ? money(d0, currencySym) : 'N/A'}</div><div class="an">Annual, per share</div></div>
         <div class="assump-item"><div class="al">Projection horizon</div><div class="av">5 years</div><div class="an">+ terminal value beyond</div></div>`
      : ts3
      ? `<div class="assump-item"><div class="al">Revenue</div><div class="av">${moneyB(ts3.i.revenue, currencySym)}</div><div class="an">Trailing 12 months — the starting point</div></div>
         <div class="assump-item"><div class="al">Operating margin</div><div class="av">${pct(ts3.b.margin)}</div><div class="an">${ts3MarginNote}, held for every year — a boom or bust year doesn't set the value</div></div>
         <div class="assump-item"><div class="al">Sales to capital</div><div class="av">${ts3.b.salesToCapital.toFixed(2)}</div><div class="an">${ts3.i.s2cSource === 'own' ? "The company's own: revenue added ÷ net capex over four years" : `Industry figure (${escapeHtml(ts3.i.betaInfo.industry)}, Damodaran)`} — growth is paid for by reinvesting new revenue ÷ this</div></div>
         <div class="assump-item"><div class="al">Risk-free rate</div><div class="av">${pct(rf, 2)} ${isRfLive ? '<span class="live-badge">● LIVE</span>' : ''}</div><div class="an">${isRfLive ? 'Live 10-yr govt bond' : 'Fixed market seed'}</div></div>
         <div class="assump-item"><div class="al">Beta</div><div class="av">${ts3.i.beta.toFixed(2)}</div><div class="an">${ts3BetaNote}</div></div>
         <div class="assump-item"><div class="al">Equity risk premium</div><div class="av">${pct(erp, 2)}</div><div class="an">Market-specific seed</div></div>
         <div class="assump-item"><div class="al">Cost of debt</div><div class="av">${pct(waccBreakdown.rd, 2)}</div><div class="an">${
           waccBreakdown.rdMethod === 'synthetic'
             ? `Synthetic rating ${waccBreakdown.syntheticRating}, ICR ${waccBreakdown.icr.toFixed(1)}x`
             : waccBreakdown.isRdEstimated ? 'Estimated (no debt/interest data)' : 'From income statement'
         }</div></div>
         <div class="assump-item"><div class="al">Tax rate</div><div class="av">${pct(waccBreakdown.tc, 2)}</div><div class="an">${waccBreakdown.isTcEstimated ? 'Estimated default' : 'From income statement'}</div></div>
         <div class="assump-item"><div class="al">Projection horizon</div><div class="av">10 years</div><div class="an">5 years at the starting growth, 5 fading to the long-run rate, + terminal value beyond</div></div>`
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

    const formulaLine = isReitTicker
      ? `Intrinsic Value = AFFO / Share × P/AFFO Multiple = ${affoPerShare != null ? money(affoPerShare, currencySym) : 'N/A'} × ${reitMultiples.base}x`
      : isAirlineTicker
      ? `Enterprise Value = EBITDA × Multiple = ${data.ebitda != null ? moneyB(data.ebitda, currencySym) : 'N/A'} × ${airlineMultiples.base}x — Equity Value = EV − Net Debt, ÷ shares outstanding`
      : (isBank || isUtilityTicker)
      ? `Cost of Equity (CAPM) = Risk-free rate + Beta × Equity Risk Premium = ${pct(rf, 2)} + ${effectiveBeta.toFixed(2)} × ${pct(erp, 2)} = ${pct(rf + effectiveBeta * erp, 2)}`
      : ts3
      ? `3-stage DCF: revenue grows at the starting rate for 5 years, then fades to the long-run rate; each year's free cash flow = revenue × operating margin × (1 − tax) − new revenue ÷ sales to capital. Cost of Equity = ${pct(rf, 2)} + ${ts3.i.beta.toFixed(2)} × ${pct(erp, 2)} = ${pct(rf + ts3.i.beta * erp, 2)} · <a href="/glossary/wacc/">WACC</a> = weighted by ${(waccBreakdown.eWeight * 100).toFixed(0)}%/${(waccBreakdown.dWeight * 100).toFixed(0)}% capital structure`
      : `Cost of Equity = Risk-free rate + Beta × Equity Risk Premium = ${pct(rf, 2)} + ${effectiveBeta.toFixed(2)} × ${pct(erp, 2)} = ${pct(waccBreakdown.re, 2)} · <a href="/glossary/wacc/">WACC</a> = weighted by ${(waccBreakdown.eWeight * 100).toFixed(0)}%/${(waccBreakdown.dWeight * 100).toFixed(0)}% capital structure`;

    const reitAffoPayoutRatio = (() => {
      if (!isReitTicker || affoPerShare == null || affoPerShare <= 0) return null;
      const dividendPerShare = data.trailingAnnualDividendRate ?? data.dividendRate ?? null;
      return dividendPerShare != null ? dividendPerShare / affoPerShare : null;
    })();
    const reitDebtToEbitda = (() => {
      if (!isReitTicker) return null;
      const ebitda = (hist.ebit != null && data.depreciationAndAmortization != null) ? hist.ebit + data.depreciationAndAmortization : null;
      return (data.totalDebt != null && ebitda != null && ebitda > 0) ? data.totalDebt / ebitda : null;
    })();
    const airlineImpliedMultiple = (() => {
      if (!isAirlineTicker || data.ebitda == null || data.ebitda <= 0) return null;
      const resolvedShares = (hist.dilutedSharesOutstanding != null && hist.dilutedSharesOutstanding > 0)
        ? hist.dilutedSharesOutstanding : data.sharesOutstanding;
      if (!(resolvedShares > 0) || data.price == null) return null;
      const impliedEv = data.price * resolvedShares + (data.totalDebt || 0) - (data.totalCash || 0);
      return impliedEv / data.ebitda;
    })();
    const bankMetricsHtml = isReitTicker ? `
      <section class="bank-metrics">
        <h3>🏢 REIT — valued with the FFO/AFFO Model</h3>
        <p>Standard FCF-based DCF is not used for REITs: GAAP depreciation artificially depresses net income and reported FCF, even though real property often appreciates. This valuation uses Adjusted Funds From Operations (AFFO) instead, priced at a sector-typical P/AFFO multiple — the same way a P/E multiple values earnings.</p>
        <div class="bank-metric-grid">
          <div class="stat"><div class="stat-label">AFFO Payout Ratio</div><div class="stat-value">${reitAffoPayoutRatio != null ? pct(reitAffoPayoutRatio) : 'N/A'}</div></div>
          <div class="stat"><div class="stat-label">Debt / EBITDA</div><div class="stat-value">${reitDebtToEbitda != null ? reitDebtToEbitda.toFixed(1) + 'x' : 'N/A'}</div></div>
          <div class="stat"><div class="stat-label">Div Yield</div><div class="stat-value">${pct(data.dividendYield)}</div></div>
        </div>
      </section>` : (isAirlineTicker ? `
      <section class="bank-metrics">
        <h3>✈️ Airline — valued with the EV/EBITDA Model</h3>
        <p>Standard FCF-based DCF is not used for airlines: extreme cyclicality and high operating/financial leverage make a single trailing-year FCF/growth snapshot unreliable. This valuation applies an EV/EBITDA multiple instead, the standard airline-industry convention.</p>
        <div class="bank-metric-grid">
          <div class="stat"><div class="stat-label">Market-Implied EV/EBITDA</div><div class="stat-value">${airlineImpliedMultiple != null ? airlineImpliedMultiple.toFixed(1) + 'x' : 'N/A'}</div></div>
          <div class="stat"><div class="stat-label">Model EV/EBITDA</div><div class="stat-value">${airlineMultiples.base}x</div></div>
          <div class="stat"><div class="stat-label">Div Yield</div><div class="stat-value">${pct(data.dividendYield)}</div></div>
        </div>
      </section>` : (isUtilityTicker ? `
      <section class="bank-metrics">
        <h3>⚡ Regulated Utility — valued with the Excess Return Model</h3>
        <p>Standard FCF-based DCF is not used for regulated utilities: a regulator sets how much the utility can earn on its asset base (its "rate base"), so value tracks book equity plus the spread between realized and required return, not free cash flow — the same underlying shape a bank's excess-return economics have. Reported ROE is used as a proxy for the regulator's allowed ROE, since Yahoo has no field for the latter.</p>
        <div class="bank-metric-grid">
          <div class="stat"><div class="stat-label">P/B</div><div class="stat-value">${data.priceToBook != null ? data.priceToBook.toFixed(2) + 'x' : 'N/A'}</div></div>
          <div class="stat"><div class="stat-label">ROE</div><div class="stat-value">${pct(data.returnOnEquity)}</div></div>
          <div class="stat"><div class="stat-label">Div Yield</div><div class="stat-value">${pct(data.dividendYield)}</div></div>
        </div>
      </section>` : (isBank ? (method === 'ExcessReturn' ? `
      <section class="bank-metrics">
        <h3>🏦 Bank/Insurer/NBFC — valued with the Excess Return Model</h3>
        <p>DCF is not used for bank/insurer/NBFC stocks: deposits, reserves, or loan origination are a raw material rather than funding, so there's no clean free cash flow. This company also retains most of its earnings for growth instead of paying them out, so the Dividend Discount Model would understate its value -- the Excess Return Model is used instead, valuing (ROE − Cost of Equity) × Book Value each year on top of the existing book value.</p>
        <div class="bank-metric-grid">
          <div class="stat"><div class="stat-label">P/B</div><div class="stat-value">${data.priceToBook != null ? data.priceToBook.toFixed(2) + 'x' : 'N/A'}</div></div>
          <div class="stat"><div class="stat-label">ROE</div><div class="stat-value">${pct(data.returnOnEquity)}</div></div>
          <div class="stat"><div class="stat-label">Div Yield</div><div class="stat-value">${pct(data.dividendYield)}</div></div>
        </div>
      </section>` : `
      <section class="bank-metrics">
        <h3>🏦 Bank/Insurer — valued with the Dividend Discount Model</h3>
        <p>DCF is not used for bank/insurer stocks: deposits or reserves are a raw material rather than funding, so there's no clean free cash flow. This valuation uses the Dividend Discount Model (DDM) instead.</p>
        <div class="bank-metric-grid">
          <div class="stat"><div class="stat-label">P/B</div><div class="stat-value">${data.priceToBook != null ? data.priceToBook.toFixed(2) + 'x' : 'N/A'}</div></div>
          <div class="stat"><div class="stat-label">ROE</div><div class="stat-value">${pct(data.returnOnEquity)}</div></div>
          <div class="stat"><div class="stat-label">Div Yield</div><div class="stat-value">${pct(data.dividendYield)}</div></div>
        </div>
      </section>`) : '')));

    // Promoted from the FCF assumption tile's own inline note (still present
    // there too) to a standalone paragraph, matching holdcoNoteHtml's
    // visibility -- user-requested 2026-08-24 after confirming the live
    // asymmetry (Utility/Holdco got a prominent standalone note, Cyclical's
    // was only visible by scrolling to the assumptions table).
    const cyclicalRevenueNote = (fcfInfo && fcfInfo.revenueCapped)
      ? ` That margin is applied to the ${fcfInfo.yearsUsed}-year average revenue, not the latest year's, which sits above it — so a peak in commodity prices doesn't inflate the starting cash flow.`
      : '';
    const cyclicalNoteHtml = ts3 ? '' : (fcfInfo && fcfInfo.method === 'normalized' && fcfInfo.source === 'sector')
      ? `<p class="cyclical-note">📊 Cyclical company — this company's own multi-year FCF margin came out negative (a capital-intensive stretch, not necessarily a bad sign), so this uses the industry average margin across ${fcfInfo.peerCount} peer companies (${(fcfInfo.marginUsed * 100).toFixed(1)}% of revenue) instead, per Damodaran's sector-average normalization technique.${cyclicalRevenueNote}</p>`
      : (fcfInfo && fcfInfo.method === 'normalized')
      ? `<p class="cyclical-note">📊 Cyclical company — this uses the average FCF margin across the last ${fcfInfo.yearsUsed} years (${(fcfInfo.marginUsed * 100).toFixed(1)}% of revenue) instead of the latest year alone, to avoid over- or under-valuing at a cycle extreme. Yahoo's data only covers up to ${fcfInfo.yearsUsed} years, shorter than a full commodity cycle — a known limitation, not hidden here.${cyclicalRevenueNote}</p>`
      : '';

    // Independent of bankMetricsHtml above (a conglomerate can stack with
    // any model) -- same 15% flat-discount wording the live tool's
    // #holdco-note uses.
    const holdcoNoteHtml = isHoldcoTicker
      ? `<p class="holdco-note">🏛️ Holding company / conglomerate — a ${(HOLDCO_DISCOUNT * 100).toFixed(0)}% discount has been applied to the intrinsic values below, reflecting typically less efficient capital allocation and reduced transparency across diversified business lines (not a per-segment valuation — Yahoo doesn't expose segment-level financials).</p>`
      : '';

    // Surfaces deriveNullReason()'s output to the reader instead of leaving
    // it as a silent 'N/A' on every scenario card (previously only used for
    // the console/diagnostics log -- see 2026-09-05: AZJ.AX/006400.KS both
    // came back with a genuine, non-transient null base case, "net debt
    // exceeds DCF firm value", and the page gave no explanation why).
    const nullReasonNoticeHtml = nullReason
      ? `<div class="notice">⚠️ <strong>No DCF value available for the base case</strong> — ${escapeHtml(nullReason)}. Any scenario card below showing N/A means the model couldn't produce a meaningful value under that scenario's assumptions, rather than an estimated number.</div>`
      : '';

    // Best-effort: must never turn a scoring hiccup into a whole-page skip
    // (this whole function body runs inside one outer try/catch, and a
    // thrown error here would count against the refresh workflow's 20%
    // skipped-ticker guard). rawBody is the same quoteSummary response
    // already fetched above for mapQuoteSummary — no extra network call.
    let valueScaleHtml = '';
    try {
      valueScaleHtml = buildValueScaleCard({ rawBody, symbol: t, market });
    } catch (_) {
      valueScaleHtml = '';
    }

    // Best-effort, same posture as valueScaleHtml above -- a scoring hiccup
    // here must never turn into a whole-page skip.
    let solvencyScaleHtml = '';
    try {
      // ebit comes from hist (fetchHistorySeries()'s /timeseries-derived
      // field), not data (the quoteSummary mapper) -- data.ebit doesn't
      // exist. Same field hist.ebit that the WACC/EBITDA computations
      // above already read.
      //
      // isFinancialSector(data.sector), NOT isBank -- per the design spec's
      // approved exclusion policy ("Banks / insurers / asset managers"),
      // broader than isBank (isBankOrInsurance()'s narrow bank/insurance-
      // text + Indian-NBFC-ticker match, used for THIS function's own
      // valuation-model dispatch -- deliberately untouched here, that
      // variable still needs its narrower meaning for DDM/Excess-Return
      // routing). An asset manager's balance sheet is just as structurally
      // atypical for these ratios as a bank's. Confirmed in peer review.
      solvencyScaleHtml = buildSolvencyScaleCard({ hist, ebit: hist.ebit, marketCap: data.marketCap, excluded: isFinancialSector(data.sector) || isReitTicker });
    } catch (_) {
      solvencyScaleHtml = '';
    }

    let relatedStocksSectionHtml = '';
    try {
      const relatedPool = buildRelatedStocksPool();
      const relatedCandidates = selectRelatedStocks(
        { ticker: t, sector: data.sector, marketCap: data.marketCap },
        relatedPool
      );
      const relatedHeading = relatedCandidates.length
        ? 'Explore more DCF valuations'
        : `More ${market.label ? escapeHtml(market.label) + ' ' : ''}stocks we've valued`;
      const relatedInner = buildRelatedStocksHtml(relatedCandidates, {
        browseHref: `/dcf/stocks/${market.folder}/`,
        browseLabel: `Browse every stock we've valued in this market &rarr;`,
      });
      relatedStocksSectionHtml = `<section class="other-tickers related-stocks">
        <h2>${relatedHeading}</h2>${relatedInner}
      </section>`;
    } catch (_) {
      relatedStocksSectionHtml = `<section class="other-tickers">
        <h2>More ${market.label ? escapeHtml(market.label) + ' ' : ''}stocks we've valued</h2>
        <div class="ticker-chip-row">
          <a class="ticker-chip" href="/dcf/stocks/${market.folder}/">Browse every stock we've valued in this market &rarr;</a>
        </div>
      </section>`;
    }

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
    const fourthChartHtml = (isBank || isUtilityTicker)
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
    crumbs.push({ name: `${name} (${t})`, path: canonical, url: canonical });

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
        <h2>${escapeHtml(name)}'s price &amp; financial trends</h2>
        <p class="cadence-note">${cadenceNote}</p>
        <p class="refresh-note"><span class="dot"></span>Data as at ${today}</p>
        <div class="chart-row">${priceChartHtml}${epsChartHtml}${fourthChartHtml}${divChartHtml}</div>
      </section>

      ${valueScaleHtml}

      ${solvencyScaleHtml}

      ${aiCorrelationHtml}

      ${bankMetricsHtml}

      ${cyclicalNoteHtml}

      ${holdcoNoteHtml}

      ${nullReasonNoticeHtml}

      <section class="scenarios-results">
        <h3>Intrinsic value estimate · 5-year forecast${heavyCapex ? ' · Heavy capex spending' : revenueNormalised ? ' · Revenue-normalised' : ''}</h3>
        <div class="scenario-cards">${scenarioCardsHtml}</div>
      </section>

      ${heavyCapexValued ? heavyCapexPageCardHtml({ check: heavyCapex, valuation: heavyCapexValued }, data.price, currencySym) : ''}

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
        <span>These numbers come from running ${escapeHtml(name)}'s ${method === 'DCF' ? 'cash flows' : method === 'DDM' ? 'dividends' : method === 'REIT' ? 'AFFO' : method === 'Airline' ? 'EBITDA' : 'book value and return on equity'} through the mechanical ${METHOD_SHORT[method]} formula and assumptions above — not from any view on the news, management, or ${escapeHtml(t)}'s competitive position. <a href="${METHOD_GLOSSARY[method] || '/glossary/'}">What is ${METHOD_SHORT[method]}?</a></span>
      </p>

      <p class="ticker-cta"><span>Want to test your own ${method === 'DCF' ? 'growth or discount-rate' : method === 'DDM' ? 'dividend growth or cost-of-equity' : method === 'REIT' ? 'P/AFFO multiple' : method === 'Airline' ? 'EV/EBITDA multiple' : 'ROE or cost-of-equity'} assumptions?</span><a href="${calcHref}">Open the full interactive calculator, pre-filled with ${escapeHtml(t)} &rarr;</a></p>

      ${relatedStocksSectionHtml}

      <p class="disclaimer"><strong>Not financial advice.</strong> ${METHOD_SHORT[method]} valuations are highly sensitive to assumptions — small changes in ${method === 'REIT' ? 'the P/AFFO multiple' : method === 'Airline' ? 'the EV/EBITDA multiple' : 'growth rate or discount rate'} produce large swings in output. This is a mechanical calculation, not a recommendation to buy, hold, or sell.</p>

      <section class="tool-info">
        <div class="tool-about">
          <h2>About this valuation</h2>
          <p>Computed on ${today} from Yahoo Finance data, using the same engine as the <a href="/dcf/">DCF calculator</a>${market.screenUrl ? ` and the <a href="${market.screenUrl}">${escapeHtml(market.screenName)}</a> screen` : ''}. Every figure above is a point-in-time snapshot of that date — change any assumption yourself in the interactive tool for a live one.</p>
        </div>
        <div class="tool-faq">
          <h2>Frequently asked questions</h2>
          <details class="faq-item"><summary>Is ${escapeHtml(name)} (${escapeHtml(t)}) undervalued?</summary>
            <p>${nullReason
              ? `A Base-case ${METHOD_SHORT[method]} value could not be computed for ${escapeHtml(name)} as of ${today} — ${escapeHtml(nullReason)}. This is a mechanical output of the model's current inputs, not a judgment on the company.`
              : `The Base-case ${METHOD_SHORT[method]} estimates intrinsic value at ${money(baseResult?.intrinsicValue, currencySym)} vs a price of ${money(data.price, currencySym)} on ${today} — a ${pctSigned(baseResult?.marginOfSafety)} margin, so the Base case reads ${v.text.toLowerCase()}. This is a mechanical output, not advice.`
            }</p>
          </details>
          ${aiCorrelationFaqHtml}
        </div>
      </section>`;

    const METHOD_FULL = { DCF: 'Discounted Cash Flow', DDM: 'Dividend Discount Model', ExcessReturn: 'Excess Return Model', REIT: 'FFO/AFFO Valuation', Airline: 'EV/EBITDA Valuation' };
    // "SaaS valuation" title/meta variant: GSC (2026-08-26) showed real search
    // demand for "<company> saas valuation" sitting at position 28-85 with zero
    // clicks -- isSaas() is a manual allowlist, not the method dispatch above.
    const isSaasTicker = isSaas(t);
    // Title-experiment subset (2026-10-10): the SaaS variant above shipped the
    // title fix (26 Aug) and the question-led description fix (18 Sep), but 5
    // consecutive weekly GSC reads still show 0 clicks sitewide despite several
    // tickers holding position 5-10 (growth-radar-2026-10-10 dashboard finding).
    // Hypothesis: the SERP for "<company> saas valuation" is dominated by
    // investor-narrative content, and a technical "SaaS Valuation" title doesn't
    // read like a match. Testing a "Fair Value" / method-led framing on 3
    // tickers first -- widen SAAS_TITLE_EXPERIMENT to the rest of the SaaS
    // allowlist if CTR moves on these.
    const SAAS_TITLE_EXPERIMENT = new Set(['TWLO', 'OKTA', 'ADSK']);
    const isSaasExperiment = SAAS_TITLE_EXPERIMENT.has(t);
    const html = pageShell({
      title: isSaasExperiment
        ? `${name} (${t}) Fair Value — SaaS DCF With Growth Assumptions | KashVector`
        : isSaasTicker
          ? `${name} (${t}) SaaS Valuation — Is It Undervalued? | KashVector`
          : `${name} (${t}) — Is It Undervalued? | ${METHOD_SHORT[method]} Valuation | KashVector`,
      // Deliberately doesn't reveal Bear/Base/Bull numbers or the verdict --
      // leads with the question and teases the methodology instead, so the
      // search snippet gives a reason to click through rather than already
      // answering it (GSC: 17K impressions/179 clicks, 2026-09-18 CTR audit).
      description: isSaasExperiment
        ? `${name} (${t}) fair value, by the numbers — SaaS DCF with Bear, Base & Bull growth scenarios you can adjust yourself. Free, no sign-up.`
        : isSaasTicker
          ? `Is ${name} (${t}) undervalued? SaaS valuation via ${METHOD_FULL[method]} with Bear, Base & Bull scenarios — adjust every assumption yourself. Free, no sign-up.`
          : `Is ${name} (${t}) undervalued? ${METHOD_FULL[method]} valuation with Bear, Base & Bull scenarios — adjust every assumption yourself. Free, no sign-up.`,
      canonical,
      h1: `${name} (${t})`,
      subtitle: `${METHOD_SHORT[method]} Valuation · ${escapeHtml(sectorLine)}`,
      jsonLd: [breadcrumbJsonLd(crumbs)],
      breadcrumbHtml: breadcrumbNav(crumbs),
      mainHtml,
    });

    const entry = {
      ticker: t, slug, name, sector: data.sector, method,
      intrinsic: baseResult?.intrinsicValue ?? null,
      price: data.price,
      marginOfSafety: baseResult?.marginOfSafety ?? null,
      marketCap: data.marketCap ?? null,
      updated: today,
      // Full-precision timestamp for recency sorting (e.g. the hub's "Latest
      // valuations" strip) — `updated` alone is date-only, so same-day writes
      // are indistinguishable by date and fall back to manifest array order
      // (alphabetical, see upsertManifestEntry) instead of true recency.
      updatedAt: new Date().toISOString(),
    };

    return { status: 'ok', html, entry, market, nullReason, nullDiagnostics };
  } catch (err) {
    return { status: 'skipped', ticker: t, market: market.folder, reason: `fetch failed: ${err.message}` };
  }
}

module.exports = { heavyCapexForTickerPage, heavyCapexPageCardHtml, buildTickerPage, upsertManifestEntry, deriveNullReason, latestAnnual, pickCadence, deriveScenarios, deriveBaseGrowthPct, shouldApplyRevenueFallback, revenueFallbackNote, marketMeta, lineChart, fetchHistorySeries, isGbpPenceCurrencyPair, bucketMonthly };
