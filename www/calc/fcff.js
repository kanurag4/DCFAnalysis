// Free cash flow to the firm by Damodaran's definitions (valuation method v2, 2026-11-21). Spec:
// docs/superpowers/specs/2026-11-20-fcff-damodaran-design.md (simplified: one DCF, today's shape, only the inputs change).
//
//   FCFF = operating income x (1 - t) + D&A - 4-yr avg capex - 4-yr avg acquisitions - lease reinvestment
//          - max(0, 4-yr avg non-cash WC % of revenue x revenue x growth)
//   operating income = reported (before unusual charges) - 4-yr avg CASH unusual charges (net of reversals, floored
//          at 0) + imputed operating-lease interest (US); cyclical: 4-yr avg operating margin x revenue
//   t = 4-yr effective rate, bounded [0, marginal + 10 pts]; the terminal year is taxed at the marginal rate
//          (terminalFactor, applied by calc/dcf.js / fadingGrowthDcf.js)
//   established company (positive operating income each of the last 4 years) with FCFF <= 0 -> the 4-yr average of
//          reported FCF (operating cash flow - capex), labelled as a fallback
//   missing operating income / D&A / capex -> operating cash flow - capex (never Yahoo's freeCashflow)
//
// Inputs are fetchDCFData()'s fields (www/dcf/data.js fcffInputsFromTimeseries + the existing ones). Pure, no DOM.
// Shared browser global scope: every top-level name starts with fcff / FCFF. Authored here, vendored byte-identical
// into DCFAnalysis www/calc/ (scripts/shared-files-manifest.json).

const FCFF_METHOD_ON = true; // switched on 2026-11-21 together with EDGAR primary (user, 2026-11-20: one switch-on)
const FCFF_HISTORY_YEARS = 4; // own name: HISTORY_WINDOW_YEARS lives in dcf/utils.js (same global scope)
const FCFF_TAX_CAP_OVER_MARGINAL = 0.10;
const FCFF_CROSS_CHECK_GAP = 0.30;

function fcffNum(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

// The latest FCFF_HISTORY_YEARS points with a finite value, oldest first.
function fcffLatest(series) {
  return (Array.isArray(series) ? series : [])
    .filter(e => e && e.date && fcffNum(e.value) !== null)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-FCFF_HISTORY_YEARS);
}
function fcffLast(series) { const l = fcffLatest(series); return l.length ? l[l.length - 1].value : null; }
function fcffAt(series, date) {
  const e = (Array.isArray(series) ? series : []).find(p => p && p.date === date && fcffNum(p.value) !== null);
  return e ? e.value : null;
}
function fcffRevenue(data) {
  return fcffNum(data.ttmRevenue) ?? fcffNum(data.totalRevenue) ?? fcffLast(data.annualRevenueHistory);
}

function fcffOperatingIncome(data, { cyclical = false, costOfDebt = null } = {}) {
  const d = data || {};
  let reported = fcffNum(d.ttmOperatingIncome) ?? fcffLast(d.annualOperatingIncomeHistory) ?? fcffNum(d.ebit);
  let source = fcffNum(d.ttmOperatingIncome) !== null ? 'ttm' : (fcffLast(d.annualOperatingIncomeHistory) !== null ? 'annual' : (reported !== null ? 'ebit' : null));
  if (cyclical) {
    const margins = fcffLatest(d.annualOperatingIncomeHistory)
      .map(e => { const r = fcffAt(d.annualRevenueHistory, e.date); return r ? e.value / r : null; })
      .filter(m => m !== null);
    const rev = fcffRevenue(d);
    if (margins.length && rev !== null) {
      reported = (margins.reduce((a, b) => a + b, 0) / margins.length) * rev;
      source = 'cyclical-margin';
    }
  }
  // Yahoo's OperatingIncome is BEFORE unusual items (checked 2026-11-21: INTC FY2024 -4.71B vs -11.68B as reported, the
  // gap = its special charges incl. 2.48B restructuring; MMM FY2022 1.92B vs 4.37B, a one-off gain left out), so the
  // cash charges are subtracted once here, never twice. Divided by 4, not by the years present: Yahoo omits a zero line.
  const charges = [...fcffLatest(d.annualRestructuringHistory), ...fcffLatest(d.annualOtherSpecialChargesHistory)];
  const cashChargesAvg = Math.max(0, charges.reduce((s, e) => s + e.value, 0) / FCFF_HISTORY_YEARS);
  let leaseInterest = 0;
  if (d.reportingRegime === 'us-gaap') {
    const lease = fcffLast(d.annualOperatingLeaseLiabilityHistory);
    const rate = fcffNum(d.operatingLeaseRate) ?? fcffNum(costOfDebt) ?? 0;
    if (lease !== null) leaseInterest = rate * lease;
  }
  const value = reported === null ? null : reported - cashChargesAvg + leaseInterest;
  return { value, reported, cashChargesAvg, leaseInterest, source };
}

