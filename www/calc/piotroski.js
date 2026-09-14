// www/dcf/calc/piotroski.js — Piotroski F-Score (9-point YoY checklist).
// Pure: no DOM, no network. Scorer Contract shape, same convention as
// www/stock/scorers/*.js: {results, totalScore, maxScore, verdict}, each
// result {criterion, group, value, pass, skipped}. See
// docs/superpowers/specs/2026-09-13-solvency-check-design.md.
//
// `cur`/`prior` are flat year-objects (already date-aligned by the caller
// via calc/fiscalYearAlign.js's alignFiscalYears()):
//   { netIncome, totalAssets, fcf, capex, totalDebt, currentAssets,
//     currentLiabilities, shares, revenue, grossProfit }
//
// Each of the 9 criteria checks its OWN required fields independently --
// a null/zero-denominator in either year skips just that one criterion
// (shrinks maxScore), never the whole score. This is a deliberately
// different failure mode from calc/altmanZ.js, which nulls its single
// weighted-sum score on any missing input.

function finite(...vals) {
  return vals.every(v => v != null && isFinite(v));
}

function ratio(numerator, denominator) {
  if (!finite(numerator, denominator) || denominator === 0) return null;
  return numerator / denominator;
}

function ocf(year) {
  // capex is Yahoo's negative-outflow convention (see www/dcf/data.js) --
  // OCF = FCF - capex = FCF + |capex|.
  if (!finite(year.fcf, year.capex)) return null;
  return year.fcf - year.capex;
}

function pct(v) { return (v * 100).toFixed(1) + '%'; }
function ratioStr(v) { return v.toFixed(2) + 'x'; }
function money(v) {
  const sign = v < 0 ? '-' : '';
  return sign + Math.abs(v).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function criterion(name, group, curVal, priorVal, pass, formatFn) {
  if (curVal == null || (priorVal !== undefined && priorVal == null) || pass == null) {
    return { criterion: name, group, value: 'N/A', pass: false, skipped: true };
  }
  const value = (priorVal !== undefined) ? `${formatFn(curVal)} vs ${formatFn(priorVal)}` : formatFn(curVal);
  return { criterion: name, group, value, pass, skipped: false };
}

function piotroskiScore(cur, prior) {
  const results = [];

  // 1. Positive ROA
  const roaCur = ratio(cur.netIncome, cur.totalAssets);
  results.push(criterion('Positive return on assets', 'Profitability', roaCur, undefined, roaCur != null ? roaCur > 0 : null, pct));

  // 2. Positive operating cash flow
  const ocfCur = ocf(cur);
  results.push(criterion('Positive operating cash flow', 'Profitability', ocfCur, undefined, ocfCur != null ? ocfCur > 0 : null, money));

  // 3. ROA improved YoY
  const roaPrior = ratio(prior.netIncome, prior.totalAssets);
  results.push(criterion('Return on assets improved year over year', 'Profitability', roaCur, roaPrior, (roaCur != null && roaPrior != null) ? roaCur > roaPrior : null, pct));

  // 4. Operating cash flow exceeds net income (accrual quality)
  const cfoVsNi = (ocfCur != null && finite(cur.netIncome)) ? ocfCur > cur.netIncome : null;
  results.push(criterion('Operating cash flow exceeds net income', 'Profitability', ocfCur, cur.netIncome, cfoVsNi, money));

  // 5. Leverage decreased YoY (Total Debt / Total Assets)
  const levCur = ratio(cur.totalDebt, cur.totalAssets);
  const levPrior = ratio(prior.totalDebt, prior.totalAssets);
  results.push(criterion('Leverage decreased year over year', 'Leverage & Liquidity', levCur, levPrior, (levCur != null && levPrior != null) ? levCur < levPrior : null, pct));

  // 6. Current ratio improved YoY
  const crCur = ratio(cur.currentAssets, cur.currentLiabilities);
  const crPrior = ratio(prior.currentAssets, prior.currentLiabilities);
  results.push(criterion('Current ratio improved year over year', 'Leverage & Liquidity', crCur, crPrior, (crCur != null && crPrior != null) ? crCur > crPrior : null, ratioStr));

  // 7. No new share dilution
  const noDilution = finite(cur.shares, prior.shares) ? cur.shares <= prior.shares : null;
  results.push(criterion('No new share dilution', 'Leverage & Liquidity', cur.shares, prior.shares, noDilution, v => Math.round(v).toLocaleString('en-US')));

  // 8. Gross margin improved YoY
  const gmCur = ratio(cur.grossProfit, cur.revenue);
  const gmPrior = ratio(prior.grossProfit, prior.revenue);
  results.push(criterion('Gross margin improved year over year', 'Operating Efficiency', gmCur, gmPrior, (gmCur != null && gmPrior != null) ? gmCur > gmPrior : null, pct));

  // 9. Asset turnover improved YoY
  const atCur = ratio(cur.revenue, cur.totalAssets);
  const atPrior = ratio(prior.revenue, prior.totalAssets);
  results.push(criterion('Asset turnover improved year over year', 'Operating Efficiency', atCur, atPrior, (atCur != null && atPrior != null) ? atCur > atPrior : null, ratioStr));

  const scored = results.filter(r => !r.skipped);
  const totalScore = scored.filter(r => r.pass).length;
  const maxScore = scored.length;
  const verdict = `${totalScore} / ${maxScore}`;

  return { results, totalScore, maxScore, verdict };
}

// Compares two already-computed piotroskiScore() results (current period's
// own score vs. the prior period's own score, run over ITS OWN prior year)
// -- see www/dcf/data.js / DCFAnalysis's ticker-page.js for how the 3
// fiscal years this needs are assembled.
function piotroskiTrend(curScoreResult, priorScoreResult) {
  if (curScoreResult.totalScore > priorScoreResult.totalScore) return 'Improving';
  if (curScoreResult.totalScore < priorScoreResult.totalScore) return 'Deteriorating';
  return 'Stable';
}

if (typeof module !== 'undefined') module.exports = { piotroskiScore, piotroskiTrend };
