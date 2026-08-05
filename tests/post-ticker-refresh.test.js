const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPayload, postTickerRefresh } = require('../scripts/lib/post-ticker-refresh.js');

function makeFixture({ report, log } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'post-ticker-refresh-test-'));
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  if (report !== undefined) {
    fs.writeFileSync(path.join(root, 'scripts', '_refresh-report.json'), JSON.stringify(report));
  }
  if (log !== undefined) fs.writeFileSync(path.join(root, 'run.log'), log);
  return root;
}

test('buildPayload reads _refresh-report.json into the summary field', () => {
  const root = makeFixture({
    report: { total: 38, written: 36, skipped: 2, skips: [], flips: [], movers: [] },
    log: 'line1\nline2\n',
  });
  const payload = buildPayload({ repoRoot: root, sha: 'abc123', runUrl: 'https://x/run/1' });
  assert.strictEqual(payload.kind, 'run');
  assert.strictEqual(payload.market, 'tickers');
  assert.strictEqual(payload.sha, 'abc123');
  assert.strictEqual(payload.runUrl, 'https://x/run/1');
  assert.deepStrictEqual(payload.summary, { total: 38, written: 36, skipped: 2, skips: [], flips: [], movers: [] });
  assert.match(payload.logTail, /line1[\s\S]*line2/);
});

test('buildPayload defaults logTail to empty when run.log is missing', () => {
  const root = makeFixture({ report: { total: 1, written: 1, skipped: 0, skips: [], flips: [], movers: [] } });
  const payload = buildPayload({ repoRoot: root });
  assert.strictEqual(payload.logTail, '');
});

test('buildPayload throws when _refresh-report.json is missing (batch never ran)', () => {
  const root = makeFixture(); // no report written
  assert.throws(() => buildPayload({ repoRoot: root }), /no scripts\/_refresh-report\.json/);
});

test('postTickerRefresh skips without throwing when ingest url/secret are unset', async () => {
  const root = makeFixture({ report: { total: 1, written: 1, skipped: 0, skips: [], flips: [], movers: [] } });
  const result = await postTickerRefresh({ repoRoot: root });
  assert.strictEqual(result.skipped, true);
});

test('postTickerRefresh POSTs the built payload with a bearer auth header', async () => {
  const root = makeFixture({ report: { total: 1, written: 1, skipped: 0, skips: [], flips: [], movers: [] } });
  let capturedUrl, capturedOpts;
  const fakeFetch = async (url, opts) => { capturedUrl = url; capturedOpts = opts; return { ok: true, status: 200 }; };
  const result = await postTickerRefresh({
    repoRoot: root, ingestUrl: 'https://admin.example/ingest', ingestSecret: 'shh', fetchImpl: fakeFetch,
  });
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(capturedUrl, 'https://admin.example/ingest');
  assert.strictEqual(capturedOpts.headers.Authorization, 'Bearer shh');
  const body = JSON.parse(capturedOpts.body);
  assert.strictEqual(body.market, 'tickers');
});

test('postTickerRefresh throws when the ingest POST fails', async () => {
  const root = makeFixture({ report: { total: 1, written: 1, skipped: 0, skips: [], flips: [], movers: [] } });
  const fakeFetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  await assert.rejects(
    postTickerRefresh({ repoRoot: root, ingestUrl: 'https://admin.example/ingest', ingestSecret: 'shh', fetchImpl: fakeFetch }),
    /ingest POST failed.*500/
  );
});
