// scripts/lib/etf/aggregate.js — pure.
// Per-fund look-through margin of safety + coverage %, and a crypto safety-net
// detector. Sign convention: positive mos = holding trades below intrinsic
// (discount); negative = trades above intrinsic (premium).
const CRYPTO_PROXY = new Set(['MSTR', 'COIN', 'MARA', 'RIOT', 'CLSK', 'HUT', 'BITF', 'BTBT']);

function aggregateFund(holdings, valuations, { coverageGate = 0.70 } = {}) {
  const resolvedWeight = holdings.reduce((a, h) => a + (h.weight || 0), 0);
  const valued = [], unvalued = [];
  for (const h of holdings) {
    const v = valuations[h.yahoo];
    if (v && Number.isFinite(v.mos)) {
      valued.push({ yahoo: h.yahoo, name: h.name, weight: h.weight || 0, mos: v.mos, method: v.method });
    } else {
      unvalued.push({ yahoo: h.yahoo, name: h.name, weight: h.weight || 0,
        reason: v && v.quoteType === 'CRYPTO' ? 'crypto' : (v && v.reason) || 'unvaluable' });
    }
  }
  const valuedWeight = valued.reduce((a, h) => a + h.weight, 0);
  const lookThroughMos = valuedWeight > 0
    ? valued.reduce((a, h) => a + h.weight * h.mos, 0) / valuedWeight : null;
  const coverage = resolvedWeight > 0 ? valuedWeight / resolvedWeight : 0;
  const byMos = [...valued].sort((a, b) => a.mos - b.mos);
  return {
    lookThroughMos, coverage, valuedWeight, resolvedWeight,
    valued: valued.sort((a, b) => b.weight - a.weight),
    unvalued,
    cheapest: byMos.length ? { yahoo: byMos[byMos.length - 1].yahoo, mos: byMos[byMos.length - 1].mos } : null,
    priciest: byMos.length ? { yahoo: byMos[0].yahoo, mos: byMos[0].mos } : null,
    ranked: coverage >= coverageGate,
  };
}

function detectCrypto(holdings, valuations, { cryptoWeightThreshold = 0.30 } = {}) {
  let w = 0;
  for (const h of holdings) {
    const v = valuations[h.yahoo];
    if ((v && v.quoteType === 'CRYPTO') || CRYPTO_PROXY.has(h.yahoo)) w += h.weight || 0;
  }
  return w > cryptoWeightThreshold;
}

module.exports = { aggregateFund, detectCrypto, CRYPTO_PROXY };
