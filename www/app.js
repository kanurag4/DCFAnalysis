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
};

const CURRENCY_SYMBOLS = { USD: '$', AUD: '$', INR: '₹', GBP: '£', EUR: '€', HKD: 'HK$', SGD: 'S$' };
const RECENT_KEY = 'dcf_recent_tickers';
const RECENT_MAX = 8;

let currentData   = null;
let breakdownChart = null;
let priceChart    = null;

// ── Init ──────────────────────────────────────────────────────────────────

els.yearsSlider.addEventListener('input', () => {
  els.yearsDisplay.textContent = els.yearsSlider.value;
});

els.analyseBtn.addEventListener('click', onAnalyse);
els.recalcBtn.addEventListener('click', onRecalc);

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
  // FCF — show raw Yahoo value; negative FCF is valid to display but can't be used in DCF
  const fcf = data.freeCashflow ?? (data.operatingCashflow ? data.operatingCashflow * 0.8 : null);
  const isFcfEstimated = data.freeCashflow === null && data.operatingCashflow !== null;
  const isFcfNegative  = fcf !== null && fcf <= 0;

  if (fcf !== null) {
    // Use raw display — don't run formatMoneyInput here as it strips the minus sign
    els.fcfInput.value = Math.round(fcf).toLocaleString('en-AU');
    if (isFcfNegative) {
      els.fcfSource.textContent = '⚠ negative';
      els.fcfSource.className = 'fcf-source estimated';
    } else {
      els.fcfSource.textContent = isFcfEstimated ? '⚠ estimated' : '✓ Yahoo';
      els.fcfSource.className = 'fcf-source ' + (isFcfEstimated ? 'estimated' : 'confirmed');
    }
  } else {
    els.fcfInput.value = '';
    els.fcfSource.textContent = '⚠ unavailable';
    els.fcfSource.className = 'fcf-source estimated';
  }

  // Financial sector: show normalised FCF field
  if (isFinancialSector(data.sector) && els.fcfNormRow) {
    els.fcfNormRow.hidden = false;
    if (els.fcfNorm) {
      if (isFcfNegative || fcf === null) {
        // Don't seed a negative default — leave empty so user must enter a positive estimate
        els.fcfNorm.value = '';
        els.fcfNorm.placeholder = 'Enter positive sustainable FCF';
      } else {
        els.fcfNorm.value = Math.round(fcf * 0.6).toLocaleString('en-AU');
        els.fcfNorm.placeholder = '';
      }
    }
  } else if (els.fcfNormRow) {
    els.fcfNormRow.hidden = true;
  }

  // Growth
  const baseGrowth    = deriveBaseGrowth(data.revenueGrowth, data.earningsGrowth);
  const baseGrowthPct = +(baseGrowth * 100).toFixed(1);
  els.growthBase.value = baseGrowthPct;
  els.growthBear.value = +(Math.max(-5, baseGrowthPct * 0.5)).toFixed(1);
  els.growthBull.value = +(Math.min(30, baseGrowthPct * 1.5)).toFixed(1);

  // WACC
  const rf  = parseFloat(els.rfInput.value)  / 100 || 0.045;
  const erp = parseFloat(els.erpInput.value) / 100 || 0.055;
  const waccResult = calculateWACC({
    marketCap:       data.marketCap,
    totalDebt:       data.totalDebt,
    beta:            data.beta,
    interestExpense: data.interestExpense,
    taxRate:         data.taxRate,
    riskFreeRate:    rf,
    erp,
  });

  if (waccResult) {
    const waccPct = +(waccResult.wacc * 100).toFixed(2);
    els.waccBase.value = waccPct;
    els.waccBear.value = +(waccPct + 1).toFixed(2);
    els.waccBull.value = +(Math.max(1, waccPct - 1)).toFixed(2);
    renderWACCBreakdown(waccResult);
  }
}

// ── Render all ────────────────────────────────────────────────────────────

function renderAll(data) {
  const sym = CURRENCY_SYMBOLS[data.currency] ?? '';
  renderSummary(data, sym);
  renderFinancialWarning(data, sym);
  const scenarios = buildScenarios(data);
  renderScenarios(scenarios, data, sym);
  renderCharts(scenarios, data.price, sym);
  show(els.layout, els.howDcf, els.disclaimer);
}

