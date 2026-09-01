const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os'); const fs = require('node:fs'); const path = require('node:path');
const { runEtfRadar, valueOne, plausible, convertFinancials, writeRadarArtifacts, ordinal } = require('../scripts/lib/etf/run-etf-radar.js');

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

test('a crypto-heavy fund is excluded entirely — no fund entry, no ranked row', async () => {
  const holdingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etfh-'));
  seedHoldings(holdingsDir, 'blok', [
    { yahoo: 'COIN', name: 'Coinbase', weight: 0.6, country: 'United States' },
    { yahoo: 'NVDA', name: 'NVIDIA', weight: 0.4, country: 'United States' },
  ]);
  const universe = [{
    slug: 'blok', name: 'Blockchain Innovators', theme: 'Blockchain', issuer: 'betashares',
    issuerFundId: 'x', fee: 0.0067, assetClass: 'equity', listings: [{ ticker: 'BLOK.AX' }],
  }];
  const result = await runEtfRadar({
    universePath: null, injectedUniverse: universe, holdingsDir, overridesPath: null,
    fetchSymbol: async () => ({ price: 200, sector: 'Technology', totalRevenue: 1e9 }),
    evaluateStock: DCF_MINUS_30, now: () => new Date('2026-09-01Z'), log: () => {},
  }, { offline: true, throttleMs: 0 });

  assert.deepEqual(result.cryptoExcluded, ['blok']);
  assert.equal(result.funds.length, 0);
  assert.equal(result.rankings.ranked.length, 0);
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
  // revenue 2e9 * sector 6x + cash 1e8, / 1e8 shares -> intrinsic ~121; price 90 -> mos ~0.34
  const data = { sector: 'Technology', price: 90, totalRevenue: 2e9, totalDebt: 0, totalCash: 1e8, dilutedSharesOutstanding: 1e8 };
  const ev = valueOne('X', data, () => ({ excluded: true, reason: 'dcf-unavailable' }));
  assert.equal(ev.method, 'EV/Sales');
  assert.ok(Number.isFinite(ev.mos) && ev.mos > 0 && ev.mos < 1);
});

test('valueOne: DCF-rejected financial does NOT use the EV/Sales fallback', () => {
  const data = { sector: 'Financial Services', price: 40, totalRevenue: 2e9, dilutedSharesOutstanding: 1e8 };
  const ev = valueOne('X', data, () => ({ excluded: true, reason: 'ddm-unavailable' }));
  assert.equal(ev.unvaluable, true);
  assert.equal(ev.reason, 'ddm-unavailable');
});

test('plausible band', () => {
  assert.equal(plausible(0.4), true);
  assert.equal(plausible(-0.9), true);
  assert.equal(plausible(19), false);     // WIT/TSM-style ADR currency artifact
  assert.equal(plausible(-5), false);     // trades at 6x intrinsic — share-count artifact
  assert.equal(plausible(NaN), false);
});

test('valueOne: an implausible margin (ADR currency artifact) is dropped, not blended', () => {
  const data = { sector: 'Technology', price: 1.85 };
  const ev = valueOne('WIT', data, () => ({ method: 'DCF', intrinsic: 816, marginOfSafety: 440 }));
  assert.equal(ev.unvaluable, true);
  assert.equal(ev.reason, 'implausible-margin');
});

test('convertFinancials: converts statement figures from financialCurrency into the quote currency', async () => {
  const data = {
    currency: 'USD', financialCurrency: 'INR', price: 1.85,
    totalRevenue: 8300, freeCashflow: 830, totalDebt: 100, marketCap: 18e9,
    annualFcfHistory: [{ date: '2025', value: 800 }],
  };
  const out = await convertFinancials(data, { proxyUrl: 'x', fxCache: new Map(), fetchFx: async () => 0.012 });
  assert.ok(Math.abs(out.totalRevenue - 99.6) < 1e-6);   // 8300 * 0.012
  assert.ok(Math.abs(out.freeCashflow - 9.96) < 1e-6);
  assert.equal(out.marketCap, 18e9);                     // NOT converted (already a quote-currency figure)
  assert.equal(out.price, 1.85);
  assert.ok(Math.abs(out.annualFcfHistory[0].value - 9.6) < 1e-6);
});

test('convertFinancials: no rate -> fail closed (statement figures nulled)', async () => {
  const data = { currency: 'USD', financialCurrency: 'INR', totalRevenue: 8300, freeCashflow: 830 };
  const out = await convertFinancials(data, { proxyUrl: 'x', fxCache: new Map(), fetchFx: async () => null });
  assert.equal(out.totalRevenue, null);
  assert.equal(out.freeCashflow, null);
  assert.equal(out.fxConversionFailed, true);
});

test('convertFinancials: matching currencies pass through untouched, no FX call', async () => {
  let called = false;
  const data = { currency: 'USD', financialCurrency: 'USD', totalRevenue: 100 };
  const out = await convertFinancials(data, { proxyUrl: 'x', fxCache: new Map(), fetchFx: async () => { called = true; return 1; } });
  assert.equal(out, data);
  assert.equal(called, false);
});

test('ordinal', () => {
  assert.equal(ordinal(1), '1st'); assert.equal(ordinal(2), '2nd'); assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th'); assert.equal(ordinal(11), '11th'); assert.equal(ordinal(22), '22nd');
});

test('writeRadarArtifacts with generatePages writes rankings JSON + all pages', async () => {
  const holdingsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'etfh-'));
  seedHoldings(holdingsDir, 'aaa', [
    { yahoo: 'NVDA', name: 'NVIDIA', weight: 0.6, country: 'United States' },
    { yahoo: 'AMD', name: 'AMD', weight: 0.4, country: 'United States' },
  ]);
  const universe = [{
    slug: 'aaa', name: 'Test Semis ETF', theme: 'Semis', issuer: 'ishares',
    issuerFundId: 'x', fee: 0.005, assetClass: 'equity', listings: [{ ticker: 'AAA', currency: 'USD' }],
  }];
  const result = await runEtfRadar({
    universePath: null, injectedUniverse: universe, holdingsDir, overridesPath: null,
    fetchSymbol: async (sym) => ({ NVDA: { price: 100, totalRevenue: 1e9, sector: 'Technology' }, AMD: { price: 50, totalRevenue: 5e8, sector: 'Technology' } }[sym] || null),
    evaluateStock: DCF_MINUS_30, now: () => new Date('2026-09-01Z'), log: () => {},
  }, { offline: true, throttleMs: 0 });

  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'etfout-'));
  writeRadarArtifacts(result, path.join(out, 'etf-radar'), {
    generatePages: true, pagesRoot: out, tickerPageIndex: { NVDA: '/dcf/stocks/sp500/nvidia/' }, asAt: '2026-09-01',
  });

  assert.ok(fs.existsSync(path.join(out, 'etf-radar', 'etf-rankings.json')));
  assert.ok(fs.existsSync(path.join(out, 'etf-radar', 'index.html')));
  assert.ok(fs.existsSync(path.join(out, 'etfs', 'aaa', 'index.html')));
  const manifest = JSON.parse(fs.readFileSync(path.join(out, 'etfs', 'manifest.json'), 'utf8'));
  assert.equal(manifest[0].slug, 'aaa');
  const detail = fs.readFileSync(path.join(out, 'etfs', 'aaa', 'index.html'), 'utf8');
  assert.match(detail, /href="\/dcf\/stocks\/sp500\/nvidia\/"/);   // linked holding via injected index
  assert.match(detail, /1st of 1 thematic ETFs/);                  // rank line
});
