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
const { execFileSync } = require('node:child_process');
const { fetchSymbol } = require('../fetch-yahoo.js');
const { fetchDividends } = require('./fetch-dividends.js');
const { fetchIndexPrice } = require('./rf.js');
const { marketParamsFor } = require('./market.js');
const { evaluateStock } = require('./evaluate.js');
const { rankRows, rankFunnel } = require('./rank.js');
const { mergeFirstSeen } = require('./firstSeen.js');
const { computeRebalance, checkIndexSeedConsistency, STARTING_VALUE } = require('./portfolio.js');
const { prepareEurRebalanceInputs } = require('./fx.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const THROTTLE_MS = 3200; // ~18.75 req/min keeps us under the 20/60s Worker cap

// Read the proxy URL straight from www/config.js without a DOM. An explicit
// YAHOO_PROXY_URL env var overrides this (set by the GitHub Actions
// refresh-screen workflow so CI doesn't depend on parsing a checked-out file
// path it doesn't otherwise need).
function readProxyUrl() {
  if (process.env.YAHOO_PROXY_URL) return process.env.YAHOO_PROXY_URL;
  const src = fs.readFileSync(path.join(__dirname, '../../www/config.js'), 'utf8');
  const m = src.match(/YAHOO_PROXY_URL\s*[:=]\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('Could not find YAHOO_PROXY_URL in www/config.js');
  return m[1];
}

async function gather(config) {
  const proxyUrl = readProxyUrl();
  const tickers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', config.tickersFile), 'utf8'));
  const asAt = new Date().toISOString().slice(0, 10);

  // Korea has no live RF source (see market.js) — config.fetchRf is absent, so rf
  // stays null and marketParamsFor's static fallback applies for every ticker.
  const rf = config.fetchRf ? await config.fetchRf(proxyUrl) : null;
  const live = { [config.liveKey]: rf };
  const fx = config.fetchFx ? await config.fetchFx(proxyUrl) : null;
  if (fx != null) console.log(`GBP/EUR: ${fx.toFixed(4)}`);
  const rfDisplay = rf != null ? `${(rf * 100).toFixed(2)}%` : 'static (no live source)';
  console.log(`${config.rfLabel}: ${rfDisplay}  | tickers: ${tickers.length}  | asAt: ${asAt}`);

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

  const out = { asAt, tickerCount: tickers.length, evaluated, indexPrice, fxRate: fx };
  fs.writeFileSync(path.join(__dirname, '..', config.cacheFile), JSON.stringify(out) + '\n'); // for --rerank
  // Raw cache for --reeval: re-apply engine/parity fixes instantly without
  // re-hitting the Worker. Stores the RF so re-eval reuses the same seed.
  if (config.rawFile) {
    fs.writeFileSync(path.join(__dirname, '..', config.rawFile),
      JSON.stringify({ asAt, tickerCount: tickers.length, rf, fx, liveKey: config.liveKey, raw }) + '\n');
  }
  return out;
}

// The set of tickers on the last *published* (git HEAD) cycle — the stable anchor
// for detecting first-seen reentry, since it survives separate --rerank/--reeval
// process invocations that mutate the on-disk rankings.json without committing.
function readPublishedTickers(config) {
  try {
    const repoRoot = path.join(__dirname, '../..');
    const rel = `www/${config.outDir}/rankings.json`;
    const out = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const json = JSON.parse(out);
    return new Set((json.rows || []).map(r => r.ticker));
  } catch (_) {
    return new Set(); // no committed rankings yet (first-ever run)
  }
}

function rankAndWrite(config, { asAt, tickerCount, evaluated, fxRate }) {
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

  // Chaebol-affiliate annotation (Korea screen only — config.chaebolAffiliates is a
  // manually curated { ticker: 'Group Name' } map). Additive, not exclusionary — mirrors
  // the highLeverage flag's rendering pattern (asterisk + tooltip + footnote), never
  // affects ranking order. Undefined for every other market's config, so this is a
  // no-op there.
  const rounded = ranked.map(r => {
    const chaebolGroup = config.chaebolAffiliates ? config.chaebolAffiliates[r.ticker] : undefined;
    return {
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
      ...(chaebolGroup ? { chaebolGroup } : {}),
    };
  });

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
    JSON.stringify({
      asAt, universe: config.universe, summary, rows: rounded,
      ...(fxRate != null ? { fxRate } : {}),
    }, null, 2) + '\n');

  const fsPath = path.join(outDir, 'first-seen.json');
  const ledger = fs.existsSync(fsPath) ? JSON.parse(fs.readFileSync(fsPath, 'utf8')) : {};
  fs.writeFileSync(fsPath, JSON.stringify(mergeFirstSeen(ledger, rounded, asAt, readPublishedTickers(config)), null, 2) + '\n');

  console.log(`\nTop ${rounded.length}:`);
  for (const r of rounded) console.log(`  ${r.rank}. ${r.ticker} ${(r.marginOfSafety * 100).toFixed(0)}% (${r.method})`);
  console.log(`\nWrote ${outDir}\\rankings.json and first-seen.json`);
}

// Append (or seed) a { date, portfolioValue, indexPrice } snapshot for the
// timeline chart on the hero card. Called once per full-fetch run, after the
// rebalance — so it always reflects the just-written portfolio.value.
function appendPortfolioHistory(config, portfolio, indexMeta) {
  const outDir = path.join(__dirname, '../../www', config.outDir);
  const histPath = path.join(outDir, 'portfolio-history.json');
  const history = fs.existsSync(histPath) ? JSON.parse(fs.readFileSync(histPath, 'utf8')) : [];
  const indexPrice = indexMeta ? indexMeta.indexPrice : (portfolio.indexSeedPrice ?? null);

  if (!history.length) {
    // Seed the inception point so the chart has a baseline even on the first run.
    history.push({
      date: portfolio.startedAt || portfolio.asAt,
      portfolioValue: portfolio.startingValue || STARTING_VALUE,
      indexPrice,
    });
  }

  const last = history[history.length - 1];
  const point = { date: portfolio.asAt, portfolioValue: portfolio.value, indexPrice };
  if (last.date === portfolio.asAt) history[history.length - 1] = point; // idempotent same-day rerun
  else history.push(point);

  fs.writeFileSync(histPath, JSON.stringify(history, null, 2) + '\n');
  return history;
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

  // For every market except Europe, config.fetchFx is undefined and this is a
  // pure pass-through -- computeRebalance() itself is never modified. For
  // Europe, this converts GBP-priced rows to EUR "shadow" prices using
  // last run's persisted rate (oldFx) and this run's fresh rate (newFx), so a
  // GBP position's return correctly reflects both its own native-currency move
  // AND the GBP/EUR exchange-rate move between rebalances -- see fx.js.
  const oldFx = oldRankings && oldRankings.fxRate != null ? oldRankings.fxRate : null;
  const rebalanceInputs = config.fetchFx
    ? prepareEurRebalanceInputs({ oldRows, newRows, allEvaluated: data.evaluated, firstSeen, oldFx, newFx: data.fxRate ?? null })
    : { oldRows, newRows, allEvaluated: data.evaluated, firstSeen };

  const { portfolio, sold } = computeRebalance(
    oldPortfolio, rebalanceInputs.oldRows, rebalanceInputs.newRows, rebalanceInputs.allEvaluated,
    rebalanceInputs.firstSeen, data.asAt, config.startingValue, indexMeta, dividendsByTicker
  );

  fs.writeFileSync(portfolioPath, JSON.stringify(portfolio, null, 2) + '\n');
  fs.writeFileSync(soldPath, JSON.stringify([...existingSold, ...sold], null, 2) + '\n');

  // This run's own new exits only, as opposed to soldPath's full cumulative
  // ledger -- a scratch file scoped to this CI job's workspace, read by
  // post-run.js so the admin console can show "what changed this run" instead
  // of the market's entire exit history (that full history belongs on the
  // public /dcf/exits/ page, not the per-run review screen). Not under www/,
  // so it's never swept into the staging-branch commit or the
  // publish-screen.yml 5-file assertion; gitignored via the scripts/_* pattern.
  fs.writeFileSync(path.join(__dirname, '../_last-sold.json'), JSON.stringify(sold, null, 2) + '\n');

  const history = appendPortfolioHistory(config, portfolio, indexMeta);

  // Guard against the hero stat and timeline chart silently disagreeing again
  // (see CLAUDE.md "Corrected 2026-07-12") — fail the batch loudly instead of
  // deploying inconsistent index-return figures.
  const seedError = checkIndexSeedConsistency(portfolio, history);
  if (seedError) throw new Error(`[${config.outDir}] ${seedError}`);

  if (sold.length) {
    console.log(`\nPortfolio: sold ${sold.length} — ${sold.map(s => s.ticker).join(', ')}`);
  }
  const startVal = portfolio.startingValue || STARTING_VALUE;
  const gain = portfolio.value - startVal;
  const sign = gain >= 0 ? '+' : '';
  const CURRENCY_SYMBOLS = { INR: '₹', KRW: '₩', JPY: '¥', EUR: '€' };
  const sym = CURRENCY_SYMBOLS[config.currency] ?? '$';
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
    const rfDisplay = b.rf != null ? `${(b.rf * 100).toFixed(2)}%` : 'static (no live source)';
    console.log(`Re-evaluating ${b.raw.length} cached raw rows from ${b.asAt} (no fetch; rf=${rfDisplay}).`);
    const evaluated = b.raw.map(d => evaluateStock(d, marketParamsFor(d.ticker, live)));
    data = { asAt: b.asAt, tickerCount: b.tickerCount, evaluated, fxRate: b.fx };
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

module.exports = { runScreen, readProxyUrl };
