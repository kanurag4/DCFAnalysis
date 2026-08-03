// scripts/rank-europe.js
// Weekly batch: evaluate the Europe (eurozone + UK) base case, rank by margin
// of safety, write www/europe-undervalued/rankings.json + merge first-seen.json.
//
//   node scripts/rank-europe.js            fetch all tickers, evaluate, rank, write
//   node scripts/rank-europe.js --rerank   re-rank the LAST run's cached data (no fetch)
const { runScreen } = require('./lib/run-screen.js');
const { fetchEurFxRates } = require('./lib/rf.js');
const blacklistEntries = require('./blacklist-europe.json');

const config = {
  universe: 'Europe (Eurozone + UK)',
  tickersFile: 'europe200.json',
  outDir: 'europe-undervalued',
  currency: 'EUR',
  // No live-fetched rf — .L and eurozone tickers use FIXED rf constants in market.js
  // (no live UK Gilt/Bund yield source), same pattern as KOSPI/Nikkei. liveKey/rfLabel
  // are still set (fetchRf stays null) purely so gather()'s log line reads cleanly,
  // matching rank-nikkei.js's precedent — market.js's UK/eurozone branches ignore any
  // `live` override regardless (see Task 3's tests), so liveKey's value is inert.
  liveKey: 'euRf',
  fetchRf: null,
  rfLabel: 'Europe RF',
  // Fetches GBP/EUR and USD/EUR (CPG.L and IHG.L are LSE-listed but USD-quoted).
  // Only used by the paper-portfolio rebalance (fx.js) — never ranking/valuation,
  // which are currency-agnostic because margin of safety is a ratio.
  fetchFx: fetchEurFxRates,
  topN: 20,
  maxMargin: 0.8,
  blacklist: blacklistEntries.map(e => e.ticker),
  indexTicker: '^STOXX',        // STOXX Europe 600 — verified resolving via the Worker (2026-08-03)
  indexName: 'STOXX Europe 600',
  cacheFile: '_evaluated-europe.json', // gitignored (scripts/_*)
  rawFile: '_raw-europe.json',
};

runScreen(config).catch(err => { console.error(err); process.exit(1); });
