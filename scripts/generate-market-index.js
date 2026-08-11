// scripts/generate-market-index.js
// Build the /dcf/stocks/<market>/ hub page from that market's manifest.json
// (written incrementally by generate-ticker-page.js, one entry per ticker).
// Run after adding/updating any ticker in a market:
//   node scripts/generate-market-index.js asx

const fs = require('fs');
const path = require('path');

const { verdict } = require('./lib/verdict.js');
const { pageShell, escapeHtml, breadcrumbJsonLd, breadcrumbNav } = require('./lib/page-shell.js');

// Merges in growth-method tickers (Multi-Stage DCF/EV-Sales, a different
// repo/template -- see stock-evaluator's growth-ticker-pages-reverse-dcf
// design spec) so this page is the ONE browsable list per market, not two
// separate ones -- direct user request, 2026-08-06. Their manifest lives
// in the stock-evaluator repo, not here, so it's read from wherever it's
// reachable: a local sibling checkout when this script is run by hand on
// a dev machine where both repos sit under the same parent folder, or a
// dedicated read-only checkout the refresh-ticker-pages.yml workflow adds
// specifically for this (see that file) when running in CI. Returns []
// (not an error) if neither is present -- a plain DCF-only list is a
// legitimate degraded state, not a failure.
function readGrowthManifest(folder) {
  const candidates = [
    path.join(__dirname, '..', 'stock-evaluator-growth', 'www', 'growth', 'stocks', folder, 'manifest.json'), // CI checkout
    path.join(__dirname, '..', '..', 'StockAnalysis', 'www', 'growth', 'stocks', folder, 'manifest.json'), // local sibling checkout
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return []; }
    }
  }
  return [];
}

const MARKET_NAMES = {
  asx: { label: 'ASX 300', screenUrl: '/dcf/asx-undervalued/', screenName: 'ASX 300 Most Undervalued' },
  sp500: { label: 'S&P 500', screenUrl: '/dcf/sp500-undervalued/', screenName: 'S&P 500 Most Undervalued' },
  nifty: { label: 'NIFTY 500', screenUrl: '/dcf/nifty-undervalued/', screenName: 'NIFTY 500 Most Undervalued' },
  kospi: { label: 'KOSPI 200', screenUrl: '/dcf/kospi-undervalued/', screenName: 'KOSPI 200 Most Undervalued' },
  nikkei: { label: 'Nikkei 225', screenUrl: '/dcf/nikkei-undervalued/', screenName: 'Nikkei 225 Most Undervalued' },
  // Shared catch-all bucket (renamed from Europe-only 2026-08-11) — starts
  // with Europe tickers, will grow to include other non-dedicated markets
  // (China A-shares, Hong Kong, etc.) over time. No single screenUrl/
  // screenName represents the whole bucket once it's not Europe-only, so
  // this index page doesn't cross-link to a specific undervalued screen —
  // individual ticker pages still link to the right one per-ticker (see
  // marketMeta() in lib/ticker-page.js).
  other: { label: 'Other Markets', screenUrl: null, screenName: null },
};

