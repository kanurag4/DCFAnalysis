const CONFIG = {
  YAHOO_PROXY_URL: 'https://stock-evaluator.anurag-kor.workers.dev',
};

// Reference P/AFFO multiples per REIT property type, used as the "fair
// value" benchmark for the REIT valuation model (see calc/reit.js and
// docs/superpowers/specs/2026-08-19-reit-valuation-design.md). Editable
// reference values, NOT a recommendation -- same posture as any other
// seeded assumption in this tool (risk-free rate, ERP, terminal growth).
// Keyed by Yahoo's exact "REIT - <type>" industry string. DEFAULT is used
// for any REIT industry tag not explicitly listed here.
//
// These are directionally reasonable placeholder values from general market
// knowledge, not independently verified against current REIT pricing --
// sanity-check against a few real tickers per sub-sector (see Task 11's
// smoke test) before treating them as calibrated.
const REIT_SECTOR_MULTIPLES = {
  'REIT - Industrial':            18,
  'REIT - Residential':           16,
  'REIT - Specialty':             16,
  'REIT - Healthcare Facilities': 15,
  'REIT - Diversified':           14,
  'REIT - Retail':                13,
  'REIT - Hotel & Motel':         11,
  'REIT - Office':                10,
  DEFAULT: 14,
};

if (typeof module !== 'undefined') module.exports = { CONFIG, REIT_SECTOR_MULTIPLES };
if (typeof window !== 'undefined') { window.CONFIG = CONFIG; window.REIT_SECTOR_MULTIPLES = REIT_SECTOR_MULTIPLES; }
