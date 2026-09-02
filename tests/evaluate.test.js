const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { evaluateStock } = require('../scripts/lib/evaluate.js');
const { calculateWACC } = require('../www/calc/wacc.js');
const { calculateDCF } = require('../www/calc/dcf.js');
const { deriveMultiYearGrowth } = require('../www/utils.js');

const params = { rf: 0.048, erp: 0.06 };

const dcfStock = {
  ticker: 'AAA.AX', name: 'Alpha', sector: 'Industrials', industry: 'Tools',
  price: 10, marketCap: 1e9, totalDebt: 1e8, totalCash: 5e7,
  sharesOutstanding: 1e8, beta: 0.9, interestExpense: -1e6, taxRate: 0.3,
  freeCashflow: 1.2e8, operatingCashflow: 1.5e8, capitalExpenditures: -3e7,
  revenueGrowth: 0.06, earningsGrowth: 0.08, trailingPE: 14,
};

test('values a normal industrial via DCF', () => {
  const r = evaluateStock(dcfStock, params);
  assert.strictEqual(r.excluded, undefined);
  assert.strictEqual(r.method, 'DCF');
  assert.strictEqual(r.fcfMethod, 'reported');
  assert.ok(typeof r.intrinsic === 'number' && r.intrinsic > 0);
  assert.ok(typeof r.marginOfSafety === 'number');
  assert.ok(r.terminalValuePct > 0);
});

test('routes a bank to DDM', () => {
  const bank = { ...dcfStock, ticker: 'BBB.AX', sector: 'Financial Services', industry: 'Banks—Diversified', trailingAnnualDividendRate: 0.8, dividendYield: 0.08 };
  const r = evaluateStock(bank, params);
  assert.strictEqual(r.method, 'DDM');
  assert.strictEqual(r.fcfMethod, undefined);
  assert.ok(r.intrinsic > 0);
});

// ── Excess Return Model (low-payout financials, 2026-08-15) ──

test('routes a low-payout financial (Muthoot-style) to Excess Return Model instead of DDM', () => {
  const nbfc = {
    ...dcfStock, ticker: 'MUTHOOTFIN.NS', sector: 'Financial Services', industry: 'Credit Services',
    price: 2842, priceToBook: 2.91585, returnOnEquity: 0.31735,
    trailingEps: 279.94, trailingAnnualDividendRate: null, dividendRate: 30, dividendYield: 0.0104,
    earningsGrowth: 0.388, revenueGrowth: 0.353,
  };
  const r = evaluateStock(nbfc, params);
  assert.strictEqual(r.method, 'ExcessReturn');
  assert.strictEqual(r.excluded, undefined);
  assert.ok(typeof r.intrinsic === 'number');
});

test('a bank/insurer with a normal payout ratio still gets DDM, unaffected by this feature (regression)', () => {
  const bank = { ...dcfStock, ticker: 'CCC.AX', sector: 'Financial Services', industry: 'Banks—Diversified',
    trailingAnnualDividendRate: 0.8, dividendYield: 0.08, returnOnEquity: 0.15, trailingEps: 1.6,
    earningsGrowth: 0.05, revenueGrowth: 0.03 };
  const r = evaluateStock(bank, params);
  assert.strictEqual(r.method, 'DDM');
});

test('Excess Return Model result includes no terminalValuePct field (no terminal value by design)', () => {
  const nbfc = {
    ...dcfStock, ticker: 'MUTHOOTFIN.NS', sector: 'Financial Services', industry: 'Credit Services',
    price: 2842, priceToBook: 2.91585, returnOnEquity: 0.31735,
    trailingEps: 279.94, trailingAnnualDividendRate: null, dividendRate: 30, dividendYield: 0.0104,
    earningsGrowth: 0.388, revenueGrowth: 0.353,
  };
  const r = evaluateStock(nbfc, params);
  assert.strictEqual(r.terminalValuePct, undefined);
});

