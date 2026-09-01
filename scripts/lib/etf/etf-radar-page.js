// scripts/lib/etf/etf-radar-page.js — the ranking page generator.
// Pure/CPU-only; consumes runEtfRadar()'s result object. Pre-rendered (monthly
// snapshot, no live prices) but matches the "Most Undervalued <market>" screen
// design — same style.css, .app-header / .rules-card / .table-card / #rank-table
// / .tool-info / .editorial structure. No verdict pill on any fund.
const { escapeHtml } = require('../page-shell.js');
const { fmtMos } = require('./etf-page.js');

const pct = (x, dp = 0) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(dp)}%`);
const firstTicker = (f) => (f.listings && f.listings[0] && f.listings[0].ticker) || f.slug.toUpperCase();
const firstPrice = (f) => (f.snapshotPrices && f.snapshotPrices[firstTicker(f)]) || null;
const money = (p) => (p && Number.isFinite(p.price)
  ? `${p.currency ? escapeHtml(p.currency) + ' ' : ''}${p.price.toFixed(2)}` : '—');
// "Implied fair value" — where the fund would trade if its price reflected the
// combined intrinsic value of its holdings. lookThroughMos = (intrinsic − price)
// / price, so fair value = price × (1 + lookThroughMos).
const impliedFairValue = (f) => {
  const p = firstPrice(f);
  if (!p || !Number.isFinite(p.price) || !Number.isFinite(f.lookThroughMos)) return null;
  return { price: p.price * (1 + f.lookThroughMos), currency: p.currency };
};

function renderRadarPage(result, { asAt } = {}) {
  const canonical = 'https://kashvector.com/dcf/etf-radar/';
  const when = escapeHtml(asAt || result.asAt || '');
  const { ranked = [], unranked = [] } = result.rankings || {};
  const title = 'Thematic ETF Valuation Radar 2026 — Monthly Look-Through DCF | KashVector';
  const desc = 'Which thematic ETFs trade furthest above the intrinsic value of what they hold? '
    + 'A monthly look-through DCF: we value every underlying holding, weight by fund weight, and rank. Free, no sign-up.';

  const rankRow = (f) => `<tr>
      <td class="num">${f.rank}</td>
      <td><div class="tk"><a href="/dcf/etfs/${escapeHtml(f.slug)}/">${escapeHtml(f.name)}</a></div><div class="nm">${escapeHtml(firstTicker(f))}</div></td>
      <td>${escapeHtml(f.theme || '')}</td>
      <td class="num">${money(firstPrice(f))}</td>
      <td class="num fv">${money(impliedFairValue(f))}</td>
      <td class="num ${f.lookThroughMos < 0 ? 'neg' : 'pos'}">${fmtMos(f.lookThroughMos)}</td>
      <td class="num">${pct(f.coverage)}</td>
      <td class="num">${pct(f.fee, 2)}</td>
      <td class="num">${f.holdingsCount != null ? f.holdingsCount : '—'}</td>
    </tr>`;

  const tableHtml = ranked.length ? `
      <div class="table-scroll">
        <table id="rank-table">
          <thead><tr>
            <th class="num">#</th>
            <th>ETF</th>
            <th>Theme</th>
            <th class="num">Price</th>
            <th class="num">Implied fair value</th>
            <th class="num">vs intrinsic value</th>
            <th class="num">Coverage</th>
            <th class="num">Fee</th>
            <th class="num">Holdings</th>
          </tr></thead>
          <tbody>${ranked.map(rankRow).join('\n')}</tbody>
        </table>
      </div>` : '<div class="status">No funds ranked this cycle.</div>';

  const unrankedHtml = unranked.length ? `
    <section class="editorial">
      <p><strong>Insufficient coverage to rank.</strong> We can value less than 70% of these funds by
         weight this cycle, so they get a detail page but no ranked row:
         ${unranked.map(f => `<a href="/dcf/etfs/${escapeHtml(f.slug)}/">${escapeHtml(firstTicker(f))}</a>
         (${pct(f.coverage)})`).join(' · ')}.</p>
    </section>` : '';

  const faq = [
    ['What does the "vs intrinsic value" number mean?',
      'The fund-weighted average premium or discount of the fund’s holdings to their own combined intrinsic value. A negative number ("premium") means the holdings collectively trade above what the models say they are worth; a positive number ("discount") means below.'],
    ['Is this a buy list?',
      'No. Nothing here is financial advice and it is never a buy, sell or hold call. It is a measurement of how much optimism is priced into each theme — a starting point for research, not a verdict.'],
    ['Why is nearly every fund showing a premium?',
      'Partly the market, partly the method. The DCF is deliberately conservative on growth and caps it, so it systematically values fast-growing companies below their market price. An across-the-board premium in a strong market is normal and not on its own a sign of mispricing.'],
    ['Why do AI and big-tech names read as heavily overvalued?',
      'A 5-year discounted cash flow cannot price a genuine platform shift, and it penalises companies whose growth currently shows up as capital investment rather than free cash flow. Large semiconductor and cloud businesses often read as steep premiums here for that reason — it reflects the model’s known limitation as much as the price.'],
    ['How is the growth rate estimated?',
      'The slower of a holding’s multi-year revenue trend and its multi-year free-cash-flow trend (about four years of history), rather than a single year’s figure. One distorted year — an earnings rebound off a depressed base — would otherwise drive a mature company’s projection and skew the whole fund’s number.'],
    ['What is "coverage" and why does it matter?',
      'The share of a fund’s weight we could put a valuation on. The look-through number is computed over the covered portion only, so a fund at 75% coverage tells you less than one at 100%. Below 70% we publish no headline figure.'],
    ['Why thematic ETFs and not VAS or IVV?',
      'Broad market-cap index funds reconstitute — they drop what gets expensive — so a look-through verdict on them has little predictive value. Thematic funds are locked to their theme, which is what makes the measurement meaningful.'],
    ['How often is it updated?',
      'Monthly. Holdings come from each issuer’s published full-holdings file; prices and fundamentals are a monthly snapshot from Yahoo Finance, not a live feed.'],
  ];
  const faqHtml = faq.map(([q, a]) =>
    `<details class="faq-item"><summary>${escapeHtml(q)}</summary><p>${a}</p></details>`).join('\n');

  const jsonLd = [
    `{"@context":"https://schema.org","@type":"WebApplication","name":"Thematic ETF Valuation Radar","url":"${canonical}","description":"Monthly look-through DCF ranking of thematic ETFs by premium or discount to combined intrinsic value.","applicationCategory":"FinanceApplication","operatingSystem":"Web","offers":{"@type":"Offer","price":"0","priceCurrency":"AUD"}}`,
    JSON.stringify({
      '@context': 'https://schema.org', '@type': 'ItemList',
      itemListElement: ranked.map(f => ({ '@type': 'ListItem', position: f.rank, name: f.name, url: `https://kashvector.com/dcf/etfs/${f.slug}/` })),
    }),
    JSON.stringify({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a.replace(/<[^>]+>/g, '') } })),
    }),
  ];

  return {
    canonical,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="theme-color" content="#f8fafc">
  <title>${escapeHtml(title)}</title>
  <link rel="canonical" href="${canonical}">
  <meta name="description" content="${escapeHtml(desc)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(desc)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="KashVector">
  <meta name="twitter:card" content="summary">
  <script src="/kv-theme.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,500;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/brand.css">
  <link rel="stylesheet" href="/kv-shared.css">
  <link rel="stylesheet" href="style.css">
  <link rel="icon" type="image/svg+xml" href="/dcf-icon.svg">
${jsonLd.map(b => `  <script type="application/ld+json">${b}</script>`).join('\n')}
</head>
<body>
  <div id="kv-nav-placeholder" style="height:41px"></div>
  <script src="/kv-nav.js"></script>
  <script src="/kv-footer.js"></script>

  <header class="app-header">
    <div class="app-header-title">
      <h1><img src="/dcf-icon.svg" alt="" width="28" height="28" style="vertical-align:middle;margin-right:8px;border-radius:6px">Thematic ETF Valuation Radar</h1>
      <div class="as-at">as at ${when}</div>
    </div>
    <button class="theme-toggle" onclick="window.kvTheme.toggle()" aria-label="Toggle theme"></button>
  </header>

  <main>
    <section class="rules-card">
      <details class="rules-details">
        <summary class="rules-title">How this ranking works, and how to read it</summary>
        <p class="rules-intro">Thematic ETFs are theme-locked — they can’t rotate out of an expensive
          theme the way a broad index fund self-cleanses — so a point-in-time look-through valuation
          actually has teeth. For each fund we value every underlying holding, weight each holding’s
          premium or discount by its fund weight, and sum.</p>
        <ul class="rules-list">
          <li><strong>Same engine as the screens</strong> — a conservative 5-year discounted cash flow; a
            dividend or excess-return model for banks, insurers and regulated utilities; an EV/Sales
            comparison for a small tail the cash-flow models reject.</li>
          <li><strong>Conservative growth input</strong> — the slower of a holding’s multi-year revenue
            trend and its multi-year free-cash-flow trend, so one distorted year at one company can’t
            skew the fund’s number.</li>
          <li><strong>Coverage gate</strong> — a fund is ranked only when the holdings we can value cover
            at least 70% of its weight.</li>
          <li><strong>Sanity band</strong> — a single holding whose model output lands outside roughly
            −200% to +100% is treated as unvaluable (an ADR currency mismatch, a one-off-inflated cash
            flow), never blended into the average.</li>
          <li><strong>A premium is partly the model’s caution</strong> — the DCF runs deliberately bearish
            on growth, so fast-growing and AI-exposed themes will read as steep premiums here by model
            limitation, not necessarily mispricing. A theme can also trade above a conservative intrinsic
            value for years while compounding.</li>
        </ul>
      </details>
      <p class="screen-summary">Ordered by look-through value, descending — the fund whose holdings sit
        furthest <strong>below</strong> their combined intrinsic value first, the most expensive theme
        last. ${when} snapshot. Not financial advice.</p>
      <p class="rules-cta">Want to value a single stock? <a href="/dcf/">Open the DCF Valuation tool &rarr;</a></p>
    </section>

    <section class="table-card">
${tableHtml}
    </section>

    ${unrankedHtml}

    <section class="editorial cross-link">
      <p>🇺🇸 ASX stocks? <a href="/dcf/asx-undervalued/">Most Undervalued ASX screen &rarr;</a></p>
      <p>🇺🇸 US stocks? <a href="/dcf/sp500-undervalued/">Most Undervalued S&amp;P 500 screen &rarr;</a></p>
      <p>🇮🇳 Indian stocks? <a href="/dcf/nifty-undervalued/">Most Undervalued NIFTY 500 screen &rarr;</a></p>
      <p>🇪🇺 European stocks? <a href="/dcf/europe-undervalued/">Most Undervalued Europe screen &rarr;</a></p>
    </section>

    <section class="tool-info">
      <div class="tool-about">
        <h2>About this page</h2>
        <p>A monthly look-through valuation of thematic ETFs — ASX-listed and marquee US-listed. Holdings
          come from each issuer’s published full-holdings file; prices and fundamentals are a monthly
          snapshot from Yahoo Finance. The same engine powers KashVector’s
          <a href="/dcf/">DCF tool</a> and its undervalued screens.</p>
        <p><strong>Implied fair value</strong> is where a fund would trade if its price reflected the
          combined intrinsic value of its holdings — shown alongside the current price so the premium is
          concrete, not just a percentage.</p>
      </div>
      <div class="tool-faq">
        <h2>Frequently asked questions</h2>
${faqHtml}
      </div>
    </section>

    <section class="editorial">
      <p>⚠️ <strong>This is an automated measurement, not financial advice or a recommendation.</strong>
        It shows how a fund’s holdings trade versus a conservative combined DCF value — mechanical model
        output, highly sensitive to assumptions, and never a call to buy, hold or sell. It does not read
        news, judge management, or weigh competitive position or regulatory risk. Always do your own research.</p>
    </section>
  </main>

  <footer>
    <p>⚠️ Not financial advice. Valuations are estimates based on assumptions and public data; they may be wrong. Consult a licensed adviser before investing.</p>
    <p><a href="/">&larr; All KashVector tools</a></p>
  </footer>
</body>
</html>
`,
  };
}

module.exports = { renderRadarPage };
