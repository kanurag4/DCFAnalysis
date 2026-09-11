// scripts/lib/rf.js
// IO: fetch a market 10-yr govt-bond / treasury yield via the Worker proxy and
// return it as a DECIMAL rate. Reads the /history chart endpoint's last daily
// close (same approach as fetchIndexPrice below), NOT quoteSummary's
// summaryDetail chain. The quoted value is the yield in percent (^TNX 4.25 ->
// 0.0425; ^GSBG10.AX 4.80 -> 0.048), so we divide by 100. Clamped to a
// plausible band; otherwise the documented per-market fallback is returned
// (matches the live tool's silent fallback). fetchImpl is injectable for
// testing.
//
// Switched from quoteSummary to /history 2026-09-11 -- found live during a
// global bond selloff that quoteSummary's previousClose for ^TNX was stuck at
// 4.837 (a day-plus stale) while /history's actual last close was 4.944, a
// ~10bp gap that baked a stale "live" US rf into that day's ticker pages. This
// is the exact same class of bug fetchIndexPrice was already fixed for
// (index-type tickers, quoteSummary unreliable) on 2026-07-31 -- that fix was
// never applied to this sibling function. www/dcf/app.js's
// fetchAndSetRiskFreeRate() had the identical bug, fixed the same way.
const { batchHeaders } = require('./batch-auth.js');
// FALLBACK_RF.us/.aus/.ind, used below as this file's own live-fetch fallback values,
// used to be a fourth hand-copied version of the same numbers (found 2026-09-06, see
// docs/risk-free-rates.md) -- IND_DEFAULT_SPREAD stays a local constant deliberately:
// assumptions.js's FALLBACK_RF_META has no machine-readable spread field (only a
// free-text `source` string), and restructuring that is a bigger, separate change than
// this consolidation's scope.
const { FALLBACK_RF } = require('../../www/calc/assumptions.js');

const DEFAULT_FETCH = async (url) => {
  const res = await fetch(url, { headers: batchHeaders() });
  if (!res || !res.ok) return null;
  return res.json();
};

async function fetchRfRate(symbol, fallback, { proxyUrl, fetchImpl = DEFAULT_FETCH } = {}) {
  let raw = null;
  try {
    const period2 = Math.floor(Date.now() / 1000);
    const period1 = period2 - 10 * 24 * 60 * 60; // 10 days back — crosses any weekend/holiday gap
    const url = `${proxyUrl.replace(/\/$/, '')}/history/${encodeURIComponent(symbol)}` +
      `?period1=${period1}&period2=${period2}`;
    const body = await fetchImpl(url);
    if (Array.isArray(body) && body.length) {
      raw = body[body.length - 1]?.close; // ascending by date — last entry is most recent
    }
  } catch (_) {
    raw = null;
  }
  const pct = (raw != null && isFinite(raw)) ? raw / 100 : null;
  return (pct && pct > 0 && pct < 0.15) ? pct : fallback;
}

// Fallbacks corrected 2026-09-02 (were 0.045/0.048) -- ^GSBG10.AX has been silently
// 404ing (confirmed live), so fetchAusRf's fallback is what actually feeds every batch
// consumer of this function. Same three-copy sync issue as market.js/assumptions.js's
// FALLBACK_RF/app.js's inline defaults -- see docs/TODO.md P6.
const fetchUsRf  = (proxyUrl) => fetchRfRate('^TNX',        FALLBACK_RF.us,  { proxyUrl });
const fetchAusRf = (proxyUrl) => fetchRfRate('^GSBG10.AX',  FALLBACK_RF.aus, { proxyUrl });

// India's ^INBMKG10.NS is the raw 10-yr G-Sec yield, which double-counts country risk
// the same way the batch's static market.js fallback used to (erp already carries
// India's country risk premium) — see the 2026-08-15 rf/terminal-growth fix. Fixed here
// too, separately, because this live fetch OVERRIDES market.js's spread-adjusted static
// fallback whenever it succeeds (marketParamsFor's `live.indRf ?? 0.049` only falls
// through to the static value when live.indRf is null/undefined) -- missed in the
// original pass, which only touched market.js's fallback and the live DCF tool's
// app.js, not this batch-only live-fetch path. Pass `null` as fetchRfRate's own
// fallback so a failed/out-of-band fetch is distinguishable from a real value: on
// failure, return the already-spread-adjusted static default directly (0.0509) rather
// than subtracting the spread from it a second time.
const IND_DEFAULT_SPREAD = 0.0187; // Damodaran Jan 2026, Baa3 rating -- keep in sync with
                                    // www/app.js's IND_DEFAULT_SPREAD_PCT (percentage units there)
