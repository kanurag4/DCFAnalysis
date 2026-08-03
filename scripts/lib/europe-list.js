// scripts/lib/europe-list.js
// Pure: normalize a raw eurozone+UK ticker list (comma/whitespace/newline
// separated, already Yahoo-suffixed by whatever source it's pasted from) into
// de-duplicated, validated tickers. Unlike sp500-list.js (single exchange),
// this list spans 11 exchanges -- the validation step exists specifically to
// catch a non-eurozone/UK ticker (e.g. a Swiss .SW name) slipping in from a
// broader "STOXX Europe" source list, since the screen's scope is deliberately
// narrower than that real index (see the design spec's "EU scope" decision).
//
// NB this validates the *venue*, not the currency: CPG.L and IHG.L are
// LSE-listed but report in USD, and MTLN.L reports in EUR. That is handled
// downstream by fx.js, which dispatches on Yahoo's reported currency.
const IN_SCOPE_SUFFIXES = ['.DE', '.PA', '.AS', '.MI', '.MC', '.BR', '.LS', '.VI', '.HE', '.IR', '.L'];

// Returns { tickers, dropped, duplicates } rather than logging. Genuinely pure --
// no console, matching sp500-list.js and the codebase's data-in/data-out rule for
// everything outside app.js. Reporting the drops back to the caller also lets
// build-europe.js print a single counted summary: a source list where 40 names
// silently vanished otherwise looks identical to a clean one, since the script
// only ever announced how many it *accepted*.
function normalizeEuropeTickers(raw) {
  const tokens = String(raw).split(/[\s,]+/);
  const seen = new Set();
  const tickers = [];
  const dropped = [];
  const duplicates = [];
  for (const tok of tokens) {
    const t = tok.trim().toUpperCase();
    if (!t) continue;
    if (seen.has(t)) { duplicates.push(t); continue; }
    if (!IN_SCOPE_SUFFIXES.some(sfx => t.endsWith(sfx))) { dropped.push(t); continue; }
    seen.add(t);
    tickers.push(t);
  }
  return { tickers, dropped, duplicates };
}

module.exports = { normalizeEuropeTickers, IN_SCOPE_SUFFIXES };
