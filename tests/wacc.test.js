const assert = require('assert');
const { test } = require('node:test');
const { calculateWACC } = require('../www/calc/wacc.js');

test('standard WACC calculation', () => {
  // Inputs
  const E = 47e9, D = 16e9, V = E + D;
  const beta = 0.15, rf = 0.045, erp = 0.055, tc = 0.25;
  const interestExpense = -400e6; // Yahoo negative convention

  // Expected — derive from the same formula wacc.js uses so the test tracks any change
  const SPREAD = 0.005; // +0.5% new-issuance spread; must match wacc.js
  const expectedRe   = rf + beta * erp;                           // 0.05325
  const expectedRd   = Math.abs(interestExpense) / D + SPREAD;    // 0.030
  const expectedWacc = (E / V) * expectedRe + (D / V) * expectedRd * (1 - tc);

  const r = calculateWACC({
    marketCap: E, totalDebt: D, beta,
    interestExpense, taxRate: tc,
    riskFreeRate: rf, erp,
  });
  assert.ok(r !== null, 'should return result');
  assert.ok(Math.abs(r.wacc - expectedWacc) < 0.0001, `wacc=${r.wacc}, expected=${expectedWacc}`);
  assert.ok(Math.abs(r.re - expectedRe)     < 0.0001, `re=${r.re}`);
  assert.ok(Math.abs(r.rd - expectedRd)     < 0.0001, `rd=${r.rd}`);
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

test('returns null when marketCap is missing but totalDebt is present -- not a phantom 100%-debt WACC', () => {
  // Real incident, 2026-08-05: several large tickers (BPT.AX, TLS.AX, LLY,
  // MRK...) came back from Yahoo with marketCap null but totalDebt intact.
  // The old code treated equity weight as 0 and silently computed a WACC as
  // if the company were 100% debt-financed -- nonsense for any real,
  // exchange-listed company. It must refuse (return null) instead.
  const r = calculateWACC({
    marketCap: null, totalDebt: 705699968, beta: 0.9,
    interestExpense: null, taxRate: null,
  });
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

test('uses synthetic rating when EBIT and interest expense are both available', () => {
  const r = calculateWACC({
    marketCap: 10e9, totalDebt: 2e9, beta: 1.1,
    interestExpense: -100e6, taxRate: 0.25, ebit: 1.2e9,
    riskFreeRate: 0.045, erp: 0.055,
  });
  // ICR = 1.2e9 / 100e6 = 12x
  assert.strictEqual(r.rdMethod, 'synthetic');
  assert.ok(r.syntheticRating);
  assert.ok(Math.abs(r.icr - 12) < 1e-9);
  assert.strictEqual(r.isRdEstimated, false);
});

test('falls back to book yield when EBIT is unavailable but interest expense and debt are', () => {
  const r = calculateWACC({
    marketCap: 10e9, totalDebt: 2e9, beta: 1.1,
    interestExpense: -100e6, taxRate: 0.25, ebit: null,
    riskFreeRate: 0.045, erp: 0.055,
  });
  assert.strictEqual(r.rdMethod, 'bookYield');
  assert.strictEqual(r.isRdEstimated, false);
});

test('a negative or zero EBIT does not use synthetic rating', () => {
  const r = calculateWACC({
    marketCap: 10e9, totalDebt: 2e9, beta: 1.1,
    interestExpense: -100e6, taxRate: 0.25, ebit: -50e6,
    riskFreeRate: 0.045, erp: 0.055,
  });
  assert.strictEqual(r.rdMethod, 'bookYield');
  assert.strictEqual(r.icr, null);
});
