// scripts/lib/rf.js
// IO: fetch a market 10-yr govt-bond / treasury yield via the Worker proxy and
// return it as a DECIMAL rate. Reads the raw quoteSummary with the SAME field
// chain the live tool uses (app.js fetchAndSetRiskFreeRate): previousClose ->
// regularMarketPrice -> financialData.currentPrice. The quoted value is the
// yield in percent (^TNX 4.25 -> 0.0425; ^GSBG10.AX 4.80 -> 0.048), so we divide
// by 100. NB: we deliberately do NOT route through mapQuoteSummary — it derives
// price only from financialData.currentPrice, which rate indices like ^TNX leave
// null (their value lives in summaryDetail). Clamped to a plausible band;
// otherwise the documented per-market fallback is returned (matches the live
// tool's silent fallback). fetchImpl is injectable for testing.
const DEFAULT_FETCH = async (url) => {
  const res = await fetch(url);
  if (!res || !res.ok) return null;
  return res.json();
};

async function fetchRfRate(symbol, fallback, { proxyUrl, fetchImpl = DEFAULT_FETCH } = {}) {
  let raw = null;
  try {
    const url = `${proxyUrl.replace(/\/$/, '')}/quoteSummary/${encodeURIComponent(symbol)}`;
    const body = await fetchImpl(url);
    const r = body?.quoteSummary?.result?.[0];
    raw =
      r?.summaryDetail?.previousClose?.raw ??
      r?.summaryDetail?.regularMarketPrice?.raw ??
      r?.financialData?.currentPrice?.raw ??
      null;
  } catch (_) {
    raw = null;
  }
  const pct = (raw != null && isFinite(raw)) ? raw / 100 : null;
  return (pct && pct > 0 && pct < 0.15) ? pct : fallback;
}

const fetchUsRf  = (proxyUrl) => fetchRfRate('^TNX',         0.045, { proxyUrl });
const fetchAusRf = (proxyUrl) => fetchRfRate('^GSBG10.AX',  0.048, { proxyUrl });
const fetchIndRf = (proxyUrl) => fetchRfRate('^INBMKG10.NS', 0.07,  { proxyUrl });

// Fetch a raw equity index level (points, not a rate — no ÷100, no clamping).
// Uses the same summaryDetail chain as fetchRfRate because mapQuoteSummary
// leaves .price null for index symbols. Returns null on any failure.
async function fetchIndexPrice(symbol, proxyUrl, fetchImpl = DEFAULT_FETCH) {
  try {
    const url = `${proxyUrl.replace(/\/$/, '')}/quoteSummary/${encodeURIComponent(symbol)}`;
    const body = await fetchImpl(url);
    const r = body?.quoteSummary?.result?.[0];
    const raw =
      r?.summaryDetail?.regularMarketPrice?.raw ??
      r?.summaryDetail?.previousClose?.raw ??
      r?.financialData?.currentPrice?.raw ??
      null;
    return (raw != null && isFinite(raw) && raw > 0) ? raw : null;
  } catch (_) {
    return null;
  }
}

module.exports = { fetchRfRate, fetchUsRf, fetchAusRf, fetchIndRf, fetchIndexPrice };
