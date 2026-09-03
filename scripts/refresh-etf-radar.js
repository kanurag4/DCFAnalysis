// scripts/refresh-etf-radar.js
//   node scripts/refresh-etf-radar.js            full monthly run (download holdings + fetch union + rank + pages)
//   node scripts/refresh-etf-radar.js --offline  use committed holdings snapshots (no issuer downloads); still fetches the Yahoo union
//   node scripts/refresh-etf-radar.js --regen    alias for --offline
//   node scripts/refresh-etf-radar.js --reagg    reuse the cached union of Yahoo data (the 25-50 min fetch); STILL re-downloads
//                                                issuer holdings CSVs + re-fetches /quote prices + live rf, and re-runs FX +
//                                                valuation + all 15 pages. Not a read-only recompute. A re-downloaded holdings
//                                                file that goes backwards in asOf is now rejected (holdings-store.js's
//                                                asOf-regressed guard). Funds added via --only ARE visible here (their cache is
//                                                folded into _raw-etf.json — see the --only branch).
//   node scripts/refresh-etf-radar.js --only=<slug>  scoped add/update: fetch + value ONLY that fund's own
//                                                holdings, merge the result into the existing published
//                                                rankings, regenerate only that fund's page + the ranking
//                                                page. Every other fund's holdings/valuations/pages are
//                                                completely untouched (their listing PRICE is refreshed --
//                                                one cheap batched /quote call, not a re-valuation). Use
//                                                this to add one new fund or refresh one existing fund;
//                                                reserve a plain full run for the monthly cycle.
const path = require('node:path');
const fs = require('node:fs');
const {
  runEtfRadar, writeRadarArtifacts, buildTickerPageIndex, ordinal, fetchQuotesReal,
} = require('./lib/etf/run-etf-radar.js');
const { mergeFundIntoRankings } = require('./lib/etf/merge-fund.js');
const { mergeUnionCache } = require('./lib/etf/raw-cache.js');
const { renderEtfPage } = require('./lib/etf/etf-page.js');
const { renderRadarPage } = require('./lib/etf/etf-radar-page.js');
const { sistersFor } = require('./lib/etf/overlap.js');
const { readSnapshot } = require('./lib/etf/holdings-store.js');
const { readProxyUrl } = require('./lib/run-screen.js');

