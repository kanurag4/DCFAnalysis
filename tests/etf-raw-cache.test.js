const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeUnionCache } = require('../scripts/lib/etf/raw-cache.js');

test('folds a --only fund cache into the shared cache, keeping every existing symbol', () => {
  const shared = {
    asAt: '2026-09-01', live: { usRf: 0.048 },
    union: { AAPL: { p: 1 }, MSFT: { p: 2 } },
    fx: { 'EUR>USD': 1.1 }, listingPrices: { SOXX: 500 },
  };
  const fund = {
    asAt: '2026-09-03', live: { usRf: 0.047 },
    union: { RHM_DE: { p: 9 }, MSFT: { p: 22 } }, // RHM_DE is new; MSFT overlaps
    fx: { 'ILS>USD': 0.27 }, listingPrices: { SHLD: 40 },
  };
  const out = mergeUnionCache(shared, fund);
  assert.deepEqual(Object.keys(out.union).sort(), ['AAPL', 'MSFT', 'RHM_DE']);
  assert.equal(out.union.MSFT.p, 22, 'fund wins for an overlapping symbol (fresher fetch)');
  assert.equal(out.union.AAPL.p, 1, 'a symbol only in the shared cache is untouched');
  assert.equal(out.asAt, '2026-09-01', 'radar-wide asAt is left alone');
  assert.deepEqual(out.live, { usRf: 0.048 }, 'radar-wide live rates are left alone');
  assert.deepEqual(out.fx, { 'EUR>USD': 1.1, 'ILS>USD': 0.27 });
  assert.deepEqual(out.listingPrices, { SOXX: 500, SHLD: 40 });
});

test('does not mutate its inputs', () => {
  const shared = { union: { A: 1 }, fx: {}, listingPrices: {} };
  const fund = { union: { B: 2 }, fx: {}, listingPrices: {} };
  mergeUnionCache(shared, fund);
  assert.deepEqual(shared.union, { A: 1 });
});

test('missing shared cache returns a copy of the fund cache', () => {
  const fund = { union: { B: 2 } };
  const out = mergeUnionCache(null, fund);
  assert.deepEqual(out.union, { B: 2 });
  assert.notEqual(out, fund);
});

test('missing fund cache returns a copy of the shared cache', () => {
  const shared = { union: { A: 1 } };
  assert.deepEqual(mergeUnionCache(shared, null).union, { A: 1 });
});
