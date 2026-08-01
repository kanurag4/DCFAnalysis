// scripts/lib/blacklist.js
// IO: read/update a market's scripts/blacklist-<market>.json file. Used by the
// refresh-screen workflow's optional "exclude" input (wired to the admin
// console's "Exclude & re-run" action) and available for manual blacklist edits.
// dir is injectable for testing; defaults to this repo's scripts/ directory.
const fs = require('node:fs');
const path = require('node:path');

const SCRIPTS_DIR = path.join(__dirname, '..');

function blacklistPath(market, dir = SCRIPTS_DIR) {
  return path.join(dir, `blacklist-${market}.json`);
}

function readBlacklist(market, dir) {
  return JSON.parse(fs.readFileSync(blacklistPath(market, dir), 'utf8'));
}

// Adds tickers not already present (case-sensitive exact match, matching how
// tickers are compared everywhere else in this codebase). Idempotent: a
// ticker already in the list is silently skipped, not duplicated. Returns
// { entries, added } so the caller can report what actually changed.
function addToBlacklist(market, tickers, {
  reason = 'Excluded via admin console review', addedAt = new Date().toISOString().slice(0, 10), dir,
} = {}) {
  const entries = readBlacklist(market, dir);
  const existing = new Set(entries.map((e) => e.ticker));
  const added = [];
  for (const raw of tickers) {
    const ticker = String(raw).trim();
    if (!ticker || existing.has(ticker)) continue;
    entries.push({ ticker, reason, addedAt });
    existing.add(ticker);
    added.push(ticker);
  }
  if (added.length) {
    fs.writeFileSync(blacklistPath(market, dir), JSON.stringify(entries, null, 2) + '\n');
  }
  return { entries, added };
}

module.exports = { blacklistPath, readBlacklist, addToBlacklist };
