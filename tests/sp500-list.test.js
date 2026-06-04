const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeUsTickers } = require('../scripts/lib/sp500-list.js');

test('converts class-share dots to dashes', () => {
  assert.deepStrictEqual(normalizeUsTickers('BRK.B, BF.B'), ['BRK-B', 'BF-B']);
});

test('uppercases, trims, and splits on commas/whitespace/newlines', () => {
  assert.deepStrictEqual(normalizeUsTickers(' aapl,  msft\n nvda '), ['AAPL', 'MSFT', 'NVDA']);
});

test('de-duplicates while preserving first-seen order', () => {
  assert.deepStrictEqual(normalizeUsTickers('AAPL, aapl, MSFT, AAPL'), ['AAPL', 'MSFT']);
});

test('keeps legitimate dual classes as distinct tickers', () => {
  assert.deepStrictEqual(normalizeUsTickers('GOOGL,GOOG,FOX,FOXA'), ['GOOGL', 'GOOG', 'FOX', 'FOXA']);
});

test('drops empty tokens', () => {
  assert.deepStrictEqual(normalizeUsTickers('AAPL,,  ,MSFT,'), ['AAPL', 'MSFT']);
});
