// scripts/lib/firstSeen.js
// Pure: merge newly-ranked rows into the persistent first-seen ledger.
// Existing entries are never overwritten so "first listed at $X on DATE" persists.
function mergeFirstSeen(ledger, rows, asAt) {
  const out = { ...ledger };
  for (const r of rows) {
    if (!out[r.ticker]) {
      out[r.ticker] = { firstSeen: asAt, firstPrice: r.snapshotPrice };
    }
  }
  return out;
}

module.exports = { mergeFirstSeen };
