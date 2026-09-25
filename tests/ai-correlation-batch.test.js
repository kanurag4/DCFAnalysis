const { test } = require('node:test');
const assert = require('node:assert');
const { fetchDailyCloses, getAiCorrelations, addAiCorrelation } = require('../scripts/lib/ai-correlation-batch.js');

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
const hw = Array.from({ length: N }, (_, i) => 0.007 * Math.sin(i * 2.5 + 0.5));
const idio = Array.from({ length: N }, (_, i) => 0.005 * Math.sin(i * 3.3 + 2));

// AIQ carries the broad AI factor; SMH carries the separate hardware factor.
const SERIES = {
  AIQ: closesFromReturns(mkt.map((m, i) => m + ai[i])),
  SMH: closesFromReturns(mkt.map((m, i) => m + hw[i])),
  RSP: closesFromReturns(mkt),
  HIGHCO: closesFromReturns(mkt.map((m, i) => m + ai[i])),      // loads on the AI factor
  HWCO: closesFromReturns(mkt.map((m, i) => m + hw[i])),        // loads on the hardware factor
  INVCO: closesFromReturns(mkt.map((m, i) => m - ai[i])),       // moves AGAINST the AI factor
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
const opts = (fetchImpl, extra = {}) => ({ proxyUrl: 'https://w.example', fetchImpl, sleepImpl: noSleep, ...extra });

test('getAiCorrelations scores a stock against BOTH AIQ and SMH, and the two readings differ', async () => {
  const { fetchImpl } = makeFetch();
  const a = await getAiCorrelations('HIGHCO', opts(fetchImpl));
  assert.strictEqual(a.ai.band, 'high');
  assert.notStrictEqual(a.hardware.band, 'high');
  assert.ok(a.ai.n > 90 && a.hardware.n > 90);

  const b = await getAiCorrelations('HWCO', opts(fetchImpl));
  assert.strictEqual(b.hardware.band, 'high');
  assert.notStrictEqual(b.ai.band, 'high');
});

test('getAiCorrelations reports the inverse band for a stock that moves against the AI factor', async () => {
  const { fetchImpl } = makeFetch();
  const res = await getAiCorrelations('INVCO', opts(fetchImpl));
  assert.strictEqual(res.ai.band, 'inverse');
  assert.ok(res.ai.r < -0.2);
});

test('getAiCorrelations shares one cache so AIQ, RSP and SMH are each fetched once across tickers', async () => {
  const { fetchImpl, calls } = makeFetch();
  const cache = new Map();
  await getAiCorrelations('HIGHCO', opts(fetchImpl, { cache }));
  await getAiCorrelations('LOWCO', opts(fetchImpl, { cache }));
  for (const bench of ['AIQ', 'RSP', 'SMH']) assert.strictEqual(calls.filter(s => s === bench).length, 1, bench);
  assert.strictEqual(calls.filter(s => s === 'HIGHCO' || s === 'LOWCO').length, 2);
});

test('an empty benchmark result is never cached, so a transient failure is retried on the next ticker', async () => {
  const cache = new Map();
  const failing = makeFetch(SERIES, { emptyFor: ['AIQ'] });
  const first = await getAiCorrelations('HIGHCO', opts(failing.fetchImpl, { cache }));
  assert.strictEqual(first.ai.band, null);

  const healthy = makeFetch();
  const second = await getAiCorrelations('HIGHCO', opts(healthy.fetchImpl, { cache }));
  assert.strictEqual(second.ai.band, 'high');
});

test('one benchmark failing only nulls its own reading: SMH down keeps the AIQ reading, and vice versa', async () => {
  const smhDown = makeFetch(SERIES, { emptyFor: ['SMH'] });
  const a = await getAiCorrelations('HIGHCO', opts(smhDown.fetchImpl));
  assert.strictEqual(a.ai.band, 'high');
  assert.strictEqual(a.hardware.band, null);

  const aiqDown = makeFetch(SERIES, { emptyFor: ['AIQ'] });
  const b = await getAiCorrelations('HWCO', opts(aiqDown.fetchImpl));
  assert.strictEqual(b.ai.band, null);
  assert.strictEqual(b.hardware.band, 'high');
});

test('a recent IPO with too little history gets null for both readings', async () => {
  const { fetchImpl } = makeFetch();
  const res = await getAiCorrelations('NEWIPO', opts(fetchImpl));
  assert.deepStrictEqual([res.ai.band, res.hardware.band], [null, null]);
});

test('getAiCorrelations never throws: a failing fetch yields null for both readings', async () => {
  const { fetchImpl } = makeFetch(SERIES, { throwFor: ['HIGHCO'] });
  const res = await getAiCorrelations('HIGHCO', opts(fetchImpl));
  assert.deepStrictEqual(res, { ai: { r: null, n: 0, band: null }, hardware: { r: null, n: 0, band: null } });
});

test('getAiCorrelations sleeps throttleMs before every Worker call it makes, and not for a cache hit', async () => {
  const sleeps = [];
  const sleepImpl = async (ms) => { sleeps.push(ms); };
  const { fetchImpl, calls } = makeFetch();
  const cache = new Map();
  await getAiCorrelations('HIGHCO', { proxyUrl: 'https://w.example', cache, throttleMs: 1234, fetchImpl, sleepImpl });
  assert.strictEqual(calls.length, 4);           // stock + AIQ + RSP + SMH
  assert.deepStrictEqual(sleeps, [1234, 1234, 1234, 1234]);

  sleeps.length = 0;
  await getAiCorrelations('LOWCO', { proxyUrl: 'https://w.example', cache, throttleMs: 1234, fetchImpl, sleepImpl });
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
  assert.strictEqual((Number(p2) - Number(p1)) / 86400, 365);
});

test('fetchDailyCloses returns [] for a non-array body', async () => {
  assert.deepStrictEqual(await fetchDailyCloses('X', 'https://w.example', async () => null), []);
  assert.deepStrictEqual(await fetchDailyCloses('X', 'https://w.example', async () => ({ error: 'nope' })), []);
});

test('addAiCorrelation adds rounded aiCorrelation AND aiHardwareCorrelation per row, null for a row it cannot score, fetching each benchmark once', async () => {
  const { fetchImpl, calls } = makeFetch(SERIES, { throwFor: ['LOWCO'] });
  const rows = [{ ticker: 'HIGHCO', rank: 1 }, { ticker: 'LOWCO', rank: 2 }, { ticker: 'NEWIPO', rank: 3 }, { ticker: 'HWCO', rank: 4 }];
  const out = await addAiCorrelation(rows, opts(fetchImpl));

  assert.strictEqual(out.length, 4);
  assert.strictEqual(out[0].rank, 1);                                  // original fields preserved
  assert.strictEqual(out[0].aiCorrelation.band, 'high');
  assert.strictEqual(out[0].aiCorrelation.r, +out[0].aiCorrelation.r.toFixed(2)); // already 2dp
  assert.ok(out[0].aiCorrelation.n > 90);
  assert.ok(out[0].aiHardwareCorrelation && typeof out[0].aiHardwareCorrelation.r === 'number');
  assert.strictEqual(out[1].aiCorrelation, null);                      // its fetch threw
  assert.strictEqual(out[1].aiHardwareCorrelation, null);
  assert.strictEqual(out[2].aiCorrelation, null);                      // too little history
  assert.strictEqual(out[2].aiHardwareCorrelation, null);
  assert.strictEqual(out[3].aiHardwareCorrelation.band, 'high');
  for (const bench of ['AIQ', 'RSP', 'SMH']) assert.strictEqual(calls.filter(s => s === bench).length, 1, bench);
});

// --- carry-forward: a transient fetch failure must not wipe out last run's reading ---
const PRIOR = { r: 0.55, n: 240, band: 'high' };
const PRIOR_HW = { r: -0.31, n: 240, band: 'inverse' };

test('addAiCorrelation keeps a row\'s existing readings when the fetch fails this run', async () => {
  const { fetchImpl } = makeFetch(SERIES, { throwFor: ['LOWCO'] });
  const rows = [{ ticker: 'LOWCO', aiCorrelation: PRIOR, aiHardwareCorrelation: PRIOR_HW }];
  const out = await addAiCorrelation(rows, opts(fetchImpl));
  assert.deepStrictEqual(out[0].aiCorrelation, PRIOR);
  assert.deepStrictEqual(out[0].aiHardwareCorrelation, PRIOR_HW);
});

test('addAiCorrelation keeps only the reading that failed: one benchmark down keeps its own prior value and refreshes the other', async () => {
  const { fetchImpl } = makeFetch(SERIES, { emptyFor: ['SMH'] });
  const rows = [{ ticker: 'HIGHCO', aiCorrelation: { r: 0.1, n: 200, band: 'low' }, aiHardwareCorrelation: PRIOR_HW }];
  const out = await addAiCorrelation(rows, opts(fetchImpl));
  assert.strictEqual(out[0].aiCorrelation.band, 'high');                 // refreshed
  assert.deepStrictEqual(out[0].aiHardwareCorrelation, PRIOR_HW);        // SMH fetch failed -> prior kept
});

test('addAiCorrelation replaces a prior reading when the new one is real, and stays null with no prior reading', async () => {
  const { fetchImpl } = makeFetch(SERIES, { throwFor: ['LOWCO'] });
  const rows = [
    { ticker: 'HIGHCO', aiCorrelation: { r: 0.05, n: 100, band: 'low' }, aiHardwareCorrelation: null },
    { ticker: 'LOWCO' },                                                  // no prior fields at all
    { ticker: 'NEWIPO', aiCorrelation: null, aiHardwareCorrelation: null },
  ];
  const out = await addAiCorrelation(rows, opts(fetchImpl));
  assert.strictEqual(out[0].aiCorrelation.band, 'high');
  assert.strictEqual(out[1].aiCorrelation, null);
  assert.strictEqual(out[1].aiHardwareCorrelation, null);
  assert.strictEqual(out[2].aiCorrelation, null);
});

// --- adjusted closes ---
test('fetchDailyCloses prefers the dividend-adjusted close when every point has one', async () => {
  const fetchImpl = async () => [
    { date: '2026-03-01', close: 100, adjClose: 90 },
    { date: '2026-03-02', close: 97, adjClose: 90 },   // ex-dividend day: the raw close drops, the adjusted one does not
  ];
  assert.deepStrictEqual(await fetchDailyCloses('X', 'https://w.example', fetchImpl),
    [{ date: '2026-03-01', close: 90 }, { date: '2026-03-02', close: 90 }]);
});

test('fetchDailyCloses uses the plain closes for the WHOLE series when any adjusted close is missing (never mixes the two)', async () => {
  const fetchImpl = async () => [
    { date: '2026-03-01', close: 100, adjClose: 90 },
    { date: '2026-03-02', close: 101 },                // no adjClose (old Worker, or Yahoo omitted it)
    { date: '2026-03-03', close: 102, adjClose: 92 },
  ];
  assert.deepStrictEqual((await fetchDailyCloses('X', 'https://w.example', fetchImpl)).map((p) => p.close), [100, 101, 102]);
});

// --- reusing a stock history the caller already fetched (the ticker-page generators fetch 730d for the price chart) ---
const NOW = Date.parse('2026-07-06T00:00:00Z');
const LONG_N = 400;
const longMkt = Array.from({ length: LONG_N }, (_, i) => 0.004 * Math.sin(i * 0.7));
const longAi = Array.from({ length: LONG_N }, (_, i) => 0.006 * Math.sin(i * 1.9 + 1));
// 401 daily bars ending 2026-07-06 (start 2025-06-01), i.e. ~35 days more than the 365-day correlation window.
const LONG = {
  AIQ: closesFromReturns(longMkt.map((m, i) => m + longAi[i]), '2025-06-01'),
  SMH: closesFromReturns(longMkt.map((m, i) => m + longAi[i] * 0.5), '2025-06-01'),
  RSP: closesFromReturns(longMkt, '2025-06-01'),
  STOCK: closesFromReturns(longMkt.map((m, i) => m + longAi[i]), '2025-06-01'),
};

test('getAiCorrelations reuses a supplied stockHistory: the stock is not fetched again and one throttle sleep is saved', async () => {
  const sleeps = [];
  const sleepImpl = async (ms) => { sleeps.push(ms); };
  const { fetchImpl, calls } = makeFetch(SERIES);
  const res = await getAiCorrelations('HIGHCO', {
    proxyUrl: 'https://w.example', throttleMs: 1234, fetchImpl, sleepImpl, nowMs: Date.parse('2026-06-01T00:00:00Z'),
    stockHistory: SERIES.HIGHCO,
  });
  assert.deepStrictEqual(calls, ['AIQ', 'RSP', 'SMH']);          // no HIGHCO fetch
  assert.deepStrictEqual(sleeps, [1234, 1234, 1234]);
  assert.strictEqual(res.ai.band, 'high');

  const refetched = await getAiCorrelations('HIGHCO', opts(makeFetch(SERIES).fetchImpl));
  assert.deepStrictEqual(res, refetched);                         // identical answer either way
});

test('a supplied stockHistory is trimmed to the trailing 365 days, so a 730-day chart series cannot widen the window', async () => {
  const fetchImpl = async (url) => LONG[decodeURIComponent(url.match(/\/history\/([^?]+)\?/)[1])] || [];
  const res = await getAiCorrelations('STOCK', { proxyUrl: 'https://w.example', fetchImpl, sleepImpl: noSleep, nowMs: NOW, stockHistory: LONG.STOCK });
  assert.ok(res.ai.n <= 365, `n=${res.ai.n} should not exceed the 365-day window`);
  assert.ok(res.ai.n >= 360, `n=${res.ai.n} should still cover almost the whole trailing year`);
});

test('an empty stockHistory (transient chart-fetch failure) falls back to the helper\'s own fetch instead of skipping the reading', async () => {
  const { fetchImpl, calls } = makeFetch(SERIES);
  const res = await getAiCorrelations('HIGHCO', opts(fetchImpl, { stockHistory: [] }));
  assert.ok(calls.includes('HIGHCO'));
  assert.strictEqual(res.ai.band, 'high');
});

test('a stockHistory that is entirely outside the window also falls back to a fetch', async () => {
  const { fetchImpl, calls } = makeFetch(SERIES);
  const res = await getAiCorrelations('HIGHCO', opts(fetchImpl, { stockHistory: SERIES.HIGHCO, nowMs: Date.parse('2030-01-01T00:00:00Z') }));
  assert.ok(calls.includes('HIGHCO'));
  assert.strictEqual(res.ai.band, 'high');
});
