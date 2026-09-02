const assert = require('assert');
const { test } = require('node:test');
const { latestAnnual, pickCadence, deriveScenarios, shouldApplyRevenueFallback, marketMeta } = require('../scripts/lib/ticker-page.js');

// Regression test for a real bug (found live 2026-09-02): RO.SW (Switzerland)
// fell through marketMeta()'s generic catch-all (indexTicker: null), so its
// published page silently had no comparison line on the price chart at all --
// the 6 "ETF radar additions" suffixes (added to market.js's WACC/growth
// seeds 2026-08-31) were never mirrored into this file's own market metadata.
test('marketMeta gives every ETF-radar-added suffix (SW/TW/TA/ST/OL/SI/KQ) a real indexTicker, not the generic null fallback', () => {
  const cases = [
    ['ROG.SW', '^STOXX'], ['2330.TW', '^TWII'], ['ESLT.TA', 'TA35.TA'],
    ['SAAB-B.ST', '^OMX'], ['KOG.OL', 'OSEBX.OL'], ['S63.SI', '^STI'], ['012450.KQ', '^KS11'],
  ];
  for (const [ticker, expectedIndex] of cases) {
    const m = marketMeta(ticker);
    assert.equal(m.indexTicker, expectedIndex, `${ticker} should get indexTicker ${expectedIndex}, got ${m.indexTicker}`);
    assert.notEqual(m.currencySymbol, '$', `${ticker} should not inherit the generic '$' fallback currency symbol`);
  }
});

test('marketMeta KOSDAQ (.KQ) matches KOSPI (.KS) metadata exactly, per market.js\'s "same market" convention', () => {
  assert.deepEqual(marketMeta('012450.KQ'), marketMeta('012450.KS'));
});

test('marketMeta genuinely uncovered suffixes still fall to the generic catch-all (indexTicker: null)', () => {
  const m = marketMeta('XYZ.ZZ');
  assert.equal(m.indexTicker, null);
  assert.equal(m.currencySymbol, '$');
});

// Regression test for a real bug (found by peer review, fixed 2026-08-15):
// this file's ExcessReturn branch clamped the ROE spread to growthOffsetSpread's
// [-15, 30] bounds instead of roeOffsetSpread's [0, 60] bounds that
// www/calc/assumptions.js specifically introduced because 30% is far too low a
// ceiling for a high-ROE financial -- a real NBFC checked while building this
// sits at ~31.7% ROE, which the growth-rate ceiling clamps *below* base,
// inverting bull < base. A comment in this file claimed the two already matched;
// they didn't.
test('deriveScenarios (ExcessReturn) keeps bull >= base even when base ROE exceeds 30%', () => {
  const s = deriveScenarios({ method: 'ExcessReturn', baseGrowthPct: 31.7, waccOrRePct: 13.15 });
  assert.ok(s.growth.bull >= s.growth.base, `bull ROE (${s.growth.bull}) must be >= base ROE (${s.growth.base})`);
  assert.ok(s.growth.bear <= s.growth.base, `bear ROE (${s.growth.bear}) must be <= base ROE (${s.growth.base})`);
  assert.strictEqual(s.growth.bull, 47.5); // 31.7 + |31.7|*0.5 = 47.55, rounded to 1dp
});

test('deriveScenarios (ExcessReturn) never lets bear ROE go negative', () => {
  const s = deriveScenarios({ method: 'ExcessReturn', baseGrowthPct: 1, waccOrRePct: 10 });
  assert.ok(s.growth.bear >= 0, `bear ROE must never go negative, got ${s.growth.bear}`);
});

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

// ── shouldApplyRevenueFallback (sector-average cyclical margin fix, 2026-08-25) ──
// Regression test for a real bug (found 2026-08-24 on 096770.KS/SK Innovation):
// the revenue-normalised fallback (a stand-in for "Yahoo has no FCF data at
// all") was firing even when the cyclical-normalization path had already
// deliberately computed a real, disclosed value that just happened to be
// negative -- silently discarding it while the page's own methodology text
// still claimed the negative multi-year/sector margin was used.

test('shouldApplyRevenueFallback fires when baseFcf is null (genuine data gap)', () => {
  assert.strictEqual(shouldApplyRevenueFallback({ baseFcf: null, fcfMethod: 'reported', totalRevenue: 1e9 }), true);
});

test('shouldApplyRevenueFallback fires when baseFcf is negative and NOT from cyclical normalization', () => {
  assert.strictEqual(shouldApplyRevenueFallback({ baseFcf: -1e8, fcfMethod: 'reported', totalRevenue: 1e9 }), true);
});

test('shouldApplyRevenueFallback does NOT fire when baseFcf is negative but IS from cyclical normalization (the bug fix)', () => {
  assert.strictEqual(shouldApplyRevenueFallback({ baseFcf: -1e8, fcfMethod: 'normalized', totalRevenue: 1e9 }), false);
});

test('shouldApplyRevenueFallback does not fire when baseFcf is positive', () => {
  assert.strictEqual(shouldApplyRevenueFallback({ baseFcf: 1e8, fcfMethod: 'reported', totalRevenue: 1e9 }), false);
});

test('shouldApplyRevenueFallback does not fire when totalRevenue is missing, even with null baseFcf', () => {
  assert.strictEqual(shouldApplyRevenueFallback({ baseFcf: null, fcfMethod: 'reported', totalRevenue: 0 }), false);
});
