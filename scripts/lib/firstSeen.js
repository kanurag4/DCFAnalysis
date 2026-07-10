// scripts/lib/firstSeen.js
// Pure: merge newly-ranked rows into the persistent first-seen ledger.
// A ticker continuously on the list keeps its original firstSeen/firstPrice.
// A ticker that dropped off and has now come back is treated as a fresh
// entry — resetting to today's date/price — because it does not represent
// a continuous holding period (it was sold in between; see sold.json).
// `oldTickers` is the set of tickers on the immediately-prior *published*
// cycle (a Set); omit it (or pass an empty Set) to treat every already-known
// ticker as a reentry (always reset) — callers that want the old
// "never overwrite" behaviour must pass every ticker as continuing.
function mergeFirstSeen(ledger, rows, asAt, oldTickers = new Set()) {
  const out = { ...ledger };
  for (const r of rows) {
    const isKnown = !!out[r.ticker];
    const isContinuing = isKnown && oldTickers.has(r.ticker);
    if (!isKnown || !isContinuing) {
      out[r.ticker] = { firstSeen: asAt, firstPrice: r.snapshotPrice };
    }
  }
  return out;
}

module.exports = { mergeFirstSeen };
