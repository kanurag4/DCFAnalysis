// www/dcf/calc/assumptions.js — pure DCF/DDM assumption-seeding and
// scenario-assembly logic, extracted from app.js's prefillInputs()/
// buildScenarios() so the website's interactive tool and the native
// shell's Card Dashboard renderer compute IDENTICAL numbers from one
// source instead of two copies that can silently drift (see CLAUDE.md's
// Known Traps — this has already happened twice: the bear/bull inversion
// bug and the WACC null-marketCap bug).
//
// Depends on the already-pure helpers in utils.js, calc/wacc.js,
// calc/dcf.js, calc/ddm.js, calc/fadingGrowthDcf.js, calc/excessReturn.js,
// calc/reit.js, calc/cyclicalNormalization.js's cyclicalBaseFcf, and
// config.js's REIT_SECTOR_MULTIPLES -- all loaded as
// plain globals via <script> tags (same convention as the rest of this
// tool's calc layer), so this file reads them as bare identifiers, not
// imports. Zero document/window access.

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
//
// aus: corrected 2026-09-02 -- was 4.8%, real AU 10-year government bond yield is
// ~5.16-5.2% (multiple sources, 2026-09-01/02; a multi-year high). Found live testing:
// the tool's own live-refine fetch for this market (app.js's fetchAndSetAustralianRfRate,
// symbol ^GSBG10.AX) has been silently 404ing -- confirmed against the live Worker -- so
// the page was permanently stuck on this stale fallback with no visible error. AU uses
// the raw yield directly (developed-market convention, same as us/uk), no spread
// deduction.
//
// uk/eu/ind/kor/jpn/cn: refreshed 2026-09-04 against fresh raw 10yr yields (multiple
// sources each, 2026-09-01/04) -- uk 5.0%->5.07%, eu/Germany 3.2%->3.35%, raw yields
// applied directly (same 'raw' convention as us/aus). ind/kor/jpn/cn kept the SAME
// Damodaran default spreads already in place (India Baa3/1.87%, Korea Aa2/0.42%, Japan
// A1/0.60%, China A1/0.60% -- Jan 2026 table, unchanged since sovereign ratings move far
// slower than yields) and only refreshed the raw yield being spread-adjusted: ind
// 6.96%-1.87%=5.09% (was 4.9%), kor 4.42%-0.42%=4.00% (was 3.9%), jpn 2.96%-0.60%=2.36%
// (was 2.2% -- confirms this was the biggest gap, per docs/TODO.md P4's rough pass),
// cn 1.68%-0.60%=1.08% (was 1.1%, smallest move). hk deliberately NOT touched on 09-04 --
// no trustworthy current 10yr figure found (HKMA's public data only surfaced short-end
// bill yields). Refreshed 2026-09-06: TradingEconomics finally gave a trustworthy
// current figure, 3.65% (Sept 4, 2026), corroborated by an actual HKMA 10yr
// institutional bond tender (Aug 12, 2026) at 3.58% -- was 3.5%, a long-standing
// never-actually-verified placeholder. See docs/TODO.md P4 for the
// full source list and the 2026-08-15 double-counting rationale being preserved here.
//
// us/aus/uk/eu/ind/kor: refreshed 2026-09-11 amid a live, still-unfolding global
// sovereign bond selloff -- US-Iran conflict escalation pushed Brent crude above
// $100/barrel, driving a broad inflation/rate-hike repricing across every market
// below (confirmed via multiple corroborating sources per market, all dated
// 2026-09-10/11). us 4.80%->4.94%, sourced directly from a live ^TNX pull via the
// Worker's own /history endpoint (Sept 10 close 4.944%, up from 4.784% on Sept 4) --
// not just secondhand web citations, since ^TNX is both the confirmed-working live
// symbol and now the citation for the fallback itself. aus 5.20%->5.25% (Bloomberg:
// "highest since 2011" on oil concerns). uk 5.07%->5.30% (raw gilt yield 5.295%,
// 19-year high). eu/Germany 3.35%->3.44% (highest since April 2011). ind/kor kept
// the SAME Jan-2026 Damodaran default spreads (1.87%/0.42%) and only refreshed the
// raw yield being spread-adjusted: ind 6.96%->7.02% (crossed 7% for the first time
// in 3+ months) => net 5.09%->5.15%; kor 4.42%->4.54% (highest since Oct 2022) =>
// net 4.00%->4.12%. jpn/hk/cn checked and NOT moved: jpn's raw JGB yield was
// essentially flat (2.96%->~2.92%, within noise -- BOJ dynamics differ from the
// oil-driven global channel that's moving everything else); no trustworthy fresh HK
// figure found (same gap as 09-04); cn's raw yield unchanged at 1.68% (policy-managed,
// largely insulated from this move). Also re-verified empirically (via /history and
// /search against the live Worker, which don't touch ticker-lookup stats) that no
// live Yahoo symbol exists for aus/ind/uk/eu/kor/jpn/hk/cn -- Yahoo's CBOE yield-index
// family (^TNX/^TYX/^FVX/^IRX) is US-Treasury-only; every non-US "Bund"/"Gilt"/"JGB"
// hit is a bond-price ETF, not a yield quote, and isn't a valid substitute anyway
// (ETF price != yield%). This is a live, fast-moving event as of this writing --
// re-verify sooner than the usual cadence if the selloff continues. See
// docs/risk-free-rates.md.
//
// ind/kor/jpn/cn spreads + all 9 markets' MARKET_ERP refreshed 2026-09-22 against
// Damodaran's semiannual July 2026 country risk premium table (ctrypremJuly26.xlsx,
// "ERPs by country" sheet, Total Equity Risk Premium column) -- his mature-market ERP
// base fell to 4.20% (was ~5.5% baked into the old numbers here) and every sovereign
// default spread compressed too, so every single market's ERP dropped: us 5.5%->4.42%,
// aus 6.0%->4.20%, ind 7.5%->6.92%, kor 7.5%->4.81% (by far the biggest move -- kor's
// old 7.5% had drifted to match ind's rate rather than its own Aa2 rating, a real
// correction, not just drift), jpn 6.0%->5.07%, uk 6.0%->4.94%, eu/Germany 5.5%->4.20%,
// hk 6.0%->4.94%, cn 5.2%->5.07%. The four spread-adjusted markets' underlying default
// spreads moved too (same ratings, refreshed default-spread-per-rating table): ind
// Baa3 1.87%->1.75%, kor Aa2 0.42%->0.39%, jpn/cn A1 0.60%->0.56% (same rating bucket,
// same spread) -- recomputed against the same raw yields already in FALLBACK_RF_META
// (not re-verified this pass): ind 7.05%-1.75%=5.30% (was 5.18%), kor 4.413%-0.39%=4.02%
// (was 3.99%), jpn 3.00%-0.56%=2.44% (was 2.40%), cn 1.68%-0.56%=1.12% (was 1.08%). All
// four moved UP (a smaller spread subtracted), widening their safety margin over
// terminalGrowth, so no stable-growth-ceiling check was needed this pass. India's
// IND_DEFAULT_SPREAD_PCT (www/dcf/app.js, both repos) and IND_DEFAULT_SPREAD
// (DCFAnalysis/scripts/lib/rf.js) -- the only spread with its own separate
// hand-maintained copy, used by the still-404ing live G-Sec re-fetch path -- updated
// to match. See docs/risk-free-rates.md.
//
// aus/uk/hk refreshed 2026-10-01 (TradingEconomics, raw yields, same 'raw' convention):
// aus 5.35%->5.42% (near the highest since mid-2011; RBA Nov-hike odds swung 20%->74%
// intraday), uk 5.38%->5.44%, hk 3.65%->4.09% -- hk's first real re-verification since
// 09-06 (+42bp over the month on TradingEconomics, consistent with the 3.65% Sept 4
// reading it replaces). ind/kor/jpn/eu/cn/us deliberately NOT moved this pass (3-4bp
// from the 09-30 values, within day-to-day noise). terminalGrowth still clears every
// moved rf (aus 2.5, uk 2.0, hk 2.0 vs 5.42/5.44/4.09).
//
// us: switched to 'spread-adjusted' 2026-10-15 (docs/TODO.md P31). MARKET_ERP.us (4.42%) is Damodaran's
// 4.20% mature-market premium PLUS the US's own Aa1 default spread (his table: 0.2186%), so the
// raw T-bond yield -- which already prices that same default risk -- counted it twice. His own
// "dollar riskfree rate" nets it out (10Y 5.29% - 0.22% = 5.07%, Musings on Markets 2026-10-08),
// exactly as ind/kor/jpn/cn were corrected on 2026-08-15. 0.0501 raw (^TNX 5.006%, 2026-09-18) - 0.0022
// = 0.0479; the live ^TNX path (worker-watchlist/live-rate.js, DCFAnalysis rf.js, web /dcf/'s direct
// fallback) subtracts US_DEFAULT_SPREAD too. The raw 5.01% base was NOT re-verified this pass.
//
// uk/hk: switched to 'spread-adjusted' 2026-10-15 (docs/TODO.md P35), found while verifying the US change above: both are
// Aa3 in Damodaran's July 2026 table (rating-based default spread 0.4772%, country risk premium 0.7419%, total ERP
// 4.94% = MARKET_ERP.uk/.hk), so their raw yields counted that default risk twice, by ~2.2x what the US did. Static
// values only (neither has a live yield feed): uk 0.0544 raw - 0.0048 = 0.0496, hk 0.0409 raw - 0.0048 = 0.0361 (0.48%
// = the 0.4772% spread at the same 2dp-of-percent rounding as ind/kor/jpn/cn). The raw yields were NOT re-verified.
// terminalGrowth still clears both (uk 2.0 vs 4.96, hk 2.0 vs 3.61).
// All 9 markets refreshed 2026-10-15 against same-day TradingEconomics 10Y yields during a sharp global bond rally (US 10Y
// 5.34% high on Oct 5 -> 5.09%, AI-sector stress and safe-haven buying): us 4.79%->4.87% (the static fallback only -- the live
// ^TNX path overrides it), aus 5.42%->5.22%, ind 5.40%->5.64% (the one market that rose: raw G-Sec 7.15%->7.387% since Sept 30,
// single source), kor 4.01%->3.80%, jpn 2.51%->2.37%, uk 4.96%->4.86%, eu 3.59%->3.39%, hk 3.61%->3.53%, cn 1.12%->1.10%. Spreads
// unchanged (Jul-2026 Damodaran). Intraday readings: an AU/UK/EU close can sit ~7bp off. terminalGrowth still clears every rate
// (tightest: hk 2.0 vs 3.53, jpn 1.2 vs 2.37).
// 2026-10-23 pass (TradingEconomics Oct 22 closes, single source each): aus 5.22%->5.16%, ind 5.64%->5.72% (raw G-Sec
// 7.466%, rising again), jpn 2.37%->2.32% (raw 2.882%), eu 3.39%->3.33%, hk 3.53%->3.58% (raw 4.064%). kor/uk/cn/br left
// (1-3bp, noise; br re-check after the 25 Oct runoff). Spreads unchanged. terminalGrowth still clears (jpn 1.2 vs 2.32).
//
// br: added 2026-10-17 (lookups only -- no Brazil screen/ticker pages). Real Brazilian users were running
// dozens of .SA tickers through /dcf/ on the 'other' bucket, i.e. the US rf/ERP against BRL cash flows.
// Same 'spread-adjusted' recipe as ind: raw BRL 10Y 13.09% (2026-10-16 close, TradingEconomics; Investing.com
// also 13.085%) minus Damodaran Jul-2026 Ba1 default spread 1.99% (1.9932%) = 11.09%; MARKET_ERP.br = his total
// ERP 7.30% (7.2984%). MARKET_TGROWTH.br 5.0 = BCB 3% inflation target + ~2% real growth, 45% of rf (inside the
// 40-57% band the other markets sit in). The yield swung ~12.6-14% in Oct 2026 around the 25 Oct presidential
// runoff -- re-check on the next refresh.
//
const US_DEFAULT_SPREAD = 0.0022;
// Raw 10Y Treasury yield (fraction, e.g. 0.0529) -> the dollar risk-free rate valuations use (0.0507). Rounded
// to 4dp so the double equals the decimal literal (same reason live-rate.js rounds the raw yield).
function usRiskFreeFromYield(yieldFraction) {
  return Math.round((yieldFraction - US_DEFAULT_SPREAD) * 10000) / 10000;
}
const FALLBACK_RF = { us: 0.0487, aus: 0.0516, ind: 0.0572, kor: 0.0380, jpn: 0.0232, uk: 0.0486, eu: 0.0333, hk: 0.0358, cn: 0.0110, br: 0.1109 };

