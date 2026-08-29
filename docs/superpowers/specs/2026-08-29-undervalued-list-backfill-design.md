# Undervalued-screen list backfill ("Still held") — design

**Date:** 2026-08-29
**Status:** approved, pilot on NIFTY only
**Repo:** DCFAnalysis (screen engine + pages), with one consumer change in stock-evaluator (`scripts/newsletter-subject-lines.js`)

---

## 1. Problem

Each weekly full-fetch run ranks the undervalued universe and shows the top 20 by margin of
safety (`topN: 20`, `maxMargin: 0.8`). In a strict week far fewer clear all the rules — NIFTY
routinely produces ~14, sometimes fewer. The list then looks thin, the paper portfolio drops to
14 holdings (pool re-split 14 ways), and every stock that fell off is logged as an exit even
when it only just crossed above its DCF estimate and is a strong performer.

We want the list to hold ~20 by **retaining the best-performing stocks from earlier weeks** that
no longer trade below fair value but are still up since we flagged them — kept honestly labelled
as *not* currently undervalued, and kept in the paper portfolio while they're ahead.

## 2. The retention rule

Runs inside `rankAndWrite` (`scripts/lib/run-screen.js`), only on a full-fetch run, and only for
a screen whose config carries a `retention` block. Other screens are byte-for-byte unaffected.

```
Q          = rankRows(evaluated)                       // qualified this week, N ≤ 20
need       = topN − N                                  // topN = 20
if need <= 0 or !config.retention:  write [...Q], done // today's behaviour

prior      = last week's COMMITTED rankings.json rows  // qualified + retained from last run
candidates = prior rows whose ticker is NOT in Q this week
             joined against:
               - first-seen.json[ticker]  → firstPrice, firstSeen (unchanged, original entry)
               - this run's allEvaluated  → thisPrice (every universe ticker got a fresh price)
             each candidate gets:
               returnSinceFlagged = (thisPrice − firstPrice) / firstPrice
               weeksRetained      = row.retainedSince ? round((asAt − retainedSince) / 7) : 0

eligible   = candidates where returnSinceFlagged > 0  AND  weeksRetained < retention.maxWeeks
retained   = eligible sorted by returnSinceFlagged desc, take `need`
released   = every candidate NOT in retained
             (down since flagged, or weeksRetained ≥ maxWeeks, or a weaker winner squeezed out)

write rankings.json rows = [...Q (rank 1..N), ...retained (rank N+1..N+len, retained:true)]
```

- `released` stocks need no explicit handling: they are simply absent from the written `rows`.
  `computeRebalance` already logs any prior holding that is not in the new `newRows` as a `sold`
  entry, computing its real gain/loss over the final period. A released retained-winner books its
  gain; a released loser books its loss. Both are honest track-record entries.
- If `eligible.length < need`, the list is shorter than 20. We never invent a name.
- `retention.maxWeeks` is per-config (NIFTY: `12`). No global constant.

### `returnSinceFlagged` — exact definition

`firstPrice` is `first-seen.json[ticker].firstPrice` (the price the day the ticker *first* entered
this screen, ever — survives exits/re-entries via the existing `mergeFirstSeen` ledger).
`thisPrice` is this run's snapshot price for that ticker, taken from `data.evaluated`
(`allEvaluated`) — the same source `computeRebalance` already uses to price "leaver" stocks. Every
ticker in the universe is evaluated every run, so a non-qualifier always has a fresh price.

If `first-seen.json` has no entry for a candidate (shouldn't happen — it was on last week's list,
so it was flagged at least once), treat it as ineligible and let it be released.

## 3. `rankings.json` schema

Qualified rows: **unchanged**. Retained rows carry three extra fields:

```jsonc
{
  "rank": 16,
  "ticker": "PFC.NS",
  "name": "Power Finance Corporation Limited",
  "marginOfSafety": -0.042,          // whatever it computed this week — kept for transparency
  "method": "DDM",
  // ... all the usual fields, unchanged ...
  "retained": true,
  "retainedSince": "2026-08-24",     // YYYY-MM-DD — the first week this ticker entered "Still held".
                                     // Set to asAt the week a ticker is first retained; carried
                                     // forward verbatim from last week's row every week after.
  "returnSinceFlagged": 0.34         // firstPrice → thisPrice, 4 dp, the number the page shows
}
```

