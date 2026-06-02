# Build notes & article material — "Most Undervalued ASX 300" screen

Source notes for a future KashVector Articles post about how the
`kashvector.com/dcf/asx-undervalued/` monthly screen is built, the problems hit along
the way, and the judgement calls. Written 2026-06-02 during the build. Not the article
itself — raw material to mine.

---

## 1. What the screen actually does (the method, in plain English)

Every month we run all ~300 of the largest ASX-listed companies through the **exact same
base-case valuation engine** as the live DCF Valuation tool, then rank the ones trading
**below** their estimated intrinsic value by margin of safety, and publish the top 10.

- **Universe:** the ~300 largest ASX companies by market cap (a liquid subset — broad
  enough to be interesting, without the illiquid micro-cap tail where the data is junk).
- **Valuation, base case (no optimism):** 5-year cash-flow projection, 2.5% terminal
  growth, a discount rate (WACC) built from real market data, growth seeded from the
  company's own revenue/earnings trends. Identical to what the public DCF tool seeds — we
  literally reuse the same calculation code, so the screen can't silently disagree with the
  tool.
- **Banks & insurers are different:** discounted cash flow doesn't work for them (their
  "cash flow" is deposits and reserves, not owner earnings). Those are valued with a
  **Dividend Discount Model (DDM)** instead and labelled `DDM` in the table.
- **Margin of safety** = how far intrinsic value sits above the current price. We rank by
  it, highest first, and show the top 10.

## 2. The four survivorship rules (why a stock makes — or misses — the list)

A company has to clear **all four** to appear:

1. **Undervalued** — intrinsic value above price (positive margin). *This is the big filter.*
2. **Valuable by the model** — produced a real number. Dropped: no/negative free cash flow,
   net debt bigger than the whole firm value, or a bank/insurer that pays no dividend.
3. **Real cash flow** — free cash flow came from a reported figure or operating cash flow
   minus capex. We drop the rough "OCF × 0.8" fallback because it fakes undervaluation.
4. **Plausible margin** — 80% or less. If the model says a stock is worth more than ~1.8×
   its price, that's almost always one-off-inflated or cyclically-peaked cash flow, not a
   bargain. (Started at 150%; see issue #4.)

**The list is capped at 10 — it is a cap, not a quota.** In a normal/expensive market most
big caps trade *above* their conservative base case, so the list can be short. That's a
feature: it's honest about how few obvious bargains exist.

## 3. Problems we hit (the good article material)

### Issue 1 — The source list is bot-protected
The cleanest ASX-300-by-market-cap list lives on marketindex.com.au, but the page is behind
a Cloudflare "Just a moment…" challenge — plain scripted fetches get a challenge page, not
data. **Fix:** drive a real (headless) browser, which solves the JS challenge, then read the
already-rendered, market-cap-ranked table and take the top 300 codes.

### Issue 2 — Rate limiting silently gutted the screen (the big one)
First full run: of 300 stocks, **240 came back empty and only ~60 were actually evaluated.**
The "top undervalued ASX 300" was really "top undervalued of a random 60 that happened to
get through." Cause: our data proxy caps at 20 requests/60s per IP; we were firing one every
0.4s (~150/min), so ~80% got rate-limited (HTTP 429) and the fetch code silently turned
failures into "skip this stock." **What exposed it:** we added a *funnel* line to the run
output — `300 tickers → 240 fetch-failed → 60 evaluated → … → 7 qualified` — and the
240 jumped out immediately. **Fix:** slow to one request every 3.2s (under the limit),
retry transient failures with backoff, and do one final cooldown-and-retry sweep for
stragglers. Re-run: **0 fetch failures, all 300 evaluated.**
*Lesson for the article: "silent failure that returns plausible-looking results is the most
dangerous kind of bug" — the screen looked fine; it just wasn't screening what it claimed.*

### Issue 3 — "Why only 7 stocks, not 10?"
Before the rate-limit fix, even the 60 that got through only yielded 7 survivors. Worth
explaining that the count reflects how strict a *conservative* DCF is: of ~60, about half
were overvalued and a third were unvaluable (ETFs, no-FCF, etc.). 10 is a ceiling, not a
target.

### Issue 4 — The "most undervalued" were the least trustworthy
After getting full coverage, the raw top 10 were all **100–149% margins** (model says worth
~2–2.5× the price) and all had **terminal value 68–86%** of the valuation — i.e. the answer
rested almost entirely on the most assumption-sensitive part of a DCF. They were dominated
by cyclical names (coal/gold miners, mining-services contractors) whose *current* cash flow
is likely at a cyclical peak, which the model then projects forward. So ranking purely by
margin surfaced the **most fragile** valuations, not the best bargains. **Fix:** tightened
the plausibility cap from 150% to **80%**, which drops the "too good to be true" outliers
and leaves a more defensible list. *Great teaching point about DCF's sensitivity to terminal
assumptions and cyclical earnings.*

### Issue 5 — ETFs / LICs / trusts in the "company" list
The market-cap list includes funds (e.g. gold-miner ETFs). They have no company free cash
flow, so they fail the "valuable by the model" rule and drop out naturally — no special-casing
needed, but worth a sentence in the article.

## 4. The honesty / ethics angle (a strong article theme)

This was treated as a first-class design constraint, not an afterthought:
- **Framed as a screen, not advice or a buy list** — prominent banner + FAQ.
- **Nothing publishes unreviewed** — a human eyeballs the funnel and the list every month
  before it goes live (the build even bakes this review gate into the monthly process).
- **Terminal-value caveat surfaced** — we *show* the TV% per row rather than hide how much
  of the valuation is "trust me."
- **"First seen" is transparency, not a track record** — we record when a stock first
  appeared and at what price, but deliberately do **not** compute a "% gain since listed,"
  because that would dress a screen up as a performance claim.

## 5. How the monthly refresh works (process)

A one-command runbook (`/refresh-asx-undervalued` skill): run the batch (~16 min, throttled),
review the funnel + top 10, **stop for human approval**, then publish. Filters can be retuned
instantly via a `--rerank` cache (re-rank last run's data without re-fetching) — that's how
the 150%→80% cap change was made without another 16-minute run.

## 6. Possible article angles / titles
- "What happens when you DCF the entire ASX 300?" (findings-led)
- "The bug that returned the right-looking wrong answer" (the rate-limit silent-failure story)
- "Why the most 'undervalued' stocks are often the least trustworthy" (terminal value /
  cyclical-peak lesson — pairs well with the existing DCF & DDM article)
- "How we built an honest stock screen (and refused to fake a track record)"

## 7. Concrete numbers to quote (from the 2026-06-02 build)
- Universe: 300. Full clean run: 0 fetch-failed, 300 evaluated.
- Funnel at 80% cap: ~126 unvaluable, ~104 overvalued, ~24 over the margin cap → tens
  qualified, top 10 shown. (Re-confirm exact figures from the latest `rankings.json`
  `summary` block when writing.)
- Rate-limit incident: 240/300 dropped at 0.4s throttle → 0/300 dropped at 3.2s + retry.
- Cap change: 150% → 80% margin of safety, to drop ~2×+ outliers.