// Staleness metadata for FALLBACK_RF, one entry per market -- consumed by
// scripts/check-rf-staleness.js (not by the live tool itself). asOf: null
// means no verified baseline exists yet (never checked, not "checked and
// fine") -- the script always flags those rather than guessing a plausible-
// looking date. method 'raw' = the live/fallback IS the risk-free rate
// directly (us/aus/uk/eu/hk); 'spread-adjusted' = raw govt bond yield minus
// that country's Damodaran default spread (ind/kor/jpn/cn), since MARKET_ERP
// already carries country risk premium separately -- see the comment above.
// liveSymbol: the Yahoo ticker app.js's live-refine fetch uses for this
// market, or null where no live fetch exists (by design, see the comment
// above) -- found 2026-09-02 that aus/ind's symbols 404 (dead), so this
// field also doubles as "does the live path even work" documentation until
// a replacement is found (see docs/TODO.md's P6).
const FALLBACK_RF_META = {
  us:  { asOf: '2026-10-15', source: 'raw ^TNX 5.09% (Oct 15, TradingEconomics; Reuters 5.106%, a three-week low off the 5.34% high of Oct 5) minus Jul-2026 Damodaran Aa1 default spread 0.22%. Live paths subtract the same spread', method: 'spread-adjusted', liveSymbol: '^TNX', liveSymbolWorks: true },
  aus: { asOf: '2026-10-23', source: 'TradingEconomics, AU 10yr govt bond 5.163% (Oct 22 close; single source, no Oct 22 cross-check found -- TE news had 5.23% on Oct 15)', method: 'raw', liveSymbol: '^GSBG10.AX', liveSymbolWorks: false },
  ind: { asOf: '2026-10-23', source: 'raw G-Sec 7.466% (Oct 22 close, TradingEconomics; single source -- rising again, 7.387% on Oct 15) minus Jul-2026 Damodaran spread 1.75% (Baa3, unchanged)', method: 'spread-adjusted', liveSymbol: '^INBMKG10.NS', liveSymbolWorks: false },
  kor: { asOf: '2026-10-15', source: 'raw yield 4.19% (Oct 15, TradingEconomics; single source) minus Jul-2026 Damodaran spread 0.39% (Aa2, unchanged)', method: 'spread-adjusted', liveSymbol: null, liveSymbolWorks: null },
  jpn: { asOf: '2026-10-23', source: 'raw JGB yield 2.882% (Oct 22 close, TradingEconomics; single source) minus Jul-2026 Damodaran spread 0.56% (A1, unchanged)', method: 'spread-adjusted', liveSymbol: null, liveSymbolWorks: null },
  uk:  { asOf: '2026-10-15', source: 'raw gilt yield 5.34% (Oct 15, TradingEconomics; single source) minus Jul-2026 Damodaran Aa3 default spread 0.48% (docs/TODO.md P35)', method: 'spread-adjusted', liveSymbol: null, liveSymbolWorks: null },
  eu:  { asOf: '2026-10-23', source: 'raw German bund yield 3.331% (Oct 22 close, TradingEconomics; single source)', method: 'raw', liveSymbol: null, liveSymbolWorks: null },
  hk:  { asOf: '2026-10-23', source: 'TradingEconomics 4.064% (Oct 22 close; OTC interbank quote, thin single source -- the Aug 12 HKMA 10yr tender at 3.58% is the only independent data point) minus Jul-2026 Damodaran Aa3 default spread 0.48% (docs/TODO.md P35)', method: 'spread-adjusted', liveSymbol: null, liveSymbolWorks: null },
  cn:  { asOf: '2026-10-15', source: 'raw yield 1.66% (Oct 15, TradingEconomics; single source) minus Jul-2026 Damodaran spread 0.56% (A1, unchanged)', method: 'spread-adjusted', liveSymbol: null, liveSymbolWorks: null },
  br:  { asOf: '2026-10-16', source: 'raw BRL 10Y 13.09% (Oct 16 close, TradingEconomics; Investing.com 13.085%) minus Jul-2026 Damodaran Ba1 default spread 1.99%. Volatile around the 25 Oct 2026 presidential runoff', method: 'spread-adjusted', liveSymbol: null, liveSymbolWorks: null },
};