async function fetchIndRf(proxyUrl, opts = {}) {
  const raw = await fetchRfRate('^INBMKG10.NS', null, { proxyUrl, ...opts });
  if (raw == null) return FALLBACK_RF.ind; // fetch failed or out of plausible band -- see docs/risk-free-rates.md for the current value's sourcing
  return Math.max(0.01, raw - IND_DEFAULT_SPREAD);
}

// Fetch a raw equity index level (points, not a rate — no ÷100, no clamping).
//
// Uses the /history chart endpoint (last available daily close) -- fetchRfRate
// above now uses the same approach, switched 2026-09-11 for the same reason.
// This function switched first, 2026-07-31, after finding quoteSummary's
// regularMarketPrice/previousClose
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

// Fetch an FX rate via the Worker proxy — same raw-quote chain as fetchRfRate
// (previousClose -> regularMarketPrice -> currentPrice) but WITHOUT the /100
// scaling (that's specific to percentage yields) and a plausibility band suited
// to an FX rate rather than a bond yield. Used only by the Europe screen's
// paper-portfolio rebalance (scripts/lib/fx.js) -- never by ranking or
// valuation, which stay currency-agnostic.
//
// Returns null (NOT a fallback) when the fetch fails or the value is
// implausible. Returning a plausible-looking fallback here was a real bug: it
// got persisted into rankings.json indistinguishably from a live quote, then
// read back as the *previous* run's rate on the next refresh, fabricating a
// permanent phantom FX move across half the portfolio. Provenance is the
// caller's to decide -- see fetchFxRates.
async function fetchFxRate(symbol, { proxyUrl, fetchImpl = DEFAULT_FETCH, min = 0.5, max = 2 } = {}) {
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
  return (raw != null && isFinite(raw) && raw > min && raw < max) ? raw : null;
}

// Every non-EUR currency present in the Europe universe, as EUR per 1 unit.
// GBp (pence) is handled by fx.js as GBP/100 -- it needs no rate of its own.
// USD is here because CPG.L and IHG.L are LSE-listed but report in USD
// (verified 2026-08-03); without it they were silently pooled as if EUR.
// Plausibility bands are wide enough to survive years of drift but tight
// enough to reject a garbage quote.
const EUR_FX_SYMBOLS = {
  GBP: { symbol: 'GBPEUR=X', fallback: 1.17, min: 0.5, max: 2 },
  USD: { symbol: 'USDEUR=X', fallback: 0.92, min: 0.5, max: 2 },
};

// Fetch every rate the Europe screen needs. Returns
// `{ rates: { GBP, USD }, source: 'live' | 'partial' | 'fallback', missing: [...] }`.
//
// `source` is persisted alongside the rates so the next run can tell a real
// quote from a stand-in. A run whose rates are not fully live must NOT be
// compared against a different run's rates (see updatePortfolio) -- doing so
// invents currency moves that never happened.
async function fetchEurFxRates(proxyUrl) {
  const rates = {};
  const missing = [];
  for (const [currency, cfg] of Object.entries(EUR_FX_SYMBOLS)) {
    const live = await fetchFxRate(cfg.symbol, { proxyUrl, min: cfg.min, max: cfg.max });
    if (live != null) {
      rates[currency] = live;
    } else {
      rates[currency] = cfg.fallback;
      missing.push(currency);
    }
  }
  const source = missing.length === 0 ? 'live'
    : missing.length === Object.keys(EUR_FX_SYMBOLS).length ? 'fallback'
    : 'partial';
  return { rates, source, missing };
}

module.exports = { fetchRfRate, fetchUsRf, fetchAusRf, fetchIndRf, fetchIndexPrice, fetchFxRate, fetchEurFxRates };