`summary` gains one field:

```jsonc
"summary": {
  "tickers": 500,
  "evaluated": 500,
  "qualified": 14,     // = N, the rankRows count (unchanged meaning)
  "retained": 6,       // NEW — count of retained rows (0 when no retention block / none needed)
  "shown": 20,         // = qualified + retained (was: min(qualified, topN))
  "marginCapPct": 80,
  "dropped": { ... }   // unchanged
}
```

`shown` semantics change: it was `rankRows(...).length` (≤ `qualified`, capped at `topN`); it is
now `qualified + retained`. Every `rankings.json` reader that keys off `shown` must be checked
(see §8).

## 4. Order of operations in `run-screen.js`

`rankAndWrite(config, { asAt, tickerCount, evaluated, fx })` today:
1. `rankRows(eligible)` → `ranked`
2. write `rankings.json` with `rows: rounded(ranked)`
3. `mergeFirstSeen` → write `first-seen.json`

New:
1. `rankRows(eligible)` → `Q` (unchanged)
2. **if `config.retention` and `Q.length < topN`:**
   a. read the **committed** `rankings.json` (via the existing `readPublishedTickers` path, but
      keeping the full rows, not just tickers — add a `readPublishedRankings(config)` sibling that
      returns `{ rows }` or `null`). This must happen before step 3 overwrites the file.
   b. build `candidates` / `eligible` / `retained` / `released` per §2, using `first-seen.json`
      (read here, before `mergeFirstSeen`) and this run's `evaluated` for prices.
   c. `retained` rows: carry `retainedSince` from the matching prior row if present, else set to
      `asAt`. Compute `returnSinceFlagged`. Assign `rank` continuing from `Q.length + 1`.
3. write `rankings.json` with `rows: [...rounded(Q), ...roundedRetained]`, `summary.retained`,
   `summary.shown = Q.length + retained.length`
4. `mergeFirstSeen` — **unchanged**. Retained tickers already have ledger entries; their original
   `firstSeen`/`firstPrice` are preserved. Do NOT add or touch entries for retained tickers here.
5. `updatePortfolio` → reads the just-written `rankings.json` `rows` as `newRows`. **No change to
   `portfolio.js` or `updatePortfolio`.** Retained tickers are in `newRows` → they keep their
   slot. `released` tickers are not → `computeRebalance` sells them at their real final-period
   P&L, appended to `sold.json` exactly as a normal exit.

### `--rerank` / `--reeval`

`computeRebalance` is full-fetch-only (portfolio-value.json / sold.json never move on a rerank).
Retention itself only rewrites `rankings.json`, so it *can* run in `--rerank` mode and is how the
NIFTY preview is produced (§9). Guard: retention reads `config.retention` and the committed
`rankings.json`; both are available in every mode. A `--rerank` that produces retained rows and
then is not committed simply leaves an uncommitted `rankings.json` — same as any rerank.

## 5. Pure function

New `scripts/lib/retention.js`, unit-tested like `rank.js`/`portfolio.js`:

```
selectRetained({ qualified, priorRows, firstSeen, evaluatedPrices, asAt, need, maxWeeks })
  → { retained: [...rows with retainedSince, returnSinceFlagged], released: [...tickers] }
```

Pure, no fs, no dates-from-`Date.now()` (takes `asAt`). `run-screen.js` does the file IO and
passes plain data in. `evaluatedPrices` is `{ [ticker]: snapshotPrice }` built from `data.evaluated`.

## 6. Newsletter

`scripts/newsletter-subject-lines.js` (stock-evaluator repo) and the weekly broadcast build:

- **Top 3 per group must filter `rows.filter(r => !r.retained)`** before ranking by margin.
  This is **required for correctness**, not tidiness: a stock retained because it was over the
  80% margin cap still has a *high* `marginOfSafety`, so an unfiltered margin-sort would float it
  to the top and show a not-undervalued stock as a "most undervalued" pick.
- `groupTopN()` in that script: apply the filter inside, before `.sort()`.
- Optional, decided per-issue when building Monday's broadcast: a one-line
  "Still holding from earlier: PFC.NS +34%, …" note, sourced from `rows.filter(r => r.retained)`.
  Not built now.

