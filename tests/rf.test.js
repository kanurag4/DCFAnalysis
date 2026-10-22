const { test } = require('node:test');
const assert = require('node:assert');
const { fetchRfRate, fetchUsRf, fetchIndRf, fetchIndexPrice, fetchFxRate, fetchEurFxRates } = require('../scripts/lib/rf.js');
const { FALLBACK_RF } = require('../www/calc/assumptions.js');

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ~${b}, got ${a}`);
// Minimal raw quoteSummary body with one summaryDetail field populated -- still used by
// fetchFxRate below, which is unrelated to fetchRfRate's 2026-09-11 quoteSummary->history
// switch (see rf.js's inline comment).
const detail = (field, raw) => ({ quoteSummary: { result: [{ summaryDetail: { [field]: { raw } } }] } });
// Minimal /history-shaped body: a single day's close, matching fetchIndexPrice's tests below.
const history = (close) => [{ date: '2026-09-10', close }];

// fetchRfRate switched from quoteSummary to /history 2026-09-11 -- found live during a
// global bond selloff that quoteSummary's previousClose for ^TNX was a day-plus stale.
// Same underlying mechanism as fetchIndexPrice, so these mirror its test shape.
test('reads the last /history close, percent -> decimal (4.25 -> 0.0425)', async () => {
  const r = await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => history(4.25) });
  near(r, 0.0425);
});

test('reads the last entry when /history has multiple days (ascending by date)', async () => {
  const days = [{ date: '2026-09-08', close: 4.0 }, { date: '2026-09-09', close: 4.1 }, { date: '2026-09-10', close: 4.94 }];
  const r = await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => days });
  near(r, 0.0494);
});

test('falls back when the body is empty, not an array, or null', async () => {
  near(await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => [] }), 0.045);
  near(await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => ({}) }), 0.045);
  near(await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => null }), 0.045);
});

test('falls back when out of the plausible band', async () => {
  near(await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => history(0) }), 0.045);
  near(await fetchRfRate('^GSBG10.AX', 0.048, { proxyUrl: 'x', fetchImpl: async () => history(99) }), 0.048);
});

test('falls back when the fetch throws', async () => {
  near(await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchImpl: async () => { throw new Error('boom'); } }), 0.045);
});

// fetchUsRf -- docs/TODO.md P31 (2026-10-15): ^TNX is the raw Treasury yield, which already prices the US's own
// (Aa1) default risk, the same risk MARKET_ERP.us carries -- so using it raw counted it twice. fetchUsRf returns
// Damodaran's "dollar riskfree rate": the yield less the 0.22% US default spread. This is the batch's actual live
// US rf source (ticker pages, the 6 screens, the ETF radar). The SAME table is asserted against the Worker's /rates
// path in StockAnalysis/tests/us-rf-default-spread.test.js -- keep the two identical.
const YIELD_TO_RF = [
  [5.29, 0.0507], // Damodaran's own worked example (Musings on Markets, 2026-10-08)
  [5.09, 0.0487],
  [5.27, 0.0505],
  [5.0, 0.0478],
  [4.944, 0.0472],
  [4.75, 0.0453],
];
test('fetchUsRf returns the ^TNX yield less the US default spread (same table as the Worker path)', async () => {
  for (const [closePct, expected] of YIELD_TO_RF) {
    const r = await fetchUsRf('x', { fetchImpl: async () => history(closePct) });
    assert.strictEqual(r, expected, `${closePct}%`); // exact: the decimal literal, no float noise
  }
});

test('fetchUsRf falls back to the already-net static default when the live fetch fails -- never subtracts the spread from it a second time', async () => {
  assert.strictEqual(await fetchUsRf('x', { fetchImpl: async () => ({}) }), FALLBACK_RF.us);
  assert.strictEqual(await fetchUsRf('x', { fetchImpl: async () => { throw new Error('boom'); } }), FALLBACK_RF.us);
  assert.strictEqual(await fetchUsRf('x', { fetchImpl: async () => history(99) }), FALLBACK_RF.us); // out of the plausible band
});

// fetchIndRf — corrected 2026-08-15: subtracts India's Damodaran default spread from
// the raw ^INBMKG10.NS G-Sec yield (erp already carries India's country risk premium,
// so the raw yield alone double-counts it). This is the batch's actual live rf source
// for NIFTY -- it overrides market.js's static fallback whenever it succeeds, which is
// why market.js's own fallback fix alone didn't change the batch's real output.
test('fetchIndRf subtracts the default spread from a live-fetched raw yield (6.80% -> ~5.05%)', async () => {
  const r = await fetchIndRf('x', { fetchImpl: async () => history(6.80) });
  near(r, 0.0505);
});

// Default refreshed 2026-09-11 alongside assumptions.js's FALLBACK_RF.ind (0.0509->0.0515,
// global bond selloff -- G-Sec crossed 7% for the first time in 3+ months, same spread) --
// fetchIndRf reads this straight from assumptions.js, so no code change was needed here.
// Refreshed again 2026-09-18 (raw G-Sec 7.05%, same spread): 0.0515->0.0518. Refreshed
// again 2026-09-22 against Damodaran's July 2026 table (Baa3 spread compressed
// 1.87%->1.75%, net rf moved UP despite the same raw yield): 0.0518->0.0530. Refreshed
// again 2026-09-30 (raw G-Sec 7.15%, TradingEconomics, same unchanged spread): 0.0530->0.0540.
test('fetchIndRf falls back to the already-spread-adjusted static default (0.0572) when the live fetch fails, not raw-0.07-minus-spread', async () => {
  near(await fetchIndRf('x', { fetchImpl: async () => ({}) }), 0.0572);
  near(await fetchIndRf('x', { fetchImpl: async () => { throw new Error('boom'); } }), 0.0572);
});

test('fetchIndRf floors at 1% even if the live yield were implausibly close to the spread', async () => {
  const r = await fetchIndRf('x', { fetchImpl: async () => history(2.0) });
  near(r, 0.01); // 2.0% - 1.75% = 0.25%, floored to 1%
});

// fetchIndexPrice — switched 2026-07-31 to read /history (last daily close)
// instead of quoteSummary, after finding quoteSummary stuck stale for index
// tickers during the July 2026 KOSPI/Nikkei volatility.
test('fetchIndexPrice returns the last entry\'s close from /history', async () => {
  const history = [
    { date: '2026-07-29', close: 100 },
    { date: '2026-07-30', close: 105 },
    { date: '2026-07-31', close: 110 },
  ];
  const price = await fetchIndexPrice('^N225', 'x', async () => history);
  near(price, 110);
});

test('fetchIndexPrice returns null on an empty history array', async () => {
  assert.strictEqual(await fetchIndexPrice('^N225', 'x', async () => []), null);
});

test('fetchIndexPrice returns null when the body is not an array', async () => {
  assert.strictEqual(await fetchIndexPrice('^N225', 'x', async () => null), null);
  assert.strictEqual(await fetchIndexPrice('^N225', 'x', async () => ({})), null);
});

test('fetchIndexPrice returns null on a non-positive or missing close', async () => {
  assert.strictEqual(await fetchIndexPrice('^N225', 'x', async () => [{ date: '2026-07-31', close: 0 }]), null);
  assert.strictEqual(await fetchIndexPrice('^N225', 'x', async () => [{ date: '2026-07-31' }]), null);
});

test('fetchIndexPrice returns null when the fetch throws', async () => {
  assert.strictEqual(await fetchIndexPrice('^N225', 'x', async () => { throw new Error('boom'); }), null);
});

test('fetchFxRate reads summaryDetail.previousClose with no /100 scaling', async () => {
  const r = await fetchFxRate('GBPEUR=X', { proxyUrl: 'x', fetchImpl: async () => detail('previousClose', 1.1723) });
  near(r, 1.1723);
});

// Returns null, not a fallback: a plausible-looking stand-in used to get persisted as
// if it were a real quote, then compared against the next run's real rate, inventing
// an FX move that never happened. Provenance is the caller's decision now.
test('fetchFxRate returns null when out of the plausible band', async () => {
  assert.strictEqual(await fetchFxRate('GBPEUR=X', { proxyUrl: 'x', fetchImpl: async () => detail('previousClose', 0.03) }), null);
  assert.strictEqual(await fetchFxRate('GBPEUR=X', { proxyUrl: 'x', fetchImpl: async () => detail('previousClose', 45) }), null);
});

test('fetchFxRate returns null when the fetch throws or returns nothing usable', async () => {
  assert.strictEqual(await fetchFxRate('GBPEUR=X', { proxyUrl: 'x', fetchImpl: async () => { throw new Error('boom'); } }), null);
  assert.strictEqual(await fetchFxRate('GBPEUR=X', { proxyUrl: 'x', fetchImpl: async () => ({}) }), null);
});

test('fetchEurFxRates marks source live when every rate is fetched', async () => {
  const orig = global.fetch;
  // Each currency has its own plausibility band, so serve a realistic rate per symbol.
  const live = { GBPEUR: 1.1, USDEUR: 0.9, CHFEUR: 1.05, SEKEUR: 0.088, DKKEUR: 0.134, NOKEUR: 0.086 };
  global.fetch = async (url) => {
    const key = Object.keys(live).find(k => String(url).includes(k));
    return { ok: true, json: async () => detail('previousClose', live[key]) };
  };
  try {
    const out = await fetchEurFxRates('http://x');
    assert.strictEqual(out.source, 'live');
    assert.deepEqual(out.missing, []);
    for (const [k, v] of Object.entries(live)) near(out.rates[k.slice(0, 3)], v);
  } finally { global.fetch = orig; }
});

test('fetchEurFxRates marks source fallback and lists missing when every fetch fails', async () => {
  const orig = global.fetch;
  global.fetch = async () => ({ ok: false, json: async () => ({}) });
  try {
    const out = await fetchEurFxRates('http://x');
    assert.strictEqual(out.source, 'fallback');
    assert.deepEqual(out.missing, ['GBP', 'USD', 'CHF', 'SEK', 'DKK', 'NOK']);
    near(out.rates.GBP, 1.17);  // documented stand-ins, but flagged as such
    near(out.rates.USD, 0.92);
    near(out.rates.CHF, 1.07);
    near(out.rates.SEK, 0.09);
    near(out.rates.DKK, 0.134);
    near(out.rates.NOK, 0.087);
  } finally { global.fetch = orig; }
});
