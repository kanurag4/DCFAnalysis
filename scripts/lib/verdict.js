// scripts/lib/verdict.js
// Single source of truth for the per-ticker SEO pages' verdict bands.
//
// These thresholds MUST match the live DCF tool's renderScenarios()
// (www/app.js: `mos > 0.2 ? 'undervalued' : mos < -0.2 ? 'overvalued' : 'fair'`).
// They were previously hand-duplicated in generate-ticker-page.js and
// generate-market-index.js with a comment in each telling the reader to keep
// them in sync — which failed once already: the generator shipped with a ±5%
// band while the live tool used ±20%, silently mislabelling everything in the
// 5–20% range (caught during the WBC.AX review, 2026-08-04, and fixed
// retroactively across every published page). One copy now, so the two pages
// describing the same number can no longer disagree.
const BAND = 0.2;

// `label` — with the emoji, as shown on a scenario card.
// `text`  — plain words, for prose/list rows (no emoji-stripping regex needed).
// `cls`   — CSS class on .sc-mos; must exist in www/style.css.
// `dot`   — colour token for the market-index list dot.
function verdict(marginOfSafety) {
  if (marginOfSafety == null || !isFinite(marginOfSafety)) {
    return { label: 'N/A', text: 'N/A', cls: '', dot: 'var(--kv-muted)' };
  }
  if (marginOfSafety > BAND) {
    return { label: '✅ Undervalued', text: 'Undervalued', cls: 'undervalued', dot: 'var(--kv-pass)' };
  }
  if (marginOfSafety < -BAND) {
    return { label: '❌ Overvalued', text: 'Overvalued', cls: 'overvalued', dot: 'var(--kv-fail)' };
  }
  return { label: '⚠️ Fairly Valued', text: 'Fairly Valued', cls: 'fair', dot: 'var(--kv-warn)' };
}

module.exports = { verdict, BAND };