// fr: France, split out of the eurozone bucket 2026-10-23 when the 10Y OAT traded ~174bp over the Bund (5.08% vs 3.33%,
// Oct 22). Damodaran's euro convention: ONE euro risk-free rate (the Bund) for every euro asset, with each country's
// extra risk carried in its ERP -- so France gets the eu rate itself plus its own Aa3 ERP (MARKET_ERP.fr). Aliased, not
// typed: a Bund refresh can never leave France behind, and fr must exist as a key because every lookup falls back to
// the US rate (`FALLBACK_RF[m] ?? FALLBACK_RF.us`) for a market with no entry. Other euro members stay on the eu bucket.
FALLBACK_RF.fr = FALLBACK_RF.eu;
FALLBACK_RF_META.fr = { ...FALLBACK_RF_META.eu, source: 'the euro risk-free rate: FALLBACK_RF.eu (German Bund) by construction -- see the eu entry' };

// Total Equity Risk Premium (rating-based column), Damodaran July 2026 country risk
// premium table -- see the FALLBACK_RF comment above for the full refresh narrative.
const MARKET_ERP  = { us: 0.0442, aus: 0.0420, ind: 0.0692, kor: 0.0481, jpn: 0.0507, uk: 0.0494, eu: 0.0420, fr: 0.0494, hk: 0.0494, cn: 0.0507, br: 0.0730 };
const MARKET_TGROWTH_DEFAULT = 2.5;
const MARKET_TGROWTH = { kor: 1.75, jpn: 1.2, uk: 2.0, eu: 1.8, fr: 1.8, hk: 2.0, cn: 0.6, br: 5.0 };

