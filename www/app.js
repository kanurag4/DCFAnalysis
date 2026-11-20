// app.js — ONLY file allowed to touch the DOM.
'use strict';


const $ = id => document.getElementById(id);

const els = {
  status:       $('status'),
  // Interactive assumptions (P62): main sliders, beta choice, "Your numbers" chip.
  idcfEdited:     $('idcf-edited'),
  idcfReset:      $('idcf-reset'),
  idcfGrowth:     $('idcf-growth'),
  idcfGrowthOut:  $('idcf-growth-out'),
  idcfGrowthLabel:$('idcf-growth-label'),
  idcfImplied:    $('idcf-implied'),
  idcfTgrowth:    $('idcf-tgrowth'),
  idcfTgrowthOut: $('idcf-tgrowth-out'),
  idcfTgrowthLabel:$('idcf-tgrowth-label'),
  idcfDiscount:   $('idcf-discount'),
  idcfDiscountOut:$('idcf-discount-out'),
  idcfDiscountLabel:$('idcf-discount-label'),
  idcfRowTgrowth: $('idcf-row-tgrowth'),
  idcfRowDiscount:$('idcf-row-discount'),
  idcfBeta:       $('idcf-beta'),
  idcfMethod:     $('idcf-method'),
  idcfMethodStandard: $('idcf-method-standard'),
  idcfMethodFcff: $('idcf-method-fcff'),
  fcffNote:       $('fcff-note'),
  idcfBetaStock:  $('idcf-beta-stock'),
  idcfBetaIndustry:$('idcf-beta-industry'),
  idcfBetaHint:   $('idcf-beta-hint'),
  layout:       $('dcf-layout'),
  summary:      $('summary'),
  finWarning:   $('financial-warning'),
  scenarios:    $('scenarios'),
  disclaimer:   $('disclaimer'),
  idcfChart:    $('idcf-chart'),
  idcfChartSvg: $('idcf-chart-svg'),
  idcfTip:      $('idcf-tip'),
  idcfCross:    $('idcf-cross'),
  idcfPt:           $('idcf-pt'),
  idcfPtModes:      $('idcf-pt-modes'),
  idcfPtModeValue:  $('idcf-pt-mode-value'),
  idcfPtModeReturn: $('idcf-pt-mode-return'),
  idcfPtTarget:     $('idcf-pt-target'),
  idcfPtTargetLabel:$('idcf-pt-target-label'),
  idcfPtChips:      $('idcf-pt-chips'),
  idcfPtLead:       $('idcf-pt-lead'),
  idcfPtBoxes:      $('idcf-pt-boxes'),
  howDcf:       $('how-dcf'),
  fcfInput:     $('fcf-input'),
  fcfSource:    $('fcf-source'),
  fcfNormRow:   $('fcf-normalized-row'),
  fcfNorm:      $('fcf-normalized'),
  cyclicalNote: $('cyclical-note'),
  holdcoNote: $('holdco-note'),
  yearsSlider:  $('years-slider'),
  yearsDisplay: $('years-display'),
  midyearToggle: $('midyear-toggle'),
  multistageToggle: $('multistage-toggle'),
  multistageRow: $('multistage-row'),
  growthBear:   $('growth-bear'),
  growthBase:   $('growth-base'),
  growthBull:   $('growth-bull'),
  tgrowthBear:  $('tgrowth-bear'),
  tgrowthBase:  $('tgrowth-base'),
  tgrowthBull:  $('tgrowth-bull'),
  tgrowthWarning: $('tgrowth-warning'),
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
  bookvalueRow:   $('bookvalue-row'),
  bookvalueInput: $('bookvalue-input'),
  affoRow:        $('affo-row'),
  affoInput:      $('affo-input'),
  ebitdaRow:      $('ebitda-row'),
  ebitdaInput:    $('ebitda-input'),
  discountScenarioRow: $('discount-scenario-row'),
  tgrowthRow:     $('tgrowth-row'),
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

const CURRENCY_SYMBOLS = { USD: '$', AUD: '$', INR: '₹', KRW: '₩', JPY: '¥', GBP: '£', GBp: 'p', EUR: '€', HKD: 'HK$', SGD: 'S$', CNY: 'CN¥' };

// Glossary term annotation — degrades to a plain escaped label if
// kv-glossary.js failed to load, so a missing script never breaks rendering.
const T = (key, label) => window.kvGlossary ? kvGlossary.term(key, label) : escapeHtml(label);

const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const starBtn = document.getElementById('watchlist-star');
const shareBtn = document.getElementById('share-btn');
const shareBtnLabel = shareBtn ? shareBtn.querySelector('.share-btn-label') : null;

// Reflects the star's state for the given resolved ticker/market. Called
// after every successful analysis (native only) and once up front to hide
// it while nothing has been analysed yet. tool is hardcoded 'dcf' — the
// star is DCF-only by scope decision, not derived from any config.
function updateWatchlistStar(ticker, market) {
  if (!starBtn || !window.kvWatchlist) return;
  if (!ticker) { starBtn.hidden = true; return; }
  starBtn.hidden = false;
  const watchlisted = window.kvWatchlist.isWatchlisted(ticker, 'dcf');
  starBtn.textContent = watchlisted ? '★' : '☆';
  starBtn.classList.toggle('active', watchlisted);
  starBtn.onclick = () => {
    if (starBtn.classList.contains('active')) {
      window.kvWatchlist.remove(ticker, 'dcf').then(() => updateWatchlistStar(ticker, market));
    } else {
      window.kvWatchlist.add(ticker, market, 'dcf').then((result) => {
        if (!result.ok && result.reason === 'cap') {
          alert('Watchlist full (20/20) — remove one first.');
          return;
        }
        updateWatchlistStar(ticker, market);
      });
    }
  };
}

if (isNative) {
  // Icon-only in the app — the text label is nice-to-have on web but just
  // adds width to an already-compact native header row.
  if (shareBtn) {
    shareBtn.classList.add('icon-only');
    if (shareBtnLabel) shareBtnLabel.style.display = 'none';
  }

  // kv-nav.js unconditionally points .home-logo ("← All tools") at
  // /app/index.html for every native page. Read location.search here,
  // synchronously and before kv-ticker-input.js's mount() call below has a
  // chance to run — its bootstrapFromUrl() rewrites the URL via
  // history.pushState(buildUrlQuery(...)), which only ever carries
  // ticker/asx/nse and would silently drop a `from` param if read any
  // later than this. A ticker opened from the Watchlist screen
  // (app/watchlist.html's dcfHref()) carries ?from=watchlist so the user
  // lands back where they came from instead of the app home screen.
  if (new URLSearchParams(location.search).get('from') === 'watchlist') {
    const homeLogo = document.querySelector('.home-logo');
    if (homeLogo) homeLogo.setAttribute('href', '/app/watchlist.html');
  }

  // The "Individual stocks only" scope-limitation notice is useful web
  // context but reads as clutter at the top of a focused native tool.
  const notice = document.querySelector('.notice');
  if (notice) notice.style.display = 'none';

  // Using .style.display = 'none' rather than .hidden, deliberately: several
  // of these elements' own CSS class sets an explicit `display` value
  // (e.g. .screens-row { display: flex }, .affiliate-promo-grid { display:
  // grid }), which has the same specificity as the browser's default
  // `[hidden] { display: none }` rule — the author rule wins on source
  // order, so .hidden silently does nothing for elements shaped like this.
  // Found 2026-08-07 when the screens-row and affiliate grid stayed visible
  // despite being "hidden".
  const affiliateGrid = document.querySelector('.affiliate-promo-grid');
  if (affiliateGrid) affiliateGrid.style.display = 'none';
  const affiliateNote = document.querySelector('.affiliate-promo-note');
  if (affiliateNote) affiliateNote.style.display = 'none';

  // In the app, "Privacy Policy" must point at the Android app policy
  // (privacy.html), not the site-wide web policy (privacy-site.html).
  const privacyLink = document.getElementById('privacy-link');
  if (privacyLink) privacyLink.href = '/privacy.html';

  // The undervalued-screen pill row and "Browse selective stock DCF
  // valuations" link are cross-links to more web-style browsing content —
  // out of place in a focused native tool. The app's own "Most Undervalued"
  // tile (app/index.html -> app/undervalued.html) is the in-app equivalent.
  const screensRow = document.querySelector('.screens-row');
  if (screensRow) screensRow.style.display = 'none';
  const browseLink = document.querySelector('.screens-row + p');
  if (browseLink) browseLink.style.display = 'none';

  // ASX/NSE checkboxes are redundant once a ticker is picked from
  // autocomplete (kv-ticker-input.js auto-ticks the right one already) —
  // hidden here for a cleaner native UI. Left in the DOM (not removed) so
  // that auto-tick logic and resolveSymbol() keep working unchanged; typing
  // a bare ticker without picking a suggestion now falls back purely to an
  // explicit .AX/.NS/.BO suffix (see the reworded hint below and the
  // "Using another market?" details block).
  document.querySelectorAll('.asx-toggle').forEach((el) => { el.style.display = 'none'; });

  // The "Using another market?" details block's Australia bullet references
  // the now-hidden checkbox ("...or tick ASX box") — drop that parenthetical.
  const auLi = document.querySelector('details.market-hint li');
  if (auLi) auLi.innerHTML = '<strong>Australia</strong> — <code>.AX</code>';

  // The on-page About/FAQ section is long SEO/web content — out of place in
  // a focused native tool. Point to the consolidated app/about.html instead
  // via a small link in the header.
  const toolInfo = document.querySelector('.tool-info');
  if (toolInfo) toolInfo.style.display = 'none';
  const headerCenter = document.querySelector('.app-header-center');
  if (headerCenter) {
    const infoLink = document.createElement('a');
    infoLink.href = '/app/about.html';
    infoLink.textContent = 'ℹ️ About & FAQ';
    infoLink.style.cssText = 'display:inline-block;margin-top:8px;font-size:0.78rem;color:var(--kv-accent,var(--accent));text-decoration:none;';
    headerCenter.appendChild(infoLink);
  }
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
let sectorMarginLookup = {}; // updated by fetchSectorMarginLookup() below, best-effort
// US risk-free rate (percent): the 10-yr Treasury yield LESS the US default spread (Damodaran's dollar riskfree rate --
// MARKET_ERP.us already carries that default risk, docs/TODO.md P31). Starts as the table's value instead of its own
// hand-typed copy (was 4.8, a stale duplicate of FALLBACK_RF.us), and is replaced when the live rate arrives.
let liveRfRate    = +(FALLBACK_RF.us * 100).toFixed(2);
// Australia and India: the table's values. Both used to be refined by a live Yahoo fetch (^GSBG10.AX, ^INBMKG10.NS)
// that 404'd every time since at least 2026-09, so the table was always what displayed; the dead fetches were
// removed 2026-11-02 (each was a wasted Yahoo request per ASX/NSE valuation). See calc/assumptions.js's FALLBACK_RF.
const liveAusRfRate = +(FALLBACK_RF.aus * 100).toFixed(2);
const liveIndRfRate = +(FALLBACK_RF.ind * 100).toFixed(2);  // already spread-adjusted
// Korea/Japan/UK/Eurozone/Hong Kong/China: no live govt-bond yield ticker exists on
// Yahoo for any of these (see docs/japan-korea-market-research.md) -- rf/erp come
// straight from calc/assumptions.js's FALLBACK_RF/MARKET_ERP tables (already loaded on
// this page before app.js runs -- classic <script> tags share one top-level lexical
// scope, confirmed by the EUROZONE_SUFFIXES comment this replaced) via the
// marketRf()/marketErp() helpers below, instead of app.js keeping its own copy.
//
// This used to be 6 pairs of hand-typed constants (KOR_RF/KOR_ERP, JPN_RF/JPN_ERP, ...)
// that the 2026-09-04 rate refresh silently missed updating for two full days -- found
// 2026-09-06, see docs/risk-free-rates.md. A *_TGROWTH constant existed per market too
// (KOR_TGROWTH, JPN_TGROWTH, etc.) but was dead code: grep confirms none of them were
// ever read anywhere in this file -- the terminal growth actually used in every DCF
// calc always came from assumptions.js's own MARKET_TGROWTH via deriveDcfAssumptions().
// Removed rather than migrated.
//
// FALLBACK_RF/MARKET_ERP are decimal fractions (0.048 = 4.8%); this tool's rf/erp
// inputs are whole-percent fields (4.8), so these helpers convert at the boundary.
// `staticFallback`, when given, is used instead of the assumptions.js table entirely
// (used by the aus/ind/us branches below, which have their own live-Yahoo-refined
// value to prefer over the static table).
// The Worker's rate table as APPLIED (a copy of FALLBACK_RF/MARKET_ERP right after applyWorkerRates(), so a value
// the bounds rejected never reaches the boxes) -- see fetchWorkerRates() below. Web and native alike since the
// native-compare alignment (user decision 2026-10-21: the Worker is the rate source on every surface). Stays null
// until/unless that fetch succeeds -- the static table underneath is always a safe, offline-capable fallback.
let workerRates = null;
// One rate snapshot per page: once the first valuation has been seeded, a late /rates reply changes nothing (it
// would otherwise rewrite the RF/ERP boxes under the user, and value later tickers on different rates).
let ratesClosed = false;
// Same bounded wait as /evaluate/ and the native shells: a slow or dead Worker costs the first valuation at most this.
const RATES_WAIT_MS = 2500;
function boundedWait(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(resolve, ms))]);
}

// worker-watchlist's public GET /rates -- serves the rate table AND the shared live US 10Y (live.us). Declared up
// here, not beside its users below: fetchAndSetRiskFreeRate()/fetchWorkerRates() are CALLED at load (~line 296),
// before execution reaches those later declarations, so a const placed there would still be in its TDZ.
const WORKER_RATES_URL = 'https://kv-watchlist.anurag-kor.workers.dev/rates';

function marketRf(market, staticFallback) {
  const live = workerRates && workerRates.FALLBACK_RF && workerRates.FALLBACK_RF[market];
  if (live != null) return +(live * 100).toFixed(2);
  return staticFallback != null ? staticFallback : +(FALLBACK_RF[market] * 100).toFixed(2);
}
function marketErp(market, staticFallback) {
  const live = workerRates && workerRates.MARKET_ERP && workerRates.MARKET_ERP[market];
  if (live != null) return +(live * 100).toFixed(2);
  return staticFallback != null ? staticFallback : +(MARKET_ERP[market] * 100).toFixed(2);
}
// The risk-free rate / ERP (whole percent) the two input boxes show for a market. ONE helper shared by prefillInputs()
// and resetRfErp(): they used to keep separate hand-typed copies, and the aus/ind/us ERPs there (6.0 / 7.5 / 5.5)
// stayed on their pre-2026-09-22 values after Damodaran's July refresh while deriveDcfAssumptions() -- which seeds the
// first valuation from MARKET_ERP -- moved to 4.20 / 6.92 / 4.42. Touching a box (or Reset) then recomputed the discount
// rate from the stale ERP, silently cutting value 13-15% on US names (docs/TODO.md P36). An unrecognised market ('other')
// uses the US numbers, exactly as assumptions.js's `FALLBACK_RF[m] ?? FALLBACK_RF.us` does.
function rfErpForMarket(market) {
  switch (market) {
    case 'aus': return { rf: marketRf('aus', liveAusRfRate), erp: marketErp('aus') };
    case 'ind': return { rf: marketRf('ind', liveIndRfRate), erp: marketErp('ind') };
    case 'kor': case 'jpn': case 'uk': case 'eu': case 'fr': case 'hk': case 'cn': case 'br':
      return { rf: marketRf(market), erp: marketErp(market) };
    default: return { rf: marketRf('us', liveRfRate), erp: marketErp('us') };
  }
}
let currentMarket = 'us';  // 'us' | 'aus' | 'ind' | 'kor' | 'jpn' | 'uk' | 'eu' | 'fr' | 'hk' | 'cn' | 'br' | 'other'
let holdcoDiscount = null; // set in prefillInputs() from assumptions.holdcoDiscount, read by buildScenarios()
// Heavy capex spending (calc/heavyCapex.js): the check when the method applies, else null. Set in prefillInputs(),
// read by buildScenarios(); lastHeavyCapexValuation is the latest wrapped result, for the card.
let heavyCapexState = null;
let lastHeavyCapexValuation = null;

// Valuation model: 'dcf' (default) or 'ddm' (banks/insurance, or user-toggled).
let valuationModel = 'dcf';
// Per-model seed values computed at prefill, so toggling re-applies clean assumptions.
let modelSeeds = null;
// Whether the loaded stock pays a dividend (gates the optional DDM toggle).
let dividendAvailable = false;
// Cached discount-rate detail for the breakdown panel (re-rendered on model switch).
let lastWaccResult = null;
let lastCapm = null;
// Populated by renderScenarios() from the base-case scenario card — the
// data behind the Share button. null whenever there's no valid base-case
// verdict to share (e.g. WACC < terminal growth, missing FCF/dividend).
let shareInfo = null;

// ── Init ──────────────────────────────────────────────────────────────────

els.yearsSlider.addEventListener('input', () => {
  els.yearsDisplay.textContent = els.yearsSlider.value;
  onInputsEdited(false);
});
els.yearsSlider.addEventListener('change', () => onInputsEdited(true));

if (els.ddmToggle) els.ddmToggle.addEventListener('click', onToggleModel);
if (els.midyearToggle) els.midyearToggle.addEventListener('change', () => onInputsEdited(true));
if (els.multistageToggle) els.multistageToggle.addEventListener('change', () => onInputsEdited(true));
if (shareBtn) shareBtn.addEventListener('click', onShareClick);

