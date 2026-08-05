const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeRefreshSummary, MOVERS_LIMIT } = require('../scripts/lib/refresh-report.js');

function entry(overrides) {
  return { ticker: 'X', slug: 'x', name: 'X Inc', sector: 'Tech', method: 'DCF', intrinsic: 10, price: 8, marginOfSafety: 0.25, updated: '2026-08-01', ...overrides };
}

test('written/skipped/total counts', () => {
  const oldMap = new Map([['A', entry({ ticker: 'A' })], ['B', entry({ ticker: 'B' })]]);
  const results = [
    { status: 'ok', ticker: 'A', market: 'asx', entry: entry({ ticker: 'A' }) },
    { status: 'skipped', ticker: 'B', market: 'asx', reason: 'fetch failed: HTTP 502' },
  ];
  const s = computeRefreshSummary(oldMap, results);
  assert.equal(s.total, 2);
  assert.equal(s.written, 1);
  assert.equal(s.skipped, 1);
  assert.deepEqual(s.skips, [{ ticker: 'B', market: 'asx', reason: 'fetch failed: HTTP 502' }]);
});

test('flip detected when verdict text changes between old and new', () => {
  const oldMap = new Map([['A', entry({ ticker: 'A', marginOfSafety: 0.25 })]]); // Undervalued
  const results = [{ status: 'ok', ticker: 'A', market: 'asx', entry: entry({ ticker: 'A', marginOfSafety: 0.05 }) }]; // Fairly Valued
  const s = computeRefreshSummary(oldMap, results);
  assert.deepEqual(s.flips, [{ ticker: 'A', market: 'asx', from: 'Undervalued', to: 'Fairly Valued' }]);
});

test('no flip when verdict text is unchanged', () => {
  const oldMap = new Map([['A', entry({ ticker: 'A', marginOfSafety: 0.25 })]]);
  const results = [{ status: 'ok', ticker: 'A', market: 'asx', entry: entry({ ticker: 'A', marginOfSafety: 0.30 }) }]; // still Undervalued
  const s = computeRefreshSummary(oldMap, results);
  assert.deepEqual(s.flips, []);
});

test('an old entry with marginOfSafety null never counts as a flip', () => {
  const oldMap = new Map([['A', entry({ ticker: 'A', marginOfSafety: null })]]);
  const results = [{ status: 'ok', ticker: 'A', market: 'asx', entry: entry({ ticker: 'A', marginOfSafety: 0.25 }) }];
  const s = computeRefreshSummary(oldMap, results);
  assert.deepEqual(s.flips, []);
});

test('movers sorted by absolute delta, largest first', () => {
  const oldMap = new Map([
    ['A', entry({ ticker: 'A', intrinsic: 100 })],
    ['B', entry({ ticker: 'B', intrinsic: 100 })],
  ]);
  const results = [
    { status: 'ok', ticker: 'A', market: 'asx', entry: entry({ ticker: 'A', intrinsic: 110 }) }, // +10%
    { status: 'ok', ticker: 'B', market: 'asx', entry: entry({ ticker: 'B', intrinsic: 70 }) },  // -30%
  ];
  const s = computeRefreshSummary(oldMap, results);
  assert.equal(s.movers.length, 2);
  assert.equal(s.movers[0].ticker, 'B');
  assert.equal(Math.round(s.movers[0].intrinsicDeltaPct), -30);
  assert.equal(s.movers[1].ticker, 'A');
  assert.equal(Math.round(s.movers[1].intrinsicDeltaPct), 10);
});

test('movers list is capped at MOVERS_LIMIT', () => {
  const oldMap = new Map();
  const results = [];
  for (let i = 0; i < MOVERS_LIMIT + 5; i++) {
    const ticker = `T${i}`;
    oldMap.set(ticker, entry({ ticker, intrinsic: 100 }));
    results.push({ status: 'ok', ticker, market: 'asx', entry: entry({ ticker, intrinsic: 100 + i }) });
  }
  const s = computeRefreshSummary(oldMap, results);
  assert.equal(s.movers.length, MOVERS_LIMIT);
});

test('no mover recorded when either old or new intrinsic is null', () => {
  const oldMap = new Map([['A', entry({ ticker: 'A', intrinsic: null })]]);
  const results = [{ status: 'ok', ticker: 'A', market: 'asx', entry: entry({ ticker: 'A', intrinsic: 50 }) }];
  const s = computeRefreshSummary(oldMap, results);
  assert.deepEqual(s.movers, []);
});

test('a ticker with no prior manifest entry contributes to written count but no flip/mover', () => {
  const oldMap = new Map(); // empty -- ticker not previously in the manifest
  const results = [{ status: 'ok', ticker: 'NEW', market: 'asx', entry: entry({ ticker: 'NEW' }) }];
  const s = computeRefreshSummary(oldMap, results);
  assert.equal(s.written, 1);
  assert.deepEqual(s.flips, []);
  assert.deepEqual(s.movers, []);
});