test('Excess Return Model falls back to DDM when ROE is unavailable and cannot be derived', () => {
  const nbfc = {
    ...dcfStock, ticker: 'DDD.NS', sector: 'Financial Services', industry: 'Credit Services',
    price: 2842, priceToBook: null, returnOnEquity: null, trailingEps: null,
    trailingAnnualDividendRate: null, dividendRate: 30, dividendYield: 0.0104,
    earningsGrowth: 0.388, revenueGrowth: 0.353,
  };
  const r = evaluateStock(nbfc, params);
  assert.strictEqual(r.method, 'DDM');
});

test('excludes a stock with non-positive FCF', () => {
  const r = evaluateStock({ ...dcfStock, freeCashflow: null, operatingCashflow: -1e7, capitalExpenditures: null }, params);
  // OCF<0 → proxy gives negative fcf → calculateDCF returns null
  assert.strictEqual(r.excluded, true);
});

test('flags proxy FCF so rank can drop it', () => {
  const r = evaluateStock({ ...dcfStock, freeCashflow: null, operatingCashflow: 2e8, capitalExpenditures: null }, params);
  assert.strictEqual(r.fcfMethod, 'proxy');
});

// ── /timeseries enrichment wiring (2026-08-15: the batch never fetched
// /timeseries at all, so a ticker whose TTM freeCashflow/operatingCashflow
// come back empty — a real, non-trivial share of NSE tickers, confirmed on
// TECHM.NS — fell straight to excluded:true instead of using the annual-FCF
// fallback the live DCF tool already has via fetchDCFData(). ──
test('uses the annualFcf (/timeseries) fallback when quoteSummary FCF is entirely unavailable — does not exclude the stock', () => {
  const r = evaluateStock({ ...dcfStock, freeCashflow: null, operatingCashflow: null, capitalExpenditures: null, annualFcf: 5e7 }, params);
  assert.strictEqual(r.excluded, undefined);
  assert.strictEqual(r.fcfMethod, 'annual');
  assert.ok(typeof r.intrinsic === 'number');
});

test('without annualFcf, the same empty-quoteSummary-FCF stock is excluded (proves the fallback, not something else, is what rescues it)', () => {
  const r = evaluateStock({ ...dcfStock, freeCashflow: null, operatingCashflow: null, capitalExpenditures: null }, params);
  assert.strictEqual(r.excluded, true);
});

test('passes ebit through to calculateWACC (changes the computed WACC vs. omitting it, given a real interest expense)', () => {
  const withEbit = evaluateStock({ ...dcfStock, interestExpense: -5e6, ebit: 2e7 }, params);
  const withoutEbit = evaluateStock({ ...dcfStock, interestExpense: -5e6, ebit: null }, params);
  assert.notStrictEqual(withEbit.wacc, withoutEbit.wacc);
});

test('prefers dilutedSharesOutstanding over sharesOutstanding for the DCF per-share value when both are present', () => {
  const diluted = evaluateStock({ ...dcfStock, sharesOutstanding: 1e8, dilutedSharesOutstanding: 1.2e8 }, params);
  const basicOnly = evaluateStock({ ...dcfStock, sharesOutstanding: 1e8, dilutedSharesOutstanding: null }, params);
  assert.notStrictEqual(diluted.intrinsic, basicOnly.intrinsic);
});

test('excludes a bank with no dividend', () => {
  const r = evaluateStock({ ...dcfStock, ticker: 'CCC.AX', sector: 'Financial Services', industry: 'Banks', trailingAnnualDividendRate: null, dividendRate: null, dividendYield: null }, params);
  assert.strictEqual(r.excluded, true);
});

test('uses a market-specific terminalGrowth when provided, defaults to 2.5% otherwise', () => {
  const defaultResult = evaluateStock(dcfStock, params);
  const lowerGrowthResult = evaluateStock(dcfStock, { ...params, terminalGrowth: 0.0175 });
  // Same ticker/inputs, only terminalGrowth differs — isolates its effect. A lower
  // terminal growth rate produces a lower terminal value and thus a lower intrinsic
  // value, all else equal — confirms the param actually reaches calculateDCF.
  assert.ok(lowerGrowthResult.intrinsic < defaultResult.intrinsic);
});

