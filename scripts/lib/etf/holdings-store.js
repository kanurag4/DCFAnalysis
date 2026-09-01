// scripts/lib/etf/holdings-store.js — committed holdings snapshots + staleness checks.
const fs = require('node:fs');
const path = require('node:path');

const file = (dir, slug) => path.join(dir, `${slug}.json`);

function readSnapshot(dir, slug) {
  try { return JSON.parse(fs.readFileSync(file(dir, slug), 'utf8')); }
  catch (_) { return null; }
}

function writeSnapshot(dir, slug, snapshot) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file(dir, slug), JSON.stringify(snapshot, null, 2) + '\n');
}

function evaluateFreshness(prev, fresh) {
  if (!fresh) return { ok: false, flags: ['fetch-failed'] };
  const flags = [];
  if (prev && prev.asOf && fresh.asOf && prev.asOf === fresh.asOf) flags.push('asOf-unchanged');
  if (prev && Array.isArray(prev.rows) && Array.isArray(fresh.rows)
      && prev.rows.length > 0 && fresh.rows.length / prev.rows.length < 0.80) flags.push('row-count-drop');
  const sum = (fresh.rows || []).reduce((a, r) => a + (r.weight || 0), 0);
  if (sum < 0.97 || sum > 1.03) flags.push('weight-sum-off');
  return { ok: flags.length === 0, flags };
}

module.exports = { readSnapshot, writeSnapshot, evaluateFreshness };
