# CLAUDE.md — DCF Valuation Tool

KashVector DCF tool. Source repo — deploys to `kashvector.com/dcf/` by xcopy to `C:\Projects\StockAnalysis\www\dcf\` then pushing the stock-evaluator repo.

---

## Build Status

| Phase | Status |
|---|---|
| Phase 1 — Worker update (`incomeStatementHistory`) | ✅ Done, deployed to Cloudflare |
| Phase 2 — Calc engine (`calc/wacc.js`, `calc/dcf.js`, 13 tests) | ✅ Done |
| Phase 3 — Data layer (`config.js`, `data.js`) | ✅ Done |
| Phase 4 — HTML + CSS (`index.html`, `style.css`) | ✅ Done |
| Phase 5 — App logic (`app.js`) | ✅ Done |
| Phase 5b — DDM (`calc/ddm.js`, `tests/ddm.test.js`, app.js branching) | ✅ Done |
| Phase 6 — Local testing + bug fixes | ✅ Done |
| Phase 7 — Icon (`dcf-icon.svg`) | ✅ Done — thin price line on axes (yr1 +10%, yr2 −5%, yr3 +20%), green on muted axes |
| Phase 8 — Deploy | ✅ **Done — LIVE at kashvector.com/dcf/ (2026-05-30)** |

**Deployed 2026-05-30.** Source repo committed + pushed (github.com/kanurag4/DCFAnalysis). Deployed via xcopy `www/` → `StockAnalysis/www/dcf/`, hub card added as #2, sitemap + ItemList JSON-LD updated, cross-tool nav DCF link added to 8 static pages + both kv-nav.js copies. StockAnalysis pushed (stock-evaluator repo main). Verified live: /dcf/ and /dcf-icon.svg both return 200.

**Phase 6 — all passed (2026-05-30):**
- QBE.AX ✅ — DDM seeding correct after beta floor + growth cap fix
- LLOY.L ✅ — GBp currency unit mismatch fixed
- RELINFRA.NS ✅ — WACC beta floor extended to DCF
- RELIANCE.NS ✅ — negative equity handled gracefully
- AAPL ✅ — US DCF, DDM toggle visible and working
- BHP.AX ✅ — ASX plain DCF, beta floor note shown
- CBA.AX ✅ — bank DDM, correct seeding
- Mobile 390px ✅
- Light mode ✅
- Invalid ticker ✅

---

## Feature: Most Undervalued ASX 300 screen — ✅ LIVE (2026-06-02)

Monthly screen at **kashvector.com/dcf/asx-undervalued/** ranking the ASX 300 by base-case
DCF/DDM margin of safety. Offline Node batch (`scripts/`, dev-only, never deployed) reuses
the live tool's pure calc modules unchanged. Shows **top 20** at an **80% margin cap**.

- Batch: `node scripts/rank-asx.js` (~16 min, 3.2s throttle + retry — see rate-limit note),
  then `--rerank` re-ranks the cached `_evaluated.json` instantly (tune `TOP_N`/`MAX_MARGIN`).
- Monthly refresh runbook: **`/refresh-asx-undervalued`** skill (run → review funnel/top-N →
  approve → publish).
- Columns: Fair value (bold green), Mkt cap, Analyst tgt, Live price, **Since listed** (% change
  from first-seen price to live price — green/red; `—` until a stock persists across months),
  Margin (live), WACC/Re, TV%, Op margin, P/E, First seen (date @ price).
  Filters: undervalued · valuable · real-FCF (drop OCF×0.8 proxy) · ≤80% margin.
- **Rate-limit gotcha:** Worker caps 20 req/60s per IP; 400ms throttle silently 429'd ~80%
  of fetches. The `rankFunnel` (`fetch-failed` count) exposes this — keep it ~0.
- Build notes / article material: `docs/asx-undervalued-build-notes.md`.
- Published companion article: `kashvector.com/articles/most-undervalued-asx-300/`.

## Feature: Most Undervalued S&P 500 screen — ✅ BUILT (pending deploy approval, 2026-06-04)

Sibling of the ASX screen at **kashvector.com/dcf/sp500-undervalued/** (separate page, not a
tabbed view). Ranks the S&P 500 by base-case DCF/DDM margin of safety. Top 20, 80% cap, USD.

- Batch: `node scripts/rank-sp500.js` (~27 min, 502 tickers, same 3.2s throttle + sweep).
- Columns: same as the ASX screen — Fair value, Mkt cap, Analyst tgt, Live price, Since listed,
  Margin (live), WACC/Re, TV%, Op margin, P/E, First seen. Both screens share the same `app.js`.
- Tickers: `scripts/sp500.json` from stockanalysis.com via `scripts/build-sp500.js`, **dot→dash
  normalized** (`BRK.B`→`BRK-B`) so Yahoo resolves them AND US detection (`!includes('.')`) works.
- US RF: live `^TNX` (~4.5%), read from the raw `summaryDetail` chain in `scripts/lib/rf.js`.
- Refresh runbook: **`/refresh-sp500-undervalued`** skill.
- Design doc: `docs/superpowers/specs/2026-06-04-sp500-undervalued-screen-design.md`.
- Spec/plan + this work: `docs/superpowers/plans/2026-06-04-sp500-undervalued-screen.md`.

### Shared orchestrator (`scripts/lib/run-screen.js`)
Both `rank-asx.js` and `rank-sp500.js` are thin wrappers over `runScreen(config)`. Three modes:
- (default) full fetch → evaluate → rank → write; also caches raw data to `_raw-<mkt>.json`.
- `--rerank` re-ranks the cached `_evaluated-<mkt>.json` instantly (tune `TOP_N`/`MAX_MARGIN`).
- `--reeval` re-runs `evaluateStock` on the cached **raw** data in ~2s — for engine/parity
  fixes, no 27-min re-fetch. (ASX refactor verified byte-identical via `--rerank`.)

### Engine parity — the batch reproduces the live tool's base case to the penny
`scripts/lib/evaluate.js` must match what the DCF tool shows. Three fixes found during the
S&P 500 build (2026-06-04), all in the **shared** engine → they apply to **both** screens:
1. **Non-bank financials get a 0.6 FCF haircut** (`fcf × 0.6`) — the tool's normalised-FCF
   seed. Without it Visa/exchanges/asset managers overstate ~40% and flood the list.
2. **`^TNX` RF read from raw `summaryDetail`** (mapQuoteSummary leaves index `.price` null).
3. **Seeds rounded to display precision** before the calc call: growth 1 dp, WACC/Re 2 dp,
   FCF integer, dividend 2 dp. (e.g. LH: full-precision $457.28 → rounded $458.26 = the tool.)

**ASX re-run done 2026-06-04** — engine parity fixes applied; ASX raw cache now written
(`scripts/_raw-asx.json`) so future ASX tweaks can use `--reeval`.

---

## Feature: Most Undervalued NIFTY 500 screen — ✅ LIVE (2026-06-05)

Sibling of the ASX and S&P 500 screens at **kashvector.com/dcf/nifty-undervalued/**. Ranks
the NIFTY 500 by base-case DCF/DDM margin of safety. Top 20, 80% cap, INR.

- Batch: `node scripts/rank-nifty.js` (~27 min, 500 tickers, same 3.2s throttle + sweep).
- Columns: same as ASX/S&P 500 screens. Currency: `₹` (Yahoo returns `currency: 'INR'` for `.NS`).
- Tickers: `scripts/nifty500.json` (500 entries built from `ind_nifty500list.csv` by `scripts/build-nifty500.js`).
  Special symbols with `&` or `-` handled via `encodeURIComponent(symbol)` in `scripts/lib/fetch-yahoo.js`.
- IND RF: `^INBMKG10.NS` via `fetchIndRf` in `scripts/lib/rf.js` (fallback 7.0% — Yahoo often
  returns the fallback; 7% is correct for current Indian G-Sec rates).
- Refresh runbook: **`/refresh-nifty-undervalued`** skill.
- First run: 15 stocks qualified from 500 (2026-06-05).

**Incremental delta-fetch pattern** (used when expanding the ticker list): `scripts/fetch-nifty-delta.js`
reads `_raw-nifty.json`, fetches only new tickers, merges back. Then `--reeval` covers all tickers.
Reuse this pattern for any future ticker-list expansion on any screen.

---

## Android App — Upcoming (planned ~2026-06-07)

**Decision: Option A — add DCF as a new tab/screen inside the existing Stock Evaluator app.**
Not a standalone app. Saves Play Console setup, keystore, and Worker origin work — all already
in place for the Stock Evaluator.

### Existing app facts
- App: `com.stockeval.app` — "Buffett Stock Evaluator" — Google Play, versionCode 16 / 1.14
- Keystore: `C:\Users\Anurag\keystores\buffett-upload.jks` — **losing it = can never update**
- Worker: `Origin: https://localhost` already in `ALLOWED_ORIGINS` — DCF fetches work in-app
- Mechanics: `npx cap sync` (copies www → android assets), `npx cap open android` (Android Studio)
  After `npx cap add android`: fix `android/app/build.gradle` line 22 →
  `proguard-android-optimize.txt`. AAB upload to Play Console is manual.

