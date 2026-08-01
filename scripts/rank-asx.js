// scripts/rank-asx.js
// Monthly batch: evaluate the ASX 300 base case, rank by margin of safety,
// write www/asx-undervalued/rankings.json + merge first-seen.json.
//
//   node scripts/rank-asx.js            fetch all tickers, evaluate, rank, write
//   node scripts/rank-asx.js --rerank   re-rank the LAST run's cached data (no fetch)
const { runScreen } = require('./lib/run-screen.js');
const { fetchAusRf } = require('./lib/rf.js');
const blacklistEntries = require('./blacklist-asx.json');

const config = {
  universe: 'ASX 300',
  tickersFile: 'asx300.json',
  outDir: 'asx-undervalued',
  currency: 'AUD',
  liveKey: 'ausRf',
  fetchRf: fetchAusRf,
  rfLabel: 'AUS RF',
  topN: 20,
  maxMargin: 0.8,          // drop > 80% margins — the most assumption-fragile valuations
  // Manually curated exclusions — structurally misleading FCF/valuation for the DCF model.
  // Moved to scripts/blacklist-asx.json (2026-08-01) so the admin console's "Exclude &
  // re-run" action can append to it mechanically — see each entry's `reason` there.
  blacklist: blacklistEntries.map(e => e.ticker),
  indexTicker: '^AXJO',
  indexName: 'ASX 200',
  cacheFile: '_evaluated.json', // unchanged so existing cache + --rerank keep working
  rawFile: '_raw-asx.json',     // raw data cache for --reeval (gitignored scripts/_*)
};

runScreen(config).catch(err => { console.error(err); process.exit(1); });
