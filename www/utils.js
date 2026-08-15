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

// Broad financial-sector check used to show the normalised-FCF panel for
// asset managers, exchanges, and other financials that still run on DCF.
// Intentionally wider than isBankOrInsurance — see that function for the
// subset that switches to DDM entirely.
// Free cash flow to use for valuation, and how it was obtained.
// Prefer Yahoo's reported FCF (already OCF − CapEx). If missing, derive it as
// OCF − |CapEx| using actual capital expenditure. If CapEx is also missing
// fall back to OCF × 0.8 — a rough proxy (CapEx ≈ 20% of OCF) that overstates
// FCF for very capital-intensive businesses (miners, energy, utilities, telcos).
// Only when NO TTM-based figure exists at all (Yahoo's financialData module
// only ever reports TTM, and some tickers — confirmed live: TECHM.NS — simply
// have no TTM number computed, even though every individual fiscal year does)
// fall back to the latest annual FCF (e.g. from /timeseries' annualFreeCashFlow).
// This tier is deliberately last: a stale full-fiscal-year figure is still
// less current than any TTM-based estimate, so it only fires when there is
// no TTM data of any kind to work with.
// Returns { value, method } with method 'reported' | 'derived' | 'proxy' | 'annual' | 'none'.
function deriveFcf(freeCashflow, operatingCashflow, capex, annualFcf) {
  if (safe(freeCashflow) !== null) return { value: freeCashflow, method: 'reported' };
  if (safe(operatingCashflow) !== null) {
    if (safe(capex) !== null) return { value: operatingCashflow - Math.abs(capex), method: 'derived' };
    return { value: operatingCashflow * 0.8, method: 'proxy' };
  }
  if (safe(annualFcf) !== null) return { value: annualFcf, method: 'annual' };
  return { value: null, method: 'none' };
}

function isFinancialSector(sector) {
  return !!(sector && /financial|insurance/i.test(sector));
}

function isRealEstateSector(sector) {
  return !!(sector && /real estate/i.test(sector));
}

// Narrow check: banks and insurers where FCF-based DCF is structurally broken
// -- defaults them to DDM. Intentionally excludes asset managers, payment
// networks, and exchanges that have real FCF and remain on the DCF path.
// Contrast with isFinancialSector, which is broader and gates the
// normalised-FCF panel rather than the full model switch.
//
// `ticker` (optional, 3rd param, added 2026-08-15) additionally routes Indian
// (.NS/.BO) NBFCs/mortgage financiers ("Credit Services"/"Mortgage Finance")
// to DDM too -- loan origination shows up as an operating cash *outflow* for
// any lender, the same distortion that already breaks DCF for banks. Found
// after confirming ~13% of NIFTY's "unvaluable" exclusions were large, real
// NBFCs (MUTHOOTFIN, SHRIRAMFIN, SBICARD, PFC, RECLTD, TATACAP, ...) hitting
// exactly this, not a data gap. Deliberately scoped to .NS/.BO tickers only,
// NOT global, because "Credit Services" is Yahoo's tag for payment networks
// too -- Visa and Mastercard are BOTH tagged Financial Services/Credit
// Services (confirmed live), with real, substantial FCF and near-zero
// leverage (debt/marketCap ~0.04-0.05, vs 0.7-8× for the NIFTY NBFCs above) --
// a US-listed "Credit Services" ticker with no .NS/.BO suffix is far more
// likely to be a Visa/Mastercard-style network than a lender, so a global
// match would wrongly force healthy, DCF-appropriate businesses into DDM.
// India doesn't have an equivalent domestically-listed payment-network company
// under this tag, which is what makes the ticker-suffix scope safe there.
// `ticker` is optional and defaults to not matching NBFC industries at all --
// every existing call site that omits it keeps today's behaviour unchanged.
function isBankOrInsurance(sector, industry, ticker) {
  const s = sector || '';
  const i = industry || '';
  if (/bank|insurance/i.test(i) || /bank|insurance/i.test(s)) return true;
  const t = (ticker || '').toUpperCase();
  if ((t.endsWith('.NS') || t.endsWith('.BO')) && /credit services|mortgage finance/i.test(i)) return true;
  return false;
}

