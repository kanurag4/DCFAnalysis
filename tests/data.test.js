const { test } = require('node:test');
const assert = require('node:assert');
const { mapQuoteSummary } = require('../www/data.js');

function fixtureBody({ netIncome, depreciation }) {
  return {
    quoteSummary: {
      result: [{
        incomeStatementHistory: { incomeStatementHistory: [{ netIncome: { raw: netIncome }, incomeTaxExpense: {}, incomeBeforeTax: {}, interestExpense: {} }] },
        cashflowStatementHistory: { cashflowStatements: [{ capitalExpenditures: { raw: -20 }, depreciation: { raw: depreciation } }] },
        financialData: {}, summaryDetail: {}, defaultKeyStatistics: {}, assetProfile: {}, quoteType: {},
      }],
    },
  };
}

test('mapQuoteSummary extracts netIncome and depreciationAndAmortization', () => {
  const data = mapQuoteSummary(fixtureBody({ netIncome: 100, depreciation: 40 }), 'GPT.AX');
  assert.strictEqual(data.netIncome, 100);
  assert.strictEqual(data.depreciationAndAmortization, 40);
});

test('mapQuoteSummary returns null for missing netIncome/depreciation', () => {
  const data = mapQuoteSummary(fixtureBody({ netIncome: undefined, depreciation: undefined }), 'GPT.AX');
  assert.strictEqual(data.netIncome, null);
  assert.strictEqual(data.depreciationAndAmortization, null);
});
