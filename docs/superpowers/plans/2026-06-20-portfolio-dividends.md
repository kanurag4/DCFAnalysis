# Paper Portfolio — Actual Dividends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the $10K paper portfolio tracker from price return to total return by crediting real Yahoo dividend events to each holding at the monthly rebalance, with a cumulative "Dividends earned" stat in the hero card.

**Architecture:** A new Worker endpoint proxies Yahoo's dividend-event chart API. At each monthly rebalance the batch fetches ex-dividend events for the *prior* holdings over the window `(oldAsAt, asAt]`, multiplies per-share amounts by implied shares, and adds the cash to the rebalance pool (reinvested equal-weight). A new cumulative `dividendsTotal` field on `portfolio-value.json` drives a hero stat. Going-forward only — no backfill.

**Tech Stack:** Vanilla Node.js (built-in test runner), Cloudflare Worker (vanilla JS), vanilla front-end JS. No new dependencies.

## Global Constraints

- **DOM boundary:** only `app.js` touches `document`/`window`/`localStorage`. `portfolio.js`, `fetch-dividends.js` stay pure/IO-only with no DOM.
- **Backward compatibility:** with no dividend data, `computeRebalance` output must be byte-identical to today — the existing 95 portfolio tests must pass unmodified.
- **Conditional export for testability:** every `scripts/lib/*.js` ends with `module.exports = { ... }`.
- **Currency:** dividend per-share amounts are in the stock's currency = portfolio currency; no conversion. No GBp handling (no `.L` tickers in these universes).
- **Window boundary:** credit ex-dates **strictly after** `oldAsAt` and **on/before** `asAt` so consecutive months neither overlap nor gap.
- **Three identical front-end copies:** `www/asx-undervalued/`, `www/sp500-undervalued/`, `www/nifty-undervalued/` — every front-end change is applied to all three `app.js` and all three `style.css`.
- **Test command:** `npm test` runs `node --test tests/*.test.js`.
- **Worker lives in a different repo:** `C:\Projects\StockAnalysis\worker\yahoo-proxy.js`, auto-deploys on push to `main`.

---

### Task 1: Credit dividends in `computeRebalance` (pure core)

**Files:**
- Modify: `scripts/lib/portfolio.js`
- Test: `tests/portfolio.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `computeRebalance(oldPortfolio, oldRows, newRows, allEvaluated, firstSeen, asAt, startingValue, indexMeta, dividendsByTicker = {})` where `dividendsByTicker` is `{ [ticker]: totalPerShareAmount }`. Portfolio output gains `dividendsTotal: number` (cumulative since inception, 2 dp).

- [ ] **Step 1: Write the failing tests**

Append to `tests/portfolio.test.js` inside the `describe('computeRebalance', …)` block:

```js
  it('first run: dividendsTotal is 0', () => {
    const { portfolio } = computeRebalance(
      null, [],
      [{ ticker: 'AAA', snapshotPrice: 10 }],
      [], {}, '2026-06-01'
    );
    assert.equal(portfolio.dividendsTotal, 0);
  });

  it('credits dividends: pool rises by shares × per-share amount', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    // AAA pays $0.50/share. Slot $5000 / $10 = 500 shares → $250 dividend cash.
    const divs = { AAA: 0.5 };
    const { portfolio } = computeRebalance(
      oldPortfolio, oldRows, newRows, [], {}, '2026-07-01', undefined, null, divs
    );
    assert.equal(portfolio.value, 10250);       // 10000 price-flat + 250 dividends
    assert.equal(portfolio.dividendsTotal, 250);
  });

  it('dividendsTotal accumulates across rebalances', () => {
    const oldPortfolio = { value: 10000, N: 1, asAt: '2026-06-01', startedAt: '2026-06-01', dividendsTotal: 100 };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 10 }];
    // 1000 shares × $0.10 = $100 this period → cumulative 200.
    const { portfolio } = computeRebalance(
      oldPortfolio, oldRows, newRows, [], {}, '2026-07-01', undefined, null, { AAA: 0.1 }
    );
    assert.equal(portfolio.dividendsTotal, 200);
    assert.equal(portfolio.value, 10100);
  });

  it('a leaver still earns its final-period dividends', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'CCC', snapshotPrice: 5 }];
    const allEvaluated = [{ ticker: 'BBB', snapshotPrice: 20 }];
    // BBB leaves; slot $5000 / $20 = 250 shares × $0.40 = $100 dividend before exit.
    const { portfolio, sold } = computeRebalance(
      oldPortfolio, oldRows, newRows, allEvaluated, {}, '2026-07-01', undefined, null, { BBB: 0.4 }
    );
    assert.equal(portfolio.value, 10100);
    assert.equal(portfolio.dividendsTotal, 100);
    assert.equal(sold[0].ticker, 'BBB');
  });

  it('omitting dividendsByTicker is byte-identical to no dividends', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 11 }, { ticker: 'BBB', snapshotPrice: 22 }];
    const { portfolio } = computeRebalance(oldPortfolio, oldRows, newRows, [], {}, '2026-07-01');
    assert.equal(portfolio.value, 11000);
    assert.equal(portfolio.dividendsTotal, 0);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: the 5 new assertions fail (`portfolio.dividendsTotal` is `undefined`; value `10000` not `10250`).