// Decides DDM vs Excess Return Model WITHIN the population isBankOrInsurance()
// already routed away from DCF -- this function is never called for a DCF-valued
// company. DDM only "sees" the dividend actually paid out; a company retaining most
// of its earnings for growth at a high ROE creates real value DDM can't capture, so
// it's compared against the payout ratio that would be sustainable given its ROE
// and growth. `growth` must be the already-capped rate from deriveDividendGrowth()
// (max 6%), not raw earnings growth -- using the capped rate is what keeps the
// roe<=growth edge case rare for viable financial companies. Threshold is 0.5x
// sustainable payout, confirmed with user 2026-08-15. See
// docs/superpowers/specs/2026-08-15-excess-return-model-financials-design.md.
function chooseFinancialModel({ roe, dividend, trailingEps, growth }) {
  if (roe == null || roe <= 0) return 'ddm';
  const sustainablePayout = roe > growth ? (1 - growth / roe) : 0;
  const actualPayout = (dividend != null && trailingEps > 0) ? dividend / trailingEps : 0;
  return actualPayout < sustainablePayout * 0.5 ? 'excess-return' : 'ddm';
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
  // Korea: historically low betas (0.5-0.7) for mature firms partly reflect low share-price
  // volatility and low debt under the old regime — likely understated now that governance
  // reform and active investing are returning volatility. Floored at 0.6, matching India.
  if (t.endsWith('.KS')) return 0.6;
  // Japan: historically low betas (0.5-0.7) partly reflect deflation-era price stagnation —
  // likely understated now that volatility is returning as BOJ exits deflation policy.
  // Floored at 0.6, matching Korea/India.
  if (t.endsWith('.T')) return 0.6;
  return 0.5;                           // other international (.L, .HK, .DE …)
}

// WACC reference ranges for US stocks by sector.
function getUsSectorWaccRange(sector, industry) {
  const combined = `${(industry || '')} ${(sector || '')}`.toLowerCase();
  if (/utilit/.test(combined))                                              return { label: 'Regulated Utilities',       range: '5.5–6.5%'   };
  if (/real estate|reit/.test(combined))                                   return { label: 'Real Estate (REITs)',        range: '6.5–7.5%'   };
  if (/energy|oil|gas/.test(combined))                                     return { label: 'Energy & Oil / Gas',         range: '6.5–7.5%'   };
  if (/aerospace|defense/.test(combined))                                  return { label: 'Aerospace & Defense',        range: '7.0–8.0%'   };
  if (/retail|apparel|consumer cyclical/.test(combined))                   return { label: 'Retail & Apparel',           range: '7.5–8.5%'   };
  if (/biotech|pharmaceutical|drug|health/.test(combined))                 return { label: 'Biotech & Pharmaceuticals',  range: '8.0–10.0%'  };
  if (/technology|software|semiconductor|electronic|internet/.test(combined)) return { label: 'Technology & Software',  range: '8.5–10.5%'  };
  return null;
}

// WACC reference ranges for Indian (.NS / .BO) stocks by sector.
function getIndianSectorWaccRange(sector, industry) {
  const combined = `${(industry || '')} ${(sector || '')}`.toLowerCase();
  if (/bank|insurance|financial/.test(combined))                        return { label: 'Banking & Financial Services', range: '10.0–12.0%' };
  if (/software|information technology|it service|technology/.test(combined)) return { label: 'IT & Software',                  range: '11.0–14.0%' };
  if (/consumer|fmcg|beverage|food|tobacco|household/.test(combined))   return { label: 'FMCG & Consumer Staples',        range: '9.0–11.0%'  };
  if (/utilit|infrastructure|power|electric|water/.test(combined))      return { label: 'Utilities & Infrastructure',      range: '8.0–10.0%'  };
  if (/health|pharma|biotechnology|medical/.test(combined))             return { label: 'Pharmaceuticals & Healthcare',    range: '10.0–12.0%' };
  if (/material|steel|metal|mining|oil|energy|coal|chemical/.test(combined)) return { label: 'Commodities & Resources',   range: '11.0–13.0%' };
  return null;
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

// "Updated 17 Jul" from a batch asAt date (YYYY-MM-DD); year appended only when
// it differs from the current year. Returns null for anything unparseable so
// callers can leave the pill's date line empty rather than render garbage.
function formatUpdatedDate(asAt, now = new Date()) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(asAt || ''));
  if (!m) return null;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const year = +m[1], month = +m[2], day = +m[3];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let label = `Updated ${day} ${months[month - 1]}`;
  if (year !== now.getFullYear()) label += ` ${year}`;
  return label;
}

if (typeof module !== 'undefined') module.exports = {
  safe, fmt, formatMarketCap, escapeHtml,
  deriveFcf,
  isFinancialSector, isRealEstateSector, isBankOrInsurance, chooseFinancialModel,
  isAsxTicker, getAsxSectorWaccRange,
  getUsSectorWaccRange, getIndianSectorWaccRange,
  deriveBaseGrowth, deriveDividendGrowth, getMarketBetaFloor,
  formatUpdatedDate,
};