### DCF is Capacitor-ready by design
Only `app.js` touches DOM/window/localStorage. All calc/data/utils are pure — `www/` wraps as-is.

### Key UX questions to resolve in brainstorming
1. **Navigation model** — how does the user switch between Stock Evaluator and DCF?
   (Bottom nav tabs? Top tabs? Home screen listing both tools? Drawer?)
2. **App identity** — "Buffett Stock Evaluator" is narrow now; may need broadening in the
   Play Store listing and app title bar.
3. **Web nav suppression** — the DCF page has a `← All tools` logo and `kv-tool-nav` bar
   that make no sense in-app. The Stock Evaluator already strips `kv-tool-nav` via an inline
   Capacitor guard (`if(window.Capacitor&&isNativePlatform())nav.remove()`); DCF needs the same,
   and the home-logo link probably hides too.
4. **Screen real-estate** — DCF collapses to single-column on mobile already; check how it
   feels with app chrome (status bar, bottom nav) around it.

### Session start checklist
- Load `/kashvector-reference` (Capacitor mechanics) + project memory (android-app-planning.md)
- Run `/brainstorming` on the UX — Option A is decided, so go straight to navigation model
- No code until the UX is agreed and specced

---

## Architecture

### DOM Boundary Rule (Capacitor-ready)
Only `app.js` touches `document`, `window`, `localStorage`. All other files (`calc/wacc.js`, `calc/dcf.js`, `data.js`, `utils.js`) are pure functions. Designed so Capacitor can wrap `www/` as-is for Android — same pattern as the Stock Evaluator.

