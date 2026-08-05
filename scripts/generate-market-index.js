// scripts/generate-market-index.js
// Build the /dcf/stocks/<market>/ hub page from that market's manifest.json
// (written incrementally by generate-ticker-page.js, one entry per ticker).
// Run after adding/updating any ticker in a market:
//   node scripts/generate-market-index.js asx

const fs = require('fs');
const path = require('path');

const { verdict } = require('./lib/verdict.js');
const { pageShell, escapeHtml, breadcrumbJsonLd, breadcrumbNav } = require('./lib/page-shell.js');

const MARKET_NAMES = {
  asx: { label: 'ASX 300', screenUrl: '/dcf/asx-undervalued/', screenName: 'ASX 300 Most Undervalued' },
  sp500: { label: 'S&P 500', screenUrl: '/dcf/sp500-undervalued/', screenName: 'S&P 500 Most Undervalued' },
  nifty: { label: 'NIFTY 500', screenUrl: '/dcf/nifty-undervalued/', screenName: 'NIFTY 500 Most Undervalued' },
  kospi: { label: 'KOSPI 200', screenUrl: '/dcf/kospi-undervalued/', screenName: 'KOSPI 200 Most Undervalued' },
  nikkei: { label: 'Nikkei 225', screenUrl: '/dcf/nikkei-undervalued/', screenName: 'Nikkei 225 Most Undervalued' },
  europe: { label: 'Europe', screenUrl: '/dcf/europe-undervalued/', screenName: 'Europe Most Undervalued' },
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
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const sorted = [...manifest].sort((a, b) => (a.name || a.ticker).localeCompare(b.name || b.ticker));

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
        <a class="stock-list-item" href="/dcf/stocks/${folder}/${e.slug}/">
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
        <p>Each ${escapeHtml(meta.label)} stock listed here has its own free DCF or DDM valuation page — intrinsic value, margin of safety, bear/base/bull scenarios, and financial trend charts, all computed mechanically from Yahoo Finance data. Each page is a point-in-time snapshot and shows the date it was computed. Not financial advice.</p>
      </div>
    </section>`;

  const html = pageShell({
    title: `${meta.label} Stock Valuations — DCF & DDM Intrinsic Value | KashVector`,
    description: `Free DCF/DDM intrinsic value pages for ${meta.label} stocks — ${manifest.length} companies valued so far. Free, no sign-up.`,
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
    console.error('Usage: node scripts/generate-market-index.js <asx|sp500|nifty|kospi|nikkei|europe>');
    process.exit(1);
  }
}

module.exports = { generateMarketIndex };

if (require.main === module) main();
