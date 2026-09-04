// scripts/lib/rank.js
// Pure: filter out junk, keep undervalued, sort by margin of safety desc,
// cap implausible margins, take top N, assign ranks.

// `!= null` doesn't catch NaN (NaN != null is true in JS) -- rankRows'
// `> 0`/`<= maxMargin` comparisons happen to evaluate false for NaN and
// correctly exclude it, but rankFunnel's old `== null` guard did NOT, so a
// NaN-valued row was silently miscounted as "qualified" there while
// rankRows dropped it -- the two "same predicates" functions disagreed on a
// case neither was written to expect (evaluate.js should never emit NaN
// after its own 2026-08-22 fix, but this file's own header comment promises
// robustness independent of the caller, so it checks for real here too).
const isRankable = (r) => Number.isFinite(r.intrinsic) && Number.isFinite(r.marginOfSafety);

function rankRows(rows, { topN = 10, maxMargin = 1.5 } = {}) {
  const kept = rows.filter(r =>
    !r.excluded &&
    isRankable(r) &&
    r.marginOfSafety > 0 &&            // undervalued only
    r.marginOfSafety <= maxMargin &&   // drop implausible (likely one-off-inflated FCF)
    (r.method === 'DDM' || r.method === 'ExcessReturn' || r.fcfMethod === 'reported' || r.fcfMethod === 'derived' || r.fcfMethod === 'normalized') // drop rough proxy FCF -- 'normalized' is the deliberate multi-year cyclical-margin upgrade, not a rough guess
  );
  kept.sort((a, b) => b.marginOfSafety - a.marginOfSafety);
  return kept.slice(0, topN).map((r, i) => ({ ...r, rank: i + 1 }));
}

// Pure: categorise every evaluated row into mutually-exclusive funnel buckets,
// using the SAME predicates (and order) as rankRows so the two can't drift.
// Lets the orchestrator print why stocks were dropped each run.
function rankFunnel(rows, { maxMargin = 1.5 } = {}) {
  let unvaluable = 0, overvalued = 0, capped = 0, proxyDropped = 0, kept = 0;
  for (const r of rows) {
    if (r.excluded || !isRankable(r)) { unvaluable++; continue; }
    if (r.marginOfSafety <= 0) { overvalued++; continue; }            // not undervalued
    if (r.marginOfSafety > maxMargin) { capped++; continue; }         // implausible margin
    const realFcf = (r.method === 'DDM' || r.method === 'ExcessReturn' || r.fcfMethod === 'reported' || r.fcfMethod === 'derived' || r.fcfMethod === 'normalized');
    if (!realFcf) { proxyDropped++; continue; }                       // rough proxy FCF
    kept++;
  }
  return { evaluated: rows.length, unvaluable, overvalued, capped, proxyDropped, kept };
}

module.exports = { rankRows, rankFunnel };
