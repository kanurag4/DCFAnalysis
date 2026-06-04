// scripts/lib/rf.js
// IO: fetch a market 10-yr govt-bond / treasury yield via the Worker proxy and
// return it as a DECIMAL rate. The quoted price is the yield in percent
// (^TNX 4.25 -> 0.0425; ^GSBG10.AX 4.80 -> 0.048), so we divide by 100.
// Clamped to a plausible band; otherwise the documented per-market fallback is
// returned (matches the live tool's silent fallbacks). fetchSymbolImpl is
// injectable for testing; defaults to the real fetchSymbol.
const { fetchSymbol } = require('../fetch-yahoo.js');

async function fetchRfRate(symbol, fallback, { proxyUrl, fetchSymbolImpl = fetchSymbol } = {}) {
  let d = null;
  try { d = await fetchSymbolImpl(symbol, { proxyUrl }); } catch (_) { d = null; }
  const pct = (d && d.price != null) ? d.price / 100 : null;
  return (pct && pct > 0 && pct < 0.15) ? pct : fallback;
}

const fetchUsRf  = (proxyUrl) => fetchRfRate('^TNX',       0.045, { proxyUrl });
const fetchAusRf = (proxyUrl) => fetchRfRate('^GSBG10.AX', 0.048, { proxyUrl });

module.exports = { fetchRfRate, fetchUsRf, fetchAusRf };
