// tests/fx.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toEurPrice, toEurRows, toEurFirstSeen, prepareEurRebalanceInputs } = require('../scripts/lib/fx.js');

test('toEurPrice: GBp (pence) divides by 100 then multiplies by the rate', () => {
  // 1090p = £10.90; at 1.17 EUR/GBP -> €12.753
  assert.equal(toEurPrice(1090, 'GBp', 1.17), 12.753);
});

test('toEurPrice: GBP (pounds) multiplies by the rate directly', () => {
  assert.equal(toEurPrice(10.90, 'GBP', 1.17), 12.753);
});

test('toEurPrice: EUR passes through unconverted', () => {
  assert.equal(toEurPrice(45.5, 'EUR', 1.17), 45.5);
});

test('toEurPrice: unknown/missing currency passes through unconverted', () => {
  assert.equal(toEurPrice(45.5, undefined, 1.17), 45.5);
});

test('toEurPrice: null gbpEurRate returns price unconverted (fail-open)', () => {
  assert.equal(toEurPrice(1090, 'GBp', null), 1090);
});

test('toEurPrice: null/non-finite price passes through', () => {
  assert.equal(toEurPrice(null, 'GBp', 1.17), null);
  assert.equal(Number.isNaN(toEurPrice(NaN, 'GBp', 1.17)), true); // NaN input -> NaN passes through, no throw
});

test('toEurRows: converts snapshotPrice per row using a ticker->currency lookup', () => {
  const rows = [{ ticker: 'HSBA.L', snapshotPrice: 650 }, { ticker: 'SAP.DE', snapshotPrice: 180 }];
  const out = toEurRows(rows, { 'HSBA.L': 'GBp', 'SAP.DE': 'EUR' }, 1.17);
  assert.equal(out[0].snapshotPrice, 7.605); // 650p -> £6.50 -> €7.605
  assert.equal(out[1].snapshotPrice, 180);   // already EUR
  assert.equal(rows[0].snapshotPrice, 650);  // original untouched (shallow copy)
});

test('toEurRows: gbpEurRate null returns rows unchanged (same reference values)', () => {
  const rows = [{ ticker: 'HSBA.L', snapshotPrice: 650 }];
  assert.deepEqual(toEurRows(rows, { 'HSBA.L': 'GBp' }, null), rows);
});

test('toEurFirstSeen: converts firstPrice per ticker using the current rate', () => {
  const firstSeen = { 'HSBA.L': { firstSeen: '2026-01-05', firstPrice: 620 } };
  const out = toEurFirstSeen(firstSeen, { 'HSBA.L': 'GBp' }, 1.17);
  assert.equal(out['HSBA.L'].firstPrice, 7.254); // 620p -> £6.20 -> €7.254
  assert.equal(out['HSBA.L'].firstSeen, '2026-01-05'); // other fields preserved
});

test('toEurFirstSeen: entry with no firstPrice is passed through unchanged', () => {
  const firstSeen = { XYZ: { firstSeen: '2026-01-05' } };
  assert.deepEqual(toEurFirstSeen(firstSeen, {}, 1.17), firstSeen);
});

test('prepareEurRebalanceInputs: no-ops when either fx rate is missing', () => {
  const inputs = { oldRows: [{ ticker: 'A' }], newRows: [{ ticker: 'B' }], allEvaluated: [{ ticker: 'C' }], firstSeen: { A: {} }, oldFx: null, newFx: 1.17 };
  assert.deepEqual(prepareEurRebalanceInputs(inputs), {
    oldRows: inputs.oldRows, newRows: inputs.newRows, allEvaluated: inputs.allEvaluated, firstSeen: inputs.firstSeen,
  });
});

test('prepareEurRebalanceInputs: converts old rows with oldFx and new rows with newFx (captures FX drift)', () => {
  const oldRows = [{ ticker: 'HSBA.L', snapshotPrice: 600, currency: 'GBp' }];
  const newRows = [{ ticker: 'HSBA.L', snapshotPrice: 650, currency: 'GBp' }];
  const allEvaluated = newRows;
  const out = prepareEurRebalanceInputs({ oldRows, newRows, allEvaluated, firstSeen: {}, oldFx: 1.10, newFx: 1.20 });
  assert.equal(out.oldRows[0].snapshotPrice, 6.6);   // 600p=£6.00 * 1.10
  assert.equal(out.newRows[0].snapshotPrice, 7.8);   // 650p=£6.50 * 1.20
  // ratio (7.8/6.6=1.1818) reflects BOTH the +8.3% native price move AND the
  // +9.1% GBP->EUR move -- this is the whole point of using oldFx/newFx, not one rate for both.
});

test('prepareEurRebalanceInputs: derives currency lookup from oldRows and allEvaluated', () => {
  const oldRows = [{ ticker: 'SAP.DE', snapshotPrice: 180, currency: 'EUR' }];
  const newRows = [{ ticker: 'SAP.DE', snapshotPrice: 190 }]; // no currency on the new row itself
  const allEvaluated = [{ ticker: 'SAP.DE', snapshotPrice: 190, currency: 'EUR' }];
  const out = prepareEurRebalanceInputs({ oldRows, newRows, allEvaluated, firstSeen: {}, oldFx: 1.10, newFx: 1.20 });
  assert.equal(out.newRows[0].snapshotPrice, 190); // EUR -> no conversion regardless of rate
});
