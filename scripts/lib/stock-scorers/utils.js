// Null-safety helpers. DOM-free — safe to reuse in native.

function safe(v) {
  return (v != null && isFinite(v)) ? v : null;
}

function fmt(v, decimals = 1, suffix = '', prefix = '') {
  const s = safe(v);
  return s !== null ? `${prefix}${s.toFixed(decimals)}${suffix}` : 'N/A';
}

// Banks, insurers and asset managers have structurally high D/E that has
// nothing to do with quality. Detect them from Yahoo's sector field so the
// scorers can skip D/E thresholds.
function isFinancialSector(sector) {
  if (!sector || typeof sector !== 'string') return false;
  return /financial/i.test(sector);
}

// Tally a results array while respecting the `skipped` flag.
function tally(results) {
  const scored = results.filter(r => !r.skipped);
  return {
    totalScore: scored.filter(r => r.pass).length,
    maxScore: scored.length,
  };
}

// "Updated d Mon" label for a screen-pill's rankings.json asAt date.
function formatUpdatedDate(asAt, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(asAt || ''));
  if (!m) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const year = +m[1], month = +m[2], day = +m[3];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let label = `Updated ${day} ${months[month - 1]}`;
  if (year !== now.getFullYear()) label += ` ${year}`;
  return label;
}

// Combined Buffett+Dalio+Graham gauge verdict. Deliberately ABSOLUTE
// thresholds (13/8 points), not ratio-based — matches the live tool and
// the "Value investing scale" card on per-ticker SEO pages (see
// Kashvector.md), which both rely on the score always meaning the same
// point value whether or not D/E was skipped for a financial-sector
// ticker (max 17 instead of 20).
function combinedVerdict(combinedScore, maxCombined) {
  const cls = combinedScore >= 13 ? 'good' : combinedScore >= 8 ? 'ok' : 'bad';
  const verdict = combinedScore >= 13 ? 'Strong Fit' : combinedScore >= 8 ? 'Partial Fit' : 'Poor Fit';
  return { verdict, cls };
}

// Per-framework RAG class from its own score/max ratio (Buffett/Dalio/
// Graham each individually) — >=66% good (green), >=33% ok (amber),
// else bad (red). Same ratio-based thresholds as the Scorer Contract's
// verdict bands (CLAUDE.md), just expressed as a CSS class instead of a
// verdict string, since app.js/the native shell renderers both need to
// color a per-framework card by this same rule.
function cardClass(score, max) {
  var ratio = max > 0 ? score / max : 0;
  if (ratio >= 0.66) return 'good';
  if (ratio >= 0.33) return 'ok';
  return 'bad';
}

if (typeof module !== 'undefined') {
  module.exports = { safe, fmt, isFinancialSector, tally, formatUpdatedDate, combinedVerdict, cardClass };
}
