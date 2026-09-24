// scripts/lib/ai-correlation-batch.js
// Fetch + compute AI Sector Correlation (see
// docs/superpowers/specs/2026-09-23-ai-sector-correlation-design.md) for the
// per-ticker page generators and the undervalued-screen batch. fetchImpl /
// sleepImpl are injectable so tests never touch the network or wait.
//
//   getAiCorrelation(symbol, opts)  -> { r, n, band }  (band null = not shown)
//   addAiCorrelation(rows, opts)    -> rows + aiCorrelation: {r,n,band} | null
//
// Both never throw. Every Worker call is preceded by a `throttleMs` sleep, so
// a caller that just made its own Worker call is never hit back-to-back (see
// CLAUDE.md Known Traps: unspaced per-ticker bursts caused HTTP 429s).
const { partialCorrelation, AI_ETF_TICKER, MARKET_ETF_TICKER } = require('../../www/calc/aiCorrelation.js');
const { batchHeaders } = require('./batch-auth.js');

const DEFAULT_THROTTLE_MS = 3200;
const DEFAULT_FETCH = async (url) => {
  const res = await fetch(url, { headers: batchHeaders() });
  if (!res || !res.ok) return null;
  return res.json();
};
const DEFAULT_SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

// Trailing 365 days of daily closes, ascending: [{ date: 'YYYY-MM-DD', close }].
// `symbol` must be the resolved Yahoo symbol (with .AX/.KS/... suffix).
async function fetchDailyCloses(symbol, proxyUrl, fetchImpl = DEFAULT_FETCH) {
  const now = Math.floor(Date.now() / 1000);
  const period1 = now - 365 * 24 * 60 * 60;
  const url = `${proxyUrl.replace(/\/$/, '')}/history/${encodeURIComponent(symbol)}?period1=${period1}&period2=${now}`;
  const points = await fetchImpl(url);
  if (!Array.isArray(points)) return [];
  return points
    .filter((p) => p && p.date && p.close != null)
    .map((p) => ({ date: p.date, close: p.close }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// `cache` (a Map) is shared across a whole batch run so AIQ/RSP are fetched
// once, not per ticker. Only non-empty benchmark series are cached: an empty
// result is a transient failure, and caching it would null every remaining
// ticker in the run.
async function getAiCorrelation(symbol, { proxyUrl, cache, throttleMs = DEFAULT_THROTTLE_MS, fetchImpl, sleepImpl = DEFAULT_SLEEP } = {}) {
  const load = async (sym, isBenchmark) => {
    if (isBenchmark && cache && cache.has(sym)) return cache.get(sym);
    await sleepImpl(throttleMs);
    const closes = await fetchDailyCloses(sym, proxyUrl, fetchImpl);
    if (isBenchmark && cache && closes.length) cache.set(sym, closes);
    return closes;
  };
  try {
    const stock = await load(symbol, false);
    const aiq = await load(AI_ETF_TICKER, true);
    const rsp = await load(MARKET_ETF_TICKER, true);
    return partialCorrelation({ stock, aiq, rsp });
  } catch (_) {
    return { r: null, n: 0, band: null };
  }
}

async function addAiCorrelation(rows, opts = {}) {
  const cache = opts.cache || new Map();
  const out = [];
  for (const row of rows) {
    const res = await getAiCorrelation(row.ticker, { ...opts, cache });
    out.push({
      ...row,
      aiCorrelation: res.band == null ? null : { r: +res.r.toFixed(2), n: res.n, band: res.band },
    });
  }
  return out;
}

module.exports = { fetchDailyCloses, getAiCorrelation, addAiCorrelation };
