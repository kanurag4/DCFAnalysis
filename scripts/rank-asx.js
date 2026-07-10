// scripts/rank-asx.js
// Monthly batch: evaluate the ASX 300 base case, rank by margin of safety,
// write www/asx-undervalued/rankings.json + merge first-seen.json.
//
//   node scripts/rank-asx.js            fetch all tickers, evaluate, rank, write
//   node scripts/rank-asx.js --rerank   re-rank the LAST run's cached data (no fetch)
const { runScreen } = require('./lib/run-screen.js');
const { fetchAusRf } = require('./lib/rf.js');

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
  // MFF.AX: LIC (MFF Capital Investments) — FCF inflated by investment flows, removed 4x (2026-06 to 2026-07).
  // WPR.AX: REIT (Waypoint REIT) — same DCF-on-investment-flows issue, removed 2x.
  // GOZ.AX: REIT (Growthpoint Properties Australia) — rental FCF not DCF-representative, removed 2026-07-10.
  // RGN.AX: REIT (Region Group) — same REIT FCF issue, removed 2026-07-10.
  blacklist: ['MFF.AX', 'WPR.AX', 'GOZ.AX', 'RGN.AX'],
  indexTicker: '^AXJO',
  indexName: 'ASX 200',
  cacheFile: '_evaluated.json', // unchanged so existing cache + --rerank keep working
  rawFile: '_raw-asx.json',     // raw data cache for --reeval (gitignored scripts/_*)
};

runScreen(config).catch(err => { console.error(err); process.exit(1); });
