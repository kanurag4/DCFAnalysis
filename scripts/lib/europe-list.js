// scripts/lib/europe-list.js
// Pure: normalize a raw eurozone+UK ticker list (comma/whitespace/newline
// separated, already Yahoo-suffixed by whatever source it's pasted from) into
// de-duplicated, validated tickers. Unlike sp500-list.js (single exchange),
// this list spans 11 exchanges -- the validation step exists specifically to
// catch a non-eurozone/UK ticker (e.g. a Swiss .SW name) slipping in from a
// broader "STOXX Europe" source list, since the screen's scope is deliberately
// narrower than that real index (see the design spec's "EU scope" decision).
const IN_SCOPE_SUFFIXES = ['.DE', '.PA', '.AS', '.MI', '.MC', '.BR', '.LS', '.VI', '.HE', '.IR', '.L'];

function normalizeEuropeTickers(raw) {
  const tokens = String(raw).split(/[\s,]+/);
  const seen = new Set();
  const out = [];
  for (const tok of tokens) {
    const t = tok.trim().toUpperCase();
    if (!t) continue;
    if (seen.has(t)) continue;
    if (!IN_SCOPE_SUFFIXES.some(sfx => t.endsWith(sfx))) {
      console.warn(`Dropping out-of-scope ticker: ${t} (no recognised eurozone/UK suffix)`);
      continue;
    }
    seen.add(t);
    out.push(t);
  }
  return out;
}

module.exports = { normalizeEuropeTickers, IN_SCOPE_SUFFIXES };
