#!/usr/bin/env node
// scripts/refresh-ticker-pages.js
// Regenerates every ticker already published in www/stocks/<market>/manifest.json,
// across every market -- the bulk counterpart to generate-ticker-page.js's
// one-ticker-at-a-time CLI. See
// docs/superpowers/specs/2026-08-05-ticker-pages-bulk-refresh-design.md (StockAnalysis)
// for the full design.
//
// A ticker that comes back with a null base case, or is skipped specifically
// with "WACC uncomputable (no market cap or debt data)" (see lib/ticker-retry.js's
// header for why both happen -- transient Yahoo-side module omission, confirmed
// for the WACC-uncomputable case 2026-08-17), gets up to 2 retries with backoff
// before being given up on. A ticker that fails to fetch, or is skipped for any
// other reason (invalid ticker format, etc.), is not retried -- there's no
// evidence yet those are the same transient condition rather than a real,
// permanent failure.
//
// Whatever is still unresolved after retries is SKIPPED, not overwritten --
// its existing published page and manifest entry are left untouched. This is
// deliberately different from generate-ticker-page.js's own CLI behaviour
// (which still writes an N/A page on a null base case) -- in a batch nobody
// is eyeballing each page before it ships, so this guard is automatic here
// even though it stays manual there.
//
// Usage:
//   node scripts/refresh-ticker-pages.js [--dry-run]

const fs = require('fs');
const path = require('path');

const { buildTickerPage, upsertManifestEntry } = require('./lib/ticker-page.js');
const { generateMarketIndex } = require('./generate-market-index.js');
const { generateStocksHub } = require('./generate-stocks-hub.js');
const { computeRefreshSummary } = require('./lib/refresh-report.js');
const { withNullBaseCaseRetry } = require('./lib/ticker-retry.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const THROTTLE_MS = 3200; // same throttle scripts/lib/run-screen.js uses between tickers -- a courtesy to Yahoo's own API, not just the Worker's per-IP cap

function readProxyUrl() {
  if (process.env.YAHOO_PROXY_URL) return process.env.YAHOO_PROXY_URL;
  const src = fs.readFileSync(path.join(__dirname, '..', 'www', 'config.js'), 'utf8');
  const m = src.match(/YAHOO_PROXY_URL\s*[:=]\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('Could not find YAHOO_PROXY_URL in www/config.js');
  return m[1];
}

const STOCKS_DIR = path.join(__dirname, '..', 'www', 'stocks');
const MARKET_FOLDERS = ['asx', 'sp500', 'nifty', 'kospi', 'nikkei', 'other'];

async function refreshMarket(folder, proxyUrl, dryRun) {
  const manifestFile = path.join(STOCKS_DIR, folder, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const indexHistoryCache = new Map();
  const results = [];

  let done = 0;
  for (const oldEntry of manifest) {
    const outcome = await withNullBaseCaseRetry(
      () => buildTickerPage(oldEntry.ticker, { proxyUrl, indexHistoryCache }),
      {
        onRetry: (attempt, prevOutcome) => {
          const why = prevOutcome.status === 'skipped' ? prevOutcome.reason : 'null base case';
          console.log(`  ↻ ${oldEntry.ticker} (${folder}) ${why}, retrying (attempt ${attempt}/2)…`);
        }
      }
    );

    if (outcome.status === 'skipped') {
      results.push({ status: 'skipped', ticker: oldEntry.ticker, market: folder, reason: outcome.reason });
    } else if (outcome.entry.intrinsic == null) {
      // Batch-only policy layered on top of buildTickerPage's generic contract
      // (see the file header) -- the base case computed but came back null.
      // generate-ticker-page.js's own CLI still writes this as an N/A page;
      // the batch treats it the same as any other skip. The reason now names
      // the actual cause (deriveNullReason) instead of listing all 4
      // possibilities; the raw diagnostic snapshot is printed to the log so a
      // recurrence is diagnosable from the run log alone, without a manual
      // reproduction (2026-08-05 incident).
      results.push({ status: 'skipped', ticker: oldEntry.ticker, market: folder, reason: outcome.nullReason || 'base case null' });
      console.log(`  ! ${oldEntry.ticker} (${folder}) null-base diagnostics: ${JSON.stringify(outcome.nullDiagnostics)}`);
    } else {
      if (!dryRun) {
        const outDir = path.join(STOCKS_DIR, folder, outcome.entry.slug);
        fs.mkdirSync(outDir, { recursive: true });
        fs.writeFileSync(path.join(outDir, 'index.html'), outcome.html);
        upsertManifestEntry(manifestFile, outcome.entry);
      }
      results.push({ status: 'ok', ticker: oldEntry.ticker, market: folder, entry: outcome.entry });
    }

    if (++done % 25 === 0) console.log(`  …${folder} ${done}/${manifest.length}`);
    await sleep(THROTTLE_MS);
  }

  if (!dryRun) generateMarketIndex(folder);

  return results;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const proxyUrl = readProxyUrl();

  const markets = MARKET_FOLDERS.filter(f => fs.existsSync(path.join(STOCKS_DIR, f, 'manifest.json')));
  if (!markets.length) { console.error('No market has a manifest.json -- generate at least one ticker first.'); process.exit(1); }

  // Snapshot every market's manifest BEFORE any refresh touches it, so the
  // diff summary compares against the true pre-run state even though later
  // markets in this loop are processed after earlier markets have already
  // been upserted.
  const oldManifestByTicker = new Map();
  for (const folder of markets) {
    const manifest = JSON.parse(fs.readFileSync(path.join(STOCKS_DIR, folder, 'manifest.json'), 'utf8'));
    for (const e of manifest) oldManifestByTicker.set(e.ticker, e);
  }

  let allResults = [];
  for (const folder of markets) {
    console.log(`\n=== ${folder} ===`);
    const results = await refreshMarket(folder, proxyUrl, dryRun);
    allResults = allResults.concat(results);
  }

  if (!dryRun) generateStocksHub();

  const summary = computeRefreshSummary(oldManifestByTicker, allResults);
  const reportPath = path.join(__dirname, '_refresh-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(summary, null, 2));

  console.log(`\n${summary.written} of ${summary.total} tickers regenerated, ${summary.skipped} skipped.`);
  if (summary.skips.length) {
    console.log('Skips:');
    for (const s of summary.skips) console.log(`  ${s.ticker} (${s.market}): ${s.reason}`);
  }
  if (summary.flips.length) {
    console.log('Verdict flips:');
    for (const f of summary.flips) console.log(`  ${f.ticker} (${f.market}): ${f.from} -> ${f.to}`);
  }
  if (summary.movers.length) {
    console.log('Biggest movers:');
    for (const m of summary.movers) console.log(`  ${m.ticker} (${m.market}): ${m.intrinsicDeltaPct >= 0 ? '+' : ''}${m.intrinsicDeltaPct.toFixed(1)}%`);
  }
  console.log(`\nReport written to ${reportPath}${dryRun ? ' (--dry-run: no www/stocks files were written)' : ''}`);
}

main().catch(err => { console.error(err); process.exit(1); });
