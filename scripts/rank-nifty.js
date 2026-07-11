// scripts/rank-nifty.js
// Monthly batch: evaluate the NIFTY 100 base case, rank by margin of safety,
// write www/nifty-undervalued/rankings.json + merge first-seen.json.
//
//   node scripts/rank-nifty.js            fetch all tickers, evaluate, rank, write
//   node scripts/rank-nifty.js --rerank   re-rank the LAST run's cached data (no fetch)
//   node scripts/rank-nifty.js --reeval   re-evaluate cached raw data (~2s, no fetch)
const { runScreen } = require('./lib/run-screen.js');
const { fetchIndRf } = require('./lib/rf.js');

const config = {
  universe: 'NIFTY 500',
  tickersFile: 'nifty500.json',
  outDir: 'nifty-undervalued',
  currency: 'INR',
  liveKey: 'indRf',
  fetchRf: fetchIndRf,
  rfLabel: 'IND RF',
  topN: 20,
  maxMargin: 0.8,
  // Manually curated exclusions — structurally misleading FCF/valuation for the DCF model.
  // TATAINVEST.NS: financial holding co (Tata Investment Corp) — FCF inflated by investment
  // flows, removed 2026-06-27 but reappeared 2026-07-11 with no permanent blacklist.
  blacklist: ['TATAINVEST.NS'],
  startingValue: 100000,
  indexTicker: '^NSEI',
  indexName: 'NIFTY 50',
  cacheFile: '_evaluated-nifty.json',
  rawFile: '_raw-nifty.json',
};

runScreen(config).catch(err => { console.error(err); process.exit(1); });
