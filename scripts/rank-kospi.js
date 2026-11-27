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
const blacklistEntries = require('./blacklist-kospi.json');

const config = {
  universe: 'KOSPI 200',
  tickersFile: 'kospi200.json',
  outDir: 'kospi-undervalued',
  currency: 'KRW',
  liveKey: 'krRf',
  fetchRf: null,
  rfLabel: 'KOR RF',
  topN: 20,
  maxMargin: 1.0,
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
    '011780.KS': 'Kumho Asiana Group',   // Kumho Petrochemical, added 2026-07-25
    '161890.KS': 'Kolmar Group',         // Kolmar Korea, added 2026-07-25
    '009540.KS': 'Hyundai Heavy Industries Group', // HD Korea Shipbuilding & Offshore Engineering (KSOE) -- same group as 071970.KS above, added 2026-09-05
    '078930.KS': 'GS Group',             // GS Holdings Corp -- the group's own apex holding company, added 2026-09-05
    // NOTE: distinct from '071970.KS' / '009540.KS' above ("Hyundai Heavy Industries
    // Group" / HD Hyundai) -- Hyundai Elevator is the de facto holding company of the
    // original (smaller, post-2000 split) Hyundai Group, an unrelated chaebol despite
    // the shared "Hyundai" branding. Don't merge these labels.
    '017800.KS': 'Hyundai Group',        // Hyundai Elevator, added 2026-09-05
    '064400.KS': 'LG Group',             // LG CNS, added 2026-09-05
    // Hyundai Motor Group (Hyundai Motor/Kia's chaebol) -- a 3rd, distinct
    // "Hyundai" label from the two above (Hyundai Heavy Industries Group /
    // HD Hyundai's shipbuilding group, and Hyundai Group / Hyundai Elevator's
    // group). Mobis is the group's auto-parts/component arm. Don't merge.
    '012330.KS': 'Hyundai Motor Group',  // Hyundai Mobis, added 2026-09-18
    // Added 2026-09-25 -- the admin console flagged all four as untagged qualifiers.
    '064350.KS': 'Hyundai Motor Group',  // Hyundai Rotem -- Hyundai Motor Group affiliate (same label as Mobis above)
    '005300.KS': 'Lotte Group',          // Lotte Chilsung Beverage
    '329180.KS': 'Hyundai Heavy Industries Group', // HD Hyundai Heavy Industries -- same group label as 071970.KS / 009540.KS above
    '051900.KS': 'LG Group',             // LG H&H -- same group as LG CNS above
    // Added 2026-11-28 -- the KOSPI review flagged all three as untagged.
    '017670.KS': 'SK Group',             // SK Telecom
    '402340.KS': 'SK Group',             // SK Square -- SK Group's ICT investment holding company
    '005930.KS': 'Samsung Group',        // Samsung Electronics
  },
  // Moved to scripts/blacklist-kospi.json (2026-08-01) — see rank-asx.js's comment.
  blacklist: blacklistEntries.map(e => e.ticker),
  startingValue: 10000000,
  // Switched from ^KS200 to ^KS11 (Composite) 2026-07-31 — "KOSPI" almost
  // always means the Composite in headlines/news, not the 200-stock
  // sub-index, and showing "-25% vs KOSPI 200" confused readers comparing
  // against real-world "KOSPI" coverage of the same crash. History was
  // backfilled in ^KS11 terms — see portfolio-history.json.
  indexTicker: '^KS11',
  indexName: 'KOSPI Composite',
  cacheFile: '_evaluated-kospi.json',
  rawFile: '_raw-kospi.json',
};

runScreen(config).catch(err => { console.error(err); process.exit(1); });
