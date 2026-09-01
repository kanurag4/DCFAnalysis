// scripts/lib/etf/etf-page.js — per-fund detail page generator for the ETF
// radar. Pure/CPU-only; consumes one element of runEtfRadar().funds. Uses the
// shared page shell + the per-ticker-SEO-page design language (.summary /
// .stats / .synopsis / .tool-info). No verdict pill — the look-through number
// is a measurement.
const { pageShell, escapeHtml, breadcrumbJsonLd, breadcrumbNav } = require('../page-shell.js');

const pct = (x, dp = 0) => (x == null || !Number.isFinite(x) ? '—' : `${(x * 100).toFixed(dp)}%`);

// Look-through number as a measurement, never a verdict. negative mos = holdings
// trade ABOVE combined intrinsic value (premium); positive = BELOW (discount).
function fmtPremium(mos) {
  if (mos == null || !Number.isFinite(mos)) return '—';
  const mag = Math.round(Math.abs(mos) * 100);
  if (mag === 0) return 'in line with';
  return mos < 0 ? `${mag}% above` : `${mag}% below`;
}
function fmtMos(mos) {
  if (mos == null || !Number.isFinite(mos)) return '—';
  const p = (mos * 100).toFixed(0);
  if (mos < 0) return `${p}% (premium)`;
  if (mos > 0) return `+${p}% (discount)`;
  return '0%';
}
const money = (p) => (p && Number.isFinite(p.price)
  ? `${p.currency ? escapeHtml(p.currency) + ' ' : ''}${p.price.toFixed(2)}` : '—');

function holdingCell(row, tickerPageIndex) {
  const href = tickerPageIndex && tickerPageIndex[row.yahoo];
  const label = escapeHtml(row.name || row.yahoo);
  return href ? `<a href="${escapeHtml(href)}">${label}</a>` : label;
}

function mixList(mix, n = 8) {
  const top = (mix || []).slice(0, n);
  if (!top.length) return '';
  return `<ul class="etf-mix">${top.map(m => `<li>
      <span class="etf-mix-bar" style="width:${Math.max(2, Math.round(m.weight * 100))}%"></span>
      <span class="etf-mix-label">${escapeHtml(m.name)}</span>
      <span class="etf-mix-pct">${pct(m.weight, 1)}</span>
    </li>`).join('')}</ul>`;
}

