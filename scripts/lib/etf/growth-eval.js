// scripts/lib/etf/growth-eval.js — pure.
// Fallback valuation for a holding the plain DCF engine rejects (non-financial,
// negative/thin FCF). Applies the holding's sector's typical EV/Sales multiple
// to its trailing revenue. Deliberately simple and always-resolving where
// revenue + shares exist. Documented v1 conservatism: this is a RELATIVE
// valuation ("priced like its peers"), used only for the tail of holdings the
// DCF can't value — the plain-DCF result is kept for every holding it CAN value,
// including expensive-but-profitable growth names.
const { calculateEvSales } = require('../../../www/growth/calc/evSales.js');
const { CONFIG } = require('../../../www/growth/config.js');

function sectorEvSalesMultiple(sector) {
  return (sector && CONFIG.SECTOR_EV_SALES && CONFIG.SECTOR_EV_SALES[sector]) || CONFIG.DEFAULT_EV_SALES;
}

function evSalesFallback(data) {
  if (!data) return null;
  const revenue = data.totalRevenue;
  const shares = (data.dilutedSharesOutstanding > 0)
    ? data.dilutedSharesOutstanding : data.sharesOutstanding;
  if (!(revenue > 0) || !(shares > 0)) return null;

  // calculateEvSales's real signature (verified against the vendored file):
  // { revenue, targetMultiple, totalDebt, totalCash, sharesOutstanding, currentPrice }
  // -> { impliedEV, impliedEquityValue, intrinsicValue, marginOfSafety }
  const r = calculateEvSales({
    revenue,
    targetMultiple: sectorEvSalesMultiple(data.sector),
    totalDebt: data.totalDebt || 0,
    totalCash: data.totalCash || 0,
    sharesOutstanding: shares,
    currentPrice: data.price,
  });
  if (!r || !Number.isFinite(r.intrinsicValue) || !Number.isFinite(r.marginOfSafety)) return null;
  return { method: 'EV/Sales', intrinsic: r.intrinsicValue, marginOfSafety: r.marginOfSafety };
}

module.exports = { evSalesFallback };