// The ONE place a worker-watchlist GET /rates body is applied (native-compare spec Part 1, 2026-10-21): web
// /evaluate/, web /dcf/, native Home and the native DCF tab all call this, so one /rates body gives one set of
// tables on every surface. Mutates the three tables in place (other scripts hold references to them). Each value
// is checked on its own -- an out-of-bounds or non-number value keeps the bundled one, the rest still apply.
// Unknown market keys are applied too: the Worker may add a market before this bundle has it.
// MARKET_TGROWTH is in PERCENT units (1.75 = 1.75%), unlike the other two.
const WORKER_RATE_BOUNDS = { FALLBACK_RF: [0.005, 0.15], MARKET_ERP: [0.01, 0.20], MARKET_TGROWTH: [0, 8] };
function applyWorkerRates(body) {
  if (!body || typeof body !== 'object' || !body.ok) return false;
  const isTable = (t) => !!t && typeof t === 'object';
  if (!isTable(body.FALLBACK_RF) || !isTable(body.MARKET_ERP)) return false;
  const targets = { FALLBACK_RF, MARKET_ERP, MARKET_TGROWTH };
  for (const name of Object.keys(targets)) {
    const src = body[name];
    if (!isTable(src)) continue;
    const [lo, hi] = WORKER_RATE_BOUNDS[name];
    for (const key of Object.keys(src)) {
      const v = src[key];
      if (typeof v === 'number' && isFinite(v) && v >= lo && v <= hi) targets[name][key] = v;
    }
  }
  applyWorkerSuffixes(body.MARKET_SUFFIXES);
  return true;
}

