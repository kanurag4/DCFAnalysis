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
// (~4 years). A series needs >= 3 non-null points spanning >= 2 years to count —
// otherwise, and when there's no history at all, it falls back to
// min(1-year revenueGrowth, 1-year earningsGrowth), then 0.05. The caller still
// applies the engine's [-0.05, 0.25] clamp.
//
// Known limitation: an endpoint CAGR (not a regression slope) shares the
// single-year failure mode when the distortion sits at an endpoint. The
// min(rev, fcf) pick + the engine clamp bound the damage; a least-squares slope
// would be more robust and is a reasonable future change.

// CAGR between the first and last *positive* points of a [{date,value}] (or
// [{value}]) series. Returns null unless there are >= `minPoints` non-null
// points spanning >= `minYears` — a 2-point series is just a 1-year rate, which
// isn't the "multi-year trend" lookThroughGrowth() advertises. The span comes
// from the dates when present (so interior gap years don't shrink it), else the
// point count.
function seriesCagr(series, { minPoints = 3, minYears = 2 } = {}) {
  const pts = (Array.isArray(series) ? series : [])
    .map(e => (e && typeof e === 'object' ? e : { value: e }))
    .filter(e => e.value != null && Number.isFinite(e.value));
  if (pts.length < minPoints) return null;
  const first = pts[0], last = pts[pts.length - 1];
  if (!(first.value > 0) || !(last.value > 0)) return null;  // sign flips make CAGR meaningless
  const yr = (d) => (/^\d{4}/.test(String(d || '')) ? Number(String(d).slice(0, 4)) : null);
  const y0 = yr(first.date), y1 = yr(last.date);
  // Dates present -> trust them (equal years = 0 span = reject); absent -> the
  // point count is the best guess.
  const years = (y0 != null && y1 != null) ? y1 - y0 : pts.length - 1;
  if (years < minYears) return null;
  return Math.pow(last.value / first.value, 1 / years) - 1;
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
