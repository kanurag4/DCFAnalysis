// Three-stage DCF (method 4) in the screen engine (StockAnalysis plan Task 9): evaluateStock's Base equals the
// shared computeScenarios() three-stage Base for the same data and rates; output shape and reason codes unchanged.
// Fixtures + computeScenarios come from the sibling StockAnalysis repo (skipped when it isn't checked out).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { evaluateStock } = require('../scripts/lib/evaluate.js');
const { marketParamsFor } = require('../scripts/lib/market.js');
const { fetchSymbol } = require('../scripts/fetch-yahoo.js');
const { convertFinancials } = require('../scripts/lib/convert-financials.js');

const SA = path.join(__dirname, '..', '..', 'StockAnalysis');
const HAVE_SA = fs.existsSync(path.join(SA, 'tests', 'fixtures', 'three-stage'));
const fixture = (n) => JSON.parse(fs.readFileSync(path.join(SA, 'tests', 'fixtures', 'three-stage', n + '.json'), 'utf8')).data;

function shared(data) {
  const A = require(path.join(SA, 'tests', 'helpers', 'assumptions-globals.js'));
  const a = A.deriveDcfAssumptions(data);
  return { a, sc: A.computeScenarios(data, 'dcf', a.modelSeeds.dcf, { threeStage: true, holdcoDiscount: a.holdcoDiscount }) };
}

test('three-stage on: evaluateStock Base = the shared three-stage Base (NVDA, MU, KO, HON)', { skip: !HAVE_SA && 'no ../StockAnalysis' }, () => {
  for (const name of ['nvda', 'mu', 'ko', 'hon']) {
    const data = fixture(name);
    const { sc } = shared(data);
    const r = evaluateStock(data, marketParamsFor(data.ticker, {}), { threeStage: true });
    assert.strictEqual(r.excluded, undefined, name + ' valued');
    assert.strictEqual(r.method, 'DCF', name);
    assert.strictEqual(r.fcfMethod, 'three-stage', name);
    assert.ok(Math.abs(r.intrinsic / sc[1].result.intrinsicValue - 1) < 1e-9, `${name}: ${r.intrinsic} vs ${sc[1].result.intrinsicValue}`);
    assert.strictEqual(r.wacc, sc[1].wacc, name + ' wacc');
    assert.ok(Math.abs(r.marginOfSafety - (r.intrinsic - data.price) / data.price) < 1e-9, name);
    assert.ok(r.terminalValuePct > 0 && r.terminalValuePct < 100, name);
  }
});

test('three-stage on: heavy capex keeps its own method (MSFT)', { skip: !HAVE_SA && 'no ../StockAnalysis' }, () => {
  const msft = fixture('msft');
  const on = evaluateStock(msft, marketParamsFor('MSFT', {}), { threeStage: true });
  assert.strictEqual(on.fcfMethod, 'heavy-capex');
  assert.deepStrictEqual(on, evaluateStock(msft, marketParamsFor('MSFT', {}), { threeStage: false }));
});

test('three-stage on: a negative 4-year margin is excluded as margin-negative', { skip: !HAVE_SA && 'no ../StockAnalysis' }, () => {
  const data = fixture('nvda');
  // A real loss: operating income AND net income negative (operating income alone negative is treated as a Yahoo error).
  const neg = (h) => h.map(e => ({ ...e, value: -Math.abs(e.value) }));
  const loss = { ...data, annualOperatingIncomeHistory: neg(data.annualOperatingIncomeHistory), annualNetIncomeHistory: neg(data.annualNetIncomeHistory) };
  const r = evaluateStock(loss, marketParamsFor(data.ticker, {}), { threeStage: true });
  assert.strictEqual(r.excluded, true);
  assert.strictEqual(r.reason, 'margin-negative');
});

test('three-stage on: banks keep their model (JPM), switch off keeps the classic DCF', { skip: !HAVE_SA && 'no ../StockAnalysis' }, () => {
  const jpm = fixture('jpm');
  assert.deepStrictEqual(evaluateStock(jpm, marketParamsFor('JPM', {}), { threeStage: true }), evaluateStock(jpm, marketParamsFor('JPM', {})));
  const nvda = fixture('nvda');
  const off = evaluateStock(nvda, marketParamsFor('NVDA', {}));
  assert.notStrictEqual(off.fcfMethod, 'three-stage');
  assert.deepStrictEqual(off, evaluateStock(nvda, marketParamsFor('NVDA', {}), { threeStage: false }));
});

test('the screen fetcher carries operating income and D&A history, FX-converted with the rest', async () => {
  const ts = {
    annualOperatingIncome: [{ date: '2024-06-30', value: 10 }], annualDepreciationAndAmortization: [{ date: '2024-06-30', value: 3 }],
    annualTotalRevenue: [{ date: '2024-06-30', value: 50 }],
  };
  const qs = { quoteSummary: { result: [{ financialData: { currentPrice: { raw: 40 }, financialCurrency: 'USD' },
    summaryDetail: { marketCap: { raw: 400 }, currency: 'AUD' }, assetProfile: { sector: 'Basic Materials', industry: 'Copper' },
    defaultKeyStatistics: { sharesOutstanding: { raw: 10 } }, quoteType: {} }] } };
  const fetchImpl = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/timeseries/') ? ts : qs) });
  const d = await fetchSymbol('TEST.AX', { proxyUrl: 'https://proxy', fetchImpl, retries: 0 });
  assert.deepStrictEqual(d.annualOperatingIncomeHistory, ts.annualOperatingIncome);
  assert.deepStrictEqual(d.annualDepreciationHistory, ts.annualDepreciationAndAmortization);
  const c = await convertFinancials(d, { proxyUrl: 'https://proxy', fxCache: new Map(), fetchFx: async () => 2 });
  assert.deepStrictEqual(c.annualOperatingIncomeHistory, [{ date: '2024-06-30', value: 20 }]);
  assert.deepStrictEqual(c.annualDepreciationHistory, [{ date: '2024-06-30', value: 6 }]);
});

test('ETF radar: a margin-negative holding falls back to EV/Sales like dcf-unavailable', () => {
  const { valueOne } = require('../scripts/lib/etf/run-etf-radar.js');
  const data = { sector: 'Technology', price: 90, totalRevenue: 2e9, totalDebt: 0, totalCash: 1e8, dilutedSharesOutstanding: 1e8 };
  const ev = valueOne('X', data, () => ({ excluded: true, reason: 'margin-negative' }));
  assert.strictEqual(ev.method, 'EV/Sales');
});

test('US only: with the switch on, non-US tickers keep the classic screen value (BHP.AX, 000660.KS)', { skip: !HAVE_SA && 'no ../StockAnalysis' }, () => {
  for (const name of ['bhp-ax', '000660-ks']) {
    const data = fixture(name);
    const p = marketParamsFor(data.ticker, {});
    assert.deepStrictEqual(evaluateStock(data, p, { threeStage: true }), evaluateStock(data, p, { threeStage: false }), name);
  }
});
