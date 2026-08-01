// scripts/lib/batch-auth.js
// Shared header-builder for the monthly refresh batch's Worker calls (see
// worker/yahoo-proxy.js's BATCH_KEY bypass, added for the admin-console plan).
// Returns {} when KV_BATCH_KEY isn't set, so a bare `node scripts/rank-*.js`
// on a dev machine behaves exactly as it always has -- unauthenticated,
// under the normal per-IP throttle. Only GitHub Actions sets the env var.
function batchHeaders() {
  const key = process.env.KV_BATCH_KEY;
  return key ? { 'X-KV-Batch-Key': key } : {};
}

module.exports = { batchHeaders };
