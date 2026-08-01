const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { blacklistPath, readBlacklist, addToBlacklist } = require('../scripts/lib/blacklist.js');

function makeFixtureDir(initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blacklist-test-'));
  fs.writeFileSync(path.join(dir, 'blacklist-testmkt.json'), JSON.stringify(initial));
  return dir;
}

test('readBlacklist reads the entries as-is', () => {
  const dir = makeFixtureDir([{ ticker: 'AAA', reason: 'seed', addedAt: '2026-01-01' }]);
  assert.deepStrictEqual(readBlacklist('testmkt', dir), [{ ticker: 'AAA', reason: 'seed', addedAt: '2026-01-01' }]);
});

test('addToBlacklist appends a new ticker with reason/addedAt', () => {
  const dir = makeFixtureDir([]);
  const { entries, added } = addToBlacklist('testmkt', ['BBB'], { reason: 'test reason', addedAt: '2026-08-01', dir });
  assert.deepStrictEqual(added, ['BBB']);
  assert.deepStrictEqual(entries, [{ ticker: 'BBB', reason: 'test reason', addedAt: '2026-08-01' }]);
  // persisted to disk, not just returned
  assert.deepStrictEqual(readBlacklist('testmkt', dir), entries);
});

test('addToBlacklist is idempotent -- an already-present ticker is not duplicated', () => {
  const dir = makeFixtureDir([{ ticker: 'CCC', reason: 'existing', addedAt: '2026-01-01' }]);
  const { entries, added } = addToBlacklist('testmkt', ['CCC'], { dir });
  assert.deepStrictEqual(added, []);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].reason, 'existing'); // original entry untouched, not overwritten
});

test('addToBlacklist handles a mix of new and already-present tickers in one call', () => {
  const dir = makeFixtureDir([{ ticker: 'DDD', reason: 'existing', addedAt: '2026-01-01' }]);
  const { added } = addToBlacklist('testmkt', ['DDD', 'EEE', ' FFF '], { reason: 'batch add', addedAt: '2026-08-01', dir });
  assert.deepStrictEqual(added, ['EEE', 'FFF']); // DDD skipped, FFF trimmed
  const onDisk = readBlacklist('testmkt', dir);
  assert.strictEqual(onDisk.length, 3);
});

test('addToBlacklist ignores blank/whitespace-only entries', () => {
  const dir = makeFixtureDir([]);
  const { added } = addToBlacklist('testmkt', ['', '   ', 'GGG'], { dir });
  assert.deepStrictEqual(added, ['GGG']);
});

test('addToBlacklist does not touch the file on disk when nothing new was added', () => {
  const dir = makeFixtureDir([{ ticker: 'HHH', reason: 'existing', addedAt: '2026-01-01' }]);
  const before = fs.statSync(blacklistPath('testmkt', dir)).mtimeMs;
  addToBlacklist('testmkt', ['HHH'], { dir });
  const after = fs.statSync(blacklistPath('testmkt', dir)).mtimeMs;
  assert.strictEqual(before, after);
});
