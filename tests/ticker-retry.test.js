const { test } = require('node:test');
const assert = require('node:assert/strict');
const { withNullBaseCaseRetry } = require('../scripts/lib/ticker-retry.js');

const ok = (intrinsic) => ({ status: 'ok', entry: { intrinsic } });
const skipped = (reason) => ({ status: 'skipped', reason });
const noSleep = () => Promise.resolve();

test('returns the first outcome unretried when intrinsic is non-null', async () => {
  let calls = 0;
  const attemptFn = () => { calls++; return Promise.resolve(ok(18.6)); };
  const result = await withNullBaseCaseRetry(attemptFn, { sleepImpl: noSleep });
  assert.deepEqual(result, ok(18.6));
  assert.equal(calls, 1);
});

test('returns a skipped outcome unretried -- not the transient condition this exists for', async () => {
  let calls = 0;
  const attemptFn = () => { calls++; return Promise.resolve(skipped('WACC uncomputable')); };
  const result = await withNullBaseCaseRetry(attemptFn, { sleepImpl: noSleep });
  assert.deepEqual(result, skipped('WACC uncomputable'));
  assert.equal(calls, 1);
});

test('retries once and returns the recovered result', async () => {
  let calls = 0;
  const attemptFn = () => {
    calls++;
    return Promise.resolve(calls === 1 ? ok(null) : ok(42.1));
  };
  const result = await withNullBaseCaseRetry(attemptFn, { sleepImpl: noSleep });
  assert.deepEqual(result, ok(42.1));
  assert.equal(calls, 2);
});

test('stops after 2 retries (3 attempts total) and returns the last null result', async () => {
  let calls = 0;
  const attemptFn = () => { calls++; return Promise.resolve(ok(null)); };
  const result = await withNullBaseCaseRetry(attemptFn, { sleepImpl: noSleep });
  assert.deepEqual(result, ok(null));
  assert.equal(calls, 3); // 1 initial attempt + 2 retries, then give up
});

test('maxRetries is configurable', async () => {
  let calls = 0;
  const attemptFn = () => { calls++; return Promise.resolve(ok(null)); };
  await withNullBaseCaseRetry(attemptFn, { sleepImpl: noSleep, maxRetries: 1 });
  assert.equal(calls, 2); // 1 initial attempt + 1 retry
});

test('calls onRetry once per retry with a 1-based attempt number', async () => {
  let calls = 0;
  const attemptFn = () => { calls++; return Promise.resolve(ok(null)); };
  const seen = [];
  await withNullBaseCaseRetry(attemptFn, { sleepImpl: noSleep, onRetry: (attempt) => seen.push(attempt) });
  assert.deepEqual(seen, [1, 2]);
});

test('waits backoffMs before each retry via the injected sleep', async () => {
  const waits = [];
  const sleepImpl = (ms) => { waits.push(ms); return Promise.resolve(); };
  let calls = 0;
  const attemptFn = () => { calls++; return Promise.resolve(calls < 2 ? ok(null) : ok(9)); };
  await withNullBaseCaseRetry(attemptFn, { sleepImpl, backoffMs: 5000 });
  assert.deepEqual(waits, [5000]);
});