function fcffTaxRate(data, marginal) {
  const d = data || {};
  const m = fcffNum(marginal) ?? 0.25;
  let tax = 0, pretax = 0, n = 0;
  for (const e of fcffLatest(d.annualPretaxIncomeHistory)) {
    const t = fcffAt(d.annualTaxProvisionHistory, e.date);
    if (t === null) continue;
    tax += t; pretax += e.value; n++;
  }
  const raw = n && pretax > 0 ? tax / pretax : m;
  return { effective: Math.min(Math.max(raw, 0), m + FCFF_TAX_CAP_OVER_MARGINAL), marginal: m };
}

// Average yearly change over the window's points, floored at 0 (a fall from closures or disposals is never cash).
function fcffAvgGrowth(points) {
  if (points.length < 2) return 0;
  return Math.max(0, (points[points.length - 1].value - points[0].value) / (points.length - 1));
}

function fcffLeaseReinvestment(data) {
  const d = data || {};
  if (d.reportingRegime === 'us-gaap') {
    const dates = new Set([...fcffLatest(d.annualOperatingLeaseLiabilityHistory), ...fcffLatest(d.annualFinanceLeaseLiabilityHistory)].map(e => e.date));
    const total = [...dates].sort().map(date => ({ date, value: (fcffAt(d.annualOperatingLeaseLiabilityHistory, date) || 0) + (fcffAt(d.annualFinanceLeaseLiabilityHistory, date) || 0) }));
    return fcffAvgGrowth(total.slice(-FCFF_HISTORY_YEARS)) + (fcffNum(d.financeLeaseRouAmortization) || 0);
  }
  const growth = fcffAvgGrowth(fcffLatest(d.annualLeaseLiabilitiesHistory));
  const cur = fcffLatest(d.annualCurrentLeaseLiabilitiesHistory);
  const principal = cur.length > 1 ? cur[cur.length - 2].value : (cur.length ? cur[0].value : 0);
  return growth + principal;
}

function fcffWorkingCapitalPct(data) {
  const d = data || {};
  const pcts = [];
  for (const e of fcffLatest(d.annualRevenueHistory)) {
    const ca = fcffAt(d.annualCurrentAssetsHistory, e.date), cl = fcffAt(d.annualCurrentLiabilitiesHistory, e.date);
    // A year without its cash figure is skipped, never read as zero cash (that would count all the cash as working
    // capital; review 2026-11-21). A missing current-debt point is zero debt, as filers omit a nil line.
    const cash = fcffAt(d.annualCashAndStHistory, e.date);
    if (ca === null || cl === null || cash === null || !e.value) continue;
    const nonCash = (ca - cash) - (cl - (fcffAt(d.annualCurrentDebtInclLeasesHistory, e.date) || 0));
    pcts.push(nonCash / e.value);
  }
  return pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : null;
}

function fcffWorkingCapital(data, growth) {
  const pct = fcffWorkingCapitalPct(data);
  const rev = fcffRevenue(data || {});
  if (pct === null || rev === null || fcffNum(growth) === null) return 0;
  return Math.max(0, pct * rev * growth);
}

// Divided by 4, not by the years present (review 2026-11-21): Yahoo omits a zero acquisitions line, so a missing year
// is a year with none. Capex is averaged over the years present instead, because every company reports it.
function fcffAcquisitionsAvg(data) {
  return fcffLatest((data || {}).annualAcquisitionsHistory).reduce((s, e) => s + Math.abs(e.value), 0) / FCFF_HISTORY_YEARS;
}

function fcffEstablished(data) {
  const oi = fcffLatest((data || {}).annualOperatingIncomeHistory);
  return oi.length === FCFF_HISTORY_YEARS && oi.every(e => e.value > 0);
}

function fcffOcfMinusCapex(data) {
  const ocf = fcffNum(data.ttmOcf) ?? fcffNum(data.operatingCashflow);
  const capex = fcffNum(data.ttmCapex) ?? fcffNum(data.capitalExpenditures);
  return ocf !== null && capex !== null ? ocf - Math.abs(capex) : null;
}

