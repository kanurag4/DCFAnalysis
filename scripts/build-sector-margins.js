// scripts/build-sector-margins.js
// Rebuilds www/sector-margins.json from every market's committed
// www/<market>-undervalued/sector-margins-slice.json. Run by
// publish-screen.yml after each market's cherry-pick (so the lookup always
// reflects every published market, not just the last one to run), and safe
// to run locally any time.
//
//   node scripts/build-sector-margins.js
const { rebuildLookup, readSlices } = require('./lib/sector-margin-tally.js');

const slices = readSlices();
const flat = rebuildLookup();
const markets = Object.entries(slices).map(([m, s]) => `${m} (${s.asAt || '?'})`).join(', ') || 'none';
console.log(`sector-margins.json: ${Object.keys(flat).length} industries from ${markets}`);
