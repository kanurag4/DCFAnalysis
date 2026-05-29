const assert = require('assert');
const { test } = require('node:test');
const { calculateWACC } = require('../www/calc/wacc.js');

test('standard WACC calculation', () => {
  // E=47B, D=16B, beta=0.15, interestExpense=-400M (Yahoo negative convention), tc=0.25
  // Re = 0.045 + 0.15*0.055 = 0.05325
  // Rd = 400M/16B + 0.005 = 0.025 + 0.005 = 0.03
  // E/V = 47/63 = 0.7460, D/V = 0.2540
  // WACC = 0.7460*0.05325 + 0.2540*0.03*(1-0.25) = 0.03972 + 0.005715 = 0.04544
  const r = calculateWACC({
    marketCap: 47e9, totalDebt: 16e9, beta: 0.15,
    interestExpense: -400e6, taxRate: 0.25,
    riskFreeRate: 0.045, erp: 0.055,
  });
  assert.ok(r !== null, 'should return result');
  assert.ok(Math.abs(r.wacc - 0.04544) < 0.0005, `wacc=${r.wacc}`);
  assert.ok(Math.abs(r.re - 0.05325) < 0.0001, `re=${r.re}`);
  assert.strictEqual(r.isRdEstimated, false);
  assert.strictEqual(r.isTcEstimated, false);
});

test('uses default Rd=5% when interestExpense is null', () => {
  const r = calculateWACC({
    marketCap: 10e9, totalDebt: 2e9, beta: 1.0,
    interestExpense: null, taxRate: 0.25,
  });
  assert.strictEqual(r.rd, 0.05);
  assert.strictEqual(r.isRdEstimated, true);
});

test('uses default Tc=25% when taxRate is null', () => {
  const r = calculateWACC({
    marketCap: 10e9, totalDebt: 2e9, beta: 1.0,
    interestExpense: -100e6, taxRate: null,
  });
  assert.strictEqual(r.tc, 0.25);
  assert.strictEqual(r.isTcEstimated, true);
});

test('returns null when total capital is zero', () => {
  const r = calculateWACC({ marketCap: 0, totalDebt: 0, beta: 1.0, interestExpense: null, taxRate: null });
  assert.strictEqual(r, null);
});

test('uses beta=1.0 fallback when beta is null', () => {
  const r = calculateWACC({
    marketCap: 10e9, totalDebt: 0, beta: null,
    interestExpense: null, taxRate: 0.25,
    riskFreeRate: 0.045, erp: 0.055,
  });
  // Re = 0.045 + 1.0*0.055 = 0.10
  assert.ok(Math.abs(r.re - 0.10) < 0.0001, `re=${r.re}`);
});
