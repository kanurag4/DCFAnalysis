// tests/europe-list.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEuropeTickers } = require('../scripts/lib/europe-list.js');

test('uppercases, trims, and splits on commas/whitespace/newlines', () => {
  assert.deepEqual(normalizeEuropeTickers(' sap.de,  mc.pa\n asml.as '), ['SAP.DE', 'MC.PA', 'ASML.AS']);
});

test('de-duplicates while preserving first-seen order', () => {
  assert.deepEqual(normalizeEuropeTickers('SAP.DE, sap.de, MC.PA, SAP.DE'), ['SAP.DE', 'MC.PA']);
});

test('drops empty tokens', () => {
  assert.deepEqual(normalizeEuropeTickers('SAP.DE,,  ,MC.PA,'), ['SAP.DE', 'MC.PA']);
});

test('accepts every in-scope eurozone/UK suffix', () => {
  const raw = 'SAP.DE,MC.PA,ASML.AS,ENI.MI,SAN.MC,ABI.BR,EDP.LS,OMV.VI,NOKIA.HE,RYA.IR,HSBA.L';
  assert.equal(normalizeEuropeTickers(raw).length, 11);
});

test('rejects (drops, with a console warning) a ticker with a non-eurozone/UK suffix', () => {
  const out = normalizeEuropeTickers('SAP.DE,NESN.SW,MC.PA'); // NESN.SW = Swiss, out of scope
  assert.deepEqual(out, ['SAP.DE', 'MC.PA']);
});

test('rejects a bare US-style ticker with no suffix', () => {
  const out = normalizeEuropeTickers('SAP.DE,AAPL,MC.PA');
  assert.deepEqual(out, ['SAP.DE', 'MC.PA']);
});
