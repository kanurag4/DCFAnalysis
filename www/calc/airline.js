// www/dcf/calc/airline.js — EV/EBITDA-multiple valuation for airlines.
// Pure, Node-testable.
//
// Airlines are structurally a poor fit for FCF-based DCF: extreme
// cyclicality, high operating/financial leverage, and lease-accounting
// differences (owned vs. leased fleet mix varies widely airline-to-airline)
// make a single trailing-year FCF/growth snapshot a bad basis for a 5-year
// projection. Confirmed live 2026-08-20: QAN.AX's DCF returns no value at
// all (fcfNegative) despite positive EBITDA; DAL's DCF shows a materially
// different margin of safety than an EV/EBITDA read.
//
// Unlike calc/dcf.js/ddm.js/excessReturn.js, this is NOT a discounted model
// -- no cost of capital, no growth projection, no terminal value. EBITDA is
// a single TTM figure and the "valuation" is a multiple applied directly to
// it (via Enterprise Value, then back out to equity value per share), same
// shape as calc/reit.js's P/AFFO-multiple model. Bear/Base/Bull vary the
// multiple, not a growth or discount rate (see calc/assumptions.js's
// deriveDcfAssumptions() airline branch).
//
// Ideally this would be EV/EBITDAR (adding back aircraft lease rent, the
// standard airline-specific convention, since it normalizes for the
// owned-vs-leased fleet mix) -- but Yahoo's free feed doesn't reliably
// break out aircraft rent as its own line (confirmed empty on
// incomeStatementHistory's otherOperatingExpenses for DAL). Plain EBITDA
// still fixes the core problem (DCF's sensitivity to a single volatile
// FCF/growth year); EV/EBITDAR is a documented future refinement, not a
// silent gap.
function calculateAirlineValue({ ebitda, multiple, totalDebt, totalCash, sharesOutstanding, currentPrice }) {
  if (ebitda == null || !isFinite(ebitda) || ebitda <= 0) {
    return { intrinsicValue: null, marginOfSafety: null, ev: null, netDebt: null, equityValue: null };
  }
  if (multiple == null || !isFinite(multiple) || multiple <= 0) {
    return { intrinsicValue: null, marginOfSafety: null, ev: null, netDebt: null, equityValue: null };
  }

  const ev = ebitda * multiple;
  const netDebt = (totalDebt || 0) - (totalCash || 0);
  const equityValue = ev - netDebt;

  if (equityValue <= 0 || !sharesOutstanding || sharesOutstanding <= 0) {
    return { intrinsicValue: null, marginOfSafety: null, ev, netDebt, equityValue };
  }

  const intrinsicValue = equityValue / sharesOutstanding;
  const marginOfSafety = (currentPrice != null && isFinite(currentPrice) && currentPrice > 0)
    ? (intrinsicValue - currentPrice) / currentPrice
    : null;

  return { intrinsicValue, marginOfSafety, ev, netDebt, equityValue };
}

if (typeof module !== 'undefined') module.exports = { calculateAirlineValue };
if (typeof window !== 'undefined') { window.calculateAirlineValue = calculateAirlineValue; }