// ── Non-bank financial-sector FCF normalisation (must mirror the live tool) ──
// The live DCF tool seeds normalised FCF = fcf * 0.6 for non-bank financials
// (app.js prefill + buildScenarios). The batch must apply the same haircut, or
// it overstates fair value for Visa/exchanges/asset managers and floods the list.
const usParams = { rf: 0.045, erp: 0.055 };
const usFixture = (over = {}) => ({
  ticker: 'TEST', name: 'Test Co', sector: 'Technology', industry: 'Software',
  price: 50, currency: 'USD', trailingPE: 20, marketCap: 50000e6,
  operatingMargins: 0.25, targetMeanPrice: 60,
  beta: 1.0, freeCashflow: 1000e6, operatingCashflow: 1200e6, capitalExpenditures: -200e6,
  totalDebt: 0, totalCash: 0, sharesOutstanding: 1000e6,
  interestExpense: null, taxRate: null, revenueGrowth: 0.10, earningsGrowth: 0.10,
  ...over,
});

test('non-bank financial gets the 0.6 FCF haircut (fin@F == nonfin@0.6F)', () => {
  const fin  = evaluateStock(usFixture({ sector: 'Financial Services', industry: 'Asset Management', freeCashflow: 1000e6 }), usParams);
  const tech = evaluateStock(usFixture({ sector: 'Technology', industry: 'Software', freeCashflow: 600e6 }), usParams);
  assert.strictEqual(fin.method, 'DCF');
  assert.strictEqual(tech.method, 'DCF');
  assert.ok(Math.abs(fin.intrinsic - tech.intrinsic) <= 0.01,
    `financial(1000) should equal non-financial(600); got ${fin.intrinsic} vs ${tech.intrinsic}`);
});

test('non-financial stocks use full FCF (no haircut)', () => {
  const full = evaluateStock(usFixture({ freeCashflow: 1000e6 }), usParams);
  const less = evaluateStock(usFixture({ freeCashflow: 600e6 }), usParams);
  assert.ok(Math.abs(full.intrinsic - less.intrinsic) > 1, 'non-financial must not be haircut');
});

test('DCF runs off rounded display inputs (1dp growth, 2dp WACC) — matches the calculator to the penny', () => {
  // beta 0.97 → Re = 4.5% + 0.97×5.5% = 9.835% (non-2dp); no history arrays on
  // this fixture -> deriveMultiYearGrowth falls back to min(revenueGrowth,
  // earningsGrowth) = min(12.3,18.8) = 12.3% (non-round, still exercises the
  // 1dp rounding this test is actually about).
  const d = usFixture({ beta: 0.97, totalDebt: 0, revenueGrowth: 0.123, earningsGrowth: 0.188, freeCashflow: 1000e6 });
  const r = evaluateStock(d, usParams);
  const w = calculateWACC({ marketCap: d.marketCap, totalDebt: d.totalDebt, beta: 0.97, interestExpense: d.interestExpense, taxRate: d.taxRate, riskFreeRate: usParams.rf, erp: usParams.erp });
  const expected = calculateDCF({
    fcf: Math.round(1000e6),
    growthRate:    +(deriveMultiYearGrowth(d) * 100).toFixed(1) / 100,
    terminalGrowth: 0.025,
    wacc:          +(w.wacc * 100).toFixed(2) / 100,
    projectionYears: 5,
    totalDebt: d.totalDebt, totalCash: d.totalCash, sharesOutstanding: d.sharesOutstanding, currentPrice: d.price,
  });
  assert.ok(Math.abs(r.intrinsic - expected.intrinsicValue) < 1e-9,
    `evaluateStock should match the calculator's rounded-input DCF; got ${r.intrinsic}, expected ${expected.intrinsicValue}`);
});

// ── Regulated Utility -> Excess Return Model (unconditional, not payout-gated) ──

test('routes a regulated utility to Excess Return Model regardless of payout ratio', () => {
  const utility = {
    ...dcfStock, ticker: 'NEE', sector: 'Utilities', industry: 'Utilities - Regulated Electric',
    price: 72.50, priceToBook: 3.0542574, returnOnEquity: 0.11677,
    trailingEps: null, trailingAnnualDividendRate: 2.0, dividendYield: 0.0276, // high payout -- would get DDM if this were a bank
    earningsGrowth: 0.07, revenueGrowth: 0.08,
  };
  const r = evaluateStock(utility, params);
  assert.strictEqual(r.method, 'ExcessReturn');
  assert.strictEqual(r.excluded, undefined);
  assert.ok(typeof r.intrinsic === 'number');
});

