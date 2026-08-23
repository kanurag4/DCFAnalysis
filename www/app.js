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
  sensitivity:      $('sensitivity'),
  sensitivityGrid:  $('sensitivity-grid'),
  howDcf:       $('how-dcf'),
  fcfInput:     $('fcf-input'),
  fcfSource:    $('fcf-source'),
  fcfNormRow:   $('fcf-normalized-row'),
  fcfNorm:      $('fcf-normalized'),
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
let liveRfRate    = 4.5;   // updated when US 10-yr Treasury is fetched
let liveAusRfRate = 4.8;   // updated when Australian 10-yr bond is fetched; 4.8% default
let liveIndRfRate = 4.9;   // updated when Indian 10-yr Govt bond is fetched (spread-adjusted); 4.9% default
// Korea: no live 10-yr KTB yield ticker exists on Yahoo (see docs/japan-korea-market-research.md
// in the source repo) — these are fixed, never overwritten by a fetch.
// rf corrected 2026-08-15: 4.3 was the raw KTB yield, which double-counts country risk
// the same way India's raw G-Sec yield did (erp already carries it). Korea is Aa2-rated,
// 0.42% default spread (Damodaran, Jan 2026) -> 4.29% spot (Aug 2026) - 0.42% ~= 3.9.
// TGROWTH unchanged: 1.75 against the corrected 3.9 rf is a ~45% ratio, already in the
// same ~40-57% band every other market here uses.
const KOR_RF      = 3.9;
const KOR_ERP     = 7.5;
const KOR_TGROWTH = 1.75;  // vs the tool's 2.5% default — see the "About the Korea numbers" panel
// Japan: same situation as Korea — no live 10-yr JGB yield ticker exists on Yahoo
// (see docs/japan-korea-market-research.md in the source repo) — fixed, never fetched.
// rf corrected 2026-08-15: 2.8 was the raw JGB yield -- Japan is A1-rated, 0.60% default
// spread (Damodaran, Jan 2026) -> 2.84 spot (Aug 2026) - 0.60 ~= 2.2. TGROWTH lowered
// 1.5->1.2 too: against the old 2.8 rf, 1.5 was a 54% ratio (in-band); against the
// corrected 2.2 it would drift to 68%, out of the ~40-57% band -- 1.2 restores ~55%.
// Not a ceiling violation either way (1.5 < 2.2), just internal-consistency.
const JPN_RF      = 2.2;   // post-deflation JGB regime, spread-adjusted (was 2.8 raw)
const JPN_ERP     = 6.0;   // developed-market tier (~AUS level)
const JPN_TGROWTH = 1.2;   // vs the tool's 2.5% default — see the "About the Japan numbers" panel
// UK/eurozone: same "no live source" situation as Korea/Japan — no live 10-yr Gilt/Bund
// yield ticker exists on Yahoo. Mirrors scripts/lib/market.js's .L / eurozone-suffix
// branches in the DCFAnalysis batch repo (spot-checked against real yields 2026-08-03) —
// these are two independent hand-synced implementations, same drift warning as Korea/Japan.
const UK_RF       = 5.0;   // UK Gilt-proxy
const UK_ERP      = 6.0;   // near-US-tier developed market
const UK_TGROWTH  = 2.0;
// EUROZONE_SUFFIXES moved to calc/assumptions.js's detectMarket() — this
// file's own market-detection chain (which used to reference it here) was
// replaced by deriveDcfAssumptions() in the 2026-08-13 pure-extraction
// refactor. A duplicate const of the same name in both <script>-loaded
// files is a fatal SyntaxError (classic scripts share one top-level
// lexical scope), not just dead-code duplication — don't re-add this here.
const EU_RF       = 3.2;   // eurozone Bund-proxy
const EU_ERP      = 5.5;
const EU_TGROWTH  = 1.8;
// Hong Kong (.HK): same "no live source" situation as Korea/Japan/UK/eurozone — no live
// 10-yr HK Exchange Fund Note yield ticker exists on Yahoo — fixed, never fetched.
// Unlike every other market seed in this tool, the ERP here is NOT backed by a clean,
// current Damodaran country-risk figure specifically for Hong Kong (checked 2026-08-10) —
// set at developed-market tier (same as UK/Japan) as a best estimate. Flagged explicitly
// to the user in hkInfoBlock() rather than presented with false precision.
const HK_RF       = 3.5;
const HK_ERP      = 6.0;
const HK_TGROWTH  = 2.0;
// China A-shares (.SS Shanghai / .SZ Shenzhen): same "no live source" situation — no live
// 10-yr China Govt bond yield ticker exists on Yahoo — fixed, never fetched. RF/ERP sourced
// from Damodaran's country-risk dataset (checked 2026-08-10). Distinct from Hong Kong (.HK)
// above — different currency (CNY vs HKD) and a different risk profile.
// rf corrected 2026-08-15: 1.7 was the raw CNY govt bond yield -- same double-counting
// issue as India/Japan/Korea, and proportionally the largest of the four, since China's
// default spread (A1-rated, 0.60%, Damodaran Jan 2026) is a big chunk of its already-tiny
// base yield: 1.70 spot (Aug 2026) - 0.60 ~= 1.1.
const CHINA_RF      = 1.1;
const CHINA_ERP     = 5.2;
// Was 2.5 (the tool's US-tier default) until 2026-08-11 — that broke Damodaran's
// stable-growth ceiling (terminal growth can't exceed the risk-free rate proxy for
// long-run nominal economy growth) against China's own CHINA_RF above it. Lowered to
// sit under CHINA_RF like every other market's *_TGROWTH does relative to its own
// *_RF — see chinaInfoBlock() and the new renderTerminalGrowthWarning() check below,
// which now flags this same violation live for any market/scenario a user edits into.
// Lowered AGAIN 2026-08-15, forced by the CHINA_RF correction above: the old 1.5 now
// exceeds the new 1.1 rf outright (a fresh ceiling violation the moment rf moved under
// it), and picking a value that just barely clears the new ceiling would leave China as
// an outlier again -- 0.6 is a ~55% ratio to the new rf, back in the ~40-57% band every
// other market here uses.
const CHINA_TGROWTH = 0.6;
let currentMarket = 'us';  // 'us' | 'aus' | 'ind' | 'kor' | 'jpn' | 'uk' | 'eu' | 'hk' | 'cn' | 'other'
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
// Populated by renderScenarios() from the base-case scenario card — the
// data behind the Share button. null whenever there's no valid base-case
// verdict to share (e.g. WACC < terminal growth, missing FCF/dividend).
let shareInfo = null;

