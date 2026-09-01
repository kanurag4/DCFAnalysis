const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const adapter = require('../scripts/lib/etf/holdings/ishares.js');
const { resolveHoldings } = require('../scripts/lib/etf/resolve.js');

const csv = fs.readFileSync(path.join(__dirname, 'fixtures/etf/ishares-soxx.csv'), 'utf8');

test('skips the preamble, parses asOf and equity-only rows', () => {
  const { asOf, rows } = adapter.parse(csv);
  assert.equal(asOf, '2026-08-28');                   // from "Fund Holdings as of","Aug 28, 2026"
  assert.equal(rows.length, 30);                      // 30 equities; money-market / cash / futures dropped
  assert.equal(rows[0].rawSymbol, 'NVDA');
  const sum = rows.reduce((a, r) => a + r.weight, 0);
  assert.ok(sum > 0.97 && sum < 1.01, `weight sum ${sum}`);
  assert.ok(rows.every(r => r.weight > 0 && r.weight < 0.15)); // fractions
});

test('a US exchange overrides issuer domicile for country (ADR lines)', () => {
  const { rows } = adapter.parse(csv);
  const tsm = rows.find(r => r.rawSymbol === 'TSM');  // Taiwan-domiciled, NYSE ADR
  assert.equal(tsm.country, 'United States');
});

test('every SOXX holding resolves to a Yahoo symbol', () => {
  const { rows } = adapter.parse(csv);
  const { resolved, unresolved } = resolveHoldings(rows, { issuer: 'ishares', overrides: {} });
  assert.equal(unresolved.length, 0);
  assert.equal(resolved.find(r => r.rawSymbol === 'ASML').yahoo, 'ASML');
});

test('toIsoDate handles the iShares month-name format', () => {
  assert.equal(adapter.toIsoDate('Aug 28, 2026'), '2026-08-28');
  assert.equal(adapter.toIsoDate('January 3, 2026'), '2026-01-03');
  assert.equal(adapter.toIsoDate('2026-08-28'), '2026-08-28');
});

test('fetchHoldings builds the latest-holdings URL and uses injected httpGet', async () => {
  const out = await adapter.fetchHoldings(
    { slug: 'soxx', issuerFundId: '239705/ishares-semiconductor-etf' },
    { httpGet: async () => csv },
  );
  assert.equal(out.rows.length, 30);
  assert.equal(out.source, 'https://www.ishares.com/us/products/239705/ishares-semiconductor-etf/latest-holdings.csv');
});