### File Structure
```
www/
  index.html         — markup only
  style.css          — kv-* tokens (dark default, light override)
  config.js          — CONFIG.YAHOO_PROXY_URL
  utils.js           — safe(), fmt(), formatMarketCap(), escapeHtml(), isFinancialSector(), isRealEstateSector(), isBankOrInsurance(), deriveBaseGrowth(), deriveDividendGrowth(), getMarketBetaFloor()
  data.js            — fetchDCFData() — DOM-free
  calc/
    wacc.js          — calculateWACC() — pure, Node-testable
    dcf.js           — calculateDCF() — pure, Node-testable
    ddm.js           — calculateDDM() — pure, Node-testable
  app.js             — ALL DOM logic
  kv-theme.js        — copied from StockAnalysis (local dev only)
  kv-banner.js       — copied from StockAnalysis (local dev only)
  logo.svg           — copied from StockAnalysis (local dev only)
tests/
  wacc.test.js       — 5 tests
  dcf.test.js        — 8 tests
  ddm.test.js        — 9 tests
```

### Script Load Order (must not change)
```html
config.js → utils.js → data.js → calc/wacc.js → calc/dcf.js → calc/ddm.js → chart.js CDN → chartjs-plugin-datalabels CDN → app.js
```

---

## Commands

```bash
npm test          # Run 22 unit tests (Node built-in runner): 5 wacc + 8 dcf + 9 ddm
npm run dev       # http-server www -p 8000 — open http://localhost:8000
```

