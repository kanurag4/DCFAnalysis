const { test } = require('node:test');
const assert = require('node:assert/strict');
const { resolveYahooSymbol, resolveHoldings } = require('../scripts/lib/etf/resolve.js');

test('bare US ticker resolves unchanged', () => {
  assert.equal(resolveYahooSymbol({ rawSymbol: 'PANW', country: 'United States' }, {}), 'PANW');
});

test('country name maps to the Yahoo suffix', () => {
  assert.equal(resolveYahooSymbol({ rawSymbol: '6861', country: 'Japan' }, {}), '6861.T');
  assert.equal(resolveYahooSymbol({ rawSymbol: 'ABBN', country: 'Switzerland' }, {}), 'ABBN.SW');
  assert.equal(resolveYahooSymbol({ rawSymbol: '2330', country: 'Taiwan' }, {}), '2330.TW');
});

test('an existing dotted suffix is trusted as-is', () => {
  assert.equal(resolveYahooSymbol({ rawSymbol: 'HO.PA', country: 'France' }, {}), 'HO.PA');
});

test('override map wins, issuer-scoped key beats bare key', () => {
  const ov = { 'globalx:03750': '3750.HK', '03750': 'WRONG' };
  assert.equal(resolveYahooSymbol({ rawSymbol: '03750' }, ov, 'globalx'), '3750.HK');
});

test('unknown country + no override + no name -> null', () => {
  assert.equal(resolveYahooSymbol({ rawSymbol: 'XYZ', country: 'Freedonia' }, {}), null);
});

test('resolveHoldings splits resolved / unresolved', () => {
  const rows = [
    { rawSymbol: 'NVDA', country: 'United States', weight: 0.1 },
    { rawSymbol: 'ZZZ', country: 'Freedonia', weight: 0.02 },
  ];
  const out = resolveHoldings(rows, { issuer: 'ishares', overrides: {} });
  assert.equal(out.resolved.length, 1);
  assert.equal(out.resolved[0].yahoo, 'NVDA');
  assert.equal(out.unresolved.length, 1);
});
