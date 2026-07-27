// app.js — ONLY file allowed to touch the DOM.
'use strict';

// Register Chart.js datalabels plugin (loaded via CDN after chart.js)
if (typeof ChartDataLabels !== 'undefined') Chart.register(ChartDataLabels);

const $ = id => document.getElementById(id);

const els = {
  recalcBtn:    $('recalc-btn'),
  status:       $('status'),
  layout:       $('dcf-layout'),
  summary:      $('summary'),
  finWarning:   $('financial-warning'),
  scenarios:    $('scenarios'),
  disclaimer:   $('disclaimer'),
  charts:       $('charts'),
  howDcf:       $('how-dcf'),
  fcfInput:     $('fcf-input'),
  fcfSource:    $('fcf-source'),
  fcfNormRow:   $('fcf-normalized-row'),
  fcfNorm:      $('fcf-normalized'),
  yearsSlider:  $('years-slider'),
  yearsDisplay: $('years-display'),
  growthBear:   $('growth-bear'),
  growthBase:   $('growth-base'),
  growthBull:   $('growth-bull'),
  tgrowthBear:  $('tgrowth-bear'),
  tgrowthBase:  $('tgrowth-base'),
  tgrowthBull:  $('tgrowth-bull'),
  waccBear:     $('wacc-bear'),
  waccBase:     $('wacc-base'),
  waccBull:     $('wacc-bull'),
  rfInput:      $('rf-input'),
  erpInput:     $('erp-input'),
  waccContent:  $('wacc-breakdown-content'),
  tvWarning:    $('tv-warning'),
  howDdm:       $('how-ddm'),
  // DDM model controls
  modelToggleRow: $('model-toggle-row'),
  modelLabel:     $('model-label'),
  ddmToggle:      $('ddm-toggle'),
  fcfRow:         $('fcf-row'),
  dividendRow:    $('dividend-row'),
  dividendInput:  $('dividend-input'),
  growthLabel:    $('growth-label'),
  discountLabel:  $('discount-label'),
  discountTip:    $('discount-tip'),
  waccSummary:      $('wacc-summary'),
  breakdownTitle:   $('breakdown-title'),
  rfErpResetBtn:    $('rf-erp-reset-btn'),
  erpMarketNote:    $('erp-market-note'),
  // Revenue-normalisation (negative FCF / growth companies)
  targetMarginRow:  $('target-margin-row'),
  targetMarginInput:$('target-margin-input'),
  breakevenCallout: $('breakeven-callout'),
};

const CURRENCY_SYMBOLS = { USD: '$', AUD: '$', INR: '₹', KRW: '₩', JPY: '¥', GBP: '£', GBp: 'p', EUR: '€', HKD: 'HK$', SGD: 'S$' };

const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
if (isNative) {
  const badge = document.getElementById('kv-play-badge');
  if (badge) badge.hidden = true;

  // In the app, "Privacy Policy" must point at the Android app policy
  // (privacy.html), not the site-wide web policy (privacy-site.html).
  const privacyLink = document.getElementById('privacy-link');
  if (privacyLink) privacyLink.href = '/privacy.html';

  // Undervalued-list links are relative (asx-undervalued/, sp500-undervalued/, ...).
  // Their bundled copy is frozen at build time and Capacitor's local server mishandles
  // directory-style paths (redirects to the app's landing page). Open the live,
  // always-current kashvector.com page in the system browser instead.
  document.querySelectorAll('.screen-pill').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const url = new URL(link.getAttribute('href'), 'https://kashvector.com/dcf/').href;
      window.open(url, '_system');
    });
  });
}
if (!isNative) {
  // Fill each screen pill's "Updated d Mon" line from that screen's rankings.json.
  // Relative paths resolve both locally and at /dcf/; failures leave the line empty.
  document.querySelectorAll('.screen-pill-date[data-screen]').forEach((el) => {
    fetch(el.dataset.screen + '/rankings.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const label = data && formatUpdatedDate(data.asAt);
        if (label) el.textContent = label;
      })
      .catch(() => {});
  });
}

let currentData   = null;
let liveRfRate    = 4.5;   // updated when US 10-yr Treasury is fetched
let liveAusRfRate = 4.8;   // updated when Australian 10-yr bond is fetched; 4.8% default
let liveIndRfRate = 7.0;   // updated when Indian 10-yr Govt bond is fetched; 7.0% default
// Korea: no live 10-yr KTB yield ticker exists on Yahoo (see docs/japan-korea-market-research.md
// in the source repo) — these are fixed, never overwritten by a fetch.
const KOR_RF      = 4.3;
const KOR_ERP     = 7.5;
const KOR_TGROWTH = 1.75;  // vs the tool's 2.5% default — see the "About the Korea numbers" panel
// Japan: same situation as Korea — no live 10-yr JGB yield ticker exists on Yahoo
// (see docs/japan-korea-market-research.md in the source repo) — fixed, never fetched.
const JPN_RF      = 2.8;   // post-deflation JGB regime (~30-yr high)
const JPN_ERP     = 6.0;   // developed-market tier (~AUS level)
const JPN_TGROWTH = 1.5;   // vs the tool's 2.5% default — see the "About the Japan numbers" panel
let currentMarket = 'us';  // 'us' | 'aus' | 'ind' | 'kor' | 'jpn' | 'other'
let breakdownChart = null;
let priceChart    = null;

// Valuation model: 'dcf' (default) or 'ddm' (banks/insurance, or user-toggled).
let valuationModel = 'dcf';
// Per-model seed values computed at prefill, so toggling re-applies clean assumptions.
let modelSeeds = null;
// Whether the loaded stock pays a dividend (gates the optional DDM toggle).
let dividendAvailable = false;
// Cached discount-rate detail for the breakdown panel (re-rendered on model switch).
let lastWaccResult = null;
let lastCapm = null;

// ── Init ──────────────────────────────────────────────────────────────────

els.yearsSlider.addEventListener('input', () => {
  els.yearsDisplay.textContent = els.yearsSlider.value;
  if (currentData) renderAll(currentData);
});

els.recalcBtn.addEventListener('click', onRecalc);
if (els.ddmToggle) els.ddmToggle.addEventListener('click', onToggleModel);

// Re-derive discount rates live as RF or ERP values change (debounced).
let _waccTimer = null;
const debouncedRecompute = () => { clearTimeout(_waccTimer); _waccTimer = setTimeout(recomputeDiscount, 350); };
els.rfInput.addEventListener('input',  debouncedRecompute);
els.erpInput.addEventListener('input', debouncedRecompute);
// Reset RF + ERP to defaults, then recalculate.
if (els.rfErpResetBtn) els.rfErpResetBtn.addEventListener('click', resetRfErp);

// Only format normalised FCF (user-entered, must be positive).
// Do NOT format the main FCF input — it is pre-filled from Yahoo and may be negative;
// formatMoneyInput strips the minus sign.
if (els.fcfNorm) els.fcfNorm.addEventListener('input', () => formatMoneyInput(els.fcfNorm));

fetchAndSetRiskFreeRate();

// Ticker input, autocomplete, recents, market checkboxes, and ?ticker= URL
// read/write are all owned by the shared kv-ticker-input.js module.
const ctl = window.kvTickerInput.mount({
  tool: 'dcf',
  proxyUrl: CONFIG.YAHOO_PROXY_URL,
  minChars: 3,
  hints: {
    none: 'Tick <strong>ASX stock</strong> for Australian tickers (e.g. BHP, CBA). Leave unticked for US tickers (e.g. AAPL).',
    nse:  'Tick <strong>NSE / BSE</strong> for Indian tickers (e.g. RELIANCE, TCS). Adds <code>.NS</code> suffix automatically.',
  },
  onAnalyse: (req) => onAnalyse(req),
});

// ── Analyse ───────────────────────────────────────────────────────────────

