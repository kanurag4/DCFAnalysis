// Heavy capex spending on the per-ticker pages (StockAnalysis spec 2026-11-05-heavy-capex-spending-design.md).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fetchHistorySeries, heavyCapexForTickerPage, heavyCapexPageCardHtml } = require('../scripts/lib/ticker-page.js');
const { heavyCapexValuation } = require('../www/calc/heavyCapex.js');

const series = (vals) => vals.map((value, i) => ({ date: `${2022 + i}-06-30`, value }));
const Q = ['2025-12-31', '2026-03-31', '2026-06-30', '2026-09-30'];
const data = {
  ticker: 'CAPX', sector: 'Communication Services', industry: 'Internet Content & Information', price: 300,
  marketCap: 3e11, totalRevenue: 7.6e10, operatingCashflow: 2.4e10, freeCashflow: 2e9, dilutedSharesOutstanding: 1.02e9,
};
const hist = {
  ebit: 2e10,
  ttm: { ttmCapex: 2.2e10, ttmOcf: 2.4e10, ttmDepreciation: 4e9, lastQuarterCapex: 6.5e9 },
  annualFcfHistory: series([1.1e10, 1.25e10, 1.4e10, 1.5e10]), annualRevenueHistory: series([6e10, 6.6e10, 7.1e10, 7.6e10]),
  annualCapexHistory: series([-5e9, -5.5e9, -1.2e10, -2.2e10]),
  annualTotalAssetsHistory: series([1.5e11, 1.6e11, 1.7e11, 1.8e11]), annualCurrentAssetsHistory: series([5e10, 5.5e10, 6e10, 6.5e10]),
  annualCurrentLiabilitiesHistory: series([3e10, 3.1e10, 3.2e10, 3.3e10]), annualTotalLiabilitiesHistory: series([8e10, 8.2e10, 8.4e10, 8.5e10]),
  annualRetainedEarningsHistory: series([4e10, 4.5e10, 5e10, 5.6e10]), annualTotalDebtHistory: series([2.2e10, 2.1e10, 2.05e10, 2e10]),
  annualNetIncomeHistory: series([9e9, 1e10, 1.1e10, 1.2e10]), annualSharesHistory: series([1.05e9, 1.04e9, 1.03e9, 1.02e9]),
  annualGrossProfitHistory: series([2.7e10, 3e10, 3.2e10, 3.4e10]),
};

test('fetchHistorySeries returns the trailing-12-month capex / cash flow / depreciation', async () => {
  global.fetch = async () => ({ ok: true, json: async () => ({
    quarterlyCapitalExpenditure: Q.map(date => ({ date, value: -5e9 })),
    quarterlyOperatingCashFlow: Q.map(date => ({ date, value: 6e9 })),
    quarterlyDepreciationAndAmortization: Q.map(date => ({ date, value: 1e9 })),
  }) });
  const h = await fetchHistorySeries('CAPX', 'https://proxy', 'USD');
  assert.deepEqual(h.ttm, { ttmCapex: 2e10, ttmOcf: 2.4e10, ttmDepreciation: 4e9, lastQuarterCapex: 5e9, ttmSource: 'quarterly' });
});

test('heavyCapexForTickerPage: applies for a qualifying company; cyclical / borrowed build do not', () => {
  const fcfInfo = { value: 2e9, method: 'reported' };
  assert.equal(heavyCapexForTickerPage(data, hist, fcfInfo).applies, true);
  assert.equal(heavyCapexForTickerPage({ ...data, industry: 'Gold', sector: 'Basic Materials' }, hist, fcfInfo).applies, false);
  assert.equal(heavyCapexForTickerPage(data, { ...hist, ttm: { ...hist.ttm, ttmOcf: 1.2e10 } }, fcfInfo).applies, false);
  assert.equal(heavyCapexForTickerPage(data, { ...hist, ttm: undefined }, fcfInfo).applies, false);
});

test('heavyCapexPageCardHtml: the shared wording, escaped, with the glossary link', () => {
  const check = heavyCapexForTickerPage(data, hist, { value: 2e9, method: 'reported' });
  const v = heavyCapexValuation({ ...data }, check, [{ key: 'base', wacc: 0.1, result: { intrinsicValue: 250 } }]);
  const html = heavyCapexPageCardHtml({ check, valuation: v }, 300, '$');
  assert.match(html, /<section class="heavy-capex-card">/);
  assert.match(html, /<h3>Heavy capex spending<\/h3>/);
  assert.match(html, /Today&#39;s price of \$300\.00 assumes the new spending earns about <strong>/);
  assert.match(html, /Base assumes the new spending earns exactly its cost of capital/);
  assert.match(html, /href="\/glossary\/heavy-capex-spending\/"/);
});
