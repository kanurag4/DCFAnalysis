# Paper Portfolio — Actual Dividends Design

**Date:** 2026-06-20
**Status:** Approved, ready for implementation plan
**Feature:** Add real dividend income to the $10K paper portfolio tracker on all three undervalued screens (ASX 300, S&P 500, NIFTY 500).

---

## Problem

The paper portfolio tracker currently measures **price return only**. Each monthly rebalance values holdings purely by price movement:

```js
currentValue = slotValue * (newPrice / oldPrice);
```

Dividends — a real and material part of total return, especially for ASX names — are entirely absent. The published article (`/articles/paper-portfolio-tracker/`) already discloses this as a known limitation and promises dividends "on the roadmap." This feature delivers that.

## Goal

Convert the tracker from price return to **total return** by crediting **actual dividend events** (real ex-dividend dates and per-share amounts from Yahoo) to each holding for the period it was held, reinvested equal-weight at the monthly rebalance. Surface a cumulative "Dividends earned" figure in the hero card.

## Decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Dividend model | **Actual dividend events** (ex-date + amount), not pro-rata accrual | Accurate to the cent; data is available and the per-month fetch volume is small (~20/market). |
| Backfill | **Going forward only** | Historical monthly holdings were not retained (`rankings.json` is overwritten each run), so past periods can't be reconstructed precisely. ~2 weeks of elapsed time carries negligible dividend activity. |
| Display | **Total return headline + distinct "Dividends earned" stat** | Headline becomes true total return; a separate hero stat shows cumulative dividend income so its contribution is visible. |
| Reinvestment | **Pooled and reinvested at rebalance** | Falls out of the existing equal-weight monthly-rebalance architecture — dividend cash joins the pool and is redistributed across the new list. |

## Out of scope (YAGNI)

- Franking credits / gross-up (cash dividends only).
- Ex-date precision finer than the monthly rebalance window.
- GBp pence/pounds handling — no `.L` tickers exist in these three universes.
- Backfilling the elapsed period since inception.

---

## Architecture

The change spans four layers. Each is independently testable.

### 1. Worker — new `/dividends` endpoint

File: `C:\Projects\StockAnalysis\worker\yahoo-proxy.js` (auto-deploys on push to `main`).

Add a route `/dividends/{symbol}?period1=<unix>&period2=<unix>` that proxies the Yahoo chart API:

```
https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?period1=<p1>&period2=<p2>&interval=1d&events=div
```

Returns a normalized array, newest-or-any order:

```json
[ { "date": "2026-06-25", "amount": 0.62 }, ... ]
```

Extraction: `chart.result[0].events.dividends` is an object keyed by unix timestamp, each `{ amount, date }`. Map to `{ date: toISODate(date), amount }`. Empty/missing events → `[]`.

- Reuses the existing crumb/cookie auth, CORS allowlist, and rate limiter.
- Same stale-crumb retry pattern as `/quoteSummary`.
- On Yahoo error: return `[]` with 200 (best-effort; a missing dividend history must not break a rebalance) — OR propagate 502 and let the caller treat failure as zero. **Chosen:** return `[]` on a non-OK Yahoo response so the batch degrades gracefully; only structural request errors surface as non-200.

### 2. Batch fetch helper — `scripts/lib/fetch-dividends.js`

Pure-ish fetch module mirroring `fetch-yahoo.js` conventions:

```
fetchDividends(symbol, fromISO, toISO, { proxyUrl, retries, backoffMs }) -> Promise<Array<{date, amount}>>
```

- Converts `fromISO`/`toISO` to unix seconds for `period1`/`period2`.
- Calls `${proxyUrl}/dividends/${encodeURIComponent(symbol)}?period1=&period2=`.
- Filters to ex-dates strictly after `fromISO` and on/before `toISO` (the rebalance window `(oldAsAt, asAt]`), so adjacent months neither overlap nor gap.
- Returns `[]` on failure (best-effort).

### 3. Orchestration — `updatePortfolio()` in `scripts/lib/run-screen.js`

Full-fetch mode only (unchanged: `--rerank` / `--reeval` never touch the portfolio).

Before calling `computeRebalance`:

1. If `oldPortfolio` exists and has holdings, for each `oldRow.ticker` fetch dividends in `(oldPortfolio.asAt, asAt]` via `fetchDividends`, throttled under the Worker's 20 req/60s cap (reuse `THROTTLE_MS`).
2. Build `dividendsByTicker = { [ticker]: totalPerShareAmount }` (sum of `amount` across events in window).
3. Pass `dividendsByTicker` into `computeRebalance`.
4. Log: `Dividends: credited $X across N holdings (M with payments)`.

