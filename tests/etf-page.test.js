const { test } = require('node:test');
const assert = require('node:assert/strict');
const { renderEtfPage, fmtPremium } = require('../scripts/lib/etf/etf-page.js');

const fund = {
  slug: 'hack', name: 'Betashares Global Cybersecurity ETF', theme: 'Cybersecurity', fee: 0.0067,
  listings: [{ ticker: 'HACK.AX', currency: 'AUD' }], holdingsAsOf: '2026-08-31',
  lookThroughMos: -0.363, coverage: 0.94, ranked: true, holdingsCount: 43,
  valued: [
    { yahoo: 'PANW', name: 'Palo Alto Networks', weight: 0.096, mos: -0.50, method: 'DCF' },
    { yahoo: 'OKTA', name: 'Okta', weight: 0.035, mos: 0.51, method: 'DCF' },
  ],
  unvalued: [{ yahoo: 'XYZ', name: 'Foo', weight: 0.03, reason: 'unvaluable' }],
  cheapest: { yahoo: 'OKTA', mos: 0.51 }, priciest: { yahoo: 'PANW', mos: -0.50 },
  sisters: [{ slug: 'bug', overlap: 0.44 }],
  sectorMix: [{ name: 'Information Technology', weight: 0.88 }, { name: 'Industrials', weight: 0.12 }],
  countryMix: [{ name: 'United States', weight: 0.9 }, { name: 'France', weight: 0.1 }],
};

test('fmtPremium sign convention', () => {
  assert.equal(fmtPremium(-0.363), '36% above');
  assert.equal(fmtPremium(0.08), '8% below');
  assert.equal(fmtPremium(0), 'in line with');
});

test('detail page: ticker-page shell, summary stats, valuation, holdings, breakdown, sisters', () => {
  const { html, canonical } = renderEtfPage(fund, {
    snapshotPrices: { 'HACK.AX': { price: 17.84, currency: 'AUD' } },
    tickerPageIndex: { PANW: '/dcf/stocks/sp500/panw/' },
    asAt: '2026-09-01', rankLine: '8th of 22',
    sisterMeta: { bug: { name: 'Global X Cybersecurity ETF', fee: 0.005, lookThroughMos: -0.21 } },
  });
  assert.ok(canonical.endsWith('/dcf/etfs/hack/'));
  assert.match(html, /class="summary"/);                    // ticker-page section
  assert.match(html, /<span class="symbol">HACK\.AX<\/span>/);
  assert.match(html, /class="stats"/);
  assert.match(html, /36(\.3)?% above/i);                    // headline measurement
  assert.match(html, /AUD 11\.36/);                          // implied fair value 17.84 * (1 - 0.363)
  assert.match(html, /94% of fund weight/i);
  assert.match(html, /8th of 22 thematic ETFs/i);
  assert.match(html, /Palo Alto Networks/);
  assert.match(html, /<a href="\/dcf\/stocks\/sp500\/panw\/" data-kv-ticker="PANW">Palo Alto Networks<\/a>/);
  assert.match(html, /<span data-kv-ticker="OKTA">Okta<\/span>/); // no baked page yet — kv-ticker-links.js links it client-side
  assert.match(html, /By sector/);
  assert.match(html, /Information Technology/);
  assert.match(html, /Sister ETFs/i);
  assert.doesNotMatch(html, /\bOvervalued\b|\bUndervalued\b/);
});

test('a sub-70% fund omits the headline number but still renders the page', () => {
  const { html } = renderEtfPage({ ...fund, ranked: false, coverage: 0.52 }, {
    snapshotPrices: {}, tickerPageIndex: {}, asAt: '2026-09-01', rankLine: null,
    sisterMeta: { bug: { name: 'Global X Cybersecurity ETF' } },
  });
  assert.match(html, /can value only 52% of this fund/i);
  assert.doesNotMatch(html, /holdings collectively trade\s*<strong>36% above/);
  assert.match(html, /Sister ETFs/i);
});

test('a sister with no published page (no sisterMeta) is not linked', () => {
  const { html } = renderEtfPage(fund, { snapshotPrices: {}, tickerPageIndex: {}, asAt: '2026-09-01', sisterMeta: {} });
  assert.doesNotMatch(html, /Sister ETFs/i);   // the only sister ('bug') has no meta -> dropped
});

test('holding with no baked ticker page renders as a data-kv-ticker span (client-linked later)', () => {
  const { html } = renderEtfPage(fund, { tickerPageIndex: {}, asAt: '2026-09-01' });
  assert.match(html, /<td><span data-kv-ticker="PANW">Palo Alto Networks<\/span><\/td>/);
  assert.doesNotMatch(html, /<a href="\/dcf\/stocks/); // nothing in the index -> no baked links
});

test('a holding row with no yahoo symbol is plain text, no span', () => {
  const f = { ...fund, valued: [{ name: 'Mystery Co', weight: 0.05, mos: -0.1, method: 'DCF' }] };
  const { html } = renderEtfPage(f, { tickerPageIndex: {}, asAt: '2026-09-01' });
  assert.match(html, /<td>Mystery Co<\/td>/);
});
