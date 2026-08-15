// www/dcf/calc/assumptions.js — pure DCF/DDM assumption-seeding and
// scenario-assembly logic, extracted from app.js's prefillInputs()/
// buildScenarios() so the website's interactive tool and the native
// shell's Card Dashboard renderer compute IDENTICAL numbers from one
// source instead of two copies that can silently drift (see CLAUDE.md's
// Known Traps — this has already happened twice: the bear/bull inversion
// bug and the WACC null-marketCap bug).
//
// Depends on the already-pure helpers in utils.js, calc/wacc.js,
// calc/dcf.js, calc/ddm.js, calc/fadingGrowthDcf.js — all loaded as plain
// globals via <script> tags (same convention as the rest of this tool's
// calc layer), so this file reads them as bare identifiers, not imports.
// Zero document/window access.

// Market-specific fallback risk-free rates and equity risk premiums. The
// website's interactive tool refines liveRfRate/liveAusRfRate/
// liveIndRfRate via an async fetch after first paint — this module
// intentionally uses only the fixed fallback values below, matching
// exactly what the website itself shows before that live fetch resolves.
// Native shell Card Dashboards use these fallbacks permanently (no live
// rate fetch in the native renderer) — a documented simplification, not
// a bug; see the DCF Card Dashboard task's note.
// ind/kor/jpn/cn: corrected 2026-08-15 from each market's raw govt bond yield --
// Damodaran's convention is riskfree rate = govt bond rate minus that country's default
// spread (India Baa3/1.87%, Korea Aa2/0.42%, Japan A1/0.60%, China A1/0.60% -- Jan 2026),
// since erp already carries each country's country risk premium; using the raw yield on
// top double-counts it. jpn/cn's MARKET_TGROWTH also lowered in the same pass -- China's
// old value literally exceeded its new, lower rf (a fresh ceiling violation); Japan's
// didn't violate the ceiling but drifted out of the ~40-57% ratio band every other market
// here sits in. kor's TGROWTH unchanged -- already ~45% against the corrected rf.
// See scripts/lib/market.js in DCFAnalysis for the full reasoning (kept in sync here).
const FALLBACK_RF = { us: 0.045, aus: 0.048, ind: 0.049, kor: 0.039, jpn: 0.022, uk: 0.050, eu: 0.032, hk: 0.035, cn: 0.011 };
const MARKET_ERP  = { us: 0.055, aus: 0.060, ind: 0.075, kor: 0.075, jpn: 0.060, uk: 0.060, eu: 0.055, hk: 0.060, cn: 0.052 };
const MARKET_TGROWTH_DEFAULT = 2.5;
const MARKET_TGROWTH = { kor: 1.75, jpn: 1.2, uk: 2.0, eu: 1.8, hk: 2.0, cn: 0.6 };
const EUROZONE_SUFFIXES = ['.DE', '.PA', '.AS', '.MI', '.MC', '.BR', '.LS', '.VI', '.HE', '.IR'];

// Same suffix-priority order as app.js's prefillInputs() (ASX, then
// NSE/BSE, then KOSPI, then Nikkei, then UK, then eurozone, then Hong
// Kong, then China A-shares, then bare-suffix-less US, else 'other') —
// must stay in this exact order if ever touched again.
function detectMarket(ticker) {
  const t = (ticker || '').toUpperCase();
  if (isAsxTicker(ticker)) return 'aus';
  if (t.endsWith('.NS') || t.endsWith('.BO')) return 'ind';
  if (t.endsWith('.KS')) return 'kor';
  if (t.endsWith('.T')) return 'jpn';
  if (t.endsWith('.L')) return 'uk';
  if (EUROZONE_SUFFIXES.some(sfx => t.endsWith(sfx))) return 'eu';
  if (t.endsWith('.HK')) return 'hk';
  if (t.endsWith('.SS') || t.endsWith('.SZ')) return 'cn';
  return t.includes('.') ? 'other' : 'us';
}

