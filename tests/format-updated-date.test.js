const test = require('node:test');
const assert = require('node:assert');
const { formatUpdatedDate } = require('../www/utils.js');

test('formatUpdatedDate: current-year date omits the year', () => {
  assert.strictEqual(formatUpdatedDate('2026-07-17', new Date('2026-07-18')), 'Updated 17 Jul');
});

test('formatUpdatedDate: no leading zero on the day', () => {
  assert.strictEqual(formatUpdatedDate('2026-06-04', new Date('2026-07-18')), 'Updated 4 Jun');
});

test('formatUpdatedDate: appends year when it differs from now', () => {
  assert.strictEqual(formatUpdatedDate('2025-12-31', new Date('2026-01-02')), 'Updated 31 Dec 2025');
});

test('formatUpdatedDate: null/invalid input returns null', () => {
  assert.strictEqual(formatUpdatedDate(null), null);
  assert.strictEqual(formatUpdatedDate(undefined), null);
  assert.strictEqual(formatUpdatedDate(''), null);
  assert.strictEqual(formatUpdatedDate('17 Jul 2026'), null);
  assert.strictEqual(formatUpdatedDate('2026-13-01'), null);
  assert.strictEqual(formatUpdatedDate('2026-00-10'), null);
});
