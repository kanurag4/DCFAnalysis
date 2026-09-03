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
  // Monotonicity guard: an issuer sometimes serves an OLDER-dated holdings file
  // than the one we already committed (observed 2026-09-03, iShares served ixj's
  // 2026-08-31 file over our committed 2026-09-01). The weight-sum / row-count
  // checks below can't catch it — a stale-but-complete file passes both. Never
  // adopt a snapshot that goes backwards in time; keep last-good and flag it.
  // asOf strings are YYYY-MM-DD, so a lexical `<` is a chronological `<`.
  if (prev && prev.asOf && fresh.asOf && fresh.asOf < prev.asOf) flags.push('asOf-regressed');
  if (prev && Array.isArray(prev.rows) && Array.isArray(fresh.rows)
      && prev.rows.length > 0 && fresh.rows.length / prev.rows.length < 0.80) flags.push('row-count-drop');
  const sum = (fresh.rows || []).reduce((a, r) => a + (r.weight || 0), 0);
  if (sum < 0.97 || sum > 1.03) flags.push('weight-sum-off');
  // `asOf-unchanged` on its own is informational (issuer hasn't re-published) —
  // the fresh rows are still valid and current, so adopt them. Any other flag
  // (asOf-regressed / row-count-drop / weight-sum-off / fetch-failed) means
  // keep last-good.
  const blocking = flags.filter(f => f !== 'asOf-unchanged');
  return { ok: blocking.length === 0, flags };
}

module.exports = { readSnapshot, writeSnapshot, evaluateFreshness };
