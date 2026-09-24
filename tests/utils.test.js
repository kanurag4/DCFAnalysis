const assert = require('assert');
const { test } = require('node:test');
const {
  safe, fmt, deriveFcf, isBankOrInsurance, isFinancialSector, isRealEstateSector, isReit, isAirline,
  isAsxTicker, getAsxSectorWaccRange, getUsSectorWaccRange, getIndianSectorWaccRange,
  deriveBaseGrowth, deriveDividendGrowth, getMarketBetaFloor, chooseFinancialModel,
  aiCorrPillHtml,
} = require('../www/utils.js');

// ── deriveFcf ────────────────────────────────────────────────────────────────

test('deriveFcf: prefers reported free cash flow', () => {
  const r = deriveFcf(500e6, 800e6, -400e6);
  assert.strictEqual(r.value, 500e6);
  assert.strictEqual(r.method, 'reported');
});

test('deriveFcf: reported FCF used even when negative', () => {
  const r = deriveFcf(-120e6, 800e6, -400e6);
  assert.strictEqual(r.value, -120e6);
  assert.strictEqual(r.method, 'reported');
});

test('deriveFcf: derives OCF minus CapEx when FCF missing', () => {
  // capital-intensive: OCF 1000, CapEx 700 → FCF 300 (proxy would have said 800)
  const r = deriveFcf(null, 1000e6, -700e6);
  assert.strictEqual(r.value, 300e6);
  assert.strictEqual(r.method, 'derived');
});

test('deriveFcf: CapEx magnitude used regardless of sign convention', () => {
  assert.strictEqual(deriveFcf(null, 1000, -700).value, 300);
  assert.strictEqual(deriveFcf(null, 1000, 700).value, 300);
});

test('deriveFcf: falls back to OCF x 0.8 only when CapEx also missing', () => {
  const r = deriveFcf(null, 1000e6, null);
  assert.strictEqual(r.value, 800e6);
  assert.strictEqual(r.method, 'proxy');
});

test('deriveFcf: returns null when no cash flow data and no annual fallback given', () => {
  const r = deriveFcf(null, null, null);
  assert.strictEqual(r.value, null);
  assert.strictEqual(r.method, 'none');
});

// Yahoo's financialData module only ever reports TTM figures. For some
// tickers (confirmed live: TECHM.NS) Yahoo simply never computes a TTM
// number — freeCashflow and operatingCashflow both come back as {} (empty,
// not just a missing key) — even though every individual fiscal year has a
// real, positive reported FCF via the /timeseries annualFreeCashFlow series.
// This tier is deliberately last-resort: only used when TTM data (reported
// AND OCF-derived AND the OCF proxy) is completely unavailable, since a
// stale full-fiscal-year number is still less current than any TTM-based
// estimate.
test('deriveFcf: falls back to latest annual FCF only when TTM is completely unavailable', () => {
  const r = deriveFcf(null, null, null, 54763e6);
  assert.strictEqual(r.value, 54763e6);
  assert.strictEqual(r.method, 'annual');
});

test('deriveFcf: annual fallback is NOT used when a TTM-based value (even the rough proxy) is available', () => {
  const r = deriveFcf(null, 1000e6, null, 54763e6);
  assert.strictEqual(r.value, 800e6);
  assert.strictEqual(r.method, 'proxy');
});

test('deriveFcf: still returns null when both TTM and annual data are unavailable', () => {
  const r = deriveFcf(null, null, null, null);
  assert.strictEqual(r.value, null);
  assert.strictEqual(r.method, 'none');
});

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

// ── getUsSectorWaccRange ──────────────────────────────────────────────────────

test('getUsSectorWaccRange: technology sector', () => {
  const r = getUsSectorWaccRange('Technology', 'Software—Application');
  assert.strictEqual(r.range, '8.5–10.5%');
});

test('getUsSectorWaccRange: biotech/pharma', () => {
  const r = getUsSectorWaccRange('Healthcare', 'Biotechnology');
  assert.strictEqual(r.range, '8.0–10.0%');
});

