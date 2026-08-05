// scripts/lib/refresh-report.js
// Pure diff between a market's pre-refresh manifest and a bulk refresh's
// results -- the change summary the admin console shows for review, instead
// of a 38-and-growing row table. See
// docs/superpowers/specs/2026-08-05-ticker-pages-bulk-refresh-design.md §4.4.
const { verdict } = require('./verdict.js');

const MOVERS_LIMIT = 8;

function computeRefreshSummary(oldManifestByTicker, results) {
  const skips = [];
  const flips = [];
  const movers = [];
  let written = 0;

  for (const r of results) {
    if (r.status === 'skipped') {
      skips.push({ ticker: r.ticker, market: r.market, reason: r.reason });
      continue;
    }
    written++;
    const oldEntry = oldManifestByTicker.get(r.ticker);
    const newEntry = r.entry;
    if (!oldEntry) continue; // no prior entry to diff against

    if (oldEntry.marginOfSafety != null && newEntry.marginOfSafety != null) {
      const fromText = verdict(oldEntry.marginOfSafety).text;
      const toText = verdict(newEntry.marginOfSafety).text;
      if (fromText !== toText) flips.push({ ticker: r.ticker, market: r.market, from: fromText, to: toText });
    }

    if (oldEntry.intrinsic != null && newEntry.intrinsic != null && oldEntry.intrinsic !== 0) {
      const intrinsicDeltaPct = ((newEntry.intrinsic - oldEntry.intrinsic) / Math.abs(oldEntry.intrinsic)) * 100;
      movers.push({ ticker: r.ticker, market: r.market, intrinsicDeltaPct });
    }
  }

  movers.sort((a, b) => Math.abs(b.intrinsicDeltaPct) - Math.abs(a.intrinsicDeltaPct));

  return {
    total: results.length,
    written,
    skipped: skips.length,
    skips,
    flips,
    movers: movers.slice(0, MOVERS_LIMIT),
  };
}

module.exports = { computeRefreshSummary, MOVERS_LIMIT };
