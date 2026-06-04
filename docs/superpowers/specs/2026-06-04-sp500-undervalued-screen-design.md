# Design — Most Undervalued S&P 500 Screen

**Date:** 2026-06-04
**Status:** Approved (design)
**Repo:** `C:\Projects\DCFAnalysis` → deploys to `kashvector.com/dcf/sp500-undervalued/`

## Summary

Extend the existing "Most Undervalued ASX 300" screen to a second market: the
**S&P 500**, published as a **separate page** at `/dcf/sp500-undervalued/`. It
reuses the live DCF tool's pure calc modules and the ASX batch's
fetch/throttle/rank/funnel logic unchanged — only the ticker universe, the
risk-free source, the output directory, the currency label, and the page copy
differ.

The screen ranks every S&P 500 company by **base-case margin of safety**
(intrinsic value above current price) using a 5-year DCF — or DDM for
banks/insurers — and shows the **top 20** at an **≤80% margin cap**, identical
rules to the ASX screen.

## Decisions (from brainstorming)

1. **Separate page**, not a tabbed/toggle view. Cleanest SEO (own
   title/keywords/sitemap entry), zero regression risk to the live ASX page,
   each market keeps its own `rankings.json` / `first-seen.json`.
2. **Ticker list source:** `stockanalysis.com/list/sp-500-stocks/` (502 names,
   single page, includes legitimate dual share classes GOOGL/GOOG, FOX/FOXA,
   NWS/NWSA). Generated into `scripts/sp500.json` now; refreshed manually when
   the index reconstitutes (same cadence as the ASX quarterly `build-list.js`).
3. **Same selection rules:** `TOP_N = 20`, `MAX_MARGIN = 0.80`, undervalued +
   valuable + real-FCF only. `rankRows` reused unchanged. Review the funnel
   after the first run; re-tune instantly via `--rerank` if needed.
4. **WACC:** the batch already computes WACC exactly like the live `/dcf/` tool
   for US stocks — per-company **CAPM** via the shared `calculateWACC`
   (beta/debt/tax/rf/erp). `getUsSectorWaccRange` is **display-only** in the
   live tool and does **not** feed the calculation; the batch does not use it.
   **No methodology change.**

## Critical detail: ticker normalization (dot → dash)

stockanalysis.com writes class shares with a **dot** (`BRK.B`, `BF.B`). Yahoo
and the Worker proxy use a **dash** (`BRK-B`, `BF-B`). The build step **must**
convert dots to dashes, for two reasons:

1. Yahoo's `quoteSummary` only resolves the dash form.
2. `marketParamsFor` detects US tickers via `!ticker.includes('.')`. A dotted
   `BRK.B` would be misclassified as *international* and seeded with the wrong
   RF/ERP. `BRK-B` correctly classifies as US.

## Architecture

### Reused unchanged
- `www/calc/{wacc,dcf,ddm}.js`, `www/utils.js`, `www/data.js` — pure modules,
  already market-agnostic.
- `scripts/lib/evaluate.js` (`evaluateStock`) — market-agnostic; DCF vs DDM
  branch by sector; no US-specific work needed.
- `scripts/lib/rank.js` (`rankRows`, `rankFunnel`) — market-agnostic.
- `scripts/lib/firstSeen.js` (`mergeFirstSeen`).
- `scripts/fetch-yahoo.js` (`fetchSymbol`).
- `scripts/lib/market.js` (`marketParamsFor`) — already has a US branch
  (`!includes('.')` → US RF ~4.5% / ERP 5.5%, no beta floor).

### New / changed

**`scripts/lib/run-screen.js`** (new — extracted shared orchestrator)
Move the fetch/throttle/cooldown-sweep/funnel/round/write logic currently inside
`rank-asx.js` into a reusable `runScreen(config)` so both markets share the
hard-won rate-limit handling instead of copy-pasting it. Config shape:

