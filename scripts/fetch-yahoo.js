// scripts/fetch-yahoo.js
// IO: fetch one symbol's quoteSummary via the Cloudflare Worker proxy and map it.
// fetchImpl is injectable for testing; defaults to global fetch (Node 18+).
// Optional retries with linear backoff handle transient failures (429 rate-limit,
// Yahoo 5xx, network blips) — the Worker caps at 20 req/60s, so the batch also
// throttles between calls; retries catch the occasional straggler.
const { mapQuoteSummary } = require('../www/data.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchSymbol(symbol, {
  fetchImpl = fetch, proxyUrl, retries = 0, backoffMs = 3000, sleepImpl = sleep,
} = {}) {
  const url = `${proxyUrl.replace(/\/$/, '')}/quoteSummary/${encodeURIComponent(symbol)}`;
  for (let attempt = 0; ; attempt++) {
    let res = null;
    try { res = await fetchImpl(url); } catch (_) { res = null; }
    if (res && res.ok) {
      let body = null;
      try { body = await res.json(); } catch (_) { body = null; }
      if (body) {
        try { return mapQuoteSummary(body, symbol); } catch (_) { /* unmappable — treat as miss */ }
      }
    }
    if (attempt >= retries) return null;
    await sleepImpl(backoffMs * (attempt + 1)); // linear backoff: 1×, 2×, 3× …
  }
}

module.exports = { fetchSymbol };
