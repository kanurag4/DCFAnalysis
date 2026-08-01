const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildPayload, postRun } = require('../scripts/lib/post-run.js');

function makeFixture({ outDir = 'sp500-undervalued', rankings, sold, lastSold, portfolioValue, history, log } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'post-run-test-'));
  const dir = path.join(root, 'www', outDir);
  fs.mkdirSync(dir, { recursive: true });
  if (rankings !== undefined) {
    fs.writeFileSync(path.join(dir, 'rankings.json'), JSON.stringify(rankings));
  }
  // The market's all-time cumulative exit ledger -- buildPayload must NOT read
  // this for its `sold` field. Only present in fixtures that exercise the
  // distinction from lastSold below.
  if (sold !== undefined) fs.writeFileSync(path.join(dir, 'sold.json'), JSON.stringify(sold));
  // This run's own fresh exits, written by updatePortfolio() in the same CI
  // job -- this is what buildPayload's `sold` field should actually reflect.
  if (lastSold !== undefined) {
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', '_last-sold.json'), JSON.stringify(lastSold));
  }
  if (portfolioValue !== undefined) fs.writeFileSync(path.join(dir, 'portfolio-value.json'), JSON.stringify(portfolioValue));
  if (history !== undefined) fs.writeFileSync(path.join(dir, 'portfolio-history.json'), JSON.stringify(history));
  if (log !== undefined) fs.writeFileSync(path.join(root, 'run.log'), log);
  return root;
}

test('buildPayload reads rankings.json plus optional siblings into one payload', () => {
  const root = makeFixture({
    rankings: { asAt: '2026-08-01', summary: { qualified: 20, shown: 20 }, rows: [{ ticker: 'AAPL' }] },
    lastSold: [{ ticker: 'XYZ' }],
    portfolioValue: { value: 12345 },
    history: [{ date: '2026-07-01', portfolioValue: 10000 }, { date: '2026-08-01', portfolioValue: 12345 }],
    log: 'line1\nline2\n',
  });
  const payload = buildPayload('sp500', { repoRoot: root, sha: 'abc123', runUrl: 'https://x/run/1' });
  assert.strictEqual(payload.market, 'sp500');
  assert.strictEqual(payload.asAt, '2026-08-01');
  assert.strictEqual(payload.sha, 'abc123');
  assert.strictEqual(payload.runUrl, 'https://x/run/1');
  assert.deepStrictEqual(payload.summary, { qualified: 20, shown: 20 });
  assert.deepStrictEqual(payload.rows, [{ ticker: 'AAPL' }]);
  assert.deepStrictEqual(payload.sold, [{ ticker: 'XYZ' }]);
  assert.deepStrictEqual(payload.portfolioValue, { value: 12345 });
  assert.strictEqual(payload.historyTail.length, 2);
  assert.match(payload.logTail, /line1[\s\S]*line2/);
});

test('buildPayload defaults sold/portfolioValue/history to empty when siblings are missing', () => {
  const root = makeFixture({ rankings: { asAt: '2026-08-01', summary: {}, rows: [] } });
  const payload = buildPayload('sp500', { repoRoot: root });
  assert.deepStrictEqual(payload.sold, []);
  assert.strictEqual(payload.portfolioValue, null);
  assert.deepStrictEqual(payload.historyTail, []);
  assert.strictEqual(payload.logTail, '');
});

test('buildPayload sends only this run\'s new exits, not the market\'s full cumulative sold.json ledger', () => {
  const root = makeFixture({
    rankings: { asAt: '2026-08-01', summary: {}, rows: [] },
    sold: [{ ticker: 'OLD1' }, { ticker: 'OLD2' }, { ticker: 'OLD3' }], // full all-time ledger -- must be ignored
    lastSold: [{ ticker: 'OLD3' }], // this run's own fresh delta
  });
  const payload = buildPayload('sp500', { repoRoot: root });
  assert.deepStrictEqual(payload.sold, [{ ticker: 'OLD3' }]);
});

test('buildPayload sends an empty sold array when this run had no new exits, even if the cumulative ledger is long', () => {
  const root = makeFixture({
    rankings: { asAt: '2026-08-01', summary: {}, rows: [] },
    sold: [{ ticker: 'OLD1' }, { ticker: 'OLD2' }],
    lastSold: [],
  });
  const payload = buildPayload('sp500', { repoRoot: root });
  assert.deepStrictEqual(payload.sold, []);
});

test('buildPayload throws for an unknown market', () => {
  const root = makeFixture({ rankings: { asAt: '2026-08-01', summary: {}, rows: [] } });
  assert.throws(() => buildPayload('mars', { repoRoot: root }), /unknown market/);
});

test('buildPayload throws when rankings.json is missing (batch never ran)', () => {
  const root = makeFixture(); // no rankings written
  assert.throws(() => buildPayload('sp500', { repoRoot: root }), /no rankings\.json/);
});

test('postRun skips without throwing when ingest url/secret are unset', async () => {
  const root = makeFixture({ rankings: { asAt: '2026-08-01', summary: {}, rows: [] } });
  const result = await postRun('sp500', { repoRoot: root });
  assert.strictEqual(result.skipped, true);
});

test('postRun POSTs the built payload with a bearer auth header', async () => {
  const root = makeFixture({ rankings: { asAt: '2026-08-01', summary: {}, rows: [] } });
  let capturedUrl, capturedOpts;
  const fakeFetch = async (url, opts) => { capturedUrl = url; capturedOpts = opts; return { ok: true, status: 200 }; };
  const result = await postRun('sp500', {
    repoRoot: root, ingestUrl: 'https://admin.example/ingest', ingestSecret: 'shh', fetchImpl: fakeFetch,
  });
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(capturedUrl, 'https://admin.example/ingest');
  assert.strictEqual(capturedOpts.headers.Authorization, 'Bearer shh');
  const body = JSON.parse(capturedOpts.body);
  assert.strictEqual(body.market, 'sp500');
});

test('postRun throws when the ingest POST fails (once configured, failure must be loud)', async () => {
  const root = makeFixture({ rankings: { asAt: '2026-08-01', summary: {}, rows: [] } });
  const fakeFetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  await assert.rejects(
    postRun('sp500', { repoRoot: root, ingestUrl: 'https://admin.example/ingest', ingestSecret: 'shh', fetchImpl: fakeFetch }),
    /ingest POST failed.*500/
  );
});
