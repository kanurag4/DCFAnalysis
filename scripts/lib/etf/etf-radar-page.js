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
  const year = String(asAt || result.asAt || '2026').slice(0, 4);
  const { ranked = [], unranked = [] } = result.rankings || {};
  const n = ranked.length;
  const title = `Thematic ETF Valuation Radar ${year} — Look-Through DCF Ranking | KashVector`;
  const desc = `Which thematic ETFs trade above the intrinsic value of what they hold? A monthly `
    + `look-through DCF of every underlying holding across ${n} funds, ranked. Free, no sign-up.`;

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

  // [question, answer]. The answer is TRUSTED HTML (may contain <a> etc.) —
  // hardcoded here, never user/issuer input (except the "are any undervalued"
  // answer below, which is generated from the live ranking so it never asserts
  // a stale premium/discount claim once a fund's sign flips). Rendered raw into
  // <p>; the JSON-LD path strips tags. An editor adding literal "&" must write
  // "&amp;".
  const undervaluedNow = ranked.filter(f => Number.isFinite(f.lookThroughMos) && f.lookThroughMos > 0);
  const closestFund = ranked[0];
  const areAnyUndervaluedAnswer = undervaluedNow.length
    ? `Yes — on this snapshot, ${undervaluedNow.map(f => escapeHtml(f.name)).join(', ')} `
      + `${undervaluedNow.length === 1 ? 'reads' : 'read'} a discount to combined intrinsic value. Most funds still `
      + `read a premium; check the ranking above for the full picture.`
    : `Not on this snapshot — every fund currently reads a premium to its combined look-through intrinsic value, `
      + `so none is undervalued today.${closestFund ? ` ${escapeHtml(closestFund.name)} is currently closest to fair value.` : ''} `
      + `Coverage and prices are updated monthly, so this can change.`;
  const faq = [
    ['Are any thematic ETFs undervalued right now?', areAnyUndervaluedAnswer],
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
    JSON.stringify({
      '@context': 'https://schema.org', '@type': 'WebApplication',
      name: 'Thematic ETF Valuation Radar', url: canonical,
      description: 'Monthly look-through DCF ranking of thematic ETFs by premium or discount to combined intrinsic value.',
      applicationCategory: 'FinanceApplication', operatingSystem: 'Web',
      dateModified: asAt || result.asAt || undefined,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'AUD' },
    }),
    JSON.stringify({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://kashvector.com/' },
        { '@type': 'ListItem', position: 2, name: 'DCF Valuation', item: 'https://kashvector.com/dcf/' },
        { '@type': 'ListItem', position: 3, name: 'Thematic ETF Valuation Radar', item: canonical },
      ],
    }),
    JSON.stringify({
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: 'Thematic ETFs ranked by look-through value',
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
  <meta property="og:image" content="https://kashvector.com/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="KashVector — free stock valuation tools">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="${escapeHtml(desc)}">
  <meta name="twitter:image" content="https://kashvector.com/og-image.png">
  <script src="/kv-theme.js"></script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Carlito:ital,wght@0,400;0,500;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/brand.css">
  <link rel="stylesheet" href="/kv-shared.css">
  <link rel="stylesheet" href="style.css">
  <link rel="icon" type="image/svg+xml" href="/dcf-icon.svg">
  <style>
    /* ETF-radar-only: the shared ranking-screen style.css never had links in
       its table cells (its screens render plain-text tickers), so #rank-table a
       and the FAQ links fall through to the browser default blue/purple. Match
       the screen's other links (--kv-accent, good contrast in both themes). */
    #rank-table a, .tool-faq a, .faq-item a { color: var(--kv-accent); text-decoration: none; }
    #rank-table a:hover, .tool-faq a:hover, .faq-item a:hover { text-decoration: underline; }
    #rank-table td .tk a { font-weight: 600; }
    .etf-radar-lede { max-width: 1340px; margin: 16px auto 0; padding: 0 16px; font-size: 0.95rem; line-height: 1.55; color: var(--kv-text); }
    .etf-radar-lede a { color: var(--kv-accent); }
    .etf-radar-h2 { max-width: 1340px; margin: 20px auto 8px; padding: 0 16px; font-size: 1.05rem; font-weight: 600; }
  </style>
${jsonLd.map(b => `  <script type="application/ld+json">${b}</script>`).join('\n')}
</head>
<body>
  <div id="kv-nav-placeholder" style="height:41px"></div>
  <script src="/kv-nav.js"></script>
  <script src="/kv-footer.js"></script>

  <header class="app-header">
    <div class="app-header-title">
      <h1><img src="/dcf-icon.svg" alt="" width="28" height="28" style="vertical-align:middle;margin-right:8px;border-radius:6px">Thematic ETF Valuation Radar</h1>
      <div class="as-at">as at <time datetime="${when}">${when}</time></div>
    </div>
    <button class="theme-toggle" onclick="window.kvTheme.toggle()" aria-label="Toggle theme"></button>
  </header>

  <main>
    <p class="etf-radar-lede">The Thematic ETF Valuation Radar values what each thematic ETF <em>actually
      holds</em> — a conservative look-through discounted cash flow of every underlying company — and
      ranks the funds by how far their holdings collectively trade above or below combined intrinsic
      value. ${n} ${n === 1 ? 'fund' : 'funds'}, refreshed monthly, snapshot ${when}. A measurement,
      never a buy/sell/hold call. <a href="#methodology">How it works, and how to read it</a>.</p>

    <h2 class="etf-radar-h2">${n} thematic ETFs ranked by look-through value</h2>

    <section class="rules-card" id="methodology">
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
      <p>🇦🇺 ASX stocks? <a href="/dcf/asx-undervalued/">Most Undervalued ASX screen &rarr;</a></p>
      <p>🇺🇸 US stocks? <a href="/dcf/sp500-undervalued/">Most Undervalued S&amp;P 500 screen &rarr;</a></p>
      <p>🇮🇳 Indian stocks? <a href="/dcf/nifty-undervalued/">Most Undervalued NIFTY 500 screen &rarr;</a></p>
      <p>🇰🇷 Korean stocks? <a href="/dcf/kospi-undervalued/">Most Undervalued KOSPI 200 screen &rarr;</a></p>
      <p>🇯🇵 Japanese stocks? <a href="/dcf/nikkei-undervalued/">Most Undervalued Nikkei 225 screen &rarr;</a></p>
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
        <p style="margin-top:12px;font-size:0.85rem;"><strong style="color:var(--kv-text)">Further reading:</strong> <a href="/articles/undervalued-etfs-radar/" style="color:var(--kv-accent);text-decoration:none;" onmouseover="this.style.color='var(--kv-accent-h)'" onmouseout="this.style.color='var(--kv-accent)'">Are any of these funds actually undervalued? The full explainer &rarr;</a></p>
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
