// scripts/lib/sp500-list.js
// Pure: normalize a raw S&P 500 ticker list (comma/whitespace/newline separated)
// into de-duplicated Yahoo-form US tickers. stockanalysis.com writes class shares
// with a dot (BRK.B); Yahoo and the Worker use a dash (BRK-B). The dash form is
// ALSO required so marketParamsFor's `!ticker.includes('.')` US-detection works.
function normalizeUsTickers(raw) {
  const tokens = String(raw).split(/[\s,]+/);
  const seen = new Set();
  const out = [];
  for (const tok of tokens) {
    const t = tok.trim().toUpperCase().replace(/\./g, '-');
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

module.exports = { normalizeUsTickers };
