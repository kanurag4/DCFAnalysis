// scripts/build-europe.js
// Usage: node scripts/build-europe.js <raw-ticker-list.txt>
// Reads a comma/whitespace-separated eurozone+UK ticker list, normalizes it,
// writes scripts/europe200.json. Refresh manually when the underlying
// constituent source (see Task 6) changes.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeEuropeTickers, IN_SCOPE_SUFFIXES } = require('./lib/europe-list.js');

const inPath = process.argv[2];
if (!inPath) { console.error('Usage: node scripts/build-europe.js <raw-ticker-list.txt>'); process.exit(1); }
const { tickers, dropped, duplicates } = normalizeEuropeTickers(fs.readFileSync(inPath, 'utf8'));
const outPath = path.join(__dirname, 'europe200.json');
fs.writeFileSync(outPath, JSON.stringify(tickers, null, 2) + '\n');

// Report what was thrown away, not just what was kept -- a source list where a
// third of the names silently vanished should not look like a clean run.
console.log(`Wrote ${tickers.length} tickers to ${outPath}`);
if (duplicates.length) {
  console.log(`  ${duplicates.length} duplicate(s) collapsed: ${duplicates.join(', ')}`);
}
if (dropped.length) {
  console.log(`  ⚠ ${dropped.length} dropped — no recognised eurozone/UK suffix: ${dropped.join(', ')}`);
  console.log(`    (in scope: ${IN_SCOPE_SUFFIXES.join(' ')})`);
}
