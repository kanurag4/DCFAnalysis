// scripts/lib/etf/growth-rate.js — pure.
// The ETF radar's forward-growth input for a holding's DCF. Deliberately more
// conservative + more robust than the shared engine's deriveBaseGrowth(), which
// averages Yahoo's 1-year revenueGrowth + earningsGrowth: a single distorted
// year (an earnings bounce off a litigation-crushed base — UNH showed +61%
// "earnings growth" that way) then drives a 25%-capped growth assumption for a
// mature mega-cap and blows up the fund's look-through average.
//
// Instead: the SLOWER of the multi-year revenue CAGR and the multi-year
// free-cash-flow CAGR over whatever annual history Yahoo's /timeseries returns
// (~4 years). Falls back to min(1-year revenueGrowth, 1-year earningsGrowth),
// then to 0.05, when there isn't enough history. The caller still applies the
// engine's [-0.05, 0.25] clamp.

// CAGR between the first and last *positive* endpoints of a [{date,value}] (or
// [{value}]) series. Null when there aren't two positive endpoints to span.
function seriesCagr(series) {
  const v = (Array.isArray(series) ? series : []).map(e => (e && typeof e === 'object' ? e.value : e))
    .filter(x => x != null && Number.isFinite(x));
  if (v.length < 2) return null;
  const first = v[0], last = v[v.length - 1], years = v.length - 1;
  if (!(first > 0) || !(last > 0)) return null;      // sign flips make CAGR meaningless
  return Math.pow(last / first, 1 / years) - 1;
}

function oneYearFallback(data) {
  const y = [data.revenueGrowth, data.earningsGrowth].filter(x => x != null && Number.isFinite(x));
  return y.length ? Math.min(...y) : 0.05;
}

// Raw (un-clamped) growth rate for the look-through DCF. The caller clamps.
function lookThroughGrowth(data) {
  if (!data) return 0.05;
  const revC = seriesCagr(data.annualRevenueHistory);
  const fcfC = seriesCagr(data.annualFcfHistory);
  const multi = [revC, fcfC].filter(x => x != null);
  if (multi.length) return Math.min(...multi);
  return oneYearFallback(data);
}

module.exports = { lookThroughGrowth, seriesCagr, oneYearFallback };
