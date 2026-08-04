// scripts/generate-market-index.js
// Build the /dcf/stocks/<market>/ hub page from that market's manifest.json
// (written incrementally by generate-ticker-page.js, one entry per ticker).
// Run after adding/updating any ticker in a market:
//   node scripts/generate-market-index.js asx

const fs = require('fs');
const path = require('path');

const MARKET_NAMES = {
  asx: { label: 'ASX 300', screenUrl: '/dcf/asx-undervalued/', screenName: 'ASX 300 Most Undervalued' },
  sp500: { label: 'S&P 500', screenUrl: '/dcf/sp500-undervalued/', screenName: 'S&P 500 Most Undervalued' },
  nifty: { label: 'NIFTY 500', screenUrl: '/dcf/nifty-undervalued/', screenName: 'NIFTY 500 Most Undervalued' },
  kospi: { label: 'KOSPI 200', screenUrl: '/dcf/kospi-undervalued/', screenName: 'KOSPI 200 Most Undervalued' },
  nikkei: { label: 'Nikkei 225', screenUrl: '/dcf/nikkei-undervalued/', screenName: 'Nikkei 225 Most Undervalued' },
  europe: { label: 'Europe', screenUrl: '/dcf/europe-undervalued/', screenName: 'Europe Most Undervalued' },
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function verdictDot(marginOfSafety) {
  if (marginOfSafety == null) return 'var(--kv-muted)';
  if (marginOfSafety >= 0.05) return 'var(--kv-pass)';
  if (marginOfSafety <= -0.05) return 'var(--kv-fail)';
  return 'var(--kv-warn)';
}
function pctSigned(v) {
  if (v == null) return 'N/A';
  return (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%';
}

function main() {
  const folder = process.argv[2];
  if (!folder || !MARKET_NAMES[folder]) {
    console.error('Usage: node scripts/generate-market-index.js <asx|sp500|nifty|kospi|nikkei|europe>');
    process.exit(1);
  }
  const meta = MARKET_NAMES[folder];
  const dir = path.join(__dirname, '..', 'www', 'stocks', folder);
  const manifestFile = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    console.error(`No manifest.json in ${dir} — generate at least one ticker first.`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

  const rows = manifest.map(e => `
        <a class="ticker-chip" href="/dcf/stocks/${folder}/${e.slug}/">
          <span class="verdict-dot" style="background:${verdictDot(e.marginOfSafety)}"></span>
          ${escapeHtml(e.ticker)} <span style="color:var(--kv-muted);font-weight:400;margin-left:4px">${pctSigned(e.marginOfSafety)}</span>
        </a>`).join('');

  const html = `<!doctype html>
<html lang="en" class="dark tool-dcf">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#0b1120">
  <title>${meta.label} Stock Valuations — DCF &amp; DDM Intrinsic Value | KashVector</title>
  <meta name="description" content="Free DCF/DDM intrinsic value pages for ${meta.label} stocks — ${manifest.length} companies valued so far, updated regularly.">
  <link rel="canonical" href="https://kashvector.com/dcf/stocks/${folder}/">
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
      <h1>${meta.label} Stock Valuations</h1>
      <p>DCF &amp; DDM intrinsic value, one page per stock</p>
    </div>
    <button class="theme-toggle" onclick="window.kvTheme.toggle()" aria-label="Toggle theme"></button>
  </header>
  <div id="kv-nav-placeholder" style="height:41px"></div>
  <script src="/kv-nav.js"></script>
  <nav class="ticker-breadcrumb"><a href="/dcf/">DCF Valuation</a><span class="sep">&rsaquo;</span><span class="current">${meta.label}</span></nav>

  <main>
    <p class="ticker-freshness"><span class="dot"></span>${manifest.length} ${meta.label} stock${manifest.length === 1 ? '' : 's'} valued so far &middot; see the <a href="${meta.screenUrl}">${meta.screenName}</a> ranking screen for the current top 20</p>

    <section class="other-tickers">
      <h2>All ${meta.label} stocks</h2>
      <div class="ticker-chip-row">${rows}
      </div>
    </section>

    <section class="tool-info">
      <div class="tool-about">
        <h2>About these pages</h2>
        <p>Each ${meta.label} stock listed here has its own free DCF or DDM valuation page — intrinsic value, margin of safety, bear/base/bull scenarios, and financial trend charts, all computed mechanically from Yahoo Finance data. Not financial advice.</p>
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

  const outFile = path.join(dir, 'index.html');
  fs.writeFileSync(outFile, html);
  console.log(`Wrote ${outFile} (${manifest.length} tickers)`);
}

main();
