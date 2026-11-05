// Heavy capex spending in the screen engine (scripts/lib/evaluate.js) -- StockAnalysis spec
// docs/superpowers/specs/2026-11-05-heavy-capex-spending-design.md. Same shared module (www/calc/heavyCapex.js) as
// /evaluate/, /dcf/, native, ticker pages and the Watchlist.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evaluateStock } = require('../scripts/lib/evaluate.js');
const { convertFinancials } = require('../scripts/lib/convert-financials.js');
const { heavyCapexValuation } = require('../www/calc/heavyCapex.js');

const params = { rf: 0.048, erp: 0.0442 };
const series = (vals) => vals.map((value, i) => ({ date: `${2022 + i}-06-30`, value }));

// Capex 2.2e10 = 29% of revenue, 5.5x depreciation, 0.92x operating cash flow; FCF 2e9 vs best 1.5e10.
function capx(over = {}) {
  return {
    ticker: 'CAPX', name: 'Capex Platforms', sector: 'Communication Services', industry: 'Internet Content & Information',
    currency: 'USD', financialCurrency: 'USD',
    price: 300, marketCap: 3e11, totalDebt: 2e10, totalCash: 3e10, beta: 1.1, interestExpense: -1e9, taxRate: 0.18,
    ebit: 2e10, revenueGrowth: 0.08, earningsGrowth: 0.10, sharesOutstanding: 1e9, dilutedSharesOutstanding: 1.02e9,
    totalRevenue: 7.6e10, freeCashflow: 2e9, operatingCashflow: 2.4e10, capitalExpenditures: -2.2e10, trailingPE: 24,
    ttmCapex: 2.2e10, ttmOcf: 2.4e10, ttmDepreciation: 4e9, lastQuarterCapex: 6.5e9,
    annualRevenueHistory: series([6e10, 6.6e10, 7.1e10, 7.6e10]),
    annualFcfHistory: series([1.1e10, 1.25e10, 1.4e10, 1.5e10]),
    annualNetIncomeHistory: series([9e9, 1e10, 1.1e10, 1.2e10]),
    annualStockholdersEquityHistory: series([5e10, 5.5e10, 6e10, 6.5e10]),
    annualTotalAssetsHistory: series([1.5e11, 1.6e11, 1.7e11, 1.8e11]),
    annualCapexHistory: series([-5e9, -5.5e9, -1.2e10, -2.2e10]),
    annualTotalDebtHistory: series([2.2e10, 2.1e10, 2.05e10, 2e10]),
    annualTotalLiabilitiesHistory: series([8e10, 8.2e10, 8.4e10, 8.5e10]),
    annualCurrentAssetsHistory: series([5e10, 5.5e10, 6e10, 6.5e10]),
    annualCurrentLiabilitiesHistory: series([3e10, 3.1e10, 3.2e10, 3.3e10]),
    annualSharesHistory: series([1.05e9, 1.04e9, 1.03e9, 1.02e9]),
    annualGrossProfitHistory: series([2.7e10, 3e10, 3.2e10, 3.4e10]),
    annualRetainedEarningsHistory: series([4e10, 4.5e10, 5e10, 5.6e10]),
    ...over,
  };
}
const MAINTENANCE = Math.max(4e9, ((5e9 / 6e10 + 5.5e9 / 6.6e10) / 2) * 7.6e10);

test('a qualifying company is valued as existing business + growth capex at the cost of capital', () => {
  const r = evaluateStock(capx(), params);
  assert.equal(r.method, 'DCF');
  assert.equal(r.fcfMethod, 'heavy-capex');
  // The existing business alone: the same engine on operating cash flow - maintenance capex, no heavy-capex fields.
  const plain = capx({ freeCashflow: 2.4e10 - MAINTENANCE, ttmCapex: null, ttmOcf: null, ttmDepreciation: null });
  const existing = evaluateStock(plain, params);
  assert.equal(existing.fcfMethod, 'reported');
  const want = heavyCapexValuation(capx(), r.heavyCapexCheck, [{ key: 'base', wacc: existing.wacc, result: { intrinsicValue: existing.intrinsic } }]);
  const base = want.scenarios[0];
  assert.ok(Math.abs(r.intrinsic - base.result.intrinsicValue) < 1e-6, `${r.intrinsic} vs ${base.result.intrinsicValue}`);
  assert.ok(Math.abs(r.marginOfSafety - base.result.marginOfSafety) < 1e-9);
  assert.ok(Math.abs(r.impliedReturnOnCapex - want.implied.returnOnCapex) < 1e-9);
  assert.equal(r.impliedReturnStatus, want.implied.status);
});

test('borrowed build (capex 1.83x operating cash flow), REIT, airline and cyclical are unchanged', () => {
  for (const over of [{ ttmOcf: 1.2e10, operatingCashflow: 1.2e10 }, { sector: 'Real Estate', industry: 'REIT - Office' },
    { sector: 'Industrials', industry: 'Airlines' }, { sector: 'Basic Materials', industry: 'Gold' }]) {
    const r = evaluateStock(capx(over), params);
    assert.notEqual(r.fcfMethod, 'heavy-capex', JSON.stringify(over));
    assert.equal(r.impliedReturnOnCapex, undefined);
  }
});

test('a conglomerate takes the holdco discount on the existing business only, like /evaluate/', () => {
  const r = evaluateStock(capx({ industry: 'Conglomerates', sector: 'Industrials' }), params);
  assert.equal(r.fcfMethod, 'heavy-capex');
  const plain = evaluateStock(capx({ industry: 'Conglomerates', sector: 'Industrials', freeCashflow: 2.4e10 - MAINTENANCE, ttmCapex: null, ttmOcf: null, ttmDepreciation: null }), params);
  const term = r.heavyCapexTerm;
  assert.ok(Math.abs(r.intrinsic - (plain.intrinsic + term)) < 1e-6, `${r.intrinsic} vs ${plain.intrinsic} + ${term}`);
});

test('convertFinancials converts the trailing capex / cash flow / depreciation fields', async () => {
  const out = await convertFinancials(capx({ currency: 'HKD', financialCurrency: 'CNY' }), { proxyUrl: 'x', fxCache: new Map(), fetchFx: async () => 1.1 });
  assert.ok(Math.abs(out.ttmCapex - 2.2e10 * 1.1) < 1);
  assert.ok(Math.abs(out.ttmOcf - 2.4e10 * 1.1) < 1);
  assert.ok(Math.abs(out.ttmDepreciation - 4e9 * 1.1) < 1);
  assert.ok(Math.abs(out.lastQuarterCapex - 6.5e9 * 1.1) < 1);
  const failed = await convertFinancials(capx({ currency: 'HKD', financialCurrency: 'CNY' }), { proxyUrl: 'x', fxCache: new Map(), fetchFx: async () => null });
  assert.equal(failed.ttmCapex, null);
  assert.equal(failed.ttmOcf, null);
});
