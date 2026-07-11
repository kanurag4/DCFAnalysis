// Guards the committed portfolio-value.json / portfolio-history.json files
// themselves — not just the pure function — so drift introduced by a manual
// edit (e.g. a future one-off patch script) is caught by `npm test` before it
// ever reaches a batch run or deploy. See CLAUDE.md "Corrected 2026-07-12".
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checkIndexSeedConsistency } = require('../scripts/lib/portfolio.js');

const SCREENS = ['asx-undervalued', 'sp500-undervalued', 'nifty-undervalued'];

describe('portfolio-value.json vs portfolio-history.json index seed', () => {
  for (const screen of SCREENS) {
    it(`${screen}: indexSeedPrice matches history[0].indexPrice`, () => {
      const base = path.join(__dirname, '..', 'www', screen);
      const portfolio = JSON.parse(fs.readFileSync(path.join(base, 'portfolio-value.json'), 'utf8'));
      const history = JSON.parse(fs.readFileSync(path.join(base, 'portfolio-history.json'), 'utf8'));
      const error = checkIndexSeedConsistency(portfolio, history);
      assert.equal(error, null, error || '');
    });
  }
});
