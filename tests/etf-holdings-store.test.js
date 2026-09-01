const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
const { readSnapshot, writeSnapshot, evaluateFreshness } = require('../scripts/lib/etf/holdings-store.js');

test('write then read round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'etf-'));
  writeSnapshot(dir, 'hack', { asOf: '2026-08-28', source: 'x', fetchedAt: 'y', rows: [{ yahoo: 'A', weight: 1 }] });
  assert.equal(readSnapshot(dir, 'hack').asOf, '2026-08-28');
  assert.equal(readSnapshot(dir, 'missing'), null);
});

test('evaluateFreshness flags a failed fetch', () => {
  const r = evaluateFreshness({ asOf: '2026-07-01', rows: [{}, {}] }, null);
  assert.deepEqual(r, { ok: false, flags: ['fetch-failed'] });
});

test('flags unchanged asOf, row-count drop, weight-sum-off', () => {
  const prev = { asOf: '2026-08-01', rows: new Array(40).fill({ weight: 0.025 }) };
  const fresh = { asOf: '2026-08-01', rows: new Array(20).fill({ weight: 0.02 }) }; // sum 0.4
  const r = evaluateFreshness(prev, fresh);
  assert.equal(r.ok, false);
  assert.ok(r.flags.includes('asOf-unchanged'));
  assert.ok(r.flags.includes('row-count-drop'));
  assert.ok(r.flags.includes('weight-sum-off'));
});

test('a clean fresh snapshot is ok', () => {
  const prev = { asOf: '2026-07-01', rows: new Array(40).fill({ weight: 0.025 }) };
  const fresh = { asOf: '2026-08-01', rows: new Array(41).fill({ weight: 0.0244 }) };
  assert.equal(evaluateFreshness(prev, fresh).ok, true);
});