const offline = process.argv.includes('--offline') || process.argv.includes('--regen');
const reagg = process.argv.includes('--reagg');
const onlyArg = process.argv.find(a => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice('--only='.length) : null;

// fetchSymbol makes 2 Worker requests per symbol (quoteSummary + /timeseries).
// The Worker's per-IP cap is 20 req / 60s, bypassed for batch-authenticated
// requests (X-KV-Batch-Key, set from KV_BATCH_KEY — same secret the CI screen
// refreshes use). Keyed: 3.3s spacing. Keyless: 6.6s to keep 2 req/symbol
// under the cap — a full run is ~50 min keyless; a single fund's ~30-80
// holdings is a few minutes either way.
const keyed = !!process.env.KV_BATCH_KEY;
const throttleMs = reagg ? 0 : (keyed ? 3300 : 6600);
if (!reagg) console.log(keyed
  ? 'KV_BATCH_KEY set — batch-authenticated, 3.3s throttle.'
  : '⚠ KV_BATCH_KEY not set — keyless run at 6.6s throttle. Set it to go faster.');

const dcfRoot = path.join(__dirname, '..', 'www', 'dcf');
const rankingsPath = path.join(dcfRoot, 'etf-radar', 'etf-rankings.json');
const manifestPath = path.join(dcfRoot, 'etfs', 'manifest.json');
const etfsJsonPath = path.join(__dirname, 'etfs.json');

(async () => {
  const etfsStatic = JSON.parse(fs.readFileSync(etfsJsonPath, 'utf8'));

  if (only) {
    const fund = etfsStatic.find(f => f.slug === only);
    if (!fund) throw new Error(`--only=${only}: no such slug in scripts/etfs.json`);

    const proxyUrl = readProxyUrl();
    const sharedCachePath = path.join(__dirname, '_raw-etf.json');
    const fundCachePath = path.join(__dirname, `_raw-etf-${only}.json`);
    const result = await runEtfRadar({
      injectedUniverse: [fund],
      holdingsDir: path.join(__dirname, 'etf-holdings'),
      overridesPath: path.join(__dirname, 'etf-symbol-overrides.json'),
      rawCachePath: fundCachePath, // a scoped run writes its own partial cache, never the full-run _raw-etf.json (which it would clobber) — it's folded back in below
      proxyUrl,
      log: console.log,
    }, { offline, throttleMs });

    const targetFund = result.funds[0];
    if (!targetFund) throw new Error(`--only=${only}: fund produced no result (crypto-excluded?)`);

    // Fold this fund's freshly-fetched union data into the shared full-run cache
    // so a later `--reagg` sees it — otherwise --reagg marks every holding of a
    // fund added via --only as fetch-failed and its coverage collapses (see
    // scripts/lib/etf/raw-cache.js's header for the SHLD incident this fixes).
    if (fs.existsSync(sharedCachePath) && fs.existsSync(fundCachePath)) {
      try {
        const merged = mergeUnionCache(
          JSON.parse(fs.readFileSync(sharedCachePath, 'utf8')),
          JSON.parse(fs.readFileSync(fundCachePath, 'utf8')),
        );
        fs.writeFileSync(sharedCachePath, JSON.stringify(merged));
        console.log(`Folded ${only}'s union into ${path.basename(sharedCachePath)} (--reagg will now see it)`);
      } catch (e) { console.warn(`⚠ couldn't fold ${only} into the shared cache: ${e.message}`); }
    }

    // Cheap, single batched quote call for EVERY fund's listing ticker (not a
    // re-valuation of anyone else's holdings) so the ranking page's price
    // column stays accurate even though only this one fund was re-run.
    const allTickers = [...new Set(etfsStatic.flatMap(f => (f.listings || []).map(l => l.ticker)))];
    const listingPrices = await fetchQuotesReal(allTickers, proxyUrl);

    const existing = fs.existsSync(rankingsPath)
      ? JSON.parse(fs.readFileSync(rankingsPath, 'utf8'))
      : { asAt: result.asAt, union: { count: 0, fetched: 0, failed: 0 }, cryptoExcluded: [], ranked: [], unranked: [] };
    const { rankingsSlim, fullRanked, fullUnranked } = mergeFundIntoRankings(
      existing, targetFund, etfsStatic, listingPrices, result.asAt,
    );
    fs.mkdirSync(path.dirname(rankingsPath), { recursive: true });
    fs.writeFileSync(rankingsPath, JSON.stringify(rankingsSlim, null, 2) + '\n');
    console.log(`Wrote ${rankingsPath}`);

    // Ranking page (every fund's row, but only this one's holdings/valuation are new).
    fs.writeFileSync(path.join(dcfRoot, 'etf-radar', 'index.html'),
      renderRadarPage({ asAt: result.asAt, rankings: { ranked: fullRanked, unranked: fullUnranked } }, { asAt: result.asAt }).html);
    const screenCss = path.join(__dirname, '..', 'www', 'asx-undervalued', 'style.css');
    fs.writeFileSync(path.join(dcfRoot, 'etf-radar', 'style.css'), fs.readFileSync(screenCss, 'utf8').replace(/\s+$/, '\n'));

    // The target fund's own detail page only. Sisters are computed from the
    // OTHER funds' already-committed holdings snapshots on disk — no fetch.
    const overlapPool = etfsStatic
      .filter(f => f.slug !== only)
      .map(f => ({ slug: f.slug, holdings: (readSnapshot(path.join(__dirname, 'etf-holdings'), f.slug) || {}).rows || [] }))
      .concat([{ slug: only, holdings: (readSnapshot(path.join(__dirname, 'etf-holdings'), only) || {}).rows || [] }]);
    const sisters = sistersFor(only, overlapPool, {});
    const sisterMeta = {};
    for (const f of [...fullRanked, ...fullUnranked]) {
      sisterMeta[f.slug] = { name: f.name, fee: f.fee, lookThroughMos: f.lookThroughMos, tickers: (f.listings || []).map(l => l.ticker) };
    }
    const rankLine = targetFund.ranked ? `${ordinal(fullRanked.find(f => f.slug === only).rank)} of ${fullRanked.length}` : null;
    const { html } = renderEtfPage({ ...targetFund, sisters }, {
      snapshotPrices: fullRanked.concat(fullUnranked).find(f => f.slug === only).snapshotPrices,
      tickerPageIndex: buildTickerPageIndex(), asAt: result.asAt, rankLine, sisterMeta,
    });
    const fundDir = path.join(dcfRoot, 'etfs', only);
    fs.mkdirSync(fundDir, { recursive: true });
    fs.writeFileSync(path.join(fundDir, 'index.html'), html);
    console.log(`Wrote ${path.join(fundDir, 'index.html')}`);

    // Manifest: add-or-replace this fund's entry only.
    const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : [];
    const idx = manifest.findIndex(m => m.slug === only);
    const entry = { slug: only, name: targetFund.name, theme: targetFund.theme, updated: result.asAt };
    if (idx === -1) manifest.push(entry); else manifest[idx] = entry;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    try { require('./generate-stocks-hub.js').generateStocksHub(); } catch (_) { /* no stocks manifest yet */ }

    console.log(`\n=== --only=${only} ${result.asAt} ===`);
    console.log(`${only}: ${targetFund.ranked ? rankLine : 'not ranked'} — `
      + `${targetFund.lookThroughMos != null ? (targetFund.lookThroughMos * 100).toFixed(1) + '%' : '—'} `
      + `cov ${(targetFund.coverage * 100).toFixed(0)}%`);
    if (targetFund.flags && targetFund.flags.length) console.log(`flags: ${targetFund.flags.join(', ')}`);
    return;
  }

  const result = await runEtfRadar({
    universePath: etfsJsonPath,
    holdingsDir: path.join(__dirname, 'etf-holdings'),
    overridesPath: path.join(__dirname, 'etf-symbol-overrides.json'),
    rawCachePath: path.join(__dirname, '_raw-etf.json'),
    proxyUrl: readProxyUrl(),
    log: console.log,
  }, { offline, reagg, throttleMs });

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
