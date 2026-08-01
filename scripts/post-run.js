// scripts/post-run.js
// CLI wrapper: node scripts/post-run.js <market>
// Called by the refresh-screen workflow right after the staging-branch commit.
// See scripts/lib/post-run.js for the testable implementation.
const path = require('node:path');
const { postRun } = require('./lib/post-run.js');

const market = process.argv[2];

postRun(market, {
  repoRoot: path.join(__dirname, '..'),
  sha: process.env.STAGED_SHA || '',
  runUrl: (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID)
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : '',
  logPath: process.env.RUN_LOG_PATH || 'run.log',
  ingestUrl: process.env.ADMIN_INGEST_URL,
  ingestSecret: process.env.RUN_INGEST_SECRET,
}).catch(err => { console.error('post-run.js:', err.message); process.exit(1); });