async function onAnalyse(req) {
  if (!req.symbol) { showError('Enter a ticker symbol.'); return; }

  const isASX = req.isAsx;
  const isNSE = req.isNse;

  setLoading(true);
  hideResults();

  try {
    const data = await fetchDCFData(req.symbol, isASX, '', '', CONFIG.YAHOO_PROXY_URL);
    currentData = data;
    prefillInputs(data);
    renderAll(data);
    ctl.recordRecent(data.ticker, { isAsx: isASX, isNse: isNSE });
  } catch (err) {
    const rawInput = req.raw;
    const isBareSymbol = !rawInput.includes('.');
    const isConnectivityError = /couldn't reach|internet connection/i.test(err.message);
    let msg = err.message || String(err);
    if (isBareSymbol && !isConnectivityError) {
      if (isASX) msg = `"${rawInput.toUpperCase()}" was not found on the ASX. Untick "ASX stock" to search US or other stocks.`;
      else if (isNSE) msg = `"${rawInput.toUpperCase()}" was not found on NSE/BSE. Untick "NSE / BSE" to search US or other stocks.`;
    }
    showError(msg);
  } finally {
    setLoading(false);
  }
}

function onRecalc() {
  if (!currentData) return;
  renderAll(currentData);
}

// ── Pre-fill inputs ───────────────────────────────────────────────────────

