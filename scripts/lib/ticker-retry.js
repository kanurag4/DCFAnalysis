// scripts/lib/ticker-retry.js
// Retries, with backoff, a ticker whose base scenario computed successfully
// (status: 'ok', every fetch succeeded) but came back with a null intrinsic
// value. Real incident, 2026-08-05: live refresh-ticker-pages.yml runs
// intermittently skipped a handful of tickers with "shares outstanding
// unavailable" / similar -- every one of them, reproduced minutes later
// (same code, same Worker), computed a valid non-null result. No HTTP 429s
// or fetch errors appeared anywhere in those runs' logs, so this isn't
// rate-limiting -- the evidence points at transient Yahoo-side data
// degradation for specific fields at that moment (some quoteSummary modules
// silently missing from an otherwise-200 response), not a deterministic bug
// in the calc logic. Retrying after a short wait directly addresses that:
// it's the same thing a human would do by hand (as was done to diagnose this
// incident). Capped at 2 retries (3 attempts total) -- if a ticker is still
// null after that, it's left skipped for this run rather than retried
// indefinitely.
//
// Deliberately NOT inside buildTickerPage itself -- retry-orchestration is a
// batch-level policy decision, same reasoning as why the null-base-case skip
// itself is a batch-only policy layered on top of buildTickerPage's result
// (see scripts/refresh-ticker-pages.js's file header). The single-ticket CLI
// does not retry.
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function isNullBaseCase(outcome) {
  return outcome.status === 'ok' && outcome.entry.intrinsic == null;
}

// attemptFn: () => Promise<buildTickerPage-shaped outcome>
// Retries only the specific "ok but null intrinsic" case -- a 'skipped'
// outcome (invalid ticker, WACC uncomputable, thrown fetch error) is returned
// immediately, unretried, since those aren't the transient condition this
// exists to work around.
// onRetry(attempt, outcome), if given, is called just before each retry
// (attempt is 1-based) -- purely for caller-side logging, no return value used.
async function withNullBaseCaseRetry(attemptFn, { backoffMs = 5000, maxRetries = 2, sleepImpl = sleep, onRetry } = {}) {
  let outcome = await attemptFn();
  let attempt = 0;
  while (attempt < maxRetries && isNullBaseCase(outcome)) {
    attempt++;
    if (onRetry) onRetry(attempt, outcome);
    await sleepImpl(backoffMs);
    outcome = await attemptFn();
  }
  return outcome;
}

module.exports = { withNullBaseCaseRetry };
