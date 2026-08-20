const { test } = require('node:test');
const assert = require('node:assert');
const { calculateAirlineValue } = require('../www/calc/airline.js');

test('calculateAirlineValue: EV minus net debt, divided by shares', () => {
  // EV = 7.5B x 6 = 45B; net debt = 21B - 4.665B = 16.335B; equity = 28.665B; /658M shares
  const r = calculateAirlineValue({ ebitda: 7.5e9, multiple: 6, totalDebt: 21e9, totalCash: 4.665e9, sharesOutstanding: 658e6, currentPrice: 83.29 });
  assert.ok(Math.abs(r.ev - 45e9) < 1);
  assert.ok(Math.abs(r.netDebt - 16.335e9) < 1);
  assert.ok(Math.abs(r.equityValue - 28.665e9) < 1);
  assert.ok(Math.abs(r.intrinsicValue - (28.665e9 / 658e6)) < 0.01);
});

test('calculateAirlineValue: marginOfSafety compares intrinsic to current price', () => {
  const r = calculateAirlineValue({ ebitda: 7.5e9, multiple: 6, totalDebt: 21e9, totalCash: 4.665e9, sharesOutstanding: 658e6, currentPrice: 100 });
  const expected = (r.intrinsicValue - 100) / 100;
  assert.ok(Math.abs(r.marginOfSafety - expected) < 1e-9);
});

test('calculateAirlineValue: returns null intrinsicValue when ebitda is missing', () => {
  const r = calculateAirlineValue({ ebitda: null, multiple: 6, totalDebt: 21e9, totalCash: 4.665e9, sharesOutstanding: 658e6, currentPrice: 83.29 });
  assert.strictEqual(r.intrinsicValue, null);
  assert.strictEqual(r.marginOfSafety, null);
});

test('calculateAirlineValue: returns null intrinsicValue when ebitda is negative or zero', () => {
  const r = calculateAirlineValue({ ebitda: -1e9, multiple: 6, totalDebt: 21e9, totalCash: 4.665e9, sharesOutstanding: 658e6, currentPrice: 83.29 });
  assert.strictEqual(r.intrinsicValue, null);
});

test('calculateAirlineValue: returns null intrinsicValue when net debt exceeds EV', () => {
  // EV = 1B x 6 = 6B, but net debt is 29B -- equity is negative
  const r = calculateAirlineValue({ ebitda: 1e9, multiple: 6, totalDebt: 30e9, totalCash: 1e9, sharesOutstanding: 658e6, currentPrice: 83.29 });
  assert.strictEqual(r.intrinsicValue, null);
});

test('calculateAirlineValue: treats missing totalDebt/totalCash as zero', () => {
  const r = calculateAirlineValue({ ebitda: 1e9, multiple: 6, totalDebt: null, totalCash: null, sharesOutstanding: 1e6, currentPrice: 10 });
  assert.strictEqual(r.intrinsicValue, 6000); // (1e9*6)/1e6
});

test('calculateAirlineValue: with no currentPrice omits marginOfSafety', () => {
  const r = calculateAirlineValue({ ebitda: 7.5e9, multiple: 6, totalDebt: 21e9, totalCash: 4.665e9, sharesOutstanding: 658e6, currentPrice: null });
  assert.notStrictEqual(r.intrinsicValue, null);
  assert.strictEqual(r.marginOfSafety, null);
});
