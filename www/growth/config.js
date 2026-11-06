// www/growth/config.js
const CONFIG = {
  YAHOO_PROXY_URL: 'https://api.kashvector.com',
};

// Starting-point EV/Sales multiples by Yahoo assetProfile.sector. This is
// reference data, not a recommendation — always shown as an editable,
// pre-filled input (auto badge + reset), never locked. Confirmed real
// Yahoo sector strings via live API testing 2026-07-23: "Consumer Cyclical"
// (RIVN), "Technology" (PLTR, AAPL). The full set below is the standard
// 11-sector GICS-style list Yahoo uses; verify any unseen sector string
// against a live response before assuming it's covered.
CONFIG.SECTOR_EV_SALES = {
  'Technology': 6,
  'Healthcare': 4,
  'Communication Services': 4,
  'Financial Services': 3,
  'Real Estate': 3,
  'Industrials': 2,
  'Consumer Defensive': 2,
  'Utilities': 2,
  'Consumer Cyclical': 2,
  'Basic Materials': 1.5,
  'Energy': 1.5,
};
CONFIG.DEFAULT_EV_SALES = 2.5; // fallback when sector is missing or unrecognized

// Starting-point Sales-to-Capital ratios by Yahoo assetProfile.sector —
// how much revenue this company generates per $1 of reinvestment
// (CapEx + working capital). Reference data, not a recommendation —
// always an editable, pre-filled input (auto badge + reset), never
// locked. Same keys as CONFIG.SECTOR_EV_SALES above.
CONFIG.SECTOR_SALES_TO_CAPITAL = {
  'Technology': 2.5,
  'Communication Services': 2.2,
  'Healthcare': 1.8,
  'Financial Services': 2.5,
  'Real Estate': 0.8,
  'Consumer Defensive': 2.0,
  'Consumer Cyclical': 1.5,
  'Industrials': 1.2,
  'Utilities': 0.6,
  'Basic Materials': 1.0,
  'Energy': 1.0,
};
CONFIG.DEFAULT_SALES_TO_CAPITAL = 1.8; // fallback when sector is missing or unrecognized

if (typeof module !== 'undefined') module.exports = { CONFIG };
