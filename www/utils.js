function safe(v) {
  return (v != null && isFinite(v)) ? v : null;
}

function fmt(v, decimals = 1, suffix = '', prefix = '') {
  const s = safe(v);
  return s !== null ? `${prefix}${s.toFixed(decimals)}${suffix}` : 'N/A';
}

function formatMarketCap(v, sym = '') {
  const s = safe(v);
  if (s === null) return 'N/A';
  if (Math.abs(s) >= 1e12) return `${sym}${(s / 1e12).toFixed(2)}T`;
  if (Math.abs(s) >= 1e9)  return `${sym}${(s / 1e9).toFixed(2)}B`;
  if (Math.abs(s) >= 1e6)  return `${sym}${(s / 1e6).toFixed(1)}M`;
  return `${sym}${s.toFixed(0)}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isFinancialSector(sector) {
  return !!(sector && /financial|insurance/i.test(sector));
}

function isRealEstateSector(sector) {
  return !!(sector && /real estate/i.test(sector));
}

// Banks and insurers — FCF-based DCF is structurally broken for these, so the
// tool defaults them to the Dividend Discount Model. Matches on industry first
// (e.g. "Banks—Diversified", "Insurance—Property & Casualty") with a sector
// fallback for insurance.
function isBankOrInsurance(sector, industry) {
  const s = sector || '';
  const i = industry || '';
  return /bank|insurance/i.test(i) || /bank|insurance/i.test(s);
}

// Sustainable dividend growth seed. Dividends grow slower and steadier than
// earnings, so we use earningsGrowth (then revenueGrowth) but clamp tighter
// than deriveBaseGrowth. Falls back to 0.04.
function deriveDividendGrowth(earningsGrowth, revenueGrowth) {
  const g = [earningsGrowth, revenueGrowth].find(v => safe(v) !== null);
  if (g === undefined) return 0.04;
  // Cap at 6%: mature financials don't sustain high dividend growth the way
  // earnings can spike in a good underwriting / credit year.
  return Math.max(0.0, Math.min(0.06, g));
}

// Minimum beta to use when seeding DDM cost of equity for non-US markets.
// Yahoo Finance computes beta against the S&P 500. For ASX / Indian / other
// international stocks the correlation to the S&P 500 is low, producing
// artificially small betas and therefore unrealistically low Re seeds.
// US tickers (no suffix) get floor 0 — Yahoo's beta is correct by definition.
function getMarketBetaFloor(ticker) {
  if (!ticker) return 0;
  const t = ticker.toUpperCase();
  if (!t.includes('.')) return 0;       // US — no floor
  if (t.endsWith('.AX')) return 0.5;    // ASX vs S&P 500 understates beta
  if (t.endsWith('.NS') || t.endsWith('.BO')) return 0.6;  // India
  return 0.5;                           // other international (.L, .HK, .DE …)
}

// Average of revenueGrowth + earningsGrowth, clamped to [-0.05, 0.25]. Falls back to 0.05.
function deriveBaseGrowth(revenueGrowth, earningsGrowth) {
  const valid = [revenueGrowth, earningsGrowth].filter(v => safe(v) !== null);
  if (valid.length === 0) return 0.05;
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  return Math.max(-0.05, Math.min(0.25, avg));
}

function isAsxTicker(ticker) {
  return !!(ticker && ticker.toUpperCase().endsWith('.AX'));
}

// Returns { label, range } for the known ASX sector WACC reference ranges,
// or null when the sector/industry doesn't match any known category.
function getAsxSectorWaccRange(sector, industry) {
  const combined = `${(industry || '')} ${(sector || '')}`.toLowerCase();
  if (/bank|insurance|financial/.test(combined))              return { label: 'Banking & Financials',     range: '8.5–9.5%'  };
  if (/mining|resource|material|gold|steel|coal|iron|copper/.test(combined)) return { label: 'Mining & Resources', range: '10.0–12.0%' };
  if (/real estate|reit|property/.test(combined))             return { label: 'Real Estate (A-REIT)',      range: '7.5–9.0%'  };
  if (/health|biotech|pharmaceutical|medical/.test(combined)) return { label: 'Healthcare & Biotech',     range: '8.5–10.0%' };
  if (/utilit|infrastructure|gas|electric|water|transport/.test(combined)) return { label: 'Utilities & Infrastructure', range: '6.5–8.0%' };
  return null;
}

if (typeof module !== 'undefined') module.exports = {
  safe, fmt, formatMarketCap, escapeHtml,
  isFinancialSector, isRealEstateSector, isBankOrInsurance,
  isAsxTicker, getAsxSectorWaccRange,
  deriveBaseGrowth, deriveDividendGrowth, getMarketBetaFloor,
};
