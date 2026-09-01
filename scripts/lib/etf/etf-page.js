// scripts/lib/etf/etf-page.js — per-fund detail page generator for the ETF
// radar. Pure/CPU-only: consumes one element of runEtfRadar().funds plus a
// snapshot-price map + a ticker-page URL index. No network.
const { pageShell, escapeHtml, breadcrumbJsonLd, breadcrumbNav } = require('../page-shell.js');

const pct = (x, dp = 0) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(dp)}%`);

// Look-through number as a measurement, never a verdict pill. Sign convention:
// negative mos = holdings trade ABOVE combined intrinsic value (a premium);
// positive = BELOW (a discount).
function fmtPremium(mos) {
  if (mos == null || !Number.isFinite(mos)) return '—';
  const mag = Math.round(Math.abs(mos) * 100);
  if (mag === 0) return 'in line with';
  return mos < 0 ? `${mag}% above` : `${mag}% below`;
}

// Per-holding premium/discount for the table cell.
function fmtMos(mos) {
  if (mos == null || !Number.isFinite(mos)) return '—';
  const p = (mos * 100).toFixed(0);
  if (mos < 0) return `${p}% (premium)`;
  if (mos > 0) return `+${p}% (discount)`;
  return '0%';
}

function holdingCell(row, tickerPageIndex) {
  const href = tickerPageIndex && tickerPageIndex[row.yahoo];
  const label = escapeHtml(row.name || row.yahoo);
  return href ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
}

function listingPrices(fund, snapshotPrices) {
  const parts = [];
  for (const l of fund.listings || []) {
    const p = snapshotPrices && snapshotPrices[l.ticker];
    if (p && Number.isFinite(p.price)) {
      parts.push(`${escapeHtml(l.ticker)} ${p.currency ? escapeHtml(p.currency) + ' ' : ''}${p.price.toFixed(2)}`);
    } else {
      parts.push(escapeHtml(l.ticker));
    }
  }
  return parts.join(' · ');
}

function renderEtfPage(fund, { snapshotPrices = {}, tickerPageIndex = {}, asAt, rankLine, sisterMeta = {} } = {}) {
  const slug = fund.slug;
  const canonical = `https://kashvector.com/dcf/etfs/${slug}/`;
  const name = escapeHtml(fund.name);
  const theme = escapeHtml(fund.theme || '');
  const valued = fund.valued || [];
  const unvalued = fund.unvalued || [];
  const holdingsCount = fund.holdingsCount != null ? fund.holdingsCount : (valued.length + unvalued.length);

  const crumbs = [
    { name: 'Home', url: 'https://kashvector.com/', path: '/' },
    { name: 'Thematic ETF Radar', url: 'https://kashvector.com/dcf/etf-radar/', path: '/dcf/etf-radar/' },
    { name: fund.name, url: canonical, path: `/dcf/etfs/${slug}/` },
  ];

  // ── headline ────────────────────────────────────────────────────────────
  const headlineHtml = fund.ranked
    ? `<p class="etf-headline">${name}'s holdings collectively trade
         <strong>${fmtPremium(fund.lookThroughMos)}</strong> their combined intrinsic value.</p>`
    : `<p class="etf-coverage-notice">We can value only ${pct(fund.coverage)} of this fund by weight,
         so this page shows no look-through figure.</p>`;

  const coverageLine = `<p class="etf-coverage-line">Based on ${valued.length} of ${holdingsCount} holdings —
      ${pct(fund.coverage)} of fund weight.${unvalued.length ? ` ${unvalued.length} unvalued.` : ''}</p>`;

  const metaLine = `<p class="etf-meta">As at ${escapeHtml(asAt || fund.holdingsAsOf || '')}
      · fee ${pct(fund.fee, 2)} · ${listingPrices(fund, snapshotPrices)}</p>`;

  const rankLineHtml = rankLine
    ? `<p class="etf-rank-line"><a href="/dcf/etf-radar/">${escapeHtml(rankLine)} thematic ETFs by look-through value</a></p>`
    : '';

  // ── top-15 holdings table ───────────────────────────────────────────────
  const top = valued.slice(0, 15);
  const rest = valued.slice(15);
  const rows = top.map(r => `<tr>
      <td>${pct(r.weight, 1)}</td>
      <td>${holdingCell(r, tickerPageIndex)}</td>
      <td>${escapeHtml(r.method || '')}</td>
      <td class="${r.mos < 0 ? 'etf-premium' : 'etf-discount'}">${fmtMos(r.mos)}</td>
    </tr>`).join('\n');
  let restLine = '';
  if (rest.length) {
    const restW = rest.reduce((a, r) => a + (r.weight || 0), 0);
    const restMosW = rest.reduce((a, r) => a + (r.weight || 0) * r.mos, 0);
    const restMos = restW > 0 ? restMosW / restW : null;
    restLine = `<p class="etf-rest">Remaining ${rest.length} valued holdings
       (${pct(restW)} of fund) collectively trade ${fmtPremium(restMos)} their combined intrinsic value.</p>`;
  }
  const tableHtml = valued.length ? `
    <section class="etf-holdings">
      <h2>Holdings we can value <span class="etf-note">top ${top.length} by weight</span></h2>
      <table class="etf-holdings-table">
        <thead><tr><th>Weight</th><th>Holding</th><th>Model</th><th>vs intrinsic value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${restLine}
    </section>` : '';

  // ── cheapest / priciest ─────────────────────────────────────────────────
  const nameFor = (y) => {
    const hit = valued.find(v => v.yahoo === y);
    return escapeHtml(hit ? (hit.name || y) : y);
  };
  const calloutHtml = (fund.cheapest || fund.priciest) ? `
    <section class="etf-callouts">
      ${fund.priciest ? `<div class="etf-callout etf-premium"><span class="etf-callout-label">Priciest holding</span>
        <span class="etf-callout-name">${nameFor(fund.priciest.yahoo)}</span>
        <span class="etf-callout-mos">${fmtMos(fund.priciest.mos)}</span></div>` : ''}
      ${fund.cheapest ? `<div class="etf-callout etf-discount"><span class="etf-callout-label">Cheapest holding</span>
        <span class="etf-callout-name">${nameFor(fund.cheapest.yahoo)}</span>
        <span class="etf-callout-mos">${fmtMos(fund.cheapest.mos)}</span></div>` : ''}
    </section>` : '';

  // ── sister ETFs ─────────────────────────────────────────────────────────
  const sisters = fund.sisters || [];
  const sisterCards = sisters.map(s => {
    const m = sisterMeta[s.slug] || {};
    const lt = m.lookThroughMos != null
      ? `holdings trade ${fmtPremium(m.lookThroughMos)} intrinsic value`
      : 'look-through value —';
    return `<a class="etf-sister-card" href="/dcf/etfs/${escapeHtml(s.slug)}/">
        <span class="etf-sister-name">${escapeHtml(m.name || s.slug)}</span>
        <span class="etf-sister-overlap">${pct(s.overlap)} holdings overlap</span>
        ${m.fee != null ? `<span class="etf-sister-fee">fee ${pct(m.fee, 2)}</span>` : ''}
        <span class="etf-sister-lt">${lt}</span>
      </a>`;
  }).join('\n');
  const sisterHtml = sisters.length ? `
    <section class="etf-sisters">
      <h2>Sister ETFs <span class="etf-note">≥30% holdings overlap</span></h2>
      <div class="etf-sister-grid">${sisterCards}</div>
    </section>` : '';

  // ── methodology + about/FAQ ─────────────────────────────────────────────
  const methodologyHtml = `
    <section class="etf-methodology" id="methodology">
      <h2>How this is calculated</h2>
      <p>We value each of the fund's underlying holdings with the same engine behind KashVector's
         <a href="/dcf/">DCF tool</a> and its valuation screens — a conservative 5-year discounted cash flow,
         or a dividend / excess-return model for banks, insurers and regulated utilities, or an EV/Sales
         comparison for a small tail of holdings the cash-flow models can't value. Each holding's
         premium or discount to its own intrinsic value is then weighted by its fund weight and summed.</p>
      <p>Where the DCF needs a forward growth rate we use the <em>slower</em> of a holding's multi-year
         revenue trend and its multi-year free-cash-flow trend, not a single year's figure, so one
         distorted year at one company can't skew the fund's number. A fund gets a ranked look-through
         number only when the holdings we can value cover at least 70% of its weight; crypto-based funds
         get no cash-flow valuation at all.</p>
      <p class="etf-disclaimer"><strong>Read this as a measurement, not a verdict.</strong> Mechanical
         model output — not a judgement on the fund, its holdings, or its management, and never a
         recommendation to buy, hold or sell. The 5-year DCF is deliberately conservative on growth, so a
         premium is partly the model's own caution. Fast-growing and AI-exposed holdings in particular can
         read as heavily overvalued because a short-horizon cash-flow model can't capture a genuine
         platform shift or growth that currently shows up as investment rather than free cash flow. A fund
         can also trade above a conservative intrinsic value for years while compounding. A point-in-time
         snapshot as at ${escapeHtml(asAt || fund.holdingsAsOf || '')}, highly sensitive to assumptions.
         Not financial advice.</p>
    </section>

    <section class="tool-info">
      <div class="tool-about">
        <h2>About this page</h2>
        <p>${name} tracks ${theme ? `the ${theme.toLowerCase()} theme` : 'a thematic index'}. This page
           values what the fund actually holds, refreshed monthly. Fee shown is the stated management cost.
           General information only — see the methodology and cautions above.</p>
      </div>
      <div class="tool-faq">
        <h2>Frequently asked questions</h2>
        <details class="faq-item"><summary>Does ${name} trade above or below the value of what it holds?</summary>
          <p>${fund.ranked
            ? `As at ${escapeHtml(asAt || '')}, its holdings collectively trade ${fmtPremium(fund.lookThroughMos)}
               their combined intrinsic value, covering ${pct(fund.coverage)} of fund weight. A mechanical
               measurement, not advice.`
            : `We can currently value only ${pct(fund.coverage)} of this fund by weight — below our 70%
               threshold — so we don't publish a single look-through figure for it.`}</p>
        </details>
        <details class="faq-item"><summary>Does a premium mean I should sell ${escapeHtml(fund.listings && fund.listings[0] ? fund.listings[0].ticker : fund.name)}?</summary>
          <p>No. Nothing here is financial advice and it is never a buy, sell or hold call. A theme can
             trade above a conservative intrinsic value for a long time while still compounding — the
             number measures how much optimism is priced in, not when to act.</p>
        </details>
        <details class="faq-item"><summary>Why do the tech / AI holdings read as so overvalued?</summary>
          <p>A 5-year discounted cash flow can't price a genuine platform shift, and it penalises companies
             whose growth currently shows up as capital investment rather than free cash flow. That is a
             limitation of the model as much as a statement about the price.</p>
        </details>
        <details class="faq-item"><summary>How often is this updated?</summary>
          <p>Monthly. Holdings come from ${escapeHtml(fund.name.split(' ')[0])}'s published full-holdings file;
             prices and fundamentals are a monthly snapshot from Yahoo Finance, not a live feed.</p>
        </details>
      </div>
    </section>`;

  const jsonLd = [
    breadcrumbJsonLd(crumbs),
    JSON.stringify({
      '@context': 'https://schema.org', '@type': 'InvestmentFund',
      name: fund.name, description: `Look-through valuation of ${fund.name} (${fund.theme}).`,
      url: canonical,
    }),
    JSON.stringify({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question', name: `Does ${fund.name} trade above or below the value of what it holds?`,
          acceptedAnswer: {
            '@type': 'Answer',
            text: fund.ranked
              ? `Its holdings collectively trade ${fmtPremium(fund.lookThroughMos)} their combined intrinsic value as at ${asAt || ''}, over ${pct(fund.coverage)} of fund weight. A mechanical measurement, not advice.`
              : `Coverage is below 70% of fund weight, so no single look-through figure is published.`,
          },
        },
        {
          '@type': 'Question', name: 'Does a premium mean I should sell?',
          acceptedAnswer: { '@type': 'Answer', text: 'No. Nothing here is financial advice and it is never a buy, sell or hold call. A theme can trade above a conservative intrinsic value for a long time while still compounding.' },
        },
        {
          '@type': 'Question', name: 'Why do the tech and AI holdings read as heavily overvalued?',
          acceptedAnswer: { '@type': 'Answer', text: 'A 5-year discounted cash flow cannot price a genuine platform shift and it penalises companies whose growth currently shows up as capital investment rather than free cash flow. It reflects the model’s limitation as much as the price.' },
        },
      ],
    }),
  ];

  const mainHtml = `
    <div class="etf-page">
      <p class="etf-theme-tag">${theme}</p>
      ${headlineHtml}
      ${coverageLine}
      ${metaLine}
      ${rankLineHtml}
      ${calloutHtml}
      ${tableHtml}
      ${sisterHtml}
      ${methodologyHtml}
    </div>`;

  const html = pageShell({
    title: `${fund.name} — Look-Through Valuation | KashVector`,
    description: fund.ranked
      ? `${fund.name}'s holdings collectively trade ${fmtPremium(fund.lookThroughMos)} their combined intrinsic value (${pct(fund.coverage)} coverage, as at ${asAt || ''}). A monthly look-through DCF. Free, no sign-up.`
      : `Look-through holdings analysis of ${fund.name}. ${pct(fund.coverage)} of fund weight valued. Free, no sign-up.`,
    canonical,
    h1: fund.name,
    subtitle: `Look-through valuation · ${fund.theme || ''}`,
    jsonLd,
    breadcrumbHtml: breadcrumbNav(crumbs),
    mainHtml,
  });

  return { slug, html, canonical };
}

module.exports = { renderEtfPage, fmtPremium, fmtMos };
