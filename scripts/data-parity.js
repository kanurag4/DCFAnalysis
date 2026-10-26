// scripts/data-parity.js — own market-data store (P50) parity job.
//
// For each ticker: value it from the STAGING Worker (answers from the store, X-KV-Source says whether it did)
// and then from the PRODUCTION Worker (Yahoo), with the real screen pipeline (fetchSymbol -> convertFinancials
// -> evaluateStock), compare, and POST the results to production's /store/parity (D1 parity_runs/_results,
// shown in the admin console). Staging goes FIRST: the production fetch shadow-writes into the store, so the
// other order would compare the store with the response it had just copied.
//
//   node scripts/data-parity.js --tickers=AAPL,BHP.AX --kind=adhoc
//   node scripts/data-parity.js --kind=daily                       (scripts/data-parity-tickers.json)
//   node scripts/data-parity.js --kind=bulk --universe=asx         (scripts/asx300.json etc.)
//
// Env: STAGING_PROXY_URL, PROD_PROXY_URL, KV_BATCH_KEY (sent via batchHeaders()).
// FX conversion uses production for both sides, so only the store data differs between them.

const fs = require('node:fs');
const path = require('node:path');
const { fetchSymbol } = require('./fetch-yahoo.js');
const { convertFinancials } = require('./lib/convert-financials.js');
const { evaluateStock } = require('./lib/evaluate.js');
const { marketParamsFor } = require('./lib/market.js');
const { batchHeaders } = require('./lib/batch-auth.js');
const { compareTicker, historyDiffs, summarise } = require('./lib/parity.js');

const UNIVERSES = {
  asx: 'asx300.json', sp500: 'sp500.json', nifty: 'nifty500.json',
  kospi: 'kospi200.json', nikkei: 'nikkei225.json', europe: 'europe600.json',
};
const TICKER_GAP_MS = 3200;
const CHUNK_SIZE = 200; // results per POST, keeps each ingest request small for the Worker
const HISTORY_DAYS = 365; // the AI Sector Correlation window

const sleep = ms => new Promise(r => setTimeout(r, ms));

function marketOf(ticker) {
  const t = String(ticker).toUpperCase();
  const dot = t.lastIndexOf('.');
  if (dot === -1) return 'us';
  const sfx = t.slice(dot + 1);
  if (sfx === 'AX') return 'asx';
  if (sfx === 'NS' || sfx === 'BO') return 'nse';
  if (sfx === 'KS' || sfx === 'KQ') return 'kospi';
  if (sfx === 'T') return 'nikkei';
  if (sfx === 'SA') return 'brazil';
  if (sfx === 'HK') return 'hk';
  return 'europe';
}

function runIdFor(date, kind) {
  return `${date.toISOString().slice(0, 16)}Z-${kind}`;
}

// A fetch wrapper that remembers which source answered each route (staging's X-KV-Source header).
function recordingFetch(fetchImpl, sources) {
  return async (url, opts) => {
    const res = await fetchImpl(url, opts);
    const route = String(url).split('/')[3];
    if (res && res.headers) sources[route] = res.headers.get('X-KV-Source') || 'none';
    return res;
  };
}

async function fetchHistory(fetchImpl, proxyUrl, ticker, nowSec) {
  const url = `${proxyUrl}/history/${encodeURIComponent(ticker)}?period1=${nowSec - HISTORY_DAYS * 86400}&period2=${nowSec}`;
  try {
    const res = await fetchImpl(url, { headers: batchHeaders() });
    if (!res || !res.ok) return null;
    const body = await res.json();
    return Array.isArray(body) ? body : null;
  } catch (_) {
    return null;
  }
}

async function valueFrom(proxyUrl, ticker, { fetchImpl, fetchSymbolImpl, convertImpl, evaluateImpl, fxUrl, fxCache, nowSec, spacing, sleepImpl }) {
  let data = await fetchSymbolImpl(ticker, { proxyUrl, fetchImpl, retries: 1, backoffMs: 4000 });
  if (data) data = await convertImpl(data, { proxyUrl: fxUrl, fxCache });
  await sleepImpl(spacing);
  const history = await fetchHistory(fetchImpl, proxyUrl, ticker, nowSec);
  const result = data ? evaluateImpl(data, marketParamsFor(ticker, {})) : null;
  return { data, result, history };
}

