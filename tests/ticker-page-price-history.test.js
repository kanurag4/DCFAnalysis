const { test } = require('node:test');
const assert = require('node:assert');
const { bucketMonthly } = require('../scripts/lib/ticker-page.js');

// Mid-month dates on purpose: bucketMonthly reads the month in local time, so a 1st-of-month date could
// land in the previous month on a machine west of UTC.
test('bucketMonthly keeps the last daily point of each month, in ascending order, with the chart-series fields', () => {
  const daily = [
    { date: '2026-03-10', close: 10, adjClose: 9 },
    { date: '2026-03-20', close: 12, adjClose: 11 },
    { date: '2026-04-15', close: 14 },
  ];
  const out = bucketMonthly(daily);
  assert.strictEqual(out.length, 2);
  assert.deepStrictEqual(out.map((p) => [p.date, p.v, p.y]), [['2026-03-20', 12, '2026-03-20'], ['2026-04-15', 14, '2026-04-15']]);
  assert.ok(out.every((p) => typeof p.k === 'string' && p.k.length > 0));   // month key kept for alignByBucket
});

test('bucketMonthly plots the plain close, never the dividend-adjusted one (the chart shows real prices)', () => {
  assert.strictEqual(bucketMonthly([{ date: '2026-03-20', close: 12, adjClose: 5 }])[0].v, 12);
});

test('bucketMonthly returns [] for an empty or non-array history', () => {
  assert.deepStrictEqual(bucketMonthly([]), []);
  assert.deepStrictEqual(bucketMonthly(null), []);
  assert.deepStrictEqual(bucketMonthly({ error: 'nope' }), []);
});
