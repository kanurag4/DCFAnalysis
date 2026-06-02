const { test } = require('node:test');
const assert = require('node:assert');
const { fetchSymbol } = require('../scripts/fetch-yahoo.js');

test('fetchSymbol maps a stubbed Yahoo response', async () => {
  const stubBody = { quoteSummary: { result: [{
    quoteType: { longName: 'Test Co' },
    financialData: { currentPrice: { raw: 12 }, freeCashflow: { raw: 100 } },
    summaryDetail: { marketCap: { raw: 1000 }, currency: 'AUD' },
    defaultKeyStatistics: { sharesOutstanding: { raw: 100 } },
    assetProfile: { sector: 'Industrials' },
  }] } };
  const fakeFetch = async () => ({ ok: true, status: 200, json: async () => stubBody });
  const d = await fetchSymbol('TEST.AX', { fetchImpl: fakeFetch, proxyUrl: 'https://x' });
  assert.strictEqual(d.ticker, 'TEST.AX');
  assert.strictEqual(d.name, 'Test Co');
  assert.strictEqual(d.price, 12);
});

test('fetchSymbol returns null on HTTP error (so the batch can skip it)', async () => {
  const fakeFetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const d = await fetchSymbol('BAD.AX', { fetchImpl: fakeFetch, proxyUrl: 'https://x' });
  assert.strictEqual(d, null);
});

test('fetchSymbol retries on transient failure then succeeds', async () => {
  const ok = { quoteSummary: { result: [{ quoteType: { longName: 'Retry Co' },
    financialData: { currentPrice: { raw: 9 } }, summaryDetail: { currency: 'AUD' },
    defaultKeyStatistics: {}, assetProfile: {} }] } };
  let calls = 0;
  const fakeFetch = async () => {
    calls++;
    if (calls < 3) return { ok: false, status: 429, json: async () => ({}) }; // rate-limited twice
    return { ok: true, status: 200, json: async () => ok };
  };
  const noSleep = async () => {};
  const d = await fetchSymbol('RTY.AX', { fetchImpl: fakeFetch, proxyUrl: 'https://x', retries: 3, sleepImpl: noSleep });
  assert.strictEqual(calls, 3);
  assert.strictEqual(d.name, 'Retry Co');
});

test('fetchSymbol gives up and returns null after exhausting retries', async () => {
  let calls = 0;
  const fakeFetch = async () => { calls++; return { ok: false, status: 429, json: async () => ({}) }; };
  const noSleep = async () => {};
  const d = await fetchSymbol('NOPE.AX', { fetchImpl: fakeFetch, proxyUrl: 'https://x', retries: 2, sleepImpl: noSleep });
  assert.strictEqual(d, null);
  assert.strictEqual(calls, 3); // initial + 2 retries
});