- [ ] **Step 3: Implement dividend crediting**

In `scripts/lib/portfolio.js`, change the signature (add trailing param):

```js
function computeRebalance(oldPortfolio, oldRows, newRows, allEvaluated, firstSeen, asAt, startingValue, indexMeta, dividendsByTicker = {}) {
```

In the first-run early return, add `dividendsTotal: 0`:

```js
  if (!oldPortfolio || oldPortfolio.N === 0 || !oldRows.length) {
    return {
      portfolio: { value: seedValue, N: newRows.length, asAt, startedAt: asAt, startingValue: seedValue, dividendsTotal: 0, ...existingIndexSeed },
      sold: [],
    };
  }
```

Replace the rebalance loop and final return:

```js
  let totalPool = 0;
  let periodDividends = 0;
  const sold = [];

  for (const r of oldRows) {
    const oldPrice = oldPriceMap[r.ticker];
    const newPrice = newPriceMap[r.ticker] ?? oldPrice; // fallback: treat as no movement
    const currentValue = slotValue * (newPrice / oldPrice);
    const shares = slotValue / oldPrice;
    const divCash = shares * (dividendsByTicker[r.ticker] || 0);
    totalPool += currentValue + divCash;
    periodDividends += divCash;

    if (!newTickers.has(r.ticker)) {
      const fs = firstSeen[r.ticker] || {};
      sold.push({
        ticker: r.ticker,
        entryDate: fs.firstSeen || oldPortfolio.asAt,
        entryPrice: +(fs.firstPrice != null ? fs.firstPrice : oldPrice).toFixed(4),
        exitDate: asAt,
        exitPrice: +newPrice.toFixed(4),
      });
    }
  }

  return {
    portfolio: {
      value: +totalPool.toFixed(2),
      N: newRows.length,
      asAt,
      startedAt: oldPortfolio.startedAt || oldPortfolio.asAt,
      startingValue: oldPortfolio.startingValue || STARTING_VALUE,
      dividendsTotal: +(((oldPortfolio.dividendsTotal || 0) + periodDividends)).toFixed(2),
      ...existingIndexSeed,
    },
    sold,
  };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all tests pass (existing 95 + 5 new).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/portfolio.js tests/portfolio.test.js
git commit -m "feat(portfolio): credit actual dividends into rebalance pool + dividendsTotal"
```

---

### Task 2: `fetch-dividends.js` — fetch + window-filter ex-div events

**Files:**
- Create: `scripts/lib/fetch-dividends.js`
- Test: `tests/fetch-dividends.test.js`

