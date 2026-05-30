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
| Phase 8 — Deploy | ⏳ Pending — not started; awaiting go-ahead |

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

**Next up (when ready): Phase 7 — Icon, Phase 8 — Deploy. Do not proceed until asked.**

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

---

## Yahoo Finance Data Notes

- `interestExpense` from Yahoo is **negative** (expense convention) — `calculateWACC` uses `Math.abs()`
- `debtToEquity` from Yahoo is a **percentage** (e.g. 53.2 means 53.2%) — divide by 100 before use
- `freeCashflow` may be null for some ASX stocks — falls back to `operatingCashflow × 0.8`
- `incomeStatementHistory` was added to Worker MODULES on 2026-05-29 for this tool
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
