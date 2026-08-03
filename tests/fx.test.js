// tests/fx.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  toEurPrice, toEurRows, toEurFirstSeen, toEurDividends, prepareEurRebalanceInputs,
} = require('../scripts/lib/fx.js');

const RATES = { GBP: 1.17, USD: 0.92 };

test('toEurPrice: GBp (pence) divides by 100 then multiplies by the rate', () => {
  // 1090p = £10.90; at 1.17 EUR/GBP -> €12.753
  assert.equal(toEurPrice(1090, 'GBp', RATES), 12.753);
});

test('toEurPrice: GBP (pounds) multiplies by the rate directly', () => {
  assert.equal(toEurPrice(10.90, 'GBP', RATES), 12.753);
});

test('toEurPrice: EUR passes through unconverted', () => {
  assert.equal(toEurPrice(45.5, 'EUR', RATES), 45.5);
});

test('toEurPrice: USD converts using the USD rate (CPG.L/IHG.L are LSE-listed but USD-quoted)', () => {
  assert.equal(toEurPrice(100, 'USD', RATES), 92);
});

test('toEurPrice: missing currency is treated as EUR (already the target currency)', () => {
  assert.equal(toEurPrice(45.5, undefined, RATES), 45.5);
});

test('toEurPrice: a currency with no rate passes through unchanged (caller surfaces it)', () => {
  assert.equal(toEurPrice(45.5, 'CHF', RATES), 45.5);
});

test('toEurPrice: null rates returns price unconverted (fail-open)', () => {
  assert.equal(toEurPrice(1090, 'GBp', null), 1090);
});

test('toEurPrice: null/non-finite price passes through', () => {
  assert.equal(toEurPrice(null, 'GBp', RATES), null);
  assert.equal(Number.isNaN(toEurPrice(NaN, 'GBp', RATES)), true); // NaN in -> NaN out, no throw
});

test('toEurRows: converts snapshotPrice per row using a ticker->currency lookup', () => {
  const rows = [{ ticker: 'HSBA.L', snapshotPrice: 650 }, { ticker: 'SAP.DE', snapshotPrice: 180 }];
  const out = toEurRows(rows, { 'HSBA.L': 'GBp', 'SAP.DE': 'EUR' }, RATES);
  assert.equal(out[0].snapshotPrice, 7.605); // 650p -> £6.50 -> €7.605
  assert.equal(out[1].snapshotPrice, 180);   // already EUR
  assert.equal(rows[0].snapshotPrice, 650);  // original untouched (shallow copy)
});

test('toEurRows: null rates returns rows unchanged (same reference values)', () => {
  const rows = [{ ticker: 'HSBA.L', snapshotPrice: 650 }];
  assert.deepEqual(toEurRows(rows, { 'HSBA.L': 'GBp' }, null), rows);
});

test('toEurRows: records a rate-less currency in the unconvertible set', () => {
  const unconvertible = new Set();
  toEurRows([{ ticker: 'NESN.SW', snapshotPrice: 90 }], { 'NESN.SW': 'CHF' }, RATES, unconvertible);
  assert.deepEqual([...unconvertible], ['NESN.SW:CHF']);
});

test('toEurFirstSeen: converts firstPrice per ticker using the current rate', () => {
  const firstSeen = { 'HSBA.L': { firstSeen: '2026-01-05', firstPrice: 620 } };
  const out = toEurFirstSeen(firstSeen, { 'HSBA.L': 'GBp' }, RATES);
  assert.equal(out['HSBA.L'].firstPrice, 7.254); // 620p -> £6.20 -> €7.254
  assert.equal(out['HSBA.L'].firstSeen, '2026-01-05'); // other fields preserved
});

test('toEurFirstSeen: entry with no firstPrice is passed through unchanged', () => {
  const firstSeen = { XYZ: { firstSeen: '2026-01-05' } };
  assert.deepEqual(toEurFirstSeen(firstSeen, {}, RATES), firstSeen);
});

test('toEurDividends: GBp dividend converts pence -> EUR (regression: was ~85x overstated)', () => {
  // Aviva pays ~11.3p; at 1.17 that is £0.113 -> €0.13221
  const out = toEurDividends({ 'AV.L': 11.3 }, { 'AV.L': 'GBp' }, RATES);
  assert.equal(out['AV.L'], 0.13221);
});

test('toEurDividends: EUR dividend passes through unconverted', () => {
  assert.deepEqual(toEurDividends({ 'SAP.DE': 2.5 }, { 'SAP.DE': 'EUR' }, RATES), { 'SAP.DE': 2.5 });
});

test('toEurDividends: null rates returns the map unchanged (fail-open)', () => {
  const divs = { 'AV.L': 11.3 };
  assert.deepEqual(toEurDividends(divs, { 'AV.L': 'GBp' }, null), divs);
});

