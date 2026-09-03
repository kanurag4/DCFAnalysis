// scripts/lib/etf/merge-fund.js — pure. Folds one freshly-valued fund's full
// result into the existing committed etf-rankings.json, re-sorting/re-ranking,
// without needing (or touching) any other fund's valuation data. Used by
// `refresh-etf-radar.js --only=<slug>` -- the scoped single-fund path, as
// opposed to a full monthly run, which recomputes every fund and calls
// writeRadarArtifacts() directly on the complete result.
//
// `slimResult()` in run-etf-radar.js isn't reused here: it always derives
// valuedCount from a fund's `.valued` array, which the OTHER (untouched)
// funds don't carry in this flow -- only their already-slim `valuedCount`
// number does. Reusing it would silently zero that field for every fund but
// the one just run.

// existing: the current committed etf-rankings.json object ({asAt, union,
//   cryptoExcluded, ranked, unranked} -- the SLIM shape already on disk).
// targetFund: the full fund object for the just-run fund, i.e. result.funds[0]
//   from a runEtfRadar() call with injectedUniverse=[thatFund] (has .ranked,
//   .valued/.unvalued, .snapshotPrices, .sisters, etc.) -- or an object with
//   `{ slug, remove: true }` to drop a fund from the rankings entirely.
// etfsStatic: the full scripts/etfs.json array (for the OTHER funds' static
//   `listings`, needed to look up their snapshot price by ticker).
// listingPrices: a flat {ticker: {price, currency}} map covering every fund's
//   listing tickers (including the target's), for the ranking page's price
//   column -- the slim JSON doesn't carry prices, only the full objects do.
// asAt: overrides `existing.asAt` in the returned slim JSON (a scoped run
//   still refreshes every fund's listing price, so it's a genuinely fresher
//   snapshot even though only one fund's holdings/valuation were re-run).
function mergeFundIntoRankings(existing, targetFund, etfsStatic, listingPrices = {}, asAt) {
  const etfsBySlug = Object.fromEntries(etfsStatic.map(f => [f.slug, f]));
  const snapshotPricesFor = (slug) => {
    const out = {};
    for (const l of ((etfsBySlug[slug] || {}).listings || [])) {
      if (listingPrices[l.ticker]) out[l.ticker] = listingPrices[l.ticker];
    }
    return out;
  };

  const otherRanked = (existing.ranked || [])
    .filter(f => f.slug !== targetFund.slug)
    .map(f => ({ ...f, listings: (etfsBySlug[f.slug] || {}).listings || [], snapshotPrices: snapshotPricesFor(f.slug) }));
  const otherUnranked = (existing.unranked || [])
    .filter(f => f.slug !== targetFund.slug)
    .map(f => ({ ...f, listings: (etfsBySlug[f.slug] || {}).listings || [], snapshotPrices: snapshotPricesFor(f.slug) }));

  const targetIsRemoval = !!targetFund.remove;
  const targetFull = targetIsRemoval ? null : {
    ...targetFund,
    snapshotPrices: targetFund.snapshotPrices || snapshotPricesFor(targetFund.slug),
  };

  const fullRanked = [...otherRanked, ...(targetFull && targetFund.ranked ? [targetFull] : [])]
    .sort((a, b) => b.lookThroughMos - a.lookThroughMos)
    .map((f, i) => ({ ...f, rank: i + 1 }));
  const fullUnranked = [...otherUnranked, ...(targetFull && !targetFund.ranked ? [targetFull] : [])];

  const slimFund = (f) => ({
    slug: f.slug, name: f.name, theme: f.theme, fee: f.fee,
    lookThroughMos: f.lookThroughMos, coverage: f.coverage, ranked: true,
    holdingsCount: f.holdingsCount, valuedCount: f.valuedCount ?? (f.valued || []).length,
    rank: f.rank, flags: f.flags || [],
  });
  const rankingsSlim = {
    asAt: asAt || existing.asAt,
    union: existing.union,
    cryptoExcluded: existing.cryptoExcluded || [],
    ranked: fullRanked.map(slimFund),
    unranked: fullUnranked.map(f => ({ ...slimFund(f), ranked: false, rank: null })),
  };

  return { rankingsSlim, fullRanked, fullUnranked };
}

// patchFatResult — fold one freshly-valued fund's full object into the persisted
// FAT run result (scripts/_etf-result.json), the one `--pages-only` re-renders
// from. Unlike mergeFundIntoRankings (which works against the slim on-disk
// rankings), this needs the last full run's fat result as input — every OTHER
// fund keeps its full valued[]/unvalued[]/sectorMix[]/sisters so the pages can
// still be regenerated for all 15 without a fetch. Also refreshes every fund's
// snapshotPrices from the scoped run's batched /quote so the price column stays
// current. Pure; returns a new object.
//
// fatResult: the parsed scripts/_etf-result.json ({asAt, funds:[…fat],
//   union, rankings:{ranked,unranked}, cryptoExcluded}) — or null (nothing to
//   patch; caller should fall back to a full run).
// freshFund: result.funds[0] from a runEtfRadar({injectedUniverse:[thatFund]}).
// listingPrices: flat {ticker:{price,currency}} for every fund's listings.
function patchFatResult(fatResult, freshFund, listingPrices = {}, asAt) {
  if (!fatResult || !Array.isArray(fatResult.funds)) return null;
  const pricesFor = (listings) => {
    const out = {};
    for (const l of (listings || [])) if (listingPrices[l.ticker]) out[l.ticker] = listingPrices[l.ticker];
    return out;
  };
  const funds = fatResult.funds
    .filter(f => f.slug !== freshFund.slug)
    .concat([freshFund])
    .map(f => ({ ...f, snapshotPrices: pricesFor(f.listings) }));
  const ranked = funds.filter(f => f.ranked)
    .sort((a, b) => b.lookThroughMos - a.lookThroughMos)
    .map((f, i) => ({ ...f, rank: i + 1 }));
  const unranked = funds.filter(f => !f.ranked);
  return {
    ...fatResult,
    asAt: asAt || fatResult.asAt,
    funds,
    rankings: { ranked, unranked },
  };
}

module.exports = { mergeFundIntoRankings, patchFatResult };
