// scripts/fetch-nifty-delta.js
// One-time helper: fetch the NIFTY 500 tickers not already in _raw-nifty.json,
// then merge into _raw-nifty.json so rank-nifty.js --reeval covers all 500.
//
//   node scripts/fetch-nifty-delta.js
const fs = require('node:fs');
const path = require('node:path');
const { fetchSymbol } = require('./fetch-yahoo.js');
const { marketParamsFor } = require('./lib/market.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const THROTTLE_MS = 3200;

function readProxyUrl() {
  const src = fs.readFileSync(path.join(__dirname, '../www/config.js'), 'utf8');
  const m = src.match(/YAHOO_PROXY_URL\s*[:=]\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('Could not find YAHOO_PROXY_URL in www/config.js');
  return m[1];
}

async function main() {
  const rawPath = path.join(__dirname, '_raw-nifty.json');
  if (!fs.existsSync(rawPath)) throw new Error('_raw-nifty.json not found — run node scripts/rank-nifty.js first');

  const cache = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
  const alreadyFetched = new Set(cache.raw.map(d => d.ticker));

  const all500 = JSON.parse(fs.readFileSync(path.join(__dirname, 'nifty500.json'), 'utf8'));
  const delta = all500.filter(t => !alreadyFetched.has(t));

  console.log(`Already cached: ${cache.raw.length} tickers`);
  console.log(`Delta to fetch: ${delta.length} tickers`);
  if (!delta.length) { console.log('Nothing to fetch.'); return; }

  const proxyUrl = readProxyUrl();
  const failed = [];
  let done = 0;
  for (const ticker of delta) {
    const data = await fetchSymbol(ticker, { proxyUrl, retries: 2, backoffMs: 4000 });
    if (data) cache.raw.push(data);
    else failed.push(ticker);
    if (++done % 25 === 0) console.log(`  …${done}/${delta.length}  (failed so far: ${failed.length})`);
    await sleep(THROTTLE_MS);
  }

  if (failed.length) {
    console.log(`\n${failed.length} still missing — cooling 65s then retrying…`);
    await sleep(65000);
    const stillFailed = [];
    for (const ticker of failed) {
      const data = await fetchSymbol(ticker, { proxyUrl, retries: 2, backoffMs: 4000 });
      if (data) cache.raw.push(data);
      else stillFailed.push(ticker);
      await sleep(THROTTLE_MS);
    }
    console.log(`Recovered ${failed.length - stillFailed.length}; unrecoverable: ${stillFailed.join(', ') || '—'}`);
  }

  cache.tickerCount = all500.length;
  fs.writeFileSync(rawPath, JSON.stringify(cache) + '\n');
  console.log(`\nMerged into _raw-nifty.json — total raw entries: ${cache.raw.length} / ${all500.length} tickers`);
  console.log('Next: node scripts/rank-nifty.js --reeval');
}

main().catch(err => { console.error(err); process.exit(1); });