async function runParity({ tickers, kind, stagingUrl, prodUrl, chunkSize = CHUNK_SIZE }, deps = {}) {
  const {
    fetchImpl = fetch, fetchSymbolImpl = fetchSymbol, convertImpl = convertFinancials, evaluateImpl = evaluateStock,
    sleepImpl = sleep, now = () => new Date(), log = () => {},
  } = deps;
  const spacing = batchHeaders()['X-KV-Batch-Key'] ? 250 : TICKER_GAP_MS;
  const started = now();
  const nowSec = Math.floor(started.getTime() / 1000);
  const fxCache = new Map();
  const results = [];
  for (let i = 0; i < tickers.length; i++) {
    const { ticker, market } = tickers[i];
    const sources = {};
    const common = { fetchSymbolImpl, convertImpl, evaluateImpl, fxUrl: prodUrl, fxCache, nowSec, spacing, sleepImpl };
    const store = await valueFrom(stagingUrl, ticker, { ...common, fetchImpl: recordingFetch(fetchImpl, sources) });
    await sleepImpl(spacing);
    const yahoo = await valueFrom(prodUrl, ticker, { ...common, fetchImpl });
    const row = compareTicker({
      ticker, market: market || marketOf(ticker), yahoo, store, sources,
      extraDiffs: sources.history === 'store' ? historyDiffs(yahoo.history, store.history) : [{ field: 'source.history', yahoo: 'yahoo', other: sources.history || null }],
    });
    results.push(row);
    log(`${ticker}: ${row.pass ? 'pass' : 'FAIL'}  ${row.model_yahoo} vs ${row.model_other}  diff ${row.diff_pct ?? '-'}%`);
    if (i < tickers.length - 1) await sleepImpl(TICKER_GAP_MS);
  }

  const passed = results.filter(r => r.pass).length;
  const run = {
    run_id: runIdFor(started, kind), run_date: started.toISOString().slice(0, 10), kind,
    tickers: results.length, passed, failed: results.length - passed, summary: summarise(results),
  };
  let posted = true;
  for (let i = 0; i < results.length; i += chunkSize) {
    try {
      const res = await fetchImpl(`${prodUrl}/store/parity`, {
        method: 'POST',
        headers: { ...batchHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ run, results: results.slice(i, i + chunkSize) }),
      });
      if (!res || res.status !== 204) posted = false;
    } catch (_) {
      posted = false;
    }
  }
  return { run, results, posted };
}

function parseArgs(argv) {
  const args = {};
  for (const a of argv) {
    const m = a.match(/^--([a-z]+)=(.*)$/);
    if (m) args[m[1]] = m[2];
  }
  return args;
}

function loadTickers(args) {
  if (args.tickers) {
    return args.tickers.split(',').map(t => t.trim()).filter(Boolean).map(ticker => ({ ticker, market: marketOf(ticker) }));
  }
  if (args.universe) {
    const file = UNIVERSES[args.universe];
    if (!file) throw new Error(`unknown --universe=${args.universe} (one of ${Object.keys(UNIVERSES).join(', ')})`);
    return JSON.parse(fs.readFileSync(path.join(__dirname, file), 'utf8')).map(ticker => ({ ticker, market: args.universe }));
  }
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'data-parity-tickers.json'), 'utf8'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const kind = args.kind || (args.tickers ? 'adhoc' : 'daily');
  if (!['daily', 'bulk', 'adhoc'].includes(kind)) throw new Error(`--kind must be daily, bulk or adhoc (got ${kind})`);
  const stagingUrl = (process.env.STAGING_PROXY_URL || '').replace(/\/$/, '');
  const prodUrl = (process.env.PROD_PROXY_URL || '').replace(/\/$/, '');
  if (!stagingUrl || !prodUrl) throw new Error('STAGING_PROXY_URL and PROD_PROXY_URL must be set');
  const tickers = loadTickers(args);
  console.log(`data-parity: ${tickers.length} ticker(s), kind=${kind}`);
  const { run, posted } = await runParity({ tickers, kind, stagingUrl, prodUrl }, { log: console.log });
  console.log(`\n${run.run_id}: ${run.passed} passed, ${run.failed} failed`);
  console.log(JSON.stringify(run.summary, null, 2));
  if (!posted) {
    console.error('Posting results to /store/parity failed (see the Worker logs / MARKET_DATA binding).');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch(err => { console.error(err); process.exitCode = 1; });
}

module.exports = { runParity, marketOf, runIdFor, loadTickers };
