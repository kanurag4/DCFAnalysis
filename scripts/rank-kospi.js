// scripts/rank-kospi.js
// Monthly batch: evaluate the KOSPI 200 base case, rank by margin of safety,
// write www/kospi-undervalued/rankings.json + merge first-seen.json.
//
//   node scripts/rank-kospi.js            fetch all tickers, evaluate, rank, write
//   node scripts/rank-kospi.js --rerank   re-rank the LAST run's cached data (no fetch)
//   node scripts/rank-kospi.js --reeval   re-evaluate cached raw data (~2s, no fetch)
//
// No fetchRf: Korea has no live 10-yr KTB yield ticker on Yahoo (see market.js and
// docs/japan-korea-market-research.md) — the static rf/erp/terminalGrowth seeds live
// entirely in marketParamsFor's .KS branch.
const { runScreen } = require('./lib/run-screen.js');

const config = {
  universe: 'KOSPI 200',
  tickersFile: 'kospi200.json',
  outDir: 'kospi-undervalued',
  currency: 'KRW',
  liveKey: 'krRf',
  fetchRf: null,
  rfLabel: 'KOR RF',
  topN: 20,
  maxMargin: 0.8,
  // Chaebol-affiliate annotation (additive, not exclusionary — see run-screen.js
  // and www/kospi-undervalued/app.js). Seeded from names confirmed during the
  // 2026-07-18 exploratory research pass (docs/japan-korea-market-research.md);
  // expand as new chaebol-affiliate names enter the qualified list — same
  // reactive-curation workflow as the blacklist arrays on the other screens.
  chaebolAffiliates: {
    '008770.KS': 'Samsung Group',        // Hotel Shilla
    '071970.KS': 'Hyundai Heavy Industries Group', // HD-Hyundai Marine Engine
    '028050.KS': 'Samsung Group',        // Samsung E&A
    '0126Z0.KS': 'Samsung Group',        // Samsung Epis Holdings
  },
  blacklist: [],
  startingValue: 10000000,
  indexTicker: '^KS200',
  indexName: 'KOSPI 200',
  cacheFile: '_evaluated-kospi.json',
  rawFile: '_raw-kospi.json',
};

runScreen(config).catch(err => { console.error(err); process.exit(1); });
