// scripts/build-kospi200.js
// Fetches the KOSPI 200 constituent list from Wikipedia's raw wikitext (no
// Cloudflare protection, unlike marketindex.com.au — a plain fetch works) and
// writes scripts/kospi200.json. Refresh when asked (KOSPI 200 rebalances twice
// yearly, June and December).
//
//   node scripts/build-kospi200.js
const fs = require('node:fs');
const path = require('node:path');
const { parseKospi200Wikitext } = require('./lib/kospi-list.js');

const WIKI_URL = 'https://en.wikipedia.org/w/index.php?title=KOSPI_200&action=raw';

async function main() {
  const res = await fetch(WIKI_URL);
  if (!res.ok) throw new Error(`Wikipedia fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  const tickers = parseKospi200Wikitext(text);
  if (tickers.length < 190) {
    throw new Error(`Only parsed ${tickers.length} tickers — expected close to 200. Wikipedia's table format may have changed; inspect manually before trusting this list.`);
  }
  const outPath = path.join(__dirname, 'kospi200.json');
  fs.writeFileSync(outPath, JSON.stringify(tickers, null, 2) + '\n');
  console.log(`Wrote ${tickers.length} tickers to ${outPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
