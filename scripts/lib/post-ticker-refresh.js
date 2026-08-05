// scripts/lib/post-ticker-refresh.js
// IO: build and send the ticker-pages bulk-refresh run summary to the admin
// console's ingest endpoint. Parallel to scripts/lib/post-run.js's screen
// version, but the payload shape is different (computeRefreshSummary's
// output, not a screen's rankings.json), so this is its own file rather than
// a branch inside post-run.js.
const fs = require('node:fs');
const path = require('node:path');

function readJsonIfExists(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function tailLines(p, n) {
  try {
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    return lines.slice(-n).join('\n');
  } catch (_) { return ''; }
}

// Reads the just-written _refresh-report.json off disk into the shape the
// console expects. Throws if it's missing -- means the caller invoked this
// before the batch actually produced anything, which should fail loudly
// rather than notify the console about a run that doesn't exist.
function buildPayload({ repoRoot, sha = '', runUrl = '', logPath = 'run.log', reportPath = 'scripts/_refresh-report.json' } = {}) {
  const summary = readJsonIfExists(path.join(repoRoot, reportPath));
  if (!summary) throw new Error(`no ${reportPath} found -- did the batch run first?`);

  return {
    kind: 'run',
    market: 'tickers', // reuses the kv-admin Worker's existing "market" field slot -- see the design spec's §4.7 note on why this isn't renamed to "scope"
    asAt: new Date().toISOString().slice(0, 10),
    sha,
    runUrl,
    summary,
    logTail: tailLines(path.join(repoRoot, logPath), 200),
  };
}

// Best-effort in one direction only -- see scripts/lib/post-run.js's identical
// reasoning: no ingestUrl/ingestSecret configured is a silent skip (the
// snapshot already lives in the staging branch commit either way); once both
// ARE configured, a failed POST throws.
async function postTickerRefresh({
  repoRoot, sha, runUrl, logPath, reportPath, ingestUrl, ingestSecret, fetchImpl = fetch,
} = {}) {
  if (!ingestUrl || !ingestSecret) {
    console.warn('post-ticker-refresh: ADMIN_INGEST_URL/RUN_INGEST_SECRET not set -- skipping console notification (the snapshot is already committed to the staging branch).');
    return { skipped: true };
  }

  const payload = buildPayload({ repoRoot, sha, runUrl, logPath, reportPath });
  const res = await fetchImpl(ingestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ingestSecret}` },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = (res.text ? await res.text().catch(() => '') : '');
    throw new Error(`ingest POST failed -- HTTP ${res.status}: ${body}`);
  }
  console.log(`post-ticker-refresh: notified console (${payload.summary.written}/${payload.summary.total} written, sha ${(sha || '').slice(0, 7)})`);
  return { skipped: false, payload };
}

module.exports = { buildPayload, postTickerRefresh };
