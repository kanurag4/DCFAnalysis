// scripts/lib/portfolio.js
// Pure: compute portfolio rebalance after a full-fetch batch run.
// Called only during full-fetch runs (not --rerank or --reeval).
const STARTING_VALUE = 10000;

/**
 * @param {Object|null} oldPortfolio  { value, N, asAt, startedAt } or null on first run
 * @param {Array}       oldRows       previous rankings rows { ticker, snapshotPrice }
 * @param {Array}       newRows       new top-N rows { ticker, snapshotPrice }
 * @param {Array}       allEvaluated  full evaluated set from this batch { ticker, snapshotPrice }
 * @param {Object}      firstSeen     { [ticker]: { firstSeen, firstPrice } }
 * @param {string}      asAt          YYYY-MM-DD date of this batch run
 * @param {number}      [startingValue]  initial portfolio value for first run (default: STARTING_VALUE)
 * @returns {{ portfolio: Object, sold: Array }}
 */
function computeRebalance(oldPortfolio, oldRows, newRows, allEvaluated, firstSeen, asAt, startingValue) {
  const seedValue = (startingValue != null && startingValue > 0) ? startingValue : STARTING_VALUE;
  const newTickers = new Set(newRows.map(r => r.ticker));

  // Build a price lookup for leaver stocks from the full evaluated set
  const newPriceMap = {};
  for (const e of allEvaluated) {
    if (e.ticker && e.snapshotPrice != null && e.snapshotPrice > 0) {
      newPriceMap[e.ticker] = e.snapshotPrice;
    }
  }
  // New ranked rows are always authoritative
  for (const r of newRows) newPriceMap[r.ticker] = r.snapshotPrice;

  // First run — nothing to rebalance from
  if (!oldPortfolio || oldPortfolio.N === 0 || !oldRows.length) {
    return {
      portfolio: { value: seedValue, N: newRows.length, asAt, startedAt: asAt, startingValue: seedValue },
      sold: [],
    };
  }

  const slotValue = oldPortfolio.value / oldPortfolio.N;
  const oldPriceMap = {};
  for (const r of oldRows) oldPriceMap[r.ticker] = r.snapshotPrice;

  let totalPool = 0;
  const sold = [];

  for (const r of oldRows) {
    const oldPrice = oldPriceMap[r.ticker];
    const newPrice = newPriceMap[r.ticker] ?? oldPrice; // fallback: treat as no movement
    const currentValue = slotValue * (newPrice / oldPrice);
    totalPool += currentValue;

    if (!newTickers.has(r.ticker)) {
      const fs = firstSeen[r.ticker] || {};
      sold.push({
        ticker: r.ticker,
        entryDate: fs.firstSeen || oldPortfolio.asAt,
        entryPrice: +(fs.firstPrice != null ? fs.firstPrice : oldPrice).toFixed(4),
        exitDate: asAt,
        exitPrice: +newPrice.toFixed(4),
      });
    }
  }

  return {
    portfolio: {
      value: +totalPool.toFixed(2),
      N: newRows.length,
      asAt,
      startedAt: oldPortfolio.startedAt || oldPortfolio.asAt,
      startingValue: oldPortfolio.startingValue || STARTING_VALUE,
    },
    sold,
  };
}

module.exports = { computeRebalance, STARTING_VALUE };
