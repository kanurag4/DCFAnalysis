const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { loadUniverse } = require('../scripts/lib/etf/load-universe.js');

const base = { issuer: 'betashares', issuerFundId: 'a', name: 'X', theme: 't', fee: 0.01, assetClass: 'equity', listings: [{ ticker: 'X.AX' }] };

test('loads the real etfs.json without throwing', () => {
  const u = loadUniverse(path.join(__dirname, '../scripts/etfs.json'));
  assert.ok(u.length >= 5);
  assert.ok(u.every(f => f.slug && f.issuer && f.issuerFundId && f.listings.length));
});

test('rejects a duplicate slug', () => {
  assert.throws(() => loadUniverse(null, [
    { ...base, slug: 'x', issuerFundId: 'a' },
    { ...base, slug: 'x', issuerFundId: 'b', name: 'Y', listings: [{ ticker: 'Y.AX' }] },
  ]), /duplicate slug/i);
});

test('rejects an unknown issuer', () => {
  assert.throws(() => loadUniverse(null, [
    { ...base, slug: 'x', issuer: 'nope' },
  ]), /unknown issuer/i);
});

test('rejects a missing required field', () => {
  assert.throws(() => loadUniverse(null, [
    { ...base, slug: 'x', assetClass: undefined },
  ]), /missing required field "assetClass"/i);
});
