// www/dcf/calc/reit.js — FFO/AFFO derivation and P/AFFO-multiple valuation
// for property REITs. Pure, Node-testable. See
// docs/superpowers/specs/2026-08-19-reit-valuation-design.md for the full
// design rationale.
//
// Unlike calc/dcf.js/ddm.js/excessReturn.js, this is NOT a discounted model
// -- there's no cost of capital, no growth projection, no terminal value.
// AFFO is a single TTM figure and the "valuation" is a multiple applied
// directly to it, same shape as a P/E-based valuation. Bear/Base/Bull vary
// the multiple, not a growth or discount rate (see calc/assumptions.js's
// deriveDcfAssumptions() reit branch).

// FFO = Net Income + Depreciation & Amortization.
// Deliberately omits "gains on asset sales" -- Yahoo's income statement
// doesn't break this out as its own line item, so it can't be subtracted.
// This is a documented, usually-minor understatement of the true FFO
// reduction (real institutional FFO has the same caveat whenever a REIT
// doesn't separately disclose the gain/loss), not a silent gap -- the
// assumptions panel states this explicitly (see app.js's REIT assumptions
// rendering).
function deriveFfo({ netIncome, depreciationAndAmortization }) {
  if (netIncome == null || !isFinite(netIncome)) return { value: null };
  const da = (depreciationAndAmortization != null && isFinite(depreciationAndAmortization)) ? depreciationAndAmortization : 0;
  return { value: netIncome + da };
}

// AFFO = FFO - |CapEx|. Uses TOTAL reported capex as a conservative proxy
// for "recurring" capex -- Yahoo doesn't split recurring vs. growth capex
// (that split is a REIT-specific 10-K disclosure, not in any financial-data
// API). This understates AFFO for a REIT that's actively expanding, which
// is a conservative bias (undervaluing, not inflating), matching this
// codebase's existing posture on other estimation tiers (see deriveFcf's
// comments in utils.js).
function deriveAffo({ ffo, capex }) {
  if (ffo == null || !isFinite(ffo)) return { value: null };
  const c = (capex != null && isFinite(capex)) ? Math.abs(capex) : 0;
  return { value: ffo - c };
}

// intrinsicValue = affoPerShare x multiple. No discounting step -- see the
// file header comment for why. Returns null intrinsicValue (not a negative
// or zero value) when affoPerShare is missing or <= 0 -- a P/AFFO multiple
// applied to negative/zero AFFO produces a meaningless "valuation", same
// "can't run this model" posture DDM takes for a missing dividend
// (calc/ddm.js's `if (!dividend || dividend <= 0) return null;`).
function calculateReitValue({ affoPerShare, multiple, currentPrice }) {
  if (affoPerShare == null || !isFinite(affoPerShare) || affoPerShare <= 0) {
    return { intrinsicValue: null, marginOfSafety: null };
  }
  if (multiple == null || !isFinite(multiple) || multiple <= 0) {
    return { intrinsicValue: null, marginOfSafety: null };
  }
  const intrinsicValue = affoPerShare * multiple;
  const marginOfSafety = (currentPrice != null && isFinite(currentPrice) && currentPrice > 0)
    ? (intrinsicValue - currentPrice) / currentPrice
    : null;
  return { intrinsicValue, marginOfSafety };
}

if (typeof module !== 'undefined') module.exports = { deriveFfo, deriveAffo, calculateReitValue };
if (typeof window !== 'undefined') { window.deriveFfo = deriveFfo; window.deriveAffo = deriveAffo; window.calculateReitValue = calculateReitValue; }
