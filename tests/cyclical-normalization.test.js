const { test } = require('node:test');
const assert = require('node:assert');
const { resolveCyclicalMargin } = require('../www/calc/cyclicalNormalization.js');

test('resolveCyclicalMargin uses the own margin when it is non-negative, ignoring any sector data', () => {
  const r = resolveCyclicalMargin({
    ownMargin: 0.145,
    sectorLookup: { Gold: { avgMargin: 0.02, peerCount: 10 } },
    industry: 'Gold',
  });
  assert.deepStrictEqual(r, { marginUsed: 0.145, source: 'own', peerCount: null });
});

test('resolveCyclicalMargin substitutes the sector average when own margin is negative and enough peers exist', () => {
  const r = resolveCyclicalMargin({
    ownMargin: -0.078,
    sectorLookup: { 'Oil & Gas Refining & Marketing': { avgMargin: 0.031, peerCount: 7 } },
    industry: 'Oil & Gas Refining & Marketing',
  });
  assert.deepStrictEqual(r, { marginUsed: 0.031, source: 'sector', peerCount: 7 });
});

test('resolveCyclicalMargin returns null when own margin is negative and the sector has fewer than minPeers', () => {
  const r = resolveCyclicalMargin({
    ownMargin: -0.078,
    sectorLookup: { Uranium: { avgMargin: 0.05, peerCount: 2 } },
    industry: 'Uranium',
  });
  assert.deepStrictEqual(r, { marginUsed: null, source: null, peerCount: null });
});

test('resolveCyclicalMargin returns null when own margin is null regardless of sector data', () => {
  const r = resolveCyclicalMargin({
    ownMargin: null,
    sectorLookup: { Gold: { avgMargin: 0.14, peerCount: 20 } },
    industry: 'Gold',
  });
  assert.deepStrictEqual(r, { marginUsed: null, source: null, peerCount: null });
});
