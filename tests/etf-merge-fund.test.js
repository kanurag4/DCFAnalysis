const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mergeFundIntoRankings } = require('../scripts/lib/etf/merge-fund.js');

const existing = {
  asAt: '2026-09-03',
  union: { count: 830, fetched: 830, failed: 0 },
  cryptoExcluded: [],
  ranked: [
    { slug: 'cldd', name: 'CLDD Fund', theme: 'Cloud', fee: 0.0067, lookThroughMos: -0.20, coverage: 0.98, ranked: true, holdingsCount: 38, valuedCount: 36, rank: 1, flags: [] },
    { slug: 'ita', name: 'ITA Fund', theme: 'Defense', fee: 0.004, lookThroughMos: -0.49, coverage: 0.99, ranked: true, holdingsCount: 48, valuedCount: 46, rank: 2, flags: [] },
    { slug: 'soxx', name: 'SOXX Fund', theme: 'Semis', fee: 0.0035, lookThroughMos: -0.72, coverage: 0.98, ranked: true, holdingsCount: 30, valuedCount: 29, rank: 3, flags: [] },
  ],
  unranked: [
    { slug: 'thin', name: 'Thin Fund', theme: 'Niche', fee: 0.005, lookThroughMos: -0.10, coverage: 0.55, ranked: false, holdingsCount: 20, valuedCount: 8, rank: null, flags: [] },
  ],
};

const etfsStatic = [
  { slug: 'cldd', listings: [{ ticker: 'CLDD' }] },
  { slug: 'ita', listings: [{ ticker: 'ITA' }] },
  { slug: 'soxx', listings: [{ ticker: 'SOXX' }] },
  { slug: 'thin', listings: [{ ticker: 'THIN' }] },
  { slug: 'shld', listings: [{ ticker: 'SHLD' }] },
];

const listingPrices = {
  CLDD: { price: 15.27, currency: 'AUD' }, ITA: { price: 223.37, currency: 'USD' },
  SOXX: { price: 501.44, currency: 'USD' }, SHLD: { price: 63.11, currency: 'USD' },
};

test('inserts a new ranked fund at the correct sorted position and re-ranks the rest', () => {
  const shld = {
    slug: 'shld', name: 'SHLD Fund', theme: 'Defense tech', fee: 0.005,
    lookThroughMos: -0.294, coverage: 0.88, ranked: true, holdingsCount: 50,
    valued: new Array(43).fill({}), unvalued: new Array(7).fill({}), flags: [],
  };
  const { rankingsSlim, fullRanked } = mergeFundIntoRankings(existing, shld, etfsStatic, listingPrices);

  assert.deepEqual(rankingsSlim.ranked.map(f => f.slug), ['cldd', 'shld', 'ita', 'soxx']);
  assert.deepEqual(rankingsSlim.ranked.map(f => f.rank), [1, 2, 3, 4]);
  assert.equal(rankingsSlim.ranked.find(f => f.slug === 'shld').valuedCount, 43);
  // untouched funds keep their pre-existing valuedCount, not zeroed out by a
  // missing `.valued` array (the exact bug hand-caught while building this).
  assert.equal(rankingsSlim.ranked.find(f => f.slug === 'ita').valuedCount, 46);
  assert.equal(rankingsSlim.ranked.find(f => f.slug === 'soxx').valuedCount, 29);
  assert.equal(rankingsSlim.unranked.length, 1);
  assert.equal(rankingsSlim.unranked[0].slug, 'thin');

  const shldFull = fullRanked.find(f => f.slug === 'shld');
  assert.deepEqual(shldFull.snapshotPrices, { SHLD: { price: 63.11, currency: 'USD' } });
  const itaFull = fullRanked.find(f => f.slug === 'ita');
  assert.deepEqual(itaFull.snapshotPrices, { ITA: { price: 223.37, currency: 'USD' } });
  assert.deepEqual(itaFull.listings, [{ ticker: 'ITA' }]);
});

