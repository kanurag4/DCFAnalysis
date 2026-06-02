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

module.exports = { rankRows };
