// scripts/lib/etf/sector-models.js — REIT (P/AFFO) and airline (EV/EBITDA)
// look-through valuation for the Thematic ETF Radar. Pure, Node-testable.
//
// The undervalued-screen engine (scripts/lib/evaluate.js) deliberately has no
// REIT/airline branch — adding one there would move the screen rankings. The
// radar, unlike the screens, needs to value REIT-heavy and infrastructure
// funds, so it gets these two models here, applied by run-etf-radar.js's
// valueOne() *before* the DCF path — never touching evaluate.js.
//
// Both functions mirror ticker-page.js's REIT/Airline BASE-CASE branches
// (ticker-page.js:783-796 / :765-781) exactly, reusing the same pure calc
// engines and the same REIT_SECTOR_MULTIPLES / AIRLINE_EV_EBITDA_MULTIPLE
// constants — no valuation math is reimplemented here. Base case only: the
// radar reports one margin of safety per holding, not bear/base/bull.
const { deriveFfo, deriveAffo, calculateReitValue } = require('../../../www/calc/reit.js');
const { calculateAirlineValue } = require('../../../www/calc/airline.js');
const { REIT_SECTOR_MULTIPLES, AIRLINE_EV_EBITDA_MULTIPLE } = require('../../../www/config.js');

// Diluted share count preferred over basic when present and positive — the
// same precedence ticker-page.js and growth-eval.js already use.
function resolveShares(data) {
  return (data.dilutedSharesOutstanding != null && data.dilutedSharesOutstanding > 0)
    ? data.dilutedSharesOutstanding
    : data.sharesOutstanding;
}

// { marginOfSafety, method: 'REIT', intrinsic } or null when the model can't run
// (missing net income, non-positive AFFO/share, or no usable current price).
function reitValue(data) {
  const ffo = deriveFfo({
    netIncome: data.netIncome,
    depreciationAndAmortization: data.depreciationAndAmortization,
  });
  const affo = deriveAffo({ ffo: ffo.value, capex: data.capitalExpenditures });
  const shares = resolveShares(data);
  const affoPerShare = (affo.value != null && shares > 0) ? affo.value / shares : null;

  const industryKey = (data.industry && REIT_SECTOR_MULTIPLES[data.industry] != null)
    ? data.industry : 'DEFAULT';
  const { intrinsicValue, marginOfSafety } = calculateReitValue({
    affoPerShare,
    multiple: REIT_SECTOR_MULTIPLES[industryKey],
    currentPrice: data.price,
  });

  if (marginOfSafety == null || !Number.isFinite(marginOfSafety)) return null;
  return { method: 'REIT', intrinsic: intrinsicValue, marginOfSafety };
}

// { marginOfSafety, method: 'Airline', intrinsic } or null when the model can't
// run (non-positive EBITDA, net debt exceeding EV, missing shares or price).
function airlineValue(data) {
  const { intrinsicValue, marginOfSafety } = calculateAirlineValue({
    ebitda: data.ebitda,
    multiple: AIRLINE_EV_EBITDA_MULTIPLE,
    totalDebt: data.totalDebt,
    totalCash: data.totalCash,
    sharesOutstanding: resolveShares(data),
    currentPrice: data.price,
  });

  if (marginOfSafety == null || !Number.isFinite(marginOfSafety)) return null;
  return { method: 'Airline', intrinsic: intrinsicValue, marginOfSafety };
}

module.exports = { reitValue, airlineValue };
