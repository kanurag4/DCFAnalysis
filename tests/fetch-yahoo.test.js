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
