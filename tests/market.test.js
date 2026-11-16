// All 9 markets' rf pins refreshed 2026-10-15 against same-day TradingEconomics 10Y yields (docs/risk-free-rates.md, StockAnalysis).
const { test } = require('node:test');
const assert = require('node:assert');
const { marketParamsFor } = require('../scripts/lib/market.js');

// Refreshed 2026-09-11 (global bond selloff, oil-driven -- AU 10yr hit its highest
// since 2011): rf 0.052->0.0525. Refreshed again 2026-09-18 (selloff continuing,
// AU 10yr 5.32%, highest since mid-2011): rf 0.0525->0.0532. erp refreshed 2026-09-22
// against Damodaran's July 2026 country risk premium table (mature-market ERP base fell
// to 4.20%, Australia is Aaa-rated so its ERP equals that base directly): 0.06->0.0420.
// Refreshed again 2026-09-30 (TradingEconomics, AU 10yr 5.35%, selloff continuing):
// rf 0.0532->0.0535. Refreshed again 2026-10-01 (TradingEconomics, AU 10yr 5.42%): rf
// 0.0535->0.0542.
test('ASX ticker gets AUS rf fallback and 4.20% erp', () => {
  assert.deepStrictEqual(marketParamsFor('BHP.AX'), { rf: 0.0514, erp: 0.0420, terminalGrowth: 0.025 });
});

test('ASX ticker uses provided live rf when given', () => {
  assert.deepStrictEqual(marketParamsFor('BHP.AX', { ausRf: 0.041 }), { rf: 0.041, erp: 0.0420, terminalGrowth: 0.025 });
});

// India rf corrected 2026-08-15 (double-counting fix), refreshed again 2026-09-04 against
// a fresh raw G-Sec yield -- see market.js's inline comment for the Damodaran spread math.
// Refreshed again 2026-09-11 (global bond selloff -- G-Sec crossed 7% for the first time
// in 3+ months): net rf 0.0509->0.0515, same spread. Refreshed again 2026-09-18 (raw
// G-Sec 7.05%, same spread): net rf 0.0515->0.0518. Refreshed again 2026-09-22 against
// Damodaran's July 2026 table: Baa3 default spread compressed 1.87%->1.75%, so net rf
// moved UP despite the same 7.05% raw yield: 0.0518->0.0530. erp (same July 2026 table):
// 0.075->0.0692. Refreshed again 2026-09-30 (raw G-Sec 7.15%, TradingEconomics, same
// unchanged spread): net rf 0.0530->0.0540.
test('Indian (.NS/.BO) ticker gets the spread-adjusted rf (not the raw G-Sec yield), refreshed erp', () => {
  assert.deepStrictEqual(marketParamsFor('RELIANCE.NS'), { rf: 0.0556, erp: 0.0692, terminalGrowth: 0.025 });
  assert.deepStrictEqual(marketParamsFor('TATASTEEL.BO'), { rf: 0.0556, erp: 0.0692, terminalGrowth: 0.025 });
});

test('Indian ticker uses provided live rf when given (same override mechanism as ASX)', () => {
  assert.deepStrictEqual(marketParamsFor('RELIANCE.NS', { indRf: 0.052 }), { rf: 0.052, erp: 0.0692, terminalGrowth: 0.025 });
});

// Refreshed 2026-09-11 (global bond selloff, live ^TNX close 4.944%): rf 0.048->0.0494.
// Refreshed again 2026-09-18 (live ^TNX close 5.006%): rf 0.0494->0.0501. erp refreshed
// 2026-09-22 against Damodaran's July 2026 table (mature-market ERP base fell to 4.20%,
// US carries a small Aa1 default spread on top): 0.055->0.0442. rf re-netted 2026-10-15 (docs/TODO.md P31):
// the raw 0.0501 less that same 0.22% Aa1 default spread = 0.0479, since erp above already carries it.
test('US ticker (no suffix) gets US defaults', () => {
  assert.deepStrictEqual(marketParamsFor('AAPL'), { rf: 0.0480, erp: 0.0442, terminalGrowth: 0.025 });
});

// Corrected 2026-08-15: rf was the raw KTB yield (double-counted Korea's country risk,
// already carried separately by erp) -- see market.js's inline comment for the
// Damodaran default-spread math. Raw yield refreshed again 2026-09-04, and again
// 2026-09-11 (global bond selloff -- raw yield closed at its highest since Oct 2022):
// net rf 0.040->0.0412, same spread. Refreshed again 2026-09-18 (raw yield eased back
// to 4.413% off its selloff peak): net rf 0.0412->0.0399. Refreshed again 2026-09-22
// against Damodaran's July 2026 table: Aa2 default spread compressed 0.42%->0.39%, so
// net rf moved UP despite the same 4.413% raw yield: 0.0399->0.0402. erp (same July 2026
// table) is by far the biggest single-market move of this refresh -- Korea's old 0.075
// had drifted to match India's rate rather than reflecting its own (much stronger) Aa2
// rating, a real correction rather than routine drift: 0.075->0.0481. Refreshed again
// 2026-09-30 (raw yield eased further to 4.40%, TradingEconomics, same unchanged spread):
// net rf 0.0402->0.0401.
test('Korean ticker gets the spread-adjusted rf (not the raw KTB yield), corrected erp', () => {
  assert.deepStrictEqual(marketParamsFor('005930.KS'), { rf: 0.0361, erp: 0.0481, terminalGrowth: 0.0175 });
});

