const assert = require('assert');
const { test } = require('node:test');
const { calculateDDM } = require('../www/calc/ddm.js');

const near = (actual, expected, tol) =>
  assert.ok(Math.abs(actual - expected) <= tol, `Expected ~${expected} ±${tol}, got ${actual}`);

test('basic DDM produces positive per-share intrinsic value', () => {
  const r = calculateDDM({
    dividend: 4, growthRate: 0.04, terminalGrowth: 0.03,
    costOfEquity: 0.08, projectionYears: 5, currentPrice: 80,
  });
  assert.ok(r !== null);
  assert.ok(r.intrinsicValue > 0);
  assert.strictEqual(r.dividends.length, 5);
  assert.ok(r.pvTerminal > 0);
  near(r.intrinsicValue, r.sumPvDividends + r.pvTerminal, 1e-6);
});

test('constant growth equals single-stage Gordon model', () => {
  // When growthRate === terminalGrowth, multi-stage collapses to D0(1+g)/(re-g).
  const D0 = 4, g = 0.03, re = 0.08;
  const r = calculateDDM({
    dividend: D0, growthRate: g, terminalGrowth: g,
    costOfEquity: re, projectionYears: 5, currentPrice: 80,
  });
  const gordon = D0 * (1 + g) / (re - g);   // = 82.4
  near(r.intrinsicValue, gordon, 0.01);
});

test('returns null when costOfEquity <= terminalGrowth', () => {
  const r = calculateDDM({
    dividend: 4, growthRate: 0.05, terminalGrowth: 0.09,
    costOfEquity: 0.08, projectionYears: 5, currentPrice: 80,
  });
  assert.strictEqual(r, null);
});

test('returns null when dividend is zero or negative', () => {
  assert.strictEqual(calculateDDM({ dividend: 0,  growthRate: 0.04, terminalGrowth: 0.03, costOfEquity: 0.08, projectionYears: 5, currentPrice: 80 }), null);
  assert.strictEqual(calculateDDM({ dividend: -2, growthRate: 0.04, terminalGrowth: 0.03, costOfEquity: 0.08, projectionYears: 5, currentPrice: 80 }), null);
});

test('higher cost of equity lowers intrinsic value', () => {
  const base = { dividend: 4, growthRate: 0.04, terminalGrowth: 0.03, projectionYears: 5, currentPrice: 80 };
  const low  = calculateDDM({ ...base, costOfEquity: 0.08 });
  const high = calculateDDM({ ...base, costOfEquity: 0.10 });
  assert.ok(high.intrinsicValue < low.intrinsicValue);
});

test('higher dividend growth raises intrinsic value', () => {
  const base = { dividend: 4, terminalGrowth: 0.03, costOfEquity: 0.09, projectionYears: 5, currentPrice: 80 };
  const slow = calculateDDM({ ...base, growthRate: 0.02 });
  const fast = calculateDDM({ ...base, growthRate: 0.06 });
  assert.ok(fast.intrinsicValue > slow.intrinsicValue);
});

test('margin of safety and CAGR computed against current price', () => {
  const r = calculateDDM({
    dividend: 4.65, growthRate: 0.04, terminalGrowth: 0.03,
    costOfEquity: 0.085, projectionYears: 5, currentPrice: 90,
  });
  near(r.marginOfSafety, (r.intrinsicValue - 90) / 90, 0.001);
  near(r.cagr1yr, r.intrinsicValue / 90 - 1, 0.001);
  near(r.cagr3yr, Math.pow(r.intrinsicValue / 90, 1 / 3) - 1, 0.001);
  near(r.cagr5yr, Math.pow(r.intrinsicValue / 90, 1 / 5) - 1, 0.001);
});

test('CBA-shaped inputs produce a plausible per-share value', () => {
  const r = calculateDDM({
    dividend: 4.65, growthRate: 0.03, terminalGrowth: 0.03,
    costOfEquity: 0.085, projectionYears: 5, currentPrice: 165,
  });
  assert.ok(r.intrinsicValue > 50 && r.intrinsicValue < 200, `got ${r.intrinsicValue}`);
  assert.ok(r.marginOfSafety < 0, 'CBA overvalued vs $165 in this scenario');
});

test('no currentPrice leaves MOS and CAGR null', () => {
  const r = calculateDDM({
    dividend: 4, growthRate: 0.04, terminalGrowth: 0.03,
    costOfEquity: 0.08, projectionYears: 5,
  });
  assert.strictEqual(r.marginOfSafety, null);
  assert.strictEqual(r.cagr1yr, null);
  assert.ok(r.intrinsicValue > 0);
});

test('midYear defaults to false and matches fiscal-year-end discounting exactly', () => {
  const base = { dividend: 4, growthRate: 0.04, terminalGrowth: 0.03, costOfEquity: 0.08, projectionYears: 5, currentPrice: 80 };
  const withoutFlag = calculateDDM(base);
  const explicitFalse = calculateDDM({ ...base, midYear: false });
  assert.strictEqual(withoutFlag.intrinsicValue, explicitFalse.intrinsicValue);
});

test('midYear=true produces a higher intrinsic value than fiscal-year-end', () => {
  const base = { dividend: 4, growthRate: 0.04, terminalGrowth: 0.03, costOfEquity: 0.08, projectionYears: 5, currentPrice: 80 };
  const fyEnd = calculateDDM({ ...base, midYear: false });
  const midYear = calculateDDM({ ...base, midYear: true });
  assert.ok(midYear.intrinsicValue > fyEnd.intrinsicValue);
});
