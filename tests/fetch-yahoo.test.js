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
  // 2 failed quoteSummary attempts + 1 successful one + 1 best-effort /timeseries enrichment call.
  assert.strictEqual(calls, 4);
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

test('fetchSymbol sends X-KV-Batch-Key when KV_BATCH_KEY is set (admin-console batch auth)', async () => {
  const stubBody = { quoteSummary: { result: [{ quoteType: { longName: 'Batch Co' },
    financialData: { currentPrice: { raw: 5 } }, summaryDetail: { currency: 'USD' },
    defaultKeyStatistics: {}, assetProfile: {} }] } };
  let capturedHeaders = null;
  const fakeFetch = async (url, opts) => {
    capturedHeaders = opts && opts.headers;
    return { ok: true, status: 200, json: async () => stubBody };
  };
  const prev = process.env.KV_BATCH_KEY;
  process.env.KV_BATCH_KEY = 'test-secret';
  try {
    await fetchSymbol('BATCH', { fetchImpl: fakeFetch, proxyUrl: 'https://x' });
  } finally {
    if (prev === undefined) delete process.env.KV_BATCH_KEY; else process.env.KV_BATCH_KEY = prev;
  }
  assert.deepStrictEqual(capturedHeaders, { 'X-KV-Batch-Key': 'test-secret' });
});

test('fetchSymbol enriches from /timeseries: annualFcf fallback when quoteSummary FCF fields are empty (TECHM.NS-style gap)', async () => {
  const qsBody = { quoteSummary: { result: [{ quoteType: { longName: 'Tech Mahindra' },
    financialData: { currentPrice: { raw: 100 }, freeCashflow: {}, operatingCashflow: {} },
    summaryDetail: { currency: 'INR' }, defaultKeyStatistics: {}, assetProfile: {} }] } };
  const tsBody = { annualFreeCashFlow: [{ date: '2025-03-31', value: 51922000000 }, { date: '2026-03-31', value: 54763000000 }] };
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('/timeseries/')) return { ok: true, status: 200, json: async () => tsBody };
    return { ok: true, status: 200, json: async () => qsBody };
  };
  const d = await fetchSymbol('TECHM.NS', { fetchImpl: fakeFetch, proxyUrl: 'https://x' });
  assert.strictEqual(calls.length, 2);
  assert.ok(calls[1].includes('/timeseries/TECHM.NS'));
  assert.strictEqual(d.freeCashflow, null); // quoteSummary tier stays empty
  assert.strictEqual(d.annualFcf, 54763000000); // latest point, not the earlier one
});

test('fetchSymbol enrichment also carries dilutedSharesOutstanding/ebit and prefers timeseries interestExpense', async () => {
  const qsBody = { quoteSummary: { result: [{ quoteType: { longName: 'Enrich Co' },
    financialData: { currentPrice: { raw: 10 } }, summaryDetail: { currency: 'USD' },
    defaultKeyStatistics: { sharesOutstanding: { raw: 100 } },
    incomeStatementHistory: { incomeStatementHistory: [{ interestExpense: {} }] }, // empty, like many non-US tickers
    assetProfile: {} }] } };
  const tsBody = {
    annualDilutedAverageShares: [{ date: '2026-03-31', value: 120 }],
    annualOperatingIncome: [{ date: '2026-03-31', value: 500 }],
    annualInterestExpense: [{ date: '2026-03-31', value: 40 }], // positive magnitude in the raw series
  };
  const fakeFetch = async (url) => (url.includes('/timeseries/')
    ? { ok: true, status: 200, json: async () => tsBody }
    : { ok: true, status: 200, json: async () => qsBody });
  const d = await fetchSymbol('ENR.NS', { fetchImpl: fakeFetch, proxyUrl: 'https://x' });
  assert.strictEqual(d.dilutedSharesOutstanding, 120);
  assert.strictEqual(d.ebit, 500);
  assert.strictEqual(d.interestExpense, -40); // negated to match the expense-convention sign
});

test('fetchSymbol still returns the mapped quoteSummary result when /timeseries itself fails (best-effort, never blocks)', async () => {
  const qsBody = { quoteSummary: { result: [{ quoteType: { longName: 'Solo Co' },
    financialData: { currentPrice: { raw: 5 }, freeCashflow: { raw: 10 } },
    summaryDetail: { currency: 'USD' }, defaultKeyStatistics: {}, assetProfile: {} }] } };
  const fakeFetch = async (url) => (url.includes('/timeseries/')
    ? { ok: false, status: 500, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => qsBody });
  const d = await fetchSymbol('SOLO', { fetchImpl: fakeFetch, proxyUrl: 'https://x' });
  assert.strictEqual(d.name, 'Solo Co');
  assert.strictEqual(d.freeCashflow, 10);
  assert.strictEqual(d.annualFcf, undefined);
});

