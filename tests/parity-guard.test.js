const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkBatchKey, assertBatchKeyAccepted, createRefusalGuard, ParityRefused, PREFLIGHT_ORIGIN } = require('../scripts/lib/parity-guard.js');

const respond = status => async () => new Response('{}', { status });

test('checkBatchKey: the key check carries the key and an Origin the Worker does not allow', async () => {
  let seen;
  const r = await checkBatchKey(async (url, opts) => { seen = { url, opts }; return new Response('{}', { status: 200 }); }, 'https://w', 'k', 'staging');
  assert.deepEqual(r, { ok: true });
  assert.equal(seen.url, 'https://w/quoteSummary/AAPL?tool=parity');
  assert.equal(seen.opts.headers['X-KV-Batch-Key'], 'k');
  assert.equal(seen.opts.headers.Origin, PREFLIGHT_ORIGIN);
});

test('checkBatchKey: 403 / 429 mean the key was rejected; other failures say so; no key never passes', async () => {
  for (const status of [403, 429]) {
    const r = await checkBatchKey(respond(status), 'https://w', 'k', 'the staging Worker');
    assert.equal(r.ok, false);
    assert.match(r.message, /the staging Worker rejected the batch key/);
    assert.match(r.message, /BATCH_KEY secret/);
  }
  assert.match((await checkBatchKey(respond(502), 'https://w', 'k', 'staging')).message, /HTTP 502/);
  assert.match((await checkBatchKey(async () => { throw new Error('ECONNRESET'); }, 'https://w', 'k', 'staging')).message, /ECONNRESET/);
  assert.match((await checkBatchKey(respond(200), 'https://w', '', 'staging')).message, /KV_BATCH_KEY is not set/);
});

test('assertBatchKeyAccepted names every Worker that failed, and passes when all accept', async () => {
  const fetchImpl = async url => new Response('{}', { status: url.startsWith('https://stg') ? 403 : 200 });
  await assert.rejects(assertBatchKeyAccepted(fetchImpl, [{ label: 'staging', url: 'https://stg' }, { label: 'production', url: 'https://prod' }], 'k'),
    err => err instanceof ParityRefused && /staging rejected/.test(err.message) && !/production/.test(err.message));
  await assertBatchKeyAccepted(respond(200), [{ label: 'staging', url: 'https://stg' }], 'k');
});

test('the refusal guard remembers the first 429/403 and ignores everything else (Yahoo failures are 502)', async () => {
  const g = createRefusalGuard();
  const statuses = { a: 200, b: 502, c: 404, d: 429, e: 403 };
  const f = g.wrap(async url => new Response('{}', { status: statuses[url.split('?')[0].slice(-1)] }));
  for (const k of ['a', 'b', 'c']) await f(`https://w/x/${k}`);
  assert.equal(g.refused, null);
  g.check();
  await f('https://w/quoteSummary/d?tool=parity');
  await f('https://w/x/e');
  assert.deepEqual(g.refused, { url: 'https://w/quoteSummary/d?tool=parity', status: 429 });
  assert.throws(() => g.check(), err => err instanceof ParityRefused && /HTTP 429 on https:\/\/w\/quoteSummary\/d\)/.test(err.message));
});