**Interfaces:**
- Consumes: a Worker endpoint `GET {proxyUrl}/dividends/{symbol}?period1=<unixSec>&period2=<unixSec>` returning `[{ date: "YYYY-MM-DD", amount: number }]` (built in Task 3).
- Produces: `fetchDividends(symbol, fromISO, toISO, { proxyUrl, fetchImpl, retries, backoffMs, sleepImpl }) -> Promise<Array<{date, amount}>>` returning only events with `fromISO < date <= toISO`; `[]` on any failure.

- [ ] **Step 1: Write the failing tests**

Create `tests/fetch-dividends.test.js`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { fetchDividends } = require('../scripts/lib/fetch-dividends.js');

function fakeRes(body, ok = true) {
  return { ok, json: async () => body };
}

describe('fetchDividends', () => {
  it('returns only events strictly after fromISO and on/before toISO', async () => {
    const body = [
      { date: '2026-06-01', amount: 0.10 }, // == fromISO → excluded
      { date: '2026-06-15', amount: 0.20 }, // in window → included
      { date: '2026-07-01', amount: 0.30 }, // == toISO → included
      { date: '2026-07-02', amount: 0.40 }, // after toISO → excluded
    ];
    const events = await fetchDividends('AAA.AX', '2026-06-01', '2026-07-01', {
      proxyUrl: 'https://x', fetchImpl: async () => fakeRes(body),
    });
    assert.deepEqual(events, [
      { date: '2026-06-15', amount: 0.20 },
      { date: '2026-07-01', amount: 0.30 },
    ]);
  });

  it('returns [] when the response is not ok', async () => {
    const events = await fetchDividends('AAA.AX', '2026-06-01', '2026-07-01', {
      proxyUrl: 'https://x', fetchImpl: async () => fakeRes([], false),
    });
    assert.deepEqual(events, []);
  });

  it('returns [] when fetch throws', async () => {
    const events = await fetchDividends('AAA.AX', '2026-06-01', '2026-07-01', {
      proxyUrl: 'https://x', fetchImpl: async () => { throw new Error('network'); },
    });
    assert.deepEqual(events, []);
  });

  it('sends period1/period2 as unix seconds derived from the ISO dates', async () => {
    let calledUrl = '';
    await fetchDividends('AAA.AX', '2026-06-01', '2026-07-01', {
      proxyUrl: 'https://x/', fetchImpl: async (url) => { calledUrl = url; return fakeRes([]); },
    });
    // 2026-06-01 = 1780272000, 2026-07-01 = 1782864000 (UTC midnight)
    assert.match(calledUrl, /\/dividends\/AAA\.AX\?period1=1780272000&period2=1782864000$/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/fetch-dividends.test.js`
Expected: FAIL — `Cannot find module '../scripts/lib/fetch-dividends.js'`.

- [ ] **Step 3: Implement `fetch-dividends.js`**

Create `scripts/lib/fetch-dividends.js`:

```js
// scripts/lib/fetch-dividends.js
// IO: fetch real ex-dividend events for a symbol over a date window via the
// Worker's /dividends endpoint, and return only the events in (fromISO, toISO].
// Best-effort: any failure yields [] so a rebalance never breaks on a missing
// dividend history. fetchImpl/sleepImpl are injectable for testing.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const toUnix = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 1000);

async function fetchDividends(symbol, fromISO, toISO, {
  proxyUrl, fetchImpl = fetch, retries = 0, backoffMs = 3000, sleepImpl = sleep,
} = {}) {
  const p1 = toUnix(fromISO);
  const p2 = toUnix(toISO);
  const url = `${proxyUrl.replace(/\/$/, '')}/dividends/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}`;
  for (let attempt = 0; ; attempt++) {
    let events = null;
    try {
      const res = await fetchImpl(url);
      if (res && res.ok) {
        const body = await res.json();
        if (Array.isArray(body)) events = body;
      }
    } catch (_) { events = null; }

    if (events) {
      return events.filter(e =>
        e && typeof e.date === 'string' && typeof e.amount === 'number' &&
        e.date > fromISO && e.date <= toISO
      );
    }
    if (attempt >= retries) return [];
    await sleepImpl(backoffMs * (attempt + 1));
  }
}

module.exports = { fetchDividends };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/fetch-dividends.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/fetch-dividends.js tests/fetch-dividends.test.js
git commit -m "feat(scripts): fetch-dividends helper — window-filtered ex-div events"
```

---

### Task 3: Worker `/dividends/{symbol}` endpoint

**Files:**
- Modify: `C:\Projects\StockAnalysis\worker\yahoo-proxy.js`

**Interfaces:**
- Consumes: existing `getAuth()`, `json()`, `UA`, CORS + rate-limit machinery.
- Produces: `GET /dividends/{symbol}?period1=<sec>&period2=<sec>` → `200` with `[{ date: "YYYY-MM-DD", amount: number }]`. Returns `[]` on any Yahoo error (best-effort).

This task is verified manually (Cloudflare Worker — no local test harness). Keep the change minimal and mirror the existing `/quote` route's structure.

- [ ] **Step 1: Add the route handler**

In `worker/yahoo-proxy.js`, immediately after the `/quote` block (before the `const match = url.pathname.match(/^\/quoteSummary\/…` line), insert:

```js
    // Dividend history: /dividends/{symbol}?period1=<sec>&period2=<sec>
    const divMatch = url.pathname.match(/^\/dividends\/([^/]+)\/?$/);
    if (divMatch) {
      const symbol = decodeURIComponent(divMatch[1]);
      const p1 = url.searchParams.get('period1') || '0';
      const p2 = url.searchParams.get('period2') || String(Math.floor(Date.now() / 1000));
      try {
        const auth = await getAuth();
        return json(await fetchDividendEvents(symbol, p1, p2, auth), 200, corsHeaders);
      } catch (err) {
        if (!String(err.message).includes('stale crumb')) {
          return json([], 200, corsHeaders); // best-effort: never break a caller's rebalance
        }
        cachedAuth = null;
        try {
          const auth = await getAuth();
          return json(await fetchDividendEvents(symbol, p1, p2, auth), 200, corsHeaders);
        } catch (_) {
          return json([], 200, corsHeaders);
        }
      }
    }
```

- [ ] **Step 2: Add the fetch helper**

At the bottom of `worker/yahoo-proxy.js`, after `fetchQuotes`, add:

```js
async function fetchDividendEvents(symbol, period1, period2, auth) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?period1=${encodeURIComponent(period1)}&period2=${encodeURIComponent(period2)}` +
    `&interval=1d&events=div&crumb=${encodeURIComponent(auth.crumb)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Cookie: auth.cookie } });
  if (res.status === 401) throw new Error('Unauthorized (stale crumb)');
  if (!res.ok) return [];
  const body = await res.json();
  const divs = body?.chart?.result?.[0]?.events?.dividends;
  if (!divs) return [];
  return Object.values(divs)
    .filter(d => d && d.amount != null && d.date != null)
    .map(d => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
```

- [ ] **Step 3: Deploy the Worker**

```bash
cd "C:/Projects/StockAnalysis"
git add worker/yahoo-proxy.js
git commit -m "feat(worker): add /dividends endpoint (Yahoo chart events=div proxy)"
git push
```

Cloudflare redeploys automatically (~30–60s).

- [ ] **Step 4: Verify live against a known ASX dividend payer**

Run (replace with the live Worker URL from `www/config.js`):

```bash
node -e "const u=require('fs').readFileSync('C:/Projects/DCFAnalysis/www/config.js','utf8').match(/YAHOO_PROXY_URL\s*[:=]\s*['\"]([^'\"]+)['\"]/)[1]; (async()=>{const r=await fetch(u.replace(/\/$/,'')+'/dividends/BHP.AX?period1=1735689600&period2=1782864000');console.log(r.status); console.log(JSON.stringify(await r.json()).slice(0,400));})()"
```

Expected: `200` and a JSON array of `{ date, amount }` objects with real BHP ex-div dates in 2025–2026. If `[]`, widen the period window or try another payer (e.g. `CBA.AX`) to confirm the endpoint shape before proceeding.

---

### Task 4: Wire dividend fetching into `updatePortfolio()`

**Files:**
- Modify: `scripts/lib/run-screen.js`

**Interfaces:**
- Consumes: `fetchDividends` (Task 2), `computeRebalance` 9th param (Task 1), the live `/dividends` Worker route (Task 3).
- Produces: dividend cash credited at each full-fetch rebalance; console summary line.

This task is verified by a manual full-fetch dry-run note + the existing `--rerank` parity guarantee (portfolio code only runs on full fetch). No new unit test — the logic is pure-glue over already-tested units.

- [ ] **Step 1: Import `fetchDividends`**

In `scripts/lib/run-screen.js`, add to the imports near the top (after the `fetchSymbol` require):

```js
const { fetchDividends } = require('./fetch-dividends.js');
```

- [ ] **Step 2: Fetch dividends for prior holdings and pass them in**

In `updatePortfolio()`, replace the block from `const indexMeta = …` through the `computeRebalance(…)` call with:

```js
  const indexMeta = (config.indexTicker && data.indexPrice != null)
    ? { indexPrice: data.indexPrice, indexName: config.indexName, indexTicker: config.indexTicker }
    : null;

  // Credit real dividends earned by the PRIOR holdings over (oldAsAt, asAt].
  // Going-forward only: first run has no oldPortfolio, so nothing is fetched.
  const proxyUrl = readProxyUrl();
  const dividendsByTicker = {};
  if (oldPortfolio && oldPortfolio.asAt && oldRows.length) {
    const sleepMs = 3200; // stay under the Worker's 20 req/60s cap
    let paid = 0;
    for (const r of oldRows) {
      const events = await fetchDividends(r.ticker, oldPortfolio.asAt, data.asAt, { proxyUrl, retries: 1, backoffMs: 4000 });
      const total = events.reduce((s, e) => s + e.amount, 0);
      if (total > 0) { dividendsByTicker[r.ticker] = total; paid++; }
      await new Promise(res => setTimeout(res, sleepMs));
    }
    console.log(`Dividends: ${paid}/${oldRows.length} prior holdings paid over ${oldPortfolio.asAt}→${data.asAt}`);
  }

  const { portfolio, sold } = computeRebalance(
    oldPortfolio, oldRows, newRows, data.evaluated, firstSeen, data.asAt, config.startingValue, indexMeta, dividendsByTicker
  );
```

Note: `updatePortfolio` is already `async`-safe to call — it is awaited in `runScreen` (`updatePortfolio(config, data, oldRankings)` at the end of the full-fetch branch). Change its declaration to `async function updatePortfolio(...)` and `await` the call.

- [ ] **Step 3: Make `updatePortfolio` async and await it**

Change the declaration:

```js
async function updatePortfolio(config, data, oldRankings) {
```

In `runScreen`, the full-fetch branch — await it:

```js
    data = await gather(config);
    rankAndWrite(config, data);
    await updatePortfolio(config, data, oldRankings);
```

- [ ] **Step 4: Add the cumulative dividends line to the console summary**

At the end of `updatePortfolio()`, after the existing portfolio log line, add:

```js
  if (portfolio.dividendsTotal) {
    console.log(`Dividends: ${sym}${portfolio.dividendsTotal.toFixed(2)} earned cumulatively`);
  }
```

- [ ] **Step 5: Verify the existing suite still passes (no regression in pure code)**

Run: `npm test`
Expected: PASS — Task 4 changes only IO glue; pure units are unchanged.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/run-screen.js
git commit -m "feat(scripts): fetch + credit real dividends at each portfolio rebalance"
```

---

### Task 5: Hero "Dividends earned" stat (front-end, ×3)

**Files:**
- Modify: `www/asx-undervalued/app.js`, `www/sp500-undervalued/app.js`, `www/nifty-undervalued/app.js`
- Modify: `www/asx-undervalued/style.css`, `www/sp500-undervalued/style.css`, `www/nifty-undervalued/style.css`

**Interfaces:**
- Consumes: `portfolioData.dividendsTotal` from `portfolio-value.json` (Task 1).
- Produces: a `.portfolio-hero-dividends` element in the hero, shown only when `dividendsTotal > 0`.

The three `app.js` files are identical in this region; apply the same edit to each. Same for the three `style.css` files.

- [ ] **Step 1: Add the dividends stat to the hero markup**

In each `…/app.js`, inside `renderHeroCard`, locate the `note` line:

```js
        '<div class="portfolio-hero-note">' + portfolioData.N + ' holdings · live prices · since ' + since + ' · ' + days + ' days</div>' +
```

Immediately **before** that line, insert:

```js
        ((portfolioData.dividendsTotal && portfolioData.dividendsTotal > 0)
          ? '<div class="portfolio-hero-dividends">Dividends earned: ' + sym + Math.round(portfolioData.dividendsTotal).toLocaleString() + '</div>'
          : '') +
```

- [ ] **Step 2: Add the CSS**

In each `…/style.css`, after the `.portfolio-hero-note` rule (search for `.portfolio-hero-note`), add:

```css
.portfolio-hero-dividends { margin-top: 6px; font-size: 0.85rem; font-weight: 600; color: var(--kv-pass); }
```

- [ ] **Step 3: Manual visual check**

Temporarily set `dividendsTotal` in one screen's local `www/asx-undervalued/portfolio-value.json` to a test value (e.g. `142.5`), then:

Run: `npm run dev` and open `http://localhost:8000/asx-undervalued/`
Expected: a green "Dividends earned: $143" line in the hero card, above the holdings/since line. Revert the test edit to `portfolio-value.json` afterwards (`git checkout www/asx-undervalued/portfolio-value.json`).

- [ ] **Step 4: Commit**

```bash
git add www/asx-undervalued/app.js www/sp500-undervalued/app.js www/nifty-undervalued/app.js \
        www/asx-undervalued/style.css www/sp500-undervalued/style.css www/nifty-undervalued/style.css
git commit -m "feat(screens): show cumulative Dividends earned stat in portfolio hero"
```

---

## Deployment (after all tasks pass)

1. **Worker** already deployed in Task 3. Confirm `/dividends/BHP.AX?...` returns events.
2. **Batch + front-end:** standard DCF deploy —
   ```powershell
   xcopy /E /Y /I "C:\Projects\DCFAnalysis\www" "C:\Projects\StockAnalysis\www\dcf"
   ```
   then commit/push StockAnalysis. (`scripts/` and `tests/` are dev-only — never deployed.)
3. **First dividend credit** lands at the next monthly full-fetch refresh of each screen (`node scripts/rank-asx.js` etc.). `--rerank`/`--reeval` do not credit dividends (they don't touch the portfolio).
4. **Follow-ups (separate):** update the article's dividend caveat once live; add a `dividendsTotal` note to CLAUDE.md's portfolio section.

## Self-Review notes

- **Spec coverage:** Worker endpoint (Task 3), fetch helper (Task 2), pool crediting + `dividendsTotal` (Task 1), orchestration/window/throttle (Task 4), hero stat (Task 5), going-forward-only (no backfill code; `dividendsTotal` seeds 0), backward compat (Task 1 byte-identical test). All spec sections mapped.
- **Type consistency:** `dividendsByTicker` is `{ [ticker]: number }` (summed per-share) in Tasks 1, 2, 4. `fetchDividends` returns `[{date, amount}]` in Tasks 2, 3. `portfolioData.dividendsTotal` is a number in Tasks 1, 5.
- **No placeholders:** every code step is complete.
