const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lookThroughGrowth, seriesCagr, oneYearFallback } = require('../scripts/lib/etf/growth-rate.js');

test('seriesCagr: compound rate over the span', () => {
  assert.ok(Math.abs(seriesCagr([{ value: 100 }, { value: 121 }]) - 0.21) < 1e-9);        // span 1 -> +21%
  assert.ok(Math.abs(seriesCagr([{ value: 100 }, { value: 200 }, { value: 400 }]) - 1.0) < 1e-9); // span 2, x4 -> 100%/yr
});

test('seriesCagr: null when fewer than 2 points or a non-positive endpoint', () => {
  assert.equal(seriesCagr([{ value: 100 }]), null);
  assert.equal(seriesCagr([]), null);
  assert.equal(seriesCagr([{ value: -5 }, { value: 10 }]), null);
  assert.equal(seriesCagr([{ value: 10 }, { value: 0 }]), null);
});

test('seriesCagr: accepts a bare number array', () => {
  assert.ok(Math.abs(seriesCagr([100, 110]) - 0.10) < 1e-9);
});

test('lookThroughGrowth: the slower of revenue vs FCF CAGR', () => {
  // revenue grows ~11%/yr, FCF shrinks ~-11%/yr -> use the FCF trend
  const data = {
    annualRevenueHistory: [{ value: 324 }, { value: 372 }, { value: 400 }, { value: 448 }],
    annualFcfHistory: [{ value: 23.4 }, { value: 25.7 }, { value: 20.7 }, { value: 16.1 }],
  };
  const g = lookThroughGrowth(data);
  assert.ok(g < 0 && g > -0.15, `expected a mild negative, got ${g}`);
});

test('lookThroughGrowth: genuine hypergrowth survives (caller clamps)', () => {
  const data = {
    annualRevenueHistory: [{ value: 27 }, { value: 61 }, { value: 130 }, { value: 216 }],
    annualFcfHistory: [{ value: 3.8 }, { value: 27 }, { value: 61 }, { value: 97 }],
  };
  assert.ok(lookThroughGrowth(data) > 0.5); // ~100%/yr, left for the [-0.05,0.25] clamp
});

test('lookThroughGrowth: falls back to min(1-yr rev, earn) without history', () => {
  assert.ok(Math.abs(lookThroughGrowth({ revenueGrowth: 0.004, earningsGrowth: 0.615 }) - 0.004) < 1e-9);
});

test('lookThroughGrowth: 0.05 default with nothing at all', () => {
  assert.equal(lookThroughGrowth({}), 0.05);
  assert.equal(lookThroughGrowth(null), 0.05);
});
