const { test } = require('node:test');
const assert = require('node:assert');
const { marketParamsFor } = require('../scripts/lib/market.js');

test('ASX ticker gets AUS rf fallback and 6% erp', () => {
  assert.deepStrictEqual(marketParamsFor('BHP.AX'), { rf: 0.052, erp: 0.06, terminalGrowth: 0.025 });
});

test('ASX ticker uses provided live rf when given', () => {
  assert.deepStrictEqual(marketParamsFor('BHP.AX', { ausRf: 0.041 }), { rf: 0.041, erp: 0.06, terminalGrowth: 0.025 });
});

// India rf corrected 2026-08-15: raw G-Sec yield double-counted country risk (erp already
// carries it) -- see market.js's inline comment for the Damodaran default-spread math.
test('Indian (.NS/.BO) ticker gets the spread-adjusted rf (not the raw G-Sec yield), unchanged erp/terminalGrowth', () => {
  assert.deepStrictEqual(marketParamsFor('RELIANCE.NS'), { rf: 0.049, erp: 0.075, terminalGrowth: 0.025 });
  assert.deepStrictEqual(marketParamsFor('TATASTEEL.BO'), { rf: 0.049, erp: 0.075, terminalGrowth: 0.025 });
});

test('Indian ticker uses provided live rf when given (same override mechanism as ASX)', () => {
  assert.deepStrictEqual(marketParamsFor('RELIANCE.NS', { indRf: 0.052 }), { rf: 0.052, erp: 0.075, terminalGrowth: 0.025 });
});

test('US ticker (no suffix) gets US defaults', () => {
  assert.deepStrictEqual(marketParamsFor('AAPL'), { rf: 0.048, erp: 0.055, terminalGrowth: 0.025 });
});

// Corrected 2026-08-15: rf was the raw KTB yield (double-counted Korea's country risk,
// already carried separately by erp) -- see market.js's inline comment for the
// Damodaran default-spread math.
test('Korean ticker gets the spread-adjusted rf (not the raw KTB yield), unchanged erp/terminalGrowth', () => {
  assert.deepStrictEqual(marketParamsFor('005930.KS'), { rf: 0.039, erp: 0.075, terminalGrowth: 0.0175 });
});

test('Korean ticker ignores any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('005930.KS', { krRf: 0.09 }), { rf: 0.039, erp: 0.075, terminalGrowth: 0.0175 });
});

// Corrected 2026-08-15: rf was the raw JGB yield (same double-counting as Korea/India).
// terminalGrowth also nudged down to stay in the same ~40-57%-of-rf band every other
// market bucket uses (not a ceiling violation either way, just ratio consistency).
test('Japanese ticker gets the spread-adjusted rf and the ratio-consistent lower terminalGrowth', () => {
  assert.deepStrictEqual(marketParamsFor('7203.T'), { rf: 0.022, erp: 0.06, terminalGrowth: 0.012 });
});

test('Japanese ticker ignores any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('7203.T', { jpRf: 0.05 }), { rf: 0.022, erp: 0.06, terminalGrowth: 0.012 });
});

test('.TO (Toronto) does not match the .T Japan branch', () => {
  assert.deepStrictEqual(marketParamsFor('SHOP.TO'), { rf: 0.048, erp: 0.055, terminalGrowth: 0.025 });
});

test('UK (.L) ticker gets fixed Gilt-proxy rf/erp/terminalGrowth, no live override possible', () => {
  assert.deepStrictEqual(marketParamsFor('HSBA.L'), { rf: 0.050, erp: 0.06, terminalGrowth: 0.02 });
});

test('UK (.L) ticker ignores any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('HSBA.L', { ukRf: 0.09 }), { rf: 0.050, erp: 0.06, terminalGrowth: 0.02 });
});

test('German (.DE) ticker gets fixed Bund-proxy rf/erp/terminalGrowth', () => {
  assert.deepStrictEqual(marketParamsFor('SAP.DE'), { rf: 0.032, erp: 0.055, terminalGrowth: 0.018 });
});

test('French (.PA), Dutch (.AS), Italian (.MI), Spanish (.MC) tickers all get the same eurozone bucket', () => {
  const expected = { rf: 0.032, erp: 0.055, terminalGrowth: 0.018 };
  assert.deepStrictEqual(marketParamsFor('MC.PA'), expected);
  assert.deepStrictEqual(marketParamsFor('ASML.AS'), expected);
  assert.deepStrictEqual(marketParamsFor('ENI.MI'), expected);
  assert.deepStrictEqual(marketParamsFor('SAN.MC'), expected);
});

test('Belgian (.BR), Portuguese (.LS), Austrian (.VI), Finnish (.HE), Irish (.IR) tickers get the eurozone bucket', () => {
  const expected = { rf: 0.032, erp: 0.055, terminalGrowth: 0.018 };
  assert.deepStrictEqual(marketParamsFor('ABI.BR'), expected);
  assert.deepStrictEqual(marketParamsFor('EDP.LS'), expected);
  assert.deepStrictEqual(marketParamsFor('OMV.VI'), expected);
  assert.deepStrictEqual(marketParamsFor('NOKIA.HE'), expected);
  assert.deepStrictEqual(marketParamsFor('RYA.IR'), expected);
});

test('eurozone tickers ignore any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('SAP.DE', { euRf: 0.09 }), { rf: 0.032, erp: 0.055, terminalGrowth: 0.018 });
});

// China A-shares corrected 2026-08-15: rf was the raw CNY govt bond yield (same
// double-counting as India/Korea/Japan) -- proportionally the largest correction of the
// four, since China's default spread is a big chunk of its already-tiny base yield.
// terminalGrowth is a MANDATORY drop, not a ratio-consistency nudge -- the old 0.015
// literally exceeds the new, lower 0.011 rf, which would violate Damodaran's stable-growth
// ceiling the instant rf moved under it.
test('Shanghai (.SS) / Shenzhen (.SZ) tickers get the spread-adjusted rf and a terminalGrowth that still clears the (now lower) ceiling', () => {
  const expected = { rf: 0.011, erp: 0.052, terminalGrowth: 0.006 };
  assert.deepStrictEqual(marketParamsFor('600519.SS'), expected);
  assert.deepStrictEqual(marketParamsFor('000001.SZ'), expected);
  assert.ok(expected.terminalGrowth < expected.rf, 'terminalGrowth must stay under rf (Damodaran stable-growth ceiling)');
});

// ETF radar (2026-08-31): thematic-fund holdings pull in suffixes that previously
// hit the generic US-style fallback. Static Damodaran-style seeds, same posture as
// the no-live-source markets above — see market.js's inline comments.
test('Taiwan .TW gets a dedicated bucket, not the US fallback', () => {
  const p = marketParamsFor('2330.TW', {});
  assert.equal(p.rf, 0.017);
  assert.equal(p.erp, 0.058);
  assert.equal(p.terminalGrowth, 0.012);
});

test('KOSDAQ .KQ reuses the Korea .KS parameters', () => {
  assert.deepEqual(marketParamsFor('012450.KQ', {}), marketParamsFor('012450.KS', {}));
});

test('Israel .TA, Switzerland .SW, Sweden .ST, Norway .OL, Singapore .SI each resolve to a non-US bucket', () => {
  for (const t of ['ESLT.TA', 'ABBN.SW', 'SAAB-B.ST', 'KOG.OL', 'S63.SI']) {
    const p = marketParamsFor(t, {});
    assert.ok(p.rf !== 0.048 || p.erp !== 0.055, `${t} still hitting the US fallback`);
  }
});
