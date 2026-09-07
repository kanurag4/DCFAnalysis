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
    annualNetIncomeHistory: [{ date: '2025', value: 500 }],
    annualStockholdersEquityHistory: [{ date: '2025', value: 5000 }],
    annualDividendsPaidHistory: [{ date: '2025', value: -100 }],
  };
  const out = await convertFinancials(data, { proxyUrl: 'x', fxCache: new Map(), fetchFx: async () => 0.012 });
  assert.ok(Math.abs(out.totalRevenue - 99.6) < 1e-6);   // 8300 * 0.012
  assert.ok(Math.abs(out.freeCashflow - 9.96) < 1e-6);
  assert.equal(out.marketCap, 18e9);                     // NOT converted (already a quote-currency figure)
  assert.equal(out.price, 1.85);
  assert.ok(Math.abs(out.annualFcfHistory[0].value - 9.6) < 1e-6);
  assert.ok(Math.abs(out.annualNetIncomeHistory[0].value - 6) < 1e-6);
  assert.ok(Math.abs(out.annualStockholdersEquityHistory[0].value - 60) < 1e-6);
  assert.ok(Math.abs(out.annualDividendsPaidHistory[0].value - (-1.2)) < 1e-6);
});

test('convertFinancials: no rate -> fail closed (statement figures nulled)', async () => {
  const data = {
    currency: 'USD', financialCurrency: 'INR', totalRevenue: 8300, freeCashflow: 830,
    annualNetIncomeHistory: [{ date: '2025', value: 500 }],
    annualStockholdersEquityHistory: [{ date: '2025', value: 5000 }],
    annualDividendsPaidHistory: [{ date: '2025', value: -100 }],
  };
  const out = await convertFinancials(data, { proxyUrl: 'x', fxCache: new Map(), fetchFx: async () => null });
  assert.equal(out.totalRevenue, null);
  assert.equal(out.freeCashflow, null);
  assert.equal(out.fxConversionFailed, true);
  assert.deepStrictEqual(out.annualNetIncomeHistory, []);
  assert.deepStrictEqual(out.annualStockholdersEquityHistory, []);
  assert.deepStrictEqual(out.annualDividendsPaidHistory, []);
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

// ── valueOne: REIT / airline routing (radar-only — evaluate.js is untouched) ──
// Added onboarding DTCR-class REIT-heavy ETFs 2026-09-07.

const REIT_DATA = {
  ticker: 'PLD', sector: 'Real Estate', industry: 'REIT - Industrial', price: 100,
  netIncome: 100, depreciationAndAmortization: 50, capitalExpenditures: -30, sharesOutstanding: 10,
};

test('valueOne routes an equity REIT through the P/AFFO model, never the DCF path', () => {
  let evaluateCalled = false;
  const spyEvaluate = () => { evaluateCalled = true; return { method: 'DCF', marginOfSafety: -0.9 }; };
  // FFO 150, AFFO 120, /10 = 12/sh, × 18 (REIT - Industrial) = 216 vs price 100 → +116%… > band.
  // Use a lower multiple case instead: bump price so it lands in-band.
  const v = valueOne('PLD', { ...REIT_DATA, price: 200 }, spyEvaluate);
  assert.equal(evaluateCalled, false, 'evaluateStock must not be called for an equity REIT');
  assert.equal(v.method, 'REIT');
  assert.ok(Math.abs(v.mos - 0.08) < 1e-9, `expected +8%, got ${v.mos}`); // (216-200)/200
});

test('valueOne routes an airline through the EV/EBITDA model, never the DCF path', () => {
  let evaluateCalled = false;
  const spyEvaluate = () => { evaluateCalled = true; return { method: 'DCF', marginOfSafety: -0.9 }; };
  // EV 100×6=600, netDebt 200-50=150, equity 450, /10 = 45/sh vs price 40 → +12.5%.
  const v = valueOne('DAL', {
    ticker: 'DAL', sector: 'Industrials', industry: 'Airlines', price: 40,
    ebitda: 100, totalDebt: 200, totalCash: 50, sharesOutstanding: 10,
  }, spyEvaluate);
  assert.equal(evaluateCalled, false);
  assert.equal(v.method, 'Airline');
  assert.ok(Math.abs(v.mos - 0.125) < 1e-9);
});

test('valueOne leaves a mortgage REIT to evaluateStock (DDM), not the P/AFFO model', () => {
  let seen = null;
  const spyEvaluate = (d) => { seen = d; return { method: 'DDM', marginOfSafety: -0.1 }; };
  const v = valueOne('AGNC', {
    ticker: 'AGNC', sector: 'Real Estate', industry: 'REIT - Mortgage', price: 10,
    netIncome: 5, depreciationAndAmortization: 0, capitalExpenditures: 0, sharesOutstanding: 100,
  }, spyEvaluate);
  assert.ok(seen !== null, 'evaluateStock must handle mortgage REITs');
  assert.equal(v.method, 'DDM');
});

test('valueOne: a REIT with non-positive AFFO is unvaluable — and does NOT fall through to EV/Sales', () => {
  const v = valueOne('BADREIT', {
    ...REIT_DATA, netIncome: -500, // FFO -450, AFFO -480 → no P/AFFO value
    totalRevenue: 1e9, // would satisfy an EV/Sales attempt if it were allowed to try
  }, () => { throw new Error('evaluateStock should not be reached'); });
  assert.equal(v.unvaluable, true);
  assert.equal(v.reason, 'reit-unavailable');
});

test('valueOne: a REIT whose P/AFFO value implies an implausible margin is dropped, not blended', () => {
  // AFFO/sh 12 × 18 = 216 vs price 50 → +332%, outside the [-2.0, +1.0] band.
  const v = valueOne('PLD', { ...REIT_DATA, price: 50 }, () => { throw new Error('unreached'); });
  assert.equal(v.unvaluable, true);
  assert.equal(v.reason, 'implausible-margin');
});

test('valueOne still sends a normal (non-REIT, non-airline) stock through evaluateStock unchanged', () => {
  let evaluateCalled = false;
  const spyEvaluate = () => { evaluateCalled = true; return { method: 'DCF', intrinsic: 70, marginOfSafety: -0.30 }; };
  const v = valueOne('AAPL', { ticker: 'AAPL', sector: 'Technology', industry: 'Consumer Electronics', price: 100 }, spyEvaluate);
  assert.equal(evaluateCalled, true);
  assert.equal(v.method, 'DCF');
  assert.ok(Math.abs(v.mos - (-0.30)) < 1e-9);
});