First run (no `oldPortfolio`): skip the fetch entirely.

### 4. Pure rebalance — `scripts/lib/portfolio.js`

`computeRebalance(...)` gains a trailing `dividendsByTicker = {}` parameter.

For each `oldRow` in the held set:

```
shares  = slotValue / oldPrice           // implied shares for this period
divCash = shares * (dividendsByTicker[ticker] || 0)
totalPool += currentValue + divCash      // price movement + dividend cash
periodDividends += divCash
```

`divCash` is in the stock's currency = portfolio currency (per-share amount × shares), consistent with how price is handled.

Portfolio output gains a cumulative field:

```
dividendsTotal = +( (oldPortfolio.dividendsTotal || 0) + periodDividends ).toFixed(2)
```

First run: `dividendsTotal: 0`.

Sold stocks are still in `oldRows`, so they receive their final-period dividends before exit. The `sold` array shape is unchanged.

**Backward compatibility:** with `dividendsByTicker = {}` (or omitted), `divCash` is always 0 and `dividendsTotal` accumulates 0 — output is byte-identical to the current behaviour. Existing tests must pass unchanged.

### 5. Front-end — hero "Dividends earned" stat

Files: `www/{asx,sp500,nifty}-undervalued/app.js` + `style.css` (three identical copies).

- Headline value/percent already become total return for free: the live hero value is derived from `portfolioData.value`, which now bakes in dividend cash at each rebalance.
- Add a distinct hero element rendering `portfolioData.dividendsTotal`:
  `Dividends earned: <sym><amount></sym>` (e.g. `Dividends earned: $142`).
- **Omit the element when `dividendsTotal` is absent or `0`** — it appears only after the first dividend-bearing rebalance, so the going-forward-only choice is visible, not a confusing `$0`.
- Currency symbol from `rows[0].currency` (existing pattern: `₹` for INR, else `$`).

---

## Data flow

```
full fetch
  └─ gather()                 fetch 300/500 tickers, evaluate, write caches
  └─ rankAndWrite()           write rankings.json (overwrites old)
  └─ updatePortfolio()
       read oldPortfolio, oldRows (pre-overwrite snapshot passed in)
       for each oldRow: fetchDividends(ticker, oldAsAt, asAt)   ← NEW (~20 fetches)
       computeRebalance(..., dividendsByTicker)                 ← div cash → pool
         portfolio.value         includes dividend cash (total return)
         portfolio.dividendsTotal cumulative since inception
       write portfolio-value.json, sold.json
```

## `portfolio-value.json` schema change

Add one field (additive, backward-compatible):

```json
{
  "value": 10680.45,
  "N": 20,
  "asAt": "2026-06-19",
  "startedAt": "2026-06-04",
  "startingValue": 10000,
  "dividendsTotal": 0,
  "indexSeedPrice": 8911.1,
  "indexName": "ASX 200",
  "indexTicker": "^AXJO"
}
```

Existing files without `dividendsTotal` are treated as `0` by both the batch (`oldPortfolio.dividendsTotal || 0`) and the front-end (omit-when-absent).

## Error handling

| Failure | Behaviour |
|---|---|
| Dividend fetch fails for a ticker | Treat as zero dividends for that ticker; log count. Rebalance proceeds. |
| Yahoo returns no dividend events | `[]` → zero cash. Normal for non-payers. |
| Worker `/dividends` non-OK | Returns `[]` (best-effort). |
| First run / no old portfolio | No dividend fetch; `dividendsTotal: 0`. |
| `--rerank` / `--reeval` | Portfolio untouched (unchanged). |

## Testing

`tests/portfolio.test.js` (Node built-in runner) — new cases:

1. **Crediting:** a held stock with a dividend raises `portfolio.value` by `shares × amount` vs the no-dividend baseline.
2. **Accumulation:** `dividendsTotal` = prior total + this period's dividend cash.
3. **Backward compat:** omitting `dividendsByTicker` yields output identical to the pre-feature function (guards the existing 95 portfolio tests).
4. **First run:** `dividendsTotal === 0`, no crediting.
5. **Sold stock dividends:** a stock that exits this month still contributes its window dividends to the pool.

Manual verification: dry-run the dividend fetch against a known ASX payer over a window containing a real ex-date; confirm amount matches Yahoo.

## Deployment

1. Worker change → push StockAnalysis → auto-redeploy (verify `/dividends/BHP.AX?...` returns events).
2. Batch + front-end → normal DCF deploy (xcopy `www/` → StockAnalysis `www/dcf/`).
3. First dividend credit lands at the **next** monthly refresh of each screen.
4. Update the article's dividend caveat once live (separate follow-up).
