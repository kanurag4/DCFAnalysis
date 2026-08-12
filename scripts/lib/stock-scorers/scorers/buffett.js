// Buffett scorer. DOM-free. 7 criteria, 1 point each.

function buffettScore(data) {
  const results = [];

  const roe = safe(data.returnOnEquity) !== null ? data.returnOnEquity * 100 : null;
  results.push({
    criterion: "Return on Equity > 15%",
    value: fmt(roe, 1, '%'),
    pass: roe !== null && roe >= 15,
    dataMissing: roe === null,
    note: "Measures management efficiency",
  });

  const pe = safe(data.trailingPE);
  results.push({
    criterion: "PE Ratio < 20x",
    value: fmt(pe, 1, 'x'),
    pass: pe !== null && pe > 0 && pe < 20,
    dataMissing: pe === null,
    note: "Reasonable price relative to earnings",
  });

  const isFinancial = isFinancialSector(data.sector);
  const de = safe(data.debtToEquity) !== null ? data.debtToEquity / 100 : null;
  results.push({
    criterion: "Debt/Equity < 0.5",
    value: isFinancial ? "Skipped" : fmt(de, 2),
    pass: !isFinancial && de !== null && de < 0.5,
    skipped: isFinancial,
    dataMissing: de === null,
    note: isFinancial ? "D/E is not meaningful for financials" : "Low debt = financial resilience",
  });

  // Yahoo omits dividendYield entirely for non-payers rather than returning
  // 0 — null means "no dividend", not "data missing", so this never counts
  // toward the value-scale card's coverage gap.
  const div = safe(data.dividendYield) !== null ? data.dividendYield * 100 : null;
  results.push({
    criterion: "Pays Dividend (> 1%)",
    value: div !== null && div > 0 ? fmt(div, 1, '%') : "None",
    pass: div !== null && div > 1,
    dataMissing: false,
    note: "Returns cash to shareholders",
  });

  const margin = safe(data.profitMargins) !== null ? data.profitMargins * 100 : null;
  results.push({
    criterion: "Positive Profit Margin",
    value: fmt(margin, 1, '%'),
    pass: margin !== null && margin > 0,
    dataMissing: margin === null,
    note: "Business must be profitable",
  });

  const epsGrowth = safe(data.earningsGrowth) !== null ? data.earningsGrowth * 100 : null;
  results.push({
    criterion: "Earnings Growth > 5%",
    value: fmt(epsGrowth, 1, '%'),
    pass: epsGrowth !== null && epsGrowth > 5,
    dataMissing: epsGrowth === null,
    note: "Growing earnings over time",
  });

  const fpe = safe(data.forwardPE);
  results.push({
    criterion: "Forward PE < Trailing PE",
    value: `${fmt(fpe, 1, 'x')} vs ${fmt(pe, 1, 'x')}`,
    pass: fpe !== null && pe !== null && fpe < pe,
    dataMissing: fpe === null || pe === null,
    note: "Earnings expected to improve",
  });

  const { totalScore, maxScore } = tally(results);
  // Verdict bands scale with maxScore so scoring stays fair when D/E is skipped.
  const ratio = maxScore > 0 ? totalScore / maxScore : 0;
  const verdict = ratio >= 0.85 ? "Strong Fit" :
                  ratio >= 0.55 ? "Good Fit" :
                  ratio >= 0.30 ? "Partial Fit" : "Poor Fit";

  return { results, totalScore, maxScore, verdict };
}
