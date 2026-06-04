const { test } = require('node:test');
const assert = require('node:assert');
const { fetchRfRate } = require('../scripts/lib/rf.js');

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ~${b}, got ${a}`);

test('converts ^TNX percent price to a decimal rate (4.25 -> 0.0425)', async () => {
  const r = await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchSymbolImpl: async () => ({ price: 4.25 }) });
  near(r, 0.0425);
});

test('falls back when the fetch returns null', async () => {
  const r = await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchSymbolImpl: async () => null });
  near(r, 0.045);
});

test('falls back when the rate is out of the plausible band', async () => {
  const r = await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchSymbolImpl: async () => ({ price: 0 }) });
  near(r, 0.045);
  const r2 = await fetchRfRate('^GSBG10.AX', 0.048, { proxyUrl: 'x', fetchSymbolImpl: async () => ({ price: 99 }) });
  near(r2, 0.048);
});

test('falls back when the fetch throws', async () => {
  const r = await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchSymbolImpl: async () => { throw new Error('boom'); } });
  near(r, 0.045);
});
