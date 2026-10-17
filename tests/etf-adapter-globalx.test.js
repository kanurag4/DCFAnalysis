const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const adapter = require('../scripts/lib/etf/holdings/globalx.js');
const { resolveHoldings } = require('../scripts/lib/etf/resolve.js');

const csv = fs.readFileSync(path.join(__dirname, 'fixtures/etf/globalx-shld.csv'), 'utf8');
const pageHtml = '<html>...<a href="https://assets.globalxetfs.com/funds/holdings/shld_full-holdings_20260902.csv">Full Holdings (.csv)</a>...</html>';

test('parses the Global X CSV into normalized rows', () => {
  const { asOf, rows } = adapter.parse(csv);
  assert.equal(asOf, '2026-09-02');
  assert.equal(rows.length, 50);
  const first = rows[0];
  assert.equal(first.rawSymbol, 'ASELS TI');
  assert.equal(first.name, 'ASELSAN ELEKTRONIK SANAYI');
  assert.ok(first.weight > 0 && first.weight < 0.05); // fraction, not percent
  const sum = rows.reduce((a, r) => a + r.weight, 0);
  assert.ok(Math.abs(sum - 1) < 0.02, `weight sum ${sum}`);
});

test('a bare ticker with no Bloomberg exchange code defaults to United States', () => {
  const { rows } = adapter.parse(csv);
  const rtx = rows.find(r => r.rawSymbol === 'RTX');
  assert.equal(rtx.country, 'United States');
});

test('a Bloomberg exchange code sets the right country', () => {
  const { rows } = adapter.parse(csv);
  const hanwha = rows.find(r => r.rawSymbol.startsWith('272210'));
  assert.equal(hanwha.country, 'South Korea');
});

test('resolves the large majority of SHLD holdings to a Yahoo symbol', () => {
  const { rows } = adapter.parse(csv);
  const { resolved, unresolved } = resolveHoldings(rows, { issuer: 'globalx', overrides: {} });
  const coveredWeight = resolved.reduce((a, r) => a + r.weight, 0);
  assert.ok(coveredWeight > 0.9, `resolved weight ${coveredWeight} too low`);
  assert.equal(resolved.find(r => r.rawSymbol === 'RTX').yahoo, 'RTX');
  assert.equal(resolved.find(r => r.rawSymbol.startsWith('272210')).yahoo, '272210.KS');
  assert.equal(resolved.find(r => r.rawSymbol === 'MOG/A').yahoo, 'MOG-A');
  // Istanbul (TI) and Tel Aviv (IT) Bloomberg exchange codes -> .IS/.TA.
  assert.equal(resolved.find(r => r.rawSymbol === 'ASELS TI').yahoo, 'ASELS.IS');
  assert.equal(resolved.find(r => r.rawSymbol === 'ARYT IT').yahoo, 'ARYT.TA');
  assert.equal(resolved.find(r => r.rawSymbol === 'ESLT IT').yahoo, 'ESLT.TA');
  assert.equal(unresolved.length, 0, `unresolved: ${unresolved.map(u => u.rawSymbol).join(', ')}`);
});

// Shape of the Next.js fund page Global X moved to (2026-10): holdings live in
// the RSC flight payload, split across self.__next_f.push string chunks.
const holding = (ticker, name, pct, shares) => JSON.stringify({
  exposurePercent: pct, exposureAmount: '$$1', netAssets: pct, ticker, name, sedol: '',
  marketPrice: '$$1', marketValuePercent: pct, pricePerUnit: '$$1',
  securityType: ticker ? 'Stock - Common' : 'Currency', shares, marketValue: '$$1',
});
const flight = `5b:["$","p",null,{"children":["As of"," ","Oct 6, 2026"]}]\n`
  + `5c:{"holdings":[${holding('PLTR', 'PALANTIR TECHNOLOGIES INC-A', '60.00%', '100')},`
  + `${holding('RHM GR', 'RHEINMETALL AG', '40.00%', '50')},`
  + `${holding('', 'EURO', '0.00%', '7')}]}\n`
  + `5d:{"top":[${holding('PLTR', 'PALANTIR TECHNOLOGIES INC-A', '60.00%', '100')}]}\n`;
const cut = 120; // split mid-object, as the real payload does
const nextPage = '<html><script>self.__next_f.push([0])</script>'
  + `<script>self.__next_f.push([1,${JSON.stringify(flight.slice(0, cut))}])</script>`
  + `<script>self.__next_f.push([1,${JSON.stringify(flight.slice(cut))}])</script></html>`;

test('parsePage reads holdings embedded in the Next.js page payload', () => {
  const { asOf, rows } = adapter.parsePage(nextPage);
  assert.equal(asOf, '2026-10-06');
  assert.deepEqual(rows.map(r => r.rawSymbol), ['PLTR', 'RHM GR']); // duplicate + currency line dropped
  assert.equal(rows[0].weight, 0.6);
  assert.equal(rows[0].country, 'United States');
  assert.equal(rows[1].country, 'Germany');
});

test('fetchHoldings falls back to the embedded payload when the page has no CSV link', async () => {
  const fetched = [];
  const out = await adapter.fetchHoldings(
    { slug: 'shld', listings: [{ ticker: 'SHLD' }] },
    { httpGet: async (url) => { fetched.push(url); return nextPage; } },
  );
  assert.equal(fetched.length, 1);
  assert.equal(out.rows.length, 2);
  assert.equal(out.asOf, '2026-10-06');
  assert.equal(out.source, 'https://www.globalxetfs.com/funds/shld/');
});

test('fetchHoldings throws when the page has neither a CSV link nor embedded holdings', async () => {
  await assert.rejects(
    adapter.fetchHoldings({ slug: 'shld' }, { httpGet: async () => '<html>Redirecting...</html>' }),
    /no holdings CSV link or embedded holdings/,
  );
});

test('fetchHoldings discovers the dated CSV URL from the fund page, then fetches it', async () => {
  const out = await adapter.fetchHoldings(
    { slug: 'shld', issuerFundId: 'defense-tech', listings: [{ ticker: 'SHLD' }] },
    { httpGet: async (url) => (url.endsWith('.csv') ? csv : pageHtml) },
  );
  assert.equal(out.rows.length, 50);
  assert.equal(out.source, 'https://assets.globalxetfs.com/funds/holdings/shld_full-holdings_20260902.csv');
});
