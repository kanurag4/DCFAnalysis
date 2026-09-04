const { test } = require('node:test');
const assert = require('node:assert');
const { fetchRfRate, fetchIndRf, fetchIndexPrice, fetchFxRate, fetchEurFxRates } = require('../scripts/lib/rf.js');

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

// fetchIndRf — corrected 2026-08-15: subtracts India's Damodaran default spread from
// the raw ^INBMKG10.NS G-Sec yield (erp already carries India's country risk premium,
// so the raw yield alone double-counts it). This is the batch's actual live rf source
// for NIFTY -- it overrides market.js's static fallback whenever it succeeds, which is
// why market.js's own fallback fix alone didn't change the batch's real output.
test('fetchIndRf subtracts the default spread from a live-fetched raw yield (6.80% -> ~4.93%)', async () => {
  const r = await fetchIndRf('x', { fetchImpl: async () => detail('previousClose', 6.80) });
  near(r, 0.0493);
});

test('fetchIndRf falls back to the already-spread-adjusted static default (0.0509) when the live fetch fails, not raw-0.07-minus-spread', async () => {
  near(await fetchIndRf('x', { fetchImpl: async () => ({}) }), 0.0509);
  near(await fetchIndRf('x', { fetchImpl: async () => { throw new Error('boom'); } }), 0.0509);
});

test('fetchIndRf floors at 1% even if the live yield were implausibly close to the spread', async () => {
  const r = await fetchIndRf('x', { fetchImpl: async () => detail('previousClose', 2.0) });
  near(r, 0.01); // 2.0% - 1.87% = 0.13%, floored to 1%
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
  const r = await fetchFxRate('GBPEUR=X', { proxyUrl: 'x', fetchImpl: async () => detail('previousClose', 1.1723) });
  near(r, 1.1723);
});

// Returns null, not a fallback: a plausible-looking stand-in used to get persisted as
// if it were a real quote, then compared against the next run's real rate, inventing
// an FX move that never happened. Provenance is the caller's decision now.
test('fetchFxRate returns null when out of the plausible band', async () => {
  assert.strictEqual(await fetchFxRate('GBPEUR=X', { proxyUrl: 'x', fetchImpl: async () => detail('previousClose', 0.03) }), null);
  assert.strictEqual(await fetchFxRate('GBPEUR=X', { proxyUrl: 'x', fetchImpl: async () => detail('previousClose', 45) }), null);
});

test('fetchFxRate returns null when the fetch throws or returns nothing usable', async () => {
  assert.strictEqual(await fetchFxRate('GBPEUR=X', { proxyUrl: 'x', fetchImpl: async () => { throw new Error('boom'); } }), null);
  assert.strictEqual(await fetchFxRate('GBPEUR=X', { proxyUrl: 'x', fetchImpl: async () => ({}) }), null);
});

test('fetchEurFxRates marks source live when every rate is fetched', async () => {
  const orig = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => detail('previousClose', 1.1) });
  try {
    const out = await fetchEurFxRates('http://x');
    assert.strictEqual(out.source, 'live');
    assert.deepEqual(out.missing, []);
    near(out.rates.GBP, 1.1);
    near(out.rates.USD, 1.1);
  } finally { global.fetch = orig; }
});

test('fetchEurFxRates marks source fallback and lists missing when every fetch fails', async () => {
  const orig = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  try {
    const out = await fetchEurFxRates('http://x');
    assert.strictEqual(out.source, 'fallback');
    assert.deepEqual(out.missing, ['GBP', 'USD']);
    near(out.rates.GBP, 1.17);  // documented stand-ins, but flagged as such
    near(out.rates.USD, 0.92);
  } finally { global.fetch = orig; }
});
