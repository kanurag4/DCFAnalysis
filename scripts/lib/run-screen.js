// scripts/lib/run-screen.js
// Shared batch orchestrator for the per-market "undervalued" screens.
// Fetch every ticker (throttled under the Worker's 20 req/60s cap, with retry +
// a cooldown sweep), evaluate the base case, rank by margin of safety, and write
// www/<outDir>/rankings.json + merge first-seen.json. Market differences are
// injected via `config`; the calc/eval/rank modules are market-agnostic.
//
//   runScreen(config)            fetch all tickers, evaluate, rank, write
//   runScreen(config, '--rerank') re-rank config.cacheFile (no fetch)
const fs = require('node:fs');
const path = require('node:path');
const { fetchSymbol } = require('../fetch-yahoo.js');
const { fetchDividends } = require('./fetch-dividends.js');
const { fetchIndexPrice } = require('./rf.js');
const { marketParamsFor } = require('./market.js');
const { evaluateStock } = require('./evaluate.js');
const { rankRows, rankFunnel } = require('./rank.js');
const { mergeFirstSeen } = require('./firstSeen.js');
const { computeRebalance, STARTING_VALUE } = require('./portfolio.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const THROTTLE_MS = 3200; // ~18.75 req/min keeps us under the 20/60s Worker cap

// Read the proxy URL straight from www/config.js without a DOM.
function readProxyUrl() {
  const src = fs.readFileSync(path.join(__dirname, '../../www/config.js'), 'utf8');
  const m = src.match(/YAHOO_PROXY_URL\s*[:=]\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('Could not find YAHOO_PROXY_URL in www/config.js');
  return m[1];
}

async function gather(config) {
  const proxyUrl = readProxyUrl();
  const tickers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', config.tickersFile), 'utf8'));
  const asAt = new Date().toISOString().slice(0, 10);

  const rf = await config.fetchRf(proxyUrl);
  const live = { [config.liveKey]: rf };
  console.log(`${config.rfLabel}: ${(rf * 100).toFixed(2)}%  | tickers: ${tickers.length}  | asAt: ${asAt}`);

  const evaluated = [];
  const raw = [];           // keep the mapped data for instant --reeval (no re-fetch)
  const failed = [];
  let done = 0;
  for (const ticker of tickers) {
    const data = await fetchSymbol(ticker, { proxyUrl, retries: 2, backoffMs: 4000 });
    if (data) { raw.push(data); evaluated.push(evaluateStock(data, marketParamsFor(ticker, live))); }
    else failed.push(ticker);
    if (++done % 25 === 0) console.log(`  …${done}/${tickers.length}  (failed so far: ${failed.length})`);
    await sleep(THROTTLE_MS);
  }

  // Final sweep: any stragglers get one more pass after a cooldown that clears
  // the rate-limit window, so a transient burst of 429s can't permanently drop a stock.
  if (failed.length) {
    console.log(`\n${failed.length} still missing — cooling down 65s then retrying them…`);
    await sleep(65000);
    const stillFailed = [];
    for (const ticker of failed) {
      const data = await fetchSymbol(ticker, { proxyUrl, retries: 2, backoffMs: 4000 });
      if (data) { raw.push(data); evaluated.push(evaluateStock(data, marketParamsFor(ticker, live))); }
      else stillFailed.push(ticker);
      await sleep(THROTTLE_MS);
    }
    console.log(`Sweep recovered ${failed.length - stillFailed.length}; ${stillFailed.length} unrecoverable: ${stillFailed.join(', ') || '—'}`);
  }

  // Fetch current index level for hero card benchmark comparison (best-effort).
  let indexPrice = null;
  if (config.indexTicker) {
    indexPrice = await fetchIndexPrice(config.indexTicker, proxyUrl);
    if (indexPrice != null) console.log(`${config.indexName || config.indexTicker}: ${indexPrice.toFixed(2)}`);
  }

  const out = { asAt, tickerCount: tickers.length, evaluated, indexPrice };
  fs.writeFileSync(path.join(__dirname, '..', config.cacheFile), JSON.stringify(out) + '\n'); // for --rerank
  // Raw cache for --reeval: re-apply engine/parity fixes instantly without
  // re-hitting the Worker. Stores the RF so re-eval reuses the same seed.
  if (config.rawFile) {
    fs.writeFileSync(path.join(__dirname, '..', config.rawFile),
      JSON.stringify({ asAt, tickerCount: tickers.length, rf, liveKey: config.liveKey, raw }) + '\n');
  }
  return out;
}

function rankAndWrite(config, { asAt, tickerCount, evaluated }) {
  const { topN, maxMargin } = config;
  const blacklist = new Set(config.blacklist || []);
  const eligible = blacklist.size
    ? evaluated.map(r => blacklist.has(r.ticker) ? { ...r, excluded: true, reason: 'manual-blacklist' } : r)
    : evaluated;
  const ranked = rankRows(eligible, { topN, maxMargin });
  const f = rankFunnel(eligible, { maxMargin });
  const fetchFailed = tickerCount - evaluated.length;
  const capPct = Math.round(maxMargin * 100);
  console.log(
    `\nFunnel: ${tickerCount} tickers → ${fetchFailed} fetch-failed → ${f.evaluated} evaluated` +
    `\n        − ${f.unvaluable} unvaluable (no/neg FCF, neg equity, bank w/o dividend)` +
    `\n        − ${f.overvalued} overvalued (price ≥ intrinsic)` +
    `\n        − ${f.capped} margin > ${capPct}% (likely one-off-inflated FCF)` +
    `\n        − ${f.proxyDropped} rough proxy-FCF (no reported FCF or CapEx)` +
    `\n        = ${f.kept} qualified → showing top ${ranked.length} (cap ${topN})`
  );

  const outDir = path.join(__dirname, '../../www', config.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const rounded = ranked.map(r => ({
    rank: r.rank, ticker: r.ticker, name: r.name, sector: r.sector ?? null,
    method: r.method,
    intrinsic: +r.intrinsic.toFixed(2),
    snapshotPrice: +Number(r.snapshotPrice).toFixed(2),
    marginOfSafety: +r.marginOfSafety.toFixed(4),
    wacc: +r.wacc.toFixed(4),
    terminalValuePct: r.terminalValuePct != null ? +r.terminalValuePct.toFixed(1) : null,
    trailingPE: r.trailingPE != null ? +r.trailingPE.toFixed(1) : null,
    marketCap: r.marketCap != null ? Math.round(r.marketCap) : null,
    operatingMargin: r.operatingMargin != null ? +r.operatingMargin.toFixed(4) : null,
    analystTarget: r.analystTarget != null ? +r.analystTarget.toFixed(2) : null,
    currency: r.currency ?? config.currency,
    ...(r.highLeverage ? { highLeverage: true } : {}),
  }));

  const summary = {
    tickers: tickerCount,
    evaluated: f.evaluated,
    qualified: f.kept,
    shown: ranked.length,
    marginCapPct: capPct,
    dropped: {
      fetchFailed,
      unvaluable: f.unvaluable,
      overvalued: f.overvalued,
      marginOverCap: f.capped,
      proxyFcf: f.proxyDropped,
    },
  };

  fs.writeFileSync(path.join(outDir, 'rankings.json'),
    JSON.stringify({ asAt, universe: config.universe, summary, rows: rounded }, null, 2) + '\n');

  const fsPath = path.join(outDir, 'first-seen.json');
  const ledger = fs.existsSync(fsPath) ? JSON.parse(fs.readFileSync(fsPath, 'utf8')) : {};
  fs.writeFileSync(fsPath, JSON.stringify(mergeFirstSeen(ledger, rounded, asAt), null, 2) + '\n');

  console.log(`\nTop ${rounded.length}:`);
  for (const r of rounded) console.log(`  ${r.rank}. ${r.ticker} ${(r.marginOfSafety * 100).toFixed(0)}% (${r.method})`);
  console.log(`\nWrote ${outDir}\\rankings.json and first-seen.json`);
}

async function updatePortfolio(config, data, oldRankings) {
  const outDir = path.join(__dirname, '../../www', config.outDir);
  const portfolioPath = path.join(outDir, 'portfolio-value.json');
  const soldPath      = path.join(outDir, 'sold.json');
  const fsPath        = path.join(outDir, 'first-seen.json');

  const oldPortfolio = fs.existsSync(portfolioPath) ? JSON.parse(fs.readFileSync(portfolioPath, 'utf8')) : null;
  const oldRows      = (oldRankings && oldRankings.rows) ? oldRankings.rows : [];
  const existingSold = fs.existsSync(soldPath) ? JSON.parse(fs.readFileSync(soldPath, 'utf8')) : [];
  const firstSeen    = fs.existsSync(fsPath) ? JSON.parse(fs.readFileSync(fsPath, 'utf8')) : {};

  // New rankings were just written by rankAndWrite — read them back
  const newRankings = JSON.parse(fs.readFileSync(path.join(outDir, 'rankings.json'), 'utf8'));
  const newRows = newRankings.rows || [];

  const indexMeta = (config.indexTicker && data.indexPrice != null)
    ? { indexPrice: data.indexPrice, indexName: config.indexName, indexTicker: config.indexTicker }
    : null;

  // Credit real dividends earned by the PRIOR holdings over (oldAsAt, asAt].
  // Going-forward only: first run has no oldPortfolio, so nothing is fetched.
  const proxyUrl = readProxyUrl();
  const dividendsByTicker = {};
  if (oldPortfolio && oldPortfolio.asAt && oldRows.length) {
    const sleepMs = 3200; // stay under the Worker's 20 req/60s cap
    let paid = 0;
    for (const r of oldRows) {
      const events = await fetchDividends(r.ticker, oldPortfolio.asAt, data.asAt, { proxyUrl, retries: 1, backoffMs: 4000 });
      const total = events.reduce((s, e) => s + e.amount, 0);
      if (total > 0) { dividendsByTicker[r.ticker] = total; paid++; }
      await sleep(sleepMs);
    }
    console.log(`Dividends: ${paid}/${oldRows.length} prior holdings paid over ${oldPortfolio.asAt}→${data.asAt}`);
  }

  const { portfolio, sold } = computeRebalance(
    oldPortfolio, oldRows, newRows, data.evaluated, firstSeen, data.asAt, config.startingValue, indexMeta, dividendsByTicker
  );

  fs.writeFileSync(portfolioPath, JSON.stringify(portfolio, null, 2) + '\n');
  fs.writeFileSync(soldPath, JSON.stringify([...existingSold, ...sold], null, 2) + '\n');

  if (sold.length) {
    console.log(`\nPortfolio: sold ${sold.length} — ${sold.map(s => s.ticker).join(', ')}`);
  }
  const startVal = portfolio.startingValue || STARTING_VALUE;
  const gain = portfolio.value - startVal;
  const sign = gain >= 0 ? '+' : '';
  const sym = config.currency === 'INR' ? '₹' : '$';
  console.log(`Portfolio: ${sym}${portfolio.value.toFixed(2)} (${sign}${(gain / startVal * 100).toFixed(1)}%) · ${portfolio.N} holdings`);
  if (portfolio.dividendsTotal) {
    console.log(`Dividends: ${sym}${portfolio.dividendsTotal.toFixed(2)} earned cumulatively`);
  }
}

async function runScreen(config, argv = process.argv) {
  const cachePath = path.join(__dirname, '..', config.cacheFile);
  let data;

  if (argv.includes('--reeval')) {
    // Re-run evaluateStock on the cached RAW data (no fetch) — for engine/parity
    // fixes. Refreshes the evaluated cache too, so a later --rerank stays in sync.
    const rawPath = path.join(__dirname, '..', config.rawFile || '');
    if (!config.rawFile || !fs.existsSync(rawPath)) throw new Error(`No raw cache at ${config.rawFile} — run a full fetch first.`);
    const b = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    const live = { [b.liveKey || config.liveKey]: b.rf };
    console.log(`Re-evaluating ${b.raw.length} cached raw rows from ${b.asAt} (no fetch; rf=${(b.rf * 100).toFixed(2)}%).`);
    const evaluated = b.raw.map(d => evaluateStock(d, marketParamsFor(d.ticker, live)));
    data = { asAt: b.asAt, tickerCount: b.tickerCount, evaluated };
    fs.writeFileSync(cachePath, JSON.stringify(data) + '\n');
    rankAndWrite(config, data);

  } else if (argv.includes('--rerank')) {
    if (!fs.existsSync(cachePath)) throw new Error(`No cached data at ${config.cacheFile} — run without --rerank first.`);
    data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    console.log(`Re-ranking ${data.evaluated.length} cached rows from ${data.asAt} (no fetch).`);
    rankAndWrite(config, data);

  } else {
    // Full fetch — read old rankings BEFORE rankAndWrite overwrites them
    const outDir = path.join(__dirname, '../../www', config.outDir);
    const rankingsPath = path.join(outDir, 'rankings.json');
    const oldRankings = fs.existsSync(rankingsPath)
      ? JSON.parse(fs.readFileSync(rankingsPath, 'utf8'))
      : null;
    data = await gather(config);
    rankAndWrite(config, data);
    await updatePortfolio(config, data, oldRankings);
  }
}

module.exports = { runScreen };