function fcffBase(data, { growth = 0, marginal = 0.25, cyclical = false, costOfDebt = null } = {}) {
  const d = data || {};
  const oi = fcffOperatingIncome(d, { cyclical, costOfDebt });
  const tax = fcffTaxRate(d, marginal);
  // TTM D&A, else Yahoo ReconciledDepreciation (some ASX / IFRS filers have only this), else the statement figure.
  const da = fcffNum(d.ttmDepreciation) ?? fcffNum(d.reconciledDepreciation) ?? fcffNum(d.depreciationAndAmortization);
  const capexPts = fcffLatest(d.annualCapexHistory);
  const capexAvg = capexPts.length ? capexPts.reduce((s, e) => s + Math.abs(e.value), 0) / capexPts.length
    : (fcffNum(d.ttmCapex) !== null ? Math.abs(d.ttmCapex) : null);
  const established = fcffEstablished(d);
  if (oi.value === null || da === null || capexAvg === null) {
    return { fcff: fcffOcfMinusCapex(d), terminalFactor: 1, fallback: 'ocf-capex', terms: { operatingIncome: oi.value, established } };
  }
  const acquisitionsAvg = fcffAcquisitionsAvg(d);
  const leaseReinvestment = fcffLeaseReinvestment(d);
  const reinvestment = capexAvg - da + acquisitionsAvg + leaseReinvestment;
  const workingCapital = fcffWorkingCapital(d, growth);
  const value = oi.value * (1 - tax.effective) - reinvestment - workingCapital;
  const terms = {
    operatingIncome: oi.value, reportedOperatingIncome: oi.reported, operatingIncomeSource: oi.source,
    cashChargesAvg: oi.cashChargesAvg, leaseInterest: oi.leaseInterest, effectiveTax: tax.effective, marginalTax: tax.marginal,
    depreciation: da, capexAvg, acquisitionsAvg, leaseReinvestment, reinvestment, workingCapital,
    workingCapitalPct: fcffWorkingCapitalPct(d), established,
  };
  if (value <= 0 && established) {
    const fcfs = fcffLatest(d.annualFcfHistory);
    if (fcfs.length) {
      return { fcff: fcfs.reduce((s, e) => s + e.value, 0) / fcfs.length, terminalFactor: 1, fallback: 'ocf-capex-avg', terms: { ...terms, fcffComputed: value } };
    }
  }
  // Terminal year at the marginal rate. When that taxed figure is zero or below the business has no terminal cash
  // flow, so the factor floors at 0 (no terminal value) instead of turning the terminal value negative.
  const rawFactor = value > 0 ? 1 - (oi.value * (tax.marginal - tax.effective)) / value : 1;
  const terminalFactor = Math.max(0, rawFactor);
  return { fcff: value, terminalFactor, fallback: null, terms: rawFactor < 0 ? { ...terms, terminalFactorFloored: true } : terms };
}

// Added to firm value after net debt: long-term securities and stakes (book) minus minority interests (book).
function fcffEquityBridge(data) {
  const d = data || {};
  return (fcffNum(d.longTermInvestments) || 0) - (fcffNum(d.minorityInterest) || 0);
}

// US lease liabilities missing from Yahoo's total debt, subtracted from equity like debt (review 2026-11-21). Yahoo
// counts leases in TotalDebt when it reports a lease line for that year (MCD, DAL, WMT: TotalDebt - lease line =
// borrowings); when it reports none (AAPL since FY2024) TotalDebt is borrowings only, so the EDGAR operating + finance
// lease liabilities are added. IFRS 16 filers: Yahoo's debt already carries the leases -> 0.
function fcffLeaseDebtMissing(data) {
  const d = data || {};
  if (d.reportingRegime !== 'us-gaap') return 0;
  const debt = fcffLatest(d.annualTotalDebtHistory);
  const yahooLease = fcffLatest(d.annualLeaseLiabilitiesHistory);
  const debtDate = debt.length ? debt[debt.length - 1].date : null;
  if (debtDate ? yahooLease.some(e => e.date === debtDate) : yahooLease.length > 0) return 0;
  return Math.max(0, (fcffLast(d.annualOperatingLeaseLiabilityHistory) || 0) + (fcffLast(d.annualFinanceLeaseLiabilityHistory) || 0));
}

// The OCF route (operating cash flow - capex + after-tax interest - acquisitions) beside FCFF: a "Numbers used" note
// when they differ by more than FCFF_CROSS_CHECK_GAP, never a different value. Stock-based pay is not fetched, so the
// OCF route here still includes its add-back.
function fcffOcfCrossCheck(data, fcffValue, taxRate) {
  const d = data || {};
  const base = fcffOcfMinusCapex(d);
  if (base === null || fcffNum(fcffValue) === null) return { ocfRoute: null, gapPct: null, flag: false };
  const interest = Math.abs(fcffNum(d.interestExpense) || 0) * (1 - (fcffNum(taxRate) ?? 0.25));
  const ocfRoute = base + interest - fcffAcquisitionsAvg(d);
  const gapPct = ocfRoute ? (fcffValue - ocfRoute) / Math.abs(ocfRoute) : null;
  return { ocfRoute, gapPct, flag: gapPct !== null && Math.abs(gapPct) > FCFF_CROSS_CHECK_GAP };
}

if (typeof module !== 'undefined') module.exports = {
  FCFF_METHOD_ON, FCFF_HISTORY_YEARS, fcffOperatingIncome, fcffTaxRate, fcffLeaseReinvestment, fcffWorkingCapital,
  fcffWorkingCapitalPct, fcffAcquisitionsAvg, fcffEstablished, fcffBase, fcffEquityBridge, fcffLeaseDebtMissing, fcffOcfCrossCheck,
};