```
runScreen({
  universe,      // 'ASX 300' | 'S&P 500'   → rankings.json universe label
  tickersFile,   // 'asx300.json' | 'sp500.json'
  outDir,        // 'asx-undervalued' | 'sp500-undervalued'
  currency,      // 'AUD' | 'USD'           → default row currency
  liveKey,       // 'ausRf' | 'usRf'        → key passed into marketParamsFor live{}
  fetchRf,       // async (proxyUrl) => decimal rate (fetchAusRf | fetchUsRf)
  rfLabel,       // 'AUS RF' | 'US RF'      → console label
  topN,          // 20
  maxMargin,     // 0.80
  cacheFile,     // per-market cache (scripts/_evaluated-asx.json / -sp500.json)
})
```

- Preserves `--rerank` (re-rank the per-market cache, no fetch).
- `THROTTLE_MS = 3200`, retry + 65s cooldown sweep — unchanged from ASX.
- Writes `www/<outDir>/rankings.json` (`{ asAt, universe, summary, rows }`) and
  merges `first-seen.json` — same shape as today.
- **Per-market cache file** so an ASX `--rerank` and an S&P 500 `--rerank` don't
  clobber each other (today's single `_evaluated.json` becomes
  `_evaluated-asx.json`).

**`scripts/rank-asx.js`** (refactor → thin wrapper)
Becomes a thin config calling `runScreen({ universe:'ASX 300',
tickersFile:'asx300.json', outDir:'asx-undervalued', currency:'AUD',
liveKey:'ausRf', fetchRf:fetchAusRf, ... })`. `fetchAusRf` (`^GSBG10.AX`) moves
into the wrapper or a shared `lib/rf.js`.
**Behaviour must be identical.** Verify with: `node scripts/rank-asx.js --rerank`
against the existing cached evaluated set and diff the regenerated
`rankings.json` against the committed one — instant, no re-fetch, proves the
live ASX monthly job is unchanged.

**`scripts/rank-sp500.js`** (new — thin wrapper)
Thin config calling `runScreen({ universe:'S&P 500',
tickersFile:'sp500.json', outDir:'sp500-undervalued', currency:'USD',
liveKey:'usRf', fetchRf:fetchUsRf, rfLabel:'US RF', topN:20, maxMargin:0.80 })`.

**`fetchUsRf(proxyUrl)`** (new) — fetch `^TNX` via the Worker, parse to a decimal
rate. **Mirror the live tool's existing `^TNX` parsing exactly** (the live DCF
tool already fetches `^TNX` and falls back to 4.5%). Read app.js's `^TNX`
handling and copy its divisor/scaling before finalizing, so batch and tool
agree. Sanity-clamp to a plausible band (e.g. 0 < r < 0.15), else 4.5% fallback.

**`scripts/build-sp500.js`** (new) — mirrors `build-list.js`. Reads a pasted
ticker list (text/CSV), normalizes dots→dashes, de-dupes, writes
`scripts/sp500.json`. For this first build, `sp500.json` is generated directly
from the already-fetched 502-name list.

**`www/sp500-undervalued/`** (new — near-copy of `asx-undervalued/`)
- `index.html` — copy with S&P 500 + USD copy: `<title>`, `<meta description>`,
  JSON-LD (`name`, `url`, `priceCurrency:'USD'`), H1 "Most Undervalued S&P 500",
  all "ASX 300" → "S&P 500", and a cross-link line near the top:
  *"Looking for Australian stocks? → Most Undervalued ASX 300"*.
- `app.js` — **copied as-is**. Loads its own `./rankings.json` +
  `./first-seen.json`; `row()` already defaults the currency symbol to `$`
  (correct for USD). Accepted duplication (static file; deploy xcopies the whole
  tree).
- `style.css` — copied as-is.

**`www/asx-undervalued/index.html`** (one-line add)
Reciprocal cross-link near the top: *"Looking for US stocks? → Most Undervalued
S&P 500"*.

## Data flow

