const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const adapter = require('../scripts/lib/etf/holdings/betashares.js');
const { resolveHoldings } = require('../scripts/lib/etf/resolve.js');

const csv = fs.readFileSync(path.join(__dirname, 'fixtures/etf/betashares-hack.csv'), 'utf8');

test('parses the BetaShares CSV into normalized rows', () => {
  const { asOf, rows } = adapter.parse(csv);
  assert.equal(asOf, '2026-08-31');
  assert.equal(rows.length, 42);                      // 42 equities; the 6 cash/FX lines dropped
  const first = rows[0];
  assert.equal(first.rawSymbol, 'PANW UW');
  assert.equal(first.name, 'PALO ALTO NETWORKS INC');
  assert.ok(first.weight > 0 && first.weight < 0.15); // fraction, not percent
  const sum = rows.reduce((a, r) => a + r.weight, 0);
  assert.ok(Math.abs(sum - 0.9995) < 0.02, `weight sum ${sum}`);
});

test('Bloomberg exchange code sets a resolve-friendly country (beats issuer domicile)', () => {
  const { rows } = adapter.parse(csv);
  const chkp = rows.find(r => r.rawSymbol.startsWith('CHKP'));   // Israel-domiciled, US-listed line
  assert.equal(chkp.country, 'United States');
  const thales = rows.find(r => r.rawSymbol.startsWith('HO '));
  assert.equal(thales.country, 'France');
});

test('every HACK holding resolves to a Yahoo symbol', () => {
  const { rows } = adapter.parse(csv);
  const { resolved, unresolved } = resolveHoldings(rows, { issuer: 'betashares', overrides: {} });
  assert.equal(unresolved.length, 0);
  assert.equal(resolved.find(r => r.rawSymbol.startsWith('CHKP')).yahoo, 'CHKP');
  assert.equal(resolved.find(r => r.rawSymbol.startsWith('HO ')).yahoo, 'HO.PA');
  assert.equal(resolved.find(r => r.rawSymbol.startsWith('4704')).yahoo, '4704.T');
});

test('fetchHoldings uses the injected httpGet and reports the source URL', async () => {
  const out = await adapter.fetchHoldings(
    { slug: 'hack', issuerFundId: 'global-cybersecurity-etf', listings: [{ ticker: 'HACK.AX' }] },
    { httpGet: async () => csv },
  );
  assert.equal(out.rows.length, 42);
  assert.equal(out.source, 'https://www.betashares.com.au/files/csv/HACK_Portfolio_Holdings.csv');
});