// Exchange suffix -> rate market, checked in order (first match wins). DATA, not code, since 2026-10-23: /rates
// serves it and applyWorkerRates() swaps it in, so a new market (France .PA that day, Brazil .SA before it) reaches
// installed apps with a worker-watchlist deploy -- before, /rates delivered the new market's rates but the bundled
// detectMarket() never routed a ticker to them. ASX stays in code (isAsxTicker, ahead of this list).
const MARKET_SUFFIXES = [
  ['.NS', 'ind'], ['.BO', 'ind'], ['.KS', 'kor'], ['.T', 'jpn'], ['.L', 'uk'],
  ['.PA', 'fr'],  // own bucket since 2026-10-23 -- see FALLBACK_RF.fr
  ['.DE', 'eu'], ['.AS', 'eu'], ['.MI', 'eu'], ['.MC', 'eu'], ['.BR', 'eu'], ['.LS', 'eu'], ['.VI', 'eu'], ['.HE', 'eu'], ['.IR', 'eu'],
  ['.HK', 'hk'], ['.SS', 'cn'], ['.SZ', 'cn'], ['.SA', 'br'],
];
// All or nothing: a Worker map is used only if EVERY entry is a well-formed upper-case suffix pointing at a market
// with both a rate and an ERP (after the tables above are applied) -- a partial or bad map is ignored whole, since a
// suffix routed to a market with no rates would silently fall back to the US rate. Copied, never aliased.
function applyWorkerSuffixes(map) {
  if (!Array.isArray(map) || map.length === 0) return;
  const ok = map.every((e) => Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && /^\.[A-Z]{1,3}$/.test(e[0])
    && typeof e[1] === 'string' && FALLBACK_RF[e[1]] != null && MARKET_ERP[e[1]] != null);
  if (ok) MARKET_SUFFIXES.splice(0, MARKET_SUFFIXES.length, ...map.map((e) => [e[0], e[1]]));
}

