const { test } = require('node:test');
const assert = require('node:assert');
const { fetchRfRate } = require('../scripts/lib/rf.js');

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ~${b}, got ${a}`);
// Minimal raw quoteSummary body with one summaryDetail field populated.
const detail = (field, raw) => ({ quoteSummary: { result: [{ summaryDetail: { [field]: { raw } } }] } });

test('reads summaryDetail.previousClose, percent -> decimal (4.25 -> 0.0425)', async () => {
  const r = await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => detail('previousClose', 4.25) });
  near(r, 0.0425);
});

test('falls back to summaryDetail.regularMarketPrice', async () => {
  const r = await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => detail('regularMarketPrice', 4.10) });
  near(r, 0.041);
});

test('uses financialData.currentPrice when summaryDetail has no price', async () => {
  const body = { quoteSummary: { result: [{ financialData: { currentPrice: { raw: 3.90 } } }] } };
  near(await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => body }), 0.039);
});

test('falls back when the body has no usable field', async () => {
  near(await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => ({}) }), 0.045);
  near(await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => null }), 0.045);
});

test('falls back when out of the plausible band', async () => {
  near(await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => detail('previousClose', 0) }), 0.045);
  near(await fetchRfRate('^GSBG10.AX', 0.048, { proxyUrl: 'x', fetchImpl: async () => detail('previousClose', 99) }), 0.048);
});

test('falls back when the fetch throws', async () => {
  near(await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => { throw new Error('boom'); } }), 0.045);
});
