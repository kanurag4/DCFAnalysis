// scripts/fetch-yahoo.js
// IO: fetch one symbol's quoteSummary via the Cloudflare Worker proxy and map it.
// fetchImpl is injectable for testing; defaults to global fetch (Node 18+).
const { mapQuoteSummary } = require('../www/data.js');

async function fetchSymbol(symbol, { fetchImpl = fetch, proxyUrl } = {}) {
  const url = `${proxyUrl.replace(/\/$/, '')}/quoteSummary/${encodeURIComponent(symbol)}`;
  let res;
  try { res = await fetchImpl(url); } catch (_) { return null; }
  if (!res.ok) return null;
  let body;
  try { body = await res.json(); } catch (_) { return null; }
  try { return mapQuoteSummary(body, symbol); } catch (_) { return null; }
}

module.exports = { fetchSymbol };
