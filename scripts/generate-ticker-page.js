// scripts/generate-ticker-page.js
// CLI wrapper: node scripts/generate-ticker-page.js <TICKER>
// Generates one static, pre-rendered SEO page for a single ticker. See
// scripts/lib/ticker-page.js for the testable implementation shared with the
// bulk refresh batch (scripts/refresh-ticker-pages.js).
//
// Writes www/stocks/<market>/<slug>/index.html — which becomes
// www/dcf/stocks/<market>/<slug>/ once xcopy'd into StockAnalysis, same
// publish step every other screen uses. This script only WRITES a local file;
// it never commits or pushes — that is a separate, explicit step.
//
// NOTE ON FRESHNESS: nothing regenerates a page written by THIS script
// automatically — that's what the bulk refresh (admin console) is for.

const fs = require('fs');
const path = require('path');
const { buildTickerPage, upsertManifestEntry } = require('./lib/ticker-page.js');

function readProxyUrl() {
  if (process.env.YAHOO_PROXY_URL) return process.env.YAHOO_PROXY_URL;
  const src = fs.readFileSync(path.join(__dirname, '..', 'www', 'config.js'), 'utf8');
  const m = src.match(/YAHOO_PROXY_URL\s*[:=]\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('Could not find YAHOO_PROXY_URL in www/config.js');
  return m[1];
}

async function main() {
  const rawTicker = process.argv[2];
  if (!rawTicker) { console.error('Usage: node scripts/generate-ticker-page.js <TICKER>'); process.exit(1); }

  console.log(`Fetching ${rawTicker}...`);
  const proxyUrl = readProxyUrl();
  const outcome = await buildTickerPage(rawTicker, { proxyUrl });

  if (outcome.status === 'skipped') {
    console.error(`Skipped ${outcome.ticker} — ${outcome.reason}`);
    process.exit(1);
  }

  const { html, entry, market } = outcome;
  const outDir = path.join(__dirname, '..', 'www', 'stocks', market.folder, entry.slug);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'index.html');
  fs.writeFileSync(outFile, html);

  const manifestFile = path.join(__dirname, '..', 'www', 'stocks', market.folder, 'manifest.json');
  const manifest = upsertManifestEntry(manifestFile, entry);

  console.log(`\nWrote ${outFile}`);
  console.log(`Method: ${entry.method} | Base verdict intrinsic: ${entry.intrinsic == null ? 'N/A' : entry.intrinsic}`);
  console.log(`Manifest updated: ${manifestFile} (${manifest.length} ticker${manifest.length === 1 ? '' : 's'} in ${market.folder})`);
  console.log(`This file is NOT committed or published — review it locally, then commit/xcopy/deploy explicitly when ready.`);
  console.log(`Run 'node scripts/generate-market-index.js ${market.folder}' to refresh the /dcf/stocks/${market.folder}/ hub page.`);
}

main().catch(err => { console.error(err); process.exit(1); });
