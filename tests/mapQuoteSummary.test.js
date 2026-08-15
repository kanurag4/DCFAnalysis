const { test } = require('node:test');
const assert = require('node:assert');
const { mapQuoteSummary } = require('../www/data.js');

const sample = {
  quoteSummary: { result: [{
    quoteType: { longName: 'BHP Group', shortName: 'BHP' },
    financialData: { currentPrice: { raw: 40 }, freeCashflow: { raw: 1000 }, operatingCashflow: { raw: 1500 }, totalCash: { raw: 200 }, totalDebt: { raw: 500 }, revenueGrowth: { raw: 0.05 }, earningsGrowth: { raw: 0.07 }, operatingMargins: { raw: 0.18 }, targetMeanPrice: { raw: 52.5 } },
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
  assert.strictEqual(d.marketCap, 200000);
  assert.strictEqual(d.operatingMargins, 0.18);
  assert.strictEqual(d.targetMeanPrice, 52.5);
});

test('throws a clear error when result is empty', () => {
  assert.throws(() => mapQuoteSummary({ quoteSummary: { result: [] } }, 'XYZ.AX'), /No data/);
});

// ── trailingEps (added for Excess Return Model's ROE fallback derivation) ──

test('maps trailingEps from defaultKeyStatistics', () => {
  const body = { quoteSummary: { result: [{
    quoteType: { longName: 'Test Co' },
    financialData: { currentPrice: { raw: 40 } },
    summaryDetail: { currency: 'AUD' },
    defaultKeyStatistics: { trailingEps: { raw: 5.25 } },
    assetProfile: {},
  }] } };
  const d = mapQuoteSummary(body, 'TEST.AX');
  assert.strictEqual(d.trailingEps, 5.25);
});

test('trailingEps is null when missing', () => {
  const body = { quoteSummary: { result: [{
    quoteType: { longName: 'Test Co' },
    financialData: { currentPrice: { raw: 40 } },
    summaryDetail: { currency: 'AUD' },
    defaultKeyStatistics: {},
    assetProfile: {},
  }] } };
  const d = mapQuoteSummary(body, 'TEST.AX');
  assert.strictEqual(d.trailingEps, null);
});

test('trailingEps is scaled x100 for GBp (pence) tickers, matching dividendRate', () => {
  const body = { quoteSummary: { result: [{
    quoteType: { longName: 'UK Bank' },
    financialData: { currentPrice: { raw: 650 } },
    summaryDetail: { currency: 'GBp' },
    defaultKeyStatistics: { trailingEps: { raw: 0.42 } }, // Yahoo reports EPS in GBP even when price is GBp
    assetProfile: {},
  }] } };
  const d = mapQuoteSummary(body, 'HSBA.L');
  assert.strictEqual(d.trailingEps, 42); // 0.42 * 100
});