Never open via `file://` — fetch() will break.

---

## Deploy

```powershell
xcopy /E /Y /I "C:\Projects\DCFAnalysis\www" "C:\Projects\StockAnalysis\www\dcf"
copy "C:\Projects\DCFAnalysis\www\dcf-icon.svg" "C:\Projects\StockAnalysis\www\dcf-icon.svg"
cd "C:\Projects\StockAnalysis"
git add www/dcf/ www/dcf-icon.svg
git commit -m "Deploy DCF tool update"
git push
```

Cloudflare Pages auto-deploys in ~1 min. Also need: hub card in `www/index.html`, sitemap entry, nav updates in all 10 tool pages + `kv-nav.js` + `www/budget/kv-nav.js`.

---

## DDM — Implemented (2026-05-30)

**Banks and insurers use DDM instead of DCF.** Detection: `isBankOrInsurance(sector, industry)` in `utils.js` — matches `/bank|insurance/i` on Yahoo's industry field first, then sector as fallback.

### DDM formula (multi-stage)
```
PV of dividends years 1-N = Σ D_t / (1 + re)^t
Terminal value = D_N × (1 + g_terminal) / (re - g_terminal)
PV(TV) = TV / (1 + re)^N
Intrinsic Value = Σ PV(D) + PV(TV)        ← per share directly (no net debt step)
```

### Valuation model branching (app.js)
- **Bank/insurer detected** → forced DDM, FCF inputs hidden, "🏦 Dividend Discount Model" notice shown
- **Other dividend-paying stock** → DCF default, optional "Value with DDM instead →" toggle
- **No dividend** → DDM inputs shown but scenario cards show "DDM needs a dividend" message

### Test benchmarks
- **QBE.AX**: D0 ~$1.09 AUD, re ~7.2% (after beta floor), g ~3% → intrinsic ~$23 AUD ✅ fairly valued vs $22.64
- **CBA.AX**: D0 ~$4.65 AUD, re ~8–9%, g ~2–4% → intrinsic ~$98–143 AUD vs market $165 → overvalued

---

## Known Issues / Design Decisions

- `formatMoneyInput` is NOT applied to the main FCF input — it strips minus signs, and Yahoo can return negative FCF for financial companies. Normalised FCF input uses the formatter (must be positive).
- When FCF is negative, normalised FCF field starts **empty** (not pre-filled). User must enter a positive sustainable estimate.
- Sector detection: `isBankOrInsurance()` matches `/bank|insurance/i` on industry first, then sector. Other financial-sector stocks (asset managers, exchanges, fintechs like Visa) keep the DCF + normalised-FCF + warning path.
- Live US 10-yr Treasury yield fetched via `^TNX` through the Worker on page load. Silently falls back to 4.5% if unavailable.
- Chart colours: stacked bar uses green (FCF/dividends) + orange (terminal value). Orange signals that terminal value is the uncertain component.
- `chartjs-plugin-datalabels` loaded via CDN — shows values directly on bars.
- DDM: non-bank dividend-paying stocks (e.g. AAPL) get a **"Value with DDM instead →"** toggle in the inputs panel. Default remains DCF.
- DDM: no-dividend bank/insurer shows multiples panel + "DDM needs a dividend" message with no intrinsic value.
- **Negative equity value**: when DCF net debt exceeds firm value (e.g. capital-heavy conglomerates like RELIANCE.NS), `calculateDCF` returns `null` intrinsicValue with `negativeEquity: true`. Scenario cards show a plain-English message instead of a nonsense negative share price. This is the correct outcome — DCF on current FCF alone cannot justify the price; the market is pricing future growth.
- **CSS `[hidden]` override**: `.input-row { display: flex }` overrides the browser's built-in `[hidden] { display: none }`. Fixed with `[hidden] { display: none !important }` at top of `style.css`. Any future display-setting CSS class on a toggled element will need this rule to work correctly.
- **Projection year slider**: auto-recalculates on drag (no need to click Recalculate). All other inputs still require the Recalculate button.
- **RF rate live badge**: restructured label as flex row so "● live" appears inline with "Risk-free rate %", and a subtitle below the input confirms "US 10-yr Treasury yield (^TNX)".
- **ASX/NSE wrong-market error**: if a bare symbol (no `.` suffix) is searched with ASX or NSE ticked and any error occurs (404, 5xx, empty result), `app.js` replaces the generic Yahoo error with a targeted message: `"AAPL" was not found on the ASX. Untick "ASX stock" to search US or other stocks.` Yahoo returns 5xx (not 404) for invalid suffixes like `AAPL.AX`, so the check is `!isConnectivityError` rather than matching "not found". Genuine network errors ("Couldn't reach the data service") pass through unchanged. Same logic applied to `www/stock/app.js`.