## 7. Page — `www/nifty-undervalued/`

### a. `index.html` — "How a stock makes this list"

`.rules-intro` gains a sentence:

> …The list is capped at 20 — a strict week can show fewer qualifying. **When fewer than 20 clear
> all five rules, the list is topped up with the best-performing stocks flagged in earlier weeks
> that are still held while they're ahead — shown separately below as "Still held", and no longer
> trading below fair value.**

### b. `app.js` — `renderScreenSummary(s)`

After the "Screened out: …" sentence, when `s.retained > 0`:

> From 500 NIFTY 500 names, **14 qualified** this week. Screened out: 296 overvalued, 140
> unvaluable, 27 with rough cash-flow data, 23 above the 80% margin cap. **Topped up to 20 with
> the 6 best-performing stocks flagged earlier — still held while ahead, though no longer below
> fair value.**

The existing `${s.shown < s.qualified ? ...}` branch becomes dead (shown ≥ qualified now) —
replace it with the `s.retained` branch above.

### c. `app.js` — the "Still held" table

Rendered below `#rank-table`, only when at least one row has `retained: true`. Split `rankings`
rows into `qualified` (main table, unchanged) and `retained`.

```
<section class="stillheld-card">          <!-- new, styled like .table-card -->
  <h2 class="stillheld-title">Still held</h2>
  <p class="stillheld-note">Added in an earlier week and no longer trading below fair value —
     kept in the €10,000 portfolio while they're ahead of the price we first flagged them at.</p>
  <table>
    <thead><tr><th>#</th><th>Stock</th><th class="num">Held since</th>
               <th class="num">Return since flagged</th><th class="num">Live price</th></tr></thead>
    <tbody>
      <tr><td>16</td><td>PFC.NS · Power Finance</td><td class="num">24 Aug</td>
          <td class="num pos">+34.0%</td><td class="num">₹512.30</td></tr>
      ...
    </tbody>
  </table>
</section>
```

- "Held since" = `first-seen.json[ticker].firstSeen`, formatted `DD Mon`.
- "Return since flagged" = `row.returnSinceFlagged`, green if ≥ 0 (always ≥ 0 by the rule, but
  keep the class logic). This is entry→now, *not* the live-margin the main table shows.
- "Live price" — reuse the same live-price fetch the main table already does (`fetchLivePrices`).
- No margin-of-safety / fair-value columns — the point is they're *not* a value pick right now.
- CSS: a new `.stillheld-*` block in `style.css`, mirroring `.table-card`/`table` styling. Muted
  `<h2>` + `.stillheld-note` in `--kv-muted`.

### d. Currency / market-index / portfolio hero

No change. The portfolio hero stat and chart read `portfolio-value.json` / `portfolio-history.json`
which now reflect 20 holdings again — nothing to adjust.

## 8. Consumers of `rankings.json` — checklist

| Consumer | Change |
|---|---|
| `www/<screen>/app.js` `renderScreenSummary` | §7b — but **NIFTY only** for the pilot; other 5 screens never get `summary.retained`, branch stays inert |
| `www/<screen>/app.js` table render | §7c — NIFTY only |
| `www/<screen>/index.html` rules intro | §7a — NIFTY only |
| `scripts/lib/run-screen.js` `rankAndWrite` | §4 — gated on `config.retention`, so a no-op for the other 5 |
| `scripts/newsletter-subject-lines.js` (stock-evaluator) | §6 — `!r.retained` filter. Safe to ship now: no screen emits `retained` rows until NIFTY's config gets the block, and the filter is a no-op on rows without the field |
| admin console funnel (`www/admin/admin.js`, `worker-admin/admin.js`) | Show `retained` count if present in `summary`. Cosmetic; can follow later |
| ticker-page generator (`scripts/lib/ticker-page.js`) | reads its own manifests, not `rankings.json` — **no change** |
| `first-seen.json` / `sold.json` | schema unchanged; retention just changes *which* tickers appear in `sold.json` each week |

## 9. Pilot: NIFTY only

1. `scripts/rank-nifty.js` gains:
   ```js
   retention: { maxWeeks: 12 },
   ```
   No other screen config touched.
