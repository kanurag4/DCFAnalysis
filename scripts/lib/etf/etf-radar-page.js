// scripts/lib/etf/etf-radar-page.js — the ranking page generator. Pure/CPU-only;
// consumes runEtfRadar()'s result object. No verdict pill on any fund — the
// look-through number is shown as an ordered measurement.
const { pageShell, escapeHtml, breadcrumbJsonLd, breadcrumbNav } = require('../page-shell.js');
const { fmtMos } = require('./etf-page.js');

const pct = (x, dp = 0) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(dp)}%`);
const firstTicker = (f) => (f.listings && f.listings[0] && f.listings[0].ticker) || f.slug.toUpperCase();

function renderRadarPage(result, { asAt } = {}) {
  const canonical = 'https://kashvector.com/dcf/etf-radar/';
  const when = escapeHtml(asAt || result.asAt || '');
  const { ranked = [], unranked = [], notValued = [] } = result.rankings || {};

  const crumbs = [
    { name: 'Home', url: 'https://kashvector.com/', path: '/' },
    { name: 'Thematic ETF Radar', url: canonical, path: '/dcf/etf-radar/' },
  ];

  const rows = ranked.map(f => `<tr>
      <td>${f.rank}</td>
      <td><a href="/dcf/etfs/${escapeHtml(f.slug)}/">${escapeHtml(f.name)}</a>
          <span class="etf-note">${escapeHtml(firstTicker(f))}</span></td>
      <td>${escapeHtml(f.theme || '')}</td>
      <td class="${f.lookThroughMos < 0 ? 'etf-premium' : 'etf-discount'}">${fmtMos(f.lookThroughMos)}</td>
      <td>${pct(f.coverage)}</td>
      <td>${pct(f.fee, 2)}</td>
      <td>${f.holdingsCount != null ? f.holdingsCount : '—'}</td>
    </tr>`).join('\n');

  const tableHtml = ranked.length ? `
    <div class="etf-radar-table-wrap">
      <table class="etf-radar-table">
        <thead><tr>
          <th title="Ordered by look-through value — most below combined intrinsic value first">#</th>
          <th>ETF</th>
          <th>Theme</th>
          <th title="Fund-weighted premium or discount of the holdings to their own combined intrinsic value. Negative = holdings trade above intrinsic (a premium); positive = below (a discount).">vs intrinsic value</th>
          <th title="Share of fund weight we can put a valuation on. A fund is ranked only above 70%.">Coverage</th>
          <th title="Stated management fee">Fee</th>
          <th title="Number of holdings we could value">Holdings</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : '<p>No funds ranked this cycle.</p>';

  const unrankedHtml = unranked.length ? `
    <section class="etf-radar-block">
      <h2>Insufficient coverage to rank</h2>
      <p>We can value less than 70% of these funds by weight, so they get a detail page but no ranked row.</p>
      <ul>${unranked.map(f => `<li><a href="/dcf/etfs/${escapeHtml(f.slug)}/">${escapeHtml(f.name)}</a>
        (${escapeHtml(firstTicker(f))}) — ${escapeHtml(f.theme || '')} — we can value ${pct(f.coverage)} of this fund</li>`).join('\n')}</ul>
    </section>` : '';

  const notValuedHtml = notValued.length ? `
    <section class="etf-radar-block">
      <h2>Not valued</h2>
      <p>These funds hold crypto assets — there is no cash-flow basis for a look-through valuation.</p>
      <ul>${notValued.map(f => `<li><a href="/dcf/etfs/${escapeHtml(f.slug)}/">${escapeHtml(f.name)}</a>
        (${escapeHtml(firstTicker(f))}) — ${escapeHtml(f.theme || '')}</li>`).join('\n')}</ul>
    </section>` : '';

  const methodologyHtml = `
    <section class="etf-methodology" id="methodology">
      <h2>How this ranking is built</h2>
      <p>Thematic ETFs are theme-constrained — they can't rotate out of an expensive theme the way a
         broad index fund self-cleanses — so a point-in-time look-through valuation actually has teeth.
         For each fund we value every underlying holding with the same engine behind KashVector's
         <a href="/dcf/">DCF tool</a> and valuation screens (a conservative 5-year DCF; a dividend or
         excess-return model for banks, insurers and regulated utilities; an EV/Sales comparison for a
         small tail the cash-flow models reject), weight each holding's premium or discount by its fund
         weight, and sum.</p>
      <p>Funds are ordered by that look-through number, descending — the fund whose holdings sit furthest
         <em>below</em> their combined intrinsic value first. A fund is ranked only when the holdings we
         can value cover at least 70% of its weight. Crypto funds are listed separately with no figure.</p>
      <p class="etf-disclaimer"><strong>Mechanical model output, not a judgement on any fund or its
         management.</strong> Highly sensitive to assumptions; a point-in-time snapshot as at ${when}.
         Not financial advice, and never a recommendation to buy, hold or sell.</p>
    </section>

    <section class="tool-info">
      <div class="tool-about">
        <h2>About this page</h2>
        <p>A monthly look-through valuation of thematic ETFs — ASX-listed and marquee US-listed. Holdings
           come from each issuer's published full-holdings file; prices and fundamentals from Yahoo Finance.
           Updated ${when}.</p>
      </div>
      <div class="tool-faq">
        <h2>Frequently asked questions</h2>
        <details class="faq-item"><summary>What does the "vs intrinsic value" number mean?</summary>
          <p>It is the fund-weighted average premium or discount of the fund's holdings to their own
             combined intrinsic value. A negative number means the holdings collectively trade above what
             the models say they are worth (a premium); a positive number means below (a discount).</p>
        </details>
        <details class="faq-item"><summary>Why only thematic ETFs, not VAS or IVV?</summary>
          <p>Broad market-cap index funds reconstitute — they drop what gets expensive — so a look-through
             verdict on them has little predictive value. Thematic funds can't do that, which is what makes
             the measurement meaningful.</p>
        </details>
      </div>
    </section>`;

  const jsonLd = [
    breadcrumbJsonLd(crumbs),
    JSON.stringify({
      '@context': 'https://schema.org', '@type': 'WebPage',
      name: 'Thematic ETF Valuation Radar',
      description: 'A monthly look-through DCF ranking of thematic ETFs by how their holdings trade versus combined intrinsic value.',
      url: canonical,
    }),
    JSON.stringify({
      '@context': 'https://schema.org', '@type': 'ItemList',
      itemListElement: ranked.map(f => ({
        '@type': 'ListItem', position: f.rank, name: f.name,
        url: `https://kashvector.com/dcf/etfs/${f.slug}/`,
      })),
    }),
    JSON.stringify({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: [{
        '@type': 'Question', name: 'What does the look-through valuation number mean?',
        acceptedAnswer: {
          '@type': 'Answer',
          text: 'The fund-weighted average premium or discount of a thematic ETF’s holdings to their own combined intrinsic value. Negative = the holdings trade above intrinsic value (a premium); positive = below (a discount).',
        },
      }],
    }),
  ];

  const mainHtml = `
    <div class="etf-radar">
      <p class="etf-radar-intro">Which investment themes are trading above the intrinsic value of what they
         actually hold? For each thematic ETF below we value every underlying holding, weight by fund weight,
         and show the combined premium or discount. <a href="#methodology">How this works</a>.</p>
      ${tableHtml}
      ${unrankedHtml}
      ${notValuedHtml}
      ${methodologyHtml}
    </div>`;

  const html = pageShell({
    title: 'Thematic ETF Valuation Radar — Which Themes Trade Above Intrinsic Value? | KashVector',
    description: 'A monthly look-through DCF ranking of thematic ETFs: we value each fund’s underlying holdings, weight by fund weight, and rank by premium or discount to combined intrinsic value. Free, no sign-up.',
    canonical,
    h1: 'Thematic ETF Valuation Radar',
    subtitle: 'Monthly look-through valuation',
    jsonLd,
    breadcrumbHtml: breadcrumbNav(crumbs),
    mainHtml,
  });

  return { html, canonical };
}

module.exports = { renderRadarPage };
