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