function prefillInputs(data) {
  const isBankIns = isBankOrInsurance(data.sector, data.industry);
  valuationModel = isBankIns ? 'ddm' : 'dcf';

  // ── Market detection — ASX gets Australian RF rate + MRP ──────────────────
  const isAsx = isAsxTicker(data.ticker);
  const isInd = !isAsx && !!(data.ticker && (data.ticker.toUpperCase().endsWith('.NS') || data.ticker.toUpperCase().endsWith('.BO')));
  const isKor = !isAsx && !isInd && !!(data.ticker && data.ticker.toUpperCase().endsWith('.KS'));
  const isJpn = !isAsx && !isInd && !isKor && !!(data.ticker && data.ticker.toUpperCase().endsWith('.T'));
  currentMarket = isAsx ? 'aus' : isInd ? 'ind' : isKor ? 'kor' : isJpn ? 'jpn' : (data.ticker && !data.ticker.includes('.') ? 'us' : 'other');

  if (isAsx) {
    els.rfInput.value  = liveAusRfRate;
    els.erpInput.value = 6.0;
    setRfBadge('aus', liveAusRfRate);   // immediate — async fetch may refine the value
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Australian MRP (5.5–6.5%)'; els.erpMarketNote.hidden = false; }
    fetchAndSetAustralianRfRate();
  } else if (isInd) {
    els.rfInput.value  = liveIndRfRate;
    els.erpInput.value = 7.5;
    setRfBadge('ind', liveIndRfRate);   // immediate — async fetch may refine the value
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Indian MRP (7.0–9.0%)'; els.erpMarketNote.hidden = false; }
    fetchAndSetIndianRfRate();
  } else if (isKor) {
    els.rfInput.value  = KOR_RF;
    els.erpInput.value = KOR_ERP;
    setRfBadge('kor', KOR_RF);   // fixed estimate — no live source exists, see setRfBadge's 'kor' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Korean MRP incl. governance-risk premium (7.5%)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — Korea has no live rate source to fetch.
  } else if (isJpn) {
    els.rfInput.value  = JPN_RF;
    els.erpInput.value = JPN_ERP;
    setRfBadge('jpn', JPN_RF);   // fixed estimate — no live source exists, see setRfBadge's 'jpn' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Japanese MRP (5.5–6.5%)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — Japan has no live rate source to fetch.
  } else {
    els.rfInput.value  = liveRfRate;
    els.erpInput.value = 5.5;
    setRfBadge('us', liveRfRate);
    if (els.erpMarketNote) els.erpMarketNote.hidden = true;
  }

  // ── FCF (DCF) — reported FCF, else OCF − CapEx, else OCF × 0.8 proxy ──
  const fcfInfo = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures);
  const fcf = fcfInfo.value;
  const isFcfNegative = fcf !== null && fcf <= 0;

  if (fcf !== null) {
    // Use raw display — don't run formatMoneyInput here as it strips the minus sign
    els.fcfInput.value = Math.round(fcf).toLocaleString('en-AU');
    if (isFcfNegative) {
      els.fcfSource.textContent = '⚠ negative';
      els.fcfSource.className = 'fcf-source estimated';
    } else if (fcfInfo.method === 'reported') {
      els.fcfSource.textContent = '✓ Yahoo';
      els.fcfSource.className = 'fcf-source confirmed';
    } else if (fcfInfo.method === 'derived') {
      els.fcfSource.textContent = '≈ OCF − CapEx';
      els.fcfSource.className = 'fcf-source confirmed';
    } else {
      els.fcfSource.textContent = '⚠ rough est. (OCF × 0.8)';
      els.fcfSource.className = 'fcf-source estimated';
    }
  } else {
    els.fcfInput.value = '';
    els.fcfSource.textContent = '⚠ unavailable';
    els.fcfSource.className = 'fcf-source estimated';
  }

  // Strictly <0 (not <=0 like isFcfNegative above) to match the same
  // negative-FCF threshold Stock Evaluator and GGM use for this suggestion.
  renderGrowthSuggestion(data, fcf === null || fcf < 0);

  // Target FCF margin (revenue normalisation) — shown for negative/null FCF non-bank stocks
  const showTargetMargin = !isBankIns && (isFcfNegative || fcf === null) && data.totalRevenue > 0;
  if (els.targetMarginRow) {
    els.targetMarginRow.hidden = !showTargetMargin;
    if (showTargetMargin && els.targetMarginInput && !els.targetMarginInput.value) {
      const seedMargin = (data.profitMargins != null && data.profitMargins > 0)
        ? +(data.profitMargins * 100).toFixed(1)
        : 10;
      els.targetMarginInput.value = seedMargin;
    }
    if (!showTargetMargin && els.targetMarginInput) els.targetMarginInput.value = '';
  }

  // Normalised FCF row — only for OTHER financials (banks/insurance use DDM, not DCF)
  const showNorm = isFinancialSector(data.sector) && !isBankIns;
  if (els.fcfNormRow) {
    els.fcfNormRow.hidden = !showNorm;
    if (!showNorm && els.fcfNorm) els.fcfNorm.value = '';
    if (showNorm && els.fcfNorm) {
      if (isFcfNegative || fcf === null) {
        els.fcfNorm.value = '';
        els.fcfNorm.placeholder = 'Enter positive sustainable FCF';
      } else {
        els.fcfNorm.value = Math.round(fcf * 0.6).toLocaleString('en-AU');
        els.fcfNorm.placeholder = '';
      }
    }
  }

  // ── WACC (also gives the CAPM cost of equity Re used to seed DDM) ──
  const rf  = parseFloat(els.rfInput.value)  / 100 || 0.045;
  const erp = parseFloat(els.erpInput.value) / 100 || 0.055;
  const beta = (data.beta != null && isFinite(data.beta) && data.beta > 0) ? data.beta : 1.0;

  // Apply market-specific beta floor before seeding both WACC and DDM.
  // Yahoo betas for non-US stocks are measured vs S&P 500 and understate
  // domestic systematic risk. The floor affects the initial seed only —
  // the user can override all inputs directly.
  const betaFloor = getMarketBetaFloor(data.ticker);
  const effectiveBeta = Math.max(beta, betaFloor);
  const betaWasFloored = effectiveBeta > beta;

  const waccResult = calculateWACC({
    marketCap:       data.marketCap,
    totalDebt:       data.totalDebt,
    beta:            effectiveBeta,
    interestExpense: data.interestExpense,
    taxRate:         data.taxRate,
    riskFreeRate:    rf,
    erp,
  });

  const re = rf + effectiveBeta * erp;
  lastWaccResult = waccResult;
  lastCapm = { re, rf, erp, beta: effectiveBeta, rawBeta: beta, betaWasFloored };

  // ── DCF growth seeds ──
  const baseGrowthPct = +(deriveBaseGrowth(data.revenueGrowth, data.earningsGrowth) * 100).toFixed(1);

  // ── DDM seeds — D0 from trailing dividend → indicated rate → price × yield ──
  const dividend = data.trailingAnnualDividendRate
    ?? data.dividendRate
    ?? ((data.price != null && data.dividendYield != null) ? data.price * data.dividendYield : null);
  dividendAvailable = dividend != null && dividend > 0;
  const divGrowthPct = +(deriveDividendGrowth(data.earningsGrowth, data.revenueGrowth) * 100).toFixed(1);
  const rePct = +(re * 100).toFixed(2);

  // Terminal growth default is 2.5% for every market except Korea and Japan, which seed
  // lower (KOR_TGROWTH / JPN_TGROWTH) to reflect structurally lower long-run growth
  // expectations — see each market's "About the … numbers" panel for the reasoning.
  const marketTGrowth = currentMarket === 'kor' ? KOR_TGROWTH
                      : currentMarket === 'jpn' ? JPN_TGROWTH
                      : 2.5;

  modelSeeds = {
    dcf: {
      growth:   { bear: +(Math.max(-5, baseGrowthPct * 0.5)).toFixed(1), base: baseGrowthPct, bull: +(Math.min(30, baseGrowthPct * 1.5)).toFixed(1) },
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

  seedInputsForModel(valuationModel);
  applyModelUI();
}

// Write a model's seed values into the shared scenario inputs.
function seedInputsForModel(model) {
  if (!modelSeeds) return;
  const s = modelSeeds[model];
  els.growthBear.value  = s.growth.bear;
  els.growthBase.value  = s.growth.base;
  els.growthBull.value  = s.growth.bull;
  els.tgrowthBear.value = s.tgrowth.bear;
  els.tgrowthBase.value = s.tgrowth.base;
  els.tgrowthBull.value = s.tgrowth.bull;
  els.waccBear.value    = s.discount.bear;
  els.waccBase.value    = s.discount.base;
  els.waccBull.value    = s.discount.bull;
  if (model === 'ddm' && els.dividendInput) {
    els.dividendInput.value = s.dividend != null ? (+s.dividend).toFixed(2) : '';
    els.dividendInput.placeholder = s.dividend != null ? '' : 'Enter annual dividend / share';
  }
}

// Relabel shared inputs, swap input rows, and refresh the toggle + breakdown for the active model.
function applyModelUI() {
  const ddm = valuationModel === 'ddm';
  const isBankIns = currentData && isBankOrInsurance(currentData.sector, currentData.industry);

  if (els.fcfRow)      els.fcfRow.hidden = ddm;
  if (els.dividendRow) els.dividendRow.hidden = !ddm;

  if (els.growthLabel) els.growthLabel.textContent = ddm ? 'Div Growth %' : '5yr Growth %';
  const discountLabelText = $('discount-label-text');
  if (discountLabelText) discountLabelText.textContent = ddm ? 'Cost of Equity %' : 'WACC %';
  if (els.discountTip) els.discountTip.setAttribute('data-tip', ddm
    ? 'Cost of equity via CAPM (risk-free + beta × equity risk premium). Higher = lower valuation.'
    : 'Weighted Average Cost of Capital — your required rate of return. Higher WACC = lower valuation.');
  if (els.waccSummary)    els.waccSummary.textContent    = ddm ? 'How cost of equity is calculated' : 'How WACC is calculated';
  if (els.breakdownTitle) els.breakdownTitle.textContent = ddm ? 'DDM Value Breakdown' : 'DCF Value Breakdown';

  renderDiscountBreakdown();
  updateModelToggle(isBankIns);
}

function updateModelToggle(isBankIns) {
  if (!els.modelToggleRow) return;
  if (isBankIns) {
    // Banks/insurance are locked to DDM — show a static notice, no toggle.
    els.modelToggleRow.hidden = false;
    els.modelLabel.textContent = '🏦 Dividend Discount Model — DCF is unreliable for banks & insurers.';
    if (els.ddmToggle) els.ddmToggle.hidden = true;
    return;
  }
  if (!dividendAvailable) {
    els.modelToggleRow.hidden = true;
    return;
  }
  // Non-bank dividend payer — offer the optional DDM view.
  els.modelToggleRow.hidden = false;
  if (els.ddmToggle) els.ddmToggle.hidden = false;
  if (valuationModel === 'ddm') {
    els.modelLabel.textContent = 'Dividend Discount Model';
    els.ddmToggle.textContent  = '← Back to DCF';
  } else {
    els.modelLabel.textContent = 'Discounted Cash Flow';
    els.ddmToggle.textContent  = 'Value with DDM instead →';
  }
}

// Informational-only panel explaining the Korea-specific seeds (governance-risk
// premium, static RF, lower terminal growth) — same collapsible pattern as the
// AUS franking-credits note. Shared by both the DCF and DDM breakdown renderers.
function koreaInfoBlock() {
  if (currentMarket !== 'kor') return '';
  return `<details class="wacc-franking">
       <summary>About the Korea numbers</summary>
       <p><strong>Governance risk premium:</strong> Korea's equity risk premium is set to 7.5% (vs 5.5% for the US), partly reflecting a premium institutional investors typically add for Korean equities given historically weaker minority-shareholder protections.</p>
       <p><strong>Static risk-free rate:</strong> fixed at ~4.3% (Korea's approximate 10-year government bond yield). Not live — no accessible Yahoo Finance data source exists for this rate.</p>
       <p><strong>Lower terminal growth assumption:</strong> 1.75% vs the tool's 2.5% default, reflecting Korea's structurally lower long-run growth expectations.</p>
     </details>`;
}

// Informational-only panel explaining the Japan-specific seeds — same collapsible
// pattern as the Korea panel. Shared by both the DCF and DDM breakdown renderers.
function japanInfoBlock() {
  if (currentMarket !== 'jpn') return '';
  return `<details class="wacc-franking">
       <summary>About the Japan numbers</summary>
       <p><strong>Risk-free rate:</strong> fixed at ~2.8% (Japan's approximate 10-year government bond yield — a 30-year high as the BOJ exits deflation-era policy). Not live — no accessible Yahoo Finance data source exists for this rate.</p>
       <p><strong>Lower terminal growth assumption:</strong> 1.5% vs the tool's 2.5% default. The old deflation-era convention of 0–0.5% is outdated, but Japan's demographic-constrained long-run growth still warrants a below-default cap.</p>
       <p><strong>Beta floor:</strong> historically low Japanese betas (0.5–0.7) partly reflect deflation-era price stagnation and are likely understated as volatility returns — floored at 0.6.</p>
       <p><strong>Cross-shareholding caveat:</strong> some Japanese companies are unwinding historic cross-shareholdings (keiretsu stakes) under the revised Corporate Governance Code. Sale proceeds can inflate reported cash flow — treat unusually high FCF with care.</p>
     </details>`;
}

function renderDiscountBreakdown() {
  if (valuationModel === 'ddm') {
    if (!lastCapm) { els.waccContent.innerHTML = ''; return; }
    const pct = v => (v * 100).toFixed(2) + '%';
    const floorNote = lastCapm.betaWasFloored
      ? `<div class="wacc-row"><span class="wacc-src wacc-floor-note">⚠ Yahoo beta (${lastCapm.rawBeta.toFixed(2)}) is measured vs S&P 500 and understates risk for this market. Floored to ${lastCapm.beta.toFixed(2)} — adjust if you have a local-market beta.</span></div>`
      : '';
    const ddmAsxRange = currentMarket === 'aus' && currentData ? getAsxSectorWaccRange(currentData.sector, currentData.industry) : null;
    const ddmIndRange = currentMarket === 'ind' && currentData ? getIndianSectorWaccRange(currentData.sector, currentData.industry) : null;
    const ddmUsRange  = currentMarket === 'us'  && currentData ? getUsSectorWaccRange(currentData.sector, currentData.industry) : null;
    const ddmSectorRef = ddmAsxRange || ddmIndRange || ddmUsRange;
    const ddmMarketLabel = currentMarket === 'ind' ? 'India' : currentMarket === 'aus' ? 'ASX' : 'US';
    const sectorRowDdm = ddmSectorRef
      ? `<div class="wacc-divider"></div>
         <div class="wacc-row"><span class="wacc-src">${ddmMarketLabel} sector reference: <strong>${ddmSectorRef.range}</strong> (${ddmSectorRef.label})</span></div>`
      : '';
    els.waccContent.innerHTML = `
      <div class="wacc-row"><span>Cost of Equity (Re)</span><span class="wacc-val">${pct(lastCapm.re)}</span></div>
      <div class="wacc-row"><span class="wacc-src">CAPM: RF ${pct(lastCapm.rf)} + Beta ${lastCapm.beta.toFixed(2)} × ERP ${pct(lastCapm.erp)}</span></div>
      ${floorNote}
      <div class="wacc-divider"></div>
      <div class="wacc-row"><span class="wacc-src">No debt component — DDM discounts dividends at the cost of equity only.</span></div>
      ${sectorRowDdm}
      ${koreaInfoBlock()}
      ${japanInfoBlock()}
    `;
    return;
  }
  if (lastWaccResult) renderWACCBreakdown(lastWaccResult, lastCapm?.betaWasFloored, lastCapm?.rawBeta, lastCapm?.beta);
  else els.waccContent.innerHTML = '';
}

function onToggleModel() {
  valuationModel = valuationModel === 'ddm' ? 'dcf' : 'ddm';
  seedInputsForModel(valuationModel);
  applyModelUI();
  if (currentData) renderAll(currentData);
}

// ── Render all ────────────────────────────────────────────────────────────

function renderAll(data) {
  const sym = CURRENCY_SYMBOLS[data.currency] ?? '';
  renderSummary(data, sym);
  renderFinancialWarning(data, sym);
  const scenarios = buildScenarios(data);
  renderBreakeven(data, sym);
  renderScenarios(scenarios, data, sym);
  renderCharts(scenarios, data.price, sym);
  // Show the explainer matching the active model
  if (els.howDcf) els.howDcf.hidden = valuationModel === 'ddm';
  if (els.howDdm) els.howDdm.hidden = valuationModel !== 'ddm';
  show(els.layout, els.disclaimer);
}

// ── Cross-tool suggestion ────────────────────────────────────────────────

function renderGrowthSuggestion(data, isNegativeOrMissingFcf) {
  const container = document.getElementById('growthSuggestion');
  if (!container || isNative || !window.kvScenario) return;

  if (!isNegativeOrMissingFcf) { container.innerHTML = ''; return; }

  const fieldMap = { ticker: { param: 'ticker' } };
  const href = window.kvScenario.buildLink(
    fieldMap,
    () => data.ticker,
    location.origin + '/growth/'
  );

  window.kvScenario.renderSuggestion(container, {
    text: 'Negative free cash flow makes a standard DCF unreliable here — see this company valued with a model built for it',
    href,
    dismissKey: 'dcf:growth',
  });
}

// ── Key metrics ───────────────────────────────────────────────────────────

function renderSummary(data, sym) {
  const fcfInfo = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures);
  const fcf     = fcfInfo.value;
  const netDebt = (data.totalDebt ?? 0) - (data.totalCash ?? 0);
  const range  = `${fmt(data.fiftyTwoWeekLow, 2, '', sym)} – ${fmt(data.fiftyTwoWeekHigh, 2, '', sym)}`;
  const fcfNote = fcfInfo.method === 'proxy'   ? ' <span class="stat-warn">⚠ est.</span>'
                : fcfInfo.method === 'derived' ? ' <span style="font-size:0.7rem;color:var(--kv-muted)">OCF−CapEx</span>' : '';

  els.summary.innerHTML = `
    <h2>${escapeHtml(data.name)} <span class="symbol">(${escapeHtml(data.ticker)})</span></h2>
    ${data.sector ? `<div class="sector">${escapeHtml(data.sector)}${data.industry ? ' · ' + escapeHtml(data.industry) : ''}</div>` : ''}
    <div class="stats">
      <div class="stat"><div class="stat-label">Price</div><div class="stat-value">${fmt(data.price, 2, '', sym)}</div></div>
      <div class="stat"><div class="stat-label">Market Cap</div><div class="stat-value">${formatMarketCap(data.marketCap, sym)}</div></div>
      <div class="stat"><div class="stat-label">Free Cash Flow</div><div class="stat-value">${formatMarketCap(fcf, sym)}${fcfNote}</div></div>
      <div class="stat"><div class="stat-label">Operating CF</div><div class="stat-value">${formatMarketCap(data.operatingCashflow, sym)}</div></div>
      <div class="stat"><div class="stat-label">Revenue (TTM)</div><div class="stat-value">${formatMarketCap(data.totalRevenue, sym)}</div></div>
      <div class="stat"><div class="stat-label">Revenue Growth</div><div class="stat-value">${data.revenueGrowth !== null ? fmt(data.revenueGrowth * 100, 1, '%') : 'N/A'}</div></div>
      <div class="stat"><div class="stat-label">Net Debt</div><div class="stat-value ${netDebt > 0 ? 'stat-down' : 'stat-up'}">${formatMarketCap(netDebt, sym)}</div></div>
      <div class="stat"><div class="stat-label">Beta</div><div class="stat-value">${fmt(data.beta, 2)}</div></div>
      <div class="stat"><div class="stat-label">PE (TTM)</div><div class="stat-value">${fmt(data.trailingPE, 1, 'x')}</div></div>
      <div class="stat"><div class="stat-label">52-Week Range</div><div class="stat-value">${range}</div></div>
    </div>
  `;
  show(els.summary);
}

