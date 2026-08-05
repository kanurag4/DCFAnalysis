// scripts/notify-ticker-refresh.js
// CLI wrapper: node scripts/notify-ticker-refresh.js <sha>
// Called by refresh-ticker-pages.yml right after the staging-branch commit.
// See scripts/lib/post-ticker-refresh.js for the testable implementation.
const path = require('node:path');
const { postTickerRefresh } = require('./lib/post-ticker-refresh.js');

postTickerRefresh({
  repoRoot: path.join(__dirname, '..'),
  sha: process.argv[2] || '',
  runUrl: (process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID)
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : '',
  logPath: process.env.RUN_LOG_PATH || 'run.log',
  ingestUrl: process.env.ADMIN_INGEST_URL,
  ingestSecret: process.env.RUN_INGEST_SECRET,
}).catch(err => { console.error('notify-ticker-refresh.js:', err.message); process.exit(1); });
