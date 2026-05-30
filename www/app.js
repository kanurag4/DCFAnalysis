// app.js — ONLY file allowed to touch the DOM.
'use strict';

// Register Chart.js datalabels plugin (loaded via CDN after chart.js)
if (typeof ChartDataLabels !== 'undefined') Chart.register(ChartDataLabels);

const $ = id => document.getElementById(id);

const els = {
  input:        $('ticker-input'),
  asx:          $('asx-checkbox'),
  nse:          $('nse-checkbox'),
  analyseBtn:   $('analyse-btn'),
  recalcBtn:    $('recalc-btn'),
  recent:       $('recent'),
  status:       $('status'),
  layout:       $('dcf-layout'),
  summary:      $('summary'),
  finWarning:   $('financial-warning'),
  scenarios:    $('scenarios'),
  disclaimer:   $('disclaimer'),
  charts:       $('charts'),
  howDcf:       $('how-dcf'),
  acList:       $('autocomplete-list'),
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

const CURRENCY_SYMBOLS = { USD: '$', AUD: '$', INR: '₹', GBP: '£', GBp: 'p', EUR: '€', HKD: 'HK$', SGD: 'S$' };
const RECENT_KEY = 'dcf_recent_tickers';
const RECENT_MAX = 8;

let currentData   = null;
let liveRfRate    = 4.5;   // updated when US 10-yr Treasury is fetched
let liveAusRfRate = 4.8;   // updated when Australian 10-yr bond is fetched; 4.8% default
let liveIndRfRate = 7.0;   // updated when Indian 10-yr Govt bond is fetched; 7.0% default
let currentMarket = 'us';  // 'us' | 'aus' | 'ind' | 'other'
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

els.analyseBtn.addEventListener('click', onAnalyse);
els.recalcBtn.addEventListener('click', onRecalc);
if (els.ddmToggle) els.ddmToggle.addEventListener('click', onToggleModel);

// Re-derive discount rates live as RF or ERP values change (debounced).
let _waccTimer = null;
const debouncedRecompute = () => { clearTimeout(_waccTimer); _waccTimer = setTimeout(recomputeDiscount, 350); };
els.rfInput.addEventListener('input',  debouncedRecompute);
els.erpInput.addEventListener('input', debouncedRecompute);
// Reset RF + ERP to defaults, then recalculate.
if (els.rfErpResetBtn) els.rfErpResetBtn.addEventListener('click', resetRfErp);

els.input.addEventListener('keydown', e => {
  if (e.key === 'Enter') { hideAc(); onAnalyse(); }
  if (e.key === 'Escape') hideAc();
});

let _acTimer = null;
els.input.addEventListener('input', () => {
  clearTimeout(_acTimer);
  const q = els.input.value.trim();
  if (q.length < 3) { hideAc(); return; }
  _acTimer = setTimeout(() => fetchAc(q), 300);
});

document.addEventListener('click', e => {
  if (!els.input.contains(e.target) && !els.acList.contains(e.target)) hideAc();
});

els.asx.addEventListener('change', () => {
  if (els.asx.checked && els.nse) els.nse.checked = false;
  updateHint();
});
if (els.nse) {
  els.nse.addEventListener('change', () => {
    if (els.nse.checked) els.asx.checked = false;
    updateHint();
  });
}

// Only format normalised FCF (user-entered, must be positive).
// Do NOT format the main FCF input — it is pre-filled from Yahoo and may be negative;
// formatMoneyInput strips the minus sign.
if (els.fcfNorm) els.fcfNorm.addEventListener('input', () => formatMoneyInput(els.fcfNorm));

renderRecent();
bootstrapFromUrl();
fetchAndSetRiskFreeRate();
window.addEventListener('popstate', bootstrapFromUrl);

// ── URL bootstrap ─────────────────────────────────────────────────────────

function bootstrapFromUrl() {
  const params = new URLSearchParams(location.search);
  const t = params.get('ticker');
  if (!t || t.length > 20) return;
  els.input.value = t;
  els.asx.checked = params.get('asx') === '1';
  if (els.nse) els.nse.checked = params.get('nse') === '1';
  onAnalyse({ fromUrl: true });
}

// ── Analyse ───────────────────────────────────────────────────────────────

async function onAnalyse(opts = {}) {
  let ticker = els.input.value.trim();
  if (!ticker) { showError('Enter a ticker symbol.'); return; }

  const isASX = els.asx.checked;
  const isNSE = !!(els.nse?.checked);
  if (isNSE && !ticker.includes('.')) ticker += '.NS';

  if (!opts.fromUrl) {
    const p = new URLSearchParams({ ticker });
    if (isASX) p.set('asx', '1');
    if (isNSE) p.set('nse', '1');
    history.pushState({}, '', `?${p}`);
  }

  setLoading(true);
  hideResults();

  try {
    const data = await fetchDCFData(ticker, isASX, '', '', CONFIG.YAHOO_PROXY_URL);
    currentData = data;
    prefillInputs(data);
    renderAll(data);
    saveRecent(data.ticker, isASX);
    renderRecent();
  } catch (err) {
    showError(err.message || String(err));
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
  currentMarket = isAsx ? 'aus' : isInd ? 'ind' : (data.ticker && !data.ticker.includes('.') ? 'us' : 'other');

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

  modelSeeds = {
    dcf: {
      growth:   { bear: +(Math.max(-5, baseGrowthPct * 0.5)).toFixed(1), base: baseGrowthPct, bull: +(Math.min(30, baseGrowthPct * 1.5)).toFixed(1) },
      tgrowth:  { bear: 2.5, base: 2.5, bull: 2.5 },
      discount: waccResult
        ? { bear: +(waccResult.wacc * 100 + 1).toFixed(2), base: +(waccResult.wacc * 100).toFixed(2), bull: +(Math.max(1, waccResult.wacc * 100 - 1)).toFixed(2) }
        : { bear: 11, base: 10, bull: 9 },
    },
    ddm: {
      dividend,
      growth:   { bear: +(Math.max(0, divGrowthPct * 0.5)).toFixed(1), base: divGrowthPct, bull: +(Math.min(12, divGrowthPct * 1.5)).toFixed(1) },
      tgrowth:  { bear: 2.5, base: 2.5, bull: 2.5 },
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
        legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
        datalabels: {
          color: '#fff',
          font: { size: 10, weight: 'bold' },
          formatter: (value) => value >= labelMin ? fmtBar(value) : '',
          anchor: 'center',
          align: 'center',
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(51,65,85,0.5)' } },
        y: {
          stacked: true,
          ticks: { color: '#94a3b8', callback: v => fmtBar(v) },
          grid: { color: 'rgba(51,65,85,0.5)' },
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
    'rgba(245,158,11,0.8)',   // amber — current price
    'rgba(239,68,68,0.8)',    // red   — bear
    'rgba(56,189,248,0.8)',   // sky   — base
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
          ticks: { color: '#94a3b8', callback: v => `${sym}${v.toFixed(2)}` },
          grid: { color: 'rgba(51,65,85,0.5)' },
        },
        y: { ticks: { color: '#94a3b8' }, grid: { display: false } },
      },
    },
  });

  show(els.charts);
}

// ── Autocomplete ──────────────────────────────────────────────────────────

async function fetchAc(q) {
  try {
    const url = `${CONFIG.YAHOO_PROXY_URL.replace(/\/$/, '')}/search?q=${encodeURIComponent(q)}`;
    const resp = await fetch(url);
    if (!resp.ok) { hideAc(); return; }
    let results = await resp.json();
    if (!Array.isArray(results) || results.length === 0) { hideAc(); return; }
    if (els.nse?.checked) {
      results = [
        ...results.filter(r => r.symbol.endsWith('.NS')),
        ...results.filter(r => !r.symbol.endsWith('.NS')),
      ];
    }
    renderAc(results);
  } catch (_) { hideAc(); }
}

function renderAc(results) {
  els.acList.innerHTML = results.map(r =>
    `<div class="ac-item" data-symbol="${escapeHtml(r.symbol)}" role="option" tabindex="-1">
      <span class="ac-name">${escapeHtml(r.name)}</span>
      <span class="ac-meta">${escapeHtml(r.symbol)}${r.exchange ? ' · ' + escapeHtml(r.exchange) : ''}</span>
    </div>`
  ).join('');
  els.acList.hidden = false;
  els.acList.querySelectorAll('.ac-item').forEach(item => {
    item.addEventListener('click', () => {
      const sym = item.dataset.symbol;
      els.input.value = sym;
      if (els.nse) {
        const isIndian = sym.endsWith('.NS') || sym.endsWith('.BO');
        els.nse.checked = isIndian;
        if (isIndian) els.asx.checked = false;
        updateHint();
      }
      hideAc();
      onAnalyse();
    });
  });
}

function hideAc() { els.acList.hidden = true; els.acList.innerHTML = ''; }

// ── Recent tickers ────────────────────────────────────────────────────────

function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (_) { return []; }
}

