// scripts/lib/parity-guard.js — keeps a parity run from saving results it could not really measure.
// Byte-identical in StockAnalysis and DCFAnalysis (drift-checked: scripts/shared-files-manifest.json).
//
// The own market-data store's parity jobs (StockAnalysis scripts/data-parity-evaluate.js, DCFAnalysis
// scripts/data-parity.js) call the staging and production Yahoo-proxy Workers with the batch key, which skips the
// Worker's per-IP rate limit. If a Worker does not accept the key (its BATCH_KEY secret differs), the calls get
// rate-limited (429) part-way through and every refused ticker used to be saved as a data mismatch (2026-10-27:
// 17 "no-data" rows and 4 false mismatches, all caused by staging's BATCH_KEY not matching).
//
//   - checkBatchKey(): one request per Worker before the run. It carries the key and an Origin the Worker does not
//     allow, so a valid key answers 200 and a rejected key answers 403 -- a wrong key fails in seconds.
//   - createRefusalGuard(): wraps fetch and remembers the first 429/403 from our own Worker (Yahoo failures come
//     back as 502, never these), so the job can stop and save nothing.

const PREFLIGHT_SYMBOL = 'AAPL';
const PREFLIGHT_ORIGIN = 'https://parity-preflight.invalid';

class ParityRefused extends Error {
  constructor(message) {
    super(message);
    this.name = 'ParityRefused';
  }
}

// Resolves { ok: true } or { ok: false, message }.
async function checkBatchKey(fetchImpl, proxyUrl, key, label) {
  if (!key) return { ok: false, message: `KV_BATCH_KEY is not set (${label} would rate-limit the run).` };
  let res;
  try {
    res = await fetchImpl(`${proxyUrl}/quoteSummary/${PREFLIGHT_SYMBOL}?tool=parity`,
      { headers: { 'X-KV-Batch-Key': key, Origin: PREFLIGHT_ORIGIN } });
  } catch (err) {
    return { ok: false, message: `${label} did not answer the key check: ${String((err && err.message) || err)}` };
  }
  if (res && res.ok) return { ok: true };
  const status = res ? res.status : 'no response';
  if (status === 403 || status === 429) {
    return { ok: false, message: `${label} rejected the batch key (HTTP ${status}). Set that Worker's BATCH_KEY secret to the same value as the KV_BATCH_KEY GitHub secret.` };
  }
  return { ok: false, message: `${label} failed the key check (HTTP ${status}).` };
}

// Checks every { label, url } Worker; throws ParityRefused naming each one that failed.
async function assertBatchKeyAccepted(fetchImpl, workers, key) {
  const failures = [];
  for (const w of workers) {
    const r = await checkBatchKey(fetchImpl, w.url, key, w.label);
    if (!r.ok) failures.push(r.message);
  }
  if (failures.length) throw new ParityRefused(`Parity run not started. ${failures.join(' ')}`);
}

function createRefusalGuard() {
  let refused = null;
  return {
    wrap(fetchImpl) {
      return async (url, opts) => {
        const res = await fetchImpl(url, opts);
        if (!refused && res && (res.status === 429 || res.status === 403)) refused = { url: String(url), status: res.status };
        return res;
      };
    },
    get refused() { return refused; },
    // Throws if any wrapped call was refused since the run began.
    check() {
      if (!refused) return;
      throw new ParityRefused(`Parity run stopped, nothing saved: a Worker refused a request (HTTP ${refused.status} on ${refused.url.split('?')[0]}). `
        + 'Usually that Worker does not accept the batch key; check its BATCH_KEY secret against the KV_BATCH_KEY GitHub secret.');
    },
  };
}

// Store-first reads (2026-11-02): once production answers from the store, the Yahoo side of a parity run must
// still be Yahoo. Adds X-KV-Source-Pref: yahoo (honoured by the Worker only with the batch key) to every request
// to `proxyUrl`; other URLs pass through untouched.
function preferYahoo(fetchImpl, proxyUrl) {
  const base = String(proxyUrl).replace(/\/$/, '');
  return (url, opts = {}) => {
    if (!String(url).startsWith(base)) return fetchImpl(url, opts);
    return fetchImpl(url, { ...opts, headers: { ...(opts.headers || {}), 'X-KV-Source-Pref': 'yahoo' } });
  };
}

module.exports = { checkBatchKey, assertBatchKeyAccepted, createRefusalGuard, preferYahoo, ParityRefused, PREFLIGHT_ORIGIN };