2. Build `retention.js` + tests, wire into `run-screen.js`.
3. **Preview** without a live fetch: `node scripts/rank-nifty.js --rerank` re-ranks this weekend's
   cached `_evaluated-nifty*.json`. To make retention actually *do* something, the "prior week"
   input must be a genuinely earlier `rankings.json` — supply it by temporarily restoring an
   older committed copy (`git show <~1wk-ago>:www/nifty-undervalued/rankings.json`) as the
   `readPublishedRankings` source for the preview run, or add a `--prior-rankings <path>` dev flag
   to `run-screen.js` used only for this. Regenerate the page, screenshot the "Still held" section.
4. Show the user. **Nothing commits/deploys from the preview** — `git checkout` the reranked files.
5. If approved: commit `retention.js` + `run-screen.js` + `rank-nifty.js` + the NIFTY page changes
   + the newsletter-script filter. It runs live at the next weekend NIFTY refresh via the admin
   console (the console dispatches `refresh-screen.yml` against `master`).
6. Watch NIFTY for 1–2 weeks. If it behaves, roll the `retention` block + page changes out to the
   other 5 screens (ASX, S&P 500, KOSPI, Nikkei, Europe) — mechanical, one commit.

## 10. Bundled: `sector-margins.json` publish fix

Independent of retention, done in the same pass since both touch the screen publish pipeline.

`.github/workflows/publish-screen.yml` cherry-picks a fixed set of 5 snapshot files per market
and fails on `git status --porcelain` showing anything else. `www/sector-margins.json` is
regenerated by every screen run (`sector-margin-tally.js` in `run-screen.js`'s `gather()`) but is
**not** in that list, so the weekly refresh never publishes it — the Sector-Average Cyclical
Margin Fallback feature runs on the 2026-08-25 seed and is not being fed. Observed 2026-08-29:
the ASX publish (`a192d6c` in stock-evaluator) touched only the 5 per-market snapshot files.

Fix: add `www/sector-margins.json` to `publish-screen.yml`'s copy list and to the allowed-paths
in its post-copy `git status --porcelain` assertion. ~3 lines. Verify with one publish run that
the file moves to `master` and the assertion still passes.

## 11. Edge cases

| Case | Behaviour |
|---|---|
| `Q.length >= 20` | No retention. Any prior retained ticker not in Q is released → `sold.json`. |
| `Q.length + eligible.length < 20` | List is shorter than 20. Expected for thin markets. |
| `Q.length == 0` | Rare (deeply overvalued market). `need = 20`, fill from eligible winners only. |
| Retained ticker re-qualifies next week | It's in Q → drops out of the retained set, `retained` fields disappear from its row, `retainedSince` is forgotten. If it later stops qualifying again, its `weeksRetained` clock restarts from 0. |
| Retained ticker's price data missing this run (fetch gap) | No `thisPrice` → `returnSinceFlagged` uncomputable → treat as ineligible → released. (A transient fetch gap costing a retention slot for one week is acceptable; it can be re-retained next week.) |
| Ticker on the manual blacklist | `rankRows` already excludes it from Q; it should also be excluded from `candidates` (check `config.blacklist`). |
| Same-day rerun (idempotency) | Retention reads the *committed* prior `rankings.json`, not the working-tree one, so a same-day rerun uses the same prior input and produces the same retained set. Matches `appendPortfolioHistory`'s existing same-day idempotency. |
| `maxMargin` cap changes | `returnSinceFlagged` is price-based, independent of the margin cap, so a cap tweak doesn't disturb retained rows. |

## 12. Testing

- `scripts/lib/retention.js` unit tests (`node --test`): winners-only selection, `need` clamp,
  12-week release, loser release, `retainedSince` carry-forward, missing-first-seen handling,
  blacklist exclusion, `need <= 0` → empty.
- `run-screen.js` integration: a fixture prior-`rankings.json` + evaluated set that yields
  `Q = 14`, assert the written file has 20 rows, 6 `retained:true`, correct ranks, `summary.retained = 6`.
- Portfolio: assert `computeRebalance` sells only the `released` tickers (not the retained ones)
  and portfolio `N` returns to 20.
- Newsletter: `groupTopN` fixture with a high-margin `retained:true` row present — assert it is
  excluded from the top 3.
