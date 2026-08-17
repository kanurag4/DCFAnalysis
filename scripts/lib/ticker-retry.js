// scripts/lib/ticker-retry.js
// Retries, with backoff, a ticker outcome matching one of two confirmed-transient
// conditions:
// (1) base scenario computed successfully (status: 'ok', every fetch succeeded)
//     but came back with a null intrinsic value. Real incident, 2026-08-05: live
//     refresh-ticker-pages.yml runs intermittently skipped a handful of tickers
//     with "shares outstanding unavailable" / similar -- every one of them,
//     reproduced minutes later (same code, same Worker), computed a valid
//     non-null result.
// (2) status: 'skipped', reason exactly 'WACC uncomputable (no market cap or
//     debt data)'. Originally excluded from retry (assumed a permanent data
//     gap) -- widened 2026-08-17 after a live refresh skipped 12 tickers
//     (BPT/CPU/CSL/MTS/ORI/STO/TLS/WOW.AX, BBY, RPOWER.NS/TCS.NS) with this
//     exact reason, and spot-checking the Worker minutes later found 11 of
//     the 12 already had `summaryDetail.marketCap` populated again with no
//     code change in between -- the same transient module-omission pattern as
//     (1), just caught at an earlier guard (calculateWACC's own null check)
//     instead of surfacing as a null intrinsic downstream. GMG.AX was the one
//     exception (still empty on re-check) -- consistent with its own prior
//     history of repeated transient gaps (see the null-intrinsic incident
//     write-up), not evidence against widening the retry here.
//     Other skip reasons ('invalid ticker format ...', 'fetch failed: ...')
//     are deliberately left unretried -- no comparable live evidence yet that
//     those are the same transient condition rather than a real, permanent
//     failure.
// No HTTP 429s or fetch errors appeared anywhere in the runs that surfaced
// either condition, so this isn't rate-limiting -- the evidence points at
// transient Yahoo-side data degradation for specific fields at that moment
// (some quoteSummary modules silently missing from an otherwise-200
// response), not a deterministic bug in the calc logic. Retrying after a
// short wait directly addresses that: it's the same thing a human would do
// by hand (as was done to diagnose both incidents). Capped at 2 retries (3
// attempts total) -- if a ticker still matches after that, it's left skipped
// for this run rather than retried indefinitely.
//
// Deliberately NOT inside buildTickerPage itself -- retry-orchestration is a
// batch-level policy decision, same reasoning as why the null-base-case skip
// itself is a batch-only policy layered on top of buildTickerPage's result
// (see scripts/refresh-ticker-pages.js's file header). The single-ticket CLI
// does not retry.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const RETRYABLE_SKIP_REASONS = new Set([
  'WACC uncomputable (no market cap or debt data)',
]);

function isRetryableOutcome(outcome) {
  if (outcome.status === 'ok' && outcome.entry.intrinsic == null) return true;
  if (outcome.status === 'skipped' && RETRYABLE_SKIP_REASONS.has(outcome.reason)) return true;
  return false;
}

// attemptFn: () => Promise<buildTickerPage-shaped outcome>
// Retries only the two confirmed-transient conditions above -- any other
// 'skipped' outcome (invalid ticker, generic fetch failure) is returned
// immediately, unretried, since there's no evidence yet that those are the
// same transient condition rather than a real, permanent failure.
// onRetry(attempt, outcome), if given, is called just before each retry
// (attempt is 1-based) -- purely for caller-side logging, no return value used.
async function withNullBaseCaseRetry(attemptFn, { backoffMs = 5000, maxRetries = 2, sleepImpl = sleep, onRetry } = {}) {
  let outcome = await attemptFn();
  let attempt = 0;
  while (attempt < maxRetries && isRetryableOutcome(outcome)) {
    attempt++;
    if (onRetry) onRetry(attempt, outcome);
    await sleepImpl(backoffMs);
    outcome = await attemptFn();
  }
  return outcome;
}

module.exports = { withNullBaseCaseRetry };
