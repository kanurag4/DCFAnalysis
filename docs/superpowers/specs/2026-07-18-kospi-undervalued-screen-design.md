# Design — Korea market support + Most Undervalued KOSPI 200 Screen

**Date:** 2026-07-18
**Status:** Approved (design)
**Repo:** `C:\Projects\DCFAnalysis` → deploys to `kashvector.com/dcf/kospi-undervalued/`
**Background research:** `docs/japan-korea-market-research.md` — read first; this spec assumes
its findings (feasibility spot-check, RF-ticker search, chaebol-affiliate empirical finding).

## Summary

Two coupled pieces of work, both scoped to **Korea only** — Japan/Nikkei is a separate, still-
open decision and is explicitly out of scope here (its own exploratory pass is tracked in the
research doc, not this spec).

1. **Spec A — Korea market support in the core DCF tool.** Adds `.KS` ticker detection to
   `market.js`, `utils.js`, and `app.js`'s prefill logic: static risk-free rate, elevated ERP
   (governance-risk premium), raised beta floor, and — new to the tool — a **per-market terminal
   growth seed** (today a single hardcoded 2.5% constant shared by every market).
2. **Spec B — Most Undervalued KOSPI 200 screen**, a fourth ranking page sibling to ASX 300 /
   S&P 500 / NIFTY 500, following the exact same `runScreen()` orchestrator pattern — **plus one
   new mechanism no existing screen has**: a **chaebol-affiliate flag**, because Korea's
   related-party-transaction risk is common enough (unlike ASX's handful of REITs) that a
   maintained annotation list is needed from day one, not discovered reactively.

Both pieces are validated against real data already: a 6-ticker feasibility spot-check, an
exhaustive search for a live Korean bond-yield ticker (none found), and a full 199-ticker
exploratory run against the proposed parameters (13 qualified, 25% hit the margin cap — see
research doc for the empirical funnel and the chaebol-affiliate concentration finding).

## Decisions (from brainstorming)

1. **Separate page**, not a tabbed view — same reasoning as every prior screen (SEO, zero
   regression risk to existing pages, own `rankings.json`/`first-seen.json`).
2. **RF is a static fallback, not live-fetched.** Exhaustive search (13 ticker guesses through
   the Worker, direct Yahoo Finance verification, two rounds of web search) found no working
   Yahoo symbol for a Korean 10-yr government bond yield — unlike `^GSBG10.AX` / `^INBMKG10.NS`,
   which work because they're actual exchange-listed index products. `marketParamsFor()` returns
   a fixed 4.3% for `.KS` with no live-fetch attempt (contrast: India's RF *does* attempt a live
   fetch and falls back silently — Korea skips the attempt entirely since no ticker exists to try).
3. **ERP = 7.5%**, elevated above the 5.5–6.0% developed-market tier specifically to reflect a
   1–3% governance-risk premium (per user-supplied research on weak minority-shareholder
   protections) — landing at the same number as India's but for a different underlying reason,
   documented separately in each market's info panel.
4. **Beta floor = 0.6** (matches India, not the lower 0.5 "other international" default).
5. **Terminal growth seed = 1.75%** (below the tool's current flat 2.5% used by every market
   today). First market-specific terminal-growth seed the tool has ever had — see Architecture
   for why this requires a new plumbing path, not just a new constant.
6. **Chaebol flag is additive, not exclusionary.** A maintained list (same curation pattern as
   the existing `blacklist` arrays) tags known chaebol-affiliate tickers; flagged stocks **stay
   on the list** with an asterisk + tooltip + footnote, mirroring the existing `highLeverage`
   flag's rendering exactly. Name-pattern heuristics were considered and rejected — Hotel
   Shilla (008770.KS, a Samsung Group company) carries no "Samsung" in its name, which is
   precisely the failure mode a heuristic would have missed.
7. **Strengthened disclosures are a first-class requirement**, not an afterthought: the top
   editorial paragraph gets a Korea-specific addition, and a new collapsible "About the Korea
   numbers" panel (mirroring the existing AUS franking-credits panel) explains the governance
   premium, the static RF, the lower growth seed, and — critically — what the chaebol flag does
   and does not mean (flagged ≠ bad company; unflagged ≠ verified clean).

## Architecture

### Reused unchanged
- `www/calc/{wacc,dcf,ddm}.js`, `www/data.js` — pure, already market-agnostic.
- `scripts/lib/rank.js` (`rankRows`, `rankFunnel`) — market-agnostic; the chaebol flag is
  attached to rows *after* ranking, not a ranking criterion.
- `scripts/lib/firstSeen.js`, `scripts/fetch-yahoo.js`, `scripts/lib/portfolio.js`,
  `scripts/lib/run-screen.js` (`runScreen`) — the shared orchestrator every screen already uses.
- `isBankOrInsurance` / `isFinancialSector` (`www/utils.js`) — sector/industry regex, already
  market-agnostic; Korean banks (e.g. KB Financial) will correctly route to DDM without changes.

### New / changed

**`scripts/lib/market.js`** (`marketParamsFor`) — add a `.KS` branch:
```js
if (t.endsWith('.KS')) return { rf: live.krRf ?? 0.043, erp: 0.075, terminalGrowth: 0.0175 };
```
This is the first branch to return `terminalGrowth` — every other branch must gain the same key
(defaulting to the current 2.5%) so `evaluate.js` has one consistent shape to read from:
```js
if (t.endsWith('.AX')) return { rf: live.ausRf ?? 0.048, erp: 0.06, terminalGrowth: 0.025 };
if (t.endsWith('.NS') || t.endsWith('.BO')) return { rf: live.indRf ?? 0.07, erp: 0.075, terminalGrowth: 0.025 };
if (!t.includes('.')) return { rf: live.usRf ?? 0.045, erp: 0.055, terminalGrowth: 0.025 };
return { rf: live.usRf ?? 0.045, erp: 0.055, terminalGrowth: 0.025 }; // other international
```
No live RF fetcher is added for Korea (see Decision 2) — `live.krRf` will simply always be
`undefined`, so the `?? 0.043` fallback is the only path. `run-screen.js`'s `gather()` step
skips calling any `fetchKrRf`-style function; `rank-kospi.js`'s config has no `fetchRf` key
pointing at a live source, only the static value baked into `market.js`.

**`scripts/lib/evaluate.js`** — currently has a single module-level `const TERMINAL_GROWTH = 0.025`
used in both the DCF and DDM branches. Change to read from `params.terminalGrowth`, defaulting to
0.025 for backward compatibility with any caller not yet passing it:
```js
function evaluateStock(data, params) {
  const { rf, erp, terminalGrowth = 0.025 } = params;
  // ...replace both `terminalGrowth: TERMINAL_GROWTH` call sites with `terminalGrowth`
}
```
`run-screen.js` already passes `marketParamsFor(ticker, live)` straight into `evaluateStock` as
`params` (confirmed by reading the current call site), so once `market.js` returns
`terminalGrowth`, it flows through with no orchestrator changes needed.

**`www/utils.js`** (`getMarketBetaFloor`) — add a `.KS` branch:
```js
if (t.endsWith('.KS')) return 0.6;
```
Must be added **before** the existing `return 0.5;` catch-all for "other international", or
`.KS` tickers will silently match the wrong branch.

**`www/app.js`** — three places already branch on ticker suffix for AUS/IND-specific behaviour
(RF prefill, ERP prefill, live-RF badge label, sector-WACC-range lookup call). Each needs a `.KS`
case:
- RF/ERP prefill: seed 4.3% / 7.5% instead of falling through to the US defaults.
- Live-RF badge: Korea shows **no** "● live" badge (unlike US/AUS/IND) — the input is prefilled
  but not marked live, since there's genuinely no live source. This is a new badge state, not
  reuse of the existing live/fallback distinction (AUS/IND *always* show "● live" even when the
  fetch silently fell back — Korea must not claim that).
- Sector-WACC-range panel: **skipped for Korea** — no `getKoreanSectorWaccRange` is built (YAGNI,
  matches the Spec A decision to defer sector ranges; see research doc).
- `CURRENCY_SYMBOLS`: add `KRW: '₩'`.
- Terminal-growth input seeding (bear/base/bull `tgrowth`): currently a flat `2.5` for every
  market in `modelSeeds`. Needs to read a market-derived value — reuse `marketParamsFor`'s new
  `terminalGrowth` field (already computed for the RF/ERP seed step) rather than introducing a
  second lookup.

**`scripts/rank-kospi.js`** (new) — thin config wrapper over `runScreen`, same shape as
`rank-nifty.js`:
```js
const config = {
  universe: 'KOSPI 200',
  tickersFile: 'kospi200.json',
  outDir: 'kospi-undervalued',
  currency: 'KRW',
  liveKey: 'krRf',        // present for shape consistency; always undefined, see Decision 2
  fetchRf: null,           // no live fetcher — market.js's static fallback is the only source
  rfLabel: 'KOR RF',
  topN: 20,
  maxMargin: 0.8,
  chaebolAffiliates: {     // NEW field — see below
    '008770.KS': 'Samsung Group',
    '071970.KS': 'Hyundai Heavy Industries Group',
    '028050.KS': 'Samsung Group',
    // seeded from the exploratory run's top 13; expand as new names enter the list
  },
  blacklist: [],            // empty at launch; same reactive-curation pattern as other screens
  startingValue: 10000000,  // ₩10,000,000 seed — at typical KRW/USD rates (~1,300–1,400) this
                             // lands in the same real-value ballpark as the $10K ASX/S&P seeds
                             // and India's ₹1L seed, rather than copying either number verbatim
  indexTicker: '^KS200',
  indexName: 'KOSPI 200',
  cacheFile: '_evaluated-kospi.json',
  rawFile: '_raw-kospi.json',
};
```

**`scripts/lib/run-screen.js`** — one new step: after `rankRows` produces the top-20, map
`config.chaebolAffiliates[row.ticker]` onto each row as `row.chaebolGroup` (string or absent),
mirroring exactly how `highLeverage: true` is already attached post-evaluation in
`evaluate.js`/passed through by `run-screen.js` today. No ranking-order effect — purely an
annotation, same as Decision 6.

**`scripts/kospi200.json`** (new ticker list) — built from the Wikipedia KOSPI 200 constituent
table (raw wikitext parse, same technique as the exploratory script), via a new
`scripts/build-kospi200.js` following the `build-nifty500.js` precedent. 199 of 200 resolved
cleanly in the exploratory pass; the 1 gap should be investigated and fixed during the build
(likely a parsing edge case, not a missing company).

**`www/kospi-undervalued/`** (new page) — copy of `www/nifty-undervalued/` structure
(`index.html`, `style.css`, `app.js` sharing the common ranking-page pattern), with:
- Currency `₩`, columns identical to the other three screens.
- Chaebol flag rendering: asterisk on ticker + `.tip`-style hover tooltip naming the group +
  amber footnote when any flagged stock is present — literally copy the existing `highLeverage`
  rendering block in `app.js` and adjust the copy/condition (`row.chaebolGroup` instead of
  `row.highLeverage`).
- Top editorial paragraph: existing boilerplate + the Korea-specific sentence (see brainstorming
  transcript for exact copy — governance/chaebol risk, static RF disclosure).
- New collapsible "About the Korea numbers" section, placed alongside (not replacing) "How a
  stock makes this list" — covers governance premium, static RF, lower growth seed, and what the
  chaebol flag means/doesn't mean (see brainstorming transcript for exact copy).

## Data flow

Identical to the existing three screens — `runScreen(config)` → fetch/throttle → `evaluateStock`
per ticker (now Korea-aware via `marketParamsFor`) → attach `chaebolGroup` → `rankRows`/`rankFunnel`
→ write `rankings.json` + merge `first-seen.json` → (full-fetch only) `updatePortfolio` +
`appendPortfolioHistory`. No new data-flow shape — the chaebol annotation is the only structural
addition, and it's a pure post-processing step.

## Error handling / edge cases

- **No live RF fetch attempted for Korea** (Decision 2) — `run-screen.js`'s `gather()` must
  tolerate `config.fetchRf === null` and skip straight to the static `market.js` value, rather
  than crashing on calling `null()`. This is a real code path change, not just a config value —
  confirm `run-screen.js` handles a null `fetchRf` gracefully before first run (currently every
  other market always has a real fetcher).
- **New chaebol name discovered post-launch** (a currently-unflagged name turns out to be a
  chaebol affiliate) — same reactive-curation workflow as `blacklist`: add to
  `chaebolAffiliates` in `rank-kospi.js`, re-run `--rerank`. Not a publish-blocker; the tool
  already disclose that unflagged ≠ verified clean.
- **`.KS` ticker with `.KQ` (KOSDAQ) siblings** — the KOSPI 200 list is KOSPI-exchange only;
  `.KQ` (KOSDAQ) tickers are a different exchange and out of scope. `build-kospi200.js` must not
  accidentally pull in KOSDAQ-listed names.

## Deploy & discoverability

Same pattern as every prior screen: `xcopy` deploy with the drift-guard check
(`git status www/dcf` must show only intended files before committing — see the 2026-07-18
incident note in `CLAUDE.md`), hub card + `scripts/tools.json` entry +
`node scripts/generate-site-data.js`, `kv-nav.js` unaffected (ranking sub-screens aren't in the
top nav, same as the existing three), `privacy-site.html` network-requests list gains KOSPI.

## Refresh runbook (built last)

A `/refresh-kospi-undervalued` skill, modeled exactly on `/refresh-nifty-undervalued` — same
funnel/top-20 review checkpoint, same explicit-approval-before-publish rule, **plus one added
review step**: eyeball the chaebol-flagged names in the printed top-20 against the maintained
`chaebolAffiliates` list for completeness (a newly-qualified name that's actually a chaebol
affiliate but isn't yet in the list should be caught here, not discovered by a user).

## Out of scope (YAGNI)

- Japan/Nikkei — separate decision, tracked in the research doc, not this spec.
- Cycle-normalized FCF for cyclical/semiconductor sectors (Samsung, SK hynix) — cross-market
  feature, deferred.
- Implied-terminal-multiple sanity check (Terminal EV/EBITDA vs sector norms) — cross-market
  feature, deferred.
- Korean sector WACC reference panel (`getKoreanSectorWaccRange`) — informational-only, same
  treatment as the existing US/AUS/IND panels; not calculation-critical, add later if wanted.
- Automatic chaebol detection (name heuristics, ownership-graph lookups) — rejected in Decision 6;
  the maintained-list approach is the actual design, not a stopgap for a future automated version.
- Modeling future share-count changes (buybacks, treasury-share cancellation under Korea's
  "Value-Up" reform) — the tool doesn't model this for *any* market today; not a Korea-specific gap.

## Build order

1. `market.js` + `evaluate.js` terminal-growth plumbing (Spec A core) — unit-testable in
   isolation, de-risks everything downstream.
2. `utils.js` beta floor + `app.js` prefill/badge/currency changes (Spec A, live tool) — manual
   spot-check against a real `.KS` ticker (e.g. 005930.KS) in the live tool once deployed.
3. `build-kospi200.js` + `scripts/kospi200.json` — fix the 1-name gap found in exploration.
4. `run-screen.js` null-`fetchRf` handling + `chaebolGroup` attachment.
5. `rank-kospi.js` config, first full-fetch run (reuse `explore-kospi.js`'s validated parameters
   — should reproduce the same top-13 modulo the 1 missing ticker and any live-price drift since
   2026-07-18).
6. `www/kospi-undervalued/` page (copy NIFTY's structure, adapt currency/copy/chaebol rendering).
7. Disclosure copy (editorial paragraph + "About the Korea numbers" panel).
8. Hub/nav/sitemap/privacy-policy wiring.
9. `/refresh-kospi-undervalued` skill.

Delete `explore-kospi.js`, `kospi200-list.json`, `_explore-kospi-evaluated.json`,
`parse-kospi.js`, `kospi200.wiki` (repo-root throwaway files) once step 5 supersedes them.