test('getUsSectorWaccRange: retail', () => {
  const r = getUsSectorWaccRange('Consumer Cyclical', 'Apparel Retail');
  assert.strictEqual(r.range, '7.5–8.5%');
});

test('getUsSectorWaccRange: aerospace & defense', () => {
  const r = getUsSectorWaccRange('Industrials', 'Aerospace & Defense');
  assert.strictEqual(r.range, '7.0–8.0%');
});

test('getUsSectorWaccRange: energy', () => {
  const r = getUsSectorWaccRange('Energy', 'Oil & Gas Integrated');
  assert.strictEqual(r.range, '6.5–7.5%');
});

test('getUsSectorWaccRange: REITs', () => {
  const r = getUsSectorWaccRange('Real Estate', 'REIT—Industrial');
  assert.strictEqual(r.range, '6.5–7.5%');
});

test('getUsSectorWaccRange: utilities', () => {
  const r = getUsSectorWaccRange('Utilities', 'Utilities—Regulated Electric');
  assert.strictEqual(r.range, '5.5–6.5%');
});

test('getUsSectorWaccRange: returns null for unmatched sector', () => {
  assert.strictEqual(getUsSectorWaccRange('Financial Services', 'Banks'), null);
  assert.strictEqual(getUsSectorWaccRange(null, null), null);
});

// ── getIndianSectorWaccRange ──────────────────────────────────────────────────

test('getIndianSectorWaccRange: IT sector', () => {
  const r = getIndianSectorWaccRange('Technology', 'Information Technology Services');
  assert.strictEqual(r.range, '11.0–14.0%');
});

test('getIndianSectorWaccRange: FMCG sector', () => {
  const r = getIndianSectorWaccRange('Consumer Defensive', 'Household & Personal Products');
  assert.strictEqual(r.range, '9.0–11.0%');
});

test('getIndianSectorWaccRange: Utilities sector', () => {
  const r = getIndianSectorWaccRange('Utilities', 'Utilities—Regulated Electric');
  assert.strictEqual(r.range, '8.0–10.0%');
});

test('getIndianSectorWaccRange: Pharma sector', () => {
  const r = getIndianSectorWaccRange('Healthcare', 'Drug Manufacturers');
  assert.strictEqual(r.range, '10.0–12.0%');
});

test('getIndianSectorWaccRange: Commodities sector', () => {
  const r = getIndianSectorWaccRange('Energy', 'Oil & Gas Integrated');
  assert.strictEqual(r.range, '11.0–13.0%');
});

