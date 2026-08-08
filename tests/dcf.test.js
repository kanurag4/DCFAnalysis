const assert = require('assert');
const { test } = require('node:test');
const { calculateDCF } = require('../www/calc/dcf.js');

const near = (actual, expected, tol) =>
  assert.ok(Math.abs(actual - expected) <= tol, `Expected ~${expected} ±${tol}, got ${actual}`);

test('basic DCF produces positive intrinsic value', () => {
  const r = calculateDCF({
    fcf: 100e6, growthRate: 0.08, terminalGrowth: 0.03,
    wacc: 0.10, projectionYears: 5,
    totalDebt: 0, totalCash: 0,
    sharesOutstanding: 100e6, currentPrice: 15,
  });
  assert.ok(r !== null);
  assert.ok(r.intrinsicValue > 0);
  assert.ok(r.pvFcfs.length === 5);
  assert.ok(r.pvTerminal > 0);
  near(r.firmValue, r.pvFcfs.reduce((a, b) => a + b, 0) + r.pvTerminal, 1);
});

test('net debt reduces intrinsic value', () => {
  const base = { fcf: 100e6, growthRate: 0.05, terminalGrowth: 0.025, wacc: 0.10, projectionYears: 5, sharesOutstanding: 100e6, currentPrice: 10 };
  const noDebt  = calculateDCF({ ...base, totalDebt: 0,     totalCash: 0 });
  const withDebt = calculateDCF({ ...base, totalDebt: 500e6, totalCash: 100e6 });
  assert.ok(withDebt.intrinsicValue < noDebt.intrinsicValue);
  near(withDebt.netDebt, 400e6, 1);
});

test('terminal value pct exceeds 70% for short projection + low wacc', () => {
  const r = calculateDCF({
    fcf: 100e6, growthRate: 0.02, terminalGrowth: 0.025, wacc: 0.06,
    projectionYears: 3, sharesOutstanding: 100e6, currentPrice: 10,
  });
  assert.ok(r.terminalValuePct > 70, `tv%=${r.terminalValuePct}`);
});

test('returns null when wacc <= terminalGrowth', () => {
  const r = calculateDCF({
    fcf: 100e6, growthRate: 0.05, terminalGrowth: 0.10, wacc: 0.08,
    projectionYears: 5, sharesOutstanding: 100e6, currentPrice: 10,
  });
  assert.strictEqual(r, null);
});

test('returns null when fcf is zero or negative', () => {
  assert.strictEqual(calculateDCF({ fcf: 0,    growthRate: 0.05, terminalGrowth: 0.025, wacc: 0.10, projectionYears: 5, sharesOutstanding: 100e6, currentPrice: 10 }), null);
  assert.strictEqual(calculateDCF({ fcf: -50e6, growthRate: 0.05, terminalGrowth: 0.025, wacc: 0.10, projectionYears: 5, sharesOutstanding: 100e6, currentPrice: 10 }), null);
});

test('CAGR calculations correct', () => {
  const r = calculateDCF({
    fcf: 100e6, growthRate: 0.08, terminalGrowth: 0.03, wacc: 0.10,
    projectionYears: 5, totalDebt: 0, totalCash: 0,
    sharesOutstanding: 100e6, currentPrice: 10,
  });
  near(r.cagr1yr, r.intrinsicValue / 10 - 1, 0.001);
  near(r.cagr3yr, Math.pow(r.intrinsicValue / 10, 1 / 3) - 1, 0.001);
  near(r.cagr5yr, Math.pow(r.intrinsicValue / 10, 1 / 5) - 1, 0.001);
});

test('margin of safety positive when undervalued', () => {
  const r = calculateDCF({
    fcf: 100e6, growthRate: 0.08, terminalGrowth: 0.03, wacc: 0.10,
    projectionYears: 5, totalDebt: 0, totalCash: 0,
    sharesOutstanding: 100e6, currentPrice: 5,
  });
  assert.ok(r.marginOfSafety > 0);
});

test('no per-share value when sharesOutstanding is null', () => {
  const r = calculateDCF({
    fcf: 100e6, growthRate: 0.05, terminalGrowth: 0.025, wacc: 0.10,
    projectionYears: 5, sharesOutstanding: null, currentPrice: 10,
  });
  assert.strictEqual(r.intrinsicValue, null);
  assert.ok(r.firmValue > 0);
});

test('midYear defaults to false and matches fiscal-year-end discounting exactly', () => {
  const base = { fcf: 100e6, growthRate: 0.08, terminalGrowth: 0.03, wacc: 0.10, projectionYears: 5, sharesOutstanding: 100e6, currentPrice: 15 };
  const withoutFlag = calculateDCF(base);
  const explicitFalse = calculateDCF({ ...base, midYear: false });
  assert.strictEqual(withoutFlag.intrinsicValue, explicitFalse.intrinsicValue);
});

test('midYear=true produces a higher intrinsic value than fiscal-year-end', () => {
  const base = { fcf: 100e6, growthRate: 0.08, terminalGrowth: 0.03, wacc: 0.10, projectionYears: 5, sharesOutstanding: 100e6, currentPrice: 15 };
  const fyEnd = calculateDCF({ ...base, midYear: false });
  const midYear = calculateDCF({ ...base, midYear: true });
  assert.ok(midYear.intrinsicValue > fyEnd.intrinsicValue);
});

test('midYear=true discounts the first year at exponent 0.5, not 1', () => {
  const base = { fcf: 100e6, growthRate: 0.08, terminalGrowth: 0.03, wacc: 0.10, projectionYears: 5, sharesOutstanding: 100e6, currentPrice: 15 };
  const result = calculateDCF({ ...base, midYear: true });
  const expectedYear1Fcf = base.fcf * (1 + base.growthRate);
  const expectedPvYear1 = expectedYear1Fcf / Math.pow(1 + base.wacc, 0.5);
  near(result.pvFcfs[0], expectedPvYear1, 1e-6);
});
