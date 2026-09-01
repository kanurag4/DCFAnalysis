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

test('emerging-market suffixes (Brazil, Malaysia, Korea (South) variant)', () => {
  assert.equal(resolveYahooSymbol({ rawSymbol: 'RDOR3', country: 'Brazil' }, {}), 'RDOR3.SA');
  assert.equal(resolveYahooSymbol({ rawSymbol: 'IHH', country: 'Malaysia' }, {}), 'IHH.KL');
  assert.equal(resolveYahooSymbol({ rawSymbol: '068270', country: 'Korea (South)' }, {}), '068270.KS');
});

test('US share classes: ".B" is preserved as "-B", not stripped', () => {
  assert.equal(resolveYahooSymbol({ rawSymbol: 'BRK.B', country: 'United States' }, {}), 'BRK-B');
  assert.equal(resolveYahooSymbol({ rawSymbol: 'BF.B', country: 'United States' }, {}), 'BF-B');
});

test('dot-delimited Bloomberg exchange code is still stripped', () => {
  assert.equal(resolveYahooSymbol({ rawSymbol: 'PANW.UW', country: 'United States' }, {}), 'PANW');
  assert.equal(resolveYahooSymbol({ rawSymbol: 'HO.FP', country: 'France' }, {}), 'HO.PA');
});

test('Hong Kong numeric codes are zero-padded to 4 digits', () => {
  assert.equal(resolveYahooSymbol({ rawSymbol: '700 HK', country: 'Hong Kong' }, {}), '0700.HK');
  assert.equal(resolveYahooSymbol({ rawSymbol: '20 HK', country: 'Hong Kong' }, {}), '0020.HK');
  assert.equal(resolveYahooSymbol({ rawSymbol: '9988 HK', country: 'Hong Kong' }, {}), '9988.HK');
});

test('Bloomberg exchange code pins Shenzhen / KOSDAQ over the Country column', () => {
  assert.equal(resolveYahooSymbol({ rawSymbol: '300124 C2', country: 'China' }, {}), '300124.SZ');
  assert.equal(resolveYahooSymbol({ rawSymbol: '600519 C1', country: 'China' }, {}), '600519.SS');
  assert.equal(resolveYahooSymbol({ rawSymbol: '277810 KQ', country: 'South Korea' }, {}), '277810.KQ');
  assert.equal(resolveYahooSymbol({ rawSymbol: '005930 KP', country: 'South Korea' }, {}), '005930.KS');
});

test('Bloomberg "/" class separator is normalised', () => {
  assert.equal(resolveYahooSymbol({ rawSymbol: 'AV/ LN', country: 'United Kingdom' }, {}), 'AV.L');
  assert.equal(resolveYahooSymbol({ rawSymbol: 'RCI/B CT', country: 'Canada' }, {}), 'RCI-B.TO');
  assert.equal(resolveYahooSymbol({ rawSymbol: 'GIB/A CT', country: 'Canada' }, {}), 'GIB-A.TO');
});

test('a trailing-dot ticker does not become a double dot', () => {
  assert.equal(resolveYahooSymbol({ rawSymbol: 'SN.', country: 'United Kingdom' }, {}), 'SN.L');
});

test('a lone trailing A/B token is a share class, not an exchange', () => {
  assert.equal(resolveYahooSymbol({ rawSymbol: 'NOVO B', country: 'Denmark' }, {}), 'NOVO-B.CO');
  assert.equal(resolveYahooSymbol({ rawSymbol: 'GETI B', country: 'Sweden' }, {}), 'GETI-B.ST');
});

test('a class letter glued with no separator is left alone (ZETA / BETA are not ZET-A / BET-A)', () => {
  // "HEIA" -> "HEI-A" is real but indistinguishable from "ZETA" -> wrong;
  // HEICO / Moog go through etf-symbol-overrides.json instead.
  assert.equal(resolveYahooSymbol({ rawSymbol: 'ZETA', country: 'United States', name: 'ZETA GLOBAL HOLDINGS CLASS A' }, {}), 'ZETA');
  assert.equal(resolveYahooSymbol({ rawSymbol: 'HEIA', country: 'United States', name: 'HEICO CLASS A' }, {}), 'HEIA');
  assert.equal(resolveYahooSymbol({ rawSymbol: 'HEIA', country: 'United States', name: 'HEICO CLASS A' }, { 'ishares:HEIA': 'HEI-A' }, 'ishares'), 'HEI-A');
});

test('an already-.TWO-suffixed override value is trusted', () => {
  const ov = { 'betashares:5274 TT': '5274.TWO' };
  assert.equal(resolveYahooSymbol({ rawSymbol: '5274 TT', country: 'Taiwan' }, ov, 'betashares'), '5274.TWO');
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
