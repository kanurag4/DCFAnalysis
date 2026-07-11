const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeRebalance, checkIndexSeedConsistency, STARTING_VALUE } = require('../scripts/lib/portfolio.js');

describe('computeRebalance', () => {
  it('first run: returns $10K, correct N, no sold entries', () => {
    const { portfolio, sold } = computeRebalance(
      null, [],
      [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }],
      [], {}, '2026-06-01'
    );
    assert.equal(portfolio.value, STARTING_VALUE);
    assert.equal(portfolio.N, 2);
    assert.equal(portfolio.asAt, '2026-06-01');
    assert.equal(portfolio.startedAt, '2026-06-01');
    assert.deepEqual(sold, []);
  });

  it('no leavers: portfolio grows by weighted price movement', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 11 }, { ticker: 'BBB', snapshotPrice: 22 }];
    const { portfolio, sold } = computeRebalance(oldPortfolio, oldRows, newRows, [], {}, '2026-07-01');
    // each slot $5000; AAA +10% = $5500, BBB +10% = $5500 → $11000
    assert.equal(portfolio.value, 11000);
    assert.equal(portfolio.N, 2);
    assert.equal(portfolio.startedAt, '2026-06-01'); // preserved
    assert.deepEqual(sold, []);
  });

  it('one leaver: proceeds pooled, entry/exit recorded from firstSeen', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 12 }, { ticker: 'CCC', snapshotPrice: 5 }];
    const allEvaluated = [{ ticker: 'BBB', snapshotPrice: 18 }];
    const firstSeen = { BBB: { firstSeen: '2026-05-01', firstPrice: 19 } };
    const { portfolio, sold } = computeRebalance(oldPortfolio, oldRows, newRows, allEvaluated, firstSeen, '2026-07-01');
    // AAA: 5000*(12/10)=6000; BBB: 5000*(18/20)=4500 → total 10500
    assert.equal(portfolio.value, 10500);
    assert.equal(portfolio.N, 2);
    assert.equal(sold.length, 1);
    assert.equal(sold[0].ticker, 'BBB');
    assert.equal(sold[0].entryDate, '2026-05-01');
    assert.equal(sold[0].entryPrice, 19);
    assert.equal(sold[0].exitDate, '2026-07-01');
    assert.equal(sold[0].exitPrice, 18);
  });

  it('leaver with no price in allEvaluated: uses old price (factor 1)', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'CCC', snapshotPrice: 5 }];
    const { portfolio, sold } = computeRebalance(oldPortfolio, oldRows, newRows, [], {}, '2026-07-01');
    // BBB: no new price → factor 1 → $5000; AAA: no change → $5000; total $10000
    assert.equal(portfolio.value, 10000);
    assert.equal(sold[0].exitPrice, 20);
  });

  it('portfolio declines when prices fall', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 9 }, { ticker: 'BBB', snapshotPrice: 18 }];
    const { portfolio, sold } = computeRebalance(oldPortfolio, oldRows, newRows, [], {}, '2026-07-01');
    // AAA: 5000*0.9=4500; BBB: 5000*0.9=4500 → 9000
    assert.equal(portfolio.value, 9000);
    assert.deepEqual(sold, []);
  });

  it('leaver dollarPnl: final-period slot P&L, not cumulative since entryDate', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 12 }, { ticker: 'CCC', snapshotPrice: 5 }];
    const allEvaluated = [{ ticker: 'BBB', snapshotPrice: 18 }];
    // BBB firstSeen far earlier at $19, but dollarPnl uses THIS period's slot ($5000) and
    // price move ($20 → $18), not the firstSeen price.
    const firstSeen = { BBB: { firstSeen: '2026-05-01', firstPrice: 19 } };
    const { sold } = computeRebalance(oldPortfolio, oldRows, newRows, allEvaluated, firstSeen, '2026-07-01');
    // slot $5000; currentValue = 5000*(18/20) = 4500; dollarPnl = 4500 - 5000 = -500
    assert.equal(sold[0].dollarPnl, -500);
  });

  it('leaver dollarPnl includes final-period dividends', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'CCC', snapshotPrice: 5 }];
    const allEvaluated = [{ ticker: 'BBB', snapshotPrice: 20 }];
    // BBB flat price, but pays $0.40/share → 250 shares × $0.40 = $100 dividend.
    const { sold } = computeRebalance(
      oldPortfolio, oldRows, newRows, allEvaluated, {}, '2026-07-01', undefined, null, { BBB: 0.4 }
    );
    assert.equal(sold[0].dollarPnl, 100);
  });

  it('leaver with no firstSeen entry: falls back to oldPortfolio.asAt + old price', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'CCC', snapshotPrice: 5 }];
    const { sold } = computeRebalance(oldPortfolio, oldRows, newRows, [], {}, '2026-07-01');
    assert.equal(sold[0].entryDate, '2026-06-01');
    assert.equal(sold[0].entryPrice, 20);
  });

  it('first run with custom startingValue: seeds value and startingValue correctly', () => {
    const { portfolio, sold } = computeRebalance(
      null, [],
      [{ ticker: 'AAA', snapshotPrice: 100 }, { ticker: 'BBB', snapshotPrice: 200 }],
      [], {}, '2026-06-05', 100000
    );
    assert.equal(portfolio.value, 100000);
    assert.equal(portfolio.startingValue, 100000);
    assert.equal(portfolio.N, 2);
    assert.deepEqual(sold, []);
  });

  it('startingValue is preserved through subsequent rebalances', () => {
    const oldPortfolio = { value: 100000, N: 2, asAt: '2026-06-05', startedAt: '2026-06-05', startingValue: 100000 };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 100 }, { ticker: 'BBB', snapshotPrice: 200 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 110 }, { ticker: 'BBB', snapshotPrice: 220 }];
    const { portfolio } = computeRebalance(oldPortfolio, oldRows, newRows, [], {}, '2026-07-05');
    assert.equal(portfolio.startingValue, 100000);
    assert.equal(portfolio.value, 110000); // both up 10%
  });

  it('first run with indexMeta: seeds indexSeedPrice, indexName, indexTicker', () => {
    const { portfolio } = computeRebalance(
      null, [],
      [{ ticker: 'AAA', snapshotPrice: 10 }],
      [], {}, '2026-06-19', undefined,
      { indexPrice: 8200.5, indexName: 'ASX 200', indexTicker: '^AXJO' }
    );
    assert.equal(portfolio.indexSeedPrice, 8200.5);
    assert.equal(portfolio.indexName, 'ASX 200');
    assert.equal(portfolio.indexTicker, '^AXJO');
  });

  it('subsequent run: preserves indexSeedPrice from oldPortfolio (not overwritten by new indexMeta)', () => {
    const oldPortfolio = { value: 10000, N: 1, asAt: '2026-06-19', startedAt: '2026-06-19', startingValue: 10000, indexSeedPrice: 8200.5, indexName: 'ASX 200', indexTicker: '^AXJO' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 11 }];
    const { portfolio } = computeRebalance(
      oldPortfolio, oldRows, newRows, [], {}, '2026-07-19', undefined,
      { indexPrice: 8500, indexName: 'ASX 200', indexTicker: '^AXJO' }
    );
    assert.equal(portfolio.indexSeedPrice, 8200.5); // original seed preserved
    assert.equal(portfolio.indexName, 'ASX 200');
  });

  it('first run without indexMeta: no index fields in portfolio', () => {
    const { portfolio } = computeRebalance(
      null, [],
      [{ ticker: 'AAA', snapshotPrice: 10 }],
      [], {}, '2026-06-19'
    );
    assert.equal(portfolio.indexSeedPrice, undefined);
    assert.equal(portfolio.indexName, undefined);
  });

  it('first run: dividendsTotal is 0', () => {
    const { portfolio } = computeRebalance(
      null, [],
      [{ ticker: 'AAA', snapshotPrice: 10 }],
      [], {}, '2026-06-01'
    );
    assert.equal(portfolio.dividendsTotal, 0);
  });

  it('credits dividends: pool rises by shares × per-share amount', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    // AAA pays $0.50/share. Slot $5000 / $10 = 500 shares → $250 dividend cash.
    const divs = { AAA: 0.5 };
    const { portfolio } = computeRebalance(
      oldPortfolio, oldRows, newRows, [], {}, '2026-07-01', undefined, null, divs
    );
    assert.equal(portfolio.value, 10250);       // 10000 price-flat + 250 dividends
    assert.equal(portfolio.dividendsTotal, 250);
  });

  it('dividendsTotal accumulates across rebalances', () => {
    const oldPortfolio = { value: 10000, N: 1, asAt: '2026-06-01', startedAt: '2026-06-01', dividendsTotal: 100 };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 10 }];
    // 1000 shares × $0.10 = $100 this period → cumulative 200.
    const { portfolio } = computeRebalance(
      oldPortfolio, oldRows, newRows, [], {}, '2026-07-01', undefined, null, { AAA: 0.1 }
    );
    assert.equal(portfolio.dividendsTotal, 200);
    assert.equal(portfolio.value, 10100);
  });

  it('a leaver still earns its final-period dividends', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'CCC', snapshotPrice: 5 }];
    const allEvaluated = [{ ticker: 'BBB', snapshotPrice: 20 }];
    // BBB leaves; slot $5000 / $20 = 250 shares × $0.40 = $100 dividend before exit.
    const { portfolio, sold } = computeRebalance(
      oldPortfolio, oldRows, newRows, allEvaluated, {}, '2026-07-01', undefined, null, { BBB: 0.4 }
    );
    assert.equal(portfolio.value, 10100);
    assert.equal(portfolio.dividendsTotal, 100);
    assert.equal(sold[0].ticker, 'BBB');
  });

  it('omitting dividendsByTicker is byte-identical to no dividends', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 11 }, { ticker: 'BBB', snapshotPrice: 22 }];
    const { portfolio } = computeRebalance(oldPortfolio, oldRows, newRows, [], {}, '2026-07-01');
    assert.equal(portfolio.value, 11000);
    assert.equal(portfolio.dividendsTotal, 0);
  });
});

describe('checkIndexSeedConsistency', () => {
  it('returns null when indexSeedPrice matches history[0].indexPrice', () => {
    const portfolio = { indexSeedPrice: 8686.1 };
    const history = [{ date: '2026-06-04', indexPrice: 8686.1 }];
    assert.equal(checkIndexSeedConsistency(portfolio, history), null);
  });

  it('returns an error string when they diverge (the 2026-07-12 incident)', () => {
    const portfolio = { indexSeedPrice: 8911.1 };
    const history = [{ date: '2026-06-04', indexPrice: 8686.1 }];
    const error = checkIndexSeedConsistency(portfolio, history);
    assert.match(error, /does not match/);
  });

  it('returns null when the index is not tracked yet', () => {
    assert.equal(checkIndexSeedConsistency({}, []), null);
    assert.equal(checkIndexSeedConsistency(null, []), null);
    assert.equal(checkIndexSeedConsistency({ indexSeedPrice: 100 }, []), null);
  });

  it('tolerates float rounding noise', () => {
    const portfolio = { indexSeedPrice: 8686.10 };
    const history = [{ date: '2026-06-04', indexPrice: 8686.1000001 }];
    assert.equal(checkIndexSeedConsistency(portfolio, history), null);
  });
});
