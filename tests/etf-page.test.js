const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderEtfPage, fmtPremium } = require('../scripts/lib/etf/etf-page.js');

const fund = {
  slug: 'hack', name: 'Betashares Global Cybersecurity ETF', theme: 'Cybersecurity', fee: 0.0067,
  listings: [{ ticker: 'HACK.AX', currency: 'AUD' }], assetClass: 'equity',
  lookThroughMos: -0.363, coverage: 0.94, ranked: true, holdingsCount: 43,
  valued: [
    { yahoo: 'PANW', name: 'Palo Alto Networks', weight: 0.096, mos: -0.50, method: 'DCF' },
    { yahoo: 'OKTA', name: 'Okta', weight: 0.035, mos: 0.51, method: 'DCF' },
  ],
  unvalued: [{ yahoo: 'XYZ', name: 'Foo', weight: 0.03, reason: 'unvaluable' }],
  cheapest: { yahoo: 'OKTA', mos: 0.51 }, priciest: { yahoo: 'PANW', mos: -0.50 },
  sisters: [{ slug: 'bug', overlap: 0.44 }],
};

test('fmtPremium sign convention', () => {
  assert.equal(fmtPremium(-0.363), '36% above');
  assert.equal(fmtPremium(0.08), '8% below');
  assert.equal(fmtPremium(0), 'in line with');
});

test('renders a detail page with the headline measurement and a holdings table', () => {
  const { html, canonical } = renderEtfPage(fund, {
    snapshotPrices: { 'HACK.AX': { price: 12.40, currency: 'AUD' } },
    tickerPageIndex: { PANW: '/dcf/stocks/sp500/panw/' },
    asAt: '2026-09-01', rankLine: '8th of 22',
    sisterMeta: { bug: { name: 'Global X Cybersecurity ETF', fee: 0.005, lookThroughMos: -0.21 } },
  });
  assert.ok(canonical.endsWith('/dcf/etfs/hack/'));
  assert.match(html, /36(\.3)?% above/i);
  assert.match(html, /94% of fund weight/i);
  assert.match(html, /Palo Alto Networks/);
  assert.match(html, /href="\/dcf\/stocks\/sp500\/panw\/"/);
  assert.match(html, /Sister ETFs/i);
  assert.match(html, /8th of 22 thematic ETFs/i);
  assert.doesNotMatch(html, /\bOvervalued\b|\bUndervalued\b/);
});

test('a sub-70% fund omits the headline number but still renders', () => {
  const { html } = renderEtfPage({ ...fund, ranked: false, coverage: 0.52 }, {
    snapshotPrices: {}, tickerPageIndex: {}, asAt: '2026-09-01', rankLine: null,
  });
  assert.match(html, /can value only 52% of this fund/i);
  assert.doesNotMatch(html, /36% above their combined intrinsic value/);
  assert.match(html, /Sister ETFs/i);  // still renders the rest of the page
});

test('holding with no ticker page renders as plain text, not a link', () => {
  const { html } = renderEtfPage(fund, { tickerPageIndex: {}, asAt: '2026-09-01' });
  assert.match(html, /<td>Palo Alto Networks<\/td>/);
});
