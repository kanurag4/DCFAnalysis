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
| Phase 6 — Local testing | ⏳ **Next up — start here tomorrow** |
| Phase 7 — Icon (`dcf-icon.svg`) | ⏳ Pending |
| Phase 8 — Deploy | ⏳ Pending |

**Tomorrow's agenda:**
1. Implement DDM (Dividend Discount Model) for banking and insurance stocks — replaces DCF for these sectors entirely (see section below)
2. Run Phase 6 local testing against: AAPL, BHP.AX, QBE.AX (insurance), CBA.AX (bank), RELIANCE.NS, mobile layout, light mode, edge cases
3. Fix any issues found, then proceed to Phase 7 (icon) and Phase 8 (deploy)

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
  utils.js           — safe(), fmt(), formatMarketCap(), escapeHtml(), isFinancialSector(), isRealEstateSector(), deriveBaseGrowth()
  data.js            — fetchDCFData() — DOM-free
  calc/
    wacc.js          — calculateWACC() — pure, Node-testable
    dcf.js           — calculateDCF() — pure, Node-testable
  app.js             — ALL DOM logic
  kv-theme.js        — copied from StockAnalysis (local dev only)
  kv-banner.js       — copied from StockAnalysis (local dev only)
  logo.svg           — copied from StockAnalysis (local dev only)
tests/
  wacc.test.js       — 5 tests
  dcf.test.js        — 8 tests
```

### Script Load Order (must not change)
```html
config.js → utils.js → data.js → calc/wacc.js → calc/dcf.js → chart.js CDN → chartjs-plugin-datalabels CDN → app.js
```

---

## Commands

```bash
npm test          # Run 13 unit tests (Node built-in runner)
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

## ⚠️ Tomorrow: DDM for Banking & Insurance

**Do NOT use DCF for banks or insurance companies.** Traditional FCF-based DCF is structurally broken for these sectors:

- **Banks:** "debt" (deposits) is a raw material, not a funding source. No clear FCF. WACC cannot be calculated in the standard way. Capital reinvestment is regulatory (CET1 ratios), not operational.
- **Insurance:** FCF includes large investment portfolio flows and reserve movements — not "owner earnings." The `freeCashflow` from Yahoo is meaningless for valuation.

### What to build instead

**For banking sector** (detect with `/bank|financial services/i` on sector):

Use the **Dividend Discount Model (DDM)** + banking-specific metrics.

DDM formula:
```
Intrinsic Value = D1 / (re - g)         ← Gordon Growth Model (terminal / single-stage)

Multi-stage:
  PV of dividends years 1-N = Σ D_t / (1 + re)^t
  Terminal value = D_N × (1 + g) / (re - g)
  PV(TV) = TV / (1 + re)^N
  Intrinsic Value = Σ PV(D) + PV(TV)
```

Where:
- `D1` = next year's expected dividend (from Yahoo: `summaryDetail.dividendRate` or `forwardAnnualDividendRate`)
- `re` = cost of equity from CAPM (same formula as WACC's Re: RF + Beta × ERP) — no debt component needed
- `g` = sustainable dividend growth rate (user input, seed from historical dividend growth or earningsGrowth)

Yahoo data fields needed (already fetched):
- `summaryDetail.dividendRate` — annual dividend per share
- `summaryDetail.dividendYield` — yield (can back-calculate dividend from price × yield)
- `defaultKeyStatistics.trailingAnnualDividendRate` — trailing 12-month dividend
- `beta` — for cost of equity
- `returnOnEquity` — key banking metric
- `priceToBook` — primary banking valuation multiple

Additional metrics to show for banks:
- P/B ratio (critical — below 1.0 = potential deep value)
- P/TBV (Price to Tangible Book) — strips goodwill/intangibles
- ROE vs cost of equity spread (excess returns model signal)
- NIM (Net Interest Margin) — not in current Yahoo fetch, may need to add or note N/A

**For insurance sector** (detect with `/insurance/i`):

Also use DDM (same formula as above). Additionally show:
- Combined Operating Ratio (COR) — not in Yahoo data, show N/A with explanation
- P/B ratio
- ROE
- Dividend yield + franking %

### CBA DDM example (for testing)
- Dividend: ~$4.65 AUD (FY25), forecast $5.15 FY26
- Cost of equity: ~8-9% (CAPM with beta ~0.7, RF ~4.5%, ERP 5.5%)
- Long-term growth: 2-4%
- DDM intrinsic: ~$98-143 AUD (vs market $165 → overvalued)

### QBE DDM example (for testing)
- Dividend: ~$1.09 AUD, 30% franked
- Cost of equity: ~8.5% (global catastrophe risk)
- Long-term growth: 3.5%
- DDM intrinsic: ~$23 AUD (vs market $22.64 → fairly valued)

### Implementation approach
1. Add `calculateDDM(inputs)` to `www/calc/ddm.js` (pure function, Node-testable)
2. Add DDM tests to `tests/ddm.test.js`
3. Add `ddm.js` to script load order in `index.html`
4. In `app.js`: when banking/insurance detected, hide DCF inputs and show DDM inputs instead
5. Scenario cards show DDM intrinsic values with same Bear/Base/Bull structure (vary growth rate and cost of equity)
6. Keep the alternative multiples panel (P/B, ROE, P/E, Dividend Yield)
7. Show clear explanation: "DCF is not used for [Bank/Insurance] stocks. Using Dividend Discount Model (DDM) instead."

### Data already available in data.js
- `dividendYield` ✅ (from `summaryDetail.dividendYield`)
- `beta` ✅
- `price` ✅ — can derive dividend as `price × dividendYield`
- `returnOnEquity` ✅
- `priceToBook` ✅
- `earningsGrowth` ✅ — seed for dividend growth rate
- `trailingPE` ✅

May need to add to `data.js`:
- `summaryDetail.dividendRate` (explicit annual dividend per share — cleaner than price × yield)
- `defaultKeyStatistics.trailingAnnualDividendRate`
- `defaultKeyStatistics.trailingAnnualDividendYield`

---

## Known Issues / Design Decisions

- `formatMoneyInput` is NOT applied to the main FCF input — it strips minus signs, and Yahoo can return negative FCF for financial companies. Normalised FCF input uses the formatter (must be positive).
- When FCF is negative, normalised FCF field starts **empty** (not pre-filled). User must enter a positive sustainable estimate.
- Sector detection: `isFinancialSector()` matches `/financial|insurance/i`. Tomorrow extend to also catch `bank` explicitly.
- Live US 10-yr Treasury yield fetched via `^TNX` through the Worker on page load. Silently falls back to 4.5% if unavailable.
- Chart colours: stacked bar uses green (FCF) + orange (terminal value). Orange signals that terminal value is the uncertain component.
- `chartjs-plugin-datalabels` loaded via CDN — shows values directly on bars.

---

## Yahoo Finance Data Notes

- `interestExpense` from Yahoo is **negative** (expense convention) — `calculateWACC` uses `Math.abs()`
- `debtToEquity` from Yahoo is a **percentage** (e.g. 53.2 means 53.2%) — divide by 100 before use
- `freeCashflow` may be null for some ASX stocks — falls back to `operatingCashflow × 0.8`
- `incomeStatementHistory` was added to Worker MODULES on 2026-05-29 for this tool

---

## Spec and Plan

- Design spec: `C:\Projects\StockAnalysis\docs\superpowers\specs\2026-05-29-dcf-tool-design.md`
- Implementation plan: `C:\Projects\StockAnalysis\docs\superpowers\plans\2026-05-29-dcf-tool.md`
