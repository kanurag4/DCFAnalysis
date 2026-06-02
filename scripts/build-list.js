// scripts/build-list.js
// Usage: node scripts/build-list.js <path-to-marketindex.csv>
// Writes scripts/asx300.json. Refresh quarterly (index reconstitutes).
const fs = require('node:fs');
const path = require('node:path');
const { csvToTickers } = require('./lib/csv.js');

const inPath = process.argv[2];
if (!inPath) { console.error('Usage: node scripts/build-list.js <marketindex.csv>'); process.exit(1); }
const tickers = csvToTickers(fs.readFileSync(inPath, 'utf8'));
const outPath = path.join(__dirname, 'asx300.json');
fs.writeFileSync(outPath, JSON.stringify(tickers, null, 2) + '\n');
console.log(`Wrote ${tickers.length} tickers to ${outPath}`);