function generateMarketIndex(folder) {
  if (!folder || !MARKET_NAMES[folder]) {
    throw new Error(`Unknown market folder "${folder}" — expected one of ${Object.keys(MARKET_NAMES).join(', ')}`);
  }
  const meta = MARKET_NAMES[folder];
  const dir = path.join(__dirname, '..', 'www', 'stocks', folder);
  const manifestFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    throw new Error(`No manifest.json in ${dir} — generate at least one ticker first.`);
  }
  const dcfManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const growthManifest = readGrowthManifest(folder);

  // Normalize both manifest shapes down to just what this list's rows need
  // -- DCF entries carry a single `intrinsic` field, growth entries carry
  // `intrinsicDcf`/`intrinsicEvSales` instead, but neither is rendered on
  // this list (only ticker/name/verdict), so no reconciliation needed
  // beyond the URL prefix, which genuinely differs per template.
  const combined = [
    ...dcfManifest.map(e => ({ ticker: e.ticker, name: e.name, slug: e.slug, marginOfSafety: e.marginOfSafety, href: `/dcf/stocks/${folder}/${e.slug}/` })),
    ...growthManifest.map(e => ({ ticker: e.ticker, name: e.name, slug: e.slug, marginOfSafety: e.marginOfSafety, href: `/growth/stocks/${folder}/${e.slug}/` })),
  ];
  const manifest = combined; // downstream code (freshness line, counts) reads `manifest`
  const sorted = [...combined].sort((a, b) => (a.name || a.ticker).localeCompare(b.name || b.ticker));

  // Book-index layout: group alphabetically by first letter of company name
  // (falling back to ticker for the rare entry with no name), with a letter
  // header before each group and an A-Z jump nav above the whole list.
  // Non-letter leaders (a name starting with a digit or symbol) collect under
  // "#", matching how a printed index handles the same case.
  const firstLetterOf = (e) => {
    const c = (e.name || e.ticker || '').trim().charAt(0).toUpperCase();
    return /[A-Z]/.test(c) ? c : '#';
  };
  const ALPHABET = ['#', ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))];
  const present = new Set(sorted.map(firstLetterOf));

  const alphabetNav = ALPHABET.filter(l => present.has(l)).length
    ? `<nav class="stock-list-alpha" aria-label="Jump to letter">${ALPHABET.map(l =>
        present.has(l) ? `<a href="#letter-${l === '#' ? 'sym' : l}">${l}</a>` : `<span>${l}</span>`
      ).join('')}</nav>`
    : '';

  // Dot colour and label both come from the one shared verdict() — they used to
  // be two separate local functions and had drifted to different bands, so a row
  // could show a green dot next to a "Fairly Valued" label.
  let currentLetter = null;
  const rows = sorted.map(e => {
    const v = verdict(e.marginOfSafety);
    const letter = firstLetterOf(e);
    const header = letter !== currentLetter
      ? (currentLetter = letter, `<h3 class="stock-list-letter" id="letter-${letter === '#' ? 'sym' : letter}">${letter}</h3>`)
      : '';
    return `${header}
        <a class="stock-list-item" href="${e.href}">
          <span class="verdict-dot" style="background:${v.dot}"></span>
          <span class="sl-name">${escapeHtml(e.name || e.ticker)}</span>
          <span class="sl-meta">${escapeHtml(e.ticker)} &middot; ${v.text}</span>
        </a>`;
  }).join('');

  const canonical = `https://kashvector.com/dcf/stocks/${folder}/`;
  const crumbs = [
    { name: 'DCF Valuation', path: '/dcf/', url: 'https://kashvector.com/dcf/' },
    { name: 'Stocks', path: '/dcf/stocks/', url: 'https://kashvector.com/dcf/stocks/' },
    { name: meta.label, path: canonical, url: canonical },
  ];

  const mainHtml = `    <p class="ticker-freshness"><span class="dot"></span>${manifest.length} ${escapeHtml(meta.label)} stock${manifest.length === 1 ? '' : 's'} valued so far &middot; see the <a href="${meta.screenUrl}">${escapeHtml(meta.screenName)}</a> ranking screen for the current top 20</p>

    <section class="other-tickers">
      <h2>All ${escapeHtml(meta.label)} stocks</h2>
      ${alphabetNav}
      <div class="stock-list">${rows}
      </div>
    </section>

    <section class="tool-info">
      <div class="tool-about">
        <h2>About these pages</h2>
        <p>Each ${escapeHtml(meta.label)} stock listed here has its own free valuation page, computed mechanically from Yahoo Finance data. Most use DCF or DDM (intrinsic value, margin of safety, bear/base/bull scenarios); genuine negative-cashflow growth companies instead use a Multi-Stage DCF and EV/Sales model that also shows what growth rate the current price already implies. Each page is a point-in-time snapshot and shows the date it was computed. Not financial advice.</p>
      </div>
    </section>`;

  const html = pageShell({
    title: `${meta.label} Stock Valuations — DCF & DDM Intrinsic Value | KashVector`,
    description: `Free DCF, DDM & growth-stock valuation pages for ${meta.label} stocks — ${manifest.length} companies valued so far. Free, no sign-up.`,
    canonical,
    h1: `${meta.label} Stock Valuations`,
    subtitle: 'DCF &amp; DDM intrinsic value, one page per stock',
    jsonLd: [breadcrumbJsonLd(crumbs)],
    breadcrumbHtml: breadcrumbNav(crumbs),
    mainHtml,
  });

  const outFile = path.join(dir, 'index.html');
  fs.writeFileSync(outFile, html);
  console.log(`Wrote ${outFile} (${manifest.length} tickers)`);
}

function main() {
  const folder = process.argv[2];
  try {
    generateMarketIndex(folder);
  } catch (err) {
    console.error(err.message);
    console.error('Usage: node scripts/generate-market-index.js <asx|sp500|nifty|kospi|nikkei|other>');
    process.exit(1);
  }
}

module.exports = { generateMarketIndex };

if (require.main === module) main();
