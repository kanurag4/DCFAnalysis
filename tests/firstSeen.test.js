const { test } = require('node:test');
const assert = require('node:assert');
const { mergeFirstSeen } = require('../scripts/lib/firstSeen.js');

test('adds new tickers with date+price, keeps continuing tickers unchanged', () => {
  const ledger = { 'A.AX': { firstSeen: '2026-04-01', firstPrice: 8 } };
  const rows = [
    { ticker: 'A.AX', snapshotPrice: 10 }, // continuing — must keep 2026-04-01 / 8
    { ticker: 'B.AX', snapshotPrice: 5 },  // new
  ];
  const out = mergeFirstSeen(ledger, rows, '2026-06-02', new Set(['A.AX']));
  assert.deepStrictEqual(out['A.AX'], { firstSeen: '2026-04-01', firstPrice: 8 });
  assert.deepStrictEqual(out['B.AX'], { firstSeen: '2026-06-02', firstPrice: 5 });
});

test('does not mutate the input ledger', () => {
  const ledger = { 'A.AX': { firstSeen: '2026-04-01', firstPrice: 8 } };
  mergeFirstSeen(ledger, [{ ticker: 'B.AX', snapshotPrice: 5 }], '2026-06-02', new Set(['A.AX']));
  assert.strictEqual(ledger['B.AX'], undefined);
});

test('resets firstSeen/firstPrice for a ticker that dropped off and came back', () => {
  // A.AX was first seen 2026-04-01, but was NOT on the immediately-prior
  // published cycle (it was sold in between) — re-entering today should
  // reset to today's date/price, not keep the stale pre-sale entry.
  const ledger = { 'A.AX': { firstSeen: '2026-04-01', firstPrice: 8 } };
  const rows = [{ ticker: 'A.AX', snapshotPrice: 12 }];
  const out = mergeFirstSeen(ledger, rows, '2026-07-10', new Set()); // A.AX absent from oldTickers
  assert.deepStrictEqual(out['A.AX'], { firstSeen: '2026-07-10', firstPrice: 12 });
});

test('default oldTickers (omitted) treats every known ticker as reentry', () => {
  const ledger = { 'A.AX': { firstSeen: '2026-04-01', firstPrice: 8 } };
  const out = mergeFirstSeen(ledger, [{ ticker: 'A.AX', snapshotPrice: 12 }], '2026-07-10');
  assert.deepStrictEqual(out['A.AX'], { firstSeen: '2026-07-10', firstPrice: 12 });
});