test('does NOT route Independent Power Producers to Excess Return (merchant generation stays DCF)', () => {
  const merchant = { ...dcfStock, ticker: 'AGL.AX', sector: 'Utilities', industry: 'Utilities - Independent Power Producers' };
  const r = evaluateStock(merchant, params);
  assert.strictEqual(r.method, 'DCF');
});

// ── Cyclical/Commodity FCF-margin normalization ──────────────────────────

const cyclicalFcfHistory = [
  { date: '2023-06-30', value: 11968000000 },
  { date: '2024-06-30', value: 11849000000 },
  { date: '2025-06-30', value: 9294000000 },
  { date: '2026-06-30', value: 11929000000 },
];
const cyclicalRevenueHistory = [
  { date: '2023-06-30', value: 53817000000 },
  { date: '2024-06-30', value: 55658000000 },
  { date: '2025-06-30', value: 51262000000 },
  { date: '2026-06-30', value: 58760000000 },
];

test('normalizes a cyclical ticker\'s FCF using the multi-year margin average instead of trailing FCF', () => {
  const cyclical = {
    ...dcfStock, ticker: 'BHP.AX', sector: 'Basic Materials', industry: 'Other Industrial Metals & Mining',
    totalRevenue: 58760000000, freeCashflow: 11929000000, operatingCashflow: null, capitalExpenditures: null,
    annualFcfHistory: cyclicalFcfHistory, annualRevenueHistory: cyclicalRevenueHistory,
  };
  const r = evaluateStock(cyclical, params);
  assert.strictEqual(r.method, 'DCF');
  assert.strictEqual(r.fcfMethod, 'normalized');
  assert.notStrictEqual(r.intrinsic, undefined);
});

test('falls back to standard trailing FCF when a cyclical ticker has too little history', () => {
  const cyclical = {
    ...dcfStock, ticker: 'NEWMINE.AX', sector: 'Basic Materials', industry: 'Steel',
    totalRevenue: 0.5e9, freeCashflow: 0.05e9,
    annualFcfHistory: [{ date: '2026-06-30', value: 0.05e9 }],
    annualRevenueHistory: [{ date: '2026-06-30', value: 0.5e9 }],
  };
  const r = evaluateStock(cyclical, params);
  assert.strictEqual(r.fcfMethod, 'reported'); // deriveFcf's own tier, unchanged
});

test('a non-cyclical ticker is not normalized even with history fields present', () => {
  const r = evaluateStock({ ...dcfStock, annualFcfHistory: cyclicalFcfHistory, annualRevenueHistory: cyclicalRevenueHistory }, params);
  assert.strictEqual(r.fcfMethod, 'reported');
});

// ── Holdco/Conglomerate discount ─────────────────────────────────────────

test('applies the holdco discount to a conglomerate\'s DCF result', () => {
  const baseline = evaluateStock(dcfStock, params);
  const holdco = evaluateStock({ ...dcfStock, ticker: 'HON', industry: 'Conglomerates' }, params);
  assert.strictEqual(holdco.method, 'DCF');
  assert.ok(Math.abs(holdco.intrinsic - baseline.intrinsic * 0.85) < 1e-6);
});

test('applies the holdco discount on top of a bank-model conglomerate too (discount is model-agnostic)', () => {
  // sector: 'Insurance' alone satisfies isBankOrInsurance() (checks sector OR
  // industry for /bank|insurance/i); industry: 'Conglomerates' independently
  // satisfies isConglomerate() (industry-only check) -- lets one fixture
  // genuinely exercise both dispatches at once without needing the (empty in
  // production) ticker allowlist.
  const bank = { ...dcfStock, ticker: 'BBB.AX', sector: 'Insurance', industry: 'Insurance—Diversified', trailingAnnualDividendRate: 0.8, dividendYield: 0.08 };
  const baseline = evaluateStock(bank, params);
  const holdcoBank = evaluateStock({ ...bank, ticker: 'HOLDCOBANK', industry: 'Conglomerates' }, params);
  assert.strictEqual(holdcoBank.method, 'DDM');
  assert.ok(Math.abs(holdcoBank.intrinsic - baseline.intrinsic * 0.85) < 1e-6);
});