// ── WACC breakdown ────────────────────────────────────────────────────────

function renderWACCBreakdown(w, betaWasFloored, rawBeta, flooredBeta) {
  const pct = v => (v * 100).toFixed(2) + '%';
  const floorNote = betaWasFloored
    ? `<div class="wacc-row"><span class="wacc-src wacc-floor-note">⚠ Yahoo beta (${(rawBeta).toFixed(2)}) is measured vs S&P 500 and understates risk for this market. Floored to ${(flooredBeta).toFixed(2)} — adjust if you have a local-market beta. For emerging markets (India, etc.) consider raising WACC further to account for country risk.</span></div>`
    : '';
  const asxRange = currentMarket === 'aus' && currentData
    ? getAsxSectorWaccRange(currentData.sector, currentData.industry) : null;
  const indRange = currentMarket === 'ind' && currentData
    ? getIndianSectorWaccRange(currentData.sector, currentData.industry) : null;
  const usRange  = currentMarket === 'us' && currentData
    ? getUsSectorWaccRange(currentData.sector, currentData.industry) : null;
  const sectorRef = asxRange || indRange || usRange;
  const marketLabel = currentMarket === 'ind' ? 'India' : currentMarket === 'aus' ? 'ASX' : 'US';
  const sectorRow = sectorRef
    ? `<div class="wacc-divider"></div>
       <div class="wacc-row"><span class="wacc-src">${marketLabel} sector reference: <strong>${sectorRef.range}</strong> (${sectorRef.label})</span></div>`
    : '';
  const frankingBlock = currentMarket === 'aus' // franking credits are ASX-specific
    ? `<details class="wacc-franking">
         <summary>Franking credits (dividend imputation)</summary>
         <p>Australian companies pass corporate tax credits (franking credits) to shareholders. The ACCC values the benefit — Gamma (γ) — at <strong>0.4–0.5</strong>.</p>
         <p>The adjustment formula: <code>Tc_eff = Tc × (1 − γ)</code>. Applying γ = 0.45 would lower the effective tax rate from ${pct(w.tc)} to ~${pct(w.tc * (1 - 0.45))}, reducing WACC by roughly 0.3–0.8%.</p>
         <p>This tool uses standard post-tax WACC conservatively and does not apply the adjustment. For professional analysis with a domestic investor base, you may reduce WACC by that margin.</p>
       </details>`
    : '';

  els.waccContent.innerHTML = `
    <div class="wacc-row"><span>Cost of Equity (Re)</span><span class="wacc-val">${pct(w.re)}</span></div>
    <div class="wacc-row"><span class="wacc-src">RF ${pct(w.riskFreeRate)} + Beta ${flooredBeta != null ? flooredBeta.toFixed(2) : w.beta?.toFixed(2) ?? ''} × ERP ${pct(w.erp)}</span></div>
    ${floorNote}
    <div class="wacc-row"><span>Cost of Debt (Rd) ${w.isRdEstimated ? '<span class="wacc-estimated">(estimated)</span>' : ''}</span><span class="wacc-val">${pct(w.rd)}</span></div>
    <div class="wacc-row"><span>Tax Rate (Tc) ${w.isTcEstimated ? '<span class="wacc-estimated">(estimated)</span>' : ''}</span><span class="wacc-val">${pct(w.tc)}</span></div>
    <div class="wacc-row"><span>Capital Structure</span><span class="wacc-val">E ${(w.eWeight * 100).toFixed(0)}% / D ${(w.dWeight * 100).toFixed(0)}%</span></div>
    <div class="wacc-divider"></div>
    <div class="wacc-row wacc-total"><span>Calculated WACC</span><span>${pct(w.wacc)}</span></div>
    ${sectorRow}
    ${frankingBlock}
    ${koreaInfoBlock()}
    ${japanInfoBlock()}
  `;
}

