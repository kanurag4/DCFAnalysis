// scripts/lib/related-stocks.js
// Selects and renders the "Explore more valuations" related-stock cards
// shown on every DCF and growth per-ticker SEO page. Pure — no file I/O.
// Callers (DCFAnalysis's ticker-page.js, this repo's growth-ticker-page.js)
// build the `pool` array from whatever manifests they can reach; this module
// only does the matching and HTML rendering.
//
// Design: docs/superpowers/specs/2026-08-17-related-stocks-cards-design.md
const { verdict } = require('./verdict.js');

const MARKET_META = {
  asx: { flag: '🇦🇺', label: 'ASX' },
  sp500: { flag: '🇺🇸', label: 'S&P 500' },
  nifty: { flag: '🇮🇳', label: 'NIFTY 500' },
  kospi: { flag: '🇰🇷', label: 'KOSPI 200' },
  nikkei: { flag: '🇯🇵', label: 'Nikkei 225' },
  other: { flag: '🌐', label: 'Other Markets' },
};

const METHOD_LABELS = { DCF: 'DCF', DDM: 'DDM', ExcessReturn: 'Excess Return' };

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// current: { ticker, sector, marketCap }
// pool: Array<{ ticker, name, sector, market, method, marginOfSafety, marketCap, url }>
// Returns up to 5 candidates sorted by closest market cap, or [] if fewer
// than 3 same-sector candidates with a usable marketCap exist.
function selectRelatedStocks(current, pool) {
  const candidates = pool.filter((p) =>
    p.sector != null &&
    p.sector === current.sector &&
    p.ticker !== current.ticker &&
    typeof p.marketCap === 'number' &&
    isFinite(p.marketCap) &&
    p.marketCap > 0
  );
  if (candidates.length < 3) return [];
  return [...candidates]
    .sort((a, b) => Math.abs(a.marketCap - current.marketCap) - Math.abs(b.marketCap - current.marketCap))
    .slice(0, 5);
}

// candidates: output of selectRelatedStocks (may be []).
// opts: { browseHref, browseLabel } — the "browse all" link kept below the
// grid, and the entire fallback body when candidates is [].
// Returns an HTML fragment (no outer <section>/<h2> — the caller supplies
// those, since the heading text depends on candidates.length).
function buildRelatedStocksHtml(candidates, { browseHref, browseLabel }) {
  const browseRow = `
      <div class="ticker-chip-row">
        <a class="ticker-chip" href="${browseHref}">${browseLabel}</a>
      </div>`;

  if (candidates.length === 0) {
    return browseRow;
  }

  const sectorLabel = escapeHtml(candidates[0].sector);
  const cards = candidates.map((c) => {
    const meta = MARKET_META[c.market] || { flag: '🌐', label: c.market };
    const v = verdict(c.marginOfSafety);
    const pillCls = v.cls === 'undervalued' ? 'rsc-good' : v.cls === 'overvalued' ? 'rsc-bad' : 'rsc-ok';
    const mos = (c.marginOfSafety == null || !isFinite(c.marginOfSafety))
      ? ''
      : ` &middot; ${c.marginOfSafety >= 0 ? '+' : ''}${(c.marginOfSafety * 100).toFixed(1)}%`;
    const methodLabel = METHOD_LABELS[c.method] || escapeHtml(c.method);
    return `
          <a class="related-stock-card" href="${c.url}">
            <span class="rsc-top">${meta.flag} ${escapeHtml(meta.label)}</span>
            <span class="rsc-name">${escapeHtml(c.name)}</span>
            <span class="rsc-ticker">${escapeHtml(c.ticker)} &middot; ${methodLabel}</span>
            <span class="rsc-verdict-pill ${pillCls}">${v.text}${mos}</span>
          </a>`;
  }).join('');

  return `
      <p class="related-stocks-sub">Other ${sectorLabel} companies we've valued, across markets &mdash; ranked by closest market cap.</p>
      <div class="related-stocks-grid">${cards}
      </div>${browseRow}`;
}

module.exports = { selectRelatedStocks, buildRelatedStocksHtml, MARKET_META };
