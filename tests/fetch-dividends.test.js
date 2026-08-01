const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { fetchDividends } = require('../scripts/lib/fetch-dividends.js');

function fakeRes(body, ok = true) {
  return { ok, json: async () => body };
}

describe('fetchDividends', () => {
  it('returns only events strictly after fromISO and on/before toISO', async () => {
    const body = [
      { date: '2026-06-01', amount: 0.10 }, // == fromISO → excluded
      { date: '2026-06-15', amount: 0.20 }, // in window → included
      { date: '2026-07-01', amount: 0.30 }, // == toISO → included
      { date: '2026-07-02', amount: 0.40 }, // after toISO → excluded
    ];
    const events = await fetchDividends('AAA.AX', '2026-06-01', '2026-07-01', {
      proxyUrl: 'https://x', fetchImpl: async () => fakeRes(body),
    });
    assert.deepEqual(events, [
      { date: '2026-06-15', amount: 0.20 },
      { date: '2026-07-01', amount: 0.30 },
    ]);
  });

  it('returns [] when the response is not ok', async () => {
    const events = await fetchDividends('AAA.AX', '2026-06-01', '2026-07-01', {
      proxyUrl: 'https://x', fetchImpl: async () => fakeRes([], false),
    });
    assert.deepEqual(events, []);
  });

  it('returns [] when fetch throws', async () => {
    const events = await fetchDividends('AAA.AX', '2026-06-01', '2026-07-01', {
      proxyUrl: 'https://x', fetchImpl: async () => { throw new Error('network'); },
    });
    assert.deepEqual(events, []);
  });

  it('sends period1/period2 as unix seconds derived from the ISO dates', async () => {
    let calledUrl = '';
    await fetchDividends('AAA.AX', '2026-06-01', '2026-07-01', {
      proxyUrl: 'https://x/', fetchImpl: async (url) => { calledUrl = url; return fakeRes([]); },
    });
    // 2026-06-01 = 1780272000, 2026-07-01 = 1782864000 (UTC midnight)
    assert.match(calledUrl, /\/dividends\/AAA\.AX\?period1=1780272000&period2=1782864000$/);
  });

  it('sends X-KV-Batch-Key when KV_BATCH_KEY is set (admin-console batch auth)', async () => {
    let capturedHeaders = null;
    const prev = process.env.KV_BATCH_KEY;
    process.env.KV_BATCH_KEY = 'test-secret';
    try {
      await fetchDividends('AAA.AX', '2026-06-01', '2026-07-01', {
        proxyUrl: 'https://x', fetchImpl: async (url, opts) => { capturedHeaders = opts && opts.headers; return fakeRes([]); },
      });
    } finally {
      if (prev === undefined) delete process.env.KV_BATCH_KEY; else process.env.KV_BATCH_KEY = prev;
    }
    assert.deepEqual(capturedHeaders, { 'X-KV-Batch-Key': 'test-secret' });
  });

  it('sends no batch-key header when KV_BATCH_KEY is unset', async () => {
    let capturedHeaders = 'not-called';
    const prev = process.env.KV_BATCH_KEY;
    delete process.env.KV_BATCH_KEY;
    try {
      await fetchDividends('AAA.AX', '2026-06-01', '2026-07-01', {
        proxyUrl: 'https://x', fetchImpl: async (url, opts) => { capturedHeaders = opts && opts.headers; return fakeRes([]); },
      });
    } finally {
      if (prev !== undefined) process.env.KV_BATCH_KEY = prev;
    }
    assert.deepEqual(capturedHeaders, {});
  });
});
