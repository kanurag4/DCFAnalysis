const { test } = require('node:test');
const assert = require('node:assert');
const { partialCorrelationAgainst, bandFor, bandLabel, MIN_TRADING_DAYS, AI_HARDWARE_ETF_TICKER } = require('../www/calc/aiCorrelation.js');

// The three-series call shape every test below uses: a stock, an AI benchmark (AIQ here), and the RSP market control.
const partialCorrelation = ({ stock, aiq, rsp }) => partialCorrelationAgainst({ stock, benchmark: aiq, market: rsp });

// Converts a returns array into a closes array (deterministic, starts at
// 100) so tests can construct known-shape return series without hand-typing
// price levels.
function closesFromReturns(returns, startDate) {
  let price = 100;
  const closes = [{ date: startDate, close: price }];
  const start = new Date(startDate + 'T00:00:00Z');
  for (let i = 0; i < returns.length; i++) {
    price = price * (1 + returns[i]);
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i + 1);
    closes.push({ date: d.toISOString().slice(0, 10), close: price });
  }
  return closes;
}

// Deterministic (no RNG) synthetic factor series, so tests are fully
// reproducible without hand-typing hundreds of numbers.
function marketFactor(n) {
  return Array.from({ length: n }, (_, i) => 0.004 * Math.sin(i * 0.7));
}
function aiFactor(n) {
  return Array.from({ length: n }, (_, i) => 0.006 * Math.sin(i * 1.9 + 1));
}

const N = 120; // > MIN_TRADING_DAYS (90) after the return-conversion step

test('partialCorrelation returns high positive r when stock shares AIQ\'s AI-specific component', () => {
  const mkt = marketFactor(N);
  const ai = aiFactor(N);
  const rspRets = mkt;
  const aiqRets = mkt.map((m, i) => m + ai[i]);
  const stockRets = mkt.map((m, i) => m + ai[i]); // same AI loading as AIQ

  const result = partialCorrelation({
    stock: closesFromReturns(stockRets, '2026-01-01'),
    aiq: closesFromReturns(aiqRets, '2026-01-01'),
    rsp: closesFromReturns(rspRets, '2026-01-01'),
  });

  assert.ok(result.r > 0.95, `expected r > 0.95, got ${result.r}`);
  assert.strictEqual(result.band, 'high');
});

test('partialCorrelation returns ~0 when stock has market + idiosyncratic moves but no AI-specific component', () => {
  const mkt = marketFactor(N);
  const ai = aiFactor(N);
  // Idiosyncratic noise, frequency chosen to be near-orthogonal to both factors over N=120
  // (probed: corr with ai ~ -0.011, with mkt ~ -0.010), so the expected partial r is ~0.
  const idio = Array.from({ length: N }, (_, i) => 0.005 * Math.sin(i * 3.3 + 2));
  const rspRets = mkt;
  const aiqRets = mkt.map((m, i) => m + ai[i]);
  const stockRets = mkt.map((m, i) => m + idio[i]);

  const result = partialCorrelation({
    stock: closesFromReturns(stockRets, '2026-01-01'),
    aiq: closesFromReturns(aiqRets, '2026-01-01'),
    rsp: closesFromReturns(rspRets, '2026-01-01'),
  });

  assert.ok(Math.abs(result.r) < 0.05, `expected r near 0, got ${result.r}`);
  assert.strictEqual(result.band, 'none');
});

test('a stock that is exactly the market has no AI-specific movement left to correlate, so it gets no reading (not a fake "None")', () => {
  const mkt = marketFactor(N);
  const ai = aiFactor(N);
  const result = partialCorrelation({
    stock: closesFromReturns(mkt, '2026-01-01'),                       // identical to RSP -- residual is exactly zero
    aiq: closesFromReturns(mkt.map((m, i) => m + ai[i]), '2026-01-01'),
    rsp: closesFromReturns(mkt, '2026-01-01'),
  });
  assert.deepStrictEqual([result.r, result.band], [null, null]);
  assert.ok(result.n > MIN_TRADING_DAYS);                              // enough days, so it is the zero variance that nulls it
});

test('a stock that is a scaled copy of the market gets no reading either (float noise in the residual must not be correlated)', () => {
  const mkt = marketFactor(N);
  const ai = aiFactor(N);
  const result = partialCorrelation({
    stock: closesFromReturns(mkt.map((m) => 1.7 * m), '2026-01-01'),
    aiq: closesFromReturns(mkt.map((m, i) => m + ai[i]), '2026-01-01'),
    rsp: closesFromReturns(mkt, '2026-01-01'),
  });
  assert.deepStrictEqual([result.r, result.band], [null, null]);
});

test('a flat-price stock (suspended, or never trades) gets no reading instead of reading "None"', () => {
  const mkt = marketFactor(N);
  const ai = aiFactor(N);
  const flat = closesFromReturns(new Array(N).fill(0), '2026-01-01');
  const result = partialCorrelation({
    stock: flat,
    aiq: closesFromReturns(mkt.map((m, i) => m + ai[i]), '2026-01-01'),
    rsp: closesFromReturns(mkt, '2026-01-01'),
  });
  assert.deepStrictEqual([result.r, result.band], [null, null]);
  assert.ok(result.n > MIN_TRADING_DAYS);
});

test('a flat benchmark gets no reading for the same reason', () => {
  const mkt = marketFactor(N);
  const result = partialCorrelationAgainst({
    stock: closesFromReturns(mkt.map((m, i) => m + 0.003 * Math.sin(i * 2.2)), '2026-01-01'),
    benchmark: closesFromReturns(new Array(N).fill(0), '2026-01-01'),
    market: closesFromReturns(mkt, '2026-01-01'),
  });
  assert.deepStrictEqual([result.r, result.band], [null, null]);
});

