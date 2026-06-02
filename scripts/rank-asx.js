// scripts/rank-asx.js
// Monthly batch: evaluate the ASX 300 base case, rank by margin of safety,
// write www/asx-undervalued/rankings.json + merge first-seen.json.
// Run: node scripts/rank-asx.js   (reads scripts/asx300.json)
const fs = require('node:fs');
const path = require('node:path');
const { fetchSymbol } = require('./fetch-yahoo.js');
const { marketParamsFor } = require('./lib/market.js');
const { evaluateStock } = require('./lib/evaluate.js');
const { rankRows, rankFunnel } = require('./lib/rank.js');
const { mergeFirstSeen } = require('./lib/firstSeen.js');

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

async function main() {
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

  const ranked = rankRows(evaluated, { topN: 10, maxMargin: 1.5 });
  const f = rankFunnel(evaluated, { maxMargin: 1.5 });
  const fetchFailed = tickers.length - evaluated.length;
  console.log(
    `\nFunnel: ${tickers.length} tickers → ${fetchFailed} fetch-failed → ${f.evaluated} evaluated` +
    `\n        − ${f.unvaluable} unvaluable (no/neg FCF, neg equity, bank w/o dividend)` +
    `\n        − ${f.overvalued} overvalued (price ≥ intrinsic)` +
    `\n        − ${f.capped} margin > 150% (likely one-off-inflated FCF)` +
    `\n        − ${f.proxyDropped} rough proxy-FCF (no reported FCF or CapEx)` +
    `\n        = ${f.kept} qualified → showing top ${ranked.length} (cap 10)`
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
    tickers: tickers.length,
    evaluated: f.evaluated,
    qualified: f.kept,
    shown: ranked.length,
    dropped: {
      fetchFailed,
      unvaluable: f.unvaluable,
      overvalued: f.overvalued,
      marginOver150: f.capped,
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

main().catch(err => { console.error(err); process.exit(1); });
