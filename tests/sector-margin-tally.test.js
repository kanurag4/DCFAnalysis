const { test } = require('node:test');
const assert = require('node:assert');
const {
  tallyTickerMargin, mergeMarketTallies, flatten,
} = require('../scripts/lib/sector-margin-tally.js');

test('tallyTickerMargin computes the own multi-year margin for a ticker with enough history', () => {
  const data = {
    industry: 'Gold',
    totalRevenue: 58760000000,
    annualFcfHistory: [
      { date: '2023-06-30', value: 11968000000 },
      { date: '2024-06-30', value: 11849000000 },
    ],
    annualRevenueHistory: [
      { date: '2023-06-30', value: 53817000000 },
      { date: '2024-06-30', value: 55658000000 },
    ],
  };
  const r = tallyTickerMargin(data);
  assert.strictEqual(r.industry, 'Gold');
  assert.ok(r.margin > 0.2 && r.margin < 0.22);
});

test('tallyTickerMargin works for a ticker not tagged cyclical at all -- it does not gate on isCyclical', () => {
  const data = {
    industry: 'Software - Application',
    totalRevenue: 10e9,
    annualFcfHistory: [{ date: '2024-06-30', value: 1e9 }, { date: '2025-06-30', value: 1.2e9 }],
    annualRevenueHistory: [{ date: '2024-06-30', value: 9e9 }, { date: '2025-06-30', value: 10e9 }],
  };
  const r = tallyTickerMargin(data);
  assert.strictEqual(r.industry, 'Software - Application');
});

test('tallyTickerMargin returns null when there is too little history to average', () => {
  const data = {
    industry: 'Gold', totalRevenue: 1e9,
    annualFcfHistory: [{ date: '2025-06-30', value: 1e8 }],
    annualRevenueHistory: [{ date: '2025-06-30', value: 1e9 }],
  };
  assert.strictEqual(tallyTickerMargin(data), null);
});

test('tallyTickerMargin returns null when industry is missing', () => {
  assert.strictEqual(tallyTickerMargin({ totalRevenue: 1e9, annualFcfHistory: [], annualRevenueHistory: [] }), null);
});

test('tallyTickerMargin returns null for a null/undefined data object', () => {
  assert.strictEqual(tallyTickerMargin(null), null);
  assert.strictEqual(tallyTickerMargin(undefined), null);
});

test('mergeMarketTallies aggregates multiple tickers in the same industry into one sum/count', () => {
  const raw = mergeMarketTallies({}, 'asx-undervalued', [
    { industry: 'Gold', margin: 0.10 },
    { industry: 'Gold', margin: 0.20 },
    { industry: 'Steel', margin: -0.05 },
  ]);
  // sum is computed as 0.10 + 0.20 internally, which is 0.30000000000000004
  // in floating point -- assert with a tolerance instead of exact equality.
  assert.ok(Math.abs(raw.Gold['asx-undervalued'].sum - 0.30) < 1e-9);
  assert.strictEqual(raw.Gold['asx-undervalued'].count, 2);
  assert.deepStrictEqual(raw.Steel, { 'asx-undervalued': { sum: -0.05, count: 1 } });
});

test('mergeMarketTallies overwrites only the given market\'s own sub-block, leaving other markets untouched', () => {
  const existing = {
    Gold: {
      'asx-undervalued': { sum: 0.30, count: 2 },
      'sp500-undervalued': { sum: 0.05, count: 1 },
    },
  };
  const raw = mergeMarketTallies(existing, 'asx-undervalued', [{ industry: 'Gold', margin: 0.50 }]);
  assert.deepStrictEqual(raw.Gold, {
    'asx-undervalued': { sum: 0.50, count: 1 }, // this market's re-run replaced its own contribution
    'sp500-undervalued': { sum: 0.05, count: 1 }, // untouched
  });
});

test('mergeMarketTallies ignores null entries from tallyTickerMargin (tickers with too little history)', () => {
  const raw = mergeMarketTallies({}, 'asx-undervalued', [{ industry: 'Gold', margin: 0.1 }, null, null]);
  assert.deepStrictEqual(raw, { Gold: { 'asx-undervalued': { sum: 0.1, count: 1 } } });
});

test('flatten computes a peer-pooled average across markets for each industry', () => {
  const raw = {
    Gold: {
      'asx-undervalued': { sum: 0.30, count: 2 },
      'sp500-undervalued': { sum: 0.10, count: 1 },
    },
    Steel: { 'nifty-undervalued': { sum: -0.09, count: 3 } },
  };
  const flat = flatten(raw);
  assert.deepStrictEqual(flat, {
    Gold: { avgMargin: 0.4 / 3, peerCount: 3 },
    Steel: { avgMargin: -0.03, peerCount: 3 },
  });
});

test('flatten omits an industry with zero total peers rather than dividing by zero', () => {
  const flat = flatten({ Gold: {} });
  assert.deepStrictEqual(flat, {});
});