test('Korean ticker ignores any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('005930.KS', { krRf: 0.09 }), { rf: 0.0361, erp: 0.0481, terminalGrowth: 0.0175 });
});

// Corrected 2026-08-15: rf was the raw JGB yield (same double-counting as Korea/India).
// terminalGrowth also nudged down to stay in the same ~40-57%-of-rf band every other
// market bucket uses (not a ceiling violation either way, just ratio consistency).
// Raw yield refreshed again 2026-09-04 (this was the biggest gap of the 6 refreshed).
// Refreshed again 2026-09-18 (raw JGB 3.00%, near highest since Sept 1996, ahead of an
// expected BOJ hike): net rf 0.0236->0.0240. Refreshed again 2026-09-22 against
// Damodaran's July 2026 table: A1 default spread compressed 0.60%->0.56%, so net rf
// moved UP despite the same 3.00% raw yield: 0.0240->0.0244. erp (same July 2026 table):
// 0.06->0.0507. Refreshed again 2026-09-30 (raw JGB 3.07%, TradingEconomics, same
// unchanged spread): net rf 0.0244->0.0251.
test('Japanese ticker gets the spread-adjusted rf and the ratio-consistent lower terminalGrowth', () => {
  assert.deepStrictEqual(marketParamsFor('7203.T'), { rf: 0.0232, erp: 0.0507, terminalGrowth: 0.012 });
});

test('Japanese ticker ignores any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('7203.T', { jpRf: 0.05 }), { rf: 0.0232, erp: 0.0507, terminalGrowth: 0.012 });
});

test('.TO (Toronto) does not match the .T Japan branch', () => {
  assert.deepStrictEqual(marketParamsFor('SHOP.TO'), { rf: 0.0480, erp: 0.0442, terminalGrowth: 0.025 });
});

// Refreshed 2026-09-11 (global bond selloff -- UK gilt hit a 19-year high): rf 0.0507->0.0530.
// erp refreshed 2026-09-22 against Damodaran's July 2026 table (UK is Aa3-rated):
// 0.06->0.0494. Refreshed again 2026-09-30 (TradingEconomics gilt yield 5.38%, selloff
// continuing): rf 0.0530->0.0538. Refreshed again 2026-10-01 (gilt yield 5.44%): rf
// 0.0538->0.0544. Re-netted 2026-10-15 (docs/TODO.md P35): UK is Aa3, so the 0.0494 erp already carries a
// 0.48% default spread -- the raw 0.0544 less that spread = 0.0496.
test('UK (.L) ticker gets fixed Gilt-proxy rf/erp/terminalGrowth, no live override possible', () => {
  assert.deepStrictEqual(marketParamsFor('HSBA.L'), { rf: 0.0486, erp: 0.0494, terminalGrowth: 0.02 });
});

test('UK (.L) ticker ignores any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('HSBA.L', { ukRf: 0.09 }), { rf: 0.0486, erp: 0.0494, terminalGrowth: 0.02 });
});

// Refreshed 2026-09-11 (global bond selloff -- German bund hit its highest since April
// 2011): rf 0.0335->0.0344. Refreshed again 2026-09-18 (selloff continuing, bund 3.51%):
// rf 0.0344->0.0351. erp refreshed 2026-09-22 against Damodaran's July 2026 table
// (Germany is Aaa-rated, its ERP equals the mature-market base directly): 0.055->0.0420.
// Refreshed again 2026-09-30 (TradingEconomics bund yield 3.59%, selloff continuing):
// rf 0.0351->0.0359.
test('German (.DE) ticker gets fixed Bund-proxy rf/erp/terminalGrowth', () => {
  assert.deepStrictEqual(marketParamsFor('SAP.DE'), { rf: 0.0338, erp: 0.0420, terminalGrowth: 0.018 });
});

// France split out 2026-10-23: the OAT traded ~174bp over the Bund (Oct 22). Damodaran values every euro asset off one
// euro risk-free rate (the Bund) and puts country risk in the ERP -- France is Aa3, total ERP 4.94% (Jul 2026).
test('French (.PA) tickers get the Bund rate plus France’s own Aa3 ERP, same as the live tool', () => {
  assert.deepStrictEqual(marketParamsFor('MC.PA'), { rf: 0.0338, erp: 0.0494, terminalGrowth: 0.018 });
});

test('Dutch (.AS), Italian (.MI), Spanish (.MC) tickers all get the same eurozone bucket', () => {
  const expected = { rf: 0.0338, erp: 0.0420, terminalGrowth: 0.018 };
  assert.deepStrictEqual(marketParamsFor('ASML.AS'), expected);
  assert.deepStrictEqual(marketParamsFor('ENI.MI'), expected);
  assert.deepStrictEqual(marketParamsFor('SAN.MC'), expected);
});

