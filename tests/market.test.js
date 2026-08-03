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

test('UK (.L) ticker gets fixed Gilt-proxy rf/erp/terminalGrowth, no live override possible', () => {
  assert.deepStrictEqual(marketParamsFor('HSBA.L'), { rf: 0.050, erp: 0.06, terminalGrowth: 0.02 });
});

test('UK (.L) ticker ignores any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('HSBA.L', { ukRf: 0.09 }), { rf: 0.050, erp: 0.06, terminalGrowth: 0.02 });
});

test('German (.DE) ticker gets fixed Bund-proxy rf/erp/terminalGrowth', () => {
  assert.deepStrictEqual(marketParamsFor('SAP.DE'), { rf: 0.032, erp: 0.055, terminalGrowth: 0.018 });
});

test('French (.PA), Dutch (.AS), Italian (.MI), Spanish (.MC) tickers all get the same eurozone bucket', () => {
  const expected = { rf: 0.032, erp: 0.055, terminalGrowth: 0.018 };
  assert.deepStrictEqual(marketParamsFor('MC.PA'), expected);
  assert.deepStrictEqual(marketParamsFor('ASML.AS'), expected);
  assert.deepStrictEqual(marketParamsFor('ENI.MI'), expected);
  assert.deepStrictEqual(marketParamsFor('SAN.MC'), expected);
});

test('Belgian (.BR), Portuguese (.LS), Austrian (.VI), Finnish (.HE), Irish (.IR) tickers get the eurozone bucket', () => {
  const expected = { rf: 0.032, erp: 0.055, terminalGrowth: 0.018 };
  assert.deepStrictEqual(marketParamsFor('ABI.BR'), expected);
  assert.deepStrictEqual(marketParamsFor('EDP.LS'), expected);
  assert.deepStrictEqual(marketParamsFor('OMV.VI'), expected);
  assert.deepStrictEqual(marketParamsFor('NOKIA.HE'), expected);
  assert.deepStrictEqual(marketParamsFor('RYA.IR'), expected);
});

test('eurozone tickers ignore any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('SAP.DE', { euRf: 0.09 }), { rf: 0.032, erp: 0.055, terminalGrowth: 0.018 });
});
