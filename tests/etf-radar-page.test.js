const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderRadarPage } = require('../scripts/lib/etf/etf-radar-page.js');

const result = {
  asAt: '2026-09-01',
  rankings: {
    ranked: [
      { rank: 1, slug: 'ixj', name: 'iShares Global Healthcare ETF', theme: 'Global healthcare',
        lookThroughMos: 0.06, coverage: 0.91, fee: 0.0041, holdingsCount: 118, listings: [{ ticker: 'IXJ' }],
        snapshotPrices: { IXJ: { price: 104.24, currency: 'USD' } } },
      { rank: 2, slug: 'hack', name: 'Betashares Global Cybersecurity ETF', theme: 'Cybersecurity',
        lookThroughMos: -0.363, coverage: 0.94, fee: 0.0067, holdingsCount: 43, listings: [{ ticker: 'HACK.AX' }],
        snapshotPrices: { 'HACK.AX': { price: 17.84, currency: 'AUD' } } },
    ],
    unranked: [{ slug: 'xbi', name: 'iShares Biotechnology ETF', theme: 'Biotech', coverage: 0.41, listings: [{ ticker: 'XBI' }] }],
  },
};

test('ranking page: screen-style shell, ranked rows in order, price + implied fair value', () => {
  const { html, canonical } = renderRadarPage(result, { asAt: '2026-09-01' });
  assert.ok(canonical.endsWith('/dcf/etf-radar/'));
  assert.match(html, /id="rank-table"/);              // screen table id (CSS hook)
  assert.match(html, /class="rules-card"/);
  assert.match(html, /class="app-header"/);
  assert.match(html, /href="style\.css"/);            // shared ranking-screen stylesheet
  const iIxj = html.indexOf('>IXJ<'), iHack = html.indexOf('HACK.AX');
  assert.ok(iIxj > -1 && iHack > iIxj, 'IXJ row before HACK row');
  assert.match(html, /USD 104\.24/);                  // IXJ price
  assert.match(html, /USD 110\.49/);                  // IXJ implied fair value 104.24 * 1.06
  assert.match(html, /-36% \(premium\)/);
  assert.match(html, /\+6% \(discount\)/);
  assert.match(html, /insufficient coverage to rank/i);
  assert.match(html, /XBI/);
  assert.doesNotMatch(html, /\bStrong (Buy|Sell)\b|\bAvoid\b|verdict-pill/);
  // "Undervalued" only ever appears as the proper name of a sibling screen, never as a verdict on a fund
  assert.doesNotMatch(html, /ETF[^<]*\b(Overvalued|Undervalued)\b/);
  assert.doesNotMatch(html, /portfolio-hero|first seen/i);   // no paper portfolio / first-seen
  assert.doesNotMatch(html, /\bcrypto\b/i);                  // crypto not mentioned
});

test('empty ranking still renders the shell', () => {
  const { html } = renderRadarPage({ asAt: '2026-09-01', rankings: { ranked: [], unranked: [] } }, {});
  assert.match(html, /No funds ranked this cycle/i);
  assert.match(html, /class="app-header"/);
});
