const CONFIG = {
  YAHOO_PROXY_URL: 'https://api.kashvector.com',
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

// Flat EV/EBITDA multiple for airlines -- not a sub-industry table like
// REIT_SECTOR_MULTIPLES, since Yahoo tags every airline with the same
// single 'Airlines' industry string (no sub-classification to key off).
// 6x is a mid-cycle placeholder from general market knowledge (airlines
// have historically traded ~4x in downturns to ~8x+ in strong
// post-consolidation years) -- not independently calibrated against
// current pricing. Validated against QAN.AX/DAL on 2026-08-20: QAN.AX
// moved from no-DCF-value to a real +36.4% margin; DAL moved from -65.1%
// to -47.5% (still overvalued at 6x, which may mean this placeholder is
// conservative for Delta specifically -- a real calibration candidate,
// not evidence the approach is wrong).
const AIRLINE_EV_EBITDA_MULTIPLE = 6;

// Flat holding-company discount for conglomerates (see calc/holdcoDiscount.js
// and calc/assumptions.js's isConglomerate dispatch) -- NOT a real
// segment-level sum-of-the-parts valuation (Yahoo exposes no per-segment
// financials, confirmed 2026-08-23). 15% is a general market estimate
// (Damodaran cites typically-observed conglomerate discounts in the
// 10-20% range) -- not independently calibrated against this site's actual
// conglomerate tickers' trading multiples, same "documented placeholder,
// not a silent guess" posture AIRLINE_EV_EBITDA_MULTIPLE already uses.
const HOLDCO_DISCOUNT = 0.15;

if (typeof module !== 'undefined') module.exports = { CONFIG, REIT_SECTOR_MULTIPLES, AIRLINE_EV_EBITDA_MULTIPLE, HOLDCO_DISCOUNT };
if (typeof window !== 'undefined') { window.CONFIG = CONFIG; window.REIT_SECTOR_MULTIPLES = REIT_SECTOR_MULTIPLES; window.AIRLINE_EV_EBITDA_MULTIPLE = AIRLINE_EV_EBITDA_MULTIPLE; window.HOLDCO_DISCOUNT = HOLDCO_DISCOUNT; }
