const assert = require('assert');
const { test } = require('node:test');
const { latestAnnual } = require('../scripts/lib/ticker-page.js');

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
