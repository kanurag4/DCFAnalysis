// scripts/build-nifty500.js
// One-time script: read ind_nifty500list.csv, build scripts/nifty500.json.
// Excludes dummy rows (symbol starts with DUMMY).
// Run: node scripts/build-nifty500.js
const fs = require('node:fs');
const path = require('node:path');

const csv = fs.readFileSync(path.join(__dirname, '..', 'ind_nifty500list.csv'), 'utf8');
const lines = csv.split('\n').slice(1); // skip header
const tickers = [];
for (const line of lines) {
  if (!line.trim()) continue;
  const cols = line.split(',');
  const symbol = cols[2]?.trim();
  if (!symbol || symbol.startsWith('DUMMY')) continue;
  tickers.push(symbol + '.NS');
}
fs.writeFileSync(path.join(__dirname, 'nifty500.json'), JSON.stringify(tickers, null, 2) + '\n');
console.log(`Written nifty500.json — ${tickers.length} tickers`);
