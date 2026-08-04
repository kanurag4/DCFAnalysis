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

const MARKET_ORDER = ['asx', 'sp500', 'nifty', 'kospi', 'nikkei', 'europe'];
const MARKET_LABELS = {
  asx: 'ASX 300', sp500: 'S&P 500', nifty: 'NIFTY 500',
  kospi: 'KOSPI 200', nikkei: 'Nikkei 225', europe: 'Europe',
};
const MARKET_FLAGS = {
  asx: '🇦🇺', sp500: '🇺🇸', nifty: '🇮🇳', kospi: '🇰🇷', nikkei: '🇯🇵', europe: '🇪🇺',
};

function main() {
  const stocksDir = path.join(__dirname, '..', 'www', 'stocks');
  const live = MARKET_ORDER.filter(m => fs.existsSync(path.join(stocksDir, m, 'manifest.json')));
  if (live.length === 0) {
    console.error('No market has a manifest.json yet — generate at least one ticker first.');
    process.exit(1);
  }

  const cards = live.map(m => {
    const manifest = JSON.parse(fs.readFileSync(path.join(stocksDir, m, 'manifest.json'), 'utf8'));
    return `
      <a class="screen-pill" href="/dcf/stocks/${m}/">
        <span class="screen-pill-flag">${MARKET_FLAGS[m]}</span>
        <span class="screen-pill-label">
          <strong>${MARKET_LABELS[m]}</strong>
          <span>${manifest.length} stock${manifest.length === 1 ? '' : 's'} valued</span>
        </span>
        <span class="screen-pill-arrow">&rarr;</span>
      </a>`;
  }).join('');

  const html = `<!doctype html>
<html lang="en" class="dark tool-dcf">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0b1120">
  <title>Individual Stock Valuations by Market — Free DCF &amp; DDM | KashVector</title>
  <meta name="description" content="Browse free DCF/DDM intrinsic value pages for individual stocks, organised by market — ASX, S&P 500, NIFTY and more, updated regularly.">
  <link rel="canonical" href="https://kashvector.com/dcf/stocks/">
  <script src="/kv-theme.js"></script>
  <link rel="stylesheet" href="/brand.css">
  <link rel="stylesheet" href="/kv-shared.css">
  <link rel="stylesheet" href="/dcf/style.css">
  <link rel="icon" type="image/svg+xml" href="/dcf-icon.svg">
</head>
<body>
  <header class="app-header">
    <a href="/" class="home-logo" aria-label="All KashVector tools">
      <img src="/logo.svg" alt="KashVector" width="32" height="32">
      <span class="home-logo-label">&larr; All tools</span>
    </a>
    <div class="app-header-center">
      <h1>Individual Stock Valuations</h1>
      <p>Free DCF &amp; DDM pages, one per stock, organised by market</p>
    </div>
    <button class="theme-toggle" onclick="window.kvTheme.toggle()" aria-label="Toggle theme"></button>
  </header>
  <div id="kv-nav-placeholder" style="height:41px"></div>
  <script src="/kv-nav.js"></script>
  <nav class="ticker-breadcrumb"><a href="/dcf/">DCF Valuation</a><span class="sep">&rsaquo;</span><span class="current">Stocks</span></nav>

  <main>
    <section class="other-tickers" style="margin-top:16px">
      <h2>Browse by market</h2>
      <div class="screens-row">${cards}
      </div>
    </section>

    <section class="tool-info">
      <div class="tool-about">
        <h2>About these pages</h2>
        <p>Each stock has its own free DCF or DDM valuation page &mdash; intrinsic value, margin of safety, bear/base/bull scenarios, and financial trend charts, computed mechanically from Yahoo Finance data. More markets and tickers are added regularly. Not financial advice.</p>
      </div>
    </section>
  </main>

  <footer>
    <p class="disclaimer">General information only, not financial advice. <a href="/privacy-site.html">Privacy Policy</a></p>
    <p><a href="/">&larr; All KashVector tools</a></p>
    <p>&copy; 2026 KashVector. All rights reserved.</p>
  </footer>
</body>
</html>
`;

  const outFile = path.join(stocksDir, 'index.html');
  fs.writeFileSync(outFile, html);
  console.log(`Wrote ${outFile} (${live.length} market${live.length === 1 ? '' : 's'}: ${live.join(', ')})`);
}

main();
