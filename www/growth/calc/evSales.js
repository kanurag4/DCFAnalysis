// www/growth/calc/evSales.js — DOM-free.

function calculateEvSales({
  revenue, targetMultiple,
  totalDebt = 0, totalCash = 0,
  sharesOutstanding = null, currentPrice = null,
}) {
  if (!revenue || revenue <= 0) return null;
  if (!targetMultiple || targetMultiple <= 0) return null;

  const impliedEV = revenue * targetMultiple;
  const impliedEquityValue = impliedEV - (totalDebt || 0) + (totalCash || 0);

  let intrinsicValue = null;
  if (sharesOutstanding && sharesOutstanding > 0) {
    intrinsicValue = impliedEquityValue / sharesOutstanding;
  }

  let marginOfSafety = null;
  if (intrinsicValue !== null && currentPrice !== null && currentPrice > 0) {
    marginOfSafety = (intrinsicValue - currentPrice) / currentPrice;
  }

  return { impliedEV, impliedEquityValue, intrinsicValue, marginOfSafety };
}

// Closed-form reverse-solve -- no iteration needed, unlike the Multi-Stage
// DCF's implied growth rate. From EV = price*shares + debt - cash and
// multiple = EV/revenue, both algebraically direct.
function impliedEvSalesMultiple({
  revenue, totalDebt = 0, totalCash = 0,
  sharesOutstanding = null, currentPrice = null,
}) {
  if (!revenue || revenue <= 0) return null;
  if (!sharesOutstanding || sharesOutstanding <= 0) return null;
  if (!currentPrice || currentPrice <= 0) return null;

  const impliedEquityValue = currentPrice * sharesOutstanding;
  const impliedEV = impliedEquityValue + (totalDebt || 0) - (totalCash || 0);
  const impliedMultiple = impliedEV / revenue;

  return { impliedEV, impliedEquityValue, impliedMultiple };
}

if (typeof module !== 'undefined') module.exports = { calculateEvSales, impliedEvSalesMultiple };
