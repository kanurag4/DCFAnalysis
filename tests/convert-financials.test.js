const { test } = require('node:test');
const assert = require('node:assert/strict');
const { convertFinancials } = require('../scripts/lib/convert-financials.js');

function near(a, b, tol = 1e-9) { return Math.abs(a - b) < tol; }

test('matching currencies pass through untouched without fetching a rate', async () => {
  let called = false;
  const data = { currency: 'AUD', financialCurrency: 'AUD', freeCashflow: 1e8 };
  const out = await convertFinancials(data, { proxyUrl: 'x', fxCache: new Map(), fetchFx: async () => { called = true; return 1; } });
  assert.equal(out, data);
  assert.equal(called, false);
});

test('GBp/GBP pair passes through without fetching a rate (pence scaling already done)', async () => {
  let called = false;
  const data = { currency: 'GBp', financialCurrency: 'GBP', freeCashflow: 100 };
  const out = await convertFinancials(data, { proxyUrl: 'x', fxCache: new Map(), fetchFx: async () => { called = true; return 100; } });
  assert.equal(out, data);
  assert.equal(called, false);
});

test('USD>AUD: converts all scalar fields and history series by the rate', async () => {
  const data = {
    currency: 'AUD', financialCurrency: 'USD',
    freeCashflow: 1e8, operatingCashflow: 1.2e8, capitalExpenditures: -2e7,
    totalCash: 5e7, totalDebt: 3e8, totalRevenue: 8e8, ebit: 1.5e8,
    interestExpense: -1e7, annualFcf: 9e7, netIncome: 6e7,
    depreciationAndAmortization: 2e7, ebitda: 1.7e8,
    price: 30, marketCap: 3e10, sharesOutstanding: 1e9,
    annualFcfHistory:          [{ date: '2025', value: 9e7 }],
    annualRevenueHistory:      [{ date: '2025', value: 8e8 }],
    annualNetIncomeHistory:    [{ date: '2025', value: 6e7 }],
    annualStockholdersEquityHistory: [{ date: '2025', value: 4e8 }],
    annualDividendsPaidHistory: [{ date: '2025', value: -1e7 }],
    annualTotalAssetsHistory:  [{ date: '2025', value: 1e9 }],
    annualCurrentAssetsHistory:[{ date: '2025', value: 2e8 }],
    annualCurrentLiabilitiesHistory: [{ date: '2025', value: 1e8 }],
    annualTotalLiabilitiesHistory:   [{ date: '2025', value: 6e8 }],
    annualRetainedEarningsHistory:   [{ date: '2025', value: 3e8 }],
    annualTotalDebtHistory:    [{ date: '2025', value: 3e8 }],
    annualCapexHistory:        [{ date: '2025', value: -2e7 }],
    annualGrossProfitHistory:  [{ date: '2025', value: 4e8 }],
    annualSharesHistory:       [{ date: '2025', value: 1e9 }],
  };
  const rate = 1.5435;
  const out = await convertFinancials(data, { proxyUrl: 'x', fxCache: new Map(), fetchFx: async () => rate });

  // Scalar fields converted
  assert.ok(near(out.freeCashflow, 1e8 * rate));
  assert.ok(near(out.totalRevenue, 8e8 * rate));
  assert.ok(near(out.ebit, 1.5e8 * rate));
  // Quote-currency fields untouched
  assert.equal(out.price, 30);
  assert.equal(out.marketCap, 3e10);
  // History fields converted
  assert.ok(near(out.annualFcfHistory[0].value, 9e7 * rate));
  assert.ok(near(out.annualTotalAssetsHistory[0].value, 1e9 * rate));
  assert.ok(near(out.annualCapexHistory[0].value, -2e7 * rate));
  // Share count NOT converted
  assert.equal(out.annualSharesHistory[0].value, 1e9);
  assert.equal(out.fxConversionFailed, undefined);
});

test('fail-closed: rate null nulls scalars and empties all history series', async () => {
  const data = {
    currency: 'AUD', financialCurrency: 'USD',
    freeCashflow: 1e8, totalRevenue: 8e8,
    annualFcfHistory: [{ date: '2025', value: 9e7 }],
    annualTotalAssetsHistory: [{ date: '2025', value: 1e9 }],
    annualSharesHistory: [{ date: '2025', value: 1e9 }],
  };
  const out = await convertFinancials(data, { proxyUrl: 'x', fxCache: new Map(), fetchFx: async () => null });
  assert.equal(out.freeCashflow, null);
  assert.equal(out.totalRevenue, null);
  assert.equal(out.fxConversionFailed, true);
  assert.deepStrictEqual(out.annualFcfHistory, []);
  assert.deepStrictEqual(out.annualTotalAssetsHistory, []);
});

test('fxCache: only one network call per currency pair across multiple tickers', async () => {
  let calls = 0;
  const fxCache = new Map();
  const fx = async () => { calls++; return 1.5; };
  const make = () => ({ currency: 'AUD', financialCurrency: 'USD', freeCashflow: 1e8 });
  await convertFinancials(make(), { proxyUrl: 'x', fxCache, fetchFx: fx });
  await convertFinancials(make(), { proxyUrl: 'x', fxCache, fetchFx: fx });
  await convertFinancials(make(), { proxyUrl: 'x', fxCache, fetchFx: fx });
  assert.equal(calls, 1);
});

test('missing history fields default to empty arrays (not errors)', async () => {
  const data = { currency: 'AUD', financialCurrency: 'USD', freeCashflow: 1e8 };
  const out = await convertFinancials(data, { proxyUrl: 'x', fxCache: new Map(), fetchFx: async () => 1.5 });
  assert.deepStrictEqual(out.annualFcfHistory, []);
  assert.deepStrictEqual(out.annualTotalAssetsHistory, []);
});
