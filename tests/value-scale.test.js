const { test } = require('node:test');
const assert = require('node:assert');
const { buildValueScaleCard, gaugeVerdict, OMIT_THRESHOLD } = require('../scripts/lib/value-scale.js');

// A fully-populated fixture — every field all three scorers read is present
// and non-degenerate. Field placement mirrors mapStockData() exactly
// (forwardPE lives under summaryDetail, not defaultKeyStatistics — a real
// Yahoo-shape detail, not an arbitrary choice).
//
// Overrides REPLACE the named sub-object wholesale (not merged key-by-key) —
// deliberately, so a test can omit specific fields to simulate a genuine
// Yahoo data gap. A merge would silently keep the un-mentioned default
// fields present, defeating the point of a "some fields missing" fixture.
function rawBodyFixture(overrides = {}) {
  const defaults = {
    financialData: {
      currentPrice: { raw: 100 },
      returnOnEquity: { raw: 0.2 },
      debtToEquity: { raw: 40 },
      currentRatio: { raw: 1.8 },
      profitMargins: { raw: 0.15 },
      revenueGrowth: { raw: 0.1 },
      earningsGrowth: { raw: 0.08 },
    },
    summaryDetail: {
      marketCap: { raw: 5e9 },
      trailingPE: { raw: 18 },
      forwardPE: { raw: 16 },
      dividendYield: { raw: 0.02 },
      beta: { raw: 0.9 },
    },
    defaultKeyStatistics: {
      trailingEps: { raw: 3.2 },
      priceToBook: { raw: 1.2 },
    },
    assetProfile: { sector: 'Technology' },
  };
  return {
    quoteSummary: {
      result: [{
        quoteType: { longName: 'Fixture Corp' },
        financialData: overrides.financialData !== undefined ? overrides.financialData : defaults.financialData,
        summaryDetail: overrides.summaryDetail !== undefined ? overrides.summaryDetail : defaults.summaryDetail,
        defaultKeyStatistics: overrides.defaultKeyStatistics !== undefined ? overrides.defaultKeyStatistics : defaults.defaultKeyStatistics,
        assetProfile: overrides.assetProfile !== undefined ? overrides.assetProfile : defaults.assetProfile,
      }],
    },
  };
}

test('renders the full card for a well-covered non-financial ticker', () => {
  const html = buildValueScaleCard({ rawBody: rawBodyFixture(), symbol: 'FIX', market: { folder: 'sp500' } });
  assert.notStrictEqual(html, '');
  assert.match(html, /Value investing scale/);
  assert.match(html, /Buffett &middot; Dalio &middot; Graham/);
  assert.match(html, /\/ 20 combined score/);
  assert.doesNotMatch(html, /criteri(on|a) had no data/);
  assert.match(html, /href="\/stock\/\?ticker=FIX"/);
  // No per-criterion breakdown rows on this card -- that's what the CTA is for.
  assert.doesNotMatch(html, /criterion-row/);
});

test('financial-sector ticker gets max 17, not 20 (D/E skipped in all three scorers)', () => {
  const html = buildValueScaleCard({
    rawBody: rawBodyFixture({ assetProfile: { sector: 'Financial Services' } }),
    symbol: 'BANK', market: { folder: 'sp500' },
  });
  assert.match(html, /\/ 17 combined score/);
});

test('omits the card entirely when more than a third of criteria have no data', () => {
  const html = buildValueScaleCard({
    rawBody: rawBodyFixture({
      financialData: { currentPrice: { raw: 100 } }, // strips ROE/D-E/margin/rev-growth/eps-growth
      summaryDetail: { marketCap: { raw: 5e9 } },      // strips PE/dividend/beta
      defaultKeyStatistics: {},                        // strips EPS/P-B/forwardPE
    }),
    symbol: 'SPARSE', market: { folder: 'sp500' },
  });
  assert.strictEqual(html, '');
});

test('shows a gap note (not omission) when only a couple of criteria are missing', () => {
  // Drops trailingPE and forwardPE (2 of 20 non-skipped criteria) — under
  // the omit threshold (1/3), so the card still renders with a note.
  const html = buildValueScaleCard({
    rawBody: rawBodyFixture({ summaryDetail: { marketCap: { raw: 5e9 }, dividendYield: { raw: 0.02 }, beta: { raw: 0.9 } } }),
    symbol: 'GAPPY', market: { folder: 'sp500' },
  });
  assert.notStrictEqual(html, '');
  assert.match(html, /criteri(on|a) had no data/);
});

test('a non-dividend-payer never counts as missing data (Yahoo omits the field on purpose)', () => {
  // Every field present except dividendYield, which is entirely absent —
  // exactly what Yahoo does for a real non-payer.
  const html = buildValueScaleCard({
    rawBody: rawBodyFixture({ summaryDetail: { marketCap: { raw: 5e9 }, trailingPE: { raw: 18 }, forwardPE: { raw: 16 }, beta: { raw: 0.9 } } }),
    symbol: 'NODIV', market: { folder: 'sp500' },
  });
  assert.notStrictEqual(html, '');
  assert.doesNotMatch(html, /criteri(on|a) had no data/);
});

test('returns empty string when quoteSummary has no result (unusable response)', () => {
  const html = buildValueScaleCard({ rawBody: { quoteSummary: { result: [] } }, symbol: 'GONE', market: null });
  assert.strictEqual(html, '');
  const html2 = buildValueScaleCard({ rawBody: null, symbol: 'GONE', market: null });
  assert.strictEqual(html2, '');
});

test('CTA link picks up the .AX/.NS suffix regardless of market.folder', () => {
  const asx = buildValueScaleCard({ rawBody: rawBodyFixture(), symbol: 'BHP.AX', market: null });
  assert.match(asx, /ticker=BHP\.AX&amp;asx=1/);

  const nse = buildValueScaleCard({ rawBody: rawBodyFixture(), symbol: 'RELIANCE.NS', market: { folder: 'other' } });
  assert.match(nse, /ticker=RELIANCE\.NS&amp;nse=1/);

  const bo = buildValueScaleCard({ rawBody: rawBodyFixture(), symbol: 'SOMECO.BO', market: null });
  assert.match(bo, /ticker=SOMECO\.BO&amp;nse=1/);

  const us = buildValueScaleCard({ rawBody: rawBodyFixture(), symbol: 'AAPL', market: null });
  assert.doesNotMatch(us, /asx=1|nse=1/);

  const jpn = buildValueScaleCard({ rawBody: rawBodyFixture(), symbol: '6758.T', market: null });
  assert.doesNotMatch(jpn, /asx=1|nse=1/);
});

test('gaugeVerdict matches the live Stock Evaluator thresholds exactly', () => {
  assert.deepStrictEqual(gaugeVerdict(13), { cls: 'good', verdict: 'Strong Fit' });
  assert.deepStrictEqual(gaugeVerdict(20), { cls: 'good', verdict: 'Strong Fit' });
  assert.deepStrictEqual(gaugeVerdict(8), { cls: 'ok', verdict: 'Partial Fit' });
  assert.deepStrictEqual(gaugeVerdict(12), { cls: 'ok', verdict: 'Partial Fit' });
  assert.deepStrictEqual(gaugeVerdict(0), { cls: 'bad', verdict: 'Poor Fit' });
  assert.deepStrictEqual(gaugeVerdict(7), { cls: 'bad', verdict: 'Poor Fit' });
});

test('OMIT_THRESHOLD is exactly one third', () => {
  assert.strictEqual(OMIT_THRESHOLD, 1 / 3);
});