// Bear/bull growth spread as a magnitude offset from a base value — used
// both when seeding fresh assumptions from live data (below) and when the
// native shell's assumptions bottom sheet rebuilds bear/bull after the
// user hand-edits Base. Single source of truth for both call sites, so a
// future formula change (see the 2026-08-11 bear/bull inversion fix in
// CLAUDE.md's Known Traps) can't drift between the two.
function growthOffsetSpread(baseGrowthPct) {
  const offset = Math.abs(baseGrowthPct) * 0.5;
  return {
    bear: +Math.max(-15, baseGrowthPct - offset).toFixed(1),
    bull: +Math.min(30, baseGrowthPct + offset).toFixed(1),
  };
}

// Discount-rate (WACC/cost-of-equity) spread — bear is 1pp higher, bull is
// 1pp lower (floored at 1%), same ±1pp band used when seeding from a live
// WACC/CAPM result.
function discountRateSpread(baseDiscountPct) {
  return {
    bear: +(baseDiscountPct + 1).toFixed(2),
    bull: +(Math.max(1, baseDiscountPct - 1)).toFixed(2),
  };
}

// Pure equivalent of app.js's prefillInputs() + its modelSeeds block.
// Returns everything needed to seed and run Bear/Base/Bull without
// touching any DOM element.
function deriveDcfAssumptions(data) {
  const isBankIns = isBankOrInsurance(data.sector, data.industry, data.ticker);
  const currentMarket = detectMarket(data.ticker);
  const rf  = FALLBACK_RF[currentMarket] ?? FALLBACK_RF.us;
  const erp = MARKET_ERP[currentMarket]  ?? MARKET_ERP.us;

  const rawBeta = (data.beta != null && isFinite(data.beta) && data.beta > 0) ? data.beta : 1.0;
  const betaFloor = getMarketBetaFloor(data.ticker);
  const effectiveBeta = Math.max(rawBeta, betaFloor);

  const waccResult = calculateWACC({
    marketCap: data.marketCap, totalDebt: data.totalDebt, beta: effectiveBeta,
    interestExpense: data.interestExpense, taxRate: data.taxRate, ebit: data.ebit,
    riskFreeRate: rf, erp,
  });
  const re = rf + effectiveBeta * erp;

  const baseGrowthPct = +(deriveBaseGrowth(data.revenueGrowth, data.earningsGrowth) * 100).toFixed(1);
  // Bear/bull spread as a magnitude offset from base, not a base*0.5/1.5
  // multiplier — the multiplier form inverts direction once base is
  // negative (2026-08-11 fix, see CLAUDE.md's Known Traps). |base| as the
  // offset keeps bear <= base <= bull regardless of sign.
  const dcfGrowthSpread = growthOffsetSpread(baseGrowthPct);
  const bearGrowthPct = dcfGrowthSpread.bear;
  const bullGrowthPct = dcfGrowthSpread.bull;

  const marketTGrowth = MARKET_TGROWTH[currentMarket] ?? MARKET_TGROWTH_DEFAULT;

  const dividend = data.trailingAnnualDividendRate
    ?? data.dividendRate
    ?? ((data.price != null && data.dividendYield != null) ? data.price * data.dividendYield : null);
  const divGrowthPct = +(deriveDividendGrowth(data.earningsGrowth, data.revenueGrowth) * 100).toFixed(1);
  const rePct = +(re * 100).toFixed(2);

  const modelSeeds = {
    dcf: {
      growth:   { bear: bearGrowthPct, base: baseGrowthPct, bull: bullGrowthPct },
      tgrowth:  { bear: marketTGrowth, base: marketTGrowth, bull: marketTGrowth },
      discount: waccResult
        ? { bear: +(waccResult.wacc * 100 + 1).toFixed(2), base: +(waccResult.wacc * 100).toFixed(2), bull: +(Math.max(1, waccResult.wacc * 100 - 1)).toFixed(2) }
        : { bear: 11, base: 10, bull: 9 },
    },
    ddm: {
      dividend,
      growth:   { bear: +(Math.max(0, divGrowthPct * 0.5)).toFixed(1), base: divGrowthPct, bull: +(Math.min(12, divGrowthPct * 1.5)).toFixed(1) },
      tgrowth:  { bear: marketTGrowth, base: marketTGrowth, bull: marketTGrowth },
      discount: { bear: +(rePct + 1).toFixed(2), base: rePct, bull: +(Math.max(1, rePct - 1)).toFixed(2) },
    },
  };

  const fcfInfo = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures, data.annualFcf);

  return {
    isBankIns, currentMarket, rf, erp, effectiveBeta, betaWasFloored: effectiveBeta > rawBeta,
    waccResult, modelSeeds, fcfInfo,
    valuationModel: isBankIns ? 'ddm' : 'dcf',
    useMultiStage: baseGrowthPct < 0, // same auto-enable rule as app.js's prefillInputs()
  };
}

