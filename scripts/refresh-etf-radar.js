// scripts/refresh-etf-radar.js
//   node scripts/refresh-etf-radar.js            full monthly run (download holdings + fetch + rank + pages)
//   node scripts/refresh-etf-radar.js --offline  re-run from committed snapshots, no issuer downloads
//   node scripts/refresh-etf-radar.js --regen    alias for --offline
const path = require('node:path');
const { runEtfRadar, writeRadarArtifacts } = require('./lib/etf/run-etf-radar.js');
const { readProxyUrl } = require('./lib/run-screen.js');

const offline = process.argv.includes('--offline') || process.argv.includes('--regen');

(async () => {
  const result = await runEtfRadar({
    universePath: path.join(__dirname, 'etfs.json'),
    holdingsDir: path.join(__dirname, 'etf-holdings'),
    overridesPath: path.join(__dirname, 'etf-symbol-overrides.json'),
    proxyUrl: readProxyUrl(),
    log: console.log,
  }, { offline });

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
  console.log(`Not valued — crypto (${result.rankings.notValued.length}): `
    + (result.rankings.notValued.map(f => f.slug).join(', ') || '—'));
  const flagged = result.funds.filter(f => f.flags && f.flags.length);
  if (flagged.length) {
    console.log(`\n⚠ holdings flags: ${flagged.map(f => `${f.slug}[${f.flags.join(',')}]`).join('  ')}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
