// scripts/build-sp500.js
// Usage: node scripts/build-sp500.js <raw-ticker-list.txt>
// Reads a comma/whitespace-separated S&P 500 ticker list (e.g. pasted from
// stockanalysis.com/list/sp-500-stocks/), normalizes it, writes scripts/sp500.json.
// Refresh manually when the index reconstitutes.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeUsTickers } = require('./lib/sp500-list.js');

const inPath = process.argv[2];
if (!inPath) { console.error('Usage: node scripts/build-sp500.js <raw-ticker-list.txt>'); process.exit(1); }
const tickers = normalizeUsTickers(fs.readFileSync(inPath, 'utf8'));
const outPath = path.join(__dirname, 'sp500.json');
fs.writeFileSync(outPath, JSON.stringify(tickers, null, 2) + '\n');
console.log(`Wrote ${tickers.length} tickers to ${outPath}`);
