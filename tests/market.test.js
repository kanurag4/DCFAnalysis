const { test } = require('node:test');
const assert = require('node:assert');
const { marketParamsFor } = require('../scripts/lib/market.js');

test('ASX ticker gets AUS rf fallback and 6% erp', () => {
  assert.deepStrictEqual(marketParamsFor('BHP.AX'), { rf: 0.048, erp: 0.06, terminalGrowth: 0.025 });
});

test('ASX ticker uses provided live rf when given', () => {
  assert.deepStrictEqual(marketParamsFor('BHP.AX', { ausRf: 0.041 }), { rf: 0.041, erp: 0.06, terminalGrowth: 0.025 });
});

test('US ticker (no suffix) gets US defaults', () => {
  assert.deepStrictEqual(marketParamsFor('AAPL'), { rf: 0.045, erp: 0.055, terminalGrowth: 0.025 });
});

test('Korean ticker gets static rf/erp/terminalGrowth, no live override possible', () => {
  assert.deepStrictEqual(marketParamsFor('005930.KS'), { rf: 0.043, erp: 0.075, terminalGrowth: 0.0175 });
});

test('Korean ticker ignores any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('005930.KS', { krRf: 0.09 }), { rf: 0.043, erp: 0.075, terminalGrowth: 0.0175 });
});

test('Japanese ticker gets static rf/erp/terminalGrowth, no live override possible', () => {
  assert.deepStrictEqual(marketParamsFor('7203.T'), { rf: 0.028, erp: 0.06, terminalGrowth: 0.015 });
});

test('Japanese ticker ignores any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('7203.T', { jpRf: 0.05 }), { rf: 0.028, erp: 0.06, terminalGrowth: 0.015 });
});

test('.TO (Toronto) does not match the .T Japan branch', () => {
  assert.deepStrictEqual(marketParamsFor('SHOP.TO'), { rf: 0.045, erp: 0.055, terminalGrowth: 0.025 });
});
