// scripts/rank-sp500.js
// Monthly batch: evaluate the S&P 500 base case, rank by margin of safety,
// write www/sp500-undervalued/rankings.json + merge first-seen.json.
//
//   node scripts/rank-sp500.js            fetch all tickers, evaluate, rank, write
//   node scripts/rank-sp500.js --rerank   re-rank the LAST run's cached data (no fetch)
const { runScreen } = require('./lib/run-screen.js');
const { fetchUsRf } = require('./lib/rf.js');
const blacklistEntries = require('./blacklist-sp500.json');

const config = {
  universe: 'S&P 500',
  tickersFile: 'sp500.json',
  outDir: 'sp500-undervalued',
  currency: 'USD',
  liveKey: 'usRf',
  fetchRf: fetchUsRf,
  rfLabel: 'US RF',
  topN: 20,
  maxMargin: 0.8,
  // Manually curated exclusions — structurally misleading FCF/valuation for the DCF model.
  // Moved to scripts/blacklist-sp500.json (2026-08-01) so the admin console's "Exclude &
  // re-run" action can append to it mechanically — see each entry's `reason` there.
  blacklist: blacklistEntries.map(e => e.ticker),
  indexTicker: '^GSPC',
  indexName: 'S&P 500',
  cacheFile: '_evaluated-sp500.json', // gitignored (scripts/_*)
  rawFile: '_raw-sp500.json',         // raw data cache for --reeval
};

runScreen(config).catch(err => { console.error(err); process.exit(1); });
