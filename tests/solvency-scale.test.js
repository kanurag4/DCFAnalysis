const { test } = require('node:test');
const assert = require('node:assert');
const { buildSolvencyScaleCard } = require('../scripts/lib/solvency-scale.js');

function histFixture() {
  return {
    annualNetIncomeHistory: [{ date: '2024-12-31', value: 60 }, { date: '2025-12-31', value: 120 }],
    annualTotalAssetsHistory: [{ date: '2024-12-31', value: 900 }, { date: '2025-12-31', value: 1000 }],
    annualFcfHistory: [{ date: '2024-12-31', value: 70 }, { date: '2025-12-31', value: 150 }],
    annualCapexHistory: [{ date: '2024-12-31', value: -30 }, { date: '2025-12-31', value: -20 }],
    annualTotalDebtHistory: [{ date: '2024-12-31', value: 350 }, { date: '2025-12-31', value: 300 }],
    // Real bug in the plan's own fixture (already fixed in solvency-scale.js
    // itself, see its comment): a fixture missing totalLiabilities exercises
    // the exact silent-null path the bug caused -- included here so this
    // test actually proves Altman Z computes, not just that it doesn't throw.
    annualTotalLiabilitiesHistory: [{ date: '2024-12-31', value: 600 }, { date: '2025-12-31', value: 600 }],
    annualCurrentAssetsHistory: [{ date: '2024-12-31', value: 300 }, { date: '2025-12-31', value: 400 }],
    annualCurrentLiabilitiesHistory: [{ date: '2024-12-31', value: 220 }, { date: '2025-12-31', value: 200 }],
    annualSharesHistory: [{ date: '2024-12-31', value: 105 }, { date: '2025-12-31', value: 100 }],
    annualRevenueHistory: [{ date: '2024-12-31', value: 800 }, { date: '2025-12-31', value: 900 }],
    annualGrossProfitHistory: [{ date: '2024-12-31', value: 320 }, { date: '2025-12-31', value: 450 }],
    annualRetainedEarningsHistory: [{ date: '2025-12-31', value: 300 }],
  };
}

test('buildSolvencyScaleCard renders both gauges for a well-covered, non-excluded ticker', () => {
  const html = buildSolvencyScaleCard({ hist: histFixture(), ebit: 90, marketCap: 1400, excluded: false });
  assert.match(html, /Solvency Check/);
  assert.match(html, /Altman Z/);
  assert.match(html, /Piotroski F/);
  assert.match(html, /9\/9/); // every criterion improved in this fixture
});

test('buildSolvencyScaleCard actually computes a real Altman Z-Score, not N/A', () => {
  // Regression test for the totalLiabilities alignment bug -- a fixture
  // with every input present (including totalLiabilities) must produce a
  // real number, not silently fall through to the "insufficient data" path.
  const html = buildSolvencyScaleCard({ hist: histFixture(), ebit: 90, marketCap: 1400, excluded: false });
  assert.doesNotMatch(html, /Altman Z<\/span><span class="solv-mval">N\/A/);
  assert.match(html, /solv-mbar-tri/); // the gauge pointer only renders when zScore is real
});

test('buildSolvencyScaleCard shows the exclusion note and skips the details panel for banks/REITs', () => {
  const html = buildSolvencyScaleCard({ hist: histFixture(), ebit: 90, marketCap: 1400, excluded: true });
  assert.match(html, /Not meaningful for banks, insurers, or REITs/);
  assert.doesNotMatch(html, /Solvency Check details/);
});

test('buildSolvencyScaleCard returns empty string when neither score is computable', () => {
  const html = buildSolvencyScaleCard({ hist: {}, ebit: null, marketCap: null, excluded: false });
  assert.strictEqual(html, '');
});
