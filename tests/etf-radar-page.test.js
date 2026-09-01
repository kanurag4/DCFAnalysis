const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderRadarPage } = require('../scripts/lib/etf/etf-radar-page.js');

const result = {
  asAt: '2026-09-01',
  rankings: {
    ranked: [
      { rank: 1, slug: 'ixj', name: 'iShares Global Healthcare ETF', theme: 'Global healthcare',
        lookThroughMos: 0.06, coverage: 0.91, fee: 0.0041, holdingsCount: 118, listings: [{ ticker: 'IXJ' }] },
      { rank: 2, slug: 'hack', name: 'Betashares Global Cybersecurity ETF', theme: 'Cybersecurity',
        lookThroughMos: -0.363, coverage: 0.94, fee: 0.0067, holdingsCount: 43, listings: [{ ticker: 'HACK.AX' }] },
    ],
    unranked: [{ slug: 'xbi', name: 'iShares Biotechnology ETF', theme: 'Biotech', coverage: 0.41, listings: [{ ticker: 'XBI' }] }],
    notValued: [{ slug: 'cryp', name: 'Betashares Crypto Innovators ETF', theme: 'Crypto industry', listings: [{ ticker: 'CRYP.AX' }] }],
  },
};

test('ranking page: ranked rows in order, plus the two extra blocks', () => {
  const { html, canonical } = renderRadarPage(result, { asAt: '2026-09-01' });
  assert.ok(canonical.endsWith('/dcf/etf-radar/'));
  const iIxj = html.indexOf('>IXJ<'), iHack = html.indexOf('HACK.AX');
  assert.ok(iIxj > -1 && iHack > iIxj, 'IXJ row should come before HACK row');
  assert.match(html, /insufficient coverage to rank/i);
  assert.match(html, /XBI/);
  assert.match(html, /not valued/i);
  assert.match(html, /CRYP/);
  assert.match(html, /-36% \(premium\)/);
  assert.match(html, /\+6% \(discount\)/);
  assert.doesNotMatch(html, /\bStrong (Buy|Sell)\b|\bAvoid\b/);
  assert.doesNotMatch(html, /\bOvervalued\b|\bUndervalued\b/);
});

test('empty ranking still renders', () => {
  const { html } = renderRadarPage({ asAt: '2026-09-01', rankings: { ranked: [], unranked: [], notValued: [] } }, {});
  assert.match(html, /No funds ranked this cycle/i);
});
