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
 * @param {Object|null} [indexMeta]   { indexPrice, indexName, indexTicker } — seeds index baseline on first run
 * @param {Object}      [dividendsByTicker]  { [ticker]: totalPerShareAmount } — real ex-div cash over (oldAsAt, asAt]
 * @returns {{ portfolio: Object, sold: Array }}
 */
function computeRebalance(oldPortfolio, oldRows, newRows, allEvaluated, firstSeen, asAt, startingValue, indexMeta, dividendsByTicker = {}) {
  const seedValue = (startingValue != null && startingValue > 0) ? startingValue : STARTING_VALUE;

  // Resolve index fields: preserve existing seed from oldPortfolio; seed now if not yet stored.
  const existingIndexSeed = oldPortfolio && oldPortfolio.indexSeedPrice != null
    ? { indexSeedPrice: oldPortfolio.indexSeedPrice, indexName: oldPortfolio.indexName, indexTicker: oldPortfolio.indexTicker }
    : (indexMeta && indexMeta.indexPrice != null)
      ? { indexSeedPrice: indexMeta.indexPrice, indexName: indexMeta.indexName, indexTicker: indexMeta.indexTicker }
      : null;
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
      portfolio: { value: seedValue, N: newRows.length, asAt, startedAt: asAt, startingValue: seedValue, dividendsTotal: 0, ...existingIndexSeed },
      sold: [],
    };
  }

  const slotValue = oldPortfolio.value / oldPortfolio.N;
  const oldPriceMap = {};
  for (const r of oldRows) oldPriceMap[r.ticker] = r.snapshotPrice;

  let totalPool = 0;
  let periodDividends = 0;
  const sold = [];

  for (const r of oldRows) {
    const oldPrice = oldPriceMap[r.ticker];
    const newPrice = newPriceMap[r.ticker] ?? oldPrice; // fallback: treat as no movement
    const currentValue = slotValue * (newPrice / oldPrice);
    const shares = slotValue / oldPrice;                 // implied shares for this period
    const divCash = shares * (dividendsByTicker[r.ticker] || 0);
    totalPool += currentValue + divCash;
    periodDividends += divCash;

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
      dividendsTotal: +(((oldPortfolio.dividendsTotal || 0) + periodDividends)).toFixed(2),
      ...existingIndexSeed,
    },
    sold,
  };
}

/**
 * Invariant check: portfolio.indexSeedPrice (drives the hero stat's index %) and
 * history[0].indexPrice (drives the chart's day-one baseline) must always be the
 * same number — otherwise the hero card and the timeline chart compute the index's
 * return from two different starting prices and visibly disagree (see CLAUDE.md,
 * "Corrected 2026-07-12", for the incident this guards against).
 * @param {Object|null} portfolio  current portfolio-value.json contents
 * @param {Array}       history    current portfolio-history.json contents
 * @returns {string|null} null if consistent, else a descriptive error message
 */
function checkIndexSeedConsistency(portfolio, history) {
  if (!portfolio || portfolio.indexSeedPrice == null) return null; // no index tracked yet
  if (!Array.isArray(history) || !history.length || history[0].indexPrice == null) return null;
  const seedFromHistory = history[0].indexPrice;
  const diff = Math.abs(portfolio.indexSeedPrice - seedFromHistory);
  if (diff > 0.01) {
    return `indexSeedPrice (${portfolio.indexSeedPrice}) does not match portfolio-history.json[0].indexPrice ` +
      `(${seedFromHistory}) — the hero stat and timeline chart will show conflicting index returns. ` +
      `Reset indexSeedPrice in portfolio-value.json to match history[0].indexPrice.`;
  }
  return null;
}

module.exports = { computeRebalance, checkIndexSeedConsistency, STARTING_VALUE };
