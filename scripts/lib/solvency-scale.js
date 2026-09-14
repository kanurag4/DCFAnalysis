// DCFAnalysis/scripts/lib/solvency-scale.js — builds the "Solvency Check"
// card + details panel for a per-ticker SEO page. Pure: takes already-
// fetched history data, returns an HTML string (or '' when excluded/
// unavailable). Mirrors value-scale.js's shape (same file, same repo,
// same "pure card builder fed by data the caller already fetched"
// pattern) -- see docs/superpowers/specs/2026-09-13-solvency-check-design.md.
const { alignFiscalYears } = require('../../www/calc/fiscalYearAlign.js');
const { altmanZScore } = require('../../www/calc/altmanZ.js');
const { piotroskiScore, piotroskiTrend } = require('../../www/calc/piotroski.js');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function latest(series) {
  if (!Array.isArray(series) || !series.length) return null;
  const v = series[series.length - 1]?.value;
  return (v != null && isFinite(v)) ? v : null;
}

function altmanBarPct(zScore) {
  if (zScore == null) return 50;
  return Math.min(100, Math.max(0, ((zScore - (-2)) / (6 - (-2))) * 100));
}

function piotroskiSegmentsHtml(totalScore) {
  let html = '';
  for (let i = 0; i < 9; i++) {
    const zoneClass = i < 3 ? 'zf' : (i < 6 ? 'zw' : 'zp');
    const on = i < totalScore;
    html += `<div class="solv-mseg${on ? ' on ' + zoneClass : ''}"></div>`;
  }
  return html;
}