---

## Yahoo Finance Data Notes

- `interestExpense` from Yahoo is **negative** (expense convention) — `calculateWACC` uses `Math.abs()`
- `debtToEquity` from Yahoo is a **percentage** (e.g. 53.2 means 53.2%) — divide by 100 before use
- `freeCashflow` may be null for some ASX stocks. `deriveFcf()` (utils.js) handles the fallback: reported FCF → else `operatingCashflow − |capitalExpenditures|` (real CapEx) → else `operatingCashflow × 0.8` as a last resort. The `× 0.8` proxy assumes CapEx ≈ 20% of OCF and overstates FCF for capital-intensive firms, so it's only used when CapEx is also missing. Badge shows ✓ Yahoo / ≈ OCF − CapEx / ⚠ rough est.
- `capitalExpenditures` from Yahoo is **negative** (outflow convention) — `deriveFcf` uses `Math.abs()`. Sourced from `cashflowStatementHistory.cashflowStatements[0]`.
- `incomeStatementHistory` was added to Worker MODULES on 2026-05-29; `cashflowStatementHistory` added 2026-05-30 (for real-CapEx FCF) — both require Worker redeploy
- **Beta for non-US stocks is measured vs S&P 500** — produces artificially low values for ASX, Indian, and other international stocks because their correlation to the US market is low. See section below.
- **UK stocks (GBp): Yahoo returns price in pence but dividend rates in GBP (pounds).** `data.js` detects `currency === 'GBp'` and multiplies `dividendRate` and `trailingAnnualDividendRate` by 100 so all values are consistently in pence. Without this fix, DDM intrinsic for LLOY.L showed p0.67 vs price p101.90 → -99% MoS instead of the correct ~67p vs 101.90p.

---

## WACC & Cost of Equity — Article Reference (consolidated)

> Everything the article needs on the discount rate, in one place. All implemented as of 2026-05-30.

### 1. The WACC formula (as implemented in `calc/wacc.js`)

```
Re   = RF + Beta × ERP                          (CAPM cost of equity)
Rd   = |interestExpense| / totalDebt + 0.5%     (cost of debt; +50bp new-issuance spread)
       └ falls back to 5.0% if interest/debt unavailable
Tc   = incomeTaxExpense / incomeBeforeTax        (from data.js; guarded > 0; default 25%)
WACC = (E/V)·Re + (D/V)·Rd·(1 − Tc)
       E = market cap, D = total debt, V = E + D
```

DCF discounts FCF at **WACC**. DDM (banks/insurance) discounts dividends at **Re only** — no debt component.

### 2. Market-specific risk-free rate (live, by ticker suffix)

| Market | Detection | Live source (via Worker) | Fallback |
|---|---|---|---|
| US / other | no `.AX`/`.NS`/`.BO` | US 10-yr Treasury `^TNX` | 4.5% |
| Australia | `.AX` | Australian 10-yr Govt Bond `^GSBG10.AX` | 4.8% |
| India | `.NS` / `.BO` | Indian 10-yr Govt Bond `^INBMKG10.NS` | 7.0% |

Fetched on stock load. The RF input shows a live badge (`● live` / `● live AUS` / `● live IND`). The "↺ Reset to defaults" button restores the **market-appropriate** RF + MRP, not always the US values.

### 3. Market Risk Premium (MRP / ERP) defaults

