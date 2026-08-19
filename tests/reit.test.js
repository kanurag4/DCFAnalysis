const { test } = require('node:test');
const assert = require('node:assert');
const { deriveFfo, deriveAffo, calculateReitValue } = require('../www/calc/reit.js');

test('deriveFfo adds back depreciation to net income', () => {
  const r = deriveFfo({ netIncome: 100, depreciationAndAmortization: 40 });
  assert.strictEqual(r.value, 140);
});

test('deriveFfo returns null when netIncome is missing', () => {
  const r = deriveFfo({ netIncome: null, depreciationAndAmortization: 40 });
  assert.strictEqual(r.value, null);
});

test('deriveFfo treats missing D&A as zero (not null)', () => {
  const r = deriveFfo({ netIncome: 100, depreciationAndAmortization: null });
  assert.strictEqual(r.value, 100);
});

test('deriveAffo subtracts absolute capex from FFO', () => {
  // capex is negative in Yahoo's outflow convention, same as everywhere else
  // in this codebase (see deriveFcf's capex handling in utils.js)
  const r = deriveAffo({ ffo: 140, capex: -30 });
  assert.strictEqual(r.value, 110);
});

test('deriveAffo can go negative when capex exceeds FFO', () => {
  const r = deriveAffo({ ffo: 20, capex: -50 });
  assert.strictEqual(r.value, -30);
});

test('deriveAffo returns null when FFO is null', () => {
  const r = deriveAffo({ ffo: null, capex: -30 });
  assert.strictEqual(r.value, null);
});

test('deriveAffo treats missing capex as zero', () => {
  const r = deriveAffo({ ffo: 140, capex: null });
  assert.strictEqual(r.value, 140);
});

test('calculateReitValue multiplies AFFO/share by the multiple', () => {
  const r = calculateReitValue({ affoPerShare: 5, multiple: 14, currentPrice: 60 });
  assert.strictEqual(r.intrinsicValue, 70);
  assert.ok(Math.abs(r.marginOfSafety - (70 - 60) / 60) < 1e-9);
});

test('calculateReitValue returns null intrinsicValue when affoPerShare is null', () => {
  const r = calculateReitValue({ affoPerShare: null, multiple: 14, currentPrice: 60 });
  assert.strictEqual(r.intrinsicValue, null);
  assert.strictEqual(r.marginOfSafety, null);
});

test('calculateReitValue returns null intrinsicValue when affoPerShare is negative', () => {
  // negative AFFO/share has no meaningful multiple-based value -- same
  // "can't run this model" posture as DDM's noDividend/DCF's fcfMissing cases
  const r = calculateReitValue({ affoPerShare: -2, multiple: 14, currentPrice: 60 });
  assert.strictEqual(r.intrinsicValue, null);
});

test('calculateReitValue with no currentPrice omits marginOfSafety', () => {
  const r = calculateReitValue({ affoPerShare: 5, multiple: 14, currentPrice: null });
  assert.strictEqual(r.intrinsicValue, 70);
  assert.strictEqual(r.marginOfSafety, null);
});
