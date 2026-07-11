// scripts/rank-sp500.js
// Monthly batch: evaluate the S&P 500 base case, rank by margin of safety,
// write www/sp500-undervalued/rankings.json + merge first-seen.json.
//
//   node scripts/rank-sp500.js            fetch all tickers, evaluate, rank, write
//   node scripts/rank-sp500.js --rerank   re-rank the LAST run's cached data (no fetch)
const { runScreen } = require('./lib/run-screen.js');
const { fetchUsRf } = require('./lib/rf.js');

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
  // DLR: REIT (Digital Realty Trust) — rental FCF not DCF-representative, removed 2026-06-26, reappeared 2026-07-10.
  // FRT: REIT (Federal Realty Investment Trust) — same REIT FCF issue, removed 2026-06-26, reappeared 2026-07-10.
  // AMP: financial asset manager (Ameriprise) — FCF inflated by investment flows, removed 2026-06-26, reappeared 2026-07-10.
  // ARE: REIT (Alexandria Real Estate Equities) — same REIT FCF issue, backfilled in after the DLR/FRT/AMP correction on 2026-07-10.
  blacklist: ['DLR', 'FRT', 'AMP', 'ARE'],
  indexTicker: '^GSPC',
  indexName: 'S&P 500',
  cacheFile: '_evaluated-sp500.json', // gitignored (scripts/_*)
  rawFile: '_raw-sp500.json',         // raw data cache for --reeval
};

runScreen(config).catch(err => { console.error(err); process.exit(1); });