// ── Sector-average cyclical margin fallback (2026-08-25) ──

const cyclicalStockNegativeMargin = {
  ticker: 'TESTCOAL.AX', name: 'Test Coal', sector: 'Energy', industry: 'Thermal Coal',
  price: 5.0, marketCap: 1e9, totalDebt: 2e8, totalCash: 1e8,
  sharesOutstanding: 200e6, beta: 1.3, interestExpense: -1e7, taxRate: 0.3,
  revenueGrowth: 0.03, earningsGrowth: 0.02, trailingPE: 8,
  totalRevenue: 1.1e9,
  freeCashflow: -0.04e9, operatingCashflow: -0.01e9, capitalExpenditures: -0.03e9,
  annualFcfHistory: [
    { date: '2024-06-30', value: -0.05e9 },
    { date: '2025-06-30', value: -0.08e9 },
    { date: '2026-06-30', value: -0.04e9 },
  ],
  annualRevenueHistory: [
    { date: '2024-06-30', value: 1.0e9 },
    { date: '2025-06-30', value: 1.05e9 },
    { date: '2026-06-30', value: 1.1e9 },
  ],
};

test('evaluateStock excludes a cyclical ticker whose own margin is negative and no sector data exists (pre-fix baseline, unchanged)', () => {
  // Must not rely on evaluate.js's module-load-time read of the real
  // www/sector-margins.json -- that file gets legitimately populated by real
  // screen runs (this is the whole point of the feature), so a fixture
  // industry that happens to gain real sector data would silently break this
  // "no sector data" baseline. Force a fresh require against an explicitly
  // empty seed instead, same pattern as the next test.
  const sectorPath = require.resolve('../www/sector-margins.json');
  const original = fs.readFileSync(sectorPath, 'utf8');
  fs.writeFileSync(sectorPath, JSON.stringify({}));
  delete require.cache[sectorPath];
  delete require.cache[require.resolve('../scripts/lib/evaluate.js')];
  const { evaluateStock: evaluateStockFresh } = require('../scripts/lib/evaluate.js');

  try {
    const r = evaluateStockFresh(cyclicalStockNegativeMargin, params);
    assert.strictEqual(r.excluded, true);
    assert.strictEqual(r.reason, 'dcf-unavailable');
  } finally {
    fs.writeFileSync(sectorPath, original);
    delete require.cache[sectorPath];
    delete require.cache[require.resolve('../scripts/lib/evaluate.js')];
  }
});

test('evaluateStock substitutes the sector-average margin for a cyclical ticker whose own margin is negative', () => {
  // evaluate.js reads ../../www/sector-margins.json at module load time --
  // seed that file's real content, force a fresh require of both it and
  // evaluate.js, then restore the seed file afterward so this test doesn't
  // leave the repo's real (still-{} at this point in the plan)
  // sector-margins.json mutated.
  const sectorPath = require.resolve('../www/sector-margins.json');
  const original = fs.readFileSync(sectorPath, 'utf8');
  fs.writeFileSync(sectorPath, JSON.stringify({ 'Thermal Coal': { avgMargin: 0.18, peerCount: 5 } }));
  delete require.cache[sectorPath];
  delete require.cache[require.resolve('../scripts/lib/evaluate.js')];
  const { evaluateStock: evaluateStockFresh } = require('../scripts/lib/evaluate.js');

  try {
    const r = evaluateStockFresh(cyclicalStockNegativeMargin, params);
    assert.strictEqual(r.excluded, undefined);
    assert.strictEqual(r.fcfMethod, 'normalized');
    assert.ok(r.intrinsic > 0); // now computable, using the 18% sector-average margin instead of the negative own one
  } finally {
    fs.writeFileSync(sectorPath, original);
    delete require.cache[sectorPath];
    delete require.cache[require.resolve('../scripts/lib/evaluate.js')];
  }
});
