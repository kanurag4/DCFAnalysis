const { test } = require('node:test');
const assert = require('node:assert/strict');

const { reitValue, airlineValue } = require('../scripts/lib/etf/sector-models.js');

// The shared primitives these must not drift from — same modules ticker-page.js
// and the live DCF tool use.
const { deriveFfo, deriveAffo, calculateReitValue } = require('../www/calc/reit.js');
const { calculateAirlineValue } = require('../www/calc/airline.js');
const { REIT_SECTOR_MULTIPLES, AIRLINE_EV_EBITDA_MULTIPLE } = require('../www/config.js');

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `expected ~${b}, got ${a}`);

// ── reitValue ──────────────────────────────────────────────────────────────

test('reitValue: FFO = NI + D&A, AFFO = FFO − |capex|, ÷ shares, × sector multiple', () => {
  // NI 100 + D&A 50 = FFO 150; − |−30| capex = AFFO 120; ÷ 10 shares = 12/sh;
  // industry "REIT - Industrial" → ×18 = 216 intrinsic; vs price 200 → +8%.
  const r = reitValue({
    netIncome: 100, depreciationAndAmortization: 50, capitalExpenditures: -30,
    sharesOutstanding: 10, industry: 'REIT - Industrial', price: 200,
  });
  assert.equal(r.method, 'REIT');
  near(r.intrinsic, 216);
  near(r.marginOfSafety, 0.08);
});

test('reitValue: an unrecognised REIT industry falls back to the DEFAULT multiple', () => {
  // AFFO/sh 10 × DEFAULT(14) = 140 vs price 100 → +40%.
  const r = reitValue({
    netIncome: 100, depreciationAndAmortization: 0, capitalExpenditures: 0,
    sharesOutstanding: 10, industry: 'REIT - Something New', price: 100,
  });
  near(r.marginOfSafety, (10 * REIT_SECTOR_MULTIPLES.DEFAULT - 100) / 100);
});

test('reitValue: prefers dilutedSharesOutstanding over sharesOutstanding when it is positive', () => {
  const base = {
    netIncome: 200, depreciationAndAmortization: 0, capitalExpenditures: 0,
    industry: 'REIT - Retail', price: 100,
  };
  const diluted = reitValue({ ...base, sharesOutstanding: 10, dilutedSharesOutstanding: 20 });
  const basic = reitValue({ ...base, sharesOutstanding: 10, dilutedSharesOutstanding: 0 });
  near(diluted.intrinsic, (200 / 20) * REIT_SECTOR_MULTIPLES['REIT - Retail']);
  near(basic.intrinsic, (200 / 10) * REIT_SECTOR_MULTIPLES['REIT - Retail']);
});

test('reitValue: returns null when AFFO per share is ≤ 0 (a P/AFFO multiple on negative AFFO is meaningless)', () => {
  const r = reitValue({
    netIncome: -200, depreciationAndAmortization: 50, capitalExpenditures: -10,
    sharesOutstanding: 10, industry: 'REIT - Office', price: 100,
  });
  assert.equal(r, null);
});

test('reitValue: returns null when netIncome is missing', () => {
  assert.equal(reitValue({
    depreciationAndAmortization: 50, capitalExpenditures: -10,
    sharesOutstanding: 10, industry: 'REIT - Office', price: 100,
  }), null);
});

test('reitValue: returns null when current price is missing (no margin of safety to report)', () => {
  assert.equal(reitValue({
    netIncome: 100, depreciationAndAmortization: 50, capitalExpenditures: -10,
    sharesOutstanding: 10, industry: 'REIT - Industrial', price: null,
  }), null);
});

test('reitValue: matches ticker-page.js’s REIT base-case formula exactly (no calc drift)', () => {
  const data = {
    netIncome: 873_000_000, depreciationAndAmortization: 1_240_000_000,
    capitalExpenditures: -410_000_000, sharesOutstanding: 250_000_000,
    dilutedSharesOutstanding: 252_300_000, industry: 'REIT - Healthcare Facilities',
    price: 61.4,
  };
  // Replicate ticker-page.js:783-796's base scenario inline, from the same primitives.
  const ffo = deriveFfo({ netIncome: data.netIncome, depreciationAndAmortization: data.depreciationAndAmortization });
  const affo = deriveAffo({ ffo: ffo.value, capex: data.capitalExpenditures });
  const shares = data.dilutedSharesOutstanding > 0 ? data.dilutedSharesOutstanding : data.sharesOutstanding;
  const affoPerShare = affo.value / shares;
  const key = REIT_SECTOR_MULTIPLES[data.industry] != null ? data.industry : 'DEFAULT';
  const expected = calculateReitValue({ affoPerShare, multiple: REIT_SECTOR_MULTIPLES[key], currentPrice: data.price });

  const r = reitValue(data);
  near(r.intrinsic, expected.intrinsicValue);
  near(r.marginOfSafety, expected.marginOfSafety);
});

// ── airlineValue ───────────────────────────────────────────────────────────

test('airlineValue: EV = EBITDA × 6, equity = EV − netDebt, ÷ shares, vs price', () => {
  // EBITDA 100 × 6 = 600 EV; netDebt = 200 − 50 = 150; equity 450; ÷ 10 = 45/sh;
  // vs price 40 → +12.5%.
  const a = airlineValue({
    ebitda: 100, totalDebt: 200, totalCash: 50, sharesOutstanding: 10, price: 40,
  });
  assert.equal(a.method, 'Airline');
  near(a.intrinsic, 45);
  near(a.marginOfSafety, 0.125);
});

test('airlineValue: returns null when EBITDA is ≤ 0', () => {
  assert.equal(airlineValue({ ebitda: -5, totalDebt: 10, totalCash: 5, sharesOutstanding: 10, price: 40 }), null);
});

test('airlineValue: returns null when net debt exceeds enterprise value (equity value ≤ 0)', () => {
  assert.equal(airlineValue({ ebitda: 10, totalDebt: 5000, totalCash: 0, sharesOutstanding: 10, price: 40 }), null);
});

test('airlineValue: prefers dilutedSharesOutstanding when positive', () => {
  const base = { ebitda: 120, totalDebt: 100, totalCash: 40, price: 30 };
  const diluted = airlineValue({ ...base, sharesOutstanding: 10, dilutedSharesOutstanding: 12 });
  near(diluted.intrinsic, (120 * AIRLINE_EV_EBITDA_MULTIPLE - 60) / 12);
});

test('airlineValue: matches ticker-page.js’s airline base-case formula exactly (no calc drift)', () => {
  const data = {
    ebitda: 7_100_000_000, totalDebt: 21_000_000_000, totalCash: 6_400_000_000,
    sharesOutstanding: 640_000_000, dilutedSharesOutstanding: 651_000_000, price: 46.2,
  };
  const shares = data.dilutedSharesOutstanding > 0 ? data.dilutedSharesOutstanding : data.sharesOutstanding;
  const expected = calculateAirlineValue({
    ebitda: data.ebitda, multiple: AIRLINE_EV_EBITDA_MULTIPLE,
    totalDebt: data.totalDebt, totalCash: data.totalCash,
    sharesOutstanding: shares, currentPrice: data.price,
  });
  const a = airlineValue(data);
  near(a.intrinsic, expected.intrinsicValue);
  near(a.marginOfSafety, expected.marginOfSafety);
});
