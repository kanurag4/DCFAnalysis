const assert = require('assert');
const { test } = require('node:test');
const { latestAnnual, pickCadence } = require('../scripts/lib/ticker-page.js');

test('latestAnnual returns null for a missing or empty series', () => {
  assert.strictEqual(latestAnnual(undefined), null);
  assert.strictEqual(latestAnnual(null), null);
  assert.strictEqual(latestAnnual([]), null);
});

test('latestAnnual returns the last entry\'s value (series is ascending by date)', () => {
  const series = [
    { date: '2022-12-31', value: 100 },
    { date: '2023-12-31', value: 110 },
    { date: '2024-12-31', value: 120 },
  ];
  assert.strictEqual(latestAnnual(series), 120);
});

test('latestAnnual returns null when the last entry\'s value is non-finite', () => {
  const series = [{ date: '2023-12-31', value: 100 }, { date: '2024-12-31', value: null }];
  assert.strictEqual(latestAnnual(series), null);
});

// ── pickCadence ──────────────────────────────────────────────────────────────
// A single quarterly point is worse than useless: toPointSeries() downstream
// requires >= 2 points to draw a chart at all, so preferring a 1-point
// quarterly series over a solid multi-year annual one silently vanishes the
// whole chart card. Confirmed live on FPH.AX (NZ-domiciled, dual-listed ASX):
// quarterlyDilutedEPS had exactly 1 point, annualDilutedEPS had 4 -- the old
// "quarterly if any data at all" rule picked the unusable 1-point series and
// the EPS/FCF chart cards disappeared from the page entirely.

test('pickCadence prefers quarterly when it has enough points for a chart (>= 2)', () => {
  const series = {
    quarterlyDilutedEPS: [{ date: '2025-06-30', value: 1 }, { date: '2025-09-30', value: 1.1 }],
    annualDilutedEPS: [{ date: '2023-12-31', value: 4 }, { date: '2024-12-31', value: 4.2 }],
  };
  const r = pickCadence(series, 'DilutedEPS');
  assert.strictEqual(r.cadence, 'Quarterly');
  assert.strictEqual(r.points.length, 2);
});

test('pickCadence falls back to annual when quarterly has fewer than 2 points, even though quarterly is non-empty', () => {
  const series = {
    quarterlyDilutedEPS: [{ date: '2025-09-30', value: 1.1 }],
    annualDilutedEPS: [
      { date: '2022-12-31', value: 3.5 }, { date: '2023-12-31', value: 3.9 },
      { date: '2024-12-31', value: 4.1 }, { date: '2025-12-31', value: 4.4 },
    ],
  };
  const r = pickCadence(series, 'DilutedEPS');
  assert.strictEqual(r.cadence, 'Annual');
  assert.strictEqual(r.points.length, 4);
});

test('pickCadence returns an empty annual series when both quarterly and annual are missing', () => {
  const r = pickCadence({}, 'DilutedEPS');
  assert.strictEqual(r.cadence, 'Annual');
  assert.deepStrictEqual(r.points, []);
});
