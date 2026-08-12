// Graham (Defensive Investor) scorer. DOM-free. 7 criteria, 1 point each.

function grahamScore(data, sym = '') {
  const results = [];

  const mcap = safe(data.marketCap);
  results.push({
    criterion: "Adequate Size (Market Cap ≥ $2B)",
    value: mcap !== null ? `${sym}${(mcap / 1e9).toFixed(2)}B` : 'N/A',
    pass: mcap !== null && mcap >= 2e9,
    dataMissing: mcap === null,
    note: "Graham avoided tiny companies — size = stability",
  });

  const cr = safe(data.currentRatio);
  results.push({
    criterion: "Current Ratio ≥ 2",
    value: fmt(cr, 2),
    pass: cr !== null && cr >= 2,
    dataMissing: cr === null,
    note: "Strong short-term liquidity",
  });

  const eps = safe(data.eps);
  results.push({
    criterion: "Positive Earnings (EPS > 0)",
    value: fmt(eps, 2, '', sym),
    pass: eps !== null && eps > 0,
    dataMissing: eps === null,
    note: "Graham required a track record of profitability",
  });

  // Yahoo omits dividendYield entirely for non-payers rather than returning
  // 0 — null means "no dividend", not "data missing" (see buffett.js for
  // the identical reasoning on its own dividend criterion).
  const div = safe(data.dividendYield) !== null ? data.dividendYield * 100 : null;
  results.push({
    criterion: "Pays a Dividend",
    value: div !== null && div > 0 ? fmt(div, 1, '%') : "None",
    pass: div !== null && div > 0,
    dataMissing: false,
    note: "Defensive investors expect uninterrupted dividends",
  });

  const pe = safe(data.trailingPE);
  results.push({
    criterion: "Moderate P/E (< 15)",
    value: fmt(pe, 1, 'x'),
    pass: pe !== null && pe > 0 && pe < 15,
    dataMissing: pe === null,
    note: "Graham's ceiling for defensive stocks",
  });

  const pb = safe(data.priceToBook);
  results.push({
    criterion: "Moderate P/B (< 1.5)",
    value: fmt(pb, 2, 'x'),
    pass: pb !== null && pb > 0 && pb < 1.5,
    dataMissing: pb === null,
    note: "Priced close to book value = margin of safety",
  });

  const isFinancial = isFinancialSector(data.sector);
  const de = safe(data.debtToEquity) !== null ? data.debtToEquity / 100 : null;
  results.push({
    criterion: "Low Debt (D/E < 0.5)",
    value: isFinancial ? "Skipped" : fmt(de, 2),
    pass: !isFinancial && de !== null && de < 0.5,
    skipped: isFinancial,
    dataMissing: de === null,
    note: isFinancial ? "D/E is not meaningful for financials" : "Conservative balance sheet",
  });

  const { totalScore, maxScore } = tally(results);
  const ratio = maxScore > 0 ? totalScore / maxScore : 0;
  const verdict = ratio >= 0.85 ? "Strong Fit" :
                  ratio >= 0.60 ? "Good Fit" :
                  ratio >= 0.30 ? "Partial Fit" : "Poor Fit";

  return { results, totalScore, maxScore, verdict };
}
