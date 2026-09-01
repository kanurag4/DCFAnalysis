// scripts/refresh-etf-radar.js
//   node scripts/refresh-etf-radar.js            full monthly run (download holdings + fetch + rank + pages)
//   node scripts/refresh-etf-radar.js --offline  re-run from committed snapshots, no issuer downloads
//   node scripts/refresh-etf-radar.js --regen    alias for --offline
//   node scripts/refresh-etf-radar.js --reagg    re-aggregate + regenerate pages from the raw-data cache, zero network
const path = require('node:path');
const { runEtfRadar, writeRadarArtifacts } = require('./lib/etf/run-etf-radar.js');
const { readProxyUrl } = require('./lib/run-screen.js');

const offline = process.argv.includes('--offline') || process.argv.includes('--regen');
const reagg = process.argv.includes('--reagg');

// fetchSymbol makes 2 Worker requests per symbol (quoteSummary + /timeseries).
// The Worker's per-IP cap is 20 req / 60s, bypassed for batch-authenticated
// requests (X-KV-Batch-Key, set from KV_BATCH_KEY — same secret the CI screen
// refreshes use). Keyed: 3.3s spacing, ~25 min. Keyless: 6.6s to keep 2 req/
// symbol under the cap, ~50 min — set KV_BATCH_KEY to halve it.
const keyed = !!process.env.KV_BATCH_KEY;
const throttleMs = reagg ? 0 : (keyed ? 3300 : 6600);
if (!reagg) console.log(keyed
  ? 'KV_BATCH_KEY set — batch-authenticated, 3.3s throttle.'
  : '⚠ KV_BATCH_KEY not set — keyless run at 6.6s throttle (~50 min). Set it to go faster.');

(async () => {
  const result = await runEtfRadar({
    universePath: path.join(__dirname, 'etfs.json'),
    holdingsDir: path.join(__dirname, 'etf-holdings'),
    overridesPath: path.join(__dirname, 'etf-symbol-overrides.json'),
    rawCachePath: path.join(__dirname, '_raw-etf.json'),
    proxyUrl: readProxyUrl(),
    log: console.log,
  }, { offline, reagg, throttleMs });

  const dcfRoot = path.join(__dirname, '..', 'www', 'dcf');
  writeRadarArtifacts(result, path.join(dcfRoot, 'etf-radar'), {
    generatePages: true, pagesRoot: dcfRoot,
  });

  const pct = (x) => (x == null ? '  —  ' : `${(x * 100).toFixed(1)}%`);
  console.log(`\n=== ETF Radar ${result.asAt} ${offline ? '(offline)' : ''} ===`);
  console.log(`union ${result.union.count} symbols → ${result.union.fetched} fetched, ${result.union.failed} failed`);
  console.log(`\nRanked (${result.rankings.ranked.length}):`);
  for (const f of result.rankings.ranked) {
    console.log(`  ${String(f.rank).padStart(2)}. ${f.slug.padEnd(8)} ${pct(f.lookThroughMos).padStart(8)}  cov ${(f.coverage * 100).toFixed(0).padStart(3)}%  ${f.theme}`);
  }
  console.log(`\nNot ranked — coverage < 70% (${result.rankings.unranked.length}): `
    + (result.rankings.unranked.map(f => `${f.slug} ${(f.coverage * 100).toFixed(0)}%`).join(', ') || '—'));
  if (result.cryptoExcluded && result.cryptoExcluded.length) {
    console.log(`Excluded — crypto-heavy: ${result.cryptoExcluded.join(', ')}`);
  }
  const flagged = result.funds.filter(f => f.flags && f.flags.length);
  if (flagged.length) {
    console.log(`\n⚠ holdings flags: ${flagged.map(f => `${f.slug}[${f.flags.join(',')}]`).join('  ')}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
