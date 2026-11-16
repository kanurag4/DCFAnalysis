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

// Property REITs — where FFO/AFFO-based valuation replaces standard FCF-based
// DCF (GAAP depreciation artificially depresses net income/FCF for real estate
// even though the underlying property often appreciates). Matches Yahoo's
// "REIT - <type>" industry tags, EXCLUDING "REIT - Mortgage" (mortgage REITs
// hold loans/securities, not property — FFO/AFFO doesn't describe their
// economics; they route to isBankOrInsurance() -> DDM/Excess-Return instead,
// see that function below). Does NOT match generic real-estate industry tags
// ("Real Estate Services", "Real Estate—Development") — those stay on
// standard DCF, same as any other non-REIT company.
function isReit(sector, industry) {
  const i = industry || '';
  if (/^REIT\s*-\s*Mortgage/i.test(i)) return false;
  return /^REIT\b/i.test(i);
}

// Airlines: extreme cyclicality + high operating/financial leverage make a
// single trailing-year FCF/growth DCF unreliable (confirmed live 2026-08-20:
// QAN.AX returns no DCF value at all despite positive EBITDA; DAL's DCF
// shows a materially different margin of safety than an EV/EBITDA read).
// Routed to calc/airline.js's multiple-based model instead — same shape as
// isReit()'s REIT carve-out.
function isAirline(sector, industry) {
  return /^airlines$/i.test(industry || '');
}

// Regulated utilities: rate-base-and-allowed-return economics (a regulator
// sets how much the utility can earn on its asset base) produce the same
// "value = book equity + PV of excess returns" shape as a bank -- routed
// to calc/excessReturn.js, same engine banks already use, via a new
// deriveDcfAssumptions() dispatch branch (see calc/assumptions.js). Only
// matches the regulated sub-industries -- "Utilities - Independent Power
// Producers" and "Utilities - Renewable" are merchant/unregulated
// generation, genuinely DCF-appropriate, so explicitly excluded (confirmed
// live 2026-08-23: AGL.AX is tagged "Utilities - Independent Power
// Producers"). Yahoo tags real regulated examples: NEE, DUK both
// "Utilities - Regulated Electric" (confirmed live).
function isUtility(sector, industry) {
  return /^Utilities\s*-\s*(Regulated (Electric|Gas|Water)|Diversified)$/i.test(industry || '');
}

// Cyclical/commodity companies: a single trailing-year FCF is unreliable as
// a DCF base year because it can sit at a cycle peak or trough (Damodaran's
// rule for cyclicals -- normalize margins across a full cycle, don't
// project off wherever the cycle happens to be right now). Routed to
// calc/cyclicalNormalization.js's base-year adjustment via
// calc/assumptions.js -- unlike isReit()/isAirline()/isUtility(), this does
// NOT change valuationModel; cyclicals stay on plain DCF, just with a
// normalized FCF input. Confirmed live 2026-08-23: BHP.AX/RIO.AX =
// "Other Industrial Metals & Mining", WDS.AX = "Oil & Gas E&P",
// TM = "Auto Manufacturers", CLF = "Steel".
// Oil & Gas Refining & Marketing/Thermal Coal/Aluminum added 2026-08-24 --
// found missing while auditing refineries specifically: RELIANCE.NS,
// CASTROLIND.NS and 096770.KS (all "Oil & Gas Refining & Marketing"),
// YAL.AX ("Thermal Coal", only "Coking Coal" was covered) and AAI.AX
// ("Aluminum") were all already-published tickers silently falling through
// to plain trailing-year DCF with no cycle normalization.
const CYCLICAL_INDUSTRIES = /^(Gold|Silver|Copper|Steel|Coking Coal|Thermal Coal|Aluminum|Other Industrial Metals & Mining|Oil & Gas E&P|Oil & Gas Integrated|Oil & Gas Equipment & Services|Oil & Gas Refining & Marketing|Auto Manufacturers|Auto Parts|Chemicals|Specialty Chemicals|Marine Shipping|Semiconductors)$/i;
function isCyclical(sector, industry) {
  return CYCLICAL_INDUSTRIES.test(industry || '');
}

// Manual ticker allowlist for known cross-holding/conglomerate structures
// this site's users report -- starts empty (per the design spec), grows
// over time. Kept separate from the industry-tag check below so a ticker
// that trades as a conglomerate in practice but isn't tagged that way by
// Yahoo can still be routed here.
const HOLDCO_TICKER_ALLOWLIST = new Set([]);

