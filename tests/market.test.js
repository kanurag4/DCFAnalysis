const { test } = require('node:test');
const assert = require('node:assert');
const { marketParamsFor } = require('../scripts/lib/market.js');

// Refreshed 2026-09-11 (global bond selloff, oil-driven -- AU 10yr hit its highest
// since 2011): rf 0.052->0.0525. Refreshed again 2026-09-18 (selloff continuing,
// AU 10yr 5.32%, highest since mid-2011): rf 0.0525->0.0532.
test('ASX ticker gets AUS rf fallback and 6% erp', () => {
  assert.deepStrictEqual(marketParamsFor('BHP.AX'), { rf: 0.0532, erp: 0.06, terminalGrowth: 0.025 });
});

test('ASX ticker uses provided live rf when given', () => {
  assert.deepStrictEqual(marketParamsFor('BHP.AX', { ausRf: 0.041 }), { rf: 0.041, erp: 0.06, terminalGrowth: 0.025 });
});

// India rf corrected 2026-08-15 (double-counting fix), refreshed again 2026-09-04 against
// a fresh raw G-Sec yield -- see market.js's inline comment for the Damodaran spread math.
// Refreshed again 2026-09-11 (global bond selloff -- G-Sec crossed 7% for the first time
// in 3+ months): net rf 0.0509->0.0515, same spread. Refreshed again 2026-09-18 (raw
// G-Sec 7.05%, same spread): net rf 0.0515->0.0518.
test('Indian (.NS/.BO) ticker gets the spread-adjusted rf (not the raw G-Sec yield), unchanged erp/terminalGrowth', () => {
  assert.deepStrictEqual(marketParamsFor('RELIANCE.NS'), { rf: 0.0518, erp: 0.075, terminalGrowth: 0.025 });
  assert.deepStrictEqual(marketParamsFor('TATASTEEL.BO'), { rf: 0.0518, erp: 0.075, terminalGrowth: 0.025 });
});

test('Indian ticker uses provided live rf when given (same override mechanism as ASX)', () => {
  assert.deepStrictEqual(marketParamsFor('RELIANCE.NS', { indRf: 0.052 }), { rf: 0.052, erp: 0.075, terminalGrowth: 0.025 });
});

// Refreshed 2026-09-11 (global bond selloff, live ^TNX close 4.944%): rf 0.048->0.0494.
// Refreshed again 2026-09-18 (live ^TNX close 5.006%): rf 0.0494->0.0501.
test('US ticker (no suffix) gets US defaults', () => {
  assert.deepStrictEqual(marketParamsFor('AAPL'), { rf: 0.0501, erp: 0.055, terminalGrowth: 0.025 });
});

// Corrected 2026-08-15: rf was the raw KTB yield (double-counted Korea's country risk,
// already carried separately by erp) -- see market.js's inline comment for the
// Damodaran default-spread math. Raw yield refreshed again 2026-09-04, and again
// 2026-09-11 (global bond selloff -- raw yield closed at its highest since Oct 2022):
// net rf 0.040->0.0412, same spread. Refreshed again 2026-09-18 (raw yield eased back
// to 4.413% off its selloff peak): net rf 0.0412->0.0399.
test('Korean ticker gets the spread-adjusted rf (not the raw KTB yield), unchanged erp/terminalGrowth', () => {
  assert.deepStrictEqual(marketParamsFor('005930.KS'), { rf: 0.0399, erp: 0.075, terminalGrowth: 0.0175 });
});

test('Korean ticker ignores any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('005930.KS', { krRf: 0.09 }), { rf: 0.0399, erp: 0.075, terminalGrowth: 0.0175 });
});

// Corrected 2026-08-15: rf was the raw JGB yield (same double-counting as Korea/India).
// terminalGrowth also nudged down to stay in the same ~40-57%-of-rf band every other
// market bucket uses (not a ceiling violation either way, just ratio consistency).
// Raw yield refreshed again 2026-09-04 (this was the biggest gap of the 6 refreshed).
// Refreshed again 2026-09-18 (raw JGB 3.00%, near highest since Sept 1996, ahead of an
// expected BOJ hike): net rf 0.0236->0.0240.
test('Japanese ticker gets the spread-adjusted rf and the ratio-consistent lower terminalGrowth', () => {
  assert.deepStrictEqual(marketParamsFor('7203.T'), { rf: 0.0240, erp: 0.06, terminalGrowth: 0.012 });
});

test('Japanese ticker ignores any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('7203.T', { jpRf: 0.05 }), { rf: 0.0240, erp: 0.06, terminalGrowth: 0.012 });
});

test('.TO (Toronto) does not match the .T Japan branch', () => {
  assert.deepStrictEqual(marketParamsFor('SHOP.TO'), { rf: 0.0501, erp: 0.055, terminalGrowth: 0.025 });
});

