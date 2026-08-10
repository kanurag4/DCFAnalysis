const { test } = require('node:test');
const assert = require('node:assert');
const { fetchTickerPageUrl } = require('../www/data.js');

test('fetchTickerPageUrl returns null immediately for a market with no stocks folder, without fetching', async () => {
  global.fetch = async () => { throw new Error('fetch should not have been called'); };
  const result = await fetchTickerPageUrl('AAPL', 'other');
  assert.strictEqual(result, null);
});

test('fetchTickerPageUrl returns the page URL when the ticker is found in the market manifest', async () => {
  global.fetch = async (url) => {
    assert.strictEqual(url, '/dcf/stocks/asx/manifest.json');
    return { ok: true, json: async () => ([{ ticker: 'BHP.AX', slug: 'bhp-ax' }]) };
  };
  const result = await fetchTickerPageUrl('BHP.AX', 'aus');
  assert.strictEqual(result, 'https://kashvector.com/dcf/stocks/asx/bhp-ax/');
});

test('fetchTickerPageUrl returns null when the ticker is not in the manifest', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ([{ ticker: 'MSFT', slug: 'msft' }]) });
  const result = await fetchTickerPageUrl('AAPL', 'us');
  assert.strictEqual(result, null);
});

test('fetchTickerPageUrl returns null (not throw) when the manifest fetch 404s', async () => {
  global.fetch = async () => ({ ok: false, status: 404, json: async () => { throw new Error('should not be called'); } });
  const result = await fetchTickerPageUrl('005930.KS', 'kor');
  assert.strictEqual(result, null);
});

test('fetchTickerPageUrl returns null (not throw) when fetch itself rejects', async () => {
  global.fetch = async () => { throw new Error('network down'); };
  const result = await fetchTickerPageUrl('SOMETICKER.T', 'jpn');
  assert.strictEqual(result, null);
});

test('fetchTickerPageUrl caches the manifest per market — a second lookup does not refetch', async () => {
  let fetchCount = 0;
  global.fetch = async () => {
    fetchCount++;
    return { ok: true, json: async () => ([{ ticker: 'RELIANCE.NS', slug: 'reliance-ns' }]) };
  };
  const first = await fetchTickerPageUrl('RELIANCE.NS', 'ind');
  const second = await fetchTickerPageUrl('SOMEOTHER.NS', 'ind');
  assert.strictEqual(first, 'https://kashvector.com/dcf/stocks/nifty/reliance-ns/');
  assert.strictEqual(second, null);
  assert.strictEqual(fetchCount, 1);
});