```
sp500.json (502 US tickers, dash-normalized)
   │
   ▼  fetchUsRf(^TNX) → usRf
runScreen:  for each ticker
   fetchSymbol → mapQuoteSummary → evaluateStock(data, marketParamsFor(t,{usRf}))
   │                                  │ bank/insurer → DDM (re only)
   │                                  │ else          → DCF (CAPM WACC)
   ▼
rankRows(evaluated, {topN:20, maxMargin:0.80})  +  rankFunnel(...)
   ▼
www/sp500-undervalued/rankings.json  ({asAt, universe:'S&P 500', summary, rows})
www/sp500-undervalued/first-seen.json (merged ledger)
   ▼ (browser)
app.js → render table + best-effort live prices via Worker /quote
```

## Error handling / edge cases

- **Rate limit (Worker 20 req/60s):** 3.2s throttle + per-symbol retry + 65s
  cooldown sweep. Keep `rankFunnel.fetchFailed` ≈ 0. 502 × 3.2s ≈ **27 min** for
  a full run (expected, offline monthly batch).
- **Banks/insurers** (many in the S&P 500: JPM, BAC, WFC, etc.) → DDM; no
  dividend → excluded. Handled by `evaluateStock`.
- **No/negative FCF, negative equity** (e.g. capital-heavy names) → excluded by
  `calculateDCF` + `rankRows`.
- **Proxy-FCF (OCF×0.8)** rows dropped by the real-FCF filter.
- **`^TNX` unavailable** → 4.5% fallback (matches live tool).
- **Live prices** best-effort; fall back to snapshot price on failure.

## Deploy & discoverability

> **HARD GATE — no deployment until tested.** Nothing is xcopied to
> StockAnalysis or pushed until the batch output and the page have been verified
> locally and explicitly approved. Steps 1–5 (incl. local review) and a local
> page check come first; the deploy step (xcopy + sitemap + cross-links + push)
> is a separate, gated action taken only after sign-off.

- `xcopy www/ → StockAnalysis/www/dcf/` brings the new `sp500-undervalued/`
  folder along automatically.
- Add `https://kashvector.com/dcf/sp500-undervalued/` to `www/sitemap.xml`.
- Cross-links: DCF tool page → both screens; ASX screen ↔ S&P 500 screen.
- **Not** added to the cross-tool nav (content sub-page, same as the ASX
  screen).
- Verify `privacy-site.html` covers it (same Worker-network bucket as the DCF
  tool / ASX screen — likely already covered; bump "Last updated" if edited).

## Refresh runbook (built last)

`/refresh-sp500-undervalued` skill mirroring `/refresh-asx-undervalued`: run
`node scripts/rank-sp500.js` → review funnel + top-20 → approve → deploy.

## Out of scope (YAGNI)

- Tabbed/merged ASX+US view, market toggle.
- Live-scraping the constituent list inside the batch (fragile; manual refresh
  instead).
- Consolidating the two front-end `style.css`/`app.js` copies into shared files
  (would add regression risk to the live ASX page for a small DRY win).
- Changing WACC methodology to sector-driven (explicitly rejected — batch
  matches the live tool's CAPM).
- A companion S&P 500 article (separate follow-up, like the ASX article).

## Build order

1. `scripts/build-sp500.js` + generate `scripts/sp500.json` (dash-normalized).
2. Extract `scripts/lib/run-screen.js`; refactor `rank-asx.js` to a thin wrapper;
   **verify ASX `--rerank` output is byte-identical** to the committed
   `rankings.json`.
3. Add `fetchUsRf` (`^TNX`, divisor copied from app.js) + `rank-sp500.js`.
4. Run the full S&P 500 batch (~27 min); review the funnel.
5. Build `www/sp500-undervalued/` page (copy + retheme copy); add reciprocal
   cross-link to the ASX page.
6. Local check (`npm run dev`, open the page). **STOP — review with the user.**
7. **Only after explicit approval:** deploy (xcopy + sitemap + cross-links +
   push).
8. `/refresh-sp500-undervalued` skill.

**Testing gate.** Before any deploy: `npm test` (existing 22+ unit tests still
green after the orchestrator refactor), ASX `--rerank` byte-identical check
passes, the S&P 500 funnel looks sane (fetchFailed ≈ 0, plausible top-20), and
the page renders correctly in the local server (dark + light, mobile width).
Deployment happens in a later, separately-approved turn.
```