test('Belgian (.BR), Portuguese (.LS), Austrian (.VI), Finnish (.HE), Irish (.IR) tickers get the eurozone bucket', () => {
  const expected = { rf: 0.0338, erp: 0.0420, terminalGrowth: 0.018 };
  assert.deepStrictEqual(marketParamsFor('ABI.BR'), expected);
  assert.deepStrictEqual(marketParamsFor('EDP.LS'), expected);
  assert.deepStrictEqual(marketParamsFor('OMV.VI'), expected);
  assert.deepStrictEqual(marketParamsFor('NOKIA.HE'), expected);
  assert.deepStrictEqual(marketParamsFor('RYA.IR'), expected);
});

test('eurozone tickers ignore any live rf passed in (no live source exists)', () => {
  assert.deepStrictEqual(marketParamsFor('SAP.DE', { euRf: 0.09 }), { rf: 0.0338, erp: 0.0420, terminalGrowth: 0.018 });
});

// China A-shares corrected 2026-08-15: rf was the raw CNY govt bond yield (same
// double-counting as India/Korea/Japan) -- proportionally the largest correction of the
// four, since China's default spread is a big chunk of its already-tiny base yield.
// terminalGrowth is a MANDATORY drop, not a ratio-consistency nudge -- the old 0.015
// literally exceeds the new, lower 0.011 rf, which would violate Damodaran's stable-growth
// ceiling the instant rf moved under it. Raw yield refreshed again 2026-09-04 (smallest
// move of the 4 spread-adjusted markets -- terminalGrowth still clears the new rf easily).
// Refreshed again 2026-09-22 against Damodaran's July 2026 table: A1 default spread
// compressed 0.60%->0.56%, so net rf moved UP despite the same 1.68% raw yield:
// 0.0108->0.0112 (still clears terminalGrowth with margin to spare). erp (same July 2026
// table, same A1 rating bucket as Japan): 0.052->0.0507.
test('Shanghai (.SS) / Shenzhen (.SZ) tickers get the spread-adjusted rf and a terminalGrowth that still clears the (now lower) ceiling', () => {
  const expected = { rf: 0.0110, erp: 0.0507, terminalGrowth: 0.006 };
  assert.deepStrictEqual(marketParamsFor('600519.SS'), expected);
  assert.deepStrictEqual(marketParamsFor('000001.SZ'), expected);
  assert.ok(expected.terminalGrowth < expected.rf, 'terminalGrowth must stay under rf (Damodaran stable-growth ceiling)');
});

// Brazil (.SA), 2026-11-16: the live tool has had a 'br' bucket since 2026-10-17, but this file
// fell through to the US seed (4.8% rf), so a generated Brazil ticker page would value against a
// third of Brazil's rate and contradict /evaluate/. Must read the same table as the live tool.
test('Brazil (.SA) tickers read the live tool\'s br bucket, not the US seed', () => {
  const { FALLBACK_RF, MARKET_ERP, MARKET_TGROWTH } = require('../www/calc/assumptions.js');
  const p = marketParamsFor('PETR4.SA');
  assert.strictEqual(p.rf, FALLBACK_RF.br);
  assert.strictEqual(p.erp, MARKET_ERP.br);
  assert.strictEqual(p.terminalGrowth, Number((MARKET_TGROWTH.br / 100).toFixed(6)));
  assert.notStrictEqual(p.rf, FALLBACK_RF.us);
  assert.ok(p.terminalGrowth < p.rf, 'terminalGrowth must stay under rf (Damodaran stable-growth ceiling)');
  // A live US rate must never leak into Brazil.
  assert.strictEqual(marketParamsFor('VALE3.SA', { usRf: 0.05 }).rf, FALLBACK_RF.br);
});

// ETF radar (2026-08-31): thematic-fund holdings pull in suffixes that previously
// hit the generic US-style fallback. Static Damodaran-style seeds, same posture as
// the no-live-source markets above — see market.js's inline comments. These 6 markets
// have no www/ mirror (ETF-radar-only, hand-maintained locally) and were NOT touched by
// the 2026-09-22 MARKET_ERP refresh -- that refresh only covers the 9 markets shared
// with the live web tool via calc/assumptions.js. See docs/risk-free-rates.md.
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
    assert.ok(p.rf !== 0.0480 || p.erp !== 0.0442, `${t} still hitting the US fallback`);
  }
});

test('Denmark .CO uses the eurozone bucket (DKK is euro-pegged) -- not the US default', () => {
  // Before 2026-10-07 a Danish ticker fell through to the US-seed default.
  assert.deepEqual(marketParamsFor('NOVO-B.CO', {}), marketParamsFor('SAP.DE', {}));
  assert.notEqual(marketParamsFor('DSV.CO', {}).rf, marketParamsFor('AAPL', {}).rf);
});