function saveRecent(ticker, isASX) {
  const entry = { ticker: ticker.toUpperCase(), asx: !!isASX };
  const list = loadRecent().filter(e => !(e.ticker === entry.ticker && e.asx === entry.asx));
  list.unshift(entry);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
}

function renderRecent() {
  const list = loadRecent();
  if (list.length === 0) { els.recent.hidden = true; return; }
  els.recent.hidden = false;
  els.recent.innerHTML = '<span class="recent-label">Recent:</span>' +
    list.map(e => {
      // data.ticker is already the resolved symbol (e.g. BHP.AX), so only append
      // .AX for legacy/bare entries that don't already carry a market suffix.
      const display = (e.asx && !e.ticker.includes('.')) ? `${e.ticker}.AX` : e.ticker;
      const label = escapeHtml(display);
      return `<span class="chip" data-t="${escapeHtml(e.ticker)}" data-asx="${e.asx ? '1' : '0'}">
        <span class="label">${label}</span>
        <span class="x" data-remove="1">×</span>
      </span>`;
    }).join('');
  els.recent.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', ev => {
      const t   = chip.dataset.t;
      const asx = chip.dataset.asx === '1';
      if (ev.target.dataset.remove) {
        ev.stopPropagation();
        const list = loadRecent().filter(e => !(e.ticker === t && e.asx === asx));
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
        renderRecent();
        return;
      }
      els.input.value = t;
      els.asx.checked = asx;
      onAnalyse();
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────

function setLoading(on) {
  els.analyseBtn.disabled = on;
  els.analyseBtn.textContent = on ? 'Analysing…' : 'Analyse';
}

function showError(msg) {
  els.status.textContent = msg;
  els.status.className   = 'status error';
  els.status.hidden      = false;
}

function hideResults() {
  [els.summary, els.finWarning, els.breakevenCallout, els.scenarios, els.disclaimer, els.charts, els.howDcf, els.howDdm, els.layout]
    .forEach(el => { if (el) el.hidden = true; });
  els.status.hidden = true;
}

function show(...nodes) { nodes.forEach(n => { if (n) n.hidden = false; }); }

function updateHint() {
  const hint = $('market-hint');
  if (!hint) return;
  if (els.nse?.checked) {
    hint.innerHTML = 'Tick <strong>NSE / BSE</strong> for Indian tickers (e.g. RELIANCE, TCS). Adds <code>.NS</code> suffix automatically.';
  } else {
    hint.innerHTML = 'Tick <strong>ASX stock</strong> for Australian tickers (e.g. BHP, CBA). Leave unticked for US tickers (e.g. AAPL).';
  }
}

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
