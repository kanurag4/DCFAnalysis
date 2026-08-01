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
const { batchHeaders } = require('./batch-auth.js');

const DEFAULT_FETCH = async (url) => {
  const res = await fetch(url, { headers: batchHeaders() });
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
//
// Uses the /history chart endpoint (last available daily close), NOT the
// quoteSummary summaryDetail chain fetchRfRate above uses. Switched
// 2026-07-31 after finding quoteSummary's regularMarketPrice/previousClose
// unreliable specifically for index tickers during the July 2026 KOSPI/
// Nikkei volatility: regularMarketPrice was consistently null, and
// previousClose was found stuck a full day-plus stale for both ^KS11 and
// ^N225 (verified by comparing against independent sources — Yahoo's own
// chart history had the correct up-to-date close the whole time
// quoteSummary was serving a stale one). /history returns the same closes
// the live tool's own chart already relies on, so this also keeps the
// batch snapshot internally consistent with what users see.
async function fetchIndexPrice(symbol, proxyUrl, fetchImpl = DEFAULT_FETCH) {
  try {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - 10 * 24 * 60 * 60; // 10 days back — crosses any weekend/holiday gap
    const url = `${proxyUrl.replace(/\/$/, '')}/history/${encodeURIComponent(symbol)}` +
      `?period1=${period1}&period2=${period2}`;
    const body = await fetchImpl(url);
    if (!Array.isArray(body) || !body.length) return null;
    const raw = body[body.length - 1]?.close; // ascending by date — last entry is most recent
    return (raw != null && isFinite(raw) && raw > 0) ? raw : null;
  } catch (_) {
    return null;
  }
}

module.exports = { fetchRfRate, fetchUsRf, fetchAusRf, fetchIndRf, fetchIndexPrice };
