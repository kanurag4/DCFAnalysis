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
| Phase 6 — Local testing + bug fixes | ⏳ In progress — resume here |
| Phase 7 — Icon (`dcf-icon.svg`) | ⏳ Pending |
| Phase 8 — Deploy | ⏳ Pending |

**Remaining Phase 6 test cases:**
- AAPL (US, DCF + optional DDM toggle)
- BHP.AX (ASX, plain DCF)
- CBA.AX (bank DDM)
- Mobile layout (390px)
- Light mode
- Invalid ticker / network error

**Already tested and fixed (2026-05-30):**
- QBE.AX ✅ — DDM beta floor, dividend growth cap
- LLOY.L ✅ — GBp currency unit mismatch fixed
- RELINFRA.NS ✅ — WACC beta floor extended to DCF
- RELIANCE.NS ✅ — negative equity handled gracefully

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

## DDM Beta Floor — Non-US Markets (Article Reference)

### The problem

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

**For emerging markets (India)**: even with the beta floor, WACC for Indian stocks may still be seeded too low because the tool uses the US risk-free rate (~4.5%) instead of the Indian G-Sec yield (~7%). Users analysing Indian stocks should manually raise WACC to 12–15% to account for country risk premium. The breakdown warning message notes this explicitly.

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

---

## Spec and Plan

- Design spec: `C:\Projects\StockAnalysis\docs\superpowers\specs\2026-05-29-dcf-tool-design.md`
- Implementation plan: `C:\Projects\StockAnalysis\docs\superpowers\plans\2026-05-29-dcf-tool.md`
