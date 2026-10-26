const { test } = require('node:test');
const assert = require('node:assert/strict');
const { diffInputs, historyDiffs, modelOf, compareTicker, summarise } = require('../scripts/lib/parity.js');

const dcf = (intrinsic, extra = {}) => ({ method: 'DCF', intrinsic, altmanZ: { score: 4.2, zone: 'safe' }, piotroskiF: { score: 7, maxScore: 9 }, ...extra });
const STORE = { quoteSummary: 'store', timeseries: 'store' };

test('diffInputs: equal -> none; within 0.5% -> none; beyond -> one entry; one-sided -> one entry', () => {
  const y = { totalRevenue: 1000, name: 'A', hist: [{ date: '2025', value: 10 }], nested: { beta: 1.1 } };
  assert.deepEqual(diffInputs(y, structuredClone(y)), []);
  assert.deepEqual(diffInputs(y, { ...y, totalRevenue: 1004 }), []);
  assert.deepEqual(diffInputs(y, { ...y, totalRevenue: 1006 }), [{ field: 'totalRevenue', yahoo: 1000, other: 1006 }]);
  assert.deepEqual(diffInputs(y, { ...y, extra: 5 }), [{ field: 'extra', yahoo: undefined, other: 5 }]);
  assert.deepEqual(diffInputs(y, { ...y, hist: [{ date: '2025', value: 12 }] }), [{ field: 'hist[0].value', yahoo: 10, other: 12 }]);
  assert.deepEqual(diffInputs(y, { ...y, nested: { beta: 1.2 } }), [{ field: 'nested.beta', yahoo: 1.1, other: 1.2 }]);
  assert.deepEqual(diffInputs({ a: 0 }, { a: 0 }), []);
  assert.deepEqual(diffInputs({ a: null }, { a: 0 }), [{ field: 'a', yahoo: null, other: 0 }]);
});

test('modelOf names the model, or the exclusion reason', () => {
  assert.equal(modelOf(dcf(10)), 'DCF');
  assert.equal(modelOf({ excluded: true, reason: 'dcf-unavailable' }), 'excluded:dcf-unavailable');
  assert.equal(modelOf(null), 'no-data');
});

test('compareTicker: same model and Base within 0.5% passes; 0.51% fails; different model fails', () => {
  const pass = compareTicker({ ticker: 'AAPL', market: 'us', yahoo: { data: {}, result: dcf(100) }, store: { data: {}, result: dcf(100.5) }, sources: STORE });
  assert.equal(pass.pass, true);
  assert.equal(pass.symbol, 'AAPL');
  assert.equal(pass.check_kind, 'store');
  assert.equal(pass.diff_pct, 0.5);
  const fail = compareTicker({ ticker: 'AAPL', market: 'us', yahoo: { data: {}, result: dcf(100) }, store: { data: {}, result: dcf(100.51) }, sources: STORE });
  assert.equal(fail.pass, false);
  const model = compareTicker({ ticker: 'JPM', market: 'us', yahoo: { data: {}, result: { method: 'DDM', intrinsic: 100 } }, store: { data: {}, result: dcf(100) }, sources: STORE });
  assert.equal(model.pass, false);
  assert.equal(model.model_yahoo, 'DDM');
  assert.equal(model.model_other, 'DCF');
});

test('compareTicker: both excluded for the same reason passes with no Base', () => {
  const ex = { excluded: true, reason: 'dcf-unavailable', altmanZ: null, piotroskiF: null };
  const r = compareTicker({ ticker: 'RIVN', market: 'us', yahoo: { data: {}, result: ex }, store: { data: {}, result: { ...ex } }, sources: STORE });
  assert.equal(r.pass, true);
  assert.equal(r.base_yahoo, null);
  assert.equal(r.diff_pct, null);
});

test('compareTicker: a solvency difference fails', () => {
  const r = compareTicker({ ticker: 'X', market: 'us', yahoo: { data: {}, result: dcf(100) },
    store: { data: {}, result: dcf(100, { piotroskiF: { score: 6, maxScore: 9 } }) }, sources: STORE });
  assert.equal(r.pass, false);
  assert.ok(r.diffs.some(d => d.field === 'solvency.piotroskiF'));
});

