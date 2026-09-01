// scripts/lib/etf/overlap.js — pure. Weight-overlap between two funds:
// how much of each fund is literally the same positions, by weight.

function weightOverlap(holdingsA, holdingsB) {
  const b = new Map(holdingsB.map(h => [h.yahoo, h.weight || 0]));
  let sum = 0;
  for (const h of holdingsA) {
    const bw = b.get(h.yahoo);
    if (bw != null) sum += Math.min(h.weight || 0, bw);
  }
  return sum;
}

function sistersFor(slug, allFunds, { threshold = 0.30, cap = 5 } = {}) {
  const self = allFunds.find(f => f.slug === slug);
  if (!self) return [];
  return allFunds
    .filter(f => f.slug !== slug && Array.isArray(f.holdings) && f.holdings.length)
    .map(f => ({ slug: f.slug, overlap: weightOverlap(self.holdings, f.holdings) }))
    .filter(x => x.overlap >= threshold)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, cap);
}

module.exports = { weightOverlap, sistersFor };