// ── Financial sector warning ──────────────────────────────────────────────

function renderFinancialWarning(data, sym) {
  if (isRealEstateSector(data.sector)) {
    els.finWarning.innerHTML = `
      <h3>⚠️ REIT Detected</h3>
      <p>Real Estate Investment Trusts are better valued using Funds from Operations (FFO), not Free Cash Flow. DCF results for REITs should be treated with significant caution.</p>
    `;
    show(els.finWarning);
    return;
  }
  // Banks / insurers — DDM panel with banking metrics (replaces the DCF warning)
  if (isBankOrInsurance(data.sector, data.industry)) {
    const kind = /insurance/i.test(data.industry || '') || /insurance/i.test(data.sector || '') ? 'Insurance' : 'Bank';
    const reason = kind === 'Bank'
      ? 'deposits are a raw material rather than funding, so there is no clean free cash flow and WACC cannot be derived the usual way'
      : 'free cash flow is dominated by investment-portfolio and reserve movements, not owner earnings';
    const pe  = fmt(data.trailingPE, 1, 'x');
    const pb  = fmt(data.priceToBook, 2, 'x');
    const roe = data.returnOnEquity !== null ? fmt(data.returnOnEquity * 100, 1, '%') : 'N/A';
    const div = data.dividendYield  !== null ? fmt(data.dividendYield  * 100, 2, '%') : 'N/A';
    els.finWarning.innerHTML = `
      <h3>🏦 ${kind} — Dividend Discount Model</h3>
      <p>DCF is not used for ${kind.toLowerCase()} stocks: ${reason}. This valuation uses the <strong>Dividend Discount Model (DDM)</strong> instead${dividendAvailable ? '' : ' — but no dividend data is available, so no intrinsic value can be shown'}.</p>
      <p style="font-size:0.78rem;color:var(--kv-muted)">Key ${kind.toLowerCase()} valuation metrics:</p>
      <div class="alt-multiples">
        <div class="alt-multiple"><div class="am-label">P/B</div><div class="am-value">${pb}</div><div class="am-note">&lt;1 = below book</div></div>
        <div class="alt-multiple"><div class="am-label">ROE</div><div class="am-value">${roe}</div><div class="am-note">Return on equity</div></div>
        <div class="alt-multiple"><div class="am-label">P/E (TTM)</div><div class="am-value">${pe}</div><div class="am-note">Earnings multiple</div></div>
        <div class="alt-multiple"><div class="am-label">Div Yield</div><div class="am-value">${div}</div><div class="am-note">Income signal</div></div>
      </div>
    `;
    show(els.finWarning);
    return;
  }
  if (!isFinancialSector(data.sector)) {
    els.finWarning.hidden = true;
    return;
  }
  const pe  = fmt(data.trailingPE, 1, 'x');
  const pb  = fmt(data.priceToBook, 2, 'x');
  const roe = data.returnOnEquity !== null ? fmt(data.returnOnEquity * 100, 1, '%') : 'N/A';
  const div = data.dividendYield  !== null ? fmt(data.dividendYield  * 100, 2, '%') : 'N/A';
  els.finWarning.innerHTML = `
    <h3>⚠️ DCF Reliability Warning — Financial / Insurance Company</h3>
    <p>FCF for financial companies includes large investment flows and reserve movements that are not "owner earnings." Raw DCF often significantly overstates value. Use the Normalised FCF input on the left and treat results with caution.</p>
    <p style="font-size:0.78rem;color:var(--kv-muted)">Cross-check with market multiples (more reliable for this sector):</p>
    <div class="alt-multiples">
      <div class="alt-multiple"><div class="am-label">P/E (TTM)</div><div class="am-value">${pe}</div><div class="am-note">Earnings multiple</div></div>
      <div class="alt-multiple"><div class="am-label">P/B</div><div class="am-value">${pb}</div><div class="am-note">&lt;1 = below book</div></div>
      <div class="alt-multiple"><div class="am-label">ROE</div><div class="am-value">${roe}</div><div class="am-note">Return on equity</div></div>
      <div class="alt-multiple"><div class="am-label">Div Yield</div><div class="am-value">${div}</div><div class="am-note">Income signal</div></div>
    </div>
  `;
  show(els.finWarning);
}

// ── Build scenarios ───────────────────────────────────────────────────────

function buildScenarios(data) {
  const years   = parseInt(els.yearsSlider.value, 10);
  const configs = [
    { key: 'bear', growthEl: els.growthBear, tgEl: els.tgrowthBear, waccEl: els.waccBear },
    { key: 'base', growthEl: els.growthBase, tgEl: els.tgrowthBase, waccEl: els.waccBase },
    { key: 'bull', growthEl: els.growthBull, tgEl: els.tgrowthBull, waccEl: els.waccBull },
  ];

  // ── DDM (banks/insurance, or user-toggled) ──
  if (valuationModel === 'ddm') {
    const dividend = els.dividendInput
      ? parseFloat(String(els.dividendInput.value).replace(/,/g, ''))
      : NaN;
    return configs.map(({ key, growthEl, tgEl, waccEl }) => {
      const growthRate     = parseFloat(growthEl.value) / 100 || 0; // 0% is a valid DDM case (flat dividend perpetuity)
      const terminalGrowth = parseFloat(tgEl.value)    / 100 || 0.025;
      const costOfEquity   = parseFloat(waccEl.value)  / 100 || 0.09;
      if (!(dividend > 0)) {
        return { key, growthRate, terminalGrowth, wacc: costOfEquity, result: null, noDividend: true };
      }
      const result = calculateDDM({
        dividend, growthRate, terminalGrowth, costOfEquity,
        projectionYears: years, currentPrice: data.price,
      });
      return { key, growthRate, terminalGrowth, wacc: costOfEquity, result };
    });
  }

  // ── DCF ──
  // Normalised FCF only applies to non-bank/insurance financials.
  const useNormFcf = isFinancialSector(data.sector)
    && !isBankOrInsurance(data.sector, data.industry)
    && els.fcfNorm && els.fcfNorm.value;
  const fcfRaw = useNormFcf ? parseMoney(els.fcfNorm) : parseMoney(els.fcfInput);

  // Revenue-normalised FCF — only for stocks not already using the financial
  // normalised-FCF field (useNormFcf). Applying both would double-normalise.
  const targetMarginPct = els.targetMarginInput ? parseFloat(els.targetMarginInput.value) : NaN;
  const normFcf = (!useNormFcf && !isNaN(targetMarginPct) && targetMarginPct > 0 && data.totalRevenue > 0)
    ? data.totalRevenue * (targetMarginPct / 100)
    : null;

  return configs.map(({ key, growthEl, tgEl, waccEl }) => {
    const growthRate     = parseFloat(growthEl.value) / 100 || 0.05;
    const terminalGrowth = parseFloat(tgEl.value)    / 100 || 0.025;
    const wacc           = parseFloat(waccEl.value)  / 100 || 0.10;

    if (fcfRaw === null) {
      // Empty FCF input — offer revenue normalisation if available, else prompt user
      if (normFcf !== null) {
        const result = calculateDCF({
          fcf: normFcf, growthRate, terminalGrowth, wacc,
          projectionYears: years,
          totalDebt: data.totalDebt ?? 0, totalCash: data.totalCash ?? 0,
          sharesOutstanding: data.sharesOutstanding, currentPrice: data.price,
        });
        return { key, growthRate, terminalGrowth, wacc, result, normalised: true };
      }
      return { key, growthRate, terminalGrowth, wacc, result: null, fcfMissing: true };
    }
    if (fcfRaw <= 0) {
      // Negative FCF — offer revenue normalisation if available
      if (normFcf !== null) {
        const result = calculateDCF({
          fcf: normFcf, growthRate, terminalGrowth, wacc,
          projectionYears: years,
          totalDebt: data.totalDebt ?? 0, totalCash: data.totalCash ?? 0,
          sharesOutstanding: data.sharesOutstanding, currentPrice: data.price,
        });
        return { key, growthRate, terminalGrowth, wacc, result, normalised: true };
      }
      return { key, growthRate, terminalGrowth, wacc, result: null, fcfNegative: true };
    }

    const result = calculateDCF({
      fcf: fcfRaw, growthRate, terminalGrowth, wacc,
      projectionYears: years,
      totalDebt:         data.totalDebt ?? 0,
      totalCash:         data.totalCash ?? 0,
      sharesOutstanding: data.sharesOutstanding,
      currentPrice:      data.price,
    });

    return { key, growthRate, terminalGrowth, wacc, result };
  });
}