// ── Init ──────────────────────────────────────────────────────────────────

els.yearsSlider.addEventListener('input', () => {
  els.yearsDisplay.textContent = els.yearsSlider.value;
  if (currentData) renderAll(currentData);
});

els.recalcBtn.addEventListener('click', onRecalc);
if (els.ddmToggle) els.ddmToggle.addEventListener('click', onToggleModel);
if (els.midyearToggle) els.midyearToggle.addEventListener('change', () => { if (currentData) renderAll(currentData); });
if (els.multistageToggle) els.multistageToggle.addEventListener('change', () => { if (currentData) renderAll(currentData); });
if (shareBtn) shareBtn.addEventListener('click', onShareClick);

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
    const data = await fetchDCFData(req.symbol, isASX, '', '', CONFIG.YAHOO_PROXY_URL);
    currentData = data;
    prefillInputs(data);
    renderAll(data);
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

function onRecalc() {
  if (!currentData) return;
  renderAll(currentData);
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
  const assumptions = deriveDcfAssumptions(data);
  const isBankIns = assumptions.isBankIns;
  const isReitTicker = assumptions.isReit;
  valuationModel = assumptions.valuationModel;
  currentMarket = assumptions.currentMarket;

  // ── Market detection — still drives the RF/ERP input values and the
  // "About the X numbers" panel, both DOM-only concerns that stay here ──
  if (currentMarket === 'aus') {
    els.rfInput.value  = liveAusRfRate;
    els.erpInput.value = 6.0;
    setRfBadge('aus', liveAusRfRate);   // immediate — async fetch may refine the value
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Australian MRP (5.5–6.5%)'; els.erpMarketNote.hidden = false; }
    fetchAndSetAustralianRfRate();
  } else if (currentMarket === 'ind') {
    els.rfInput.value  = liveIndRfRate;
    els.erpInput.value = 7.5;
    setRfBadge('ind', liveIndRfRate);   // immediate — async fetch may refine the value
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Indian MRP (7.0–9.0%)'; els.erpMarketNote.hidden = false; }
    fetchAndSetIndianRfRate();
  } else if (currentMarket === 'kor') {
    els.rfInput.value  = KOR_RF;
    els.erpInput.value = KOR_ERP;
    setRfBadge('kor', KOR_RF);   // fixed estimate — no live source exists, see setRfBadge's 'kor' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Korean MRP incl. governance-risk premium (7.5%)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — Korea has no live rate source to fetch.
  } else if (currentMarket === 'jpn') {
    els.rfInput.value  = JPN_RF;
    els.erpInput.value = JPN_ERP;
    setRfBadge('jpn', JPN_RF);   // fixed estimate — no live source exists, see setRfBadge's 'jpn' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Japanese MRP (5.5–6.5%)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — Japan has no live rate source to fetch.
  } else if (currentMarket === 'uk') {
    els.rfInput.value  = UK_RF;
    els.erpInput.value = UK_ERP;
    setRfBadge('uk', UK_RF);   // fixed estimate — no live source exists, see setRfBadge's 'uk' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'UK MRP (near-US developed-market tier)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — UK has no live rate source to fetch.
  } else if (currentMarket === 'eu') {
    els.rfInput.value  = EU_RF;
    els.erpInput.value = EU_ERP;
    setRfBadge('eu', EU_RF);   // fixed estimate — no live source exists, see setRfBadge's 'eu' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Eurozone MRP (developed-market tier)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — eurozone has no live rate source to fetch.
  } else if (currentMarket === 'hk') {
    els.rfInput.value  = HK_RF;
    els.erpInput.value = HK_ERP;
    setRfBadge('hk', HK_RF);   // fixed estimate — no live source exists, see setRfBadge's 'hk' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'Hong Kong MRP — rougher estimate than other markets, see "About the Hong Kong numbers"'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — Hong Kong has no live rate source to fetch.
  } else if (currentMarket === 'cn') {
    els.rfInput.value  = CHINA_RF;
    els.erpInput.value = CHINA_ERP;
    setRfBadge('cn', CHINA_RF);   // fixed estimate — no live source exists, see setRfBadge's 'cn' label
    if (els.erpMarketNote) { els.erpMarketNote.textContent = 'China A-share MRP (Damodaran country-risk estimate)'; els.erpMarketNote.hidden = false; }
    // No fetchAndSet*RfRate() call — China has no live rate source to fetch.
  } else {
    els.rfInput.value  = liveRfRate;
    els.erpInput.value = 5.5;
    setRfBadge('us', liveRfRate);
    if (els.erpMarketNote) els.erpMarketNote.hidden = true;
  }

  // ── FCF (DCF) — DOM display only; the value itself came from assumptions.fcfInfo ──
  const fcfInfo = assumptions.fcfInfo;
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
    } else if (fcfInfo.method === 'annual') {
      els.fcfSource.textContent = '≈ latest annual (TTM n/a)';
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
  // Gated to valuationModel === 'dcf': REIT/Airline/DDM/Excess-Return tickers
  // already got routed to a model built for their negative-or-distorted FCF
  // (e.g. airlines use EV/EBITDA precisely because trailing FCF is unreliable
  // for them) — pointing those to the Growth tool on top of that is wrong,
  // not a fallback (seen live on QAN.AX after the 2026-08-20 Airline model
  // shipped, since this check never looked at which model was selected).
  renderGrowthSuggestion(data, valuationModel === 'dcf' && (fcf === null || fcf < 0));

  // Target FCF margin (revenue normalisation) — shown for negative/null FCF non-bank stocks
  const showTargetMargin = !isBankIns && !isReitTicker && (isFcfNegative || fcf === null) && data.totalRevenue > 0;
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
  updateModelToggle(isBankIns, isReitTicker, isAirlineTicker);
}