// Refreshed 2026-09-11 (global bond selloff -- UK gilt hit a 19-year high): rf 0.0507->0.0530.
test('UK (.L) ticker gets fixed Gilt-proxy rf/erp/terminalGrowth, no live override possible', () => {
  assert.deepStrictEqual(marketParamsFor('HSBA.L'), { rf: 0.0530, erp: 0.06, terminalGrowth: 0.02 });
});

test('UK (.L) ticker ignores any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('HSBA.L', { ukRf: 0.09 }), { rf: 0.0530, erp: 0.06, terminalGrowth: 0.02 });
});

// Refreshed 2026-09-11 (global bond selloff -- German bund hit its highest since April
// 2011): rf 0.0335->0.0344. Refreshed again 2026-09-18 (selloff continuing, bund 3.51%):
// rf 0.0344->0.0351.
test('German (.DE) ticker gets fixed Bund-proxy rf/erp/terminalGrowth', () => {
  assert.deepStrictEqual(marketParamsFor('SAP.DE'), { rf: 0.0351, erp: 0.055, terminalGrowth: 0.018 });
});

test('French (.PA), Dutch (.AS), Italian (.MI), Spanish (.MC) tickers all get the same eurozone bucket', () => {
  const expected = { rf: 0.0351, erp: 0.055, terminalGrowth: 0.018 };
  assert.deepStrictEqual(marketParamsFor('MC.PA'), expected);
  assert.deepStrictEqual(marketParamsFor('ASML.AS'), expected);
  assert.deepStrictEqual(marketParamsFor('ENI.MI'), expected);
  assert.deepStrictEqual(marketParamsFor('SAN.MC'), expected);
});

test('Belgian (.BR), Portuguese (.LS), Austrian (.VI), Finnish (.HE), Irish (.IR) tickers get the eurozone bucket', () => {
  const expected = { rf: 0.0351, erp: 0.055, terminalGrowth: 0.018 };
  assert.deepStrictEqual(marketParamsFor('ABI.BR'), expected);
  assert.deepStrictEqual(marketParamsFor('EDP.LS'), expected);
  assert.deepStrictEqual(marketParamsFor('OMV.VI'), expected);
  assert.deepStrictEqual(marketParamsFor('NOKIA.HE'), expected);
  assert.deepStrictEqual(marketParamsFor('RYA.IR'), expected);
});

test('eurozone tickers ignore any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('SAP.DE', { euRf: 0.09 }), { rf: 0.0351, erp: 0.055, terminalGrowth: 0.018 });
});

// China A-shares corrected 2026-08-15: rf was the raw CNY govt bond yield (same
// double-counting as India/Korea/Japan) -- proportionally the largest correction of the
// four, since China's default spread is a big chunk of its already-tiny base yield.
// terminalGrowth is a MANDATORY drop, not a ratio-consistency nudge -- the old 0.015
// literally exceeds the new, lower 0.011 rf, which would violate Damodaran's stable-growth
// ceiling the instant rf moved under it. Raw yield refreshed again 2026-09-04 (smallest
// move of the 4 spread-adjusted markets -- terminalGrowth still clears the new rf easily).
test('Shanghai (.SS) / Shenzhen (.SZ) tickers get the spread-adjusted rf and a terminalGrowth that still clears the (now lower) ceiling', () => {
  const expected = { rf: 0.0108, erp: 0.052, terminalGrowth: 0.006 };
  assert.deepStrictEqual(marketParamsFor('600519.SS'), expected);
  assert.deepStrictEqual(marketParamsFor('000001.SZ'), expected);
  assert.ok(expected.terminalGrowth < expected.rf, 'terminalGrowth must stay under rf (Damodaran stable-growth ceiling)');
});

// ETF radar (2026-08-31): thematic-fund holdings pull in suffixes that previously
// hit the generic US-style fallback. Static Damodaran-style seeds, same posture as
// the no-live-source markets above — see market.js's inline comments.
test('Taiwan .TW gets a dedicated bucket, not the US fallback', () => {
  const p = marketParamsFor('2330.TW', {});
  assert.equal(p.rf, 0.0191); // refreshed 2026-09-06, was 0.017
  assert.equal(p.erp, 0.058);
  assert.equal(p.terminalGrowth, 0.012);
});

test('KOSDAQ .KQ reuses the Korea .KS parameters', () => {
  assert.deepEqual(marketParamsFor('012450.KQ', {}), marketParamsFor('012450.KS', {}));
});

test('Israel .TA, Switzerland .SW, Sweden .ST, Norway .OL, Singapore .SI each resolve to a non-US bucket', () => {
  for (const t of ['ESLT.TA', 'ABBN.SW', 'SAAB-B.ST', 'KOG.OL', 'S63.SI']) {
    const p = marketParamsFor(t, {});
    assert.ok(p.rf !== 0.0501 || p.erp !== 0.055, `${t} still hitting the US fallback`);
  }
});