| Market | Default seed | Typical range | Basis |
|---|---|---|---|
| US / other | 5.5% | 4–6% | Damodaran long-run US historical premium (since 1928) |
| Australia | 6.0% | 5.5–6.5% | Developed, AAA-rated; lower than emerging markets |
| India | 7.5% | 7–9% | Emerging-market premium (political + currency risk) |

A 1% change in ERP flows directly into Re → for DDM it changes the (Re − g) denominator and can shift intrinsic value by **15–25%**.

### 4. Beta floor — the problem

Yahoo Finance computes beta by regressing a stock's returns against the S&P 500. For US stocks this is correct. For non-US stocks it systematically **understates risk**:

- **QBE.AX** (global insurer, ASX-listed): Yahoo beta = 0.17. This gives Re = 4.46% + 0.17 × 5.5% = **5.4%** — barely above the risk-free rate. A global insurer exposed to catastrophe risk should have a cost of equity of 8–10%, not 5.4%.
- **Root cause**: QBE's share price has low correlation with the S&P 500 — not because the stock is low-risk, but because Australian equities don't move in lockstep with US equities. The beta is measuring correlation to the wrong index.
- **Impact on DDM**: with Re = 5.4% and terminal growth = 2.5%, the denominator (Re − g) = 2.9%. A tiny denominator makes the terminal value enormous and inflates intrinsic value to unrealistic levels.

### The fix (implemented 2026-05-30)

`utils.js` → `getMarketBetaFloor(ticker)`: applies a minimum beta when seeding both **WACC (DCF)** and **cost-of-equity (DDM)** inputs, based on the ticker suffix:

| Market | Detection | Beta floor | Rationale |
|---|---|---|---|
| US | no `.` suffix | none | Yahoo beta vs S&P 500 is correct by definition |
| ASX | `.AX` | 0.5 | ASX financials typically 0.6–1.0 vs ASX 200 |
| India | `.NS` / `.BO` | 0.6 | Low India–US correlation; Nifty financials higher systematic risk |
| Other int'l | any other suffix | 0.5 | Conservative floor for `.L`, `.HK`, `.DE`, etc. |

**Scope**: the floor affects the **initial seed values** for WACC (DCF) and cost-of-equity (DDM) inputs. Users can override all inputs directly. When the floor is applied, an amber warning is shown in both the WACC breakdown and the DDM cost-of-equity breakdown panels.

**For emerging markets (India)**: the tool now seeds the Indian 10-yr G-Sec yield (~7%) as RF and a 7.5% MRP for `.NS`/`.BO` tickers, so WACC starts in a realistic 10–13% band rather than the old ~6%. Users can still raise it further for stock-specific country/execution risk. (Historical note: before the India market support was added, the tool used the US RF rate here and the breakdown warned users to raise WACC manually — that warning no longer applies.)

**For QBE.AX after fix**: beta floored 0.17 → 0.5, Re = 4.46% + 0.5 × 5.5% = **7.21%**. DDM intrinsic now in a sensible range (~$23 AUD base).

**For RELINFRA.NS after fix**: beta floored to 0.6, WACC seeded ~8–9% (was ~5.9%). Note: FCF may be inflated by asset disposal proceeds — users should verify before relying on the output.

### Dividend growth cap (also 2026-05-30)

`deriveDividendGrowth()` caps at **6%** (was 10%). Insurance and bank earnings are volatile — a strong underwriting or credit year can push `earningsGrowth` to 20–30% on Yahoo, which was bleeding through into a 10% dividend growth seed. Mature financials don't grow dividends anywhere near that fast; 3–6% is the realistic range.

### Equity Risk Premium (ERP) — article note

The ERP input defaults to **5.5%** — the long-run US historical equity premium from Damodaran's data (excess return of stocks over bonds since 1928). It is not calculated from live data. Guidance for adjustment:

- **Stable developed markets** (US, Australia, UK, Germany): 4–6%
- **Emerging markets** (India, Brazil, Indonesia): 7–9% (higher political and currency risk)
- **For Australian stocks specifically**: Damodaran's implied ERP for Australia is typically 5–6%, so the 5.5% default is reasonable. Some analysts use 6% for ASX to capture the franking-credit distortion in dividend yields.

