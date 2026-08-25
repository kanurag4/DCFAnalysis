const { test } = require('node:test');
const assert = require('node:assert');
const {
  tallyTickerMargin, mergeMarketTallies, flatten,
} = require('../scripts/lib/sector-margin-tally.js');

test('tallyTickerMargin computes the own multi-year margin for a ticker with enough history', () => {
  const data = {
    industry: 'Gold',
    totalRevenue: 58760000000,
    marketCap: 200e9, // 29% of market cap -- well clear of the near-zero-revenue gate
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
    marketCap: 50e9,
    annualFcfHistory: [{ date: '2024-06-30', value: 1e9 }, { date: '2025-06-30', value: 1.2e9 }],
    annualRevenueHistory: [{ date: '2024-06-30', value: 9e9 }, { date: '2025-06-30', value: 10e9 }],
  };
  const r = tallyTickerMargin(data);
  assert.strictEqual(r.industry, 'Software - Application');
});

test('tallyTickerMargin returns null when there is too little history to average', () => {
  const data = {
    industry: 'Gold', totalRevenue: 1e9, marketCap: 5e9,
    annualFcfHistory: [{ date: '2025-06-30', value: 1e8 }],
    annualRevenueHistory: [{ date: '2025-06-30', value: 1e9 }],
  };
  assert.strictEqual(tallyTickerMargin(data), null);
});

test('tallyTickerMargin returns null when industry is missing', () => {
  assert.strictEqual(tallyTickerMargin({ totalRevenue: 1e9, marketCap: 5e9, annualFcfHistory: [], annualRevenueHistory: [] }), null);
});

test('tallyTickerMargin returns null for a null/undefined data object', () => {
  assert.strictEqual(tallyTickerMargin(null), null);
  assert.strictEqual(tallyTickerMargin(undefined), null);
});

// ── Near-zero-revenue outlier exclusion (2026-08-25) ──
// Real bug found running the ASX screen: VUL.AX ($7.35M revenue against a
// $1.31B market cap, 0.56% ratio) produced a -1361.7% "margin" that
// single-handedly dragged a healthy 16-peer 'Other Industrial Metals &
// Mining' average from a normal positive mix down to -88%. FCF/revenue as a
// margin concept breaks down when revenue is a rounding error relative to
// the company's actual economic size -- a pre-revenue/development-stage
// company, not a genuine cyclical-trough signal. Every real operating
// company in that same peer set sat at >=4.37% revenue/marketCap.

test('tallyTickerMargin excludes a near-zero-revenue-relative-to-market-cap contributor (the VUL.AX case)', () => {
  const data = {
    industry: 'Other Industrial Metals & Mining',
    totalRevenue: 7350000, marketCap: 1309137024, // 0.56% ratio
    annualFcfHistory: [
      { date: '2024-06-30', value: -95000000 },
      { date: '2025-06-30', value: -105000000 },
    ],
    annualRevenueHistory: [
      { date: '2024-06-30', value: 6500000 },
      { date: '2025-06-30', value: 7350000 },
    ],
  };
  assert.strictEqual(tallyTickerMargin(data), null);
});

test('tallyTickerMargin includes a contributor comfortably above the revenue/marketCap floor', () => {
  const data = {
    industry: 'Other Industrial Metals & Mining',
    totalRevenue: 715889984, marketCap: 16395928576, // 4.37% ratio -- LYC.AX's real figures
    annualFcfHistory: [
      { date: '2024-06-30', value: -300000000 },
      { date: '2025-06-30', value: -310000000 },
    ],
    annualRevenueHistory: [
      { date: '2024-06-30', value: 690000000 },
      { date: '2025-06-30', value: 715889984 },
    ],
  };
  const r = tallyTickerMargin(data);
  assert.ok(r !== null);
  assert.strictEqual(r.industry, 'Other Industrial Metals & Mining');
});

test('tallyTickerMargin excludes a contributor when marketCap is missing (fails closed, cannot verify the ratio)', () => {
  const data = {
    industry: 'Gold', totalRevenue: 58760000000, marketCap: null,
    annualFcfHistory: [
      { date: '2023-06-30', value: 11968000000 },
      { date: '2024-06-30', value: 11849000000 },
    ],
    annualRevenueHistory: [
      { date: '2023-06-30', value: 53817000000 },
      { date: '2024-06-30', value: 55658000000 },
    ],
  };
  assert.strictEqual(tallyTickerMargin(data), null);
});

test('tallyTickerMargin respects a custom minRevenueToMarketCapRatio', () => {
  const data = {
    industry: 'Gold', totalRevenue: 100e6, marketCap: 10e9, // 1% ratio
    annualFcfHistory: [
      { date: '2024-06-30', value: 10e6 },
      { date: '2025-06-30', value: 12e6 },
    ],
    annualRevenueHistory: [
      { date: '2024-06-30', value: 95e6 },
      { date: '2025-06-30', value: 100e6 },
    ],
  };
  assert.strictEqual(tallyTickerMargin(data, { minRevenueToMarketCapRatio: 0.02 }), null); // 1% < 2% floor
  assert.ok(tallyTickerMargin(data, { minRevenueToMarketCapRatio: 0.005 }) !== null); // 1% >= 0.5% floor
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