// Main sliders: move the Base value, re-derive Bear/Bull, update live (debounced while dragging).
els.idcfGrowth.addEventListener('input',  () => onSlider(hasMultipleModel() ? 'multiple' : 'growth', els.idcfGrowth, false));
els.idcfGrowth.addEventListener('change', () => onSlider(hasMultipleModel() ? 'multiple' : 'growth', els.idcfGrowth, true));
els.idcfTgrowth.addEventListener('input',  () => onSlider('tgrowth', els.idcfTgrowth, false));
els.idcfTgrowth.addEventListener('change', () => onSlider('tgrowth', els.idcfTgrowth, true));
els.idcfDiscount.addEventListener('input',  () => onSlider('discount', els.idcfDiscount, false));
els.idcfDiscount.addEventListener('change', () => onSlider('discount', els.idcfDiscount, true));
els.idcfBetaStock.addEventListener('click', () => setBetaChoice('stock'));
els.idcfMethodStandard.addEventListener('click', () => setFcffMode(false));
els.idcfMethodFcff.addEventListener('click', () => setFcffMode(true));
els.idcfBetaIndustry.addEventListener('click', () => setBetaChoice('industry'));
els.idcfReset.addEventListener('click', onResetOurs);
els.idcfPtModeValue.addEventListener('click', () => onPtMode('value'));
els.idcfPtModeReturn.addEventListener('click', () => onPtMode('return'));
els.idcfPtTarget.addEventListener('input', onPtTargetInput);
els.idcfPtChips.addEventListener('click', onPtChip);
els.idcfChartSvg.addEventListener('pointermove', onChartPointer);
els.idcfChartSvg.addEventListener('pointerdown', onChartPointer);
els.idcfChartSvg.addEventListener('pointerleave', onChartLeave);
let _resizeTimer = null;
window.addEventListener('resize', () => { clearTimeout(_resizeTimer); _resizeTimer = setTimeout(() => { if (currentData && !els.layout.hidden) recompute(); }, 150); });
// The folded Bear/Base/Bull grid and the starting-figure boxes update live too (no Recalculate step).
['growthBear', 'growthBase', 'growthBull', 'tgrowthBear', 'tgrowthBase', 'tgrowthBull'].forEach(k => {
  els[k].addEventListener('input', () => onInputsEdited(false));
});
['waccBear', 'waccBase', 'waccBull'].forEach(k => {
  els[k].addEventListener('input', () => { if (pageState) pageState.beta = 'custom'; onInputsEdited(false); });
});
['fcfInput', 'fcfNorm', 'dividendInput', 'bookvalueInput', 'affoInput', 'ebitdaInput', 'targetMarginInput'].forEach(k => {
  if (els[k]) els[k].addEventListener('input', () => onInputsEdited(false));
});

// Re-derive discount rates live as RF or ERP values change (debounced), then revalue.
let _waccTimer = null;
const debouncedRecompute = () => {
  clearTimeout(_waccTimer);
  _waccTimer = setTimeout(() => { recomputeDiscount(); onInputsEdited(true); }, 350);
};
els.rfInput.addEventListener('input',  debouncedRecompute);
els.erpInput.addEventListener('input', debouncedRecompute);
// Reset RF + ERP to defaults, then recalculate.
if (els.rfErpResetBtn) els.rfErpResetBtn.addEventListener('click', resetRfErp);

// Only format normalised FCF (user-entered, must be positive).
// Do NOT format the main FCF input — it is pre-filled from Yahoo and may be negative;
// formatMoneyInput strips the minus sign.
if (els.fcfNorm) els.fcfNorm.addEventListener('input', () => formatMoneyInput(els.fcfNorm));

fetchAndSetRiskFreeRate();
fetchSectorMarginLookup();
const ratesReady = boundedWait(fetchWorkerRates(), RATES_WAIT_MS);

