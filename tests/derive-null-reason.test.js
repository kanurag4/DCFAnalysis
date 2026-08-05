const { test } = require('node:test');
const assert = require('node:assert/strict');
const { deriveNullReason } = require('../scripts/lib/ticker-page.js');

test('returns null when the base result already has a real intrinsicValue', () => {
  const r = deriveNullReason({
    isBank: false, baseResult: { intrinsicValue: 18.6, negativeEquity: false },
    baseFcf: 100, dividend: null, discountPct: 6.75, terminalGrowth: 0.025,
  });
  assert.equal(r, null);
});

test('DCF, literal null result, fcf <= 0 -- names starting FCF as the cause', () => {
  const r = deriveNullReason({
    isBank: false, baseResult: null,
    baseFcf: 0, dividend: null, discountPct: 6.75, terminalGrowth: 0.025,
  });
  assert.match(r, /free cash flow <= 0/);
});

test('DCF, literal null result, fcf missing entirely -- also names starting FCF', () => {
  const r = deriveNullReason({
    isBank: false, baseResult: null,
    baseFcf: null, dividend: null, discountPct: 6.75, terminalGrowth: 0.025,
  });
  assert.match(r, /free cash flow <= 0/);
});

test('DCF, literal null result, wacc <= terminal growth -- names the actual rates', () => {
  const r = deriveNullReason({
    isBank: false, baseResult: null,
    baseFcf: 500000000, dividend: null, discountPct: 2, terminalGrowth: 0.025,
  });
  assert.match(r, /WACC \(2%\) <= terminal growth \(2\.5%\)/);
});

test('DDM, literal null result, dividend <= 0 -- names starting dividend as the cause', () => {
  const r = deriveNullReason({
    isBank: true, baseResult: null,
    baseFcf: null, dividend: 0, discountPct: 8, terminalGrowth: 0.025,
  });
  assert.match(r, /dividend <= 0/);
});

test('DDM, literal null result, cost of equity <= terminal growth -- names the actual rates', () => {
  const r = deriveNullReason({
    isBank: true, baseResult: null,
    baseFcf: null, dividend: 4.95, discountPct: 1.5, terminalGrowth: 0.025,
  });
  assert.match(r, /cost of equity \(1\.5%\) <= terminal growth \(2\.5%\)/);
});

test('DCF, non-null result object, negative equity -- distinguished from a literal null', () => {
  const r = deriveNullReason({
    isBank: false, baseResult: { intrinsicValue: null, negativeEquity: true },
    baseFcf: 500000000, dividend: null, discountPct: 6.75, terminalGrowth: 0.025,
  });
  assert.match(r, /net debt exceeds DCF firm value/);
});

test('DCF, non-null result object, missing sharesOutstanding -- distinguished from negative equity', () => {
  const r = deriveNullReason({
    isBank: false, baseResult: { intrinsicValue: null, negativeEquity: false },
    baseFcf: 500000000, dividend: null, discountPct: 6.75, terminalGrowth: 0.025,
  });
  assert.match(r, /shares outstanding unavailable/);
});
