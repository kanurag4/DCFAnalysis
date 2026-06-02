const { test } = require('node:test');
const assert = require('node:assert');
const { mergeFirstSeen } = require('../scripts/lib/firstSeen.js');

test('adds new tickers with date+price, never overwrites existing', () => {
  const ledger = { 'A.AX': { firstSeen: '2026-04-01', firstPrice: 8 } };
  const rows = [
    { ticker: 'A.AX', snapshotPrice: 10 }, // already known — must keep 2026-04-01 / 8
    { ticker: 'B.AX', snapshotPrice: 5 },  // new
  ];
  const out = mergeFirstSeen(ledger, rows, '2026-06-02');
  assert.deepStrictEqual(out['A.AX'], { firstSeen: '2026-04-01', firstPrice: 8 });
  assert.deepStrictEqual(out['B.AX'], { firstSeen: '2026-06-02', firstPrice: 5 });
});

test('does not mutate the input ledger', () => {
  const ledger = { 'A.AX': { firstSeen: '2026-04-01', firstPrice: 8 } };
  mergeFirstSeen(ledger, [{ ticker: 'B.AX', snapshotPrice: 5 }], '2026-06-02');
  assert.strictEqual(ledger['B.AX'], undefined);
});
