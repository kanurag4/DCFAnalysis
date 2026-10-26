const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runParity, marketOf, runIdFor } = require('../scripts/data-parity.js');

const STAGING = 'https://staging.example';
const PROD = 'https://prod.example';

function harness({ stagingSource = 'store', postStatus = 204 } = {}) {
  const log = [];
  const posts = [];
  async function fetchImpl(url, opts = {}) {
    const u = String(url);
    log.push(u);
    if (u.endsWith('/store/parity')) {
      posts.push(JSON.parse(opts.body));
      return new Response(null, { status: postStatus });
    }
    const headers = u.startsWith(STAGING) ? { 'X-KV-Source': stagingSource } : {};
    return new Response(JSON.stringify([{ date: '2026-10-23', close: 10 }]), { status: 200, headers });
  }
  // Stands in for fetchSymbol: makes the quoteSummary + timeseries calls through the given fetchImpl.
  async function fetchSymbolImpl(ticker, { proxyUrl, fetchImpl: f }) {
    await f(`${proxyUrl}/quoteSummary/${ticker}`);
    await f(`${proxyUrl}/timeseries/${ticker}`);
    return { ticker, price: 10, currency: 'USD', financialCurrency: 'USD' };
  }
  const deps = {
    fetchImpl,
    fetchSymbolImpl,
    convertImpl: async d => d,
    evaluateImpl: () => ({ method: 'DCF', intrinsic: 100, altmanZ: null, piotroskiF: null }),
    sleepImpl: async () => {},
    now: () => new Date('2026-10-27T21:00:30Z'),
  };
  return { deps, log, posts };
}

test('fetches the staging store first, then production, for each ticker, and posts the run', async () => {
  const h = harness();
  const out = await runParity({ tickers: [{ ticker: 'AAPL', market: 'us' }, { ticker: 'BHP.AX', market: 'asx' }],
    kind: 'adhoc', stagingUrl: STAGING, prodUrl: PROD }, h.deps);
  const order = h.log.filter(u => !u.endsWith('/store/parity')).map(u => `${u.startsWith(STAGING) ? 'S' : 'P'}:${u.split('/')[3]}:${u.split('/')[4].split('?')[0]}`);
  assert.deepEqual(order, [
    'S:quoteSummary:AAPL', 'S:timeseries:AAPL', 'S:history:AAPL', 'P:quoteSummary:AAPL', 'P:timeseries:AAPL', 'P:history:AAPL',
    'S:quoteSummary:BHP.AX', 'S:timeseries:BHP.AX', 'S:history:BHP.AX', 'P:quoteSummary:BHP.AX', 'P:timeseries:BHP.AX', 'P:history:BHP.AX',
  ]);
  assert.equal(h.posts.length, 1);
  assert.equal(h.posts[0].run.run_id, '2026-10-27T21:00Z-adhoc');
  assert.equal(h.posts[0].run.kind, 'adhoc');
  assert.equal(h.posts[0].run.tickers, 2);
  assert.equal(h.posts[0].run.passed, 2);
  assert.deepEqual(h.posts[0].results.map(r => r.symbol), ['AAPL', 'BHP.AX']);
  assert.equal(out.posted, true);
});

test('a staging store-miss is recorded, not passed', async () => {
  const h = harness({ stagingSource: 'store-miss' });
  await runParity({ tickers: [{ ticker: 'AAPL', market: 'us' }], kind: 'daily', stagingUrl: STAGING, prodUrl: PROD }, h.deps);
  assert.equal(h.posts[0].results[0].model_other, 'store-miss');
  assert.equal(h.posts[0].run.failed, 1);
});

test('results are posted in chunks, each repeating the run row', async () => {
  const h = harness();
  const tickers = Array.from({ length: 5 }, (_, i) => ({ ticker: `T${i}`, market: 'us' }));
  await runParity({ tickers, kind: 'bulk', universe: 'sp500', stagingUrl: STAGING, prodUrl: PROD, chunkSize: 2 }, h.deps);
  assert.equal(h.posts[0].run.run_id, '2026-10-27T21:00Z-bulk-sp500');
  assert.deepEqual(h.posts.map(p => p.results.length), [2, 2, 1]);
  assert.ok(h.posts.every(p => p.run.run_id === h.posts[0].run.run_id && p.run.tickers === 5));
});

test('a failed post is reported', async () => {
  const h = harness({ postStatus: 503 });
  const out = await runParity({ tickers: [{ ticker: 'AAPL', market: 'us' }], kind: 'daily', stagingUrl: STAGING, prodUrl: PROD }, h.deps);
  assert.equal(out.posted, false);
});

test('marketOf and runIdFor', () => {
  assert.equal(marketOf('AAPL'), 'us');
  assert.equal(marketOf('BHP.AX'), 'asx');
  assert.equal(marketOf('RELIANCE.NS'), 'nse');
  assert.equal(marketOf('005930.KS'), 'kospi');
  assert.equal(marketOf('7203.T'), 'nikkei');
  assert.equal(marketOf('MC.PA'), 'europe');
  assert.equal(marketOf('PETR4.SA'), 'brazil');
  assert.equal(marketOf('0700.HK'), 'hk');
  assert.equal(runIdFor(new Date('2026-10-27T21:05:59Z'), 'daily'), '2026-10-27T21:05Z-daily');
  assert.equal(runIdFor(new Date('2026-10-27T22:00:00Z'), 'bulk', 'asx'), '2026-10-27T22:00Z-bulk-asx', 'bulk universes never share a run_id');
});
