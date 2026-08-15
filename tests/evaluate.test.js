const { test } = require('node:test');
const assert = require('node:assert');
const { evaluateStock } = require('../scripts/lib/evaluate.js');
const { calculateWACC } = require('../www/calc/wacc.js');
const { calculateDCF } = require('../www/calc/dcf.js');
const { deriveBaseGrowth } = require('../www/utils.js');

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
  // beta 0.97 → Re = 4.5% + 0.97×5.5% = 9.835% (non-2dp); growth avg(12.3,18.8)=15.55% (non-1dp).
  const d = usFixture({ beta: 0.97, totalDebt: 0, revenueGrowth: 0.123, earningsGrowth: 0.188, freeCashflow: 1000e6 });
  const r = evaluateStock(d, usParams);
  const w = calculateWACC({ marketCap: d.marketCap, totalDebt: d.totalDebt, beta: 0.97, interestExpense: d.interestExpense, taxRate: d.taxRate, riskFreeRate: usParams.rf, erp: usParams.erp });
  const expected = calculateDCF({
    fcf: Math.round(1000e6),
    growthRate:    +(deriveBaseGrowth(0.123, 0.188) * 100).toFixed(1) / 100,
    terminalGrowth: 0.025,
    wacc:          +(w.wacc * 100).toFixed(2) / 100,
    projectionYears: 5,
    totalDebt: d.totalDebt, totalCash: d.totalCash, sharesOutstanding: d.sharesOutstanding, currentPrice: d.price,
  });
  assert.ok(Math.abs(r.intrinsic - expected.intrinsicValue) < 1e-9,
    `evaluateStock should match the calculator's rounded-input DCF; got ${r.intrinsic}, expected ${expected.intrinsicValue}`);
});