// ── Key metrics ───────────────────────────────────────────────────────────

function renderSummary(data, sym) {
  const fcf    = data.freeCashflow ?? (data.operatingCashflow ? data.operatingCashflow * 0.8 : null);
  const netDebt = (data.totalDebt ?? 0) - (data.totalCash ?? 0);
  const range  = `${fmt(data.fiftyTwoWeekLow, 2, '', sym)} – ${fmt(data.fiftyTwoWeekHigh, 2, '', sym)}`;
  const fcfNote = (data.freeCashflow === null && data.operatingCashflow !== null)
    ? ' <span class="stat-warn">⚠ est.</span>' : '';

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

function renderWACCBreakdown(w) {
  const pct = v => (v * 100).toFixed(2) + '%';
  els.waccContent.innerHTML = `
    <div class="wacc-row"><span>Cost of Equity (Re)</span><span class="wacc-val">${pct(w.re)}</span></div>
    <div class="wacc-row"><span class="wacc-src">RF ${pct(w.riskFreeRate)} + Beta × ERP ${pct(w.erp)}</span></div>
    <div class="wacc-row"><span>Cost of Debt (Rd) ${w.isRdEstimated ? '<span class="wacc-estimated">(estimated)</span>' : ''}</span><span class="wacc-val">${pct(w.rd)}</span></div>
    <div class="wacc-row"><span>Tax Rate (Tc) ${w.isTcEstimated ? '<span class="wacc-estimated">(estimated)</span>' : ''}</span><span class="wacc-val">${pct(w.tc)}</span></div>
    <div class="wacc-row"><span>Capital Structure</span><span class="wacc-val">E ${(w.eWeight * 100).toFixed(0)}% / D ${(w.dWeight * 100).toFixed(0)}%</span></div>
    <div class="wacc-divider"></div>
    <div class="wacc-row wacc-total"><span>Calculated WACC</span><span>${pct(w.wacc)}</span></div>
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
  const useNormFcf = isFinancialSector(data.sector) && els.fcfNorm && els.fcfNorm.value;
  const fcfRaw = useNormFcf ? parseMoney(els.fcfNorm) : parseMoney(els.fcfInput);
  const years  = parseInt(els.yearsSlider.value, 10);

  const configs = [
    { key: 'bear', growthEl: els.growthBear, tgEl: els.tgrowthBear, waccEl: els.waccBear },
    { key: 'base', growthEl: els.growthBase, tgEl: els.tgrowthBase, waccEl: els.waccBase },
    { key: 'bull', growthEl: els.growthBull, tgEl: els.tgrowthBull, waccEl: els.waccBull },
  ];

  return configs.map(({ key, growthEl, tgEl, waccEl }) => {
    const growthRate     = parseFloat(growthEl.value) / 100 || 0.05;
    const terminalGrowth = parseFloat(tgEl.value)    / 100 || 0.025;
    const wacc           = parseFloat(waccEl.value)  / 100 || 0.10;

    // Guard: negative or zero FCF cannot produce a DCF result
    if (fcfRaw <= 0) {
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
  const cards = scenarios.map(({ key, result, fcfNegative }) => {
    if (!result) {
      const msg = fcfNegative
        ? isFinancialSector(currentData?.sector)
          ? 'Reported FCF is negative. Enter a positive Normalised FCF in the inputs panel to run the DCF.'
          : 'FCF is negative — DCF requires positive free cash flow. This company may not be suitable for DCF valuation.'
        : 'WACC must exceed the terminal growth rate.';
      return `<div class="scenario-card ${key}">
        <div class="sc-header ${key}">${key.toUpperCase()}</div>
        <div class="sc-no-result">${msg}</div>
      </div>`;
    }
    if (result.intrinsicValue === null) {
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
      <span class="sc-mos ${mosClass}">${mosPct > 0 ? '+' : ''}${mosPct}% ${mosLabel}</span>
      <div class="sc-divider"></div>
      <div class="sc-cagr-title">Expected return to reach intrinsic value:</div>
      <div class="sc-cagr-row"><span>1 yr</span><span class="cagr-val">${fmtCagr(result.cagr1yr)}</span></div>
      <div class="sc-cagr-row highlight"><span>3 yrs</span><span class="cagr-val">${fmtCagr(result.cagr3yr)}</span></div>
      <div class="sc-cagr-row"><span>5 yrs</span><span class="cagr-val">${fmtCagr(result.cagr5yr)}</span></div>
      <div class="sc-caveat">Assumes market price converges to intrinsic value. No guarantee of timing.</div>
    </div>`;
  }).join('');

  els.scenarios.innerHTML = `<h3>Intrinsic Value Estimate (${parseInt(els.yearsSlider.value, 10)}-year forecast)</h3><div class="scenario-cards">${cards}</div>`;
  show(els.scenarios);
}