// ── Render scenario cards ─────────────────────────────────────────────────

function renderScenarios(scenarios, data, sym) {
  const cards = scenarios.map(({ key, result, fcfNegative, fcfMissing, noDividend, normalised }) => {
    if (!result) {
      let msg;
      if (fcfMissing) {
        msg = 'Enter a Free Cash Flow value in the inputs panel to run the DCF.';
      } else if (noDividend) {
        msg = 'No dividend data available — the Dividend Discount Model needs a dividend. Enter an annual dividend per share in the inputs panel, or use the metrics above.';
      } else if (fcfNegative) {
        msg = isFinancialSector(currentData?.sector)
          ? 'Reported FCF is negative. Enter a positive Normalised FCF in the inputs panel to run the DCF.'
          : 'FCF is negative — DCF requires positive free cash flow. This company may not be suitable for DCF valuation.';
      } else {
        msg = valuationModel === 'ddm'
          ? 'Cost of equity must exceed the terminal growth rate.'
          : 'WACC must exceed the terminal growth rate.';
      }
      return `<div class="scenario-card ${key}">
        <div class="sc-header ${key}">${key.toUpperCase()}</div>
        <div class="sc-no-result">${msg}</div>
      </div>`;
    }
    if (result.intrinsicValue === null) {
      if (result.negativeEquity) {
        return `<div class="scenario-card ${key}">
          <div class="sc-header ${key}">${key.toUpperCase()}</div>
          <div class="sc-no-result">Net debt (${formatMarketCap(result.netDebt, sym)}) exceeds DCF firm value (${formatMarketCap(result.firmValue, sym)}). Under these assumptions the equity is worth zero on a DCF basis. The stock is likely priced on future growth or asset value — try a higher growth rate or check the FCF is not inflated by one-off items.</div>
        </div>`;
      }
      return `<div class="scenario-card ${key}">
        <div class="sc-header ${key}">${key.toUpperCase()}</div>
        <div style="font-size:0.82rem;color:var(--kv-muted);margin-top:8px;">Shares outstanding unavailable — showing firm value only.</div>
        <div class="sc-intrinsic" style="margin-top:8px">${formatMarketCap(result.firmValue, sym)} <span style="font-size:0.72rem;color:var(--kv-muted)">firm value</span></div>
      </div>`;
    }

    const mos      = result.marginOfSafety;
    const mosClass = mos > 0.2 ? 'undervalued' : mos < -0.2 ? 'overvalued' : 'fair';
    const mosLabel = mos > 0.2 ? '✅ Undervalued' : mos < -0.2 ? '❌ Overvalued' : '⚠️ Fairly Valued';
    const mosPct   = (mos * 100).toFixed(1);

    return `<div class="scenario-card ${key}">
      <div class="sc-header ${key}">${key.toUpperCase()}</div>
      <div class="sc-intrinsic">${sym}${result.intrinsicValue.toFixed(2)}</div>
      <div class="sc-price">vs current ${sym}${(data.price ?? 0).toFixed(2)}</div>
      <span class="sc-mos ${mosClass}">${parseFloat(mosPct) > 0 ? '+' : ''}${mosPct}% ${mosLabel}</span>
      <div class="sc-divider"></div>
      <div class="sc-cagr-title">Expected return to reach intrinsic value:</div>
      <div class="sc-cagr-row"><span>1 yr</span><span class="cagr-val">${fmtCagr(result.cagr1yr)}</span></div>
      <div class="sc-cagr-row highlight"><span>3 yrs</span><span class="cagr-val">${fmtCagr(result.cagr3yr)}</span></div>
      <div class="sc-cagr-row"><span>5 yrs</span><span class="cagr-val">${fmtCagr(result.cagr5yr)}</span></div>
      <div class="sc-caveat">Assumes market price converges to intrinsic value. No guarantee of timing.${normalised ? ' FCF estimated as Revenue × target margin.' : ''}</div>
    </div>`;
  }).join('');

  const isNormalised = scenarios.some(s => s.normalised);
  const heading = isNormalised
    ? `Intrinsic Value Estimate (${parseInt(els.yearsSlider.value, 10)}-yr · Revenue-normalised)`
    : `Intrinsic Value Estimate (${parseInt(els.yearsSlider.value, 10)}-year forecast)`;
  els.scenarios.innerHTML = `<h3>${heading}</h3><div class="scenario-cards">${cards}</div>`;
  show(els.scenarios);
}

function fmtCagr(v) {
  if (v === null || v === undefined || !isFinite(v)) return 'N/A';
  const pct = (v * 100).toFixed(1);
  return `<span class="${v >= 0 ? 'stat-up' : 'stat-down'}">${v >= 0 ? '+' : ''}${pct}% p.a.</span>`;
}

// ── Charts ────────────────────────────────────────────────────────────────

// ── Revenue normalisation helpers ─────────────────────────────────────────

// Projects when FCF turns positive given linear margin improvement from
// currentMargin to targetMargin over `years`, at `revenueGrowth` per year.
function computeBreakeven(revenue, currentMargin, targetMargin, revenueGrowth, years) {
  if (!revenue || targetMargin <= 0 || !isFinite(currentMargin)) return null;
  if (currentMargin >= 0) return null; // already positive
  const deltaPerYear = (targetMargin - currentMargin) / years;
  if (deltaPerYear <= 0) return null;
  // Exact breakeven: currentMargin + t × deltaPerYear = 0
  const t = Math.ceil(-currentMargin / deltaPerYear);
  if (t > 15) return { year: null };
  const breakevenRevenue = revenue * Math.pow(1 + revenueGrowth, t);
  const breakevenFcf     = breakevenRevenue * (currentMargin + t * deltaPerYear);
  return { year: t, fcf: breakevenFcf };
}

function renderBreakeven(data, sym) {
  if (!els.breakevenCallout) return;
  const isBankIns = isBankOrInsurance(data.sector, data.industry);
  if (isBankIns || valuationModel === 'ddm' || !data.totalRevenue) {
    els.breakevenCallout.hidden = true; return;
  }
  const fcf = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures).value;
  if (fcf !== null && fcf > 0) { els.breakevenCallout.hidden = true; return; }

  const targetMarginPct = parseFloat(els.targetMarginInput?.value);
  if (isNaN(targetMarginPct) || targetMarginPct <= 0) { els.breakevenCallout.hidden = true; return; }

  const currentMargin    = fcf !== null ? fcf / data.totalRevenue : -0.1;
  const targetMargin     = targetMarginPct / 100;
  const revenueGrowth    = parseFloat(els.growthBase.value) / 100 || 0.1;
  const years            = parseInt(els.yearsSlider.value, 10);
  const normFcf          = data.totalRevenue * targetMargin;

  const bk = computeBreakeven(data.totalRevenue, currentMargin, targetMargin, revenueGrowth, years);
  const normLine = `Valuation uses <strong>${formatMarketCap(normFcf, sym)}</strong> normalised FCF (revenue × ${targetMarginPct}% target margin).`;

  let msg;
  if (!bk) {
    msg = `${normLine}`;
  } else if (bk.year === null) {
    msg = `At ${(revenueGrowth * 100).toFixed(1)}% revenue growth, FCF does not turn positive within the forecast period — consider a higher target margin. ${normLine}`;
  } else {
    msg = `At ${(revenueGrowth * 100).toFixed(1)}% revenue growth, FCF is estimated to turn positive in <strong>Year ${bk.year}</strong> (${formatMarketCap(bk.fcf, sym)}). ${normLine}`;
  }

  els.breakevenCallout.innerHTML = `<span class="be-icon">📈</span><span>${msg}</span>`;
  els.breakevenCallout.hidden = false;
}

