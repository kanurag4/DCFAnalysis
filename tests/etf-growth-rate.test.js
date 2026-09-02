const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lookThroughGrowth, seriesCagr, oneYearFallback } = require('../scripts/lib/etf/growth-rate.js');

test('seriesCagr: compound rate over the span (>= 3 points)', () => {
  assert.ok(Math.abs(seriesCagr([{ value: 100 }, { value: 200 }, { value: 400 }]) - 1.0) < 1e-9); // span 2, x4 -> 100%/yr
  assert.ok(Math.abs(seriesCagr([100, 110, 121]) - 0.10) < 1e-9);                                 // bare numbers, span 2
});

test('seriesCagr: span comes from dates, not point count, when present', () => {
  // 3 points but the outer dates are 3 years apart -> 3-year CAGR, not 2
  const r = seriesCagr([{ date: '2022', value: 100 }, { date: '2024', value: 150 }, { date: '2025', value: 200 }]);
  assert.ok(Math.abs(r - (Math.pow(2, 1 / 3) - 1)) < 1e-9);
});

test('seriesCagr: null for < 3 points, < 2-year span, or a non-positive endpoint', () => {
  assert.equal(seriesCagr([{ value: 100 }, { value: 121 }]), null);      // only 2 points
  assert.equal(seriesCagr([]), null);
  assert.equal(seriesCagr([{ value: -5 }, { value: 10 }, { value: 20 }]), null); // negative first endpoint
  assert.equal(seriesCagr([{ value: 10 }, { value: 15 }, { value: 0 }]), null);  // zero last endpoint
  assert.equal(seriesCagr([{ date: '2025', value: 1 }, { date: '2025', value: 1 }, { date: '2025', value: 1 }]), null); // 0-year span
});

test('lookThroughGrowth: the slower of revenue vs FCF CAGR', () => {
  const data = {
    annualRevenueHistory: [{ value: 324 }, { value: 372 }, { value: 400 }, { value: 448 }],
    annualFcfHistory: [{ value: 23.4 }, { value: 25.7 }, { value: 20.7 }, { value: 16.1 }],
  };
  const g = lookThroughGrowth(data);
  assert.ok(g < 0 && g > -0.15, `expected a mild negative, got ${g}`);
});

test('lookThroughGrowth: genuine hypergrowth clamps at +15% (re-aligned 2026-09-02 to the shared deriveMultiYearGrowth, which clamps internally -- previously left unclamped for the caller)', () => {
  const data = {
    annualRevenueHistory: [{ value: 27 }, { value: 61 }, { value: 130 }, { value: 216 }],
    annualFcfHistory: [{ value: 3.8 }, { value: 27 }, { value: 61 }, { value: 97 }],
  };
  assert.strictEqual(lookThroughGrowth(data), 0.15);
});

test('lookThroughGrowth: falls back to min(1-yr rev, earn) with too little history', () => {
  assert.ok(Math.abs(lookThroughGrowth({ revenueGrowth: 0.004, earningsGrowth: 0.615 }) - 0.004) < 1e-9);
  // 2-point history is not enough -> falls through to the 1-year figure
  assert.ok(Math.abs(lookThroughGrowth({
    annualRevenueHistory: [{ value: 100 }, { value: 200 }], revenueGrowth: 0.03, earningsGrowth: 0.05,
  }) - 0.03) < 1e-9);
});

test('lookThroughGrowth: 0.05 default with nothing at all', () => {
  assert.equal(lookThroughGrowth({}), 0.05);
  assert.equal(lookThroughGrowth(null), 0.05);
});
