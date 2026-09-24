const { test } = require('node:test');
const assert = require('node:assert');
const { fetchDailyCloses, getAiCorrelation, addAiCorrelation } = require('../scripts/lib/ai-correlation-batch.js');

// --- deterministic fixtures (same factor shapes as aiCorrelation.test.js) ---
function closesFromReturns(returns, startDate = '2026-01-01') {
  let price = 100;
  const out = [{ date: startDate, close: price }];
  const start = new Date(startDate + 'T00:00:00Z');
  for (let i = 0; i < returns.length; i++) {
    price = price * (1 + returns[i]);
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i + 1);
    out.push({ date: d.toISOString().slice(0, 10), close: price });
  }
  return out;
}
const N = 120;
const mkt = Array.from({ length: N }, (_, i) => 0.004 * Math.sin(i * 0.7));
const ai = Array.from({ length: N }, (_, i) => 0.006 * Math.sin(i * 1.9 + 1));
const idio = Array.from({ length: N }, (_, i) => 0.005 * Math.sin(i * 3.3 + 2));

const SERIES = {
  AIQ: closesFromReturns(mkt.map((m, i) => m + ai[i])),
  RSP: closesFromReturns(mkt),
  HIGHCO: closesFromReturns(mkt.map((m, i) => m + ai[i])),
  LOWCO: closesFromReturns(mkt.map((m, i) => m + idio[i])),
  NEWIPO: closesFromReturns(mkt.slice(0, 30)),
};

// fetchImpl stand-in for the Worker: parses the symbol out of /history/<sym>?...
// and records every call so tests can assert on call counts.
function makeFetch(series = SERIES, { throwFor = [], emptyFor = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    const sym = decodeURIComponent(url.match(/\/history\/([^?]+)\?/)[1]);
    calls.push(sym);
    if (throwFor.includes(sym)) throw new Error(`boom ${sym}`);
    if (emptyFor.includes(sym)) return [];
    return series[sym] || [];
  };
  return { fetchImpl, calls };
}
const noSleep = async () => {};

test('getAiCorrelation returns a high band for a stock sharing AIQ\'s AI-specific component', async () => {
  const { fetchImpl } = makeFetch();
  const res = await getAiCorrelation('HIGHCO', { proxyUrl: 'https://w.example', fetchImpl, sleepImpl: noSleep });
  assert.strictEqual(res.band, 'high');
  assert.ok(res.n > 90);
});

test('getAiCorrelation shares one cache so AIQ and RSP are fetched once across tickers', async () => {
  const { fetchImpl, calls } = makeFetch();
  const cache = new Map();
  await getAiCorrelation('HIGHCO', { proxyUrl: 'https://w.example', cache, fetchImpl, sleepImpl: noSleep });
  await getAiCorrelation('LOWCO', { proxyUrl: 'https://w.example', cache, fetchImpl, sleepImpl: noSleep });
  assert.strictEqual(calls.filter(s => s === 'AIQ').length, 1);
  assert.strictEqual(calls.filter(s => s === 'RSP').length, 1);
  assert.strictEqual(calls.filter(s => s === 'HIGHCO' || s === 'LOWCO').length, 2);
});

test('getAiCorrelation does not cache an empty benchmark result, so a transient AIQ failure is retried on the next ticker', async () => {
  const cache = new Map();
  const failing = makeFetch(SERIES, { emptyFor: ['AIQ'] });
  const first = await getAiCorrelation('HIGHCO', { proxyUrl: 'https://w.example', cache, fetchImpl: failing.fetchImpl, sleepImpl: noSleep });
  assert.strictEqual(first.band, null);

  const healthy = makeFetch();
  const second = await getAiCorrelation('HIGHCO', { proxyUrl: 'https://w.example', cache, fetchImpl: healthy.fetchImpl, sleepImpl: noSleep });
  assert.strictEqual(second.band, 'high');
});

