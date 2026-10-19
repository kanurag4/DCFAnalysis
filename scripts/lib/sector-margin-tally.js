// scripts/lib/sector-margin-tally.js
// Builds the cross-market, per-industry FCF margin lookup that
// resolveCyclicalMargin() (www/calc/cyclicalNormalization.js) uses as a
// fallback when a cyclical ticker's own multi-year average margin is
// negative -- Damodaran's "sector average" normalization technique. See
// docs/superpowers/specs/2026-08-24-sector-average-cyclical-margin-design.md
// (StockAnalysis repo).
//
// Computed as a byproduct of each undervalued screen's existing full-fetch
// run (scripts/lib/run-screen.js's gather()) -- every evaluated ticker's own
// multi-year margin is tallied by industry, regardless of isCyclical() tag,
// via the same normalizeCyclicalFcf() core already used for cyclical
// tickers. Nothing here fetches anything -- it only aggregates data
// run-screen.js already fetched for its own ranking purposes.
//
// Two kinds of file, both committed:
//   www/<market>-undervalued/sector-margins-slice.json -- one market's own
//     per-ticker margins, { asAt, industries: { industry: [{ ticker, margin }] } }.
//     Lives in the market's own directory so the weekly CI run commits it on
//     staging/<market> with the rest of that market's snapshot, and the
//     publish cherry-pick stays conflict-free (markets touch disjoint dirs).
//     Until 2026-10-19 this was a gitignored scripts/_sector-margins-raw.json
//     that CI runners discarded, so only local ASX/KOSPI runs ever reached
//     the lookup -- no US/Japan/Europe/India peer was ever counted.
//   www/sector-margins.json -- the flattened lookup every consumer reads:
//     { industry: { avgMargin, peerCount } }. Rebuilt from ALL markets'
//     slices (rebuildLookup / scripts/build-sector-margins.js), so it never
//     depends on which market ran last.
//
// `avgMargin` holds the peer MEDIAN since 2026-10-19 (was the mean). The
// field name is kept because four consumers read it, including the native
// shells' bundled calc, which can't change without an app-store release.
// A mean let two ASX development-stage "semiconductor" peers (~-744% each)
// drag the whole Semiconductors entry to -293%, which turned MU's normalized
// FCF into -$390B on every surface.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeCyclicalFcf } = require('../../www/calc/cyclicalNormalization.js');
const { isCyclical } = require('../../www/utils.js');

const WWW_DIR = path.join(__dirname, '../..', 'www');
const PUBLISHED_PATH = path.join(WWW_DIR, 'sector-margins.json');
const SLICE_FILE = 'sector-margins-slice.json';

// The only slices rebuildLookup() reads. An explicit list, not a glob, so a
// test fixture's www/<fixture>/ slice can never leak into the real lookup.
const MARKETS = [
  'asx-undervalued', 'sp500-undervalued', 'nifty-undervalued',
  'kospi-undervalued', 'nikkei-undervalued', 'europe-undervalued',
];

// Every cyclical industry (www/utils.js's CYCLICAL_INDUSTRIES -- the only
// industries resolveCyclicalMargin() ever reads) pools ONLY the markets
// where that industry is a major listed sector. One rule for all of them,
// set by the user 2026-10-19 after ASX's two development-stage
// "Semiconductors" dragged MU's peer margin to -293%. A plain ">= 3
// constituents" rule was tried and rejected: it would drop Hyundai/Kia from
// Autos and Newmont from Gold. NIFTY only for Autos and Steel (India
// deprioritised elsewhere over Yahoo data quality); no Europe for Semis.
// A cyclical industry missing from this table gets NO lookup entry (see
// flatten), so a newly tagged industry can't silently pool every market.
// Non-cyclical industries are never read by the fallback and pool everything.
const ASX = 'asx-undervalued', US = 'sp500-undervalued', NIFTY = 'nifty-undervalued';
const KOSPI = 'kospi-undervalued', NIKKEI = 'nikkei-undervalued', EUROPE = 'europe-undervalued';
const INDUSTRY_MARKETS = {
  'Semiconductors': [US, KOSPI, NIKKEI],
  'Gold': [ASX, US, EUROPE],
  'Silver': [ASX, US, EUROPE],
  'Other Industrial Metals & Mining': [ASX, EUROPE, NIKKEI, KOSPI],
  'Copper': [ASX, US, EUROPE],
  'Aluminum': [ASX, US, EUROPE],
  'Coking Coal': [ASX, US, EUROPE],
  'Thermal Coal': [ASX, US, EUROPE],
  'Oil & Gas E&P': [US, ASX, NIKKEI],
  'Oil & Gas Equipment & Services': [US, ASX, NIKKEI],
  'Oil & Gas Integrated': [US, EUROPE, KOSPI, NIKKEI, ASX],
  'Oil & Gas Refining & Marketing': [US, EUROPE, KOSPI, NIKKEI, ASX],
  'Auto Manufacturers': [US, NIKKEI, KOSPI, EUROPE, NIFTY],
  'Auto Parts': [US, NIKKEI, KOSPI, EUROPE, NIFTY],
  'Chemicals': [US, EUROPE, NIKKEI, KOSPI],
  'Specialty Chemicals': [US, EUROPE, NIKKEI, KOSPI],
  'Steel': [NIKKEI, KOSPI, NIFTY, EUROPE, US, ASX],
  'Marine Shipping': [NIKKEI, KOSPI],
};