// Pure equivalent of app.js's buildScenarios() — takes plain seed values
// (one of modelSeeds.dcf / modelSeeds.ddm above, or a user-edited copy of
// one on the website) instead of reading <input>/<select> elements.
// `options.fcfRaw`/`options.normFcf` replace resolveDcfFcfInputs()'s DOM
// read — pass `fcfInfo.value` / `null` when there's no manual override
// (the native shell's Card Dashboard has none in this pass).
function computeScenarios(data, valuationModel, seeds, options) {
  options = options || {};
  const years = options.years == null ? 5 : options.years;
  const useMultiStage = !!options.useMultiStage;
  const useMidYear = !!options.useMidYear;
  const configs = ['bear', 'base', 'bull'];

  if (valuationModel === 'ddm') {
    const dividend = seeds.dividend;
    return configs.map((key) => {
      const growthRate     = seeds.growth[key] / 100;
      const terminalGrowth = seeds.tgrowth[key] / 100;
      const costOfEquity   = seeds.discount[key] / 100;
      if (!(dividend > 0)) return { key, growthRate, terminalGrowth, wacc: costOfEquity, result: null, noDividend: true };
      const result = calculateDDM({ dividend, growthRate, terminalGrowth, costOfEquity, projectionYears: years, currentPrice: data.price, midYear: useMidYear });
      return { key, growthRate, terminalGrowth, wacc: costOfEquity, result };
    });
  }

  const fcfRaw = options.fcfRaw === undefined ? null : options.fcfRaw;
  const normFcf = options.normFcf === undefined ? null : options.normFcf;
  const resolvedShares = (data.dilutedSharesOutstanding != null && data.dilutedSharesOutstanding > 0)
    ? data.dilutedSharesOutstanding : data.sharesOutstanding;

  function runDcf(fcfValue, growthRate, terminalGrowth, wacc) {
    const common = {
      terminalGrowth, wacc, projectionYears: years,
      totalDebt: data.totalDebt ?? 0, totalCash: data.totalCash ?? 0,
      sharesOutstanding: resolvedShares, currentPrice: data.price,
      midYear: useMidYear,
    };
    return useMultiStage
      ? calculateFadingGrowthDCF({ ...common, fcf: fcfValue, initialGrowth: growthRate })
      : calculateDCF({ ...common, fcf: fcfValue, growthRate });
  }

  return configs.map((key) => {
    const growthRate     = seeds.growth[key] / 100;
    const terminalGrowth = seeds.tgrowth[key] / 100;
    const wacc            = seeds.discount[key] / 100;

    if (fcfRaw === null) {
      if (normFcf !== null) return { key, growthRate, terminalGrowth, wacc, result: runDcf(normFcf, growthRate, terminalGrowth, wacc), normalised: true };
      return { key, growthRate, terminalGrowth, wacc, result: null, fcfMissing: true };
    }
    if (fcfRaw <= 0) {
      if (normFcf !== null) return { key, growthRate, terminalGrowth, wacc, result: runDcf(normFcf, growthRate, terminalGrowth, wacc), normalised: true };
      return { key, growthRate, terminalGrowth, wacc, result: null, fcfNegative: true };
    }
    return { key, growthRate, terminalGrowth, wacc, result: runDcf(fcfRaw, growthRate, terminalGrowth, wacc) };
  });
}

if (typeof module !== 'undefined') module.exports = { detectMarket, deriveDcfAssumptions, computeScenarios, growthOffsetSpread, discountRateSpread };
if (typeof window !== 'undefined') { window.detectMarket = detectMarket; window.deriveDcfAssumptions = deriveDcfAssumptions; window.computeScenarios = computeScenarios; window.growthOffsetSpread = growthOffsetSpread; window.discountRateSpread = discountRateSpread; }
