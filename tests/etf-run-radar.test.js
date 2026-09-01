const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
const { runEtfRadar, valueOne } = require('../scripts/lib/etf/run-etf-radar.js');

function seedHoldings(dir, slug, rows, asOf = '2026-08-01') {
  fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify({ asOf, source: 'x', rows }));
}

const DCF_MINUS_30 = (data) => ({ method: 'DCF', intrinsic: data.price * 0.7, marginOfSafety: -0.30 });

test('end-to-end with injected collaborators produces a ranking', async () => {
  const holdingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etfh-'));
  seedHoldings(holdingsDir, 'aaa', [
    { yahoo: 'NVDA', name: 'NVIDIA', weight: 0.6, country: 'United States' },
    { yahoo: 'AMD', name: 'AMD', weight: 0.4, country: 'United States' },
  ]);
  const universe = [{
    slug: 'aaa', name: 'Test Semis', theme: 'Semis', issuer: 'ishares',
    issuerFundId: 'x', fee: 0.005, assetClass: 'equity', listings: [{ ticker: 'AAA', currency: 'USD' }],
  }];
  const fakeData = {
    NVDA: { price: 100, currency: 'USD', totalRevenue: 1e9, sector: 'Technology' },
    AMD: { price: 50, currency: 'USD', totalRevenue: 5e8, sector: 'Technology' },
  };
  const result = await runEtfRadar({
    universePath: null, injectedUniverse: universe, holdingsDir, overridesPath: null,
    fetchSymbol: async (sym) => fakeData[sym] || null,
    evaluateStock: DCF_MINUS_30,
    now: () => new Date('2026-09-01T00:00:00Z'),
    log: () => {},
  }, { offline: true, throttleMs: 0 });

  assert.equal(result.asAt, '2026-09-01');
  assert.equal(result.funds[0].slug, 'aaa');
  assert.ok(Math.abs(result.funds[0].lookThroughMos - (-0.30)) < 1e-9);
  assert.equal(result.funds[0].ranked, true);
  assert.equal(result.rankings.ranked[0].slug, 'aaa');
  assert.equal(result.union.count, 2);
});

test('crypto fund (registry flag) lands in notValued, never ranked', async () => {
  const holdingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etfh-'));
  seedHoldings(holdingsDir, 'cryp', [{ yahoo: 'COIN', name: 'Coinbase', weight: 1.0, country: 'United States' }]);
  const universe = [{
    slug: 'cryp', name: 'Crypto Innovators', theme: 'Crypto', issuer: 'betashares',
    issuerFundId: 'x', fee: 0.0067, assetClass: 'crypto', listings: [{ ticker: 'CRYP.AX' }],
  }];
  const result = await runEtfRadar({
    universePath: null, injectedUniverse: universe, holdingsDir, overridesPath: null,
    fetchSymbol: async () => ({ price: 200, sector: 'Financial Services', totalRevenue: 1e9 }),
    evaluateStock: DCF_MINUS_30, now: () => new Date('2026-09-01Z'), log: () => {},
  }, { offline: true, throttleMs: 0 });

  assert.equal(result.rankings.notValued.length, 1);
  assert.equal(result.rankings.ranked.length, 0);
  assert.equal(result.funds[0].lookThroughMos, null);
});

test('a fund below the 70% coverage gate is unranked but still carries lookThroughMos', async () => {
  const holdingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etfh-'));
  seedHoldings(holdingsDir, 'thin', [
    { yahoo: 'GOODCO', name: 'Good', weight: 0.5, country: 'United States' },
    { yahoo: 'NODATA', name: 'Nope', weight: 0.5, country: 'United States' },
  ]);
  const universe = [{
    slug: 'thin', name: 'Thin Coverage', theme: 'x', issuer: 'ishares',
    issuerFundId: 'x', fee: 0.005, assetClass: 'equity', listings: [{ ticker: 'THIN' }],
  }];
  const result = await runEtfRadar({
    universePath: null, injectedUniverse: universe, holdingsDir, overridesPath: null,
    fetchSymbol: async (sym) => sym === 'GOODCO' ? { price: 10, sector: 'Technology', totalRevenue: 1e9 } : null,
    evaluateStock: DCF_MINUS_30, now: () => new Date('2026-09-01Z'), log: () => {},
  }, { offline: true, throttleMs: 0 });

  assert.equal(result.funds[0].ranked, false);
  assert.equal(result.rankings.unranked.length, 1);
  assert.ok(result.funds[0].lookThroughMos != null);
  assert.ok(Math.abs(result.funds[0].coverage - 0.5) < 1e-9);
});

test('valueOne: crypto quoteType (both spellings) short-circuits to the CRYPTO token', () => {
  assert.deepEqual(valueOne('BTC-USD', { quoteType: 'CRYPTOCURRENCY' }, () => { throw new Error('should not evaluate'); }), { quoteType: 'CRYPTO' });
  assert.deepEqual(valueOne('X', { quoteType: 'CRYPTO' }, () => { throw new Error('nope'); }), { quoteType: 'CRYPTO' });
});

test('valueOne: null data -> fetch-failed', () => {
  assert.deepEqual(valueOne('X', null, () => ({})), { unvaluable: true, reason: 'fetch-failed' });
});

test('valueOne: DCF-rejected non-financial falls back to EV/Sales', () => {
  const data = { sector: 'Technology', price: 40, totalRevenue: 2e9, totalDebt: 0, totalCash: 1e8, dilutedSharesOutstanding: 1e8 };
  const ev = valueOne('X', data, () => ({ excluded: true, reason: 'dcf-unavailable' }));
  assert.equal(ev.method, 'EV/Sales');
  assert.ok(Number.isFinite(ev.mos));
});

test('valueOne: DCF-rejected financial does NOT use the EV/Sales fallback', () => {
  const data = { sector: 'Financial Services', price: 40, totalRevenue: 2e9, dilutedSharesOutstanding: 1e8 };
  const ev = valueOne('X', data, () => ({ excluded: true, reason: 'ddm-unavailable' }));
  assert.equal(ev.unvaluable, true);
  assert.equal(ev.reason, 'ddm-unavailable');
});