// One ticker's own multi-year margin, independent of isCyclical() -- applied
// to every evaluated ticker so the peer pool for an industry isn't limited
// to tickers already flagged cyclical.
//
// minRevenueToMarketCapRatio guards against a near-zero-revenue (pre-revenue
// / development-stage) company swamping a peer average -- FCF/revenue as a
// "margin" concept breaks down when revenue is a rounding error relative to
// the company's actual economic size, not a genuine cyclical-trough signal.
// Confirmed live 2026-08-25: VUL.AX ($7.35M revenue against a $1.31B market
// cap, 0.56% ratio) produced a -1361.7% "margin" that single-handedly
// dragged a healthy 16-peer ASX 'Other Industrial Metals & Mining' average
// from a normal positive mix down to -88% -- every real operating company in
// that same peer set sat at >=4.37% revenue/marketCap. Relative to market
// cap (not an absolute revenue floor) because this tally pools 6 markets
// across 5 different currencies -- a fixed-currency dollar threshold isn't
// portable across them, a ratio is currency-agnostic. Fails closed (treats
// a missing/non-positive marketCap as excluded) since the ratio can't be
// verified without it.
//
// minMargin (default -100%) closes the gap the ratio guard leaves: the ratio
// moves with the share price, so a cash-burning company sitting near 2%
// (WBT.AX at 1.95% on 2026-10-19) gets in on any run where it trades lower.
// A margin below -100% means the company burns more cash than it takes in
// revenue -- not an operating business at a cycle trough -- whatever its
// share price did that week.
function tallyTickerMargin(data, opts) {
  if (!data || !data.industry) return null;
  const minRatio = (opts && opts.minRevenueToMarketCapRatio) ?? 0.02;
  const minMargin = (opts && opts.minMargin) ?? -1;
  if (!(data.marketCap > 0) || !(data.totalRevenue >= data.marketCap * minRatio)) return null;
  const normalized = normalizeCyclicalFcf({
    fcfHistory: data.annualFcfHistory,
    revenueHistory: data.annualRevenueHistory,
    trailingRevenue: data.totalRevenue,
  });
  if (normalized.value === null) return null;
  if (normalized.marginUsed < minMargin) return null;
  return { ticker: data.ticker ?? null, industry: data.industry, margin: normalized.marginUsed };
}

// One market's tallies -> that market's slice. Null entries (tickers with
// too little history, or excluded above) are dropped.
function buildSlice(tallies, asAt) {
  const industries = {};
  for (const t of tallies) {
    if (!t) continue;
    (industries[t.industry] ||= []).push({ ticker: t.ticker, margin: t.margin });
  }
  return { asAt: asAt ?? null, industries };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// { market: slice } -> the published lookup. A cyclical industry pools only
// its INDUSTRY_MARKETS markets, and is left out entirely if it has no entry.
function flatten(slices, industryMarkets = INDUSTRY_MARKETS) {
  const byIndustry = {};
  for (const [market, slice] of Object.entries(slices)) {
    if (!slice || !slice.industries) continue;
    for (const [industry, entries] of Object.entries(slice.industries)) {
      const allowed = industryMarkets[industry];
      if (allowed ? !allowed.includes(market) : isCyclical('', industry)) continue;
      for (const e of entries) (byIndustry[industry] ||= []).push(e.margin);
    }
  }
  const flat = {};
  for (const industry of Object.keys(byIndustry).sort()) {
    const margins = byIndustry[industry];
    if (margins.length > 0) flat[industry] = { avgMargin: median(margins), peerCount: margins.length };
  }
  return flat;
}

// Temp file + rename, so a process reading the file mid-write (another test
// file require()-ing it, a consumer) never sees it half-written.
function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

function readSlices(wwwDir = WWW_DIR) {
  const slices = {};
  for (const market of MARKETS) {
    const file = path.join(wwwDir, market, SLICE_FILE);
    if (fs.existsSync(file)) slices[market] = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  return slices;
}

// Rebuilds www/sector-margins.json from every market's committed slice. Also
// run standalone by scripts/build-sector-margins.js (publish-screen.yml).
function rebuildLookup(wwwDir = WWW_DIR) {
  const flat = flatten(readSlices(wwwDir));
  writeAtomic(path.join(wwwDir, 'sector-margins.json'), JSON.stringify(flat, null, 2) + '\n');
  return flat;
}

// Called once per full-fetch screen run, after every ticker in that market
// has been evaluated. `market` is config.outDir (e.g. 'asx-undervalued').
function updateSectorMarginLookup(market, tallies, asAt, wwwDir = WWW_DIR) {
  const dir = path.join(wwwDir, market);
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(path.join(dir, SLICE_FILE), JSON.stringify(buildSlice(tallies, asAt), null, 1) + '\n');
  return rebuildLookup(wwwDir);
}

module.exports = {
  tallyTickerMargin, buildSlice, flatten, median, readSlices, rebuildLookup, updateSectorMarginLookup,
  MARKETS, INDUSTRY_MARKETS, PUBLISHED_PATH, SLICE_FILE,
};
