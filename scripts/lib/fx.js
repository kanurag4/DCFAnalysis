// scripts/lib/fx.js
// Pure: convert native-currency prices into EUR "shadow" units, used ONLY by
// updatePortfolio() (run-screen.js) to blend GBP and EUR positions into one
// EUR-denominated paper portfolio for the Europe screen. Ranking (margin of
// safety is a %) and on-page display (each row shows its own native currency
// via app.js) never call into this module -- only the portfolio rebalance does.
//
// Yahoo quotes UK-listed prices in PENCE (currency 'GBp'), not pounds -- divide
// by 100 before applying the GBP/EUR rate. gbpEurRate is EUR per 1 GBP (e.g.
// 1.17 means £1 = €1.17).
function toEurPrice(price, currency, gbpEurRate) {
  if (price == null || !isFinite(price) || gbpEurRate == null) return price;
  if (currency === 'GBp') return +((price / 100) * gbpEurRate).toFixed(6);
  if (currency === 'GBP') return +(price * gbpEurRate).toFixed(6);
  return price; // EUR, or an unrecognised currency -- leave unconverted
}

// Shallow-copies `rows`, replacing snapshotPrice with its EUR equivalent.
// `currencyByTicker` is a { [ticker]: currency } lookup (rows passed into this
// module do not reliably carry their own `.currency` -- see prepareEurRebalanceInputs).
// Returns `rows` unchanged (same array) if gbpEurRate is null -- this run's FX
// fetch failed, so callers fall back to native-currency ratio math rather than
// blocking the batch (same best-effort contract as /timeseries elsewhere in this codebase).
function toEurRows(rows, currencyByTicker, gbpEurRate) {
  if (gbpEurRate == null) return rows;
  return rows.map(r => ({
    ...r,
    snapshotPrice: toEurPrice(r.snapshotPrice, currencyByTicker[r.ticker], gbpEurRate),
  }));
}

// Converts first-seen.json's firstPrice per ticker. Uses the CURRENT run's rate
// (not the true historical rate at first-seen time, which isn't persisted) --
// an accepted approximation that only affects the DISPLAYED entryPrice on a
// newly-sold stock's ledger entry, not the dollarPnl figure (which uses
// oldFx/newFx correctly via the pre-converted oldRows/newRows -- see
// prepareEurRebalanceInputs).
function toEurFirstSeen(firstSeen, currencyByTicker, gbpEurRate) {
  if (gbpEurRate == null) return firstSeen;
  const out = {};
  for (const [ticker, entry] of Object.entries(firstSeen)) {
    out[ticker] = entry.firstPrice != null
      ? { ...entry, firstPrice: toEurPrice(entry.firstPrice, currencyByTicker[ticker], gbpEurRate) }
      : entry;
  }
  return out;
}

// Orchestrates the three conversions above for one full-fetch run's rebalance
// call. oldRows are priced at oldFx (the rate persisted in last run's
// rankings.json); newRows/allEvaluated are priced at newFx (this run's fetch).
// Using DIFFERENT rates for old vs new is the whole point -- it is what lets a
// GBP position's contribution to the EUR pool reflect real currency drift
// between rebalances, not just the stock's own native-currency return.
// No-ops (returns every input unchanged) when either rate is unavailable.
function prepareEurRebalanceInputs({ oldRows, newRows, allEvaluated, firstSeen, oldFx, newFx }) {
  if (oldFx == null || newFx == null) return { oldRows, newRows, allEvaluated, firstSeen };
  const currencyByTicker = {};
  for (const r of oldRows) if (r.ticker && r.currency) currencyByTicker[r.ticker] = r.currency;
  for (const r of allEvaluated) if (r.ticker && r.currency) currencyByTicker[r.ticker] = r.currency;
  return {
    oldRows: toEurRows(oldRows, currencyByTicker, oldFx),
    newRows: toEurRows(newRows, currencyByTicker, newFx),
    allEvaluated: toEurRows(allEvaluated, currencyByTicker, newFx),
    firstSeen: toEurFirstSeen(firstSeen, currencyByTicker, newFx),
  };
}

module.exports = { toEurPrice, toEurRows, toEurFirstSeen, prepareEurRebalanceInputs };