test('fetchSymbol carries the full annualFcfHistory/annualRevenueHistory arrays for cyclical normalization, not just the latest entry', async () => {
  const qsBody = { quoteSummary: { result: [{ quoteType: { longName: 'BHP Group' },
    financialData: { currentPrice: { raw: 42 } }, summaryDetail: { currency: 'AUD' },
    defaultKeyStatistics: {}, assetProfile: { sector: 'Basic Materials', industry: 'Other Industrial Metals & Mining' } }] } };
  const tsBody = {
    annualFreeCashFlow: [
      { date: '2023-06-30', value: 11968000000 },
      { date: '2026-06-30', value: 11929000000 },
    ],
    annualTotalRevenue: [
      { date: '2023-06-30', value: 53817000000 },
      { date: '2026-06-30', value: 58760000000 },
    ],
  };
  const fakeFetch = async (url) => (url.includes('/timeseries/')
    ? { ok: true, status: 200, json: async () => tsBody }
    : { ok: true, status: 200, json: async () => qsBody });
  const d = await fetchSymbol('BHP.AX', { fetchImpl: fakeFetch, proxyUrl: 'https://x' });
  assert.strictEqual(d.annualFcfHistory.length, 2);
  assert.strictEqual(d.annualRevenueHistory.length, 2);
  assert.strictEqual(d.annualFcfHistory[0].value, 11968000000);
  assert.strictEqual(d.annualRevenueHistory[1].value, 58760000000);
});

test('fetchSymbol defaults annualFcfHistory/annualRevenueHistory to empty arrays when /timeseries fails', async () => {
  const qsBody = { quoteSummary: { result: [{ quoteType: { longName: 'Solo Co' },
    financialData: { currentPrice: { raw: 5 } },
    summaryDetail: { currency: 'USD' }, defaultKeyStatistics: {}, assetProfile: {} }] } };
  const fakeFetch = async (url) => (url.includes('/timeseries/')
    ? { ok: false, status: 500, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => qsBody });
  const d = await fetchSymbol('SOLO', { fetchImpl: fakeFetch, proxyUrl: 'https://x' });
  assert.deepStrictEqual(d.annualFcfHistory, []);
  assert.deepStrictEqual(d.annualRevenueHistory, []);
});

test('fetchSymbol carries annualNetIncome/annualStockholdersEquity/annualCashDividendsPaid history for the multi-year growth seed', async () => {
  const qsBody = { quoteSummary: { result: [{ quoteType: { longName: 'Test Co' },
    financialData: { currentPrice: { raw: 42 } }, summaryDetail: { currency: 'USD' },
    defaultKeyStatistics: {}, assetProfile: { sector: 'Technology', industry: 'Software—Infrastructure' } }] } };
  const tsBody = {
    annualNetIncome: [{ date: '2024-12-31', value: 4e9 }, { date: '2025-12-31', value: 5e9 }],
    annualStockholdersEquity: [{ date: '2024-12-31', value: 20e9 }, { date: '2025-12-31', value: 24e9 }],
    annualCashDividendsPaid: [{ date: '2024-12-31', value: -1e9 }, { date: '2025-12-31', value: -1.2e9 }],
  };
  const fakeFetch = async (url) => (url.includes('/timeseries/')
    ? { ok: true, status: 200, json: async () => tsBody }
    : { ok: true, status: 200, json: async () => qsBody });
  const d = await fetchSymbol('TEST', { fetchImpl: fakeFetch, proxyUrl: 'https://x' });
  assert.strictEqual(d.annualNetIncomeHistory.length, 2);
  assert.strictEqual(d.annualStockholdersEquityHistory.length, 2);
  assert.strictEqual(d.annualDividendsPaidHistory.length, 2);
  assert.strictEqual(d.annualNetIncomeHistory[1].value, 5e9);
  assert.strictEqual(d.annualDividendsPaidHistory[0].value, -1e9);
});

test('fetchSymbol defaults annualNetIncome/annualStockholdersEquity/annualCashDividendsPaid history to empty arrays when /timeseries fails', async () => {
  const qsBody = { quoteSummary: { result: [{ quoteType: { longName: 'Solo Co' },
    financialData: { currentPrice: { raw: 5 } },
    summaryDetail: { currency: 'USD' }, defaultKeyStatistics: {}, assetProfile: {} }] } };
  const fakeFetch = async (url) => (url.includes('/timeseries/')
    ? { ok: false, status: 500, json: async () => ({}) }
    : { ok: true, status: 200, json: async () => qsBody });
  const d = await fetchSymbol('SOLO', { fetchImpl: fakeFetch, proxyUrl: 'https://x' });
  assert.deepStrictEqual(d.annualNetIncomeHistory, []);
  assert.deepStrictEqual(d.annualStockholdersEquityHistory, []);
  assert.deepStrictEqual(d.annualDividendsPaidHistory, []);
});

test('fetchSymbol sends no batch-key header when KV_BATCH_KEY is unset (dev-machine runs stay unauthenticated)', async () => {
  let capturedHeaders = 'not-called';
  const fakeFetch = async (url, opts) => {
    capturedHeaders = opts && opts.headers;
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const prev = process.env.KV_BATCH_KEY;
  delete process.env.KV_BATCH_KEY;
  try {
    await fetchSymbol('NOKEY', { fetchImpl: fakeFetch, proxyUrl: 'https://x' });
  } finally {
    if (prev !== undefined) process.env.KV_BATCH_KEY = prev;
  }
  assert.deepStrictEqual(capturedHeaders, {});
});
