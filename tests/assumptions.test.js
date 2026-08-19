const { test } = require('node:test');
const assert = require('node:assert');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// calc/assumptions.js loads its dependencies as bare globals (<script> tag
// convention, see the file's own header comment) -- for Node tests, load
// every dependency into one shared context the same way the browser's
// script-tag load order does, then read assumptions.js's own functions
// out of that context.
function loadAssumptionsContext(repoRoot) {
  const ctx = { module: { exports: {} }, console };
  vm.createContext(ctx);
  const files = [
    'www/utils.js', 'www/calc/wacc.js', 'www/calc/dcf.js', 'www/calc/ddm.js',
    'www/calc/fadingGrowthDcf.js', 'www/calc/excessReturn.js', 'www/calc/reit.js',
    'www/config.js', 'www/calc/assumptions.js',
  ];
  for (const f of files) {
    ctx.module = { exports: {} }; // reset between files -- each script tag is its own global scope for module.exports, but functions/consts persist on ctx
    vm.runInContext(fs.readFileSync(path.join(repoRoot, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

const ctx = loadAssumptionsContext(path.join(__dirname, '..'));

test('deriveDcfAssumptions detects a REIT and selects the reit model', () => {
  const data = {
    ticker: 'GPT.AX', sector: 'Real Estate', industry: 'REIT - Retail',
    price: 4.50, marketCap: 5000000000, totalDebt: 2000000000, beta: 0.8,
    netIncome: 200000000, depreciationAndAmortization: 150000000, capitalExpenditures: -50000000,
    sharesOutstanding: 1800000000,
  };
  const assumptions = ctx.deriveDcfAssumptions(data);
  assert.strictEqual(assumptions.isReit, true);
  assert.strictEqual(assumptions.valuationModel, 'reit');
  assert.ok(assumptions.modelSeeds.reit, 'expected modelSeeds.reit to exist');
  assert.ok(assumptions.modelSeeds.reit.affoPerShare > 0);
  assert.strictEqual(assumptions.modelSeeds.reit.multiple.base, 13); // REIT_SECTOR_MULTIPLES['REIT - Retail']
});

test('deriveDcfAssumptions uses the DEFAULT multiple for an unlisted REIT industry tag', () => {
  const data = {
    ticker: 'XYZ.AX', sector: 'Real Estate', industry: 'REIT - Data Centers',
    price: 10, marketCap: 1000000000, totalDebt: 500000000, beta: 1.0,
    netIncome: 50000000, depreciationAndAmortization: 30000000, capitalExpenditures: -10000000,
    sharesOutstanding: 100000000,
  };
  const assumptions = ctx.deriveDcfAssumptions(data);
  assert.strictEqual(assumptions.modelSeeds.reit.multiple.base, 14); // DEFAULT
});

test('deriveDcfAssumptions does not select reit for a non-REIT real estate company', () => {
  const data = {
    ticker: 'ABC.AX', sector: 'Real Estate', industry: 'Real Estate Services',
    price: 10, marketCap: 1000000000, totalDebt: 500000000, beta: 1.0,
    freeCashflow: 50000000, sharesOutstanding: 100000000,
  };
  const assumptions = ctx.deriveDcfAssumptions(data);
  assert.strictEqual(assumptions.isReit, false);
  assert.notStrictEqual(assumptions.valuationModel, 'reit');
});

test('computeScenarios reit branch varies the multiple across bear/base/bull, not a rate', () => {
  const data = { price: 60 };
  const seeds = { affoPerShare: 5, multiple: { bear: 11.2, base: 14, bull: 16.8 } }; // 0.8x/1.0x/1.2x of 14
  const scenarios = ctx.computeScenarios(data, 'reit', seeds, {});
  assert.strictEqual(scenarios.length, 3);
  const base = scenarios.find(s => s.key === 'base');
  assert.strictEqual(base.result.intrinsicValue, 70); // 5 * 14
  const bear = scenarios.find(s => s.key === 'bear');
  assert.ok(bear.result.intrinsicValue < base.result.intrinsicValue);
  const bull = scenarios.find(s => s.key === 'bull');
  assert.ok(bull.result.intrinsicValue > base.result.intrinsicValue);
});

test('computeScenarios reit branch reports noAffo when affoPerShare is missing', () => {
  const data = { price: 60 };
  const seeds = { affoPerShare: null, multiple: { bear: 11.2, base: 14, bull: 16.8 } };
  const scenarios = ctx.computeScenarios(data, 'reit', seeds, {});
  const base = scenarios.find(s => s.key === 'base');
  assert.strictEqual(base.result, null);
  assert.strictEqual(base.noAffo, true);
});
