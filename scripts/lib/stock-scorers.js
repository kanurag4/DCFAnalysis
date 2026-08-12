// Runs the Stock Evaluator's Buffett/Dalio/Graham scorers from Node without
// touching their source files. scripts/lib/stock-scorers/{utils.js,
// scorers/*.js} are vendored, byte-identical copies of StockAnalysis's
// www/stock/{utils.js,scorers/*.js} (see StockAnalysis's
// scripts/shared-files-manifest.json — run `npm run check-drift` there to
// verify) — plain browser globals with no module.exports, deliberately left
// that way so this loader executes the exact same bytes the live Stock
// Evaluator does. Evaluated in one shared vm context, the same effect as a
// browser loading consecutive <script> tags in dependency order.
//
// NOT itself vendored/paired with StockAnalysis's copy of this file — this
// one deliberately differs, since it points at this repo's vendored
// scripts/lib/stock-scorers/ instead of a live www/stock/. See that
// repo's version of this file for the fuller explanation of the split.
// scripts/lib/value-scale.js, which consumes this module's exports, IS
// byte-identical between the two repos.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const STOCK_DIR = path.join(__dirname, 'stock-scorers');

const SCORER_FILES = [
  'utils.js',
  'scorers/buffett.js',
  'scorers/dalio.js',
  'scorers/graham.js',
];

const ctx = {};
vm.createContext(ctx);
for (const rel of SCORER_FILES) {
  const abs = path.join(STOCK_DIR, rel);
  vm.runInContext(fs.readFileSync(abs, 'utf8'), ctx, { filename: abs });
}
const { buffettScore, dalioScore, grahamScore } = ctx;
if (typeof buffettScore !== 'function' || typeof dalioScore !== 'function' || typeof grahamScore !== 'function') {
  throw new Error(`stock-scorers.js: one or more scorer functions failed to load from ${STOCK_DIR}`);
}

// data.js already has a proper module.exports (see StockAnalysis's
// www/stock/data.js), so it's require()'d normally rather than run through vm.
const { mapStockData } = require(path.join(STOCK_DIR, 'data.js'));

module.exports = { buffettScore, dalioScore, grahamScore, mapStockData };
