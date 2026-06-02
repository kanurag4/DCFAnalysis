const { test } = require('node:test');
const assert = require('node:assert');
const { mapQuoteSummary } = require('../www/data.js');

const sample = {
  quoteSummary: { result: [{
    quoteType: { longName: 'BHP Group', shortName: 'BHP' },
    financialData: { currentPrice: { raw: 40 }, freeCashflow: { raw: 1000 }, operatingCashflow: { raw: 1500 }, totalCash: { raw: 200 }, totalDebt: { raw: 500 }, revenueGrowth: { raw: 0.05 }, earningsGrowth: { raw: 0.07 } },
    summaryDetail: { marketCap: { raw: 200000 }, beta: { raw: 0.9 }, currency: 'AUD', dividendRate: { raw: 2 }, dividendYield: { raw: 0.05 } },
    defaultKeyStatistics: { sharesOutstanding: { raw: 5000 }, trailingAnnualDividendRate: { raw: 2.1 } },
    assetProfile: { sector: 'Basic Materials', industry: 'Other Industrial Metals & Mining' },
    incomeStatementHistory: { incomeStatementHistory: [{ incomeTaxExpense: { raw: 30 }, incomeBeforeTax: { raw: 100 }, interestExpense: { raw: -10 } }] },
    cashflowStatementHistory: { cashflowStatements: [{ capitalExpenditures: { raw: -300 } }] },
  }] }
};

test('maps core DCF fields from a quoteSummary payload', () => {
  const d = mapQuoteSummary(sample, 'BHP.AX');
  assert.strictEqual(d.ticker, 'BHP.AX');
  assert.strictEqual(d.name, 'BHP Group');
  assert.strictEqual(d.price, 40);
  assert.strictEqual(d.freeCashflow, 1000);
  assert.strictEqual(d.capitalExpenditures, -300);
  assert.strictEqual(d.beta, 0.9);
  assert.strictEqual(d.taxRate, 0.3); // 30/100
  assert.strictEqual(d.trailingAnnualDividendRate, 2.1);
});

test('throws a clear error when result is empty', () => {
  assert.throws(() => mapQuoteSummary({ quoteSummary: { result: [] } }, 'XYZ.AX'), /No data/);
});