test('a below-gate fund goes to unranked, not ranked, and does not perturb existing ranks', () => {
  const shld = {
    slug: 'shld', name: 'SHLD Fund', theme: 'Defense tech', fee: 0.005,
    lookThroughMos: -0.294, coverage: 0.4, ranked: false, holdingsCount: 50,
    valued: new Array(20).fill({}), unvalued: new Array(30).fill({}), flags: [],
  };
  const { rankingsSlim } = mergeFundIntoRankings(existing, shld, etfsStatic, listingPrices);
  assert.deepEqual(rankingsSlim.ranked.map(f => f.slug), ['cldd', 'ita', 'soxx']);
  assert.deepEqual(rankingsSlim.ranked.map(f => f.rank), [1, 2, 3]);
  assert.deepEqual(rankingsSlim.unranked.map(f => f.slug).sort(), ['shld', 'thin']);
});

test('re-running --only for an already-published fund replaces it in place, no duplicate', () => {
  const itaUpdated = {
    slug: 'ita', name: 'ITA Fund', theme: 'Defense', fee: 0.004,
    lookThroughMos: -0.05, coverage: 0.97, ranked: true, holdingsCount: 48,
    valued: new Array(47).fill({}), unvalued: new Array(1).fill({}), flags: [],
  };
  const { rankingsSlim } = mergeFundIntoRankings(existing, itaUpdated, etfsStatic, listingPrices);
  const itas = rankingsSlim.ranked.filter(f => f.slug === 'ita');
  assert.equal(itas.length, 1, 'ita must appear exactly once, not duplicated');
  assert.equal(itas[0].lookThroughMos, -0.05);
  assert.equal(itas[0].valuedCount, 47);
  // -0.05 is now the least negative (best) figure -> ita moves to rank 1
  assert.deepEqual(rankingsSlim.ranked.map(f => f.slug), ['ita', 'cldd', 'soxx']);
});

test('{slug, remove: true} drops a fund from both ranked and unranked', () => {
  const { rankingsSlim } = mergeFundIntoRankings(existing, { slug: 'ita', remove: true }, etfsStatic, listingPrices);
  assert.deepEqual(rankingsSlim.ranked.map(f => f.slug), ['cldd', 'soxx']);
  assert.equal(rankingsSlim.unranked.length, 1);

  const { rankingsSlim: r2 } = mergeFundIntoRankings(existing, { slug: 'thin', remove: true }, etfsStatic, listingPrices);
  assert.equal(r2.unranked.length, 0);
  assert.deepEqual(r2.ranked.map(f => f.slug), ['cldd', 'ita', 'soxx']);
});

test('an explicit asAt overrides the stale committed-file date', () => {
  const shld = {
    slug: 'shld', name: 'SHLD Fund', theme: 'Defense tech', fee: 0.005,
    lookThroughMos: -0.294, coverage: 0.88, ranked: true, holdingsCount: 50,
    valued: [], unvalued: [], flags: [],
  };
  const { rankingsSlim } = mergeFundIntoRankings(existing, shld, etfsStatic, listingPrices, '2026-10-01');
  assert.equal(rankingsSlim.asAt, '2026-10-01');
  const { rankingsSlim: fallback } = mergeFundIntoRankings(existing, shld, etfsStatic, listingPrices);
  assert.equal(fallback.asAt, '2026-09-03');
});

test('missing listing prices leave an empty snapshotPrices object, not a crash', () => {
  const shld = {
    slug: 'shld', name: 'SHLD Fund', theme: 'Defense tech', fee: 0.005,
    lookThroughMos: -0.294, coverage: 0.88, ranked: true, holdingsCount: 50,
    valued: [], unvalued: [], flags: [],
  };
  const { fullRanked } = mergeFundIntoRankings(existing, shld, etfsStatic, {});
  assert.deepEqual(fullRanked.find(f => f.slug === 'shld').snapshotPrices, {});
});
