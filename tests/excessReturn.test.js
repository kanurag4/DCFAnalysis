const { test } = require('node:test');
const assert = require('node:assert');
const { calculateExcessReturn } = require('../www/calc/excessReturn.js');

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `expected ~${b}, got ${a}`);

test('returns null when bookValue is missing or non-positive', () => {
  assert.strictEqual(calculateExcessReturn({ bookValue: null, roe: 0.2, costOfEquity: 0.1, growthRate: 0.05, currentPrice: 100 }), null);
  assert.strictEqual(calculateExcessReturn({ bookValue: 0, roe: 0.2, costOfEquity: 0.1, growthRate: 0.05, currentPrice: 100 }), null);
  assert.strictEqual(calculateExcessReturn({ bookValue: -5, roe: 0.2, costOfEquity: 0.1, growthRate: 0.05, currentPrice: 100 }), null);
});

test('returns null when roe or costOfEquity is missing/non-positive', () => {
  assert.strictEqual(calculateExcessReturn({ bookValue: 100, roe: null, costOfEquity: 0.1, growthRate: 0.05, currentPrice: 100 }), null);
  assert.strictEqual(calculateExcessReturn({ bookValue: 100, roe: 0.2, costOfEquity: 0, growthRate: 0.05, currentPrice: 100 }), null);
  assert.strictEqual(calculateExcessReturn({ bookValue: 100, roe: -0.05, costOfEquity: 0.1, growthRate: 0.05, currentPrice: 100 }), null);
});

test('value of equity = book value + PV of excess returns, ROE > Ke case', () => {
  // Hand-computed (verified independently, not just re-derived from the code under
  // test): BVE0=100, roe=0.20, ke=0.10, g=0.05, 5 years
  // t=1: ER=(0.20-0.10)*100=10.00, PV=10/1.10=9.090909, BVE1=105.00
  // t=2: ER=(0.20-0.10)*105.00=10.50, PV=10.50/1.10^2=8.677686, BVE2=110.25
  // t=3: ER=(0.20-0.10)*110.25=11.025, PV=11.025/1.10^3=8.283250, BVE3=115.7625
  // t=4: ER=(0.20-0.10)*115.7625=11.57625, PV=11.57625/1.10^4=7.906735, BVE4=121.550625
  // t=5: ER=(0.20-0.10)*121.550625=12.1550625, PV=12.1550625/1.10^5=7.547337, BVE5=127.62815625
  // sum PV = 41.505917...
  const r = calculateExcessReturn({ bookValue: 100, roe: 0.20, costOfEquity: 0.10, growthRate: 0.05, currentPrice: 100 });
  assert.ok(r);
  near(r.intrinsicValue, 100 + 41.505917, 1e-3);
  assert.strictEqual(r.excessReturns.length, 5);
  near(r.excessReturns[0], 10.00, 1e-6);
  near(r.bookValues[4], 127.62815625, 1e-3);
});

test('excess return is negative (drags value below book value) when ROE < Ke', () => {
  const r = calculateExcessReturn({ bookValue: 100, roe: 0.05, costOfEquity: 0.10, growthRate: 0.02, currentPrice: 100 });
  assert.ok(r);
  assert.ok(r.intrinsicValue < 100, `expected intrinsic below book value 100, got ${r.intrinsicValue}`);
  assert.ok(r.excessReturns.every(x => x < 0));
});

test('computes marginOfSafety when currentPrice is given, null when omitted', () => {
  const withPrice = calculateExcessReturn({ bookValue: 100, roe: 0.20, costOfEquity: 0.10, growthRate: 0.05, currentPrice: 100 });
  near(withPrice.marginOfSafety, (withPrice.intrinsicValue - 100) / 100, 1e-9);
  const noPrice = calculateExcessReturn({ bookValue: 100, roe: 0.20, costOfEquity: 0.10, growthRate: 0.05 });
  assert.strictEqual(noPrice.marginOfSafety, null);
});

test('respects a custom projectionYears', () => {
  const r3 = calculateExcessReturn({ bookValue: 100, roe: 0.20, costOfEquity: 0.10, growthRate: 0.05, projectionYears: 3, currentPrice: 100 });
  assert.strictEqual(r3.excessReturns.length, 3);
});

test('computes cagr1yr/3yr/5yr from intrinsicValue when currentPrice is given, null when omitted', () => {
  const withPrice = calculateExcessReturn({ bookValue: 100, roe: 0.20, costOfEquity: 0.10, growthRate: 0.05, currentPrice: 100 });
  const iv = withPrice.intrinsicValue;
  near(withPrice.cagr1yr, (iv / 100) - 1, 1e-9);
  near(withPrice.cagr3yr, Math.pow(iv / 100, 1 / 3) - 1, 1e-9);
  near(withPrice.cagr5yr, Math.pow(iv / 100, 1 / 5) - 1, 1e-9);
  const noPrice = calculateExcessReturn({ bookValue: 100, roe: 0.20, costOfEquity: 0.10, growthRate: 0.05 });
  assert.strictEqual(noPrice.cagr1yr, null);
  assert.strictEqual(noPrice.cagr3yr, null);
  assert.strictEqual(noPrice.cagr5yr, null);
});
