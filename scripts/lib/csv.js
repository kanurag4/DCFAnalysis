// scripts/lib/csv.js
// Pure: parse a marketindex-style CSV (first column = ASX code) into
// de-duplicated Yahoo tickers with the .AX suffix. Header row is skipped.
function csvToTickers(csvText) {
  const lines = String(csvText).split(/\r?\n/).filter(l => l.trim() !== '');
  const seen = new Set();
  const out = [];
  for (let i = 1; i < lines.length; i++) {            // skip header
    const code = (lines[i].split(',')[0] || '').trim().toUpperCase();
    if (!code) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(`${code}.AX`);
  }
  return out;
}

module.exports = { csvToTickers };