function renderCharts(scenarios, currentPrice, sym) {
  const labels = ['Bear', 'Base', 'Bull'];

  // Terminal value warning
  const withResult = scenarios.filter(s => s.result);
  const maxTVPct = withResult.length ? Math.max(...withResult.map(s => s.result.terminalValuePct)) : 0;
  els.tvWarning.hidden = maxTVPct <= 70;

  const ddm = valuationModel === 'ddm';

  // Chart 1: Stacked bar — near-term PV (green) + PV Terminal Value (orange).
  // DCF works in $B of firm value; DDM works in per-share currency units.
  const stackNear = ddm
    ? scenarios.map(s => s.result ? +s.result.pvDividends.reduce((a, b) => a + b, 0).toFixed(2) : 0)
    : scenarios.map(s => s.result ? +(s.result.pvFcfs.reduce((a, b) => a + b, 0) / 1e9).toFixed(2) : 0);
  const stackTerminal = ddm
    ? scenarios.map(s => s.result ? +s.result.pvTerminal.toFixed(2) : 0)
    : scenarios.map(s => s.result ? +(s.result.pvTerminal / 1e9).toFixed(2) : 0);

  const fmtBar    = ddm ? (v => `${sym}${v.toFixed(2)}`) : (v => `${sym}${v.toFixed(1)}B`);
  const labelMin  = ddm ? 0.01 : 0.5;
  const nearLabel = ddm ? 'PV of Dividends (forecast years)' : 'PV of FCFs (forecast years)';

  if (breakdownChart) breakdownChart.destroy();
  breakdownChart = new Chart($('breakdown-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: nearLabel,               data: stackNear,     backgroundColor: 'rgba(34,197,94,0.75)',  borderRadius: 4 },
        { label: 'PV of Terminal Value',  data: stackTerminal, backgroundColor: 'rgba(251,146,60,0.85)', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#93a0bd', font: { size: 11 } } },
        datalabels: {
          color: '#fff',
          font: { size: 10, weight: 'bold' },
          formatter: (value) => value >= labelMin ? fmtBar(value) : '',
          anchor: 'center',
          align: 'center',
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: '#93a0bd' }, grid: { color: 'rgba(34,48,82,0.5)' } },
        y: {
          stacked: true,
          ticks: { color: '#93a0bd', callback: v => fmtBar(v) },
          grid: { color: 'rgba(34,48,82,0.5)' },
          afterFit: scale => { scale.width = 72; },
        },
      },
    },
  });

  // Chart 2: Horizontal bar — current price vs intrinsic values
  const intrinsics  = scenarios.map(s => s.result?.intrinsicValue ?? 0);
  const chartData   = [currentPrice ?? 0, ...intrinsics];
  const chartLabels = ['Current Price', 'Bear', 'Base', 'Bull'];
  const chartColors = [
    'rgba(147,160,189,0.8)',  // slate — current price
    'rgba(239,68,68,0.8)',    // red   — bear
    'rgba(245,166,35,0.8)',   // amber — base (matches --kv-accent)
    'rgba(34,197,94,0.8)',    // green — bull
  ];

  if (priceChart) priceChart.destroy();
  priceChart = new Chart($('price-chart'), {
    type: 'bar',
    data: {
      labels: chartLabels,
      datasets: [{ data: chartData, backgroundColor: chartColors, borderRadius: 4 }],
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          color: '#fff',
          font: { size: 11, weight: 'bold' },
          formatter: (value) => value > 0 ? `${sym}${value.toFixed(2)}` : '',
          anchor: 'end',
          align: 'start',
          offset: 4,
        },
      },
      scales: {
        x: {
          ticks: { color: '#93a0bd', callback: v => `${sym}${v.toFixed(2)}` },
          grid: { color: 'rgba(34,48,82,0.5)' },
        },
        y: { ticks: { color: '#93a0bd' }, grid: { display: false } },
      },
    },
  });

  show(els.charts);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function setLoading(on) { ctl.setLoading(on); }

function showError(msg) {
  els.status.textContent = msg;
  els.status.className   = 'status error';
  els.status.hidden      = false;
}

function hideResults() {
  [els.summary, els.finWarning, els.breakevenCallout, els.scenarios, els.disclaimer, els.charts, els.howDcf, els.howDdm, els.layout]
    .forEach(el => { if (el) el.hidden = true; });
  els.status.hidden = true;
  const growthSuggestion = document.getElementById('growthSuggestion');
  if (growthSuggestion) growthSuggestion.innerHTML = '';
}

function show(...nodes) { nodes.forEach(n => { if (n) n.hidden = false; }); }

function formatMoneyInput(el) {
  const pos = el.selectionStart;
  const oldVal = el.value;
  const digitsBeforeCursor = (oldVal.slice(0, pos).match(/\d/g) || []).length;
  const raw = oldVal.replace(/[^\d]/g, '');
  if (!raw) { el.value = ''; return; }
  const formatted = Number(raw).toLocaleString('en-AU');
  el.value = formatted;
  let digitCount = 0, newPos = formatted.length;
  for (let i = 0; i < formatted.length; i++) {
    if (/\d/.test(formatted[i])) digitCount++;
    if (digitCount === digitsBeforeCursor) { newPos = i + 1; break; }
  }
  el.setSelectionRange(newPos, newPos);
}

function parseMoney(el) {
  const s = String(el.value).trim();
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return isNaN(n) ? null : n;
}

// Fetch live US 10-year Treasury yield via ^TNX through the Worker.
// ^TNX price on Yahoo Finance = yield in % (e.g. 4.25 means 4.25%).
// Updates the RF rate input silently; keeps 4.5% default on any failure.
// Re-derive WACC (DCF) or cost of equity (DDM) from current RF + ERP inputs,
// update the scenario discount inputs and breakdown panel, then re-render.
// Called whenever the user edits the RF or ERP fields.
function resetRfErp() {
  if (currentMarket === 'aus') {
    els.rfInput.value  = liveAusRfRate;
    els.erpInput.value = 6.0;
  } else if (currentMarket === 'ind') {
    els.rfInput.value  = liveIndRfRate;
    els.erpInput.value = 7.5;
  } else if (currentMarket === 'kor') {
    els.rfInput.value  = KOR_RF;
    els.erpInput.value = KOR_ERP;
  } else if (currentMarket === 'jpn') {
    els.rfInput.value  = JPN_RF;
    els.erpInput.value = JPN_ERP;
  } else {
    els.rfInput.value  = liveRfRate;
    els.erpInput.value = 5.5;
  }
  recomputeDiscount();
  if (currentData) renderAll(currentData);
}

function recomputeDiscount() {
  if (!currentData) return;
  const rf  = parseFloat(els.rfInput.value)  / 100 || 0.045;
  const erp = parseFloat(els.erpInput.value) / 100 || 0.055;
  const rawBeta = (currentData.beta != null && isFinite(currentData.beta) && currentData.beta > 0)
    ? currentData.beta : 1.0;
  const effectiveBeta = Math.max(rawBeta, getMarketBetaFloor(currentData.ticker));
  const betaWasFloored = effectiveBeta > rawBeta;

  if (valuationModel === 'ddm') {
    const re    = rf + effectiveBeta * erp;
    const rePct = +(re * 100).toFixed(2);
    els.waccBase.value = rePct;
    els.waccBear.value = +(rePct + 1).toFixed(2);
    els.waccBull.value = +(Math.max(1, rePct - 1)).toFixed(2);
    lastCapm = { re, rf, erp, beta: effectiveBeta, rawBeta, betaWasFloored };
  } else {
    const waccResult = calculateWACC({
      marketCap:       currentData.marketCap,
      totalDebt:       currentData.totalDebt,
      beta:            effectiveBeta,
      interestExpense: currentData.interestExpense,
      taxRate:         currentData.taxRate,
      riskFreeRate:    rf,
      erp,
    });
    if (waccResult) {
      const waccPct = +(waccResult.wacc * 100).toFixed(2);
      els.waccBase.value = waccPct;
      els.waccBear.value = +(waccPct + 1).toFixed(2);
      els.waccBull.value = +(Math.max(1, waccPct - 1)).toFixed(2);
      lastWaccResult = waccResult;
      const re = rf + effectiveBeta * erp;
      lastCapm = { re, rf, erp, beta: effectiveBeta, rawBeta, betaWasFloored };
    } else {
      // No capital structure data — fall back to pure CAPM (Re only)
      const re    = rf + effectiveBeta * erp;
      const rePct = +(re * 100).toFixed(2);
      els.waccBase.value = rePct;
      els.waccBear.value = +(rePct + 1).toFixed(2);
      els.waccBull.value = +(Math.max(1, rePct - 1)).toFixed(2);
    }
  }
  renderDiscountBreakdown();
  // Do NOT call renderAll here — mid-edit keystrokes would flash partial valuations.
  // Full re-render happens via the Recalculate button or the ↺ reset button.
}

