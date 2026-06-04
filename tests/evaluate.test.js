const { test } = require('node:test');
const assert = require('node:assert');
const { evaluateStock } = require('../scripts/lib/evaluate.js');

const params = { rf: 0.048, erp: 0.06 };

const dcfStock = {
  ticker: 'AAA.AX', name: 'Alpha', sector: 'Industrials', industry: 'Tools',
  price: 10, marketCap: 1e9, totalDebt: 1e8, totalCash: 5e7,
  sharesOutstanding: 1e8, beta: 0.9, interestExpense: -1e6, taxRate: 0.3,
  freeCashflow: 1.2e8, operatingCashflow: 1.5e8, capitalExpenditures: -3e7,
  revenueGrowth: 0.06, earningsGrowth: 0.08, trailingPE: 14,
};

test('values a normal industrial via DCF', () => {
  const r = evaluateStock(dcfStock, params);
  assert.strictEqual(r.excluded, undefined);
  assert.strictEqual(r.method, 'DCF');
  assert.strictEqual(r.fcfMethod, 'reported');
  assert.ok(typeof r.intrinsic === 'number' && r.intrinsic > 0);
  assert.ok(typeof r.marginOfSafety === 'number');
  assert.ok(r.terminalValuePct > 0);
});

test('routes a bank to DDM', () => {
  const bank = { ...dcfStock, ticker: 'BBB.AX', sector: 'Financial Services', industry: 'Banks—Diversified', trailingAnnualDividendRate: 0.8, dividendYield: 0.08 };
  const r = evaluateStock(bank, params);
  assert.strictEqual(r.method, 'DDM');
  assert.strictEqual(r.fcfMethod, undefined);
  assert.ok(r.intrinsic > 0);
});

test('excludes a stock with non-positive FCF', () => {
  const r = evaluateStock({ ...dcfStock, freeCashflow: null, operatingCashflow: -1e7, capitalExpenditures: null }, params);
  // OCF<0 → proxy gives negative fcf → calculateDCF returns null
  assert.strictEqual(r.excluded, true);
});

test('flags proxy FCF so rank can drop it', () => {
  const r = evaluateStock({ ...dcfStock, freeCashflow: null, operatingCashflow: 2e8, capitalExpenditures: null }, params);
  assert.strictEqual(r.fcfMethod, 'proxy');
});

test('excludes a bank with no dividend', () => {
  const r = evaluateStock({ ...dcfStock, ticker: 'CCC.AX', sector: 'Financial Services', industry: 'Banks', trailingAnnualDividendRate: null, dividendRate: null, dividendYield: null }, params);
  assert.strictEqual(r.excluded, true);
});

// ── Non-bank financial-sector FCF normalisation (must mirror the live tool) ──
// The live DCF tool seeds normalised FCF = fcf * 0.6 for non-bank financials
// (app.js prefill + buildScenarios). The batch must apply the same haircut, or
// it overstates fair value for Visa/exchanges/asset managers and floods the list.
const usParams = { rf: 0.045, erp: 0.055 };
const usFixture = (over = {}) => ({
  ticker: 'TEST', name: 'Test Co', sector: 'Technology', industry: 'Software',
  price: 50, currency: 'USD', trailingPE: 20, marketCap: 50000e6,
  operatingMargins: 0.25, targetMeanPrice: 60,
  beta: 1.0, freeCashflow: 1000e6, operatingCashflow: 1200e6, capitalExpenditures: -200e6,
  totalDebt: 0, totalCash: 0, sharesOutstanding: 1000e6,
  interestExpense: null, taxRate: null, revenueGrowth: 0.10, earningsGrowth: 0.10,
  ...over,
});

test('non-bank financial gets the 0.6 FCF haircut (fin@F == nonfin@0.6F)', () => {
  const fin  = evaluateStock(usFixture({ sector: 'Financial Services', industry: 'Asset Management', freeCashflow: 1000e6 }), usParams);
  const tech = evaluateStock(usFixture({ sector: 'Technology', industry: 'Software', freeCashflow: 600e6 }), usParams);
  assert.strictEqual(fin.method, 'DCF');
  assert.strictEqual(tech.method, 'DCF');
  assert.ok(Math.abs(fin.intrinsic - tech.intrinsic) <= 0.01,
    `financial(1000) should equal non-financial(600); got ${fin.intrinsic} vs ${tech.intrinsic}`);
});

test('non-financial stocks use full FCF (no haircut)', () => {
  const full = evaluateStock(usFixture({ freeCashflow: 1000e6 }), usParams);
  const less = evaluateStock(usFixture({ freeCashflow: 600e6 }), usParams);
  assert.ok(Math.abs(full.intrinsic - less.intrinsic) > 1, 'non-financial must not be haircut');
});
