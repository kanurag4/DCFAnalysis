// scripts/lib/post-run.js
// IO: build and send the run-summary payload to the admin console's ingest
// endpoint after a refresh-screen workflow run (see the admin-console plan's
// Step 4, kv-admin Worker). fetchImpl is injectable for testing; defaults to
// global fetch (Node 18+). repoRoot is injectable too, so buildPayload can be
// tested against a fixture directory instead of the real checkout.
const fs = require('node:fs');
const path = require('node:path');

const MARKET_OUT_DIR = {
  asx: 'asx-undervalued',
  sp500: 'sp500-undervalued',
  nifty: 'nifty-undervalued',
  kospi: 'kospi-undervalued',
  nikkei: 'nikkei-undervalued',
};

function readJsonIfExists(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function tailLines(p, n) {
  try {
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    return lines.slice(-n).join('\n');
  } catch (_) { return ''; }
}

// Reads the just-staged snapshot off disk into the shape the console expects.
// Throws on an unknown market or a missing rankings.json — both mean the
// caller invoked this before the batch actually produced anything, which
// should fail loudly rather than notify the console about a run that doesn't exist.
function buildPayload(market, { repoRoot, sha = '', runUrl = '', logPath = 'run.log' } = {}) {
  const outDir = MARKET_OUT_DIR[market];
  if (!outDir) throw new Error(`unknown market "${market}" -- expected one of ${Object.keys(MARKET_OUT_DIR).join(', ')}`);

  const dir = path.join(repoRoot, 'www', outDir);
  const rankings = readJsonIfExists(path.join(dir, 'rankings.json'));
  if (!rankings) throw new Error(`no rankings.json found at ${dir} -- did the batch run first?`);

  const sold = readJsonIfExists(path.join(dir, 'sold.json')) || [];
  const portfolioValue = readJsonIfExists(path.join(dir, 'portfolio-value.json')) || null;
  const history = readJsonIfExists(path.join(dir, 'portfolio-history.json')) || [];

  return {
    kind: 'run', // vs 'published' -- see publish-screen.yml's notify step; lets one /ingest route both
    market,
    asAt: rankings.asAt,
    sha,
    runUrl,
    summary: rankings.summary,
    rows: rankings.rows,
    sold,
    portfolioValue,
    historyTail: history.slice(-2), // enough to show the change vs the prior point
    logTail: tailLines(path.join(repoRoot, logPath), 200),
  };
}

// Best-effort in one direction only: no ingestUrl/ingestSecret configured
// (kv-admin doesn't exist yet, or this ran outside the workflow) is a silent
// skip -- the snapshot already lives in the staging branch commit either way.
// But once both ARE configured, a failed POST throws: if the console can't
// see a run, there's nothing to approve, so a silent ingest failure would be
// worse than a loud one.
async function postRun(market, {
  repoRoot, sha, runUrl, logPath, ingestUrl, ingestSecret, fetchImpl = fetch,
} = {}) {
  if (!ingestUrl || !ingestSecret) {
    console.warn('post-run: ADMIN_INGEST_URL/RUN_INGEST_SECRET not set -- skipping console notification (the snapshot is already committed to the staging branch).');
    return { skipped: true };
  }

  const payload = buildPayload(market, { repoRoot, sha, runUrl, logPath });
  const res = await fetchImpl(ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ingestSecret}` },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = (res.text ? await res.text().catch(() => '') : '');
    throw new Error(`ingest POST failed -- HTTP ${res.status}: ${body}`);
  }
  console.log(`post-run: notified console for ${market} (asAt ${payload.asAt}, sha ${(sha || '').slice(0, 7)})`);
  return { skipped: false, payload };
}

module.exports = { MARKET_OUT_DIR, buildPayload, postRun };