function updateModelToggle(isBankIns, isReitTicker, isAirlineTicker) {
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
       <p><strong>Governance risk premium:</strong> Korea's equity risk premium is set to 7.5% (vs 5.5% for the US), partly reflecting a premium institutional investors typically add for Korean equities given historically weaker minority-shareholder protections.</p>
       <p><strong>Static risk-free rate:</strong> fixed at ~3.9% — Korea's approximate 10-year government bond yield (~4.3%), minus Korea's ~0.42% sovereign default spread (Damodaran convention: the raw bond yield already prices in Korea's own default risk, which the equity risk premium above separately accounts for — using both would double-count it). Not live — no accessible Yahoo Finance data source exists for this rate.</p>
       <p><strong>Lower terminal growth assumption:</strong> 1.75% vs the tool's 2.5% default, reflecting Korea's structurally lower long-run growth expectations.</p>
     </details>`;
}

// Informational-only panel explaining the Japan-specific seeds — same collapsible
// pattern as the Korea panel. Shared by both the DCF and DDM breakdown renderers.
function japanInfoBlock() {
  if (currentMarket !== 'jpn') return '';
  return `<details class="wacc-franking">
       <summary>About the Japan numbers</summary>
       <p><strong>Risk-free rate:</strong> fixed at ~2.2% — Japan's approximate 10-year government bond yield (~2.8%, a 30-year high as the BOJ exits deflation-era policy), minus Japan's ~0.60% sovereign default spread (Damodaran convention: the raw bond yield already prices in Japan's own default risk, which the equity risk premium above separately accounts for — using both would double-count it). Not live — no accessible Yahoo Finance data source exists for this rate.</p>
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
       <p><strong>Risk-free rate:</strong> fixed at ~5.0% (an approximate UK 10-year Gilt yield). Not live — no accessible Yahoo Finance data source exists for this rate; re-checked periodically against real Gilt yields, so treat as a point-in-time estimate.</p>
       <p><strong>Equity risk premium:</strong> 6.0%, near-US tier — a mature, liquid developed market.</p>
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
       <p><strong>Risk-free rate:</strong> fixed at ~3.2% (an approximate German 10-year Bund yield, used as the eurozone-wide proxy). Not live — no accessible Yahoo Finance data source exists for this rate; re-checked periodically against real Bund yields, so treat as a point-in-time estimate.</p>
       <p><strong>Equity risk premium:</strong> 5.5%, same tier as the US default.</p>
       <p><strong>Terminal growth:</strong> 1.8% vs the tool's 2.5% US default, reflecting the eurozone's somewhat lower long-run nominal growth expectations.</p>
       <p><strong>One rate for every eurozone exchange:</strong> Germany, France, Netherlands, Italy, Spain, Belgium, Portugal, Austria, Finland, and Ireland all share this seed — it's a market-wide estimate, not a country-specific one, matching how every other market in this tool gets a single seed regardless of which exchange within it a ticker trades on.</p>
     </details>`;
}

// Informational-only panel explaining the Hong Kong-specific seeds — same collapsible
// pattern as the Korea/Japan/UK/eurozone panels. Shared by both the DCF and DDM breakdown renderers.
function hkInfoBlock() {
  if (currentMarket !== 'hk') return '';
  return `<details class="wacc-franking">
       <summary>About the Hong Kong numbers</summary>
       <p><strong>Risk-free rate:</strong> fixed at ~3.5% (an approximate Hong Kong 10-year Exchange Fund Note yield). Not live — no accessible Yahoo Finance data source exists for this rate; re-checked periodically, so treat as a point-in-time estimate.</p>
       <p><strong>Equity risk premium:</strong> 6.0%, developed-market tier (same as UK/Japan). <strong>Unlike every other market seed in this tool, this figure is not backed by a clean, current Damodaran country-risk number specifically for Hong Kong</strong> — treat it as a rougher estimate than the other market ERPs, and adjust manually if you have a better source.</p>
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
       <p><strong>Risk-free rate:</strong> fixed at ~1.1% — an approximate China 10-year Govt bond yield (~1.7%), minus China's ~0.60% sovereign default spread (Damodaran convention: the raw bond yield already prices in China's own default risk, which the equity risk premium below separately accounts for — using both would double-count it). Not live — no accessible Yahoo Finance data source exists for this rate; re-checked periodically, so treat as a point-in-time estimate.</p>
       <p><strong>Equity risk premium:</strong> 5.2% (Damodaran country-risk-adjusted estimate for China), reflecting the lower risk-free rate together with China-specific market and political risk.</p>
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
  if (currentData) renderAll(currentData);
}

// ── Render all ────────────────────────────────────────────────────────────

function renderAll(data) {
  const sym = CURRENCY_SYMBOLS[data.currency] ?? '';
  renderSummary(data, sym);
  renderFinancialWarning(data, sym);
  const scenarios = buildScenarios(data);
  renderTerminalGrowthWarning(scenarios);
  renderBreakeven(data, sym);
  renderScenarios(scenarios, data, sym);
  renderCharts(scenarios, data.price, sym);
  renderSensitivityGrid(buildSensitivityGrid(data), data.price, sym);
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

// Sensitivity grid: intrinsic value across a 5×5 discount-rate × terminal-
// growth grid, holding the Base scenario's growth rate and projection years
// fixed. Unlike Bear/Base/Bull (which move growth, terminal growth, and
// discount rate together), this isolates exactly one axis per cell.
function buildSensitivityGrid(data) {
  // Excess Return Model has no terminal-growth axis (see the design's "no terminal
  // value" decision) -- there's nothing for this discount-rate × terminal-growth
  // grid to vary on the second axis, so the section is hidden entirely rather than
  // reusing DDM's dividend-based math (which would read stale/hidden dividend-input
  // state left over from a previously-viewed ticker and silently show wrong numbers).
  if (valuationModel === 'excess-return' || valuationModel === 'reit' || valuationModel === 'airline') return null;

  const years = parseInt(els.yearsSlider.value, 10);
  const ddm = valuationModel === 'ddm';

  const baseDiscount = parseFloat(els.waccBase.value) / 100;
  const baseTGrowth  = parseFloat(els.tgrowthBase.value) / 100;
  if (!isFinite(baseDiscount) || !isFinite(baseTGrowth)) return null;

  const discountStep = 0.005;  // 0.5pp
  const tgrowthStep  = 0.0025; // 0.25pp
  const discountRates = [-2, -1, 0, 1, 2].map(n => baseDiscount + n * discountStep);
  const tgrowthRates  = [-2, -1, 0, 1, 2].map(n => baseTGrowth + n * tgrowthStep);
  const useMidYear = !!(els.midyearToggle && els.midyearToggle.checked);

  if (ddm) {
    const dividend = els.dividendInput
      ? parseFloat(String(els.dividendInput.value).replace(/,/g, ''))
      : NaN;
    if (!(dividend > 0)) return null;
    const growthRate = parseFloat(els.growthBase.value) / 100 || 0;
    const rows = discountRates.map(costOfEquity => tgrowthRates.map(terminalGrowth => {
      if (costOfEquity <= terminalGrowth) return null;
      const r = calculateDDM({ dividend, growthRate, terminalGrowth, costOfEquity, projectionYears: years, currentPrice: data.price, midYear: useMidYear });
      return r ? r.intrinsicValue : null;
    }));
    return { rows, discountRates, tgrowthRates, baseDiscount, baseTGrowth };
  }

  const { fcfRaw, normFcf } = resolveDcfFcfInputs(data);
  const fcf = (fcfRaw !== null && fcfRaw > 0) ? fcfRaw : normFcf;
  if (fcf === null) return null;
  const growthRate = parseFloat(els.growthBase.value) / 100 || 0.05;
  const resolvedShares = (data.dilutedSharesOutstanding != null && data.dilutedSharesOutstanding > 0)
    ? data.dilutedSharesOutstanding : data.sharesOutstanding;

  const useMultiStage = !!(els.multistageToggle && els.multistageToggle.checked);
  const rows = discountRates.map(wacc => tgrowthRates.map(terminalGrowth => {
    if (wacc <= terminalGrowth) return null;
    const common = {
      terminalGrowth, wacc, projectionYears: years,
      totalDebt: data.totalDebt ?? 0, totalCash: data.totalCash ?? 0,
      sharesOutstanding: resolvedShares, currentPrice: data.price,
      midYear: useMidYear,
    };
    const r = useMultiStage
      ? calculateFadingGrowthDCF({ ...common, fcf, initialGrowth: growthRate })
      : calculateDCF({ ...common, fcf, growthRate });
    return r ? r.intrinsicValue : null;
  }));
  return { rows, discountRates, tgrowthRates, baseDiscount, baseTGrowth };
}

function renderSensitivityGrid(grid, currentPrice, sym) {
  if (!els.sensitivity || !els.sensitivityGrid) return;
  if (!grid) { els.sensitivity.hidden = true; return; }
  const { rows, discountRates, tgrowthRates, baseDiscount, baseTGrowth } = grid;
  const discountLabel = valuationModel === 'ddm' ? 'Cost of Equity' : 'WACC';

  const colHeaders = tgrowthRates.map(g => `<th>${(g * 100).toFixed(2)}%</th>`).join('');
  const bodyRows = rows.map((row, i) => {
    const isBaseRow = Math.abs(discountRates[i] - baseDiscount) < 1e-9;
    const cells = row.map((val, j) => {
      const isBaseCol = Math.abs(tgrowthRates[j] - baseTGrowth) < 1e-9;
      const isBaseCell = isBaseRow && isBaseCol;
      if (val === null) return `<td class="sens-na${isBaseCell ? ' sens-base' : ''}">—</td>`;
      const cls = val > (currentPrice ?? 0) ? 'sens-up' : 'sens-down';
      return `<td class="${cls}${isBaseCell ? ' sens-base' : ''}">${sym}${val.toFixed(2)}</td>`;
    }).join('');
    return `<tr><th>${(discountRates[i] * 100).toFixed(2)}%</th>${cells}</tr>`;
  }).join('');

  els.sensitivityGrid.innerHTML = `
    <table class="sensitivity-table">
      <thead><tr><th class="sens-corner">${discountLabel} \\ Terminal Growth</th>${colHeaders}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
  els.sensitivity.hidden = false;
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
function buildScenarios(data) {
  const years = parseInt(els.yearsSlider.value, 10);

  // ── REIT (property REITs, locked model) ──
  if (valuationModel === 'reit') {
    const affoPerShare = els.affoInput
      ? parseFloat(String(els.affoInput.value).replace(/,/g, ''))
      : NaN;
    const seeds = {
      affoPerShare: isFinite(affoPerShare) ? affoPerShare : null,
      multiple: { bear: parseFloat(els.growthBear.value) || 0, base: parseFloat(els.growthBase.value) || 0, bull: parseFloat(els.growthBull.value) || 0 }, // reuses the growth-bear/base/bull inputs, relabeled "P/AFFO Multiple" in applyModelUI()
    };
    return computeScenarios(data, 'reit', seeds, {});
  }

  // ── Airline (EV/EBITDA, locked model) ──
  if (valuationModel === 'airline') {
    const ebitda = els.ebitdaInput
      ? parseFloat(String(els.ebitdaInput.value).replace(/,/g, ''))
      : NaN;
    const seeds = {
      ebitda: isFinite(ebitda) ? ebitda : null,
      multiple: { bear: parseFloat(els.growthBear.value) || 0, base: parseFloat(els.growthBase.value) || 0, bull: parseFloat(els.growthBull.value) || 0 },
    };
    return computeScenarios(data, 'airline', seeds, {});
  }

  // ── DDM (banks/insurance, or user-toggled) ──
  if (valuationModel === 'ddm') {
    const dividend = els.dividendInput
      ? parseFloat(String(els.dividendInput.value).replace(/,/g, ''))
      : NaN;
    const seeds = {
      dividend,
      growth:   { bear: parseFloat(els.growthBear.value) || 0, base: parseFloat(els.growthBase.value) || 0, bull: parseFloat(els.growthBull.value) || 0 }, // 0% is a valid DDM case (flat dividend perpetuity)
      tgrowth:  { bear: parseFloat(els.tgrowthBear.value) || 2.5, base: parseFloat(els.tgrowthBase.value) || 2.5, bull: parseFloat(els.tgrowthBull.value) || 2.5 },
      discount: { bear: parseFloat(els.waccBear.value) || 9, base: parseFloat(els.waccBase.value) || 9, bull: parseFloat(els.waccBull.value) || 9 },
    };
    return computeScenarios(data, 'ddm', seeds, { years, useMidYear: !!(els.midyearToggle && els.midyearToggle.checked) });
  }

  // ── Excess Return Model (low-payout banks/insurers/NBFCs) ──
  if (valuationModel === 'excess-return') {
    const bookValue = els.bookvalueInput
      ? parseFloat(String(els.bookvalueInput.value).replace(/,/g, ''))
      : NaN;
    const seeds = {
      bookValue,
      growth:   { bear: parseFloat(els.growthBear.value) || 0, base: parseFloat(els.growthBase.value) || 0, bull: parseFloat(els.growthBull.value) || 0 }, // "growth" slot holds ROE
      discount: { bear: parseFloat(els.waccBear.value) || 9, base: parseFloat(els.waccBase.value) || 9, bull: parseFloat(els.waccBull.value) || 9 },
      // Book value compounding rate -- not user-editable (no UI field for it),
      // so re-derived from the same source data assumptions.js seeds it from.
      // NOT the ROE inputs above (fixed 2026-08-15, see calc/assumptions.js).
      bookValueGrowthPct: deriveDividendGrowth(data.earningsGrowth, data.revenueGrowth) * 100,
    };
    return computeScenarios(data, 'excess-return', seeds, { years, useMidYear: !!(els.midyearToggle && els.midyearToggle.checked) });
  }

  // ── DCF ──
  const { fcfRaw, normFcf } = resolveDcfFcfInputs(data);
  const seeds = {
    growth:   { bear: parseFloat(els.growthBear.value) || 5, base: parseFloat(els.growthBase.value) || 5, bull: parseFloat(els.growthBull.value) || 5 },
    tgrowth:  { bear: parseFloat(els.tgrowthBear.value) || 2.5, base: parseFloat(els.tgrowthBase.value) || 2.5, bull: parseFloat(els.tgrowthBull.value) || 2.5 },
    discount: { bear: parseFloat(els.waccBear.value) || 10, base: parseFloat(els.waccBase.value) || 10, bull: parseFloat(els.waccBull.value) || 10 },
  };
  return computeScenarios(data, 'dcf', seeds, {
    years,
    useMultiStage: !!(els.multistageToggle && els.multistageToggle.checked),
    useMidYear: !!(els.midyearToggle && els.midyearToggle.checked),
    fcfRaw, normFcf,
  });
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
  const url = shareInfo.url || (isNative
    ? 'https://kashvector.com/dcf/' + window.kvTickerInput.buildUrlQuery({ symbol: ticker, isAsx: currentMarket === 'aus', isNse: currentMarket === 'ind' })
    : location.href);

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

function renderScenarios(scenarios, data, sym) {
  let baseShareInfo = null;
  const cards = scenarios.map(({ key, result, fcfNegative, fcfMissing, noDividend, noBookValue, noAffo, normalised }) => {
    if (!result) {
      let msg;
      if (fcfMissing) {
        msg = 'Enter a Free Cash Flow value in the inputs panel to run the DCF.';
      } else if (noDividend) {
        msg = 'No dividend data available — the Dividend Discount Model needs a dividend. Enter an annual dividend per share in the inputs panel, or use the metrics above.';
      } else if (noBookValue) {
        msg = 'Enter a Book Value / Share in the inputs panel to run the Excess Return Model.';
      } else if (noAffo) {
        msg = 'Enter a positive AFFO / Share in the inputs panel to run the REIT model.';
      } else if (fcfNegative) {
        msg = isFinancialSector(currentData?.sector)
          ? 'Reported FCF is negative. Enter a positive Normalised FCF in the inputs panel to run the DCF.'
          : 'FCF is negative — DCF requires positive free cash flow. This company may not be suitable for DCF valuation.';
      } else if (valuationModel === 'excess-return') {
        // No terminal-growth concept in this model -- ROE/Cost of Equity must both be
        // positive for calculateExcessReturn() to return a value (see calc/excessReturn.js).
        msg = 'ROE and Cost of Equity must both be positive to run the Excess Return Model.';
      } else if (valuationModel === 'reit') {
        msg = 'Enter a positive P/AFFO Multiple in the inputs panel to run this model.';
      } else if (valuationModel === 'airline') {
        msg = 'Enter a positive EBITDA in the inputs panel to run this model.';
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

    const mos     = result.marginOfSafety;
    const verdict = deriveVerdict(mos);
    const mosClass = verdict === 'Undervalued' ? 'undervalued' : verdict === 'Overvalued' ? 'overvalued' : 'fair';
    const mosLabel = verdict === 'Undervalued' ? '✅ Undervalued' : verdict === 'Overvalued' ? '❌ Overvalued' : '⚠️ Fairly Valued';
    const mosPct   = (mos * 100).toFixed(1);

    if (key === 'base') {
      baseShareInfo = {
        name: data.name, ticker: data.ticker, sym,
        price: data.price, intrinsicValue: result.intrinsicValue,
        mosLabel, mosPct,
        url: null, // resolved async below, once/if a published ticker page is found
      };
    }

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
  const ivLabel = T('intrinsic-value', 'Intrinsic Value');
  const heading = isNormalised
    ? `${ivLabel} Estimate (${parseInt(els.yearsSlider.value, 10)}-yr · Revenue-normalised)`
    : `${ivLabel} Estimate (${parseInt(els.yearsSlider.value, 10)}-year forecast)`;
  els.scenarios.innerHTML = `<h3>${heading}</h3><div class="scenario-cards">${cards}</div>`;
  show(els.scenarios);

  shareInfo = baseShareInfo;
  updateShareButton();

  // Not awaited — renderScenarios() stays synchronous, and navigator.share()
  // (called from a later, separate click) must not be preceded by an
  // awaited fetch or some browsers reject it as no longer gesture-triggered.
  // The identity check discards a stale resolution if the user has already
  // re-analysed a different ticker by the time this resolves.
  if (baseShareInfo) {
    fetchTickerPageUrl(baseShareInfo.ticker, currentMarket).then(url => {
      if (url && shareInfo === baseShareInfo) shareInfo.url = url;
    });
  }
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

function renderCharts(scenarios, currentPrice, sym) {
  const labels = ['Bear', 'Base', 'Bull'];
  const excessReturn = valuationModel === 'excess-return';
  const noProjectionModel = excessReturn || valuationModel === 'reit' || valuationModel === 'airline'; // none of these have a per-year PV series or a terminal value

  // Terminal value warning — meaningless for Excess Return / REIT, neither
  // of which has a terminal value component (see calc/excessReturn.js,
  // calc/reit.js).
  if (noProjectionModel) {
    els.tvWarning.hidden = true;
  } else {
    const withResult = scenarios.filter(s => s.result);
    const maxTVPct = withResult.length ? Math.max(...withResult.map(s => s.result.terminalValuePct)) : 0;
    els.tvWarning.hidden = maxTVPct <= 70;
  }

  const ddm = valuationModel === 'ddm';
  const breakdownCard = $('breakdown-chart') ? $('breakdown-chart').closest('.chart-card') : null;

  // Chart 1: Stacked bar — near-term PV (green) + PV Terminal Value (orange).
  // Skipped for Excess Return Model and REIT — neither's result shape has
  // pvFcfs/pvDividends/pvTerminal fields to stack (see the comment above).
  if (noProjectionModel) {
    if (breakdownChart) { breakdownChart.destroy(); breakdownChart = null; }
    if (breakdownCard) breakdownCard.hidden = true;
  } else {
    if (breakdownCard) breakdownCard.hidden = false;
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
          legend: { labels: { color: '#7b8eaa', font: { size: 11 } } },
          datalabels: {
            color: '#fff',
            font: { size: 10, weight: 'bold' },
            formatter: (value) => value >= labelMin ? fmtBar(value) : '',
            anchor: 'center',
            align: 'center',
          },
        },
        scales: {
          x: { stacked: true, ticks: { color: '#7b8eaa' }, grid: { color: 'rgba(34,48,82,0.5)' } },
          y: {
            stacked: true,
            ticks: { color: '#7b8eaa', callback: v => fmtBar(v) },
            grid: { color: 'rgba(34,48,82,0.5)' },
            afterFit: scale => { scale.width = 72; },
          },
        },
      },
    });
  }

  // Chart 2: Horizontal bar — current price vs intrinsic values
  const intrinsics  = scenarios.map(s => s.result?.intrinsicValue ?? 0);
  const chartData   = [currentPrice ?? 0, ...intrinsics];
  const chartLabels = ['Current Price', 'Bear', 'Base', 'Bull'];
  const chartColors = [
    'rgba(147,160,189,0.8)',  // slate — current price
    'rgba(239,68,68,0.8)',    // red   — bear
    'rgba(251,191,36,0.8)',   // amber — base (matches --kv-accent)
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
          ticks: { color: '#7b8eaa', callback: v => `${sym}${v.toFixed(2)}` },
          grid: { color: 'rgba(34,48,82,0.5)' },
        },
        y: { ticks: { color: '#7b8eaa' }, grid: { display: false } },
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
  } else if (currentMarket === 'uk') {
    els.rfInput.value  = UK_RF;
    els.erpInput.value = UK_ERP;
  } else if (currentMarket === 'eu') {
    els.rfInput.value  = EU_RF;
    els.erpInput.value = EU_ERP;
  } else if (currentMarket === 'hk') {
    els.rfInput.value  = HK_RF;
    els.erpInput.value = HK_ERP;
  } else if (currentMarket === 'cn') {
    els.rfInput.value  = CHINA_RF;
    els.erpInput.value = CHINA_ERP;
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

  if (valuationModel === 'ddm' || valuationModel === 'excess-return') {
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
      ebit:            currentData.ebit,
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
    ind: { badge: '● live IND', note: 'Indian 10-yr Govt Bond, minus India’s sovereign default spread', title: 'Indian 10-yr Govt Bond yield, adjusted for India’s sovereign default spread (Damodaran convention)' },
    kor: { badge: '○ fixed',    note: 'Fixed estimate — no live Korean bond-yield source available', title: 'Korea 10-yr Govt Bond yield (fixed estimate, not live)' },
    jpn: { badge: '○ fixed',    note: 'Fixed estimate — no live Japanese bond-yield source available', title: 'Japan 10-yr Govt Bond (JGB) yield (fixed estimate, not live)' },
    uk:  { badge: '○ fixed',    note: 'Fixed estimate — no live UK Gilt-yield source available', title: 'UK 10-yr Gilt yield (fixed estimate, not live)' },
    eu:  { badge: '○ fixed',    note: 'Fixed estimate — no live eurozone Bund-yield source available', title: 'Eurozone 10-yr Bund yield (fixed estimate, not live)' },
    hk:  { badge: '○ fixed',    note: 'Fixed estimate — no live Hong Kong bond-yield source available', title: 'Hong Kong 10-yr Exchange Fund Note yield (fixed estimate, not live)' },
    cn:  { badge: '○ fixed',    note: 'Fixed estimate — no live China Govt bond-yield source available', title: 'China 10-yr Govt Bond yield (fixed estimate, not live)' },
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

// India (Baa3-rated) government bonds aren't riskfree the way US/AUS/UK govt bonds are --
// their yield already embeds India's own default risk. Damodaran's convention: riskfree
// rate = govt bond rate minus that country's default spread, since erp separately already
// carries India's country risk premium; using the raw yield double-counts it. 1.87% is
// Damodaran's Jan 2026 default spread for a Baa3 sovereign rating -- update this if that
// rating (or Damodaran's published spread for it) changes. Keep in sync with
// FALLBACK_RF.ind in calc/assumptions.js (same 6.8% G-Sec − 1.87% ≈ 4.9% math).
const IND_DEFAULT_SPREAD_PCT = 1.87;

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
      // Floor at 1% -- a sanity guard, not an expected case (India's G-Sec yield would
      // need to fall by ~6pp from today's ~6.8% for this to bind).
      liveIndRfRate = +Math.max(1, raw - IND_DEFAULT_SPREAD_PCT).toFixed(2);
      fetchSucceeded = true;
    }
  } catch (_) {
    // silently fall back to 4.9% default
  }
  if (currentMarket === 'ind') {
    els.rfInput.value = liveIndRfRate;
    setRfBadge('ind', liveIndRfRate);
    if (fetchSucceeded) recomputeDiscount();
  }
}