// Ticker input, autocomplete, recents, market checkboxes, and ?ticker= URL
// read/write are all owned by the shared kv-ticker-input.js module.
const ctl = window.kvTickerInput.mount({
  tool: 'dcf',
  proxyUrl: CONFIG.YAHOO_PROXY_URL,
  minChars: 3,
  hints: {
    none: isNative
      ? 'Add <code>.AX</code> for Australian tickers (e.g. BHP.AX) or <code>.NS</code> for Indian tickers (e.g. RELIANCE.NS). No suffix defaults to US (e.g. AAPL).'
      : 'Tick <strong>ASX stock</strong> for Australian tickers (e.g. BHP, CBA). Leave unticked for US tickers (e.g. AAPL).',
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
    const [data] = await Promise.all([fetchDCFData(req.symbol, isASX, '', '', CONFIG.YAHOO_PROXY_URL), ratesReady]);
    ratesClosed = true; // the first valuation is seeded from the tables as they are now
    currentData = data;
    prefillInputs(data);
    applyUrlStateOnce();
    recompute();
    ctl.recordRecent(data.ticker, { isAsx: isASX, isNse: isNSE });
    if (isNative) updateWatchlistStar(data.ticker, currentMarket);
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

// ── Interactive assumptions (P62) ─────────────────────────────────────────
// The existing inputs (the folded Bear/Base/Bull grid, years, toggles, starting figure) stay the one source the
// valuation reads (buildScenarios). pageState mirrors them; the sliders write into them through page-state.js
// (psSetBase re-derives Bear/Bull with today's spreads), and every change revalues at once.

let pageState = null;    // page-state.js State: what the inputs hold now
let ourState = null;     // the derived assumptions ("Reset to our numbers")
let betaInfo = null;     // { ib, industryEffBeta } when the stock/industry beta choice applies, else null
let lastAssumptions = null;
let _recomputeTimer = null;
// Shareable link: the page's own query at load (applied once, to the first lookup), and the params page-state.js owns.
const initialQuery = window.location.search || '';
let urlStateConsumed = false;
const PS_PARAM_NAMES = ['g', 't', 'w', 'y', 's', 'm', 'f', 'beta', 'gb', 'gu', 'tb', 'tu', 'wb', 'wu', 'model', 'rf', 'erp', 'fm'];
// Valuation method v2 (2026-11-21): the free-cash-flow method toggle. Default = "Operating cash flow" (today's method); "FCFF"
// re-derives with deriveDcfAssumptions(..., { fcffMethod: true }). Only /dcf/ offers it (/evaluate/ never does).
// A shared link carries fm=1.
let fcffMode = new URLSearchParams(initialQuery).get('fm') === '1';

function fcffApplies() {
  const a = lastAssumptions;
  if (!a || typeof fcffBase !== 'function' || a.isReit) return false;
  // Cash-flow models get FCFF; Excess Return (banks, insurers, utilities) gets ROE on start-of-year equity (Part 2).
  if (valuationModel === 'excess-return') return typeof roeStartOfPeriod === 'function';
  return !a.isBankIns && (valuationModel === 'dcf' || valuationModel === 'airline');
}

function setFcffMode(on) {
  if (!currentData || fcffMode === on) return;
  fcffMode = on;
  prefillInputs(currentData);
  scheduleRecompute(true);
}

function renderFcffToggle() {
  const show = fcffApplies();
  els.idcfMethod.hidden = !show;
  if (!show) return;
  els.idcfMethodStandard.setAttribute('aria-pressed', String(!fcffMode));
  els.idcfMethodFcff.setAttribute('aria-pressed', String(fcffMode));
}

function fcffMoney(v, sym) {
  if (v == null || !isFinite(v)) return '—';
  const a = Math.abs(v), sign = v < 0 ? '−' : '';
  return a >= 1e9 ? `${sign}${sym}${(a / 1e9).toFixed(2)}B` : `${sign}${sym}${(a / 1e6).toFixed(0)}M`;
}

// Excess Return under the toggle: return on equity on start-of-year equity (calc/roe.js).
function roeNoteText(a, data) {
  const r = a.roeInfo;
  const sym = CURRENCY_SYMBOLS[data.currency] ?? '';
  if (!r || !(r.value > 0)) return 'No return on equity: equity a year earlier was zero or negative, so the ratio is not meaningful and the Excess Return model cannot run.';
  const span = r.method === 'ttm' ? 'over the last 12 months' : 'in the latest year';
  return `Return on equity ${(r.value * 100).toFixed(1)}% = net income ${fcffMoney(r.netIncome, sym)} ${span} ÷ equity at the start of the year, a year earlier (${fcffMoney(r.startEquity, sym)}).`;
}

// The "numbers used" for the FCFF method, one line per term (spec docs/superpowers/specs/2026-11-20-fcff-damodaran-design.md).
function fcffNoteText(a, data) {
  const f = a.fcfInfo, t = f.terms || {};
  const sym = CURRENCY_SYMBOLS[data.currency] ?? '';
  const pct = v => (v == null ? '—' : (v * 100).toFixed(1) + '%');
  if (f.method === 'ocf-capex') return 'Free cash flow to the firm could not be built (operating income or depreciation is missing), so this uses operating cash flow − capex.';
  const lines = [];
  if (f.method === 'ocf-capex-avg') {
    lines.push(`Free cash flow to the firm came out at ${fcffMoney(t.fcffComputed, sym)}: reinvestment (including acquisitions averaged over 4 years) exceeds after-tax operating income this year. This established company is valued on its average reported free cash flow over the last 4 years instead: ${fcffMoney(f.value, sym)}.`);
  } else {
    lines.push(`Free cash flow to the firm ${fcffMoney(f.value, sym)} = operating income ${fcffMoney(t.operatingIncome, sym)} × (1 − tax ${pct(t.effectiveTax)}) + depreciation ${fcffMoney(t.depreciation, sym)} − capex ${fcffMoney(t.capexAvg, sym)} (4-yr average) − acquisitions ${fcffMoney(t.acquisitionsAvg, sym)} (4-yr average) − leases ${fcffMoney(t.leaseReinvestment, sym)} − working capital ${fcffMoney(t.workingCapital, sym)}.`);
    if (t.cashChargesAvg) lines.push(`Operating income is after one-off cash charges (restructuring, legal) averaged over 4 years: ${fcffMoney(t.cashChargesAvg, sym)}.`);
    if (t.leaseInterest) lines.push(`It includes the interest part of operating-lease rent (${fcffMoney(t.leaseInterest, sym)}), because leases count as debt.`);
    lines.push(`The final year is taxed at the marginal rate (${pct(t.marginalTax)}).`);
  }
  if (f.nonOperatingNet) lines.push(`Stakes in other companies and long-term securities, less minority interests, add ${fcffMoney(f.nonOperatingNet, sym)} to the equity value.`);
  if (f.crossCheck && f.crossCheck.flag) lines.push(`Note: this differs from operating cash flow − capex (${fcffMoney(f.crossCheck.ocfRoute, sym)}) by more than 30%.`);
  if (data.industry && /Auto Manufacturers|Farm & Heavy Construction Machinery/.test(data.industry)) lines.push('Includes a finance arm: its loans and borrowings distort working capital and debt (known limitation).');
  return lines.join(' ');
}

const IDCF_RANGES = { growth: [-10, 40, 0.1], roe: [0, 60, 0.1], multiple: [1, 40, 0.1], tgrowth: [0, 4, 0.1], discount: [4, 18, 0.05] };

function hasMultipleModel() { return valuationModel === 'reit' || valuationModel === 'airline'; }
function hasTgrowthModel() { return valuationModel === 'dcf' || valuationModel === 'ddm'; }

function readCells(prefix) {
  const n = el => { const v = parseFloat(el.value); return isFinite(v) ? v : null; };
  return { bear: n(els[prefix + 'Bear']), base: n(els[prefix + 'Base']), bull: n(els[prefix + 'Bull']) };
}

function startInputEl() {
  return { dcf: els.fcfInput, ddm: els.dividendInput, 'excess-return': els.bookvalueInput, reit: els.affoInput, airline: els.ebitdaInput }[valuationModel] || null;
}

function readStart() {
  const el = startInputEl();
  if (!el) return null;
  const v = parseFloat(String(el.value).replace(/,/g, ''));
  return isFinite(v) ? v : null;
}

// Same key order as psFromSeeds(), so psIsEdited's comparison is like for like.
function readStateFromInputs(beta) {
  const g = readCells('growth');
  return {
    model: valuationModel,
    years: parseInt(els.yearsSlider.value, 10),
    midYear: !!(els.midyearToggle && els.midyearToggle.checked),
    fade: !!(els.multistageToggle && els.multistageToggle.checked),
    beta: beta || 'stock',
    growth: hasMultipleModel() ? null : g,
    tgrowth: hasTgrowthModel() ? readCells('tgrowth') : null,
    discount: hasMultipleModel() ? null : readCells('wacc'),
    multiple: hasMultipleModel() ? g : null,
    start: readStart(),
  };
}

function writeStateToInputs(s) {
  const put = (prefix, v) => { if (!v) return; els[prefix + 'Bear'].value = v.bear; els[prefix + 'Base'].value = v.base; els[prefix + 'Bull'].value = v.bull; };
  put('growth', s.multiple || s.growth);
  put('tgrowth', s.tgrowth);
  put('wacc', s.discount);
  els.yearsSlider.value = s.years;
  els.yearsDisplay.textContent = String(s.years);
  if (els.midyearToggle) els.midyearToggle.checked = !!s.midYear;
  if (els.multistageToggle) els.multistageToggle.checked = !!s.fade;
}

// Called once per derive (new ticker, model toggle, reset): what the inputs now hold is "our numbers".
function initInteractive(data, assumptions) {
  lastAssumptions = assumptions;
  ourState = readStateFromInputs('stock');
  pageState = JSON.parse(JSON.stringify(ourState));
  betaInfo = computeBetaInfo(data, assumptions);
  syncSliders();
}

// The stock / industry beta choice: US tickers whose Yahoo industry maps to a Damodaran row, discounted models only.
function computeBetaInfo(data, a) {
  if (typeof industryBetaFor !== 'function' || detectMarket(data.ticker) !== 'us') return null;
  if (hasMultipleModel() || heavyCapexState) return null;
  const taxRate = a && a.fcffMethod && typeof marginalTaxFor === 'function' ? marginalTaxFor(a.currentMarket, data.ticker) : data.taxRate;
  const ib = industryBetaFor({ industry: data.industry, marketCap: data.marketCap, totalDebt: data.totalDebt, taxRate, financial: !!(a && a.isBankIns) });
  if (!ib) return null;
  return { ib, industryEffBeta: Math.max(ib.beta, getMarketBetaFloor(data.ticker)) };
}

// The beta a discount rate (percent) implies, on the RF / ERP boxes as they are now: through the WACC when this DCF
// company has capital-structure data, else plain CAPM (cost of equity models, or a DCF with no WACC possible).
// One helper for the beta hint and the pressure test.
function impliedBetaForDiscount(discountPct) {
  const rf = parseFloat(els.rfInput.value) / 100, erp = parseFloat(els.erpInput.value) / 100;
  const w = valuationModel === 'dcf' ? lastWaccResult : null;
  return impliedBeta({ discountPct, model: w ? 'dcf' : 'ddm', waccParts: ptWaccParts({ rf, erp, waccResult: w }) });
}

function stockEffectiveBeta() {
  const rawBeta = (currentData && currentData.beta != null && isFinite(currentData.beta) && currentData.beta > 0) ? currentData.beta : 1.0;
  return Math.max(rawBeta, getMarketBetaFloor(currentData ? currentData.ticker : ''));
}

function selectedBeta() {
  return (pageState && pageState.beta === 'industry' && betaInfo) ? betaInfo.industryEffBeta : stockEffectiveBeta();
}

function onSlider(field, el, immediate) {
  if (!pageState || !pageState[field]) return;
  const v = parseFloat(el.value);
  if (!isFinite(v)) return;
  pageState = psSetBase(pageState, field, v);
  writeStateToInputs(pageState);
  scheduleRecompute(immediate);
}

function onInputsEdited(immediate) {
  if (!currentData) return;
  pageState = readStateFromInputs(pageState ? pageState.beta : 'stock');
  scheduleRecompute(immediate);
}

function scheduleRecompute(immediate) {
  clearTimeout(_recomputeTimer);
  if (immediate) recompute();
  else _recomputeTimer = setTimeout(recompute, 80);
}

function recompute() {
  if (!currentData) return;
  renderAll(currentData);
  syncSliders();
  writeUrlState();
}

// The URL carries only what the visitor changed (psEncode), next to whatever else is there (?ticker=, market flags).
function writeUrlState() {
  if (!pageState || !ourState || !window.history || !window.history.replaceState) return;
  const keep = new URLSearchParams(window.location.search);
  PS_PARAM_NAMES.forEach(k => keep.delete(k));
  const rest = keep.toString();
  // Beyond page-state.js: the DDM view of a non-bank dividend payer, and edited RF / ERP boxes (they move the
  // discount rate without making it 'custom'), so whoever opens the link sees the same numbers.
  const extra = [];
  if (lastAssumptions && valuationModel !== lastAssumptions.valuationModel) extra.push('model=' + valuationModel);
  if (fcffMode && fcffApplies()) extra.push('fm=1');
  const d = rfErpForMarket(currentMarket);
  const rf = parseFloat(els.rfInput.value), erp = parseFloat(els.erpInput.value);
  if (isFinite(rf) && rf !== +d.rf) extra.push('rf=' + String(+rf.toFixed(4)));
  if (isFinite(erp) && erp !== +d.erp) extra.push('erp=' + String(+erp.toFixed(4)));
  const enc = [psEncode(pageState, ourState)].concat(extra).filter(Boolean).join('&');
  const q = rest + (enc ? (rest ? '&' : '') + enc : '');
  const url = window.location.pathname + (q ? '?' + q : '');
  if (url !== window.location.pathname + window.location.search) window.history.replaceState(null, '', url);
}

// A shared link's assumptions, applied once to the first lookup of the ticker it names. Invalid or inapplicable
// params are ignored field by field (psDecode), so a junk link shows today's numbers.
function applyUrlStateOnce() {
  if (urlStateConsumed) return;
  urlStateConsumed = true;
  const tk = (new URLSearchParams(initialQuery).get('ticker') || '').toUpperCase();
  // The link's ticker must be this ticker, with or without its market suffix (BHP for BHP.AX) -- never a prefix of
  // another symbol (A must not match AAPL).
  const full = String(currentData && currentData.ticker || '').toUpperCase();
  if (!tk || !currentData || (tk !== full && tk !== full.replace(/\.[A-Z]+$/, ''))) return;
  const q = new URLSearchParams(initialQuery);
  // The DDM view first (it re-seeds every input), then the RF / ERP boxes, then the page-state.js fields on top.
  if (q.get('model') === 'ddm' && valuationModel === 'dcf' && dividendAvailable && els.ddmToggle && !els.ddmToggle.hidden) {
    valuationModel = 'ddm';
    seedInputsForModel(valuationModel);
    applyModelUI();
    initInteractive(currentData, lastAssumptions);
  }
  const qNum = (k, lo, hi) => { const raw = q.get(k); const v = raw != null && /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN; return v >= lo && v <= hi ? v : null; };
  const rf = qNum('rf', 0, 15), erp = qNum('erp', 1, 15);
  if (rf != null) els.rfInput.value = rf;
  if (erp != null) els.erpInput.value = erp;
  if (rf != null || erp != null) recomputeDiscount();
  const s = psDecode(initialQuery, readStateFromInputs('stock'), { betaAllowed: !!betaInfo });
  if (!psIsEdited(s, ourState) && rf == null && erp == null) return;
  writeStateToInputs(s);
  if (s.start != null && s.start !== ourState.start) {
    const el = startInputEl();
    if (el) el.value = (valuationModel === 'dcf' || valuationModel === 'airline') ? Math.round(s.start).toLocaleString('en-AU') : (+s.start).toFixed(2);
  }
  pageState = readStateFromInputs(s.beta);
  if (s.beta === 'industry') { recomputeDiscount(); pageState = readStateFromInputs('industry'); }
}

// "Price implies X%": the growth (or ROE) that makes the Base value equal today's price, on the page's own inputs.
function priceImpliedGrowth() {
  if (!currentData || hasMultipleModel() || lastHeavyCapexValuation) return null;
  const inp = scenarioInputs(currentData);
  if (!inp.seeds.growth) return null;
  return solveLever({ data: currentData, model: inp.model, seeds: inp.seeds, options: inp.options, lever: 'growth', target: currentData.price, year: 0, pathCtx: valuePathCtx(currentData) });
}

function setBetaChoice(kind) {
  if (!pageState || !currentData) return;
  if (kind === 'industry' && !betaInfo) return;
  pageState.beta = kind;
  recomputeDiscount();
  pageState = readStateFromInputs(kind);
  scheduleRecompute(true);
}

function onResetOurs() {
  if (!currentData) return;
  prefillInputs(currentData);
  scheduleRecompute(true);
}

// The Base value the current inputs give with the Base discount rate set to `discountPct` (the beta buttons'
// previews), through the same buildScenarios() the page itself uses: the Base discount box is set for the call and
// put back straight after (never a heavy-capex ticker: the beta choice is hidden for those).
function baseValueAtDiscount(discountPct) {
  const keep = els.waccBase.value;
  els.waccBase.value = discountPct;
  let base = null;
  try { base = buildScenarios(currentData).find(s => s.key === 'base'); } finally { els.waccBase.value = keep; }
  return base && base.result && base.result.intrinsicValue != null ? base.result.intrinsicValue : null;
}

function idcfFormat(field, v) {
  if (v == null || !isFinite(v)) return '—';
  if (field === 'multiple') return (+v).toFixed(1) + '×';
  if (field === 'discount') return (+v).toFixed(2) + '%';
  return (+v).toFixed(1) + '%';
}

function setSlider(el, outEl, field, rangeKey, value) {
  const r = IDCF_RANGES[rangeKey];
  const v = isFinite(value) ? value : r[0];
  el.min = String(Math.min(r[0], Math.floor(v)));
  el.max = String(Math.max(r[1], Math.ceil(v)));
  el.step = String(r[2]);
  el.value = String(v);
  outEl.textContent = idcfFormat(field, value);
}

function syncSliders() {
  if (!pageState || !currentData) return;
  const sym = CURRENCY_SYMBOLS[currentData.currency] ?? '';
  const m = valuationModel;
  const multiple = hasMultipleModel();
  const growthField = multiple ? 'multiple' : 'growth';
  const growthLabel = m === 'reit' ? T('p-affo-multiple', 'P/AFFO multiple')
    : m === 'airline' ? T('ev-ebitda-multiple', 'EV/EBITDA multiple')
    : m === 'excess-return' ? T('roe', 'Return on equity')
    : m === 'ddm' ? T('growth-rate', 'Dividend growth a year') : T('growth-rate', 'Free cash flow growth a year');
  els.idcfGrowthLabel.innerHTML = growthLabel;
  const g = pageState[growthField];
  setSlider(els.idcfGrowth, els.idcfGrowthOut, growthField, multiple ? 'multiple' : (m === 'excess-return' ? 'roe' : 'growth'), g ? g.base : NaN);
  const implied = priceImpliedGrowth();
  const lo = parseFloat(els.idcfGrowth.min), hi = parseFloat(els.idcfGrowth.max);
  const showImplied = implied != null && implied >= lo && implied <= hi;
  els.idcfImplied.hidden = !showImplied;
  if (showImplied) {
    const at = ((implied - lo) / (hi - lo) * 100).toFixed(1);
    els.idcfImplied.innerHTML = `<i class="idcf-implied-tick" style="left:${at}%"></i><span>Price implies ${implied.toFixed(1)}%</span>`;
  }

  els.idcfRowTgrowth.hidden = !pageState.tgrowth;
  if (pageState.tgrowth) {
    els.idcfTgrowthLabel.innerHTML = T('terminal-growth', 'Long-run growth');
    setSlider(els.idcfTgrowth, els.idcfTgrowthOut, 'tgrowth', 'tgrowth', pageState.tgrowth.base);
  }

  els.idcfRowDiscount.hidden = !pageState.discount;
  if (pageState.discount) {
    els.idcfDiscountLabel.innerHTML = (m === 'ddm' || m === 'excess-return') ? T('cost-of-equity', 'Cost of equity') : T('wacc', 'Discount rate (WACC)');
    setSlider(els.idcfDiscount, els.idcfDiscountOut, 'discount', 'discount', pageState.discount.base);
  }

  // Beta choice: each button previews the Base value it gives.
  els.idcfBeta.hidden = !betaInfo;
  if (betaInfo) {
    const stockPct = discountForBeta(stockEffectiveBeta()).pct;
    const indPct = discountForBeta(betaInfo.industryEffBeta).pct;
    const vs = baseValueAtDiscount(stockPct);
    const vi = baseValueAtDiscount(indPct);
    const prev = v => (v == null ? '' : ` <span class="idcf-prev">· Base ${sym}${v.toFixed(2)}</span>`);
    els.idcfBetaStock.innerHTML = `<b>${stockEffectiveBeta().toFixed(2)}</b> This stock's beta${prev(vs)}`;
    els.idcfBetaIndustry.innerHTML = `<b>${betaInfo.industryEffBeta.toFixed(2)}</b> ${T('industry-beta', 'Industry beta')}${prev(vi)}`;
    els.idcfBetaStock.setAttribute('aria-pressed', String(pageState.beta === 'stock'));
    els.idcfBetaIndustry.setAttribute('aria-pressed', String(pageState.beta === 'industry'));
  }
  const showHint = pageState.beta === 'custom' && !!pageState.discount;
  els.idcfBetaHint.hidden = !showHint;
  if (showHint) {
    const b = impliedBetaForDiscount(pageState.discount.base);
    els.idcfBetaHint.textContent = b == null ? '' : `The beta your rate implies: ${b.toFixed(2)}`;
  }

  els.idcfEdited.hidden = !psIsEdited(pageState, ourState);
  renderFcffToggle();
}

// ── Pre-fill inputs ───────────────────────────────────────────────────────

function prefillInputs(data) {
  // Market detection, RF/ERP/beta-floor/WACC, DCF growth seeding, terminal
  // growth defaults, and DDM dividend seeding are now computed by the pure
  // deriveDcfAssumptions() (www/dcf/calc/assumptions.js) — the exact same
  // function the native shell's Card Dashboard calls, so the website and
  // the app can never silently compute different numbers for the same
  // ticker. This function's remaining job is purely writing those values
  // into the DOM (input fields, badges, notes).
  const assumptions = deriveDcfAssumptions(data, { sectorMarginLookup, fcffMethod: fcffMode });
  const isBankIns = assumptions.isBankIns;
  // A new ticker (or Reset) starts the pressure test from today's price again.
  ptMode = 'value';
  ptTarget = null;
  if (els.idcfPtTarget) els.idcfPtTarget.value = '';
  const isReitTicker = assumptions.isReit;
  valuationModel = assumptions.valuationModel;
  currentMarket = assumptions.currentMarket;
  holdcoDiscount = assumptions.holdcoDiscount;
  heavyCapexState = heavyCapexStateFor(data, assumptions);

  if (els.holdcoNote) {
    if (assumptions.isHoldco) {
      els.holdcoNote.hidden = false;
      els.holdcoNote.textContent = `🏛️ Holding company / conglomerate — a ${(holdcoDiscount * 100).toFixed(0)}% discount has been applied to the intrinsic values below, reflecting typically less efficient capital allocation and reduced transparency across diversified business lines (not a per-segment valuation — see the tool's methodology notes).`;
    } else {
      els.holdcoNote.hidden = true;
    }
  }

  // ── RF/ERP input boxes -- one shared helper with resetRfErp() (see rfErpForMarket). ──
  const seedRfErp = rfErpForMarket(currentMarket);
  els.rfInput.value  = seedRfErp.rf;
  els.erpInput.value = seedRfErp.erp;

  // ── Market detection — still drives the badge/notes and the
  // "About the X numbers" panel, both DOM-only concerns that stay here ──
  if (currentMarket === 'aus') {
    setRfBadge('aus', marketRf('aus', liveAusRfRate));   // fixed estimate — no live source, see setRfBadge's 'aus' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Australian MRP (Damodaran, July 2026)'; els.erpMarketNote.hidden = false; }
  } else if (currentMarket === 'ind') {
    setRfBadge('ind', marketRf('ind', liveIndRfRate));   // fixed estimate — no live source, see setRfBadge's 'ind' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Indian MRP incl. country risk (Damodaran, July 2026)'; els.erpMarketNote.hidden = false; }
  } else if (currentMarket === 'kor') {
    setRfBadge('kor', marketRf('kor'));   // fixed estimate — no live source exists, see setRfBadge's 'kor' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Korean MRP (Damodaran, July 2026)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — Korea has no live rate source to fetch.
  } else if (currentMarket === 'jpn') {
    setRfBadge('jpn', marketRf('jpn'));   // fixed estimate — no live source exists, see setRfBadge's 'jpn' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Japanese MRP (Damodaran, July 2026)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — Japan has no live rate source to fetch.
  } else if (currentMarket === 'uk') {
    setRfBadge('uk', marketRf('uk'));   // fixed estimate — no live source exists, see setRfBadge's 'uk' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'UK MRP (Damodaran, July 2026)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — UK has no live rate source to fetch.
  } else if (currentMarket === 'eu') {
    setRfBadge('eu', marketRf('eu'));   // fixed estimate — no live source exists, see setRfBadge's 'eu' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Eurozone MRP (Damodaran, July 2026)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — eurozone has no live rate source to fetch.
  } else if (currentMarket === 'fr') {
    setRfBadge('fr', marketRf('fr'));   // the eurozone (Bund) rate itself — see setRfBadge's 'fr' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'French MRP incl. country risk (Damodaran, July 2026)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — no live Bund source to fetch.
  } else if (currentMarket === 'hk') {
    setRfBadge('hk', marketRf('hk'));   // fixed estimate — no live source exists, see setRfBadge's 'hk' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Hong Kong MRP (Damodaran, July 2026)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — Hong Kong has no live rate source to fetch.
  } else if (currentMarket === 'cn') {
    setRfBadge('cn', marketRf('cn'));   // fixed estimate — no live source exists, see setRfBadge's 'cn' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'China A-share MRP (Damodaran country-risk estimate)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — China has no live rate source to fetch.
  } else if (currentMarket === 'br') {
    setRfBadge('br', marketRf('br'));   // fixed estimate — no live source exists, see setRfBadge's 'br' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Brazilian MRP incl. country risk (Damodaran, July 2026)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — Brazil has no live rate source to fetch.
  } else {
    setRfBadge('us', marketRf('us', liveRfRate));
    if (els.erpMarketNote) els.erpMarketNote.hidden = true;
  }

  // ── FCF (DCF) — DOM display only; the value itself came from assumptions.fcfInfo ──
  const fcfInfo = assumptions.fcfInfo;
  const fcf = fcfInfo.value;
  const isFcfNegative = fcf !== null && fcf <= 0;

  if (heavyCapexState) {
    // Heavy capex spending: the box holds the existing business's cash flow (operating cash flow minus the capex
    // needed to keep it running); the growth capex is valued on top in buildScenarios().
    els.fcfInput.value = heavyCapexPrefillFcf(heavyCapexState).toLocaleString('en-AU');
    els.fcfSource.textContent = '≈ existing business (OCF − maintenance capex)';
    els.fcfSource.className = 'fcf-source confirmed';
  } else if (fcf !== null) {
    // Use raw display — don't run formatMoneyInput here as it strips the minus sign
    els.fcfInput.value = Math.round(fcf).toLocaleString('en-AU');
    if (isFcfNegative) {
      els.fcfSource.textContent = '⚠ negative';
      els.fcfSource.className = 'fcf-source estimated';
    } else if (fcfInfo.method === 'fcff') {
      els.fcfSource.textContent = '≈ FCFF';
      els.fcfSource.className = 'fcf-source confirmed';
    } else if (fcfInfo.method === 'ocf-capex-avg') {
      els.fcfSource.textContent = '≈ 4-yr avg OCF − CapEx';
      els.fcfSource.className = 'fcf-source confirmed';
    } else if (fcfInfo.method === 'ocf-capex') {
      els.fcfSource.textContent = '≈ OCF − CapEx';
      els.fcfSource.className = 'fcf-source confirmed';
    } else if (fcfInfo.method === 'reported') {
      els.fcfSource.textContent = '✓ Yahoo';
      els.fcfSource.className = 'fcf-source confirmed';
    } else if (fcfInfo.method === 'derived') {
      els.fcfSource.textContent = '≈ OCF − CapEx';
      els.fcfSource.className = 'fcf-source confirmed';
    } else if (fcfInfo.method === 'annual') {
      els.fcfSource.textContent = '≈ latest annual (TTM n/a)';
      els.fcfSource.className = 'fcf-source confirmed';
    } else if (fcfInfo.method === 'normalized' && fcfInfo.source === 'sector') {
      els.fcfSource.textContent = `≈ ${fcfInfo.peerCount}-peer sector margin`;
      els.fcfSource.className = 'fcf-source confirmed';
    } else if (fcfInfo.method === 'normalized') {
      els.fcfSource.textContent = `≈ ${fcfInfo.yearsUsed}yr normalized margin`;
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

  if (els.fcffNote) {
    const showFcff = !!assumptions.fcffMethod && !heavyCapexState && (assumptions.valuationModel === 'dcf' || assumptions.valuationModel === 'airline');
    const showRoe = !showFcff && !!assumptions.roeMethod && assumptions.valuationModel === 'excess-return';
    els.fcffNote.hidden = !(showFcff || showRoe);
    els.fcffNote.textContent = showFcff ? fcffNoteText(assumptions, data) : (showRoe ? roeNoteText(assumptions, data) : '');
  }

  if (els.cyclicalNote && assumptions.fcffMethod) {
    els.cyclicalNote.hidden = true; // FCFF normalises the operating margin itself; the note above explains it
  } else if (els.cyclicalNote) {
    const revenueNote = fcfInfo.revenueCapped
      ? ` That margin is applied to the ${fcfInfo.yearsUsed}-year average revenue, not the latest year's, which sits above it — so a peak in commodity prices doesn't inflate the starting cash flow.`
      : '';
    const growthNote = ` Growth is seeded the same way — this company's reinvestment-and-return figure (retention × ROE) alone, skipping the usual cross-check against its own multi-year revenue/cash-flow trend, since that trend is just as easily distorted by wherever the commodity cycle sits.`;
    if (fcfInfo.method === 'normalized' && fcfInfo.source === 'sector') {
      els.cyclicalNote.hidden = false;
      els.cyclicalNote.textContent = `📊 Cyclical company — this company's own multi-year FCF margin came out negative (a capital-intensive stretch, not necessarily a bad sign), so this uses the industry average margin across ${fcfInfo.peerCount} peer companies (${(fcfInfo.marginUsed * 100).toFixed(1)}% of revenue) instead, per Damodaran's sector-average normalization technique.${revenueNote}${growthNote}`;
    } else if (fcfInfo.method === 'normalized') {
      els.cyclicalNote.hidden = false;
      els.cyclicalNote.textContent = `📊 Cyclical company — this uses the average FCF margin across the last ${fcfInfo.yearsUsed} years (${(fcfInfo.marginUsed * 100).toFixed(1)}% of revenue) instead of the latest year alone, to avoid over- or under-valuing at a cycle extreme. Yahoo's data only covers up to ${fcfInfo.yearsUsed} years, shorter than a full commodity cycle — a known limitation, not hidden here.${revenueNote}${growthNote}`;
    } else if (assumptions.isCyclical) {
      els.cyclicalNote.hidden = false;
      els.cyclicalNote.textContent = `📊 Cyclical company — not enough multi-year FCF history to normalize the base cash flow, so that stays the standard trailing figure.${growthNote}`;
    } else {
      els.cyclicalNote.hidden = true;
    }
  }

  // Strictly <0 (not <=0 like isFcfNegative above) to match the same
  // negative-FCF threshold Stock Evaluator and GGM use for this suggestion.
  // Gated to valuationModel === 'dcf': REIT/Airline/DDM/Excess-Return tickers
  // already got routed to a model built for their negative-or-distorted FCF
  // (e.g. airlines use EV/EBITDA precisely because trailing FCF is unreliable
  // for them) — pointing those to the Growth tool on top of that is wrong,
  // not a fallback (seen live on QAN.AX after the 2026-08-20 Airline model
  // shipped, since this check never looked at which model was selected).
  renderGrowthSuggestion(data, valuationModel === 'dcf' && !heavyCapexState && (fcf === null || fcf < 0));

  // Target FCF margin (revenue normalisation) — shown for negative/null FCF non-bank stocks
  const showTargetMargin = !isBankIns && !isReitTicker && !heavyCapexState && (isFcfNegative || fcf === null) && data.totalRevenue > 0;
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
  const rf = assumptions.rf;
  const erp = assumptions.erp;
  const beta = (data.beta != null && isFinite(data.beta) && data.beta > 0) ? data.beta : 1.0;
  const effectiveBeta = assumptions.effectiveBeta;
  const betaWasFloored = assumptions.betaWasFloored;
  const waccResult = assumptions.waccResult;

  const re = rf + effectiveBeta * erp;
  lastWaccResult = waccResult;
  lastCapm = { re, rf, erp, beta: effectiveBeta, rawBeta: beta, betaWasFloored };

  const dividend = assumptions.modelSeeds.ddm.dividend;
  dividendAvailable = dividend != null && dividend > 0;

  modelSeeds = assumptions.modelSeeds;

  // Growth fades toward the terminal rate instead of holding flat for every
  // forecast year then jumping straight to it — Damodaran's transition-phase
  // convention (see CLAUDE.md's DCF growth-rate notes). A flat negative rate
  // held for the whole horizon is the least realistic path for a shrinking
  // company, so default the toggle on whenever the base case itself is
  // negative; leave it off otherwise since a flat rate is a fine default for
  // a stable/growing company and users can still opt in manually either way.
  if (els.multistageToggle) els.multistageToggle.checked = assumptions.useMultiStage;

  seedInputsForModel(valuationModel);
  applyModelUI();
  initInteractive(data, assumptions);
}

// Write a model's seed values into the shared scenario inputs.
function seedInputsForModel(model) {
  if (!modelSeeds) return;
  // modelSeeds' key is camelCase (excessReturn) but model/valuationModel is
  // hyphenated ('excess-return') everywhere else in this file -- translate here
  // rather than renaming the seeds key, since 'dcf'/'ddm'/'reit' need no translation.
  const s = modelSeeds[model === 'excess-return' ? 'excessReturn' : model];

  // REIT has no discount rate, no terminal growth, and its "growth" row is
  // actually the P/AFFO multiple -- entirely different shape from every
  // other model, so it gets its own branch rather than falling through the
  // growth/tgrowth/discount writes below (which would throw on
  // s.discount.bear -- modelSeeds.reit has no discount key at all).
  if (model === 'reit') {
    els.growthBear.value = s.multiple.bear;
    els.growthBase.value = s.multiple.base;
    els.growthBull.value = s.multiple.bull;
    if (els.affoInput) {
      els.affoInput.value = s.affoPerShare != null ? (+s.affoPerShare).toFixed(2) : '';
      els.affoInput.placeholder = s.affoPerShare != null ? '' : 'Enter AFFO / share';
    }
    return;
  }

  // Airline model reuses growthBear/Base/Bull for the multiple (relabeled
  // "EV/EBITDA Multiple" in applyModelUI(), same trick REIT uses for
  // "P/AFFO Multiple") and needs its own EBITDA input, same shape as REIT's
  // affoInput.
  if (model === 'airline') {
    els.growthBear.value = s.multiple.bear;
    els.growthBase.value = s.multiple.base;
    els.growthBull.value = s.multiple.bull;
    if (els.ebitdaInput) {
      els.ebitdaInput.value = s.ebitda != null ? Math.round(s.ebitda) : '';
      els.ebitdaInput.placeholder = s.ebitda != null ? '' : 'Enter EBITDA';
    }
    return;
  }

  els.growthBear.value  = s.growth.bear;
  els.growthBase.value  = s.growth.base;
  els.growthBull.value  = s.growth.bull;
  // excess-return seeds have no tgrowth (no terminal value in this model) --
  // leave the (hidden) terminal-growth inputs at whatever they last held.
  if (s.tgrowth) {
    els.tgrowthBear.value = s.tgrowth.bear;
    els.tgrowthBase.value = s.tgrowth.base;
    els.tgrowthBull.value = s.tgrowth.bull;
  }
  els.waccBear.value    = s.discount.bear;
  els.waccBase.value    = s.discount.base;
  els.waccBull.value    = s.discount.bull;
  if (model === 'ddm' && els.dividendInput) {
    els.dividendInput.value = s.dividend != null ? (+s.dividend).toFixed(2) : '';
    els.dividendInput.placeholder = s.dividend != null ? '' : 'Enter annual dividend / share';
  }
  if (model === 'excess-return' && els.bookvalueInput) {
    els.bookvalueInput.value = s.bookValue != null ? (+s.bookValue).toFixed(2) : '';
    els.bookvalueInput.placeholder = s.bookValue != null ? '' : 'Enter book value / share';
  }
}

// Relabel shared inputs, swap input rows, and refresh the toggle + breakdown for the active model.
function applyModelUI() {
  const ddm = valuationModel === 'ddm';
  const excessReturn = valuationModel === 'excess-return';
  const reit = valuationModel === 'reit';
  const airline = valuationModel === 'airline';
  const isBankIns = currentData && isBankOrInsurance(currentData.sector, currentData.industry, currentData.ticker);
  const isReitTicker = currentData && isReit(currentData.sector, currentData.industry);
  const isAirlineTicker = currentData && isAirline(currentData.sector, currentData.industry);
  const isUtilityTicker = currentData && isUtility(currentData.sector, currentData.industry);

  if (els.fcfRow)      els.fcfRow.hidden = ddm || excessReturn || reit || airline;
  if (els.dividendRow) els.dividendRow.hidden = !ddm;
  if (els.bookvalueRow) els.bookvalueRow.hidden = !excessReturn;
  if (els.affoRow) els.affoRow.hidden = !reit;
  if (els.ebitdaRow) els.ebitdaRow.hidden = !airline;
  if (els.multistageRow) els.multistageRow.hidden = ddm || excessReturn || reit || airline;
  if (els.tgrowthRow) els.tgrowthRow.hidden = excessReturn || reit || airline; // no terminal value for these models
  if (els.discountScenarioRow) els.discountScenarioRow.hidden = reit || airline; // no discount rate at all

  // innerHTML (not textContent) so the glossary term span survives the
  // DDM/DCF toggle — a plain textContent write would strip it every time.
  if (els.growthLabel) els.growthLabel.innerHTML = reit
    ? T('p-affo-multiple', 'P/AFFO Multiple')
    : (airline ? T('ev-ebitda-multiple', 'EV/EBITDA Multiple')
    : (excessReturn ? T('roe', 'ROE %') : T('growth-rate', ddm ? 'Div Growth %' : '5yr Growth %')));
  const discountLabelText = $('discount-label-text');
  if (discountLabelText) discountLabelText.innerHTML = T((ddm || excessReturn) ? 'cost-of-equity' : 'wacc', (ddm || excessReturn) ? 'Cost of Equity %' : 'WACC %');
  if (els.discountTip) els.discountTip.setAttribute('data-tip', (ddm || excessReturn)
    ? 'Higher cost of equity = lower valuation.'
    : 'Higher WACC = lower valuation.');
  if (els.waccSummary)    els.waccSummary.textContent    = (ddm || excessReturn) ? 'How cost of equity is calculated' : 'How WACC is calculated';
  if (els.breakdownTitle) els.breakdownTitle.textContent = reit ? 'REIT Value Breakdown' : (airline ? 'Airline Value Breakdown' : (excessReturn ? 'Excess Return Value Breakdown' : (ddm ? 'DDM Value Breakdown' : 'DCF Value Breakdown')));

  renderDiscountBreakdown();
  updateModelToggle(isBankIns, isReitTicker, isAirlineTicker, isUtilityTicker);
}

function updateModelToggle(isBankIns, isReitTicker, isAirlineTicker, isUtilityTicker) {
  if (!els.modelToggleRow) return;
  if (isReitTicker) {
    // REITs are locked to the FFO/AFFO model, same no-toggle pattern as
    // banks/insurers below -- standard FCF-based DCF is structurally
    // unreliable here (GAAP depreciation distorts net income/FCF for real
    // estate), so there's no "value with DCF instead" option to offer.
    els.modelToggleRow.hidden = false;
    els.modelLabel.textContent = '🏢 FFO/AFFO Model — standard DCF is unreliable for REITs (depreciation distorts net income).';
    if (els.ddmToggle) els.ddmToggle.hidden = true;
    return;
  }
  if (isAirlineTicker) {
    // Airlines are locked to the EV/EBITDA model, same no-toggle pattern as
    // REITs/banks above -- extreme cyclicality and high operating/financial
    // leverage make standard FCF-based DCF unreliable (see calc/airline.js's
    // file-header comment for the confirmed live examples).
    els.modelToggleRow.hidden = false;
    els.modelLabel.textContent = '✈️ EV/EBITDA Model — standard DCF is unreliable for airlines (cyclicality and leverage distort FCF/growth).';
    if (els.ddmToggle) els.ddmToggle.hidden = true;
    return;
  }
  if (isUtilityTicker) {
    // Regulated utilities are locked to the Excess Return model (never
    // DCF/DDM) -- rate-base-and-allowed-return economics mean value tracks
    // book equity plus the spread between realized and required return, not
    // free cash flow (same underlying shape as a bank's excess-return
    // economics -- see calc/assumptions.js's isUtility() dispatch branch).
    // Reported ROE is used as a proxy for the regulator's allowed ROE --
    // Yahoo has no field for the latter -- surfaced here rather than hidden.
    els.modelToggleRow.hidden = false;
    els.modelLabel.textContent = '⚡ Excess Return Model — regulated utilities are valued on book equity + ROE spread, not free cash flow (reported ROE used as a proxy for the regulator-allowed ROE).';
    if (els.ddmToggle) els.ddmToggle.hidden = true;
    return;
  }
  if (isBankIns) {
    // Banks/insurance/NBFCs are locked to DDM or Excess Return Model (never DCF) --
    // show a static notice, no toggle. Which of the two is a computed fact about the
    // company (payout ratio vs. sustainable payout), not a user preference.
    els.modelToggleRow.hidden = false;
    els.modelLabel.textContent = valuationModel === 'excess-return'
      ? '🏦 Excess Return Model — payout ratio too low for DDM to be reliable.'
      : '🏦 Dividend Discount Model — DCF is unreliable for banks & insurers.';
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
       <p><strong>Equity risk premium and governance:</strong> Korea's equity risk premium is 4.8% (Damodaran July 2026, Aa2 rating; 4.4% for the US). Korean equities have historically traded at a governance discount — weaker minority-shareholder protections — that a rating-based premium does not capture, so consider adjusting it upward if you want to reflect that.</p>
       <p><strong>Static risk-free rate:</strong> fixed at ~3.8% — Korea's approximate 10-year government bond yield (~4.2%), minus Korea's ~0.39% sovereign default spread (Damodaran convention: the raw bond yield already prices in Korea's own default risk, which the equity risk premium above separately accounts for — using both would double-count it). Not live — no accessible Yahoo Finance data source exists for this rate.</p>
       <p><strong>Lower terminal growth assumption:</strong> 1.75% vs the tool's 2.5% default, reflecting Korea's structurally lower long-run growth expectations.</p>
     </details>`;
}

// Informational-only panel explaining the Japan-specific seeds — same collapsible
// pattern as the Korea panel. Shared by both the DCF and DDM breakdown renderers.
function japanInfoBlock() {
  if (currentMarket !== 'jpn') return '';
  return `<details class="wacc-franking">
       <summary>About the Japan numbers</summary>
       <p><strong>Risk-free rate:</strong> fixed at ~2.4% — Japan's approximate 10-year government bond yield (~2.9%, near multi-decade highs as the BOJ exits deflation-era policy), minus Japan's ~0.56% sovereign default spread (Damodaran convention: the raw bond yield already prices in Japan's own default risk, which the equity risk premium above separately accounts for — using both would double-count it). Not live — no accessible Yahoo Finance data source exists for this rate.</p>
       <p><strong>Lower terminal growth assumption:</strong> 1.2% vs the tool's 2.5% default. The old deflation-era convention of 0–0.5% is outdated, but Japan's demographic-constrained long-run growth still warrants a below-default cap.</p>
       <p><strong>Beta floor:</strong> historically low Japanese betas (0.5–0.7) partly reflect deflation-era price stagnation and are likely understated as volatility returns — floored at 0.6.</p>
       <p><strong>Cross-shareholding caveat:</strong> some Japanese companies are unwinding historic cross-shareholdings (keiretsu stakes) under the revised Corporate Governance Code. Sale proceeds can inflate reported cash flow — treat unusually high FCF with care.</p>
     </details>`;
}

// Informational-only panel explaining the UK-specific seeds — same collapsible
// pattern as the Korea/Japan panels. Shared by both the DCF and DDM breakdown renderers.
function ukInfoBlock() {
  if (currentMarket !== 'uk') return '';
  return `<details class="wacc-franking">
       <summary>About the UK numbers</summary>
       <p><strong>Risk-free rate:</strong> fixed at ~4.9% — the UK 10-year Gilt yield (~5.3%), minus the UK's ~0.48% sovereign default spread (Damodaran convention: the raw gilt yield already prices in the UK's own default risk, which the equity risk premium below separately accounts for — using both would double-count it). Not live — no accessible Yahoo Finance data source exists for this rate; re-checked periodically against real Gilt yields, so treat as a point-in-time estimate.</p>
       <p><strong>Equity risk premium:</strong> 4.9% (Damodaran July 2026, Aa3 rating) — a mature, liquid developed market, with the UK's small sovereign default premium included.</p>
       <p><strong>Terminal growth:</strong> 2.0% vs the tool's 2.5% US default, reflecting the UK's somewhat lower long-run nominal growth expectations.</p>
       <p><strong>Currency:</strong> Yahoo quotes UK-listed prices in <em>pence</em> (GBp), not pounds — a price of "650" means £6.50. Displayed values already account for this.</p>
     </details>`;
}

// Informational-only panel explaining the eurozone-specific seeds — same collapsible
// pattern as the Korea/Japan/UK panels. Shared by both the DCF and DDM breakdown renderers.
function euInfoBlock() {
  if (currentMarket !== 'eu') return '';
  return `<details class="wacc-franking">
       <summary>About the eurozone numbers</summary>
       <p><strong>Risk-free rate:</strong> fixed at ~3.4% (an approximate German 10-year Bund yield, used as the eurozone-wide proxy). Not live — no accessible Yahoo Finance data source exists for this rate; re-checked periodically against real Bund yields, so treat as a point-in-time estimate.</p>
       <p><strong>Equity risk premium:</strong> 4.2% (Damodaran July 2026 mature-market premium; Germany, the eurozone proxy, is Aaa-rated, so no country premium is added).</p>
       <p><strong>Terminal growth:</strong> 1.8% vs the tool's 2.5% US default, reflecting the eurozone's somewhat lower long-run nominal growth expectations.</p>
       <p><strong>One rate for every eurozone exchange except France:</strong> Germany, Netherlands, Italy, Spain, Belgium, Portugal, Austria, Finland, and Ireland all share this seed — it's a market-wide estimate, not a country-specific one. France has its own (same Bund rate, higher risk premium).</p>
     </details>`;
}

// Informational-only panel for French (.PA) tickers — same collapsible pattern as the other market panels.
function frInfoBlock() {
  if (currentMarket !== 'fr') return '';
  return `<details class="wacc-franking">
       <summary>About the French numbers</summary>
       <p><strong>Risk-free rate:</strong> the euro risk-free rate — the German 10-year Bund yield (~3.3%), the same rate every eurozone stock here uses. France's own 10-year bond (OAT) yields more (~5.1% in Oct 2026), but that extra yield is French default risk, which the equity risk premium below carries instead (Damodaran convention). Not live; re-checked periodically.</p>
       <p><strong>Equity risk premium:</strong> 4.9% (Damodaran July 2026: France is rated Aa3, so its premium includes a country risk premium on top of Germany's 4.2%).</p>
       <p><strong>Terminal growth:</strong> 1.8%, the same as the rest of the eurozone.</p>
     </details>`;
}

// Informational-only panel explaining the Hong Kong-specific seeds — same collapsible
// pattern as the Korea/Japan/UK/eurozone panels. Shared by both the DCF and DDM breakdown renderers.
function hkInfoBlock() {
  if (currentMarket !== 'hk') return '';
  return `<details class="wacc-franking">
       <summary>About the Hong Kong numbers</summary>
       <p><strong>Risk-free rate:</strong> fixed at ~3.5% — Hong Kong's 10-year Exchange Fund Note yield (~4.0%), minus Hong Kong's ~0.48% sovereign default spread (Damodaran convention: the raw yield already prices in Hong Kong's own default risk, which the equity risk premium below separately accounts for — using both would double-count it). Not live — no accessible Yahoo Finance data source exists for this rate; re-checked periodically, so treat as a point-in-time estimate.</p>
       <p><strong>Equity risk premium:</strong> 4.9% (Damodaran July 2026, Aa3 rating — the same bucket as the UK), including Hong Kong's small sovereign default premium. The 10-year yield itself is a thin, single-source quote, so treat the risk-free rate as a rougher estimate than the other markets' — and adjust manually if you have a better source.</p>
       <p><strong>Terminal growth:</strong> 2.0% vs the tool's 2.5% US default, reflecting Hong Kong's slower long-run growth as a mature financial hub.</p>
       <p><strong>Currency:</strong> Yahoo quotes Hong Kong-listed prices in HKD (HK$), which is pegged to the US dollar — displayed values already account for this.</p>
     </details>`;
}

// Informational-only panel explaining the China A-share-specific seeds — same collapsible
// pattern as the other market panels. Shared by both the DCF and DDM breakdown renderers.
function chinaInfoBlock() {
  if (currentMarket !== 'cn') return '';
  return `<details class="wacc-franking">
       <summary>About the China numbers</summary>
       <p><strong>Risk-free rate:</strong> fixed at ~1.1% — an approximate China 10-year Govt bond yield (~1.7%), minus China's ~0.56% sovereign default spread (Damodaran convention: the raw bond yield already prices in China's own default risk, which the equity risk premium below separately accounts for — using both would double-count it). Not live — no accessible Yahoo Finance data source exists for this rate; re-checked periodically, so treat as a point-in-time estimate.</p>
       <p><strong>Equity risk premium:</strong> 5.1% (Damodaran country-risk-adjusted estimate for China), reflecting the lower risk-free rate together with China-specific market and political risk.</p>
       <p><strong>Terminal growth:</strong> 0.6% — below the 2.5% US-tier default, kept under China's own 1.1% risk-free rate above per Damodaran's stable-growth ceiling (terminal growth can't exceed the risk-free rate proxy for long-run economy growth in perpetuity).</p>
       <p><strong>Currency:</strong> Yahoo quotes Shanghai (.SS) and Shenzhen (.SZ) A-share prices in CNY (renminbi) — displayed values already account for this. A-shares are a distinct market from Hong Kong-listed H-shares (.HK), which use HKD and get their own separate seed above.</p>
     </details>`;
}

function renderDiscountBreakdown() {
  if (valuationModel === 'reit') {
    els.waccContent.innerHTML = '<div class="wacc-row"><span class="wacc-src">No discount rate — this model applies a P/AFFO multiple directly to AFFO/share, the same way a P/E multiple values earnings.</span></div>';
    return;
  }
  if (valuationModel === 'airline') {
    els.waccContent.innerHTML = '<div class="wacc-row"><span class="wacc-src">No discount rate — this model applies an EV/EBITDA multiple directly, the same way a P/E multiple values earnings.</span></div>';
    return;
  }
  if (valuationModel === 'ddm' || valuationModel === 'excess-return') {
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
    const modelNote = valuationModel === 'excess-return'
      ? `<div class="wacc-row"><span class="wacc-src">No dividend/growth-rate component — Excess Return Model values (ROE − Cost of Equity) × Book Value each year, no terminal value beyond the explicit projection.</span></div>`
      : `<div class="wacc-row"><span class="wacc-src">No debt component — DDM discounts dividends at the cost of equity only.</span></div>`;
    els.waccContent.innerHTML = `
      <div class="wacc-row"><span>Cost of Equity (Re)</span><span class="wacc-val">${pct(lastCapm.re)}</span></div>
      <div class="wacc-row"><span class="wacc-src">CAPM: RF ${pct(lastCapm.rf)} + Beta ${lastCapm.beta.toFixed(2)} × ERP ${pct(lastCapm.erp)}</span></div>
      ${floorNote}
      <div class="wacc-divider"></div>
      ${modelNote}
      ${sectorRowDdm}
      ${koreaInfoBlock()}
      ${japanInfoBlock()}
      ${ukInfoBlock()}
      ${euInfoBlock()}
      ${frInfoBlock()}
      ${hkInfoBlock()}
      ${chinaInfoBlock()}
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
  if (currentData) { initInteractive(currentData, lastAssumptions); recompute(); }
}

// ── Render all ────────────────────────────────────────────────────────────

function renderAll(data) {
  const sym = CURRENCY_SYMBOLS[data.currency] ?? '';
  // Visible first, so the chart measures the real width (a hidden layout measures 0 and drew the desktop size on phones).
  show(els.layout);
  renderSummary(data, sym);
  renderFinancialWarning(data, sym);
  const scenarios = buildScenarios(data);
  renderTerminalGrowthWarning(scenarios);
  renderBreakeven(data, sym);
  renderScenarios(scenarios, data, sym);
  // The starting-figure boxes live in the folded section: open it when a value needs one of them filled in.
  const needsInput = scenarios.some(s => !s.result)
    || (els.fcfNormRow && !els.fcfNormRow.hidden) || (els.targetMarginRow && !els.targetMarginRow.hidden);
  const more = $('idcf-more');
  if (needsInput && more) more.open = true;
  renderValueChart(scenarios, data, sym);
  renderPressureTest(scenarios, data, sym);
  renderHeavyCapexCard(data, sym);
  // Show the explainer matching the active model. Excess Return has no
  // explainer section of its own yet (out of scope this pass) -- hide both
  // rather than show DCF's or DDM's, which would describe the wrong method.
  if (els.howDcf) els.howDcf.hidden = valuationModel !== 'dcf';
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
  const fcfInfo = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures, data.annualFcf);
  const fcf     = fcfInfo.value;
  const netDebt = (data.totalDebt ?? 0) - (data.totalCash ?? 0);
  const range  = `${fmt(data.fiftyTwoWeekLow, 2, '', sym)} – ${fmt(data.fiftyTwoWeekHigh, 2, '', sym)}`;
  const fcfNote = fcfInfo.method === 'proxy'   ? ' <span class="stat-warn">⚠ est.</span>'
                : fcfInfo.method === 'derived' ? ' <span style="font-size:0.7rem;color:var(--kv-muted)">OCF−CapEx</span>'
                : fcfInfo.method === 'annual'  ? ' <span style="font-size:0.7rem;color:var(--kv-muted)">latest annual</span>' : '';

  // REIT health metrics -- AFFO payout ratio and Debt-to-EBITDA, using data
  // already fetched for every ticker (dividend, debt, ebit/D&A). Cheap,
  // directly answers "is the dividend sustainable" per the design spec's
  // "UI additions" section, without needing any new data source.
  let reitStatsHtml = '';
  if (valuationModel === 'reit' && modelSeeds && modelSeeds.reit) {
    const affoPerShare = modelSeeds.reit.affoPerShare;
    const dividendPerShare = data.trailingAnnualDividendRate ?? data.dividendRate ?? null;
    const affoPayoutRatio = (affoPerShare != null && affoPerShare > 0 && dividendPerShare != null)
      ? dividendPerShare / affoPerShare : null;
    const ebitda = (data.ebit != null && modelSeeds.reit.depreciationAndAmortization != null)
      ? data.ebit + modelSeeds.reit.depreciationAndAmortization : null;
    const debtToEbitda = (data.totalDebt != null && ebitda != null && ebitda > 0)
      ? data.totalDebt / ebitda : null;
    reitStatsHtml = `
      <div class="stat"><div class="stat-label">${T('affo', 'AFFO Payout Ratio')}</div><div class="stat-value">${affoPayoutRatio != null ? fmt(affoPayoutRatio * 100, 1, '%') : 'N/A'}</div></div>
      <div class="stat"><div class="stat-label">${T('debt-to-ebitda', 'Debt / EBITDA')}</div><div class="stat-value">${fmt(debtToEbitda, 1, 'x')}</div></div>`;
  }

  // Airline health metric -- implied EV/EBITDA at the current market price,
  // for a direct "is the market pricing this richer or cheaper than our
  // multiple" comparison. Uses data already fetched for every ticker.
  let airlineStatsHtml = '';
  if (valuationModel === 'airline' && data.ebitda > 0) {
    const shares = (data.dilutedSharesOutstanding != null && data.dilutedSharesOutstanding > 0) ? data.dilutedSharesOutstanding : data.sharesOutstanding;
    const impliedEv = (data.price != null && shares > 0 ? data.price * shares : 0) + (data.totalDebt || 0) - (data.totalCash || 0);
    const impliedMultiple = impliedEv / data.ebitda;
    airlineStatsHtml = `
      <div class="stat"><div class="stat-label">Market-Implied ${T('ev-ebitda-multiple', 'EV/EBITDA')}</div><div class="stat-value">${fmt(impliedMultiple, 1, 'x')}</div></div>`;
  }

  els.summary.innerHTML = `
    <h2>${escapeHtml(data.name)} <span class="symbol">(${escapeHtml(data.ticker)})</span></h2>
    ${data.sector ? `<div class="sector">${escapeHtml(data.sector)}${data.industry ? ' · ' + escapeHtml(data.industry) : ''}</div>` : ''}
    <div class="stats">
      <div class="stat"><div class="stat-label">Price</div><div class="stat-value">${fmt(data.price, 2, '', sym)}</div></div>
      <div class="stat"><div class="stat-label">${T('market-cap', 'Market Cap')}</div><div class="stat-value">${formatMarketCap(data.marketCap, sym)}</div></div>
      <div class="stat"><div class="stat-label">${T('free-cash-flow', 'Free Cash Flow')}</div><div class="stat-value">${formatMarketCap(fcf, sym)}${fcfNote}</div></div>
      <div class="stat"><div class="stat-label">${T('operating-cash-flow', 'Operating CF')}</div><div class="stat-value">${formatMarketCap(data.operatingCashflow, sym)}</div></div>
      <div class="stat"><div class="stat-label">Revenue (TTM)</div><div class="stat-value">${formatMarketCap(data.totalRevenue, sym)}</div></div>
      <div class="stat"><div class="stat-label">${T('revenue-growth', 'Revenue Growth')}</div><div class="stat-value">${data.revenueGrowth !== null ? fmt(data.revenueGrowth * 100, 1, '%') : 'N/A'}</div></div>
      <div class="stat"><div class="stat-label">${T('net-debt', 'Net Debt')}</div><div class="stat-value ${netDebt > 0 ? 'stat-down' : 'stat-up'}">${formatMarketCap(netDebt, sym)}</div></div>
      <div class="stat"><div class="stat-label">${T('beta', 'Beta')}</div><div class="stat-value">${fmt(data.beta, 2)}</div></div>
      <div class="stat"><div class="stat-label">${T('pe-ratio', 'PE (TTM)')}</div><div class="stat-value">${fmt(data.trailingPE, 1, 'x')}</div></div>
      <div class="stat"><div class="stat-label">${T('52-week-range', '52-Week Range')}</div><div class="stat-value">${range}</div></div>${reitStatsHtml}${airlineStatsHtml}
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
         <p>Australian companies pass corporate tax credits (${T('franking-credits', 'franking credits')}) to shareholders. The ACCC values the benefit — Gamma (γ) — at <strong>0.4–0.5</strong>.</p>
         <p>The adjustment formula: <code>Tc_eff = Tc × (1 − γ)</code>. Applying γ = 0.45 would lower the effective tax rate from ${pct(w.tc)} to ~${pct(w.tc * (1 - 0.45))}, reducing WACC by roughly 0.3–0.8%.</p>
         <p>This tool uses standard post-tax WACC conservatively and does not apply the adjustment. For professional analysis with a domestic investor base, you may reduce WACC by that margin.</p>
       </details>`
    : '';

  els.waccContent.innerHTML = `
    <div class="wacc-row"><span>Cost of Equity (Re)</span><span class="wacc-val">${pct(w.re)}</span></div>
    <div class="wacc-row"><span class="wacc-src">RF ${pct(w.riskFreeRate)} + Beta ${flooredBeta != null ? flooredBeta.toFixed(2) : w.beta?.toFixed(2) ?? ''} × ERP ${pct(w.erp)}</span></div>
    ${floorNote}
    <div class="wacc-row"><span>Cost of Debt (Rd) ${
      w.rdMethod === 'synthetic'
        ? `<span class="wacc-estimated">(synthetic rating ${w.syntheticRating}, ICR ${w.icr.toFixed(1)}x)</span>`
        : w.isRdEstimated ? '<span class="wacc-estimated">(estimated)</span>' : ''
    }</span><span class="wacc-val">${pct(w.rd)}</span></div>
    <div class="wacc-row"><span>Tax Rate (Tc) ${w.isTcEstimated ? '<span class="wacc-estimated">(estimated)</span>' : ''}</span><span class="wacc-val">${pct(w.tc)}</span></div>
    <div class="wacc-row"><span>Capital Structure</span><span class="wacc-val">E ${(w.eWeight * 100).toFixed(0)}% / D ${(w.dWeight * 100).toFixed(0)}%</span></div>
    <div class="wacc-divider"></div>
    <div class="wacc-row wacc-total"><span>Calculated WACC</span><span>${pct(w.wacc)}</span></div>
    ${sectorRow}
    ${frankingBlock}
    ${koreaInfoBlock()}
    ${japanInfoBlock()}
    ${ukInfoBlock()}
    ${euInfoBlock()}
    ${frInfoBlock()}
    ${hkInfoBlock()}
    ${chinaInfoBlock()}
  `;
}

// ── Financial sector warning ──────────────────────────────────────────────

function renderFinancialWarning(data, sym) {
  // Property REITs (isReit() true) already switched away from DCF entirely
  // -- they're valued with the FFO/AFFO model (see updateModelToggle()'s own
  // locked-model notice, which already explains this). Showing this banner
  // too would contradict that: it says "DCF results should be treated with
  // caution" for a ticker that isn't using DCF at all anymore.
  if (isRealEstateSector(data.sector) && !isReit(data.sector, data.industry)) {
    // Real estate sector, but NOT a REIT (e.g. LIC.AX -- a residential
    // land-lease developer/operator, "Real Estate - Diversified" not
    // "REIT - Diversified") -- standard DCF still runs for these, since the
    // FFO/AFFO model is scoped to genuine REIT industry tags only (see
    // isReit()'s own doc comment). Real estate companies broadly still tend
    // to carry depreciation-heavy balance sheets, so a lighter caution is
    // still warranted -- just not the REIT-specific FFO claim, which would
    // be factually wrong for a company that isn't a REIT.
    els.finWarning.innerHTML = `
      <h3>⚠️ Real Estate Company</h3>
      <p>This is a real estate company, but not a REIT (Real Estate Investment Trust) — its Yahoo industry tag doesn't carry a "REIT" designation. Standard DCF still applies, but real estate companies often carry depreciation-heavy balance sheets that can distort free cash flow, so treat the result with some caution.</p>
    `;
    show(els.finWarning);
    return;
  }
  // Banks / insurers — DDM panel with banking metrics (replaces the DCF warning)
  if (isBankOrInsurance(data.sector, data.industry, data.ticker)) {
    // Mortgage REITs route through isBankOrInsurance() too (loan-book
    // economics, see that function's own comment) but aren't a "Bank" --
    // they don't take deposits, they hold levered mortgage/MBS portfolios
    // funded by repo/warehouse debt. Falling into the generic Bank branch
    // gave mortgage REITs a factually wrong "deposits are a raw material"
    // explanation (caught in peer review, 2026-08-19) -- give them their
    // own kind with correct reasoning instead.
    const isMortgageReit = /^REIT\s*-\s*Mortgage/i.test(data.industry || '');
    const kind = isMortgageReit
      ? 'Mortgage REIT'
      : (/insurance/i.test(data.industry || '') || /insurance/i.test(data.sector || '') ? 'Insurance' : 'Bank');
    const icon = isMortgageReit ? '🏢' : '🏦';
    const usingExcessReturn = valuationModel === 'excess-return';
    const modelLabel = usingExcessReturn
      ? T('excess-return-model', 'Excess Return Model')
      : T('ddm', 'Dividend Discount Model');
    const modelName = usingExcessReturn ? 'Excess Return Model' : 'Dividend Discount Model (DDM)';
    const noDataNote = usingExcessReturn ? '' : (dividendAvailable ? '' : ' — but no dividend data is available, so no intrinsic value can be shown');
    const reason = isMortgageReit
      ? "a mortgage REIT's cash flow is dominated by interest-rate-sensitive portfolio and leverage movements, not owner earnings from operations"
      : kind === 'Bank'
      ? 'deposits are a raw material rather than funding, so there is no clean free cash flow and WACC cannot be derived the usual way'
      : 'free cash flow is dominated by investment-portfolio and reserve movements, not owner earnings';
    // "mortgage reit stocks" (kind.toLowerCase() lowercasing REIT too) reads
    // wrong -- REIT stays capitalized in prose the same way it does in the
    // property-REIT card's own copy.
    const kindLower = isMortgageReit ? 'mortgage REIT' : kind.toLowerCase();
    const pe  = fmt(data.trailingPE, 1, 'x');
    const pb  = fmt(data.priceToBook, 2, 'x');
    const roe = data.returnOnEquity !== null ? fmt(data.returnOnEquity * 100, 1, '%') : 'N/A';
    const div = data.dividendYield  !== null ? fmt(data.dividendYield  * 100, 2, '%') : 'N/A';
    els.finWarning.innerHTML = `
      <h3>${icon} ${kind} — ${modelLabel}</h3>
      <p>DCF is not used for ${kindLower} stocks: ${reason}. This valuation uses the <strong>${modelName}</strong> instead${noDataNote}.</p>${usingExcessReturn ? '<p style="font-size:0.78rem;color:var(--kv-muted)">Low payout ratio relative to ROE and growth makes DDM understate value here — Excess Return Model captures value from reinvested earnings instead.</p>' : ''}
      <p style="font-size:0.78rem;color:var(--kv-muted)">Key ${kindLower} valuation metrics:</p>
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

// Resolves which FCF number a DCF run should use, in the same precedence
// buildScenarios() and buildSensitivityGrid() both need: the financial-sector
// normalised-FCF field if shown and filled in, else the main FCF input, plus
// a revenue-normalised fallback (target margin × revenue) for negative or
// missing FCF. Shared so the scenario cards and the sensitivity grid can
// never silently disagree on which FCF was actually run.
function resolveDcfFcfInputs(data) {
  const useNormFcf = isFinancialSector(data.sector)
    && !isBankOrInsurance(data.sector, data.industry, data.ticker)
    && els.fcfNorm && els.fcfNorm.value;
  const fcfRaw = useNormFcf ? parseMoney(els.fcfNorm) : parseMoney(els.fcfInput);

  const targetMarginPct = els.targetMarginInput ? parseFloat(els.targetMarginInput.value) : NaN;
  const normFcf = (!useNormFcf && !isNaN(targetMarginPct) && targetMarginPct > 0 && data.totalRevenue > 0)
    ? data.totalRevenue * (targetMarginPct / 100)
    : null;

  return { fcfRaw, normFcf };
}

// Reads the shared scenario <input> elements into a plain seed object and
// delegates the actual DCF/DDM math to the pure computeScenarios()
// (www/dcf/calc/assumptions.js) — the exact same function the native
// shell's Card Dashboard calls. Preserves the original per-field fallback
// defaults exactly: parseFloat(el.value) || fallbackPct, where
// fallbackPct is the pre-refactor fraction default × 100 (e.g. DCF growth
// used `parseFloat(v)/100 || 0.05`, which is mathematically identical to
// `parseFloat(v) || 5` since dividing then multiplying by the same
// nonzero constant never changes which branch of `||` fires).
// A growth-type rate box: its number, or the fallback only when the box is empty / not a number. 0% is a real
// answer -- the old `parseFloat(v) || 5` turned a typed (or seeded, or linked) 0% growth into 5% (found 2026-11-11 by
// the /evaluate/ -> /dcf/ hand-off test).
function rateOr(el, fallback) {
  const v = parseFloat(el.value);
  return isFinite(v) ? v : fallback;
}

function scenarioInputs(data) {
  const years = parseInt(els.yearsSlider.value, 10);
  const num = el => parseFloat(String(el.value).replace(/,/g, ''));

  // ── REIT (property REITs, locked model) ──
  if (valuationModel === 'reit') {
    const affoPerShare = els.affoInput ? num(els.affoInput) : NaN;
    return { model: 'reit', options: { holdcoDiscount }, seeds: {
      affoPerShare: isFinite(affoPerShare) ? affoPerShare : null,
      multiple: { bear: parseFloat(els.growthBear.value) || 0, base: parseFloat(els.growthBase.value) || 0, bull: parseFloat(els.growthBull.value) || 0 }, // reuses the growth-bear/base/bull inputs, relabeled "P/AFFO Multiple" in applyModelUI()
    } };
  }

  // ── Airline (EV/EBITDA, locked model) ──
  if (valuationModel === 'airline') {
    const ebitda = els.ebitdaInput ? num(els.ebitdaInput) : NaN;
    return { model: 'airline', options: { holdcoDiscount, nonOperatingNet: fcffNonOperatingNet() }, seeds: {
      ebitda: isFinite(ebitda) ? ebitda : null,
      multiple: { bear: parseFloat(els.growthBear.value) || 0, base: parseFloat(els.growthBase.value) || 0, bull: parseFloat(els.growthBull.value) || 0 },
    } };
  }

  // ── DDM (banks/insurance, or user-toggled) ──
  if (valuationModel === 'ddm') {
    const dividend = els.dividendInput ? num(els.dividendInput) : NaN;
    return { model: 'ddm', options: { years, useMidYear: !!(els.midyearToggle && els.midyearToggle.checked), holdcoDiscount }, seeds: {
      dividend,
      growth:   { bear: parseFloat(els.growthBear.value) || 0, base: parseFloat(els.growthBase.value) || 0, bull: parseFloat(els.growthBull.value) || 0 }, // 0% is a valid DDM case (flat dividend perpetuity)
      tgrowth:  { bear: rateOr(els.tgrowthBear, 2.5), base: rateOr(els.tgrowthBase, 2.5), bull: rateOr(els.tgrowthBull, 2.5) },
      discount: { bear: parseFloat(els.waccBear.value) || 9, base: parseFloat(els.waccBase.value) || 9, bull: parseFloat(els.waccBull.value) || 9 },
    } };
  }

  // ── Excess Return Model (low-payout banks/insurers/NBFCs) ──
  if (valuationModel === 'excess-return') {
    const bookValue = els.bookvalueInput ? num(els.bookvalueInput) : NaN;
    return { model: 'excess-return', options: { years, useMidYear: !!(els.midyearToggle && els.midyearToggle.checked), holdcoDiscount }, seeds: {
      bookValue,
      growth:   { bear: parseFloat(els.growthBear.value) || 0, base: parseFloat(els.growthBase.value) || 0, bull: parseFloat(els.growthBull.value) || 0 }, // "growth" slot holds ROE
      discount: { bear: parseFloat(els.waccBear.value) || 9, base: parseFloat(els.waccBase.value) || 9, bull: parseFloat(els.waccBull.value) || 9 },
      // Book value compounding rate -- not user-editable (no UI field for it),
      // so re-derived from the same source data assumptions.js seeds it from.
      // NOT the ROE inputs above (fixed 2026-08-15, see calc/assumptions.js).
      bookValueGrowthPct: deriveDividendGrowth(data.earningsGrowth, data.revenueGrowth) * 100,
    } };
  }

  // ── DCF ──
  const { fcfRaw, normFcf } = resolveDcfFcfInputs(data);
  return { model: 'dcf', options: {
    years,
    useMultiStage: !!(els.multistageToggle && els.multistageToggle.checked),
    useMidYear: !!(els.midyearToggle && els.midyearToggle.checked),
    fcfRaw, normFcf, holdcoDiscount,
    terminalFcfFactor: fcffMode && lastAssumptions && lastAssumptions.fcffMethod ? lastAssumptions.fcfInfo.terminalFcfFactor : 1,
    nonOperatingNet: fcffNonOperatingNet(),
  }, seeds: {
    growth:   { bear: rateOr(els.growthBear, 5), base: rateOr(els.growthBase, 5), bull: rateOr(els.growthBull, 5) },
    tgrowth:  { bear: rateOr(els.tgrowthBear, 2.5), base: rateOr(els.tgrowthBase, 2.5), bull: rateOr(els.tgrowthBull, 2.5) },
    discount: { bear: parseFloat(els.waccBear.value) || 10, base: parseFloat(els.waccBase.value) || 10, bull: parseFloat(els.waccBull.value) || 10 },
  } };
}

function fcffNonOperatingNet() {
  return fcffMode && lastAssumptions && lastAssumptions.fcffMethod ? (lastAssumptions.fcfInfo.nonOperatingNet || 0) : 0;
}

function buildScenarios(data) {
  const inp = scenarioInputs(data);
  const scenarios = computeScenarios(data, inp.model, inp.seeds, inp.options);
  if (inp.model !== 'dcf') return scenarios;
  // Heavy capex spending: the box above is the existing business; add the growth capex at its return per scenario.
  if (!heavyCapexState) { lastHeavyCapexValuation = null; return scenarios; }
  lastHeavyCapexValuation = heavyCapexValuation(data, heavyCapexState, scenarios);
  return lastHeavyCapexValuation.scenarios;
}

// Heavy capex spending (calc/heavyCapex.js): the shared six tests, from the same derive prefillInputs() uses.
function heavyCapexStateFor(data, assumptions) {
  if (typeof heavyCapexForAssumptions !== 'function') return null;
  const check = heavyCapexForAssumptions(data, assumptions);
  return check.applies ? check : null;
}

// What the free-cash-flow box shows when the method applies: the existing business's cash flow, rounded like the
// box's other prefills.
function heavyCapexPrefillFcf(check) {
  return Math.round(heavyCapexExistingFcf(check));
}

// The card under the scenarios -- calc/heavyCapex.js's wording, shared with /evaluate/, native and ticker pages.
function renderHeavyCapexCard(data, sym) {
  const el = document.getElementById('heavy-capex-card');
  if (!el) return;
  if (!lastHeavyCapexValuation || valuationModel !== 'dcf') { el.hidden = true; el.innerHTML = ''; return; }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const t = heavyCapexCardText({ check: heavyCapexState, valuation: lastHeavyCapexValuation }, {
    price: data.price,
    money: (v) => fmt(v, 2, '', sym),
    moneyBig: (v) => formatMarketCap(v, sym),
    pct: (v) => (v == null || !isFinite(v) ? 'N/A' : (v * 100).toFixed(1) + '%'),
  });
  el.innerHTML = '<h3>' + esc(t.title) + '</h3>'
    + '<p class="hc-headline">' + esc(t.headline[0]) + '<strong>' + esc(t.headline[1]) + '</strong>' + esc(t.headline[2]) + '</p>'
    + '<p>' + esc(t.facts) + '</p><p>' + esc(t.existing) + '</p>'
    + '<p class="hc-method">' + esc(t.method) + ' <a href="/glossary/heavy-capex-spending/">How this works</a></p>';
  el.hidden = false;
}

// Terminal growth cannot exceed the risk-free rate in perpetuity — Damodaran's
// stable-growth ceiling ("a firm growing faster than the economy forever
// eventually becomes the economy"). Flags any scenario whose terminal growth
// input breaches the current risk-free rate; purely informational, doesn't
// block calculation — same non-blocking spirit as the >70% terminal-value
// warning in renderCharts().
function renderTerminalGrowthWarning(scenarios) {
  if (!els.tgrowthWarning) return;
  const rf = parseFloat(els.rfInput.value) / 100;
  if (!isFinite(rf)) { els.tgrowthWarning.hidden = true; return; }
  const offenders = scenarios.filter(s => s.terminalGrowth > rf);
  if (offenders.length === 0) { els.tgrowthWarning.hidden = true; return; }
  const labels = offenders.map(s => s.key.charAt(0).toUpperCase() + s.key.slice(1)).join('/');
  els.tgrowthWarning.textContent =
    `⚠ ${labels} terminal growth exceeds the risk-free rate (${(rf * 100).toFixed(1)}%) — a company can't outgrow the economy forever. Consider lowering it.`;
  els.tgrowthWarning.hidden = false;
}

// ── Render scenario cards ─────────────────────────────────────────────────

// Shows/hides the persistent Share button based on whether the base-case
// scenario currently has a valid verdict to share. Lives here (not with
// updateWatchlistStar) because shareInfo is only known once renderScenarios
// has computed the base card's verdict — renderSummary() runs first in
// renderAll() and doesn't have it yet.
function updateShareButton() {
  if (!shareBtn) return;
  shareBtn.hidden = !shareInfo;
}

async function onShareClick() {
  if (!shareInfo) return;
  const { name, ticker, sym, price, intrinsicValue, mosLabel, mosPct } = shareInfo;
  // mosPct can be negative (Overvalued cases) — mosLabel already carries the
  // direction, so "by -31.1%" would read as a confusing double-negative.
  const absMosPct = Math.abs(parseFloat(mosPct)).toFixed(1);
  const text = `${name} (${ticker}) DCF: ${mosLabel} by ${absMosPct}% — Intrinsic Value ${sym}${intrinsicValue.toFixed(2)} vs Price ${sym}${(price ?? 0).toFixed(2)}. Free DCF calculator:`;
  // location.href is meaningless inside the app — Capacitor's WebView
  // origin is https://localhost (Android) / capacitor://localhost (iOS),
  // not kashvector.com — so a shared fallback URL must be built from the
  // real domain instead. shareInfo.url (a resolved ticker-page URL) is
  // already an absolute kashvector.com URL either way, so this only
  // matters for tickers with no published page.
  // Once the visitor has changed the numbers, share THIS page with them (the URL carries the changes), not the
  // ticker's static page.
  const edited = !!(pageState && ourState && psIsEdited(pageState, ourState));
  const url = isNative
    ? (shareInfo.url || 'https://kashvector.com/dcf/' + window.kvTickerInput.buildUrlQuery({ symbol: ticker, isAsx: currentMarket === 'aus', isNse: currentMarket === 'ind' }))
    : (edited ? window.location.href : (shareInfo.url || window.location.href));

  // Inside the Capacitor app, navigator.share() is not reliably wired to
  // the native OS share sheet — the embedded Android/iOS WebView doesn't
  // bridge the Web Share API to a native share intent the way the actual
  // Chrome/Safari browser app does. Use the real @capacitor/share plugin
  // instead when running natively; it's the one Capacitor plugin built
  // specifically to solve this. window.Capacitor.Plugins.<Name> is the
  // same no-bundler global-access pattern kv-watchlist.js already uses
  // for PushNotifications.
  const NativeShare = isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Share;
  if (NativeShare) {
    try {
      await NativeShare.share({ title: 'KashVector DCF Valuation', text, url, dialogTitle: 'Share this valuation' });
    } catch (err) {
      // User cancelled the native share sheet — not a real error.
    }
    return;
  }

  if (navigator.share) {
    try {
      await navigator.share({ title: 'KashVector DCF Valuation', text, url });
    } catch (err) {
      // AbortError = user cancelled the OS share sheet, not a real error.
      // Any other rejection (e.g. no share targets registered) is rare and
      // swallowed silently — same risk tolerance as the clipboard call
      // below, which also doesn't handle failure.
    }
    return;
  }

  navigator.clipboard.writeText(`${text}\n${url}`).then(() => {
    shareBtnLabel.textContent = '✓ Copied!';
    shareBtn.classList.add('copied');
    setTimeout(() => {
      shareBtnLabel.textContent = 'Share';
      shareBtn.classList.remove('copied');
    }, 2000);
  });
}

// The message a tile shows when its scenario has no value (missing inputs, discount <= long-run growth, ...).
function noResultMessage(s) {
  const { fcfNegative, fcfMissing, noDividend, noBookValue, noAffo } = s;
  if (fcfMissing) return 'Enter a Free Cash Flow value in the inputs panel to run the DCF.';
  if (noDividend) return 'No dividend data available — the Dividend Discount Model needs a dividend. Enter an annual dividend per share in the inputs panel, or use the metrics above.';
  if (noBookValue) return 'Enter a Book Value / Share in the inputs panel to run the Excess Return Model.';
  if (noAffo) return 'Enter a positive AFFO / Share in the inputs panel to run the REIT model.';
  if (fcfNegative) {
    return isFinancialSector(currentData?.sector)
      ? 'Reported FCF is negative. Enter a positive Normalised FCF in the inputs panel to run the DCF.'
      : 'FCF is negative — DCF requires positive free cash flow. This company may not be suitable for DCF valuation.';
  }
  if (valuationModel === 'excess-return') return 'ROE and Cost of Equity must both be positive to run the Excess Return Model.';
  if (valuationModel === 'reit') return 'Enter a positive P/AFFO Multiple in the inputs panel to run this model.';
  if (valuationModel === 'airline') return 'Enter a positive EBITDA in the inputs panel to run this model.';
  return valuationModel === 'ddm'
    ? 'The cost of equity must be above long-run growth.'
    : 'The discount rate must be above long-run growth.';
}

// "Growth 12.6% · WACC 9.40%" (per model) for a tile.
function scenarioMetaText(s) {
  const pct = (v, d) => (v == null || !isFinite(v) ? null : (v * 100).toFixed(d) + '%');
  const mult = v => (v == null || !isFinite(v) ? null : (+v).toFixed(1) + '×');
  let parts;
  if (valuationModel === 'reit') parts = [mult(s.multiple) && 'P/AFFO ' + mult(s.multiple)];
  else if (valuationModel === 'airline') parts = [mult(s.multiple) && 'EV/EBITDA ' + mult(s.multiple)];
  else if (valuationModel === 'excess-return') parts = [pct(s.roe, 1) && 'ROE ' + pct(s.roe, 1), pct(s.wacc, 2) && 'Cost of equity ' + pct(s.wacc, 2)];
  else if (valuationModel === 'ddm') parts = [pct(s.growthRate, 1) && 'Dividend growth ' + pct(s.growthRate, 1), pct(s.wacc, 2) && 'Cost of equity ' + pct(s.wacc, 2)];
  else parts = [pct(s.growthRate, 1) && 'Growth ' + pct(s.growthRate, 1), pct(s.wacc, 2) && 'WACC ' + pct(s.wacc, 2)];
  return parts.filter(Boolean).join(' · ');
}

let ourBaseValue = null; // the Base value at our numbers, shown on the Base tile once the visitor changes anything

function renderScenarios(scenarios, data, sym) {
  let baseShareInfo = null;
  const years = parseInt(els.yearsSlider.value, 10);
  const price = data.price;
  const edited = !!(pageState && ourState && psIsEdited(pageState, ourState));
  const names = { bear: 'Bear', base: 'Base', bull: 'Bull' };
  const values = {};

  const tiles = scenarios.map(s => {
    const { key, result, normalised } = s;
    const head = `<div class="idcf-tile-h">${names[key]}</div>`;
    if (!result) return `<div class="idcf-tile ${key}">${head}<div class="sc-no-result">${noResultMessage(s)}</div></div>`;
    if (result.intrinsicValue === null) {
      if (result.negativeEquity) {
        return `<div class="idcf-tile ${key}">${head}<div class="sc-no-result">Net debt (${formatMarketCap(result.netDebt, sym)}) exceeds DCF firm value (${formatMarketCap(result.firmValue, sym)}). Under these assumptions the equity is worth zero on a DCF basis. The stock is likely priced on future growth or asset value — try a higher growth rate or check the FCF is not inflated by one-off items.</div></div>`;
      }
      return `<div class="idcf-tile ${key}">${head}<div class="sc-no-result">Shares outstanding unavailable — firm value ${formatMarketCap(result.firmValue, sym)}.</div></div>`;
    }

    values[key] = result.intrinsicValue;
    const mos = result.marginOfSafety;
    const verdict = deriveVerdict(mos);
    const pillCls = verdict === 'Undervalued' ? 'idcf-pill-green' : verdict === 'Overvalued' ? 'idcf-pill-red' : 'idcf-pill-amber';
    const mosPct = (mos * 100).toFixed(1);
    if (key === 'base') {
      const mosLabel = verdict === 'Undervalued' ? '✅ Undervalued' : verdict === 'Overvalued' ? '❌ Overvalued' : '⚠️ Fairly Valued';
      baseShareInfo = { name: data.name, ticker: data.ticker, sym, price: data.price, intrinsicValue: result.intrinsicValue, mosLabel, mosPct, url: null };
      if (!edited) ourBaseValue = result.intrinsicValue;
    }
    const ret = (price > 0 && result.intrinsicValue > 0 && years > 0) ? Math.pow(result.intrinsicValue / price, 1 / years) - 1 : null;
    const retLine = ret == null ? '' : `<div class="idcf-tile-ret"><b>${ret >= 0 ? '+' : '−'}${Math.abs(ret * 100).toFixed(1)}% a year</b> if the price meets this value by year ${years}</div>`;
    // Beside the value (two short lines, no taller than the value), so the card doesn't grow when it appears.
    const ours = (key === 'base' && edited && ourBaseValue != null) ? `<div class="idcf-tile-ours"><span>Our number</span> <b>${sym}${ourBaseValue.toFixed(2)}</b></div>` : '';
    const meta = scenarioMetaText(s);
    return `<div class="idcf-tile ${key}">${head}
      <div class="idcf-tile-vrow"><div class="idcf-tile-v">${sym}${result.intrinsicValue.toFixed(2)}</div>${ours}</div>
      <span class="idcf-pill ${pillCls}">${parseFloat(mosPct) > 0 ? '+' : ''}${mosPct}% · ${verdict}</span>
      ${meta ? `<div class="idcf-tile-meta">${escapeHtml(meta)}</div>` : ''}
      ${retLine}
      ${normalised ? '<div class="idcf-tile-meta">FCF estimated as Revenue × target margin.</div>' : ''}
    </div>`;
  }).join('');

  // Range bar (mockup v3): Bear-to-Bull band in a red-amber-green gradient, Base tick, today's price marker, and
  // "Price" / "Base" labels under it (the Base label is left out when it would sit on the price label).
  let range = '';
  if (values.bear != null && values.base != null && values.bull != null && price > 0) {
    const b0 = Math.min(values.bear, values.bull), b1 = Math.max(values.bear, values.bull);
    const lo = Math.min(b0, price, 0);
    const hi = Math.max(b1, price) * 1.08;
    const pos = v => Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100));
    const at = v => pos(v).toFixed(2);
    const near = Math.abs(pos(price) - pos(values.base)) < 12;
    range = `<div class="idcf idcf-range-wrap">
      <div class="idcf-range" role="img" aria-label="Bear to Bull ${sym}${b0.toFixed(2)} to ${sym}${b1.toFixed(2)}, Base ${sym}${values.base.toFixed(2)}, today's price ${sym}${price.toFixed(2)}">
        <div class="idcf-range-band" style="left:${at(b0)}%;width:${(pos(b1) - pos(b0)).toFixed(2)}%"></div>
        <i class="idcf-range-base" style="left:${at(values.base)}%"></i>
        <i class="idcf-range-price" style="left:${at(price)}%"></i>
      </div>
      <div class="idcf-range-lbls"><span class="idcf-range-lbl idcf-range-lbl-price" style="left:${at(price)}%">Price ${sym}${price.toFixed(2)}</span>${near ? '' : `<span class="idcf-range-lbl" style="left:${at(values.base)}%">Base ${sym}${values.base.toFixed(2)}</span>`}</div>
    </div>`;
  }

  const isNormalised = scenarios.some(s => s.normalised);
  const ivLabel = T('intrinsic-value', 'Intrinsic Value');
  const heading = isNormalised
    ? `${ivLabel} Estimate (${years}-yr · Revenue-normalised)`
    : `${ivLabel} Estimate (${years}-year forecast)`;
  els.scenarios.innerHTML = `<h3>${heading}</h3><div class="idcf idcf-tiles">${tiles}</div>${range}`;
  show(els.scenarios);

  shareInfo = baseShareInfo;
  updateShareButton();

  // Not awaited — renderScenarios() stays synchronous, and navigator.share() (called from a later, separate click)
  // must not be preceded by an awaited fetch. The identity check discards a stale resolution.
  if (baseShareInfo) {
    fetchTickerPageUrl(baseShareInfo.ticker, currentMarket).then(url => {
      if (url && shareInfo === baseShareInfo) shareInfo.url = url;
    });
  }
}

// ── Value per share, year by year (chart) ─────────────────────────────────

let lastChart = null;   // { m, paths, sym, price } for the tooltip
let chartTarget = null; // { kind, value } from the pressure test, drawn on the chart

function valuePathCtx(data) {
  const shares = (data.dilutedSharesOutstanding != null && data.dilutedSharesOutstanding > 0) ? data.dilutedSharesOutstanding : data.sharesOutstanding;
  return {
    years: parseInt(els.yearsSlider.value, 10),
    midYear: !!(els.midyearToggle && els.midyearToggle.checked),
    shares,
    netDebt: (data.totalDebt ?? 0) - (data.totalCash ?? 0),
    holdcoDiscount,
    // Same book-value compounding rate buildScenarios() passes to the Excess Return engine.
    bookValueGrowthRate: deriveDividendGrowth(data.earningsGrowth, data.revenueGrowth),
  };
}

function scenarioPaths(scenarios, data) {
  if (valuationModel === 'reit' || valuationModel === 'airline' || lastHeavyCapexValuation) return null;
  // Negative-FCF companies valued on Revenue × target margin: no time path (spec call 12).
  if (scenarios.some(s => s.normalised)) return null;
  const ctx = valuePathCtx(data);
  const paths = {};
  for (const s of scenarios) {
    const p = valuePath(s, valuationModel, ctx);
    if (!p || p.some(v => !isFinite(v))) return null;
    paths[s.key] = p;
  }
  return paths.base ? paths : null;
}

function renderValueChart(scenarios, data, sym) {
  const sec = els.idcfChart;
  if (!sec) return;
  const paths = scenarioPaths(scenarios, data);
  if (!paths) { sec.hidden = true; els.idcfChartSvg.innerHTML = ''; lastChart = null; if (els.tvWarning) els.tvWarning.hidden = true; return; }
  const w = Math.round((els.scenarios.getBoundingClientRect().width || 0)) || 800;
  const width = Math.max(320, w);
  const height = width < 520 ? 280 : 320;
  const pt = ptAvailable(scenarios) ? ptCurrentTarget(data) : null;
  // A value-today target equal to today's price is the price line already drawn -- no second marker on it.
  const samePrice = pt && pt.kind === 'value' && Math.abs(pt.value - data.price) < 0.005;
  chartTarget = pt && !samePrice ? { kind: pt.kind, value: pt.value } : null;
  const m = buildChartModel({ paths, price: data.price, target: chartTarget, width, height, prefix: sym });
  lastChart = { m, paths, sym, price: data.price };
  const note = $('idcf-chart-note');
  if (note) note.hidden = valuationModel !== 'excess-return';
  els.idcfChartSvg.innerHTML = chartSvgHtml(m);
  const base = scenarios.find(s => s.key === 'base');
  if (els.tvWarning) els.tvWarning.hidden = !(base && base.result && base.result.terminalValuePct > 70);
  sec.hidden = false;
}

function chartSvgHtml(m) {
  const f = n => (+n).toFixed(1);
  const p = m.plot;
  const esc = s => escapeHtml(String(s));
  let s = `<svg class="idcf-svg" viewBox="0 0 ${m.width} ${m.height}" width="100%" height="${m.height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Value per share by year: Bear, Base and Bull">`;
  for (const t of m.yTicks) {
    s += `<line class="idcf-grid" x1="${f(p.left)}" x2="${f(p.left + p.width)}" y1="${f(t.y)}" y2="${f(t.y)}"/>`;
    s += `<text class="idcf-axis" x="${f(p.left - 6)}" y="${f(t.y + 4)}" text-anchor="end">${esc(t.label)}</text>`;
  }
  for (const t of m.xTicks) {
    s += `<text class="idcf-axis" x="${f(t.x)}" y="${f(p.top + p.height + 18)}" text-anchor="${t.t === 0 ? 'start' : t.t === m.years ? 'end' : 'middle'}">${esc(t.label)}</text>`;
  }
  const line = k => m.lines.find(l => l.key === k);
  const bear = line('bear'), bull = line('bull');
  if (bear && bull) {
    const pts = bull.points.map(q => `${f(q.x)},${f(q.y)}`).concat(bear.points.slice().reverse().map(q => `${f(q.x)},${f(q.y)}`));
    s += `<polygon class="idcf-band" points="${pts.join(' ')}"/>`;
  }
  const pl = m.priceLine;
  if (isFinite(pl.y) && pl.y >= p.top && pl.y <= p.top + p.height) {
    s += `<line class="idcf-price" x1="${f(p.left)}" x2="${f(p.left + p.width)}" y1="${f(pl.y)}" y2="${f(pl.y)}"/>`;
    s += `<text class="idcf-price-lbl" x="${f(pl.box.x)}" y="${f(pl.box.y + pl.box.h - 3)}">${esc(pl.label)}</text>`;
  }
  for (const k of ['bull', 'bear', 'base']) {
    const l = line(k);
    if (!l) continue;
    s += `<polyline class="idcf-line idcf-line-${k}" points="${l.points.map(q => `${f(q.x)},${f(q.y)}`).join(' ')}"/>`;
    for (const q of l.points) s += `<circle class="idcf-dot idcf-dot-${k}" cx="${f(q.x)}" cy="${f(q.y)}" r="${k === 'base' ? 3.5 : 2.5}"/>`;
  }
  for (const lb of m.labels) {
    s += `<text class="idcf-lbl idcf-lbl-${lb.key}" x="${f(lb.x + 2)}" y="${f(lb.y + lb.h - 3)}">${esc(lb.text)}</text>`;
  }
  for (const lb of m.endLabels) {
    s += `<text class="idcf-end idcf-end-${lb.key}" x="${f(lb.x)}" y="${f(lb.y + lb.h - 3)}">${esc(lb.text)}</text>`;
  }
  const tm = m.targetMarker;
  if (tm) {
    // The label sits in the box the chart model reserved for it (value labels already keep clear of it).
    if (!tm.edge) s += `<circle class="idcf-target-dot" cx="${f(tm.x)}" cy="${f(tm.y)}" r="5"/>`;
    s += `<text class="idcf-target-lbl" x="${f(tm.box.x + 2)}" y="${f(tm.box.y + tm.box.h - 3)}">${esc(tm.text)}</text>`;
  }
  return s + '</svg>';
}

// Hover / tap: a crosshair and a tooltip with the year's three values and the price.
function onChartPointer(e) {
  if (!lastChart || !els.idcfTip) return;
  const { m, paths, sym, price } = lastChart;
  const rect = els.idcfChartSvg.getBoundingClientRect();
  if (!rect.width) return;
  const scale = m.width / rect.width;
  const x = (e.clientX - rect.left) * scale;
  const t = Math.max(0, Math.min(m.years, Math.round(((x - m.plot.left) / m.plot.width) * m.years)));
  const money = v => (v == null || !isFinite(v) ? '—' : sym + v.toFixed(2));
  els.idcfTip.innerHTML = `<b>${t === 0 ? 'Today' : 'Year ' + t}</b>`
    + `<span>Bull ${money(paths.bull && paths.bull[t])}</span><span>Base ${money(paths.base[t])}</span>`
    + `<span>Bear ${money(paths.bear && paths.bear[t])}</span><span>Price ${money(price)}</span>`;
  const cx = (m.plot.left + (m.plot.width * t) / m.years) / scale;
  els.idcfTip.style.left = Math.min(Math.max(cx - 70, 0), rect.width - 140) + 'px';
  els.idcfTip.hidden = false;
  if (els.idcfCross) { els.idcfCross.style.left = cx + 'px'; els.idcfCross.hidden = false; }
}

function onChartLeave() {
  if (els.idcfTip) els.idcfTip.hidden = true;
  if (els.idcfCross) els.idcfCross.hidden = true;
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
  const isBankIns = isBankOrInsurance(data.sector, data.industry, data.ticker);
  if (isBankIns || valuationModel === 'ddm' || valuationModel === 'reit' || valuationModel === 'airline' || !data.totalRevenue) {
    els.breakevenCallout.hidden = true; return;
  }
  const fcf = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures, data.annualFcf).value;
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

// ── Pressure test (P62) ───────────────────────────────────────────────────
// "What would have to be true?" The visitor picks a value today or a yearly return; each box is the one Base input
// (solveLever, calc/pressureTest.js) that gets there with every other input held at the page's Base case.

let ptMode = 'value';   // 'value' | 'return'
let ptTarget = null;    // number typed or chosen; null = the mode's default (today's price / 10%)
const PT_RETURN_CHIPS = [5, 10, 15, 20];
const PT_VALUE_CHIPS = [[1, "Today's price"], [1.25, '+25%'], [1.5, '+50%'], [2, 'Double']];

function ptAvailable(scenarios) {
  if (!currentData || lastHeavyCapexValuation) return false;
  if (scenarios.some(s => s.normalised)) return false;
  const base = scenarios.find(s => s.key === 'base');
  return !!(base && base.result && base.result.intrinsicValue != null);
}

// Yearly-return mode needs a year-N value the levers can move. Excess Return's year-N value is book value alone (no
// terminal value), which ROE and the cost of equity don't change -- so value-today mode only, like REIT / airline.
function ptModeAllowed() { return valuationModel !== 'reit' && valuationModel !== 'airline' && valuationModel !== 'excess-return'; }

// { kind: 'value' | 'year-n', value, rate? } for the current mode, or null.
function ptCurrentTarget(data) {
  const price = data.price;
  if (ptMode === 'return' && ptModeAllowed()) {
    const r = ptTarget != null ? ptTarget : 10;
    const years = parseInt(els.yearsSlider.value, 10);
    if (!(price > 0) || !isFinite(r) || r <= -100) return null;
    return { kind: 'year-n', value: price * Math.pow(1 + r / 100, years), rate: r, years };
  }
  const v = ptTarget != null ? ptTarget : price;
  return isFinite(v) && v > 0 ? { kind: 'value', value: v } : null;
}

function ptMoney(v, sym) {
  if (v == null || !isFinite(v)) return '—';
  return Math.abs(v) >= 1e6 ? formatMarketCap(v, sym) : sym + v.toFixed(2);
}

function ptBoxHtml(label, needed, yours, context, pos) {
  const track = pos
    ? `<div class="idcf-pt-track" aria-hidden="true"><i class="idcf-pt-track-base" style="left:${pos.base}%"></i><i class="idcf-pt-track-need" style="left:${pos.need}%"></i></div>`
    : '';
  const body = needed == null
    ? '<div class="idcf-pt-none">No value in a sensible range gets there on its own.</div>'
    : `<div class="idcf-pt-need">${needed}</div><div class="idcf-pt-yours">Your Base: ${yours}</div>${track}${context ? `<div class="idcf-pt-ctx">${context}</div>` : ''}`;
  return `<div class="idcf-pt-box"><div class="idcf-pt-label">${label}</div>${body}</div>`;
}

function ptTrackPos(base, need) {
  if (!isFinite(base) || !isFinite(need)) return null;
  const lo = Math.min(base, need), hi = Math.max(base, need);
  const pad = (hi - lo) * 0.2 || Math.abs(hi) * 0.1 || 1;
  const at = v => (((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * 100).toFixed(1);
  return { base: at(base), need: at(need) };
}

function renderPressureTest(scenarios, data, sym) {
  const sec = els.idcfPt;
  if (!sec) return;
  if (!ptAvailable(scenarios)) { sec.hidden = true; return; }
  if (!ptModeAllowed()) ptMode = 'value';
  els.idcfPtModes.hidden = !ptModeAllowed();
  els.idcfPtModeValue.setAttribute('aria-pressed', String(ptMode === 'value'));
  els.idcfPtModeReturn.setAttribute('aria-pressed', String(ptMode === 'return'));
  els.idcfPtTargetLabel.textContent = ptMode === 'return' ? 'Yearly return %' : `Value per share (${sym || data.currency || ''})`;
  if (document.activeElement !== els.idcfPtTarget) {
    els.idcfPtTarget.value = ptTarget != null ? String(ptTarget) : (ptMode === 'return' ? '10' : (+data.price).toFixed(2));
  }
  els.idcfPtChips.innerHTML = ptMode === 'return'
    ? PT_RETURN_CHIPS.map(r => `<button type="button" class="idcf-pt-chip" data-v="${r}">${r}%</button>`).join('')
    : PT_VALUE_CHIPS.map(([k, l]) => `<button type="button" class="idcf-pt-chip" data-v="${k}">${l}</button>`).join('');

  const target = ptCurrentTarget(data);
  const base = scenarios.find(s => s.key === 'base');
  const years = parseInt(els.yearsSlider.value, 10);
  if (!target) { els.idcfPtLead.textContent = 'Enter a positive number to see what it would take.'; els.idcfPtBoxes.innerHTML = ''; sec.hidden = false; return; }

  const inp = scenarioInputs(data);
  const pathCtx = valuePathCtx(data);
  const year = target.kind === 'year-n' ? years : 0;
  let baseAtYear = base.result.intrinsicValue;
  if (year) {
    const p = valuePath(base, valuationModel, pathCtx);
    baseAtYear = p ? p[year] : null;
  }
  els.idcfPtLead.textContent = target.kind === 'year-n'
    ? `For ${target.rate.toFixed(1)}% a year over ${years} years from today's price, a share would need to be worth ${sym}${target.value.toFixed(2)} in year ${years} (your Base says ${baseAtYear == null ? '—' : sym + baseAtYear.toFixed(2)}). One of these would have to be true:`
    : `For one share to be worth ${sym}${target.value.toFixed(2)} today (your Base says ${sym}${base.result.intrinsicValue.toFixed(2)}), one of these would have to be true:`;

  const solve = lever => solveLever({ data, model: inp.model, seeds: inp.seeds, options: inp.options, lever, target: target.value, year, pathCtx });
  const m = valuationModel;
  const pct = (v, d) => (+v).toFixed(d) + '%';
  const boxes = [];
  for (const lever of PT_LEVERS[m] || []) {
    const ans = solve(lever);
    if (lever === 'growth') {
      const label = m === 'ddm' ? 'Dividend growth a year' : m === 'excess-return' ? 'Return on equity' : 'FCF growth a year';
      const b = inp.seeds.growth.base;
      const fmtG = v => (m === 'excess-return' ? pct(v, 1) : pct(v, 1) + ' a year');
      let ctx = '';
      if (m === 'dcf') {
        const rc = seriesCagr(data.annualRevenueHistory);
        if (rc != null && isFinite(rc)) ctx = `Revenue grew ${(rc >= 0 ? '+' : '−') + Math.abs(rc * 100).toFixed(1)}% a year recently.`;
      }
      boxes.push(ptBoxHtml(label, ans == null ? null : fmtG(ans), fmtG(b), ctx, ans == null ? null : ptTrackPos(b, ans)));
    } else if (lever === 'discount') {
      const label = (m === 'ddm' || m === 'excess-return') ? 'Cost of equity' : 'WACC';
      const b = inp.seeds.discount.base;
      let ctx = '';
      if (ans != null) {
        const beta = impliedBetaForDiscount(ans);
        if (beta != null && isFinite(beta)) ctx = `That implies a beta of about ${beta.toFixed(2)} (this stock's: ${stockEffectiveBeta().toFixed(2)}).`;
      }
      boxes.push(ptBoxHtml(label, ans == null ? null : pct(ans, 2), pct(b, 2), ctx, ans == null ? null : ptTrackPos(b, ans)));
    } else if (lever === 'multiple') {
      const label = m === 'reit' ? 'P/AFFO multiple' : 'EV/EBITDA multiple';
      const b = inp.seeds.multiple.base;
      const x = v => (+v).toFixed(1) + '×';
      boxes.push(ptBoxHtml(label, ans == null ? null : x(ans), x(b), '', ans == null ? null : ptTrackPos(b, ans)));
    } else {
      const label = { dcf: 'Starting free cash flow', ddm: 'Starting dividend per share', 'excess-return': 'Book value per share', reit: 'AFFO per share', airline: 'EBITDA' }[m];
      const cur = m === 'dcf'
        ? ((inp.options.fcfRaw > 0) ? inp.options.fcfRaw : inp.options.normFcf)
        : { ddm: inp.seeds.dividend, 'excess-return': inp.seeds.bookValue, reit: inp.seeds.affoPerShare, airline: inp.seeds.ebitda }[m];
      let ctx = '';
      if (ans != null && cur > 0) {
        const d = (ans / cur - 1) * 100;
        ctx = `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(0)}% vs the figure used${lastAssumptions && lastAssumptions.fcfInfo && lastAssumptions.fcfInfo.method === 'normalized' && m === 'dcf' ? ' (normalised)' : ''}.`;
      }
      boxes.push(ptBoxHtml(label, ans == null ? null : ptMoney(ans, sym), ptMoney(cur, sym), ctx, ans == null ? null : ptTrackPos(cur, ans)));
    }
  }
  els.idcfPtBoxes.innerHTML = boxes.join('');
  sec.hidden = false;
}

function onPtMode(mode) {
  if (mode === ptMode) return;
  ptMode = mode;
  ptTarget = null;
  els.idcfPtTarget.value = '';
  scheduleRecompute(true);
}

function onPtTargetInput() {
  const v = parseFloat(String(els.idcfPtTarget.value).replace(/[,$\s%]/g, ''));
  ptTarget = isFinite(v) ? v : null;
  scheduleRecompute(false);
}

function onPtChip(e) {
  const t = (e.target && e.target.closest && e.target.closest('[data-v]')) || e.target;
  const raw = t && t.dataset ? t.dataset.v : null;
  if (raw == null || !currentData) return;
  const k = parseFloat(raw);
  if (!isFinite(k)) return;
  ptTarget = ptMode === 'return' ? k : +(currentData.price * k).toFixed(2);
  els.idcfPtTarget.value = ptMode === 'return' ? String(k) : ptTarget.toFixed(2);
  scheduleRecompute(true);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function setLoading(on) { ctl.setLoading(on); }

function showError(msg) {
  els.status.textContent = msg;
  els.status.className   = 'status error';
  els.status.hidden      = false;
}

function hideResults() {
  [els.summary, els.finWarning, els.breakevenCallout, els.scenarios, els.disclaimer, els.idcfChart, els.howDcf, els.howDdm, els.layout]
    .forEach(el => { if (el) el.hidden = true; });
  els.status.hidden = true;
  const growthSuggestion = document.getElementById('growthSuggestion');
  if (growthSuggestion) growthSuggestion.innerHTML = '';
  if (isNative) updateWatchlistStar(null, null);
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
// Reads /history's last daily close, NOT quoteSummary's summaryDetail chain --
// switched 2026-09-11 after finding quoteSummary's previousClose stuck a
// day-plus stale (4.837 vs /history's real 4.944) during a live global bond
// selloff, the same class of bug already fixed for fetchIndexPrice in
// DCFAnalysis's rf.js (2026-07-31, index tickers). See docs/risk-free-rates.md.
// Re-derive WACC (DCF) or cost of equity (DDM) from current RF + ERP inputs,
// update the scenario discount inputs and breakdown panel, then re-render.
// Called whenever the user edits the RF or ERP fields.
function resetRfErp() {
  const seed = rfErpForMarket(currentMarket);
  els.rfInput.value  = seed.rf;
  els.erpInput.value = seed.erp;
  recomputeDiscount();
  // Through onInputsEdited, not renderAll: the sliders and the "Your numbers" chip must follow the boxes, or the
  // next slider move writes the old discount back.
  if (currentData) onInputsEdited(true);
}

// The Base discount rate (percent, 2dp) one beta gives at the current RF / ERP boxes: CAPM cost of equity for
// DDM / Excess Return, the WACC for DCF (pure CAPM when there is no capital-structure data). No DOM writes.
function discountForBeta(effectiveBeta) {
  const rf  = parseFloat(els.rfInput.value)  / 100 || 0.045;
  const erp = parseFloat(els.erpInput.value) / 100 || 0.055;
  const re = rf + effectiveBeta * erp;
  if (valuationModel === 'ddm' || valuationModel === 'excess-return') {
    return { pct: +(re * 100).toFixed(2), rf, erp, re, waccResult: null };
  }
  const waccResult = calculateWACC({
    marketCap:       currentData.marketCap,
    totalDebt:       currentData.totalDebt,
    beta:            effectiveBeta,
    interestExpense: currentData.interestExpense,
    taxRate:         currentData.taxRate,
    ebit:            currentData.ebit,
    riskFreeRate:    rf,
    erp,
  });
  return waccResult
    ? { pct: +(waccResult.wacc * 100).toFixed(2), rf, erp, re, waccResult }
    : { pct: +(re * 100).toFixed(2), rf, erp, re, waccResult: null };
}

// Re-derive the discount rates from the RF / ERP boxes with the selected beta (this stock's or the industry's).
// A discount rate the visitor set themselves (beta 'custom') is left as it is.
function recomputeDiscount() {
  if (!currentData) return;
  if (pageState && pageState.beta === 'custom') { renderDiscountBreakdown(); return; }
  const rawBeta = (currentData.beta != null && isFinite(currentData.beta) && currentData.beta > 0)
    ? currentData.beta : 1.0;
  const effectiveBeta = selectedBeta();
  const betaWasFloored = effectiveBeta > rawBeta && !(pageState && pageState.beta === 'industry');
  const d = discountForBeta(effectiveBeta);
  els.waccBase.value = d.pct;
  els.waccBear.value = +(d.pct + 1).toFixed(2);
  els.waccBull.value = +(Math.max(1, d.pct - 1)).toFixed(2);
  // A DCF whose WACC can no longer be computed must not keep the old one (it would feed a stale implied beta).
  if (valuationModel === 'dcf') lastWaccResult = d.waccResult;
  else if (d.waccResult) lastWaccResult = d.waccResult;
  if (d.waccResult || valuationModel === 'ddm' || valuationModel === 'excess-return') {
    lastCapm = { re: d.re, rf: d.rf, erp: d.erp, beta: effectiveBeta, rawBeta, betaWasFloored };
  }
  renderDiscountBreakdown();
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
    aus: { badge: '○ fixed',    note: 'Fixed estimate — no live Australian bond-yield source available', title: 'Australian 10-yr Govt Bond yield (fixed estimate, not live)' },
    ind: { badge: '○ fixed',    note: 'Fixed estimate — Indian 10-yr Govt Bond yield minus India’s default spread; no live source available', title: 'Indian 10-yr Govt Bond yield, adjusted for India’s sovereign default spread (Damodaran convention; fixed estimate, not live)' },
    kor: { badge: '○ fixed',    note: 'Fixed estimate — no live Korean bond-yield source available', title: 'Korea 10-yr Govt Bond yield (fixed estimate, not live)' },
    jpn: { badge: '○ fixed',    note: 'Fixed estimate — no live Japanese bond-yield source available', title: 'Japan 10-yr Govt Bond (JGB) yield (fixed estimate, not live)' },
    uk:  { badge: '○ fixed',    note: 'Fixed estimate — UK 10-yr Gilt yield minus the UK default spread; no live source available', title: 'UK 10-yr Gilt yield, adjusted for the UK sovereign default spread (Damodaran convention; fixed estimate, not live)' },
    eu:  { badge: '○ fixed',    note: 'Fixed estimate — no live eurozone Bund-yield source available', title: 'Eurozone 10-yr Bund yield (fixed estimate, not live)' },
    fr:  { badge: '○ fixed',    note: 'Fixed estimate — the euro risk-free rate (German Bund); France’s own risk is in the ERP', title: 'Euro risk-free rate: German 10-yr Bund yield (fixed estimate, not live). France’s extra risk is in its equity risk premium (Damodaran convention)' },
    hk:  { badge: '○ fixed',    note: 'Fixed estimate — Hong Kong 10-yr yield minus the HK default spread; no live source available', title: 'Hong Kong 10-yr Exchange Fund Note yield, adjusted for the Hong Kong sovereign default spread (Damodaran convention; fixed estimate, not live)' },
    cn:  { badge: '○ fixed',    note: 'Fixed estimate — no live China Govt bond-yield source available', title: 'China 10-yr Govt Bond yield (fixed estimate, not live)' },
    br:  { badge: '○ fixed',    note: 'Fixed estimate — Brazil 10-yr govt bond yield minus Brazil’s default spread; no live source available', title: 'Brazil 10-yr govt bond yield, adjusted for Brazil’s sovereign default spread (Damodaran convention; fixed estimate, not live)' },
    us:  { badge: '● live',     note: 'US 10-yr Treasury yield (^TNX), minus the US default spread', title: 'Live US 10-yr Treasury yield, adjusted for the US sovereign default spread (Damodaran convention)' },
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

async function fetchSectorMarginLookup() {
  try {
    const resp = await fetch('/dcf/sector-margins.json');
    if (!resp.ok) return;
    sectorMarginLookup = await resp.json();
  } catch (_) {
    // silently keep the {} default -- same graceful-degradation posture as
    // every other consumer of this file (see the design spec's Error
    // handling section)
  }
}

// Fetches worker-watchlist's /rates table and applies it through assumptions.js's applyWorkerRates() -- the one
// shared applier every surface uses, so web /dcf/, /evaluate/ and both native shells value a ticker on the same
// table (native-compare alignment, 2026-10-21; a rate fix reaches installed apps without a release). Runs on web
// and native. Ignored once the first valuation has started (ratesClosed). On any failure (offline, Worker down,
// unexpected shape), silently keeps using the bundled static FALLBACK_RF/MARKET_ERP tables.
async function fetchWorkerRates() {
  try {
    // Hardcoded URL, not WATCHLIST_API: that's a `var` inside kv-watchlist.js's IIFE, never
    // a global, so the old `typeof WATCHLIST_API === 'undefined'` guard returned early on
    // every native load and this fetch never ran (found 2026-10-01).
    const resp = await fetch(WORKER_RATES_URL);
    if (!resp.ok) throw new Error('not ok');
    const body = await resp.json();
    if (!ratesClosed && applyWorkerRates(body)) {
      workerRates = { FALLBACK_RF: { ...FALLBACK_RF }, MARKET_ERP: { ...MARKET_ERP } };
      resetRfErp();
    }
  } catch (_) {
    // silently keep using the bundled static tables
  }
}

// The shared live US risk-free rate from worker-watchlist's /rates (live.us.rf, a fraction: the 10Y yield less the
// US default spread; live.us.value stays the raw yield) as a percent rounded to 2dp, or null on any failure /
// implausible value. This is the single value /evaluate/, the native app and the Watchlist backend also use, so
// every surface values a US ticker on the same rate (docs/risk-free-rates.md, "Live US rate"). An older Worker
// without `.rf` returns null here (never fall back to the raw `.value`). Bounds mirror the Worker's own check
// (0.5%-15%) as defence in depth.
async function fetchSharedUsRatePct() {
  try {
    const resp = await fetch(WORKER_RATES_URL);
    if (!resp.ok) return null;
    const v = (await resp.json())?.live?.us?.rf;
    return (typeof v === 'number' && isFinite(v) && v >= 0.005 && v <= 0.15) ? +(v * 100).toFixed(2) : null;
  } catch (_) {
    return null;
  }
}

async function fetchAndSetRiskFreeRate() {
  try {
    // Prefer the shared value; if /rates is down or has no live value, fall back to fetching ^TNX directly,
    // exactly as this tool always did (degraded mode: may differ from the other surfaces by a cent or so).
    let pct = await fetchSharedUsRatePct();
    if (pct == null) {
      const period2 = Math.floor(Date.now() / 1000);
      const period1 = period2 - 10 * 24 * 60 * 60; // 10 days back -- crosses any weekend/holiday gap
      const url = `${CONFIG.YAHOO_PROXY_URL.replace(/\/$/, '')}/history/${encodeURIComponent('^TNX')}` +
        `?period1=${period1}&period2=${period2}`;
      const resp = await fetch(url);
      if (!resp.ok) return;
      const body = await resp.json();
      const raw = Array.isArray(body) && body.length ? body[body.length - 1]?.close : null; // ascending by date -- last entry is most recent
      // Raw yield -> risk-free rate: less the US default spread, like every other path (usRiskFreeFromYield, assumptions.js).
      if (raw != null && isFinite(raw) && raw > 0 && raw < 20) pct = +(usRiskFreeFromYield(+raw.toFixed(2) / 100) * 100).toFixed(2);
    }
    if (pct != null && !ratesClosed) {
      liveRfRate = pct;
      // deriveDcfAssumptions() seeds the first Bear/Base/Bull from FALLBACK_RF.us, not from the box -- so without this the
      // box showed the live rate while the valuation used the static one (docs/TODO.md P36). /evaluate/ does the same
      // (it overlays live.us.rf onto FALLBACK_RF.us). Rounded to the decimal literal; a ticker analysed before this fetch
      // resolves keeps the static seed, as before.
      FALLBACK_RF.us = Math.round(pct * 100) / 10000;
      if (currentMarket === 'us' || currentMarket === 'other') {
        els.rfInput.value = liveRfRate;
        setRfBadge('us', liveRfRate);
      }
    }
  } catch (_) {
    // silently fall back to hardcoded 4.5%
  }
}