// Idempotently creates or updates the RF rate badge and note below the input.
function setRfBadge(market, rate) {
  const rfLabelText = $('rf-label-text');
  if (!rfLabelText) return;
  let badge = rfLabelText.querySelector('.rf-live');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'rf-live';
    rfLabelText.appendChild(badge);
  }
  const labels = {
    aus: { badge: '● live AUS', note: 'Australian 10-yr Govt Bond (^GSBG10.AX)', title: 'Australian 10-yr Govt Bond' },
    ind: { badge: '● live IND', note: 'Indian 10-yr Govt Bond',                  title: 'Indian 10-yr Govt Bond'    },
    kor: { badge: '○ fixed',    note: 'Fixed estimate — no live Korean bond-yield source available', title: 'Korea 10-yr Govt Bond yield (fixed estimate, not live)' },
    jpn: { badge: '○ fixed',    note: 'Fixed estimate — no live Japanese bond-yield source available', title: 'Japan 10-yr Govt Bond (JGB) yield (fixed estimate, not live)' },
    us:  { badge: '● live',     note: 'US 10-yr Treasury yield (^TNX)',           title: 'Live US 10-yr Treasury yield' },
  };
  const lbl = labels[market] || labels.us;
  badge.textContent = lbl.badge;
  badge.title = lbl.note;
  const rfLabel = els.rfInput.closest('label');
  if (rfLabel) {
    let note = rfLabel.querySelector('.rf-note');
    if (!note) {
      note = document.createElement('span');
      note.className = 'rf-note';
      rfLabel.appendChild(note);
    }
    note.textContent = lbl.note;
  }
  els.rfInput.title = `${lbl.title}: ${rate}%`;
}

async function fetchAndSetRiskFreeRate() {
  try {
    const url = `${CONFIG.YAHOO_PROXY_URL.replace(/\/$/, '')}/quoteSummary/${encodeURIComponent('^TNX')}`;
    const resp = await fetch(url);
    if (!resp.ok) return;
    const body = await resp.json();
    const result = body?.quoteSummary?.result?.[0];
    const raw =
      result?.summaryDetail?.previousClose?.raw ??
      result?.summaryDetail?.regularMarketPrice?.raw ??
      result?.financialData?.currentPrice?.raw;
    if (raw != null && isFinite(raw) && raw > 0 && raw < 20) {
      liveRfRate = +raw.toFixed(2);
      if (currentMarket === 'us' || currentMarket === 'other') {
        els.rfInput.value = liveRfRate;
        setRfBadge('us', liveRfRate);
      }
    }
  } catch (_) {
    // silently fall back to hardcoded 4.5%
  }
}

async function fetchAndSetAustralianRfRate() {
  let fetchSucceeded = false;
  try {
    const url = `${CONFIG.YAHOO_PROXY_URL.replace(/\/$/, '')}/quoteSummary/${encodeURIComponent('^GSBG10.AX')}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('not ok');
    const body = await resp.json();
    const result = body?.quoteSummary?.result?.[0];
    const raw =
      result?.summaryDetail?.previousClose?.raw ??
      result?.summaryDetail?.regularMarketPrice?.raw ??
      result?.financialData?.currentPrice?.raw;
    if (raw != null && isFinite(raw) && raw > 0 && raw < 20) {
      liveAusRfRate = +raw.toFixed(2);
      fetchSucceeded = true;
    }
  } catch (_) {
    // silently fall back to 4.8% default
  }
  if (currentMarket === 'aus') {
    els.rfInput.value = liveAusRfRate;
    setRfBadge('aus', liveAusRfRate);
    if (fetchSucceeded) recomputeDiscount();
  }
}

async function fetchAndSetIndianRfRate() {
  let fetchSucceeded = false;
  try {
    const url = `${CONFIG.YAHOO_PROXY_URL.replace(/\/$/, '')}/quoteSummary/${encodeURIComponent('^INBMKG10.NS')}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('not ok');
    const body = await resp.json();
    const result = body?.quoteSummary?.result?.[0];
    const raw =
      result?.summaryDetail?.previousClose?.raw ??
      result?.summaryDetail?.regularMarketPrice?.raw ??
      result?.financialData?.currentPrice?.raw;
    if (raw != null && isFinite(raw) && raw > 0 && raw < 20) {
      liveIndRfRate = +raw.toFixed(2);
      fetchSucceeded = true;
    }
  } catch (_) {
    // silently fall back to 7.0% default
  }
  if (currentMarket === 'ind') {
    els.rfInput.value = liveIndRfRate;
    setRfBadge('ind', liveIndRfRate);
    if (fetchSucceeded) recomputeDiscount();
  }
}

if (window.kvGuide) {
  window.kvGuide.mount({
    tool: 'dcf',
    buttonTarget: '#guideBtn',
    steps: [
      { target: '#ticker-input', text: 'Type any ticker — try your own, or AAPL if you\'re just exploring (add .AX for ASX, .NS/.BO for India, or tick the box below).' },
      { target: '#asx-checkbox', text: 'Tick this for Australian tickers without a suffix, like BHP or CBA.' },
      { target: '#go-btn', text: 'Click Analyse — I\'ll pick back up once your results are ready.' },
      { waitFor: '#dcf-layout:not([hidden])', text: 'Waiting for your analysis to finish...' },
      { target: '#fcf-input', text: 'Free Cash Flow is the engine of the whole valuation — the actual cash the business generates each year, before any accounting adjustments.' },
      { target: '#dividend-input', text: 'For banks and insurers, the model values the stock from its dividend per share instead of free cash flow, since FCF isn\'t a reliable owner-earnings measure for financial companies.' },
      { target: '[data-guide-row="growth"]', text: 'The 5-year growth rate for each scenario — how fast the business is assumed to grow its cash flow (or dividend) over the projection period.' },
      { target: '[data-guide-row="terminal"]', text: 'The growth rate assumed forever after the projection period. This one small number often drives 60-80% of the total valuation — small changes here move the answer the most.' },
      { target: '[data-guide-row="wacc"]', text: 'Your discount rate — WACC for a standard DCF, or Cost of Equity for the Dividend Discount Model. Once you\'ve adjusted any assumption above, click Recalculate to see the new result.' },
      { target: '#wacc-details', title: 'How the discount rate is calculated', text: 'See exactly how this rate was built from market data, and override the risk-free rate or equity risk premium if you disagree with the defaults.' },
      { target: '#ddm-toggle', text: 'This company qualifies for both models — click here to see it valued the other way.' },
      { target: '#summary', text: 'The headline result: the estimated intrinsic value per share, and how it compares to today\'s price.' },
      { target: '#scenarios', text: 'Bear, Base, and Bull cases side by side, each showing its own margin of safety — the gap between intrinsic value and the current price.' },
      { target: '#charts', text: 'A visual breakdown of the valuation, plus a warning if terminal value makes up more than 70% of the total (meaning the result is especially sensitive to the terminal growth assumption).' },
      { target: '#financial-warning', text: 'A note on why this company\'s free cash flow was normalised — raw FCF can be misleading for financial companies.' },
      { target: '#breakeven-callout', text: 'An estimate of when this company\'s free cash flow is expected to turn positive, based on your growth assumption.' },
    ],
    results: [
      { target: '#summary', text: 'The headline result: the estimated intrinsic value per share, and how it compares to today\'s price.' },
      { target: '#scenarios', text: 'Bear, Base, and Bull cases side by side, each showing its own margin of safety.' },
      { target: '#charts', text: 'A visual breakdown of the valuation and how it compares to the current price.' },
    ],
  });
}
