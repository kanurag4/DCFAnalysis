// scripts/lib/etf/raw-cache.js — the _raw-etf.json fetch cache
// ({ asAt, live, union: {sym -> Yahoo data}, listingPrices, fx }) and how a
// scoped `--only=<slug>` run's per-fund cache folds back into it.

// A full run writes the whole shared cache (_raw-etf.json). A `--only` run writes
// a SEPARATE per-fund cache (_raw-etf-<slug>.json) so it can't clobber the other
// funds' data with its ~40-symbol partial union. But `--reagg` only ever reads
// the shared cache — so a fund added via `--only` is invisible to `--reagg`, and
// every one of its holdings counts as fetch-failed (observed 2026-09-03: SHLD,
// added via --only an hour earlier, collapsed from 88% coverage to 72% on the
// next --reagg). mergeUnionCache() folds the per-fund cache back into the shared
// one after a `--only` run so the shared cache stays complete.
//
// Additive: every symbol the shared cache already has is kept. Fund-wins for
// overlapping symbols — the `--only` fetch is the fresher of the two. `asAt` and
// `live` (radar-wide rates from the last full run) are left untouched. Returns a
// new object; does not mutate its inputs.
function mergeUnionCache(shared, fund) {
  if (!shared) return fund ? { ...fund } : null;
  if (!fund) return { ...shared };
  return {
    ...shared,
    union: { ...(shared.union || {}), ...(fund.union || {}) },
    fx: { ...(shared.fx || {}), ...(fund.fx || {}) },
    listingPrices: { ...(shared.listingPrices || {}), ...(fund.listingPrices || {}) },
  };
}

module.exports = { mergeUnionCache };
