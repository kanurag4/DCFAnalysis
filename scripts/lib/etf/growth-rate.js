// scripts/lib/etf/growth-rate.js — pure.
// The ETF radar's forward-growth input for a holding's DCF. Originally a
// standalone multi-year revenue/FCF CAGR (shipped 2026-09-01, the fix that
// tamed the first run's UNH/ASIA blow-ups) -- re-aligned 2026-09-02:
// lookThroughGrowth() now delegates to the shared www/utils.js
// deriveMultiYearGrowth(), which is a superset of what this file used to do
// alone -- it adds Damodaran's fundamental growth (retention x ROE) as the
// primary signal, with this file's original multi-year CAGR technique now
// serving as the shared function's own cross-check. Every DCF consumer (live
// tool, Watchlist, the 6 screens, ticker pages, and this radar) shares one
// implementation instead of a sixth standalone copy.
//
// seriesCagr/oneYearFallback below are kept as this file's own local
// implementations (not re-exported from utils.js) because they're more
// permissive about input shape (bare-number arrays, not just {date,value}
// objects -- see the tests) and nothing in production code calls them
// directly anymore (only lookThroughGrowth, via run-etf-radar.js) -- they're
// kept for their own test coverage's sake, not because anything still
// depends on their exact behavior downstream.
const { deriveMultiYearGrowth } = require('../../../www/utils.js');

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

// Growth rate for the look-through DCF -- already clamped to [-0.05, 0.15]
// by the shared deriveMultiYearGrowth (previously this returned a raw,
// unclamped value and left clamping to the caller; the shared function
// clamps internally for every consumer, this one included, so a caller no
// longer needs to remember to).
function lookThroughGrowth(data) {
  if (!data) return 0.05;
  return deriveMultiYearGrowth(data);
}

module.exports = { lookThroughGrowth, seriesCagr, oneYearFallback };
