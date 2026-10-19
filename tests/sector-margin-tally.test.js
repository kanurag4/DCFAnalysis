const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { isCyclical } = require('../www/utils.js');
const {
  tallyTickerMargin, buildSlice, flatten, median, rebuildLookup, updateSectorMarginLookup, INDUSTRY_MARKETS,
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

// ── Margin floor (2026-10-19) ──
// WBT.AX sat at 1.95% revenue/marketCap on 2026-10-19 -- just under the 2% ratio guard, so it got in on any
// run where its share price was a little lower. Its own yearly "margins" ran -2498% to -127%. Together with
// SLX.AX it dragged the Semiconductors lookup to -293%, which made MU's normalized FCF -$390B.
const WBT_LIKE = {
  ticker: 'WBT.AX', industry: 'Semiconductors',
  totalRevenue: 15276000, marketCap: 700e6, // 2.18%: clears the ratio guard
  annualFcfHistory: [
    { date: '2024-06-30', value: -25422826 }, { date: '2025-06-30', value: -23372311 }, { date: '2026-06-30', value: -19471000 },
  ],
  annualRevenueHistory: [
    { date: '2024-06-30', value: 1017788 }, { date: '2025-06-30', value: 4409329 }, { date: '2026-06-30', value: 15276000 },
  ],
};

test('tallyTickerMargin excludes a peer whose own margin is below -100%, even when it clears the ratio guard (WBT.AX)', () => {
  assert.strictEqual(tallyTickerMargin(WBT_LIKE), null);
});

test('tallyTickerMargin keeps a genuinely loss-making operator above the -100% floor (MU-like trough)', () => {
  const data = {
    ticker: 'MU', industry: 'Semiconductors', totalRevenue: 133e9, marketCap: 990e9,
    annualFcfHistory: [{ date: '2023-08-31', value: -6117000000 }, { date: '2024-08-31', value: 121000000 }],
    annualRevenueHistory: [{ date: '2023-08-31', value: 15540000000 }, { date: '2024-08-31', value: 25111000000 }],
  };
  const r = tallyTickerMargin(data);
  assert.ok(r !== null);
  assert.strictEqual(r.ticker, 'MU');
  assert.ok(r.margin < 0 && r.margin > -1);
});

test('tallyTickerMargin respects a custom minMargin', () => {
  assert.ok(tallyTickerMargin(WBT_LIKE, { minMargin: -20 }) !== null);
});

// ── Slices, median, per-industry market pools ──

test('buildSlice groups by industry, keeps the ticker and drops null tallies', () => {
  const slice = buildSlice([
    { ticker: 'A', industry: 'Gold', margin: 0.1 }, null,
    { ticker: 'B', industry: 'Gold', margin: 0.2 }, { ticker: 'C', industry: 'Steel', margin: -0.05 },
  ], '2026-10-19');
  assert.deepStrictEqual(slice, {
    asAt: '2026-10-19',
    industries: { Gold: [{ ticker: 'A', margin: 0.1 }, { ticker: 'B', margin: 0.2 }], Steel: [{ ticker: 'C', margin: -0.05 }] },
  });
});

test('median handles odd and even counts', () => {
  assert.strictEqual(median([3, -100, 1]), 1);
  assert.strictEqual(median([4, 1, 3, 2]), 2.5);
});

test('flatten pools markets and takes the median, so one extreme peer cannot dominate', () => {
  const slices = {
    'asx-undervalued': { industries: { Gold: [{ margin: 0.10 }, { margin: -9.0 }] } },
    'sp500-undervalued': { industries: { Gold: [{ margin: 0.20 }] } },
  };
  assert.deepStrictEqual(flatten(slices), { Gold: { avgMargin: 0.10, peerCount: 3 } });
});

test('flatten pools Semiconductors from US, KOSPI and Nikkei only -- ASX peers are ignored', () => {
  assert.deepStrictEqual(INDUSTRY_MARKETS.Semiconductors, ['sp500-undervalued', 'kospi-undervalued', 'nikkei-undervalued']);
  const slices = {
    'asx-undervalued': { industries: { Semiconductors: [{ margin: -7.4 }, { margin: -7.5 }], 'Software - Application': [{ margin: 0.3 }] } },
    'kospi-undervalued': { industries: { Semiconductors: [{ margin: 0.05 }, { margin: 0.09 }] } },
    'sp500-undervalued': { industries: { Semiconductors: [{ margin: 0.20 }] } },
  };
  const flat = flatten(slices);
  assert.deepStrictEqual(flat.Semiconductors, { avgMargin: 0.09, peerCount: 3 });
  assert.deepStrictEqual(flat['Software - Application'], { avgMargin: 0.3, peerCount: 1 }); // non-cyclical industries pool every market
});

test('flatten omits an industry with no peers', () => {
  assert.deepStrictEqual(flatten({ 'asx-undervalued': { industries: { Gold: [] } } }), {});
});

test('rebuildLookup reads only the known screen markets, so a fixture slice never leaks into the lookup', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sector-margins-'));
  try {
    updateSectorMarginLookup('kospi-undervalued', [{ ticker: 'X', industry: 'Software - Application', margin: 0.2 }], '2026-10-19', dir);
    const flat = updateSectorMarginLookup('some-test-fixture', [{ ticker: 'Y', industry: 'Software - Application', margin: -0.9 }], '2026-10-19', dir);
    assert.deepStrictEqual(flat, { 'Software - Application': { avgMargin: 0.2, peerCount: 1 } });
    assert.ok(fs.existsSync(path.join(dir, 'some-test-fixture', 'sector-margins-slice.json'))); // slice still written
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(dir, 'sector-margins.json'), 'utf8')), flat);
    assert.deepStrictEqual(rebuildLookup(dir), flat);
    assert.deepStrictEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []); // atomic write left no temp file
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── One methodology for every cyclical industry (2026-10-19) ──
const CYCLICAL_NAMES = ['Gold', 'Silver', 'Copper', 'Steel', 'Coking Coal', 'Thermal Coal', 'Aluminum',
  'Other Industrial Metals & Mining', 'Oil & Gas E&P', 'Oil & Gas Integrated', 'Oil & Gas Equipment & Services',
  'Oil & Gas Refining & Marketing', 'Auto Manufacturers', 'Auto Parts', 'Chemicals', 'Specialty Chemicals',
  'Marine Shipping', 'Semiconductors'];