function renderEtfPage(fund, { snapshotPrices = {}, tickerPageIndex = {}, asAt, rankLine, sisterMeta = {} } = {}) {
  const slug = fund.slug;
  const canonical = `https://kashvector.com/dcf/etfs/${slug}/`;
  const name = escapeHtml(fund.name);
  const theme = escapeHtml(fund.theme || '');
  const valued = fund.valued || [];
  const unvalued = fund.unvalued || [];
  const holdingsCount = fund.holdingsCount != null ? fund.holdingsCount : (valued.length + unvalued.length);
  const listings = fund.listings || [];
  const primary = listings[0] || {};
  const primaryPrice = snapshotPrices[primary.ticker] || null;
  const fairValue = (primaryPrice && Number.isFinite(primaryPrice.price) && Number.isFinite(fund.lookThroughMos))
    ? { price: primaryPrice.price * (1 + fund.lookThroughMos), currency: primaryPrice.currency } : null;

  const crumbs = [
    { name: 'Home', url: 'https://kashvector.com/', path: '/' },
    { name: 'Thematic ETF Radar', url: 'https://kashvector.com/dcf/etf-radar/', path: '/dcf/etf-radar/' },
    { name: fund.name, url: canonical, path: `/dcf/etfs/${slug}/` },
  ];

  // ── summary: symbol line + stat grid ───────────────────────────────────
  const priceStats = listings.map(l => {
    const p = snapshotPrices[l.ticker];
    return `<div class="stat"><div class="stat-label">${escapeHtml(l.ticker)}</div><div class="stat-value">${money(p)}</div></div>`;
  }).join('\n');
  const summaryHtml = `
    <section class="summary">
      <h2>${name} <span class="symbol">${escapeHtml(primary.ticker || slug.toUpperCase())}</span></h2>
      <p class="sector">${theme}${fund.holdingsAsOf ? ` · holdings as at ${escapeHtml(fund.holdingsAsOf)}` : ''}</p>
      <div class="stats">
        ${priceStats}
        <div class="stat"><div class="stat-label">Implied fair value</div><div class="stat-value">${money(fairValue)}</div></div>
        <div class="stat"><div class="stat-label">vs intrinsic value</div><div class="stat-value">${fmtMos(fund.lookThroughMos)}</div></div>
        <div class="stat"><div class="stat-label">Coverage</div><div class="stat-value">${pct(fund.coverage)}</div></div>
        <div class="stat"><div class="stat-label">Management fee</div><div class="stat-value">${pct(fund.fee, 2)}</div></div>
        <div class="stat"><div class="stat-label">Holdings</div><div class="stat-value">${holdingsCount}</div></div>
      </div>
    </section>`;

  // ── valuation callout ──────────────────────────────────────────────────
  const headlineHtml = fund.ranked
    ? `<p class="etf-headline">${name}'s holdings collectively trade
         <strong>${fmtPremium(fund.lookThroughMos)}</strong> their combined intrinsic value${fairValue
        ? ` — an implied fair value of about <strong>${money(fairValue)}</strong> versus ${money(primaryPrice)} today` : ''}.</p>`
    : `<p class="etf-headline">We can value only ${pct(fund.coverage)} of this fund by weight — below the 70%
         threshold — so no single look-through figure is published for it.</p>`;
  const coverageLine = `<p class="etf-sub">Based on ${valued.length} of ${holdingsCount} valued holdings, ${pct(fund.coverage)} of fund weight${
    unvalued.length ? `; ${unvalued.length} unvalued` : ''}.${
    rankLine ? ` <a href="/dcf/etf-radar/">${escapeHtml(rankLine)} thematic ETFs by look-through value</a>.` : ''}</p>`;
  const nameFor = (y) => { const h = valued.find(v => v.yahoo === y); return escapeHtml(h ? (h.name || y) : y); };
  const calloutsHtml = (fund.cheapest || fund.priciest) ? `
    <div class="etf-callouts">
      ${fund.priciest ? `<div class="etf-callout neg"><span class="etf-callout-label">Priciest holding</span>
        <span class="etf-callout-name">${nameFor(fund.priciest.yahoo)}</span><span>${fmtMos(fund.priciest.mos)}</span></div>` : ''}
      ${fund.cheapest ? `<div class="etf-callout pos"><span class="etf-callout-label">Cheapest holding</span>
        <span class="etf-callout-name">${nameFor(fund.cheapest.yahoo)}</span><span>${fmtMos(fund.cheapest.mos)}</span></div>` : ''}
    </div>` : '';
  const valuationHtml = `
    <section class="etf-valuation">
      <h2>Look-through valuation</h2>
      ${headlineHtml}
      ${coverageLine}
      ${calloutsHtml}
    </section>`;

  // ── holdings table (top 15) ────────────────────────────────────────────
  const top = valued.slice(0, 15);
  const rest = valued.slice(15);
  let restLine = '';
  if (rest.length) {
    const rw = rest.reduce((a, r) => a + (r.weight || 0), 0);
    const rm = rw > 0 ? rest.reduce((a, r) => a + (r.weight || 0) * r.mos, 0) / rw : null;
    restLine = `<p class="etf-sub">Remaining ${rest.length} valued holdings (${pct(rw)} of fund) collectively trade ${fmtPremium(rm)} their combined intrinsic value.</p>`;
  }
  const holdingsHtml = valued.length ? `
    <section class="etf-holdings">
      <h2>Holdings we can value <span class="etf-note">top ${top.length} by weight</span></h2>
      <div class="table-scroll">
        <table class="etf-holdings-table">
          <thead><tr><th>Weight</th><th>Holding</th><th>Model</th><th class="num">vs intrinsic value</th></tr></thead>
          <tbody>${top.map(r => `<tr>
            <td>${pct(r.weight, 1)}</td>
            <td>${holdingCell(r, tickerPageIndex)}</td>
            <td>${escapeHtml(r.method || '')}</td>
            <td class="num ${r.mos < 0 ? 'neg' : 'pos'}">${fmtMos(r.mos)}</td>
          </tr>`).join('\n')}</tbody>
        </table>
      </div>
      ${restLine}
    </section>` : '';

  // ── sector / country mix ───────────────────────────────────────────────
  const mixHtml = (fund.sectorMix && fund.sectorMix.length) || (fund.countryMix && fund.countryMix.length) ? `
    <section class="etf-breakdown">
      <h2>What the fund holds</h2>
      <div class="etf-breakdown-grid">
        ${fund.sectorMix && fund.sectorMix.length ? `<div><h3>By sector</h3>${mixList(fund.sectorMix)}</div>` : ''}
        ${fund.countryMix && fund.countryMix.length ? `<div><h3>By country</h3>${mixList(fund.countryMix)}</div>` : ''}
      </div>
      <p class="etf-note">From the issuer's published holdings file.</p>
    </section>` : '';

  // ── sisters ────────────────────────────────────────────────────────────
  const sisters = fund.sisters || [];
  const sisterHtml = sisters.length ? `
    <section class="etf-sisters">
      <h2>Sister ETFs <span class="etf-note">≥30% holdings overlap</span></h2>
      <div class="etf-sister-grid">${sisters.map(s => {
    const m = sisterMeta[s.slug] || {};
    return `<a class="etf-sister-card" href="/dcf/etfs/${escapeHtml(s.slug)}/">
        <span class="etf-sister-name">${escapeHtml(m.name || s.slug)}</span>
        <span class="etf-note">${pct(s.overlap)} holdings overlap${m.fee != null ? ` · fee ${pct(m.fee, 2)}` : ''}</span>
        <span class="etf-note">${m.lookThroughMos != null ? `holdings trade ${fmtPremium(m.lookThroughMos)} intrinsic value` : 'look-through value —'}</span>
      </a>`;
  }).join('\n')}</div>
    </section>` : '';

  // ── synopsis + methodology + FAQ ───────────────────────────────────────
  const synopsisHtml = `
    <section class="synopsis">
      <h2>About ${name}</h2>
      <p>${name} is a thematic ETF tracking ${theme ? `the ${theme.toLowerCase()} theme` : 'a thematic index'},
         holding ${holdingsCount} positions. This page values what the fund actually holds — a look-through
         discounted cash flow of every underlying company, weighted by fund weight — refreshed monthly.
         The management fee shown is the issuer's stated cost.</p>
      <p class="src">Holdings from the issuer's published file; prices and fundamentals from Yahoo Finance. General information only.</p>
    </section>`;

  const toolInfoHtml = `
    <section class="tool-info">
      <div class="tool-about">
        <h2>How this is calculated</h2>
        <p>Each holding is valued with the same engine behind KashVector's <a href="/dcf/">DCF tool</a> and
           its undervalued screens — a conservative 5-year discounted cash flow, or a dividend / excess-return
           model for banks, insurers and regulated utilities, or an EV/Sales comparison for a small tail the
           cash-flow models can't value. Where the DCF needs a forward growth rate we use the <em>slower</em>
           of a holding's multi-year revenue trend and its multi-year free-cash-flow trend, so one distorted
           year at one company can't skew the fund's number. Each holding's premium or discount to its own
           intrinsic value is weighted by fund weight and summed.</p>
        <p><strong>Read this as a measurement, not a verdict.</strong> The 5-year DCF is deliberately
           conservative on growth, so a premium is partly the model's own caution. Fast-growing and
           AI-exposed holdings in particular can read as heavily overvalued because a short-horizon cash-flow
           model can't capture a genuine platform shift or growth that currently shows up as investment
           rather than free cash flow. A fund can also trade above a conservative intrinsic value for years
           while compounding. A point-in-time snapshot as at ${escapeHtml(asAt || fund.holdingsAsOf || '')},
           highly sensitive to assumptions. Not financial advice.</p>
      </div>
      <div class="tool-faq">
        <h2>Frequently asked questions</h2>
        <details class="faq-item"><summary>Does ${name} trade above or below the value of what it holds?</summary>
          <p>${fund.ranked
    ? `As at ${escapeHtml(asAt || '')}, its holdings collectively trade ${fmtPremium(fund.lookThroughMos)} their combined intrinsic value, over ${pct(fund.coverage)} of fund weight. A mechanical measurement, not advice.`
    : `We can currently value only ${pct(fund.coverage)} of this fund by weight — below our 70% threshold — so no single look-through figure is published.`}</p>
        </details>
        <details class="faq-item"><summary>Does a premium mean I should sell?</summary>
          <p>No. Nothing here is financial advice and it is never a buy, sell or hold call. A theme can trade
             above a conservative intrinsic value for a long time while still compounding.</p>
        </details>
        <details class="faq-item"><summary>Why do the tech / AI holdings read as so overvalued?</summary>
          <p>A 5-year discounted cash flow can't price a genuine platform shift, and it penalises companies
             whose growth currently shows up as capital investment rather than free cash flow. It reflects
             the model's limitation as much as the price.</p>
        </details>
        <details class="faq-item"><summary>How often is this updated?</summary>
          <p>Monthly. Holdings come from the issuer's published full-holdings file; prices and fundamentals
             are a monthly snapshot from Yahoo Finance, not a live feed.</p>
        </details>
      </div>
    </section>`;

  const jsonLd = [
    breadcrumbJsonLd(crumbs),
    JSON.stringify({ '@context': 'https://schema.org', '@type': 'InvestmentFund', name: fund.name, description: `Look-through valuation of ${fund.name} (${fund.theme}).`, url: canonical }),
    JSON.stringify({
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: [
        { '@type': 'Question', name: `Does ${fund.name} trade above or below the value of what it holds?`, acceptedAnswer: { '@type': 'Answer', text: fund.ranked ? `Its holdings collectively trade ${fmtPremium(fund.lookThroughMos)} their combined intrinsic value as at ${asAt || ''}, over ${pct(fund.coverage)} of fund weight. A mechanical measurement, not advice.` : `Coverage is below 70% of fund weight, so no single look-through figure is published.` } },
        { '@type': 'Question', name: 'Does a premium mean I should sell?', acceptedAnswer: { '@type': 'Answer', text: 'No. Nothing here is financial advice and it is never a buy, sell or hold call. A theme can trade above a conservative intrinsic value for a long time while still compounding.' } },
      ],
    }),
  ];

  const mainHtml = `
    <div class="etf-page">
      ${synopsisHtml}
      ${summaryHtml}
      ${valuationHtml}
      ${holdingsHtml}
      ${mixHtml}
      ${sisterHtml}
      ${toolInfoHtml}
    </div>`;

  const html = pageShell({
    title: `${fund.name} (${primary.ticker || slug.toUpperCase()}) — Look-Through Valuation | KashVector`,
    description: fund.ranked
      ? `${fund.name}'s holdings collectively trade ${fmtPremium(fund.lookThroughMos)} their combined intrinsic value (${pct(fund.coverage)} coverage, as at ${asAt || ''}). A monthly look-through DCF. Free, no sign-up.`
      : `Look-through holdings analysis of ${fund.name}. ${pct(fund.coverage)} of fund weight valued. Free, no sign-up.`,
    canonical,
    h1: `${fund.name} (${primary.ticker || slug.toUpperCase()})`,
    subtitle: `Look-through valuation · ${fund.theme || ''}`,
    jsonLd,
    breadcrumbHtml: breadcrumbNav(crumbs),
    mainHtml,
  });

  return { slug, html, canonical };
}

module.exports = { renderEtfPage, fmtPremium, fmtMos };
