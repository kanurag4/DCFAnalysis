const { test } = require('node:test');
const assert = require('node:assert');
const { fetchRfRate, fetchIndexPrice, fetchFxRate } = require('../scripts/lib/rf.js');

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

// fetchIndexPrice — switched 2026-07-31 to read /history (last daily close)
// instead of quoteSummary, after finding quoteSummary stuck stale for index
// tickers during the July 2026 KOSPI/Nikkei volatility.
test('fetchIndexPrice returns the last entry\'s close from /history', async () => {
  const history = [
    { date: '2026-07-29', close: 100 },
    { date: '2026-07-30', close: 105 },
    { date: '2026-07-31', close: 110 },
  ];
  const price = await fetchIndexPrice('^N225', 'x', async () => history);
  near(price, 110);
});

test('fetchIndexPrice returns null on an empty history array', async () => {
  assert.strictEqual(await fetchIndexPrice('^N225', 'x', async () => []), null);
});

test('fetchIndexPrice returns null when the body is not an array', async () => {
  assert.strictEqual(await fetchIndexPrice('^N225', 'x', async () => null), null);
  assert.strictEqual(await fetchIndexPrice('^N225', 'x', async () => ({})), null);
});

test('fetchIndexPrice returns null on a non-positive or missing close', async () => {
  assert.strictEqual(await fetchIndexPrice('^N225', 'x', async () => [{ date: '2026-07-31', close: 0 }]), null);
  assert.strictEqual(await fetchIndexPrice('^N225', 'x', async () => [{ date: '2026-07-31' }]), null);
});

test('fetchIndexPrice returns null when the fetch throws', async () => {
  assert.strictEqual(await fetchIndexPrice('^N225', 'x', async () => { throw new Error('boom'); }), null);
});

test('fetchFxRate reads summaryDetail.previousClose with no /100 scaling', async () => {
  const r = await fetchFxRate('GBPEUR=X', 1.17, { proxyUrl: 'x', fetchImpl: async () => detail('previousClose', 1.1723) });
  near(r, 1.1723);
});

test('fetchFxRate falls back when out of the plausible 0.5-2 band', async () => {
  near(await fetchFxRate('GBPEUR=X', 1.17, { proxyUrl: 'x', fetchImpl: async () => detail('previousClose', 0.03) }), 1.17);
  near(await fetchFxRate('GBPEUR=X', 1.17, { proxyUrl: 'x', fetchImpl: async () => detail('previousClose', 45) }), 1.17);
});

test('fetchFxRate falls back when the fetch throws or returns nothing usable', async () => {
  near(await fetchFxRate('GBPEUR=X', 1.17, { proxyUrl: 'x', fetchImpl: async () => { throw new Error('boom'); } }), 1.17);
  near(await fetchFxRate('GBPEUR=X', 1.17, { proxyUrl: 'x', fetchImpl: async () => ({}) }), 1.17);
});
