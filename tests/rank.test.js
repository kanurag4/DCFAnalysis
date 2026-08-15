const { test } = require('node:test');
const assert = require('node:assert');
const { rankRows, rankFunnel } = require('../scripts/lib/rank.js');

const rows = [
  { ticker: 'A.AX', method: 'DCF', fcfMethod: 'reported', intrinsic: 20, snapshotPrice: 10, marginOfSafety: 1.0 },
  { ticker: 'B.AX', method: 'DCF', fcfMethod: 'derived',  intrinsic: 12, snapshotPrice: 10, marginOfSafety: 0.2 },
  { ticker: 'C.AX', method: 'DCF', fcfMethod: 'proxy',    intrinsic: 30, snapshotPrice: 10, marginOfSafety: 2.0 }, // dropped: proxy
  { ticker: 'D.AX', method: 'DCF', fcfMethod: 'reported', intrinsic: 9,  snapshotPrice: 10, marginOfSafety: -0.1 }, // dropped: overvalued
  { ticker: 'E.AX', method: 'DCF', fcfMethod: 'reported', intrinsic: 40, snapshotPrice: 10, marginOfSafety: 3.0 }, // dropped: > cap
  { ticker: 'F.AX', method: 'DDM', intrinsic: 15, snapshotPrice: 10, marginOfSafety: 0.5 }, // kept (DDM, no fcfMethod)
  { ticker: 'G.AX', excluded: true, reason: 'no-wacc' }, // dropped: excluded
  { ticker: 'H.AX', method: 'DCF', fcfMethod: 'proxy',    intrinsic: 13, snapshotPrice: 10, marginOfSafety: 0.3 }, // dropped: proxy (in-cap)
  // Regression fixture (bug found by peer review, fixed 2026-08-15): the FCF-quality
  // filter only exempted 'DDM' from the proxy-FCF check, so every Excess Return row
  // (which also has no fcfMethod, same as DDM) was silently misclassified as
  // proxyDropped and excluded from every ranking screen -- the opposite of what this
  // model exists for.
  { ticker: 'I.AX', method: 'ExcessReturn', intrinsic: 18, snapshotPrice: 10, marginOfSafety: 0.8 }, // kept (ExcessReturn, no fcfMethod)
];

test('filters, sorts by margin desc, caps, and takes top N', () => {
  const out = rankRows(rows, { topN: 10, maxMargin: 1.5 });
  assert.deepStrictEqual(out.map(r => r.ticker), ['A.AX', 'I.AX', 'F.AX', 'B.AX']);
  assert.deepStrictEqual(out.map(r => r.rank), [1, 2, 3, 4]);
});

test('respects topN', () => {
  const out = rankRows(rows, { topN: 2, maxMargin: 1.5 });
  assert.deepStrictEqual(out.map(r => r.ticker), ['A.AX', 'I.AX']);
});

test('ExcessReturn rows are exempt from the proxy-FCF filter, same as DDM', () => {
  const out = rankRows(rows, { topN: 10, maxMargin: 1.5 });
  assert.ok(out.some(r => r.ticker === 'I.AX'), 'ExcessReturn row must not be dropped as proxyDropped');
});

test('funnel buckets are mutually exclusive and sum to total', () => {
  const f = rankFunnel(rows, { maxMargin: 1.5 });
  assert.deepStrictEqual(f, {
    evaluated: 9,
    unvaluable: 1,   // G.AX excluded
    overvalued: 1,   // D.AX MoS -0.1
    capped: 2,       // C.AX (2.0) + E.AX (3.0) > 1.5 — cap checked before proxy
    proxyDropped: 1, // H.AX proxy, in-cap
    kept: 4,         // A.AX, B.AX, F.AX, I.AX
  });
  assert.strictEqual(
    f.unvaluable + f.overvalued + f.capped + f.proxyDropped + f.kept, f.evaluated);
});