test('getIndianSectorWaccRange: returns null for unknown sector', () => {
  assert.strictEqual(getIndianSectorWaccRange('Real Estate', null), null);
  assert.strictEqual(getIndianSectorWaccRange(null, null), null);
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

// ── isBankOrInsurance: Indian NBFC scoping (2026-08-15) ──
// "Credit Services" is Yahoo's tag for BOTH payment networks (Visa, Mastercard --
// real FCF, near-zero leverage) and NBFC lenders (Muthoot, Shriram, SBI Cards --
// no usable FCF, structurally similar to a bank). Ticker-suffix-scoped to .NS/.BO
// so the Visa/Mastercard case above stays untouched.
test('isBankOrInsurance: matches Credit Services for an Indian (.NS) ticker (NBFC)', () => {
  assert.ok(isBankOrInsurance('Financial Services', 'Credit Services', 'MUTHOOTFIN.NS'));
});

test('isBankOrInsurance: matches Credit Services for an Indian (.BO) ticker too', () => {
  assert.ok(isBankOrInsurance('Financial Services', 'Credit Services', 'MUTHOOTFIN.BO'));
});

test('isBankOrInsurance: matches Mortgage Finance for an Indian ticker', () => {
  assert.ok(isBankOrInsurance('Financial Services', 'Mortgage Finance', 'PNBHOUSING.NS'));
});

test('isBankOrInsurance: does NOT match Credit Services for a non-Indian ticker (Visa/Mastercard stay on DCF)', () => {
  assert.ok(!isBankOrInsurance('Financial Services', 'Credit Services', 'V'));
  assert.ok(!isBankOrInsurance('Financial Services', 'Credit Services', 'MA'));
});

test('isBankOrInsurance: omitting ticker entirely keeps pre-2026-08-15 behaviour (no NBFC match)', () => {
  assert.ok(!isBankOrInsurance('Financial Services', 'Credit Services'));
});

test('isBankOrInsurance: an Indian ticker with a genuinely different industry is unaffected', () => {
  assert.ok(!isBankOrInsurance('Technology', 'Software - Infrastructure', 'OFSS.NS'));
});

// ── chooseFinancialModel ─────────────────────────────────────────────────────
// Decides DDM vs Excess Return Model WITHIN the population isBankOrInsurance()
// already routed away from DCF. `growth` is always the already-capped rate from
// deriveDividendGrowth() (max 6%), never raw earnings growth.

test('chooseFinancialModel: normal payout ratio stays on DDM', () => {
  // roe=0.15, growth=0.06 -> sustainablePayout = 1 - 0.06/0.15 = 0.60
  // actualPayout = 5/10 = 0.50, which is NOT below 0.60*0.5=0.30 -> stays DDM
  const m = chooseFinancialModel({ roe: 0.15, dividend: 5, trailingEps: 10, growth: 0.06 });
  assert.strictEqual(m, 'ddm');
});

test('chooseFinancialModel: low payout ratio (Muthoot-style) switches to Excess Return', () => {
  // roe=0.317, growth=0.06 -> sustainablePayout = 1 - 0.06/0.317 = 0.8107
  // actualPayout = 30/279.94 = 0.1072, well below 0.8107*0.5=0.4054 -> excess-return
  const m = chooseFinancialModel({ roe: 0.317, dividend: 30, trailingEps: 279.94, growth: 0.06 });
  assert.strictEqual(m, 'excess-return');
});

test('chooseFinancialModel: roe missing falls back to DDM', () => {
  assert.strictEqual(chooseFinancialModel({ roe: null, dividend: 5, trailingEps: 10, growth: 0.06 }), 'ddm');
});

test('chooseFinancialModel: roe <= 0 falls back to DDM', () => {
  assert.strictEqual(chooseFinancialModel({ roe: -0.02, dividend: 5, trailingEps: 10, growth: 0.06 }), 'ddm');
});

test('chooseFinancialModel: roe <= growth (capped growth exceeds ROE) treats sustainable payout as 0, real payout still clears it -> DDM', () => {
  // roe=0.04, growth=0.06 -> roe <= growth -> sustainablePayout defined as 0
  // actualPayout = 5/10 = 0.50, which is not < 0*0.5=0 -> stays DDM
  const m = chooseFinancialModel({ roe: 0.04, dividend: 5, trailingEps: 10, growth: 0.06 });
  assert.strictEqual(m, 'ddm');
});

test('chooseFinancialModel: no dividend/EPS data treats actualPayout as 0 -- routes to Excess Return if sustainable payout is positive', () => {
  // roe=0.317, growth=0.06 -> sustainablePayout=0.8107; actualPayout=0 (no dividend) is below 0.5*0.8107
  const m = chooseFinancialModel({ roe: 0.317, dividend: null, trailingEps: 279.94, growth: 0.06 });
  assert.strictEqual(m, 'excess-return');
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

test('getMarketBetaFloor: Korean tickers floored at 0.6', () => {
  assert.strictEqual(getMarketBetaFloor('005930.KS'), 0.6);
  assert.strictEqual(getMarketBetaFloor('000660.KS'), 0.6);
});

test('getMarketBetaFloor: Japanese tickers floored at 0.6', () => {
  assert.strictEqual(getMarketBetaFloor('7203.T'), 0.6);
  assert.strictEqual(getMarketBetaFloor('6758.T'), 0.6);
});

test('getMarketBetaFloor: .TO (Toronto) is other-international 0.5, not the .T Japan floor', () => {
  assert.strictEqual(getMarketBetaFloor('SHOP.TO'), 0.5);
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

// ── isReit / isBankOrInsurance (REIT-Mortgage routing) ─────────────────────

test('isReit matches every property REIT sub-sector tag', () => {
  const industries = [
    'REIT - Retail', 'REIT - Residential', 'REIT - Industrial', 'REIT - Office',
    'REIT - Healthcare Facilities', 'REIT - Diversified', 'REIT - Hotel & Motel',
    'REIT - Specialty',
  ];
  for (const industry of industries) {
    assert.strictEqual(isReit('Real Estate', industry), true, `expected ${industry} to match`);
  }
});

test('isReit does NOT match REIT - Mortgage', () => {
  assert.strictEqual(isReit('Real Estate', 'REIT - Mortgage'), false);
});

test('isReit does NOT match non-REIT real estate companies', () => {
  assert.strictEqual(isReit('Real Estate', 'Real Estate Services'), false);
  assert.strictEqual(isReit('Real Estate', 'Real Estate—Development'), false);
});

test('isReit handles null/undefined sector or industry', () => {
  assert.strictEqual(isReit(null, null), false);
  assert.strictEqual(isReit(undefined, undefined), false);
  assert.strictEqual(isReit('Real Estate', null), false);
});

test('isBankOrInsurance now routes REIT - Mortgage to DDM/Excess-Return', () => {
  assert.strictEqual(isBankOrInsurance('Real Estate', 'REIT - Mortgage'), true);
});

test('isBankOrInsurance still does not match property REITs', () => {
  assert.strictEqual(isBankOrInsurance('Real Estate', 'REIT - Retail'), false);
});

// ── isAirline ────────────────────────────────────────────────────────────

test('isAirline matches the Airlines industry tag', () => {
  assert.strictEqual(isAirline('Industrials', 'Airlines'), true);
});

test('isAirline is case-insensitive', () => {
  assert.strictEqual(isAirline('Industrials', 'airlines'), true);
});

test('isAirline does NOT match other Industrials sub-sectors', () => {
  assert.strictEqual(isAirline('Industrials', 'Aerospace & Defense'), false);
  assert.strictEqual(isAirline('Industrials', 'Railroads'), false);
});

test('isAirline handles null/undefined sector or industry', () => {
  assert.strictEqual(isAirline(null, null), false);
  assert.strictEqual(isAirline(undefined, undefined), false);
  assert.strictEqual(isAirline('Industrials', null), false);
});

// ── aiCorrPillHtml (undervalued-screen AI Sector Correlation cell) ───────────

test('aiCorrPillHtml renders a banded pill with the 2dp value and label for each band', () => {
  assert.strictEqual(aiCorrPillHtml({ r: 0.684, n: 249, band: 'high' }),
    '<span class="ai-corr-pill ai-corr-pill-high">0.68 High</span>');
  assert.strictEqual(aiCorrPillHtml({ r: 0.25, n: 200, band: 'moderate' }),
    '<span class="ai-corr-pill ai-corr-pill-moderate">0.25 Moderate</span>');
  assert.strictEqual(aiCorrPillHtml({ r: 0.1, n: 200, band: 'low' }),
    '<span class="ai-corr-pill ai-corr-pill-low">0.10 Low</span>');
  assert.strictEqual(aiCorrPillHtml({ r: -0.17, n: 249, band: 'none' }),
    '<span class="ai-corr-pill ai-corr-pill-none">-0.17 None</span>');
});

test('aiCorrPillHtml renders a dash for missing, malformed, or unknown-band values', () => {
  for (const bad of [null, undefined, {}, { r: 0.5 }, { r: NaN, band: 'high' }, { r: '0.5', band: 'high' }, { r: 0.5, band: 'weird' }]) {
    assert.strictEqual(aiCorrPillHtml(bad), '—', JSON.stringify(bad));
  }
});
