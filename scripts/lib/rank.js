// scripts/lib/rank.js
// Pure: filter out junk, keep undervalued, sort by margin of safety desc,
// cap implausible margins, take top N, assign ranks.
function rankRows(rows, { topN = 10, maxMargin = 1.5 } = {}) {
  const kept = rows.filter(r =>
    !r.excluded &&
    r.intrinsic != null &&
    r.marginOfSafety != null &&
    r.marginOfSafety > 0 &&            // undervalued only
    r.marginOfSafety <= maxMargin &&   // drop implausible (likely one-off-inflated FCF)
    (r.method === 'DDM' || r.fcfMethod === 'reported' || r.fcfMethod === 'derived') // drop rough proxy FCF
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
    if (r.excluded || r.intrinsic == null || r.marginOfSafety == null) { unvaluable++; continue; }
    if (r.marginOfSafety <= 0) { overvalued++; continue; }            // not undervalued
    if (r.marginOfSafety > maxMargin) { capped++; continue; }         // implausible margin
    const realFcf = (r.method === 'DDM' || r.fcfMethod === 'reported' || r.fcfMethod === 'derived');
    if (!realFcf) { proxyDropped++; continue; }                       // rough proxy FCF
    kept++;
  }
  return { evaluated: rows.length, unvaluable, overvalued, capped, proxyDropped, kept };
}

module.exports = { rankRows, rankFunnel };
