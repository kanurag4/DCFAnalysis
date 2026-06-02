const { test } = require('node:test');
const assert = require('node:assert');
const { rankRows } = require('../scripts/lib/rank.js');

const rows = [
  { ticker: 'A.AX', method: 'DCF', fcfMethod: 'reported', intrinsic: 20, snapshotPrice: 10, marginOfSafety: 1.0 },
  { ticker: 'B.AX', method: 'DCF', fcfMethod: 'derived',  intrinsic: 12, snapshotPrice: 10, marginOfSafety: 0.2 },
  { ticker: 'C.AX', method: 'DCF', fcfMethod: 'proxy',    intrinsic: 30, snapshotPrice: 10, marginOfSafety: 2.0 }, // dropped: proxy
  { ticker: 'D.AX', method: 'DCF', fcfMethod: 'reported', intrinsic: 9,  snapshotPrice: 10, marginOfSafety: -0.1 }, // dropped: overvalued
  { ticker: 'E.AX', method: 'DCF', fcfMethod: 'reported', intrinsic: 40, snapshotPrice: 10, marginOfSafety: 3.0 }, // dropped: > cap
  { ticker: 'F.AX', method: 'DDM', intrinsic: 15, snapshotPrice: 10, marginOfSafety: 0.5 }, // kept (DDM, no fcfMethod)
  { ticker: 'G.AX', excluded: true, reason: 'no-wacc' }, // dropped: excluded
];

test('filters, sorts by margin desc, caps, and takes top N', () => {
  const out = rankRows(rows, { topN: 10, maxMargin: 1.5 });
  assert.deepStrictEqual(out.map(r => r.ticker), ['A.AX', 'F.AX', 'B.AX']);
  assert.deepStrictEqual(out.map(r => r.rank), [1, 2, 3]);
});

test('respects topN', () => {
  const out = rankRows(rows, { topN: 2, maxMargin: 1.5 });
  assert.deepStrictEqual(out.map(r => r.ticker), ['A.AX', 'F.AX']);
});
