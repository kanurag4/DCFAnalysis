// scripts/lib/sector-margin-tally.js
// Builds the cross-market, per-industry average FCF margin lookup that
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
// Two files:
//   scripts/_sector-margins-raw.json -- gitignored internal cache (matches
//     the existing scripts/_* gitignore pattern), { industry: { market: {
//     sum, count } } }. Per-market sub-sums mean re-running just one
//     market's screen only overwrites that market's own contribution, so
//     cross-market pooling stays correct even though markets refresh on
//     independent cadences.
//   www/sector-margins.json -- published, committed, flattened artifact
//     actually read by every consumer: { industry: { avgMargin, peerCount } }.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeCyclicalFcf } = require('../../www/calc/cyclicalNormalization.js');

const RAW_PATH = path.join(__dirname, '..', '_sector-margins-raw.json');
const PUBLISHED_PATH = path.join(__dirname, '../..', 'www', 'sector-margins.json');

// One ticker's own multi-year margin, independent of isCyclical() -- applied
// to every evaluated ticker so the peer pool for an industry isn't limited
// to tickers already flagged cyclical.
function tallyTickerMargin(data) {
  if (!data || !data.industry) return null;
  const normalized = normalizeCyclicalFcf({
    fcfHistory: data.annualFcfHistory,
    revenueHistory: data.annualRevenueHistory,
    trailingRevenue: data.totalRevenue,
  });
  if (normalized.value === null) return null;
  return { industry: data.industry, margin: normalized.marginUsed };
}

function loadRaw() {
  if (!fs.existsSync(RAW_PATH)) return {};
  return JSON.parse(fs.readFileSync(RAW_PATH, 'utf8'));
}

// Overwrites only `market`'s own sub-block per industry -- other markets'
// contributions already in `raw` are left untouched, so a re-run of one
// market's screen can't silently double-count or go stale for another.
function mergeMarketTallies(raw, market, tallies) {
  const next = { ...raw };
  const byIndustry = {};
  for (const t of tallies) {
    if (!t) continue;
    if (!byIndustry[t.industry]) byIndustry[t.industry] = { sum: 0, count: 0 };
    byIndustry[t.industry].sum += t.margin;
    byIndustry[t.industry].count += 1;
  }
  for (const [industry, agg] of Object.entries(byIndustry)) {
    next[industry] = { ...(next[industry] || {}), [market]: agg };
  }
  return next;
}

function flatten(raw) {
  const flat = {};
  for (const [industry, byMarket] of Object.entries(raw)) {
    let sum = 0, count = 0;
    for (const agg of Object.values(byMarket)) { sum += agg.sum; count += agg.count; }
    if (count > 0) flat[industry] = { avgMargin: sum / count, peerCount: count };
  }
  return flat;
}

// Called once per full-fetch screen run, after every ticker in that market
// has been evaluated. `market` is config.outDir (e.g. 'asx-undervalued') --
// any stable per-market string works, it's an internal-only cache key, never
// shown to a user.
function updateSectorMarginLookup(market, tallies) {
  const raw = mergeMarketTallies(loadRaw(), market, tallies);
  fs.writeFileSync(RAW_PATH, JSON.stringify(raw) + '\n');
  const flat = flatten(raw);
  fs.writeFileSync(PUBLISHED_PATH, JSON.stringify(flat, null, 2) + '\n');
  return flat;
}

module.exports = { tallyTickerMargin, mergeMarketTallies, flatten, updateSectorMarginLookup, RAW_PATH, PUBLISHED_PATH };
