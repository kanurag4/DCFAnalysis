// scripts/rank-nikkei.js
// Monthly batch: evaluate the Nikkei 225 base case, rank by margin of safety,
// write www/nikkei-undervalued/rankings.json + merge first-seen.json.
//
//   node scripts/rank-nikkei.js            fetch all tickers, evaluate, rank, write
//   node scripts/rank-nikkei.js --rerank   re-rank the LAST run's cached data (no fetch)
//   node scripts/rank-nikkei.js --reeval   re-evaluate cached raw data (~2s, no fetch)
//
// No fetchRf: Japan has no live 10-yr JGB yield ticker on Yahoo (see market.js and
// docs/japan-korea-market-research.md) — the static rf/erp/terminalGrowth seeds live
// entirely in marketParamsFor's .T branch.
//
// No chaebolAffiliates-style flag: Japan's structural risk (keiretsu cross-shareholding
// unwinding) is diffuse rather than concentrated — the 2026-07-18 exploratory run's top
// 20 showed no group dominating, unlike KOSPI's. Covered by page disclosure copy instead;
// the config-driven flag mechanism stays available if curation ever demands it.
const { runScreen } = require('./lib/run-screen.js');
const blacklistEntries = require('./blacklist-nikkei.json');

const config = {
  universe: 'Nikkei 225',
  tickersFile: 'nikkei225.json',
  outDir: 'nikkei-undervalued',
  currency: 'JPY',
  liveKey: 'jpRf',
  fetchRf: null,
  rfLabel: 'JPN RF',
  topN: 20,
  maxMargin: 0.8,
  // Moved to scripts/blacklist-nikkei.json (2026-08-01) — see rank-asx.js's comment.
  blacklist: blacklistEntries.map(e => e.ticker),
  startingValue: 1000000,   // ¥1,000,000 — the natural round local figure, same real-value
                            // ballpark as the other screens' seeds (~USD 6.5–7K at ~150 ¥/$)
  indexTicker: '^N225',
  indexName: 'Nikkei 225',
  cacheFile: '_evaluated-nikkei.json',
  rawFile: '_raw-nikkei.json',
};

runScreen(config).catch(err => { console.error(err); process.exit(1); });