test('partialCorrelation returns null r/band when overlapping days is at or below MIN_TRADING_DAYS', () => {
  const shortN = MIN_TRADING_DAYS - 5;
  const mkt = marketFactor(shortN);
  const closes = closesFromReturns(mkt, '2026-01-01');

  const result = partialCorrelation({ stock: closes, aiq: closes, rsp: closes });

  assert.strictEqual(result.r, null);
  assert.strictEqual(result.band, null);
});

test('partialCorrelation counts only the date-intersection (international-ticker case)', () => {
  // Stock only trades on even-indexed days (simulates a foreign exchange
  // calendar with fewer overlapping days vs the US-listed AIQ/RSP) -- n
  // must reflect only the intersection, per spec's accepted §5 limitation.
  // Longer series than N: halving N=120 leaves ~60 aligned returns, below
  // MIN_TRADING_DAYS, which would (correctly) null the result instead.
  const LONG = 220;
  const mkt = marketFactor(LONG);
  const ai = aiFactor(LONG);
  const fullRsp = closesFromReturns(mkt, '2026-01-01');
  const fullAiq = closesFromReturns(mkt.map((m, i) => m + ai[i]), '2026-01-01');
  const fullStock = closesFromReturns(mkt.map((m, i) => m + ai[i]), '2026-01-01');
  const sparseStock = fullStock.filter((_, i) => i % 2 === 0);

  const result = partialCorrelation({ stock: sparseStock, aiq: fullAiq, rsp: fullRsp });

  assert.ok(result.n < fullStock.length - 1);
  assert.ok(result.n > MIN_TRADING_DAYS);
});

test('bandFor applies thresholds at the documented boundaries', () => {
  assert.strictEqual(bandFor(0.40), 'high');
  assert.strictEqual(bandFor(0.399), 'moderate');
  assert.strictEqual(bandFor(0.20), 'moderate');
  assert.strictEqual(bandFor(0.199), 'low');
  assert.strictEqual(bandFor(0.05), 'low');
  assert.strictEqual(bandFor(0.049), 'none');
  assert.strictEqual(bandFor(-0.199), 'none');
  assert.strictEqual(bandFor(-0.20), 'inverse');
  assert.strictEqual(bandFor(-0.5), 'inverse');
  assert.strictEqual(bandFor(null), null);
});

test('bandLabel maps band keys to display labels', () => {
  assert.strictEqual(bandLabel('high'), 'High');
  assert.strictEqual(bandLabel('moderate'), 'Moderate');
  assert.strictEqual(bandLabel('low'), 'Low');
  assert.strictEqual(bandLabel('none'), 'None');
  assert.strictEqual(bandLabel('inverse'), 'Inverse');
  assert.strictEqual(bandLabel('unknown'), null);
  assert.strictEqual(bandLabel('constructor'), null); // an inherited Object key is not a band
});

test("partialCorrelation returns a strongly negative r and the inverse band when the stock moves against AIQ's AI-specific component", () => {
  const mkt = marketFactor(N);
  const ai = aiFactor(N);
  const result = partialCorrelation({
    stock: closesFromReturns(mkt.map((m, i) => m - ai[i]), '2026-01-01'),
    aiq: closesFromReturns(mkt.map((m, i) => m + ai[i]), '2026-01-01'),
    rsp: closesFromReturns(mkt, '2026-01-01'),
  });
  assert.ok(result.r < -0.95, `expected r < -0.95, got ${result.r}`);
  assert.strictEqual(result.band, 'inverse');
});

test('the AI-hardware benchmark is the VanEck semiconductor ETF (SMH)', () => {
  assert.strictEqual(AI_HARDWARE_ETF_TICKER, 'SMH');
});

// A raw r of 0.3985 displays as "0.40" but used to be banded from the unrounded value (Moderate), so
// the screens/cards showed "0.40 Moderate" next to a documented High threshold of 0.40.
const idioNoise = (n) => Array.from({ length: n }, (_, i) => 0.005 * Math.sin(i * 3.3 + 2));
function aiLoadedWithNoise(weight) {
  const mkt = marketFactor(N);
  const ai = aiFactor(N);
  const idio = idioNoise(N);
  return partialCorrelation({
    stock: closesFromReturns(mkt.map((m, i) => m + ai[i] + weight * idio[i]), '2026-01-01'),
    aiq: closesFromReturns(mkt.map((m, i) => m + ai[i]), '2026-01-01'),
    rsp: closesFromReturns(mkt, '2026-01-01'),
  });
}

test('a raw r that rounds up to 0.40 is banded High, matching the value that is displayed', () => {
  const result = aiLoadedWithNoise(2.69); // raw r = 0.3985
  assert.strictEqual(result.r, 0.4);
  assert.strictEqual(result.band, 'high');
});

test('partialCorrelation returns r already rounded to 2dp, and the band always agrees with that displayed r', () => {
  for (const weight of [0, 0.5, 1, 1.5, 2, 2.69, 3, 4, 6, 10, 30]) {
    const { r, band } = aiLoadedWithNoise(weight);
    assert.strictEqual(r, Number(r.toFixed(2)), `weight ${weight}: r ${r} is not 2dp`);
    assert.strictEqual(band, bandFor(r), `weight ${weight}: band ${band} disagrees with displayed r ${r}`);
  }
});