test('every cyclical industry has an explicit market pool, and every pool is a cyclical industry', () => {
  assert.ok(CYCLICAL_NAMES.every(i => isCyclical('', i)), 'CYCLICAL_NAMES is out of date with www/utils.js');
  assert.deepStrictEqual(Object.keys(INDUSTRY_MARKETS).sort(), [...CYCLICAL_NAMES].sort());
});

test('NIFTY pools only for Autos and Steel; Semiconductors excludes ASX and Europe', () => {
  const withNifty = Object.keys(INDUSTRY_MARKETS).filter(i => INDUSTRY_MARKETS[i].includes('nifty-undervalued')).sort();
  assert.deepStrictEqual(withNifty, ['Auto Manufacturers', 'Auto Parts', 'Steel']);
  assert.ok(!INDUSTRY_MARKETS.Semiconductors.includes('asx-undervalued'));
  assert.ok(!INDUSTRY_MARKETS.Semiconductors.includes('europe-undervalued'));
});

test('flatten leaves out a cyclical industry with no pool instead of pooling every market', () => {
  const slices = { 'asx-undervalued': { industries: { Gold: [{ margin: 0.1 }] } } };
  assert.deepStrictEqual(flatten(slices, {}), {});
});

test('flatten drops a market outside the pool (NIFTY gold peers are ignored)', () => {
  const slices = {
    'asx-undervalued': { industries: { Gold: [{ margin: 0.05 }] } },
    'nifty-undervalued': { industries: { Gold: [{ margin: -0.5 }] } },
  };
  assert.deepStrictEqual(flatten(slices).Gold, { avgMargin: 0.05, peerCount: 1 });
});