test('getAiCorrelation returns a null band for a recent IPO with too little history', async () => {
  const { fetchImpl } = makeFetch();
  const res = await getAiCorrelation('NEWIPO', { proxyUrl: 'https://w.example', fetchImpl, sleepImpl: noSleep });
  assert.strictEqual(res.band, null);
  assert.strictEqual(res.r, null);
});

test('getAiCorrelation never throws: a failing fetch yields a null result', async () => {
  const { fetchImpl } = makeFetch(SERIES, { throwFor: ['HIGHCO'] });
  const res = await getAiCorrelation('HIGHCO', { proxyUrl: 'https://w.example', fetchImpl, sleepImpl: noSleep });
  assert.deepStrictEqual(res, { r: null, n: 0, band: null });
});

test('getAiCorrelation sleeps throttleMs before every Worker call it makes, and not for a cache hit', async () => {
  const sleeps = [];
  const sleepImpl = async (ms) => { sleeps.push(ms); };
  const { fetchImpl, calls } = makeFetch();
  const cache = new Map();
  await getAiCorrelation('HIGHCO', { proxyUrl: 'https://w.example', cache, throttleMs: 1234, fetchImpl, sleepImpl });
  assert.strictEqual(calls.length, 3);           // stock + AIQ + RSP
  assert.deepStrictEqual(sleeps, [1234, 1234, 1234]);

  sleeps.length = 0;
  await getAiCorrelation('LOWCO', { proxyUrl: 'https://w.example', cache, throttleMs: 1234, fetchImpl, sleepImpl });
  assert.deepStrictEqual(sleeps, [1234]);        // benchmarks cached: only the ticker's own call
});

test('fetchDailyCloses drops null closes, sorts ascending, URL-encodes the symbol, and asks for ~365 days', async () => {
  let seenUrl = '';
  const fetchImpl = async (url) => {
    seenUrl = url;
    return [
      { date: '2026-03-03', close: 3 },
      { date: '2026-03-01', close: 1 },
      { date: '2026-03-02', close: null },
      null,
    ];
  };
  const out = await fetchDailyCloses('^GSPC', 'https://w.example/', fetchImpl);
  assert.deepStrictEqual(out, [{ date: '2026-03-01', close: 1 }, { date: '2026-03-03', close: 3 }]);
  assert.match(seenUrl, /^https:\/\/w\.example\/history\/%5EGSPC\?period1=\d+&period2=\d+$/);
  const [, p1, p2] = seenUrl.match(/period1=(\d+)&period2=(\d+)/);
  const days = (Number(p2) - Number(p1)) / 86400;
  assert.strictEqual(days, 365);
});

test('fetchDailyCloses returns [] for a non-array body', async () => {
  assert.deepStrictEqual(await fetchDailyCloses('X', 'https://w.example', async () => null), []);
  assert.deepStrictEqual(await fetchDailyCloses('X', 'https://w.example', async () => ({ error: 'nope' })), []);
});

test('addAiCorrelation adds a rounded { r, n, band } per row, null for a row it cannot score, and fetches AIQ/RSP once', async () => {
  const { fetchImpl, calls } = makeFetch(SERIES, { throwFor: ['LOWCO'] });
  const rows = [{ ticker: 'HIGHCO', rank: 1 }, { ticker: 'LOWCO', rank: 2 }, { ticker: 'NEWIPO', rank: 3 }];
  const out = await addAiCorrelation(rows, { proxyUrl: 'https://w.example', fetchImpl, sleepImpl: noSleep });

  assert.strictEqual(out.length, 3);
  assert.strictEqual(out[0].rank, 1);                       // original fields preserved
  assert.strictEqual(out[0].aiCorrelation.band, 'high');
  assert.strictEqual(out[0].aiCorrelation.r, +out[0].aiCorrelation.r.toFixed(2)); // already 2dp
  assert.ok(out[0].aiCorrelation.n > 90);
  assert.strictEqual(out[1].aiCorrelation, null);           // its fetch threw
  assert.strictEqual(out[2].aiCorrelation, null);           // too little history
  assert.strictEqual(calls.filter(s => s === 'AIQ').length, 1);
  assert.strictEqual(calls.filter(s => s === 'RSP').length, 1);
});