// Conglomerates: a documented holding-company discount (see
// calc/holdcoDiscount.js) applied on top of whatever model the ticker
// would normally get -- NOT a real segment-level sum-of-the-parts
// valuation, which Yahoo's API doesn't support (no per-segment financials
// available, confirmed 2026-08-23 -- see the design spec's Model 2
// section). Confirmed live: HON and MMM are both tagged Industrials /
// "Conglomerates" by Yahoo.
function isConglomerate(sector, industry, ticker) {
  if (/^Conglomerates$/i.test(industry || '')) return true;
  return HOLDCO_TICKER_ALLOWLIST.has((ticker || '').toUpperCase());
}

// SEO-copy classifier only -- does NOT feed deriveDcfAssumptions() or any
// valuation-model dispatch, so it's exempt from the model-dispatch
// consumer checklist (live tool / evaluate / ticker-page generators /
// worker-watchlist). Used only by the DCF and growth ticker-page
// generators to add "SaaS valuation" to a page's title/meta for companies
// genuinely known as SaaS. Deliberately a manual ticker allowlist, not a
// Yahoo industry-tag check like the classifiers above -- "Software -
// Application"/"Software - Infrastructure" is too unreliable to match
// directly (confirmed live 2026-08-26: COVER Corporation, a Japanese
// VTuber talent agency, is tagged "Software - Application" same as
// Twilio; Microsoft/Uber/Oracle/Adobe/Palantir also fall under those two
// industry tags but aren't what "<company> saas valuation" searchers
// mean). Seeded from real GSC query demand (2026-08-26: twilio/snowflake/
// okta/crowdstrike/autodesk/atlassian saas valuation, all 0-click at
// position 28-85) plus other unambiguous SaaS names -- grows over time,
// same pattern as HOLDCO_TICKER_ALLOWLIST above.
const SAAS_TICKER_ALLOWLIST = new Set([
  'TWLO', 'OKTA', 'ADSK', 'TEAM', 'CRWD', 'SNOW', 'DDOG', 'GWRE', 'ZETA',
  'XRO.AX', 'WTC.AX', '4478.T',
]);

