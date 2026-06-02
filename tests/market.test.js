const { test } = require('node:test');
const assert = require('node:assert');
const { marketParamsFor } = require('../scripts/lib/market.js');

test('ASX ticker gets AUS rf fallback and 6% erp', () => {
  assert.deepStrictEqual(marketParamsFor('BHP.AX'), { rf: 0.048, erp: 0.06 });
});

test('ASX ticker uses provided live rf when given', () => {
  assert.deepStrictEqual(marketParamsFor('BHP.AX', { ausRf: 0.041 }), { rf: 0.041, erp: 0.06 });
});

test('US ticker (no suffix) gets US defaults', () => {
  assert.deepStrictEqual(marketParamsFor('AAPL'), { rf: 0.045, erp: 0.055 });
});