test('compareTicker: a store miss is recorded as such and never passes', () => {
  const r = compareTicker({ ticker: 'X', market: 'us', yahoo: { data: {}, result: dcf(100) }, store: { data: {}, result: dcf(100) },
    sources: { quoteSummary: 'store-miss', timeseries: 'store' } });
  assert.equal(r.pass, false);
  assert.equal(r.model_other, 'store-miss');
  assert.equal(r.base_yahoo, 100, 'the Yahoo side is still shown');
  const noData = compareTicker({ ticker: 'X', market: 'us', yahoo: { data: {}, result: dcf(100) }, store: { data: null, result: null }, sources: STORE });
  assert.equal(noData.pass, false);
  assert.equal(noData.model_other, 'no-data');
});

test('compareTicker: input diffs are reported, history diffs are appended', () => {
  const r = compareTicker({ ticker: 'X', market: 'us', yahoo: { data: { beta: 1 }, result: dcf(100) }, store: { data: { beta: 2 }, result: dcf(100) },
    sources: STORE, extraDiffs: [{ field: 'history.tail', yahoo: '2026-10-27', other: '2026-10-26', note: '1 newer Yahoo bar(s)' }] });
  assert.deepEqual(r.diffs.map(d => d.field), ['beta', 'history.tail']);
  assert.equal(r.pass, true, 'input diffs and newer Yahoo bars are evidence, not failures');
});

test('compareTicker: a stored price that disagrees with Yahoo, or no store history, fails', () => {
  const base = { ticker: 'X', market: 'us', yahoo: { data: {}, result: dcf(100) }, store: { data: {}, result: dcf(100) }, sources: STORE };
  assert.equal(compareTicker({ ...base, extraDiffs: [{ field: 'history[2026-03-02].close', yahoo: 10, other: 5 }] }).pass, false);
  assert.equal(compareTicker({ ...base, extraDiffs: [{ field: 'history', yahoo: 250, other: null, note: 'no store history' }] }).pass, false);
  assert.equal(compareTicker({ ...base, extraDiffs: [{ field: 'source.history', yahoo: 'yahoo', other: 'store-miss' }] }).pass, false);
});

test('historyDiffs: compares overlapping dates, notes a missing tail, caps the list', () => {
  const y = [{ date: '2026-01-02', close: 10 }, { date: '2026-01-05', close: 11 }, { date: '2026-01-06', close: 12 }];
  assert.deepEqual(historyDiffs(y, y), []);
  const tailOnly = historyDiffs(y, y.slice(0, 2));
  assert.deepEqual(tailOnly, [{ field: 'history.tail', yahoo: '2026-01-06', other: '2026-01-05', note: '1 newer Yahoo bar(s)' }]);
  const changed = historyDiffs(y, [{ date: '2026-01-02', close: 10 }, { date: '2026-01-05', close: 13 }, { date: '2026-01-06', close: 12 }]);
  assert.deepEqual(changed, [{ field: 'history[2026-01-05].close', yahoo: 11, other: 13 }]);
  assert.deepEqual(historyDiffs(y, null), [{ field: 'history', yahoo: 3, other: null, note: 'no store history' }]);
  const many = Array.from({ length: 30 }, (_, i) => ({ date: `2026-02-${String(i + 1).padStart(2, '0')}`, close: 1 }));
  const off = many.map(p => ({ ...p, close: 2 }));
  assert.equal(historyDiffs(many, off).length, 6, '5 listed + one count line');
});

test('summarise counts per market and per model', () => {
  const rows = [
    { market: 'us', model_yahoo: 'DCF', pass: true },
    { market: 'us', model_yahoo: 'DDM', pass: false },
    { market: 'asx', model_yahoo: 'DCF', pass: true },
  ];
  assert.deepEqual(summarise(rows), {
    byMarket: { us: { pass: 1, fail: 1 }, asx: { pass: 1, fail: 0 } },
    byModel: { DCF: { pass: 2, fail: 0 }, DDM: { pass: 0, fail: 1 } },
  });
});
