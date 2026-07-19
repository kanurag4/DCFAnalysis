// scripts/build-nikkei225.js
// Fetches the Nikkei 225 constituent list from Wikipedia's raw wikitext (same
// technique as build-kospi200.js — a plain fetch works, no browser needed) and
// writes scripts/nikkei225.json. Refresh when asked (Nikkei 225 reviews
// constituents once a year, with occasional extraordinary replacements).
//
//   node scripts/build-nikkei225.js
const fs = require('node:fs');
const path = require('node:path');
const { parseNikkei225Wikitext } = require('./lib/nikkei-list.js');

const WIKI_URL = 'https://en.wikipedia.org/w/index.php?title=Nikkei_225&action=raw';

async function main() {
  const res = await fetch(WIKI_URL);
  if (!res.ok) throw new Error(`Wikipedia fetch failed: HTTP ${res.status}`);
  const text = await res.text();
  const tickers = parseNikkei225Wikitext(text);
  if (tickers.length < 215 || tickers.length > 230) {
    throw new Error(`Parsed ${tickers.length} tickers — expected close to 225. Wikipedia's list format may have changed; inspect manually before trusting this list.`);
  }
  const outPath = path.join(__dirname, 'nikkei225.json');
  fs.writeFileSync(outPath, JSON.stringify(tickers, null, 2) + '\n');
  console.log(`Wrote ${tickers.length} tickers to ${outPath}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