This distinction matters significantly for DDM: a 1% change in ERP flows directly into Re, which changes the (Re − g) denominator and can shift intrinsic value by 15–25%.

### Sector WACC reference ranges (shown read-only in the breakdown panel)

The breakdown shows a "<market> sector reference: X–Y% (label)" line, matched on Yahoo sector/industry. These are guidance only — they do not change the calculated WACC.

**US** (`getUsSectorWaccRange`):

| Sector | Range | Why |
|---|---|---|
| Technology & Software | 8.5–10.5% | High equity betas, negligible long-term leverage |
| Biotech & Pharmaceuticals | 8.0–10.0% | Pipeline risk tempered by stable healthcare demand |
| Retail & Apparel | 7.5–8.5% | Macro-cycle sensitive, softened by lease structures |
| Aerospace & Defense | 7.0–8.0% | Multi-year government backlogs, predictable cash |
| Energy & Oil / Gas | 6.5–7.5% | Volatile earnings balanced by heavy debt use |
| Real Estate (REITs) | 6.5–7.5% | Tangible rental assets + cheap leverage |
| Regulated Utilities | 5.5–6.5% | Lowest risk tier; guaranteed rate returns |

**Australia / ASX** (`getAsxSectorWaccRange`):

| Sector | Range | Why |
|---|---|---|
| Banking & Financials | 8.5–9.5% | Regulated, large asset bases, credit/macro cycle exposure |
| Mining & Resources | 10.0–12.0% | Cyclical commodities, heavy capex, high asset beta |
| Real Estate (A-REIT) | 7.5–9.0% | Predictable lease income + cheap corporate debt |
| Healthcare & Biotech | 8.5–10.0% | Capital-light global earnings; small caps higher |
| Utilities & Infrastructure | 6.5–8.0% | Regulated monopolies, inflation-linked cash, cheap debt |

**India** (`getIndianSectorWaccRange`):

| Sector | Range | Why |
|---|---|---|
| IT & Software | 11.0–14.0% | High beta, high growth, near-zero debt — relies on costly equity |
| FMCG & Consumer Staples | 9.0–11.0% | Low beta, stable demand, low debt |
| Utilities & Infrastructure | 8.0–10.0% | Capital-intensive but heavy low-cost long-term debt |
| Pharmaceuticals & Healthcare | 10.0–12.0% | Moderate R&D risk, steady demand, low-moderate leverage |
| Commodities (Steel/Oil/Mining) | 11.0–13.0% | Cyclical, volatile global prices raise cost of equity |
| Banking & Financial Services | 10.0–12.0% | Regulated, credit-cycle exposed |

### Franking credits (Australia — informational only)

For ASX stocks the breakdown shows a collapsible "Franking credits (dividend imputation)" note. Australia's dividend imputation system passes corporate tax credits to shareholders. The ACCC values Gamma (γ) at **0.4–0.5**. Including it lowers the effective tax rate: `Tc_eff = Tc × (1 − γ)`, which reduces post-tax WACC by roughly 0.3–0.8%. **The tool does NOT apply this** — it stays on standard post-tax WACC conservatively, as most retail investors do. The note explains the adjustment for users who want to make it themselves.

### Live recompute behaviour (`recomputeDiscount` in app.js)

Editing the RF rate or ERP inputs live-updates the Bear/Base/Bull WACC (or DDM cost-of-equity) seeds, debounced ~350ms. It re-derives Re explicitly (`rf + effectiveBeta × erp`) and the full WACC, and refreshes the breakdown panel — but does **not** re-run the scenario cards mid-edit (that would flash partial valuations). Full re-render happens on the Recalculate button or the RF/ERP reset button.

---

## Spec and Plan

- Design spec: `C:\Projects\StockAnalysis\docs\superpowers\specs\2026-05-29-dcf-tool-design.md`
- Implementation plan: `C:\Projects\StockAnalysis\docs\superpowers\plans\2026-05-29-dcf-tool.md`
