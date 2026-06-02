// scripts/rank-asx.js
// Monthly batch: evaluate the ASX 300 base case, rank by margin of safety,
// write www/asx-undervalued/rankings.json + merge first-seen.json.
//
//   node scripts/rank-asx.js            fetch all tickers, evaluate, rank, write
//   node scripts/rank-asx.js --rerank   re-rank the LAST run's cached data (no fetch)
//
// --rerank lets you tune filters (e.g. the margin cap) instantly without a 16-min
// re-fetch. The fetch phase caches the evaluated set to scripts/_evaluated.json.
const fs = require('node:fs');
const path = require('node:path');
const { fetchSymbol } = require('./fetch-yahoo.js');
const { marketParamsFor } = require('./lib/market.js');
const { evaluateStock } = require('./lib/evaluate.js');
const { rankRows, rankFunnel } = require('./lib/rank.js');
const { mergeFirstSeen } = require('./lib/firstSeen.js');

const TOP_N = 10;
const MAX_MARGIN = 0.8;   // drop > 80% margins — the most assumption-fragile valuations
const CACHE = path.join(__dirname, '_evaluated.json'); // gitignored scratch (scripts/_*)

// Read the proxy URL straight from www/config.js without a DOM.
function readProxyUrl() {
  const src = fs.readFileSync(path.join(__dirname, '../www/config.js'), 'utf8');
  const m = src.match(/YAHOO_PROXY_URL\s*[:=]\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('Could not find YAHOO_PROXY_URL in www/config.js');
  return m[1];
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchAusRf(proxyUrl) {
  const d = await fetchSymbol('^GSBG10.AX', { proxyUrl }).catch(() => null);
  // ^GSBG10.AX price is the yield in percent; fall back to 4.8%.
  const pct = d && d.price != null ? d.price / 100 : null;
  return (pct && pct > 0 && pct < 0.15) ? pct : 0.048;
}

// Fetch + evaluate every ticker. Returns { asAt, tickers, evaluated }.
async function gather() {
  const proxyUrl = readProxyUrl();
  const tickers = JSON.parse(fs.readFileSync(path.join(__dirname, 'asx300.json'), 'utf8'));
  const asAt = new Date().toISOString().slice(0, 10);

  const ausRf = await fetchAusRf(proxyUrl);
  console.log(`AUS RF: ${(ausRf * 100).toFixed(2)}%  | tickers: ${tickers.length}  | asAt: ${asAt}`);

  // Worker rate limit is 20 req / 60s per IP. 3.2s/request ≈ 18.75/min keeps us
  // under it; per-symbol retries catch the occasional transient 429/5xx.
  const THROTTLE_MS = 3200;
  const evaluated = [];
  const failed = [];
  let done = 0;
  for (const ticker of tickers) {
    const data = await fetchSymbol(ticker, { proxyUrl, retries: 2, backoffMs: 4000 });
    if (data) evaluated.push(evaluateStock(data, marketParamsFor(ticker, { ausRf })));
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
      if (data) evaluated.push(evaluateStock(data, marketParamsFor(ticker, { ausRf })));
      else stillFailed.push(ticker);
      await sleep(THROTTLE_MS);
    }
    console.log(`Sweep recovered ${failed.length - stillFailed.length}; ${stillFailed.length} unrecoverable: ${stillFailed.join(', ') || '—'}`);
  }

  const out = { asAt, tickerCount: tickers.length, evaluated };
  fs.writeFileSync(CACHE, JSON.stringify(out) + '\n'); // cache for --rerank
  return out;
}

function rankAndWrite({ asAt, tickerCount, evaluated }) {
  const ranked = rankRows(evaluated, { topN: TOP_N, maxMargin: MAX_MARGIN });
  const f = rankFunnel(evaluated, { maxMargin: MAX_MARGIN });
  const fetchFailed = tickerCount - evaluated.length;
  const capPct = Math.round(MAX_MARGIN * 100);
  console.log(
    `\nFunnel: ${tickerCount} tickers → ${fetchFailed} fetch-failed → ${f.evaluated} evaluated` +
    `\n        − ${f.unvaluable} unvaluable (no/neg FCF, neg equity, bank w/o dividend)` +
    `\n        − ${f.overvalued} overvalued (price ≥ intrinsic)` +
    `\n        − ${f.capped} margin > ${capPct}% (likely one-off-inflated FCF)` +
    `\n        − ${f.proxyDropped} rough proxy-FCF (no reported FCF or CapEx)` +
    `\n        = ${f.kept} qualified → showing top ${ranked.length} (cap ${TOP_N})`
  );

  const outDir = path.join(__dirname, '../www/asx-undervalued');
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
    currency: r.currency ?? 'AUD',
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
    JSON.stringify({ asAt, universe: 'ASX 300', summary, rows: rounded }, null, 2) + '\n');

  const fsPath = path.join(outDir, 'first-seen.json');
  const ledger = fs.existsSync(fsPath) ? JSON.parse(fs.readFileSync(fsPath, 'utf8')) : {};
  fs.writeFileSync(fsPath, JSON.stringify(mergeFirstSeen(ledger, rounded, asAt), null, 2) + '\n');

  console.log(`\nTop ${rounded.length}:`);
  for (const r of rounded) console.log(`  ${r.rank}. ${r.ticker} ${(r.marginOfSafety * 100).toFixed(0)}% (${r.method})`);
  console.log(`\nWrote ${outDir}\\rankings.json and first-seen.json`);
}

async function main() {
  let data;
  if (process.argv.includes('--rerank')) {
    if (!fs.existsSync(CACHE)) throw new Error('No cached data — run `node scripts/rank-asx.js` (without --rerank) first.');
    data = JSON.parse(fs.readFileSync(CACHE, 'utf8'));
    console.log(`Re-ranking ${data.evaluated.length} cached rows from ${data.asAt} (no fetch).`);
  } else {
    data = await gather();
  }
  rankAndWrite(data);
}

main().catch(err => { console.error(err); process.exit(1); });
