// tests/europe-list.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeEuropeTickers } = require('../scripts/lib/europe-list.js');

// Returns { tickers, dropped, duplicates } — the drops are reported back rather
// than console.warn'd, so the module stays pure and build-europe.js can print a
// counted summary instead of a wall of warnings that's easy to scroll past.
const tickersOf = (raw) => normalizeEuropeTickers(raw).tickers;

test('uppercases, trims, and splits on commas/whitespace/newlines', () => {
  assert.deepEqual(tickersOf(' sap.de,  mc.pa\n asml.as '), ['SAP.DE', 'MC.PA', 'ASML.AS']);
});

test('de-duplicates while preserving first-seen order, and reports the duplicates', () => {
  const out = normalizeEuropeTickers('SAP.DE, sap.de, MC.PA, SAP.DE');
  assert.deepEqual(out.tickers, ['SAP.DE', 'MC.PA']);
  assert.deepEqual(out.duplicates, ['SAP.DE', 'SAP.DE']);
});

test('drops empty tokens', () => {
  assert.deepEqual(tickersOf('SAP.DE,,  ,MC.PA,'), ['SAP.DE', 'MC.PA']);
});

test('accepts every in-scope eurozone/UK suffix', () => {
  const raw = 'SAP.DE,MC.PA,ASML.AS,ENI.MI,SAN.MC,ABI.BR,EDP.LS,OMV.VI,NOKIA.HE,RYA.IR,HSBA.L';
  assert.equal(tickersOf(raw).length, 11);
});

test('rejects a ticker with a non-eurozone/UK suffix and reports it as dropped', () => {
  const out = normalizeEuropeTickers('SAP.DE,NESN.SW,MC.PA'); // NESN.SW = Swiss, out of scope
  assert.deepEqual(out.tickers, ['SAP.DE', 'MC.PA']);
  assert.deepEqual(out.dropped, ['NESN.SW']);
});

test('rejects a bare US-style ticker with no suffix', () => {
  const out = normalizeEuropeTickers('SAP.DE,AAPL,MC.PA');
  assert.deepEqual(out.tickers, ['SAP.DE', 'MC.PA']);
  assert.deepEqual(out.dropped, ['AAPL']);
});

test('a clean list reports nothing dropped or duplicated', () => {
  const out = normalizeEuropeTickers('SAP.DE, MC.PA');
  assert.deepEqual(out.dropped, []);
  assert.deepEqual(out.duplicates, []);
});

test('is pure — no console output', () => {
  const orig = { warn: console.warn, log: console.log, error: console.error };
  const calls = [];
  console.warn = console.log = console.error = (...a) => calls.push(a);
  try {
    normalizeEuropeTickers('SAP.DE,NESN.SW,AAPL,SAP.DE');
  } finally {
    Object.assign(console, orig);
  }
  assert.deepEqual(calls, [], 'normalizeEuropeTickers must not write to console');
});
