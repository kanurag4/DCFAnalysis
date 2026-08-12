// Dalio scorer. DOM-free. 6 criteria, 1 point each.

function dalioScore(data) {
  const results = [];

  const beta = safe(data.beta);
  results.push({
    criterion: "Low Beta (< 1.0) — Portfolio Diversifier",
    value: fmt(beta, 2),
    pass: beta !== null && beta < 1.0,
    dataMissing: beta === null,
    note: "Dalio prizes uncorrelated, low-volatility assets",
  });

  const revGrowth = safe(data.revenueGrowth) !== null ? data.revenueGrowth * 100 : null;
  results.push({
    criterion: "Positive Revenue Growth",
    value: fmt(revGrowth, 1, '%'),
    pass: revGrowth !== null && revGrowth > 0,
    dataMissing: revGrowth === null,
    note: "Productive, growing business",
  });

  const margin = safe(data.profitMargins) !== null ? data.profitMargins * 100 : null;
  results.push({
    criterion: "Profit Margin > 5% (Pricing Power)",
    value: fmt(margin, 1, '%'),
    pass: margin !== null && margin > 5,
    dataMissing: margin === null,
    note: "Pricing power = inflation resilience",
  });

  const isFinancial = isFinancialSector(data.sector);
  const de = safe(data.debtToEquity) !== null ? data.debtToEquity / 100 : null;
  results.push({
    criterion: "Debt/Equity < 1.0 (Balance Sheet Resilience)",
    value: isFinancial ? "Skipped" : fmt(de, 2),
    pass: !isFinancial && de !== null && de < 1.0,
    skipped: isFinancial,
    dataMissing: de === null,
    note: isFinancial ? "D/E is not meaningful for financials" : "Can survive debt cycle downturns",
  });

  const cr = safe(data.currentRatio);
  results.push({
    criterion: "Current Ratio > 1.5 (Liquidity)",
    value: fmt(cr, 2),
    pass: cr !== null && cr > 1.5,
    dataMissing: cr === null,
    note: "Liquid enough to weather downturns",
  });

  const roe = safe(data.returnOnEquity) !== null ? data.returnOnEquity * 100 : null;
  results.push({
    criterion: "ROE > 10% (Productive Capital)",
    value: fmt(roe, 1, '%'),
    pass: roe !== null && roe > 10,
    dataMissing: roe === null,
    note: "Capital generating real returns",
  });

  const { totalScore, maxScore } = tally(results);
  const ratio = maxScore > 0 ? totalScore / maxScore : 0;
  const verdict = ratio >= 0.80 ? "Strong Fit" :
                  ratio >= 0.65 ? "Good Fit" :
                  ratio >= 0.30 ? "Partial Fit" : "Poor Fit";

  return { results, totalScore, maxScore, verdict };
}