function fmtCagr(v) {
  if (v === null || v === undefined) return 'N/A';
  const pct = (v * 100).toFixed(1);
  return `<span class="${v >= 0 ? 'stat-up' : 'stat-down'}">${v >= 0 ? '+' : ''}${pct}% p.a.</span>`;
}

// ── Charts ────────────────────────────────────────────────────────────────

function renderCharts(scenarios, currentPrice, sym) {
  const labels = ['Bear', 'Base', 'Bull'];

  // Terminal value warning
  const maxTVPct = Math.max(...scenarios.filter(s => s.result).map(s => s.result.terminalValuePct));
  els.tvWarning.hidden = maxTVPct <= 70;

  // Chart 1: Stacked bar — PV FCFs (green) + PV Terminal Value (orange)
  // Green = near-term certain cash flows; Orange = uncertain terminal value
  const pvFcfTotals = scenarios.map(s => s.result ? +(s.result.pvFcfs.reduce((a, b) => a + b, 0) / 1e9).toFixed(2) : 0);
  const pvTerminals  = scenarios.map(s => s.result ? +(s.result.pvTerminal / 1e9).toFixed(2) : 0);

  if (breakdownChart) breakdownChart.destroy();
  breakdownChart = new Chart($('breakdown-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'PV of FCFs (forecast years)', data: pvFcfTotals, backgroundColor: 'rgba(34,197,94,0.75)',  borderRadius: 4 },
        { label: 'PV of Terminal Value',         data: pvTerminals,  backgroundColor: 'rgba(251,146,60,0.85)', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
        datalabels: {
          color: '#fff',
          font: { size: 10, weight: 'bold' },
          formatter: (value) => value >= 0.5 ? `${sym}${value.toFixed(1)}B` : '',
          anchor: 'center',
          align: 'center',
        },
      },
      scales: {
        x: { stacked: true, ticks: { color: '#94a3b8' }, grid: { color: 'rgba(51,65,85,0.5)' } },
        y: {
          stacked: true,
          ticks: { color: '#94a3b8', callback: v => `${sym}${v.toFixed(1)}B` },
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
      const label = e.asx ? `${escapeHtml(e.ticker)}.AX` : escapeHtml(e.ticker);
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
  [els.summary, els.finWarning, els.scenarios, els.disclaimer, els.charts, els.howDcf, els.layout]
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
  return parseInt(String(el.value).replace(/,/g, ''), 10) || 0;
}

// Fetch live US 10-year Treasury yield via ^TNX through the Worker.
// ^TNX price on Yahoo Finance = yield in % (e.g. 4.25 means 4.25%).
// Updates the RF rate input silently; keeps 4.5% default on any failure.
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
      const yieldPct = +raw.toFixed(2);
      els.rfInput.value = yieldPct;
      els.rfInput.title = `Live US 10-yr Treasury yield: ${yieldPct}%`;
      // Add a small live indicator next to the input label
      const rfLabel = els.rfInput.closest('label');
      if (rfLabel && !rfLabel.querySelector('.rf-live')) {
        const badge = document.createElement('span');
        badge.className = 'rf-live';
        badge.textContent = '● live';
        badge.title = 'Fetched from US 10-year Treasury yield (^TNX)';
        rfLabel.insertBefore(badge, els.rfInput);
      }
    }
  } catch (_) {
    // silently fall back to hardcoded 4.5%
  }
}