// ASX first (in code), then MARKET_SUFFIXES in order, then bare-suffix-less US, else 'other'.
function detectMarket(ticker) {
  const t = (ticker || '').toUpperCase();
  if (isAsxTicker(ticker)) return 'aus';
  for (const [suffix, market] of MARKET_SUFFIXES) if (t.endsWith(suffix)) return market;
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

// ROE spread mirrors growthOffsetSpread's magnitude-offset shape, but with
// bounds appropriate to ROE rather than a revenue/earnings growth rate --
// growthOffsetSpread's 30% ceiling is far too low for high-ROE financials
// (a real NBFC checked while building this can sit at ~31.7% ROE, which the
// growth-rate ceiling clamps *below* base, inverting bull < base -- the same
// class of ordering bug as the 2026-08-11 bear/bull inversion in CLAUDE.md's
// Known Traps, just triggered by a clamp instead of a sign flip). Floored at
// 0 instead of -15 since a negative bear-case ROE makes calculateExcessReturn
// return null for that scenario by design (matches DDM's noDividend-style
// graceful degradation) and isn't a meaningful bear case for a going concern.
function roeOffsetSpread(baseRoePct) {
  const offset = Math.abs(baseRoePct) * 0.5;
  return {
    bear: +Math.max(0, baseRoePct - offset).toFixed(1),
    bull: +Math.min(60, baseRoePct + offset).toFixed(1),
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
//
// opts.sectorMarginLookup: the precomputed { industry: { avgMargin, peerCount
// } } lookup (scripts/lib/sector-margin-tally.js, DCFAnalysis) -- optional,
// omit or pass undefined for identical behavior to before this parameter
// existed.
function deriveDcfAssumptions(data, opts) {
  const isBankIns = isBankOrInsurance(data.sector, data.industry, data.ticker);
  const isReitFlag = !isBankIns && isReit(data.sector, data.industry); // mortgage REITs already routed to isBankIns above -- isReit() itself already excludes them too, this guard is just defense-in-depth against the two ever disagreeing
  const isAirlineFlag = !isBankIns && !isReitFlag && isAirline(data.sector, data.industry);
  const isUtilityFlag = !isBankIns && !isReitFlag && !isAirlineFlag && isUtility(data.sector, data.industry);
  const isCyclicalFlag = !isBankIns && !isReitFlag && !isAirlineFlag && isCyclical(data.sector, data.industry);
  // Independent of the model dispatch above -- a conglomerate can be any
  // underlying model (almost always plain DCF, but a bank- or REIT-tagged
  // conglomerate is possible); the discount stacks on top of whichever
  // model runs rather than competing to select one. See
  // calc/holdcoDiscount.js.
  const isHoldcoFlag = isConglomerate(data.sector, data.industry, data.ticker);
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

  const baseGrowthPct = +(deriveMultiYearGrowth(data) * 100).toFixed(1);
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
  const growth = deriveDividendGrowth(data.earningsGrowth, data.revenueGrowth); // fraction, not *100 yet
  const divGrowthPct = +(growth * 100).toFixed(1);
  const rePct = +(re * 100).toFixed(2);

  // Excess Return Model inputs -- only meaningful when isBankIns, but computed
  // unconditionally (cheap, no network call) so financialModel below can decide.
  const roe = (data.returnOnEquity != null && isFinite(data.returnOnEquity) && data.returnOnEquity > 0)
    ? data.returnOnEquity
    : (data.trailingEps != null && data.priceToBook != null && data.price != null && data.priceToBook > 0
        ? data.trailingEps / (data.price / data.priceToBook)
        : null);
  const financialModel = isBankIns ? chooseFinancialModel({ roe, dividend, trailingEps: data.trailingEps, growth }) : null;
  const roePct = roe != null ? +(roe * 100).toFixed(1) : null;
  const bookValue = (data.price != null && data.priceToBook != null && data.priceToBook > 0)
    ? data.price / data.priceToBook : null;
  const roeSpread = roePct != null ? roeOffsetSpread(roePct) : { bear: null, bull: null };

  // REIT FFO/AFFO -- computed unconditionally (cheap, no network call), same
  // pattern as the roe/financialModel computation above, so modelSeeds.reit
  // is always populated even when this ticker isn't a REIT.
  const ffoInfo = deriveFfo({ netIncome: data.netIncome, depreciationAndAmortization: data.depreciationAndAmortization });
  const affoInfo = deriveAffo({ ffo: ffoInfo.value, capex: data.capitalExpenditures });
  const resolvedSharesForReit = (data.dilutedSharesOutstanding != null && data.dilutedSharesOutstanding > 0)
    ? data.dilutedSharesOutstanding : data.sharesOutstanding;
  const affoPerShare = (affoInfo.value != null && resolvedSharesForReit > 0)
    ? affoInfo.value / resolvedSharesForReit : null;
  const reitIndustryKey = (data.industry && REIT_SECTOR_MULTIPLES[data.industry] != null) ? data.industry : 'DEFAULT';
  const reitBaseMultiple = REIT_SECTOR_MULTIPLES[reitIndustryKey];

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
    excessReturn: {
      bookValue,
      growth:   { bear: roeSpread.bear, base: roePct, bull: roeSpread.bull }, // "growth" slot holds ROE for this model
      discount: { bear: +(rePct + 1).toFixed(2), base: rePct, bull: +(Math.max(1, rePct - 1)).toFixed(2) },
      // Book value compounds at the same dividend/earnings-derived growth rate
      // evaluate.js/ticker-page.js/worker-watchlist all use for this model --
      // NOT ROE (fixed 2026-08-15, peer review finding: computeScenarios() was
      // passing base ROE itself as the compounding rate, silently overstating
      // book-value growth versus every other consumer of this calc engine).
      // Pinned across bear/base/bull -- see the comment on computeScenarios()'s
      // excess-return branch for why this doesn't vary with the scenario.
      bookValueGrowthPct: divGrowthPct,
    },
    reit: {
      affoPerShare,
      ffoPerShare: (ffoInfo.value != null && resolvedSharesForReit > 0) ? ffoInfo.value / resolvedSharesForReit : null,
      netIncome: data.netIncome,
      depreciationAndAmortization: data.depreciationAndAmortization,
      capitalExpenditures: data.capitalExpenditures,
      reitIndustryKey,
      multiple: { bear: +(reitBaseMultiple * 0.8).toFixed(1), base: reitBaseMultiple, bull: +(reitBaseMultiple * 1.2).toFixed(1) },
    },
    airline: {
      ebitda: data.ebitda,
      multiple: {
        bear: +(AIRLINE_EV_EBITDA_MULTIPLE * 0.8).toFixed(1),
        base: AIRLINE_EV_EBITDA_MULTIPLE,
        bull: +(AIRLINE_EV_EBITDA_MULTIPLE * 1.2).toFixed(1),
      },
    },
  };

  const fcfInfo = deriveFcf(data.freeCashflow, data.operatingCashflow, data.capitalExpenditures, data.annualFcf);

  // Cyclical companies get a normalized base-year FCF instead of the
  // trailing figure above, when enough real multi-year history exists --
  // see calc/cyclicalNormalization.js. Falls back to the standard fcfInfo
  // (untouched) when there's too little history, same graceful-degradation
  // posture deriveFcf() itself already uses for its own tiers.
  let finalFcfInfo = fcfInfo;
  if (isCyclicalFlag) {
    const cyclicalFcf = cyclicalBaseFcf({
      fcfHistory: data.annualFcfHistory,
      revenueHistory: data.annualRevenueHistory,
      trailingRevenue: data.totalRevenue,
      sectorLookup: opts && opts.sectorMarginLookup,
      industry: data.industry,
      operatingMargin: data.operatingMargins,
    });
    if (cyclicalFcf) finalFcfInfo = cyclicalFcf;
  }

  const valuationModel = isReitFlag ? 'reit' : (isAirlineFlag ? 'airline' : (isUtilityFlag ? 'excess-return' : (!isBankIns ? 'dcf' : (financialModel === 'excess-return' ? 'excess-return' : 'ddm'))));

  return {
    isBankIns, isReit: isReitFlag, isAirline: isAirlineFlag, isUtility: isUtilityFlag, isCyclical: isCyclicalFlag, isHoldco: isHoldcoFlag, currentMarket, rf, erp, effectiveBeta, betaWasFloored: effectiveBeta > rawBeta,
    waccResult, modelSeeds, fcfInfo: finalFcfInfo,
    valuationModel,
    holdcoDiscount: isHoldcoFlag ? HOLDCO_DISCOUNT : null,
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

  if (valuationModel === 'reit') {
    const affoPerShare = seeds.affoPerShare;
    const scenarios = configs.map((key) => {
      const multiple = seeds.multiple[key];
      if (!(affoPerShare > 0)) return { key, multiple, result: null, noAffo: true };
      const result = calculateReitValue({ affoPerShare, multiple, currentPrice: data.price });
      return { key, multiple, result };
    });
    return applyHoldcoDiscountToScenarios(scenarios, options.holdcoDiscount, data.price);
  }

  if (valuationModel === 'airline') {
    const ebitda = seeds.ebitda;
    const resolvedShares = (data.dilutedSharesOutstanding != null && data.dilutedSharesOutstanding > 0)
      ? data.dilutedSharesOutstanding : data.sharesOutstanding;
    const scenarios = configs.map((key) => {
      const multiple = seeds.multiple[key];
      if (!(ebitda > 0)) return { key, multiple, result: null, noEbitda: true };
      const result = calculateAirlineValue({ ebitda, multiple, totalDebt: data.totalDebt, totalCash: data.totalCash, sharesOutstanding: resolvedShares, currentPrice: data.price });
      return { key, multiple, result };
    });
    return applyHoldcoDiscountToScenarios(scenarios, options.holdcoDiscount, data.price);
  }

  if (valuationModel === 'excess-return') {
    const bookValue = seeds.bookValue;
    // Book value compounding rate is deliberately a single value pinned across
    // bear/base/bull (like DDM's terminal growth), not derived from seeds.growth
    // (which holds ROE for this model, not a growth rate -- see the field's own
    // comment on modelSeeds.excessReturn). Bear/bull vary ROE and cost of equity
    // only, avoiding a second independent lever.
    const bookValueGrowthRate = (seeds.bookValueGrowthPct ?? 0) / 100;
    const scenarios = configs.map((key) => {
      const roe          = seeds.growth[key] / 100;   // "growth" slot holds ROE for this model
      const costOfEquity = seeds.discount[key] / 100;
      if (!(bookValue > 0)) return { key, roe, wacc: costOfEquity, result: null, noBookValue: true };
      const result = calculateExcessReturn({ bookValue, roe, costOfEquity, growthRate: bookValueGrowthRate, projectionYears: years, currentPrice: data.price, midYear: useMidYear });
      return { key, roe, wacc: costOfEquity, result };
    });
    return applyHoldcoDiscountToScenarios(scenarios, options.holdcoDiscount, data.price);
  }

  if (valuationModel === 'ddm') {
    const dividend = seeds.dividend;
    const scenarios = configs.map((key) => {
      const growthRate     = seeds.growth[key] / 100;
      const terminalGrowth = seeds.tgrowth[key] / 100;
      const costOfEquity   = seeds.discount[key] / 100;
      if (!(dividend > 0)) return { key, growthRate, terminalGrowth, wacc: costOfEquity, result: null, noDividend: true };
      const result = calculateDDM({ dividend, growthRate, terminalGrowth, costOfEquity, projectionYears: years, currentPrice: data.price, midYear: useMidYear });
      return { key, growthRate, terminalGrowth, wacc: costOfEquity, result };
    });
    return applyHoldcoDiscountToScenarios(scenarios, options.holdcoDiscount, data.price);
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

  const scenarios = configs.map((key) => {
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
  return applyHoldcoDiscountToScenarios(scenarios, options.holdcoDiscount, data.price);
}

// FALLBACK_RF/MARKET_ERP/MARKET_TGROWTH exported (2026-08-23) so worker-watchlist's
// market-params.js can derive its rates directly from this table instead of
// maintaining its own copy -- a second copy is exactly what went stale after the
// 2026-08-15 Damodaran rf fix and caused a real live valuation mismatch (see
// kashvector-native-apps.md / the Watchlist bug investigation). Single source of
// truth now; a future rate change here flows to Watchlist automatically.
if (typeof module !== 'undefined') module.exports = { detectMarket, deriveDcfAssumptions, computeScenarios, growthOffsetSpread, roeOffsetSpread, discountRateSpread, US_DEFAULT_SPREAD, usRiskFreeFromYield, applyWorkerRates, MARKET_SUFFIXES, FALLBACK_RF, FALLBACK_RF_META, MARKET_ERP, MARKET_TGROWTH, MARKET_TGROWTH_DEFAULT };
if (typeof window !== 'undefined') { window.detectMarket = detectMarket; window.deriveDcfAssumptions = deriveDcfAssumptions; window.computeScenarios = computeScenarios; window.growthOffsetSpread = growthOffsetSpread; window.roeOffsetSpread = roeOffsetSpread; window.discountRateSpread = discountRateSpread; }