// `excluded`: caller passes isBank || isReitTicker (buildTickerPage()'s own
// isBankOrInsurance()/isReit() results, ticker-page.js:780-781) -- this
// module doesn't re-derive it, since ticker-page.js already computes it for
// its own valuation-model dispatch.
function buildSolvencyScaleCard({ hist, ebit, marketCap, excluded }) {
  if (excluded) {
    return `<section class="value-scale-block solv-scale-block">
      <h2>Solvency Check</h2>
      <p class="eval-card-note">Not meaningful for banks, insurers, or REITs — their balance sheets are structured differently from an operating company's (leverage is part of the business model, not a distress signal).</p>
    </section>`;
  }

  const years = alignFiscalYears({
    netIncome: hist.annualNetIncomeHistory,
    totalAssets: hist.annualTotalAssetsHistory,
    fcf: hist.annualFcfHistory,
    capex: hist.annualCapexHistory,
    totalDebt: hist.annualTotalDebtHistory,
    // Real bug found+fixed the same day this file was written (see
    // www/evaluate/app.js's computeSolvencyCheck(), same gap, fixed there
    // first): alignFiscalYears() must be given totalLiabilities as its OWN
    // named series -- it is NOT the same as totalDebt. Omitting it left
    // years[0].totalLiabilities permanently undefined, nulling Altman Z for
    // every ticker regardless of how complete the underlying data was.
    totalLiabilities: hist.annualTotalLiabilitiesHistory,
    currentAssets: hist.annualCurrentAssetsHistory,
    currentLiabilities: hist.annualCurrentLiabilitiesHistory,
    shares: hist.annualSharesHistory,
    revenue: hist.annualRevenueHistory,
    grossProfit: hist.annualGrossProfitHistory,
  });

  const altman = altmanZScore({
    totalAssets: years[0] ? years[0].totalAssets : null,
    currentAssets: years[0] ? years[0].currentAssets : null,
    currentLiabilities: years[0] ? years[0].currentLiabilities : null,
    retainedEarnings: latest(hist.annualRetainedEarningsHistory),
    ebit,
    marketCap,
    totalLiabilities: years[0] ? years[0].totalLiabilities : null,
    revenue: years[0] ? years[0].revenue : null,
  });

  let piotroski = null;
  let trend = null;
  if (years.length >= 2) {
    piotroski = piotroskiScore(years[0], years[1]);
    if (years.length >= 3) trend = piotroskiTrend(piotroski, piotroskiScore(years[1], years[2]));
  }

  const hasAltman = altman.zScore != null;
  if (!hasAltman && !piotroski) return '';

  const altmanHtml = hasAltman
    ? `<div class="solv-mini">
        <div class="solv-mlabel"><span>Altman Z</span><span class="solv-mval">${altman.zScore.toFixed(2)} &middot; ${escapeHtml(altman.verdict.replace(' Zone', ''))}</span></div>
        <div class="solv-mbar-wrap"><div class="solv-mbar"></div><div class="solv-mbar-tri" style="left:${altmanBarPct(altman.zScore)}%"></div></div>
      </div>`
    : `<div class="solv-mini"><div class="solv-mlabel"><span>Altman Z</span><span class="solv-mval">N/A</span></div></div>`;

  const piotroskiHtml = piotroski
    ? `<div class="solv-mini">
        <div class="solv-mlabel"><span>Piotroski F</span><span class="solv-mval">${piotroski.totalScore}/${piotroski.maxScore}${trend ? ' &middot; ' + escapeHtml(trend) : ''}</span></div>
        <div class="solv-mseg-row">${piotroskiSegmentsHtml(piotroski.totalScore)}</div>
      </div>`
    : `<div class="solv-mini"><div class="solv-mlabel"><span>Piotroski F</span><span class="solv-mval">N/A</span></div></div>`;

  const altmanDetailHtml = (altman.ratios)
    ? [
        ['X1 · Working Capital / Total Assets', altman.ratios.x1],
        ['X2 · Retained Earnings / Total Assets', altman.ratios.x2],
        ['X3 · EBIT / Total Assets', altman.ratios.x3],
        ['X4 · Market Value of Equity / Total Liabilities', altman.ratios.x4],
        ['X5 · Sales / Total Assets', altman.ratios.x5],
      ].map(([label, v]) => `<div class="eval-scorecard-row"><span class="criterion">${escapeHtml(label)}</span><span class="value">${v.toFixed(2)}</span></div>`).join('')
    : `<p class="eval-card-note">Altman Z-Score is unavailable — insufficient balance-sheet data.</p>`;

  const piotroskiDetailHtml = piotroski
    ? piotroski.results.map(r => {
        const cls = r.skipped ? '' : (r.pass ? 'pass' : 'fail');
        return `<div class="eval-scorecard-row ${cls}"><span class="criterion">${escapeHtml(r.criterion)}</span><span class="value">${escapeHtml(r.skipped ? 'Skipped' : r.value)}</span></div>`;
      }).join('')
    : `<p class="eval-card-note">Piotroski F-Score is unavailable — fewer than 2 fiscal years of aligned data.</p>`;

  return `<section class="value-scale-block solv-scale-block">
    <h2>Solvency Check</h2>
    <div class="solv-card">${altmanHtml}${piotroskiHtml}</div>
    <details class="eval-scorecard">
      <summary>▾ Solvency Check details</summary>
      <p class="eval-card-note solv-methodology">
        <a href="/glossary/altman-z-score/"><b>Altman Z-Score</b></a> combines 5 ratios into one weighted number —
        <span class="solv-formula">Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5</span> —
        then bands the result: Safe Zone above 2.99, Grey Zone 1.81–2.99, Distress Zone below 1.81.
        <a href="/glossary/piotroski-f-score/"><b>Piotroski F-Score</b></a> checks 9 yes/no criteria against the prior fiscal year —
        profitability, leverage &amp; liquidity, and operating efficiency — 1 point each, out of 9.
        Both are a measurement of the underlying numbers, not a recommendation.
      </p>
      <div class="solv-detail-grid">
        <div class="eval-scorecard-group"><h4>Altman Z-Score — inputs</h4>${altmanDetailHtml}</div>
        <div class="eval-scorecard-group"><h4>Piotroski F-Score — 9 criteria</h4>${piotroskiDetailHtml}</div>
      </div>
    </details>
  </section>`;
}

module.exports = { buildSolvencyScaleCard };