function isSaas(ticker) {
  return SAAS_TICKER_ALLOWLIST.has((ticker || '').toUpperCase());
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
//
// BANK_TICKER_ALLOWLIST (2026-11-16): companies that run a bank's balance sheet but that
// Yahoo tags otherwise. Macquarie (MQG.AX) is "Financial Services / Capital Markets", yet
// its lending book flows through operating cash flow (-A$31.6B), so DCF finds no value.
// Full Yahoo symbol only, same explicit-list pattern as HOLDCO/SAAS above -- the tag lives
// here, not in the data store, because the store mirrors Yahoo and is refreshed daily.
const BANK_TICKER_ALLOWLIST = new Set(['MQG.AX']);

function isBankOrInsurance(sector, industry, ticker) {
  const s = sector || '';
  const i = industry || '';
  if (/bank|insurance/i.test(i) || /bank|insurance/i.test(s)) return true;
  if (BANK_TICKER_ALLOWLIST.has((ticker || '').toUpperCase())) return true;
  if (/^REIT\s*-\s*Mortgage/i.test(i)) return true; // mortgage REITs -- loan-book economics, not property
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

// CAGR between the first and last *positive* points of a [{date,value}]
// series. Ported from scripts/lib/etf/growth-rate.js's already-proven
// seriesCagr (shipped with the ETF radar 2026-09-01) so every DCF consumer
// shares one implementation instead of the radar keeping its own copy.
// Returns null unless there are >= minPoints non-null points spanning >=
// minYears -- a 2-point series with only a 1-year gap is just a 1-year rate,
// which isn't the "multi-year trend" this function is for.
// Multi-year calculations use the latest 4 fiscal years (user decision 2026-11-06). Yahoo serves 4 annual
// periods; our own market-data store keeps every year it has seen and adds each new one, so a series can be
// longer. Without this window a value would drift as the store's history grows (AAPL Base $128 on 4 years
// vs $114 on 5). calc/cyclicalNormalization.js, calc/heavyCapex.js and calc/fiscalYearAlign.js apply the
// same 4 with their own copy of this constant (tests/history-window.test.js keeps them equal).
const HISTORY_WINDOW_YEARS = 4;

// The newest `n` entries of a [{date, value}] series by date, oldest first. Entries without a date are
// dropped only when the series is longer than the window (a short series passes through untouched).
function latestYears(series, n = HISTORY_WINDOW_YEARS) {
  const arr = Array.isArray(series) ? series : [];
  if (arr.length <= n) return arr;
  return arr.filter(e => e && e.date).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(-n);
}

function seriesCagr(series, { minPoints = 3, minYears = 2 } = {}) {
  const pts = latestYears(series)
    .filter(e => e && e.value != null && isFinite(e.value));
  if (pts.length < minPoints) return null;
  const first = pts[0], last = pts[pts.length - 1];
  if (!(first.value > 0) || !(last.value > 0)) return null; // sign flips make CAGR meaningless
  const yr = (d) => (/^\d{4}/.test(String(d || '')) ? Number(String(d).slice(0, 4)) : null);
  const y0 = yr(first.date), y1 = yr(last.date);
  const years = (y0 != null && y1 != null) ? y1 - y0 : pts.length - 1;
  if (years < minYears) return null;
  return Math.pow(last.value / first.value, 1 / years) - 1;
}

// Damodaran's fundamental growth: retention ratio x ROE, averaged over every
// fiscal year with both net income and stockholders' equity on record
// (Investment Valuation, ch. 11 -- ties growth to a company's real
// reinvestment capacity, not its price/earnings history). A year is
// excluded, not zeroed, when net income <= 0 (retention/ROE are meaningless
// off a loss) or equity <= 0 (a negative-equity balance sheet breaks ROE as
// a growth proxy). retention is floored at 0 (never negative) when
// dividends paid exceed net income -- a company funding a payout from
// reserves/debt is modeled as retaining nothing, not as actively destroying
// capital; that floor is a deliberate conservative choice, matching this
// codebase's existing bias toward capping optimistic-looking inputs rather
// than letting one distorted year swing the result (see
// calc/cyclicalNormalization.js for the same philosophy applied to FCF).
// Needs >= minYears valid years to trust the average -- same bar
// cyclicalNormalization.js's own minYears already uses.
function fundamentalGrowth({ netIncomeHistory, equityHistory, dividendsHistory, minYears = 2 }) {
  const niByDate = new Map(
    latestYears(netIncomeHistory)
      .filter(e => e && e.value != null && isFinite(e.value))
      .map(e => [e.date, e.value])
  );
  const divByDate = new Map(
    latestYears(dividendsHistory)
      .filter(e => e && e.value != null && isFinite(e.value))
      .map(e => [e.date, e.value])
  );

  const rates = [];
  for (const e of latestYears(equityHistory)) {
    if (!e || e.value == null || !isFinite(e.value) || e.value <= 0) continue;
    const ni = niByDate.get(e.date);
    if (ni == null || ni <= 0) continue;
    const roe = ni / e.value;
    const paidOut = divByDate.has(e.date) ? Math.min(Math.abs(divByDate.get(e.date)), ni) : 0;
    const retention = 1 - (paidOut / ni);
    rates.push(retention * roe);
  }
  if (rates.length < minYears) return null;
  return rates.reduce((a, b) => a + b, 0) / rates.length;
}

function oneYearFallbackGrowth(data) {
  const y = [data.revenueGrowth, data.earningsGrowth].filter(v => v != null && isFinite(v));
  return y.length ? Math.min(...y) : 0.05;
}

// The forward growth seed for every DCF consumer (live tool, /evaluate/,
// Watchlist, the 6 undervalued screens, the ticker-page generator, the ETF
// radar). Replaces deriveBaseGrowth's 1-year Yahoo average, which clamps a
// single distorted year (an earnings rebound off a crisis-depressed base)
// to the +25% ceiling and produces a 3-7x intrinsic-value blow-up for a
// structurally mid-single-digit-growth mega-cap -- see the spec's UNH/LMT
// evidence table.
//
// fundamentalGrowth (retention x ROE) is Damodaran's actual preferred
// method -- it is the primary signal. The multi-year revenue/FCF CAGR (the
// same technique already shipped on the ETF radar) is a sanity cross-check:
// a serial acquirer's ROE can look excellent on paper while revenue/FCF
// barely move, so the lower of the two wins. Falls through to the
// historical CAGR alone when fundamentals aren't computable (short
// history), then the 1-year figure, then 0.05 -- the exact fallback chain
// the ETF radar already ships. Raw growth is clamped to [-0.05, 0.15] --
// tighter than deriveBaseGrowth's [-0.05, 0.25], since a multi-year anchor
// no longer needs the wider ceiling to accommodate a single good/bad year.
//
// Cyclical tickers (isCyclical()) skip the historical-CAGR cross-check and
// use fundamental growth alone when it's computable. A 2-point endpoint CAGR
// is unreliable for a commodity cyclical -- whichever two years happen to
// bookend the window can coincidentally read as flat/negative even when the
// business is fine (confirmed live, BHP.AX: FCF $16.74B in FY2023 vs
// $16.69B in FY2026 reads as -0.1% despite a real mid-cycle trough to
// $13.00B and recovery in between). This project already treats cyclicals'
// BASE FCF the same way (calc/cyclicalNormalization.js averages the margin
// across the cycle instead of anchoring to one year) -- this extends the
// same reasoning to the growth seed. Falls through to the historical CAGR
// (still useful as a last resort) when fundamentals aren't computable even
// for a cyclical, same as the non-cyclical path.
function deriveMultiYearGrowth(data) {
  if (!data) return 0.05;

  const fg = fundamentalGrowth({
    netIncomeHistory: data.annualNetIncomeHistory,
    equityHistory: data.annualStockholdersEquityHistory,
    dividendsHistory: data.annualDividendsPaidHistory,
  });

  const revCagr = seriesCagr(data.annualRevenueHistory);
  const fcfCagr = seriesCagr(data.annualFcfHistory);
  const historical = [revCagr, fcfCagr].filter(x => x != null);
  const historicalGrowth = historical.length ? Math.min(...historical) : null;

  const cyclical = isCyclical(data.sector, data.industry);

  let raw;
  if (fg != null && cyclical) raw = fg;
  else if (fg != null) raw = (historicalGrowth != null) ? Math.min(fg, historicalGrowth) : fg;
  else if (historicalGrowth != null) raw = historicalGrowth;
  else raw = oneYearFallbackGrowth(data);

  return Math.max(-0.05, Math.min(0.15, raw));
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

// AI Sector Correlation cell for the undervalued screens: just the 2dp number, coloured by TEXT like the
// Altman Z cell (no pill, no band word). `ai` is the { r, n, band } object
// scripts/lib/ai-correlation-batch.js writes into each rankings.json row (null when unavailable -> a dash).
// Reuses the screens' existing .neg / .warn / .pos text colours; None gets .ai-none (cyan). High and
// Inverse are both red: the colour reads as strength of dependence on the AI sector in either direction.
// The band -> class map is duplicated from calc/aiCorrelation.js's bands on purpose (this is a plain
// browser script and can't require() the calc module); the band is checked against the map, so nothing
// unexpected can reach the class attribute.
const AI_CORR_BAND_CLASS = { high: 'neg', inverse: 'neg', moderate: 'warn', low: 'pos', none: 'ai-none' };
function aiCorrTd(ai) {
  if (!ai || typeof ai.r !== 'number' || !isFinite(ai.r) ||
      !Object.prototype.hasOwnProperty.call(AI_CORR_BAND_CLASS, ai.band)) return '<td class="num">—</td>';
  return `<td class="num ${AI_CORR_BAND_CLASS[ai.band]}">${ai.r.toFixed(2)}</td>`;
}

if (typeof module !== 'undefined') module.exports = {
  safe, fmt, formatMarketCap, escapeHtml,
  aiCorrTd,
  deriveFcf,
  isFinancialSector, isRealEstateSector, isReit, isAirline, isUtility, isCyclical, isConglomerate, isSaas, isBankOrInsurance, chooseFinancialModel,
  isAsxTicker, getAsxSectorWaccRange,
  getUsSectorWaccRange, getIndianSectorWaccRange,
  deriveBaseGrowth, deriveDividendGrowth, getMarketBetaFloor,
  deriveMultiYearGrowth, seriesCagr, fundamentalGrowth, latestYears, HISTORY_WINDOW_YEARS,
  formatUpdatedDate,
};
