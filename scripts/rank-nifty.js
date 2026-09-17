// scripts/rank-nifty.js
// Monthly batch: evaluate the NIFTY 100 base case, rank by margin of safety,
// write www/nifty-undervalued/rankings.json + merge first-seen.json.
//
//   node scripts/rank-nifty.js            fetch all tickers, evaluate, rank, write
//   node scripts/rank-nifty.js --rerank   re-rank the LAST run's cached data (no fetch)
//   node scripts/rank-nifty.js --reeval   re-evaluate cached raw data (~2s, no fetch)
const { runScreen } = require('./lib/run-screen.js');
const { fetchIndRf } = require('./lib/rf.js');
const blacklistEntries = require('./blacklist-nifty.json');

const config = {
  universe: 'NIFTY 500',
  tickersFile: 'nifty500.json',
  outDir: 'nifty-undervalued',
  currency: 'INR',
  liveKey: 'indRf',
  fetchRf: fetchIndRf,
  rfLabel: 'IND RF',
  topN: 20,
  maxMargin: 1.0,
  // Manually curated exclusions — structurally misleading FCF/valuation for the DCF model.
  // Moved to scripts/blacklist-nifty.json (2026-08-01) so the admin console's "Exclude &
  // re-run" action can append to it mechanically — see each entry's `reason` there.
  blacklist: blacklistEntries.map(e => e.ticker),
  startingValue: 100000,
  indexTicker: '^NSEI',
  indexName: 'NIFTY 50',
  cacheFile: '_evaluated-nifty.json',
  rawFile: '_raw-nifty.json',
};

runScreen(config).catch(err => { console.error(err); process.exit(1); });
