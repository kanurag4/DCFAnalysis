// scripts/generate-stocks-hub.js
// Builds www/stocks/index.html — the top-level "browse by market" hub linking
// to each market's /dcf/stocks/<market>/ index page. Only lists markets that
// actually have a manifest.json (i.e. at least one generated ticker), so it
// grows automatically as more markets get their first ticker via
// generate-ticker-page.js — no manual list to maintain.
//
//   node scripts/generate-stocks-hub.js

const fs = require('fs');
const path = require('path');

const { pageShell, escapeHtml, breadcrumbJsonLd, breadcrumbNav } = require('./lib/page-shell.js');

const MARKET_ORDER = ['asx', 'sp500', 'nifty', 'kospi', 'nikkei', 'europe'];
const MARKET_LABELS = {
  asx: 'ASX 300', sp500: 'S&P 500', nifty: 'NIFTY 500',
  kospi: 'KOSPI 200', nikkei: 'Nikkei 225', europe: 'Europe',
};
const MARKET_FLAGS = {
  asx: '🇦🇺', sp500: '🇺🇸', nifty: '🇮🇳', kospi: '🇰🇷', nikkei: '🇯🇵', europe: '🇪🇺',
};

function generateStocksHub() {
  const stocksDir = path.join(__dirname, '..', 'www', 'stocks');
  const live = MARKET_ORDER.filter(m => fs.existsSync(path.join(stocksDir, m, 'manifest.json')));
  if (live.length === 0) {
    throw new Error('No market has a manifest.json yet — generate at least one ticker first.');
  }

  const cards = live.map(m => {
    const manifest = JSON.parse(fs.readFileSync(path.join(stocksDir, m, 'manifest.json'), 'utf8'));
    return `
        <a class="screen-pill" href="/dcf/stocks/${m}/">
          <span class="screen-pill-flag">${MARKET_FLAGS[m]}</span>
          <span class="screen-pill-label">
            <strong>${escapeHtml(MARKET_LABELS[m])}</strong>
            <span>${manifest.length} stock${manifest.length === 1 ? '' : 's'} valued</span>
          </span>
          <span class="screen-pill-arrow">&rarr;</span>
        </a>`;
  }).join('');

  const canonical = 'https://kashvector.com/dcf/stocks/';
  const crumbs = [
    { name: 'DCF Valuation', path: '/dcf/', url: 'https://kashvector.com/dcf/' },
    { name: 'Stocks', path: canonical, url: canonical },
  ];

  const mainHtml = `    <section class="other-tickers" style="margin-top:16px">
          <h2>Browse by market</h2>
          <div class="screens-row">${cards}
          </div>
        </section>

        <section class="tool-info">
          <div class="tool-about">
            <h2>About these pages</h2>
            <p>Each stock has its own free DCF or DDM valuation page &mdash; intrinsic value, margin of safety, bear/base/bull scenarios, and financial trend charts, computed mechanically from Yahoo Finance data. Each page is a point-in-time snapshot and shows the date it was computed. More markets and tickers are added over time. Not financial advice.</p>
          </div>
        </section>`;

  const html = pageShell({
    title: 'Individual Stock Valuations by Market — Free DCF & DDM | KashVector',
    description: 'Browse free DCF/DDM intrinsic value pages for individual stocks, organised by market — ASX, S&P 500, NIFTY and more. Free, no sign-up.',
    canonical,
    h1: 'Individual Stock Valuations',
    subtitle: 'Free DCF &amp; DDM pages, one per stock, organised by market',
    jsonLd: [breadcrumbJsonLd(crumbs)],
    breadcrumbHtml: breadcrumbNav(crumbs),
    mainHtml,
  });

  const outFile = path.join(stocksDir, 'index.html');
  fs.writeFileSync(outFile, html);
  console.log(`Wrote ${outFile} (${live.length} market${live.length === 1 ? '' : 's'}: ${live.join(', ')})`);
}

function main() {
  try {
    generateStocksHub();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

module.exports = { generateStocksHub };

if (require.main === module) main();
