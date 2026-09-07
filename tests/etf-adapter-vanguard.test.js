const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path');
const adapter = require('../scripts/lib/etf/holdings/vanguard.js');
const { resolveHoldings } = require('../scripts/lib/etf/resolve.js');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/etf/vanguard-vtek.json'), 'utf8'));

test('parses asOf from the first item\'s effectiveDate, one row per holding', () => {
  const { asOf, rows } = adapter.parse(fixture);
  assert.equal(asOf, '2026-07-31');
  // Vanguard's data API doesn't return every one of the fund's 327 holdings
  // even at limit=1000 (see the adapter's header comment) -- ~298 is expected,
  // not a fixture-trimming artifact.
  assert.ok(rows.length > 290 && rows.length < 300, `expected ~298 holdings, got ${rows.length}`);
  const nvda = rows.find((r) => r.rawSymbol === 'NVDA');
  assert.equal(nvda.country, 'United States');
  assert.ok(Math.abs(nvda.weight - 0.1335469) < 1e-6);
  const sum = rows.reduce((a, r) => a + r.weight, 0);
  assert.ok(sum > 0.98 && sum < 1.0, `weight sum ${sum}`);
});

test('translates ISO alpha-2 countryCode to the country-name strings resolve.js expects', () => {
  const { rows } = adapter.parse(fixture);
  const tsmc = rows.find((r) => r.rawSymbol === '2330');
  assert.equal(tsmc.country, 'Taiwan');
  const sap = rows.find((r) => r.rawSymbol === 'SAP');
  assert.equal(sap.country, 'Germany');
});

test('encodes mainland China A-shares as a Bloomberg-style composite so resolve.js picks the right exchange', () => {
  const { rows } = adapter.parse(fixture);
  const shenzhen = rows.find((r) => r.rawSymbol.startsWith('300033'));
  assert.equal(shenzhen.rawSymbol, '300033 C2');
  const shanghai = rows.find((r) => r.rawSymbol.startsWith('688012'));
  assert.equal(shanghai.rawSymbol, '688012 C1');

  const overrides = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/etf-symbol-overrides.json'), 'utf8'));
  const { resolved } = resolveHoldings(rows, { issuer: 'vanguard', overrides });
  assert.equal(resolved.find((r) => r.rawSymbol === '300033 C2').yahoo, '300033.SZ');
  assert.equal(resolved.find((r) => r.rawSymbol === '688012 C1').yahoo, '688012.SS');
});

test('a bare Hong Kong numeric ticker is zero-padded to 4 digits', () => {
  const { rows } = adapter.parse(fixture);
  const overrides = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/etf-symbol-overrides.json'), 'utf8'));
  const { resolved } = resolveHoldings(rows, { issuer: 'vanguard', overrides });
  const tencent = resolved.find((r) => r.rawSymbol === '700');
  assert.equal(tencent.yahoo, '0700.HK');
});

test('at least 90% of fund weight resolves to a Yahoo symbol, including the Nordic/Thai override cases', () => {
  const { rows } = adapter.parse(fixture);
  const overrides = JSON.parse(fs.readFileSync(path.join(__dirname, '../scripts/etf-symbol-overrides.json'), 'utf8'));
  const { resolved, unresolved } = resolveHoldings(rows, { issuer: 'vanguard', overrides });
  const coverage = resolved.reduce((a, r) => a + r.weight, 0);
  assert.ok(coverage > 0.9, `coverage only ${(coverage * 100).toFixed(1)}% — unresolved: ${unresolved.map((u) => u.rawSymbol).join(', ')}`);

  const hexagon = resolved.find((r) => r.rawSymbol === 'HEXAB');
  assert.equal(hexagon.yahoo, 'HEXA-B.ST');
  const delta = resolved.find((r) => r.rawSymbol === 'DELTA/F');
  assert.equal(delta.yahoo, 'DELTA.BK');
});

test('a Saudi Arabia holding falls through unresolved (no Yahoo suffix mapped for that market)', () => {
  const { rows } = adapter.parse(fixture);
  const { unresolved } = resolveHoldings(rows, { issuer: 'vanguard', overrides: {} });
  assert.ok(unresolved.some((r) => r.rawSymbol === 'ELM'));
});

test('holdingsUrl builds the portId-scoped Vanguard AU data-API path', () => {
  const url = adapter.holdingsUrl({ issuerFundId: 'F109' });
  assert.equal(url, 'https://www.vanguard.com.au/personal/api/data/products/holdings/F109?limit=1000');
});

test('fetchHoldings uses the injected (text-returning) httpGet', async () => {
  const out = await adapter.fetchHoldings(
    { issuerFundId: 'F109' },
    { httpGet: async () => JSON.stringify(fixture) },
  );
  assert.equal(out.source, 'https://www.vanguard.com.au/personal/api/data/products/holdings/F109?limit=1000');
  assert.ok(out.rows.length > 290);
});
