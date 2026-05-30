const assert = require('assert');
const { test } = require('node:test');
const {
  safe, fmt, isBankOrInsurance, isFinancialSector, isRealEstateSector,
  isAsxTicker, getAsxSectorWaccRange,
  deriveBaseGrowth, deriveDividendGrowth, getMarketBetaFloor,
} = require('../www/utils.js');

// ── isAsxTicker ──────────────────────────────────────────────────────────────

test('isAsxTicker: returns true for .AX suffix', () => {
  assert.ok(isAsxTicker('CBA.AX'));
  assert.ok(isAsxTicker('bhp.ax')); // case-insensitive
});

test('isAsxTicker: returns false for non-ASX tickers', () => {
  assert.ok(!isAsxTicker('AAPL'));
  assert.ok(!isAsxTicker('LLOY.L'));
  assert.ok(!isAsxTicker('RELIANCE.NS'));
  assert.ok(!isAsxTicker(null));
});

// ── getAsxSectorWaccRange ─────────────────────────────────────────────────────

test('getAsxSectorWaccRange: banking sector', () => {
  const r = getAsxSectorWaccRange('Financial Services', 'Banks—Diversified');
  assert.strictEqual(r.range, '8.5–9.5%');
});

test('getAsxSectorWaccRange: mining sector', () => {
  const r = getAsxSectorWaccRange('Basic Materials', 'Copper Mining');
  assert.strictEqual(r.range, '10.0–12.0%');
});

test('getAsxSectorWaccRange: utilities sector', () => {
  const r = getAsxSectorWaccRange('Utilities', 'Utilities—Regulated Gas');
  assert.strictEqual(r.range, '6.5–8.0%');
});

test('getAsxSectorWaccRange: healthcare sector', () => {
  const r = getAsxSectorWaccRange('Healthcare', 'Biotechnology');
  assert.strictEqual(r.range, '8.5–10.0%');
});

test('getAsxSectorWaccRange: real estate sector', () => {
  const r = getAsxSectorWaccRange('Real Estate', 'REIT—Industrial');
  assert.strictEqual(r.range, '7.5–9.0%');
});

test('getAsxSectorWaccRange: returns null for unknown sector', () => {
  assert.strictEqual(getAsxSectorWaccRange('Technology', 'Software'), null);
  assert.strictEqual(getAsxSectorWaccRange(null, null), null);
});

// ── isBankOrInsurance ────────────────────────────────────────────────────────

test('isBankOrInsurance: matches bank in industry', () => {
  assert.ok(isBankOrInsurance('Financial Services', 'Banks—Diversified'));
});

test('isBankOrInsurance: matches bank in sector (fix 5)', () => {
  // Yahoo returns null industry for some foreign banks — must match sector too
  assert.ok(isBankOrInsurance('Banking', null));
});

test('isBankOrInsurance: matches insurance in industry', () => {
  assert.ok(isBankOrInsurance('Financial Services', 'Insurance—Property & Casualty'));
});

test('isBankOrInsurance: matches insurance in sector', () => {
  assert.ok(isBankOrInsurance('Insurance', null));
});

test('isBankOrInsurance: does not match asset manager', () => {
  assert.ok(!isBankOrInsurance('Financial Services', 'Asset Management'));
});

test('isBankOrInsurance: does not match fintech (Visa/Mastercard pattern)', () => {
  assert.ok(!isBankOrInsurance('Financial Services', 'Credit Services'));
});

test('isBankOrInsurance: handles null sector and industry', () => {
  assert.ok(!isBankOrInsurance(null, null));
});

// ── deriveDividendGrowth ─────────────────────────────────────────────────────

test('deriveDividendGrowth: caps at 6% regardless of earnings spike', () => {
  assert.strictEqual(deriveDividendGrowth(0.30, 0.25), 0.06);
});

test('deriveDividendGrowth: uses earningsGrowth first', () => {
  assert.strictEqual(deriveDividendGrowth(0.04, 0.10), 0.04);
});

test('deriveDividendGrowth: falls back to revenueGrowth if earningsGrowth null', () => {
  assert.strictEqual(deriveDividendGrowth(null, 0.05), 0.05);
});

test('deriveDividendGrowth: clamps negative growth to 0', () => {
  assert.strictEqual(deriveDividendGrowth(-0.10, -0.05), 0);
});

test('deriveDividendGrowth: returns 0.04 default when both null', () => {
  assert.strictEqual(deriveDividendGrowth(null, null), 0.04);
});

// ── getMarketBetaFloor ───────────────────────────────────────────────────────

test('getMarketBetaFloor: US ticker has no floor', () => {
  assert.strictEqual(getMarketBetaFloor('AAPL'), 0);
  assert.strictEqual(getMarketBetaFloor('MSFT'), 0);
});

test('getMarketBetaFloor: ASX ticker floored at 0.5', () => {
  assert.strictEqual(getMarketBetaFloor('CBA.AX'), 0.5);
  assert.strictEqual(getMarketBetaFloor('QBE.AX'), 0.5);
});

test('getMarketBetaFloor: Indian tickers floored at 0.6', () => {
  assert.strictEqual(getMarketBetaFloor('RELIANCE.NS'), 0.6);
  assert.strictEqual(getMarketBetaFloor('TATAMOTORS.BO'), 0.6);
});

test('getMarketBetaFloor: other international tickers floored at 0.5', () => {
  assert.strictEqual(getMarketBetaFloor('LLOY.L'), 0.5);
  assert.strictEqual(getMarketBetaFloor('SAP.DE'), 0.5);
});

test('getMarketBetaFloor: handles null/empty gracefully', () => {
  assert.strictEqual(getMarketBetaFloor(null), 0);
  assert.strictEqual(getMarketBetaFloor(''), 0);
});

// ── deriveBaseGrowth ─────────────────────────────────────────────────────────

test('deriveBaseGrowth: averages revenue and earnings growth', () => {
  const result = deriveBaseGrowth(0.10, 0.20);
  assert.ok(Math.abs(result - 0.15) < 1e-10, `Expected ~0.15, got ${result}`);
});

test('deriveBaseGrowth: clamps to 0.25 max', () => {
  assert.strictEqual(deriveBaseGrowth(0.30, 0.40), 0.25);
});

test('deriveBaseGrowth: clamps to -0.05 min', () => {
  assert.strictEqual(deriveBaseGrowth(-0.20, -0.10), -0.05);
});

test('deriveBaseGrowth: uses single valid value when other is null', () => {
  assert.strictEqual(deriveBaseGrowth(0.08, null), 0.08);
});

test('deriveBaseGrowth: returns 0.05 default when both null', () => {
  assert.strictEqual(deriveBaseGrowth(null, null), 0.05);
});