// The bug this whole conversion exists to prevent, expressed as the invariant that
// actually matters downstream: computeRebalance() computes shares from the EUR price
// and then multiplies by the dividend, so dividend and price MUST share a currency
// basis. Converting both at oldFx makes the rate cancel, leaving the true native
// dividend yield -- which is exactly what every single-currency market produces.
test('dividend/price unit consistency: divCash equals slotValue x native dividend yield', () => {
  const slotValue = 500;
  const oldPriceNative = 693.4;   // AV.L in pence
  const dividendNative = 11.3;    // pence per share
  const oldFx = { GBP: 1.169 };

  const oldPriceEur = toEurPrice(oldPriceNative, 'GBp', oldFx);
  const dividendEur = toEurDividends({ 'AV.L': dividendNative }, { 'AV.L': 'GBp' }, oldFx)['AV.L'];

  const shares  = slotValue / oldPriceEur;   // computeRebalance's formula
  const divCash = shares * dividendEur;      // computeRebalance's formula

  const expected = slotValue * (dividendNative / oldPriceNative); // ~€8.15, the true yield
  assert.ok(Math.abs(divCash - expected) < 1e-6, `expected ~${expected}, got ${divCash}`);
  assert.ok(divCash < 10, `divCash ${divCash} must be a few euro on a 500 slot, not hundreds`);
});

test('prepareEurRebalanceInputs: no-ops when either rate set is missing', () => {
  const inputs = {
    oldRows: [{ ticker: 'A' }], newRows: [{ ticker: 'B' }], allEvaluated: [{ ticker: 'C' }],
    firstSeen: { A: {} }, dividendsByTicker: { A: 1 }, oldRates: null, newRates: RATES,
  };
  assert.deepEqual(prepareEurRebalanceInputs(inputs), {
    oldRows: inputs.oldRows, newRows: inputs.newRows, allEvaluated: inputs.allEvaluated,
    firstSeen: inputs.firstSeen, dividendsByTicker: inputs.dividendsByTicker, unconvertible: [],
  });
});

test('prepareEurRebalanceInputs: converts old rows with oldRates and new rows with newRates (captures FX drift)', () => {
  const oldRows = [{ ticker: 'HSBA.L', snapshotPrice: 600, currency: 'GBp' }];
  const newRows = [{ ticker: 'HSBA.L', snapshotPrice: 650, currency: 'GBp' }];
  const allEvaluated = newRows;
  const out = prepareEurRebalanceInputs({
    oldRows, newRows, allEvaluated, firstSeen: {}, oldRates: { GBP: 1.10 }, newRates: { GBP: 1.20 },
  });
  assert.equal(out.oldRows[0].snapshotPrice, 6.6);   // 600p=£6.00 * 1.10
  assert.equal(out.newRows[0].snapshotPrice, 7.8);   // 650p=£6.50 * 1.20
  // ratio (7.8/6.6=1.1818) reflects BOTH the +8.3% native price move AND the
  // +9.1% GBP->EUR move -- this is the whole point of using oldFx/newFx, not one rate for both.
});

test('prepareEurRebalanceInputs: dividends use oldRates, not newRates', () => {
  const oldRows = [{ ticker: 'HSBA.L', snapshotPrice: 600, currency: 'GBp' }];
  const out = prepareEurRebalanceInputs({
    oldRows, newRows: oldRows, allEvaluated: oldRows, firstSeen: {},
    dividendsByTicker: { 'HSBA.L': 10 },
    oldRates: { GBP: 1.10 }, newRates: { GBP: 1.20 },
  });
  assert.equal(out.dividendsByTicker['HSBA.L'], 0.11); // 10p = £0.10 * 1.10 (old), not 1.20
});

test('prepareEurRebalanceInputs: derives currency lookup from oldRows and allEvaluated', () => {
  const oldRows = [{ ticker: 'SAP.DE', snapshotPrice: 180, currency: 'EUR' }];
  const newRows = [{ ticker: 'SAP.DE', snapshotPrice: 190 }]; // no currency on the new row itself
  const allEvaluated = [{ ticker: 'SAP.DE', snapshotPrice: 190, currency: 'EUR' }];
  const out = prepareEurRebalanceInputs({
    oldRows, newRows, allEvaluated, firstSeen: {}, oldRates: { GBP: 1.10 }, newRates: { GBP: 1.20 },
  });
  assert.equal(out.newRows[0].snapshotPrice, 190); // EUR -> no conversion regardless of rate
});

test('prepareEurRebalanceInputs: surfaces unconvertible currencies instead of silently mis-pooling', () => {
  const rows = [{ ticker: 'NESN.SW', snapshotPrice: 90, currency: 'CHF' }];
  const out = prepareEurRebalanceInputs({
    oldRows: rows, newRows: rows, allEvaluated: rows, firstSeen: {},
    oldRates: RATES, newRates: RATES,
  });
  assert.deepEqual(out.unconvertible, ['NESN.SW:CHF']);
});

test('prepareEurRebalanceInputs: USD holdings convert rather than pooling as EUR', () => {
  const rows = [{ ticker: 'CPG.L', snapshotPrice: 100, currency: 'USD' }];
  const out = prepareEurRebalanceInputs({
    oldRows: rows, newRows: rows, allEvaluated: rows, firstSeen: {},
    oldRates: RATES, newRates: RATES,
  });
  assert.equal(out.newRows[0].snapshotPrice, 92);
  assert.deepEqual(out.unconvertible, []);
});
