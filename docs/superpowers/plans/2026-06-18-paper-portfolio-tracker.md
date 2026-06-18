# Paper Portfolio Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a "$10K paper portfolio" hero stat on all three undervalued screens (ASX, S&P 500, NIFTY) — tracking what $10K equally invested across the screen's picks would be worth today.

**Architecture:** A new pure `scripts/lib/portfolio.js` module computes the rebalance math (testable in isolation). The batch orchestrator (`run-screen.js`) calls it on full-fetch runs only — reading the old rankings before overwriting them, then writing `portfolio-value.json` and appending to `sold.json` in each screen's `www/` folder. Each screen's `app.js` reads those files and injects a hero card + recent-activity table into the page via DOM manipulation (no HTML changes).

**Tech Stack:** Node.js (batch), Vanilla JS (frontend), static JSON files (data layer).

## Global Constraints

- `portfolio-value.json` and `sold.json` live in `www/<screen>/` alongside `rankings.json` — xcopy deploys them with everything else.
- Portfolio rebalance runs **only** in full-fetch mode (not `--rerank` or `--reeval`).
- `--rerank` and `--reeval` must continue to work exactly as before — no regression.
- All three `app.js` files receive identical changes — apply once, copy to the other two.
- Source files live in `C:\Projects\DCFAnalysis\www\<screen>\` — never edit `StockAnalysis` directly.
- Tests use Node's built-in test runner: `npm test` (runs `tests/*.test.js`).
- DOM boundary rule: only `app.js` touches the DOM — no new non-DOM scripts in `<head>`.

---

### Task 1: Pure rebalance module + tests

**Files:**
- Create: `scripts/lib/portfolio.js`
- Create: `tests/portfolio.test.js`

**Interfaces:**
- Produces: `computeRebalance(oldPortfolio, oldRows, newRows, allEvaluated, firstSeen, asAt)` → `{ portfolio, sold }`
  - `oldPortfolio`: `{ value: number, N: number, asAt: string, startedAt: string } | null`
  - `oldRows`: `Array<{ ticker: string, snapshotPrice: number }>` — previous rankings rows
  - `newRows`: `Array<{ ticker: string, snapshotPrice: number }>` — new top-N
  - `allEvaluated`: `Array<{ ticker: string, snapshotPrice: number | null }>` — full evaluated set (for leaver price lookup)
  - `firstSeen`: `{ [ticker]: { firstSeen: string, firstPrice: number } }`
  - `asAt`: `string` — date of this batch run
  - Returns `portfolio`: `{ value: number, N: number, asAt: string, startedAt: string }`
  - Returns `sold`: `Array<{ ticker, entryDate, entryPrice, exitDate, exitPrice }>`
- Produces: `STARTING_VALUE = 10000`

- [ ] **Step 1: Write the failing tests**

```js
// tests/portfolio.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { computeRebalance, STARTING_VALUE } = require('../scripts/lib/portfolio.js');

describe('computeRebalance', () => {
  it('first run: returns $10K, correct N, no sold entries', () => {
    const { portfolio, sold } = computeRebalance(
      null, [],
      [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }],
      [], {}, '2026-06-01'
    );
    assert.equal(portfolio.value, STARTING_VALUE);
    assert.equal(portfolio.N, 2);
    assert.equal(portfolio.asAt, '2026-06-01');
    assert.equal(portfolio.startedAt, '2026-06-01');
    assert.deepEqual(sold, []);
  });

  it('no leavers: portfolio grows by weighted price movement', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 11 }, { ticker: 'BBB', snapshotPrice: 22 }];
    const { portfolio, sold } = computeRebalance(oldPortfolio, oldRows, newRows, [], {}, '2026-07-01');
    // each slot $5000; AAA +10% = $5500, BBB +10% = $5500 → $11000
    assert.equal(portfolio.value, 11000);
    assert.equal(portfolio.N, 2);
    assert.equal(portfolio.startedAt, '2026-06-01'); // preserved
    assert.deepEqual(sold, []);
  });

  it('one leaver: proceeds pooled, entry/exit recorded from firstSeen', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 12 }, { ticker: 'CCC', snapshotPrice: 5 }];
    const allEvaluated = [{ ticker: 'BBB', snapshotPrice: 18 }]; // BBB fell but was still evaluated
    const firstSeen = { BBB: { firstSeen: '2026-05-01', firstPrice: 19 } };
    const { portfolio, sold } = computeRebalance(oldPortfolio, oldRows, newRows, allEvaluated, firstSeen, '2026-07-01');
    // AAA: 5000 * (12/10) = 6000; BBB: 5000 * (18/20) = 4500 → total 10500
    assert.equal(portfolio.value, 10500);
    assert.equal(portfolio.N, 2);
    assert.equal(sold.length, 1);
    assert.equal(sold[0].ticker, 'BBB');
    assert.equal(sold[0].entryDate, '2026-05-01');
    assert.equal(sold[0].entryPrice, 19);
    assert.equal(sold[0].exitDate, '2026-07-01');
    assert.equal(sold[0].exitPrice, 18);
  });

  it('leaver with no price in allEvaluated: uses old price (factor 1)', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'CCC', snapshotPrice: 5 }];
    const { portfolio, sold } = computeRebalance(oldPortfolio, oldRows, newRows, [], {}, '2026-07-01');
    // BBB: no new price → factor 1 → $5000; AAA: no change → $5000; total $10000
    assert.equal(portfolio.value, 10000);
    assert.equal(sold[0].exitPrice, 20); // fell back to old price
  });

  it('portfolio declines when prices fall', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 9 }, { ticker: 'BBB', snapshotPrice: 18 }];
    const { portfolio, sold } = computeRebalance(oldPortfolio, oldRows, newRows, [], {}, '2026-07-01');
    // AAA: 5000*0.9=4500; BBB: 5000*0.9=4500 → 9000
    assert.equal(portfolio.value, 9000);
    assert.deepEqual(sold, []);
  });

  it('leaver with no firstSeen entry: falls back to old portfolio asAt + old price', () => {
    const oldPortfolio = { value: 10000, N: 2, asAt: '2026-06-01', startedAt: '2026-06-01' };
    const oldRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'BBB', snapshotPrice: 20 }];
    const newRows = [{ ticker: 'AAA', snapshotPrice: 10 }, { ticker: 'CCC', snapshotPrice: 5 }];
    const { sold } = computeRebalance(oldPortfolio, oldRows, newRows, [], {}, '2026-07-01');
    assert.equal(sold[0].entryDate, '2026-06-01'); // fell back to oldPortfolio.asAt
    assert.equal(sold[0].entryPrice, 20);          // fell back to old snapshotPrice
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```
npm test
```

Expected: 5 failures (module not found or functions undefined).

- [ ] **Step 3: Implement `scripts/lib/portfolio.js`**

```js
// scripts/lib/portfolio.js
// Pure: compute portfolio rebalance after a full-fetch batch run.
const STARTING_VALUE = 10000;

function computeRebalance(oldPortfolio, oldRows, newRows, allEvaluated, firstSeen, asAt) {
  const newTickers = new Set(newRows.map(r => r.ticker));

  // Build a price lookup for leaver stocks from the full evaluated set
  const newPriceMap = {};
  for (const e of allEvaluated) {
    if (e.ticker && e.snapshotPrice != null && e.snapshotPrice > 0) {
      newPriceMap[e.ticker] = e.snapshotPrice;
    }
  }
  // New ranked rows are always authoritative
  for (const r of newRows) newPriceMap[r.ticker] = r.snapshotPrice;

  // First run — nothing to rebalance
  if (!oldPortfolio || oldPortfolio.N === 0 || !oldRows.length) {
    return {
      portfolio: { value: STARTING_VALUE, N: newRows.length, asAt, startedAt: asAt },
      sold: [],
    };
  }

  const slotValue = oldPortfolio.value / oldPortfolio.N;
  const oldPriceMap = {};
  for (const r of oldRows) oldPriceMap[r.ticker] = r.snapshotPrice;

  let totalPool = 0;
  const sold = [];

  for (const r of oldRows) {
    const oldPrice = oldPriceMap[r.ticker];
    const newPrice = newPriceMap[r.ticker] ?? oldPrice; // fallback: no price movement
    const currentValue = slotValue * (newPrice / oldPrice);
    totalPool += currentValue;

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
    },
    sold,
  };
}

module.exports = { computeRebalance, STARTING_VALUE };
```

- [ ] **Step 4: Run tests — verify all 5 pass**

```
npm test
```

Expected: 5 passing, 0 failing.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/portfolio.js tests/portfolio.test.js
git commit -m "feat: add pure computeRebalance module + 5 tests"
```

---

### Task 2: Wire portfolio rebalance into the batch (`run-screen.js`)

**Files:**
- Modify: `scripts/lib/run-screen.js`

**Interfaces:**
- Consumes: `computeRebalance` from `./portfolio.js`
- Reads before overwrite: `www/<outDir>/rankings.json` (old rows)
- Reads: `www/<outDir>/first-seen.json` (already exists post-rankAndWrite)
- Reads/writes: `www/<outDir>/portfolio-value.json`
- Reads/appends: `www/<outDir>/sold.json`
- `data.evaluated` from `gather()` contains all evaluated stocks with `snapshotPrice` (sourced from `data.price` in `evaluate.js:30`)

- [ ] **Step 1: Add the `updatePortfolio` function and `require` to `run-screen.js`**

At the top of the file, after existing `require` statements, add:
```js
const { computeRebalance, STARTING_VALUE } = require('./portfolio.js');
```

Add the `updatePortfolio` function after the `rankAndWrite` function (before `runScreen`):

```js
function updatePortfolio(config, data, oldRankings) {
  const outDir = path.join(__dirname, '../../www', config.outDir);
  const portfolioPath = path.join(outDir, 'portfolio-value.json');
  const soldPath     = path.join(outDir, 'sold.json');
  const fsPath       = path.join(outDir, 'first-seen.json');

  const oldPortfolio  = fs.existsSync(portfolioPath) ? JSON.parse(fs.readFileSync(portfolioPath, 'utf8')) : null;
  const oldRows       = (oldRankings && oldRankings.rows) ? oldRankings.rows : [];
  const existingSold  = fs.existsSync(soldPath) ? JSON.parse(fs.readFileSync(soldPath, 'utf8')) : [];
  const firstSeen     = fs.existsSync(fsPath) ? JSON.parse(fs.readFileSync(fsPath, 'utf8')) : {};

  // New rankings were just written by rankAndWrite — read them back
  const newRankings = JSON.parse(fs.readFileSync(path.join(outDir, 'rankings.json'), 'utf8'));
  const newRows = newRankings.rows || [];

  const { portfolio, sold } = computeRebalance(
    oldPortfolio, oldRows, newRows, data.evaluated, firstSeen, data.asAt
  );

  fs.writeFileSync(portfolioPath, JSON.stringify(portfolio, null, 2) + '\n');
  fs.writeFileSync(soldPath, JSON.stringify([...existingSold, ...sold], null, 2) + '\n');

  if (sold.length) {
    console.log(`\nPortfolio: sold ${sold.length} — ${sold.map(s => s.ticker).join(', ')}`);
  }
  const gain = portfolio.value - STARTING_VALUE;
  const sign = gain >= 0 ? '+' : '';
  console.log(`Portfolio: $${portfolio.value.toFixed(2)} (${sign}${(gain / STARTING_VALUE * 100).toFixed(1)}%) · ${portfolio.N} holdings`);
}
```

- [ ] **Step 2: Restructure `runScreen` to call `updatePortfolio` only on full fetch**

Replace the current `runScreen` function body. The current code calls `rankAndWrite` at the end outside all branches. Restructure so each branch calls it internally and the full-fetch branch additionally calls `updatePortfolio`:

```js
async function runScreen(config, argv = process.argv) {
  const cachePath = path.join(__dirname, '..', config.cacheFile);
  let data;

  if (argv.includes('--reeval')) {
    const rawPath = path.join(__dirname, '..', config.rawFile || '');
    if (!config.rawFile || !fs.existsSync(rawPath)) throw new Error(`No raw cache at ${config.rawFile} — run a full fetch first.`);
    const b = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
    const live = { [b.liveKey || config.liveKey]: b.rf };
    console.log(`Re-evaluating ${b.raw.length} cached raw rows from ${b.asAt} (no fetch; rf=${(b.rf * 100).toFixed(2)}%).`);
    const evaluated = b.raw.map(d => evaluateStock(d, marketParamsFor(d.ticker, live)));
    data = { asAt: b.asAt, tickerCount: b.tickerCount, evaluated };
    fs.writeFileSync(cachePath, JSON.stringify(data) + '\n');
    rankAndWrite(config, data);

  } else if (argv.includes('--rerank')) {
    if (!fs.existsSync(cachePath)) throw new Error(`No cached data at ${config.cacheFile} — run without --rerank first.`);
    data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    console.log(`Re-ranking ${data.evaluated.length} cached rows from ${data.asAt} (no fetch).`);
    rankAndWrite(config, data);

  } else {
    // Full fetch — read old rankings BEFORE rankAndWrite overwrites them
    const outDir = path.join(__dirname, '../../www', config.outDir);
    const rankingsPath = path.join(outDir, 'rankings.json');
    const oldRankings = fs.existsSync(rankingsPath)
      ? JSON.parse(fs.readFileSync(rankingsPath, 'utf8'))
      : null;

    data = await gather(config);
    rankAndWrite(config, data);
    updatePortfolio(config, data, oldRankings);
  }
}
```

- [ ] **Step 3: Manual smoke test — run `--rerank` and confirm no portfolio files are touched**

```
node scripts/rank-asx.js --rerank
```

Expected: existing `portfolio-value.json` and `sold.json` unchanged. No "Portfolio:" line printed.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/run-screen.js
git commit -m "feat: wire portfolio rebalance into full-fetch batch (run-screen.js)"
```

---

### Task 3: Seed initial `portfolio-value.json` and `sold.json` for all three screens

Because the live rankings already exist but no batch has run with the new code yet, seed the files manually so the frontend has something to display immediately.

**Files:**
- Create: `www/asx-undervalued/portfolio-value.json`
- Create: `www/asx-undervalued/sold.json`
- Create: `www/sp500-undervalued/portfolio-value.json`
- Create: `www/sp500-undervalued/sold.json`
- Create: `www/nifty-undervalued/portfolio-value.json`
- Create: `www/nifty-undervalued/sold.json`

**Interfaces:**
- `portfolio-value.json` schema: `{ value: number, N: number, asAt: string, startedAt: string }`
- `sold.json` schema: `[]` (empty array; no exits have occurred yet)
- `value` must equal `STARTING_VALUE` (10000) — this is the "before any live movement" base
- `asAt` must match the `asAt` field in the corresponding `rankings.json`
- `N` must match `rankings.summary.shown` in the corresponding `rankings.json`
- `startedAt` equals `asAt` on the seed (first inception date)

- [ ] **Step 1: Read the current `asAt` and `shown` values from each `rankings.json`**

Run:
```
node -e "
['asx-undervalued','sp500-undervalued','nifty-undervalued'].forEach(s => {
  const r = require('./www/' + s + '/rankings.json');
  console.log(s, r.asAt, r.summary.shown);
});"
```

Note the three `asAt` dates and `shown` counts — you'll use them in Step 2.

- [ ] **Step 2: Write the six seed files**

For each screen, create `www/<screen>/portfolio-value.json` with the values from Step 1:

```json
{
  "value": 10000,
  "N": <shown from rankings.json>,
  "asAt": "<asAt from rankings.json>",
  "startedAt": "<asAt from rankings.json>"
}
```

And `www/<screen>/sold.json`:
```json
[]
```

Use the Write tool for each of the six files. Example for ASX (substitute real values from Step 1):

`www/asx-undervalued/portfolio-value.json`:
```json
{
  "value": 10000,
  "N": 20,
  "asAt": "2026-06-04",
  "startedAt": "2026-06-04"
}
```

- [ ] **Step 3: Commit the seed files**

```bash
git add www/asx-undervalued/portfolio-value.json www/asx-undervalued/sold.json
git add www/sp500-undervalued/portfolio-value.json www/sp500-undervalued/sold.json
git add www/nifty-undervalued/portfolio-value.json www/nifty-undervalued/sold.json
git commit -m "feat: seed initial portfolio-value.json and sold.json for all three screens"
```

---

### Task 4: Frontend — hero card + activity table (ASX screen first)

**Files:**
- Modify: `www/asx-undervalued/app.js`
- Modify: `www/asx-undervalued/style.css`

**Interfaces:**
- Consumes: `portfolio-value.json` → `{ value, N, asAt, startedAt }`
- Consumes: `sold.json` → `Array<{ ticker, entryDate, entryPrice, exitDate, exitPrice }>`
- Consumes: existing `live` price map and `rows` array already available in `init()`
- Uses: `escapeHtml()` from `../utils.js` (already loaded via `<script src="../utils.js">`)
- Produces: `.portfolio-hero` section injected before `.table-card`
- Produces: `.activity-card` section injected after `.table-card` (after leverage note if present)

- [ ] **Step 1: Update `init()` to load portfolio files**

Replace the existing `Promise.all` in `init()`:

```js
// Before (existing):
[rankings, firstSeen] = await Promise.all([
  getJSON('./rankings.json'),
  getJSON('./first-seen.json').catch(() => ({})),
]);

// After:
let rankings, firstSeen, portfolioData, soldData;
try {
  [rankings, firstSeen, portfolioData, soldData] = await Promise.all([
    getJSON('./rankings.json'),
    getJSON('./first-seen.json').catch(() => ({})),
    getJSON('./portfolio-value.json').catch(() => null),
    getJSON('./sold.json').catch(() => []),
  ]);
} catch (err) {
  statusEl.textContent = 'Could not load the rankings. Please try again later.';
  return;
}
```

Note: the existing `try/catch` wraps the whole block — keep it, just expand the destructuring.

- [ ] **Step 2: Add `renderHeroCard` function inside the IIFE (before `init`)**

```js
function renderHeroCard(portfolioData, rows, live) {
  if (!portfolioData || portfolioData.N === 0 || !rows.length) return;
  const slotBase = portfolioData.value / portfolioData.N;
  let liveValue = 0;
  for (const r of rows) {
    const lp = (typeof live[r.ticker] === 'number' && live[r.ticker] > 0)
      ? live[r.ticker] : r.snapshotPrice;
    liveValue += slotBase * (lp / r.snapshotPrice);
  }
  const gain    = liveValue - 10000;
  const gainPct = (gain / 10000 * 100).toFixed(1);
  const gainStr = (gain >= 0 ? '+' : '') + gainPct + '%';
  const sym     = (rows[0] && rows[0].currency === 'INR') ? '₹' : '$';
  const since   = portfolioData.startedAt || portfolioData.asAt;

  const el = document.createElement('section');
  el.className = 'portfolio-hero';
  el.innerHTML =
    '<div class="portfolio-hero-inner">' +
      '<div class="portfolio-hero-label">' + sym + '10K paper portfolio · equally weighted, rebalanced monthly</div>' +
      '<div class="portfolio-hero-stat">' +
        '<span class="portfolio-hero-value">' + sym + Math.round(liveValue).toLocaleString() + '</span>' +
        '<span class="portfolio-hero-gain ' + (gain >= 0 ? 'pos' : 'neg') + '">' + gainStr + '</span>' +
      '</div>' +
      '<div class="portfolio-hero-note">' + portfolioData.N + ' holdings · live prices · since ' + since + '</div>' +
    '</div>';

  tableEl.parentNode.insertAdjacentElement('beforebegin', el);
}
```

- [ ] **Step 3: Add `renderActivityTable` function inside the IIFE (before `init`)**

```js
function renderActivityTable(soldData, asAt, currency) {
  const recent = soldData.filter(function(s) { return s.exitDate === asAt; });
  if (!recent.length) return;
  const sym = currency === 'INR' ? '₹' : '$';
  const tbodyRows = recent.map(function(s) {
    const ret    = (s.exitPrice - s.entryPrice) / s.entryPrice;
    const retStr = (ret >= 0 ? '+' : '') + (ret * 100).toFixed(1) + '%';
    return '<tr>' +
      '<td>' + escapeHtml(s.ticker) + '</td>' +
      '<td>' + s.entryDate + '</td>' +
      '<td class="num">' + sym + Number(s.entryPrice).toFixed(2) + '</td>' +
      '<td>' + s.exitDate + '</td>' +
      '<td class="num">' + sym + Number(s.exitPrice).toFixed(2) + '</td>' +
      '<td class="num ' + (ret >= 0 ? 'pos' : 'neg') + '">' + retStr + '</td>' +
    '</tr>';
  }).join('');

  const el = document.createElement('section');
  el.className = 'activity-card';
  el.innerHTML =
    '<h3 class="activity-title">Stocks that exited this month</h3>' +
    '<div class="table-scroll"><table class="activity-table">' +
      '<thead><tr>' +
        '<th>Stock</th><th>Entry date</th><th class="num">Entry price</th>' +
        '<th>Exit date</th><th class="num">Exit price</th><th class="num">Return</th>' +
      '</tr></thead>' +
      '<tbody>' + tbodyRows + '</tbody>' +
    '</table></div>';

  // Insert after leverage note if present, else after table card
  const leverageNote = document.querySelector('.leverage-note');
  const ref = leverageNote || tableEl.parentNode;
  ref.insertAdjacentElement('afterend', el);
}
```

- [ ] **Step 4: Call both render functions at the end of `init()` (after live prices are fetched)**

Add these two lines right before the closing `}` of `init()`, after the existing leverage-note block:

```js
if (portfolioData) renderHeroCard(portfolioData, rows, live);
if (soldData && soldData.length) renderActivityTable(soldData, rankings.asAt, rows[0] ? rows[0].currency : null);
```

- [ ] **Step 5: Add CSS to `www/asx-undervalued/style.css`**

Append to the bottom of `style.css`:

```css
/* ── Paper portfolio hero card ── */
.portfolio-hero {
  margin: 0 0 16px;
  padding: 16px 20px;
  background: var(--kv-card);
  border: 1px solid var(--kv-border);
  border-radius: 10px;
}
.portfolio-hero-label {
  font-size: 0.78rem;
  color: var(--kv-muted);
  margin-bottom: 8px;
}
.portfolio-hero-stat {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.portfolio-hero-value {
  font-size: 1.6rem;
  font-weight: 700;
  color: var(--kv-text);
}
.portfolio-hero-gain {
  font-size: 1.1rem;
  font-weight: 600;
}
.portfolio-hero-gain.pos { color: var(--kv-pass); }
.portfolio-hero-gain.neg { color: var(--kv-fail); }
.portfolio-hero-note {
  font-size: 0.75rem;
  color: var(--kv-muted);
  margin-top: 4px;
}

/* ── Recent activity table ── */
.activity-card {
  margin: 16px 0 0;
  padding: 16px 20px;
  background: var(--kv-card);
  border: 1px solid var(--kv-border);
  border-radius: 10px;
}
.activity-title {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--kv-text);
  margin: 0 0 12px;
}
.activity-table {
  width: 100%;
  font-size: 0.82rem;
  border-collapse: collapse;
  min-width: 420px;
}
.activity-table th {
  color: var(--kv-muted);
  font-weight: 500;
  padding: 4px 8px;
  text-align: left;
  border-bottom: 1px solid var(--kv-border);
  white-space: nowrap;
}
.activity-table th.num,
.activity-table td.num { text-align: right; }
.activity-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--kv-border);
  color: var(--kv-text);
  white-space: nowrap;
}
```

- [ ] **Step 6: Start dev server and verify ASX screen visually**

```
npm run dev
```

Open `http://localhost:8000/asx-undervalued/`. Check:
- Hero card appears above the rankings table showing `$10,000 (+0.0%)` (seeded value, will move with live prices)
- Hero card updates with live prices (the gain% should not stay at exactly 0.0% once live prices load)
- No activity table appears (sold.json is empty — correct)
- Existing table, leverage note, Sharesight block are unaffected

- [ ] **Step 7: Commit ASX frontend changes**

```bash
git add www/asx-undervalued/app.js www/asx-undervalued/style.css
git commit -m "feat: add paper portfolio hero card + activity table to ASX undervalued screen"
```

---

### Task 5: Copy frontend changes to S&P 500 and NIFTY screens

**Files:**
- Modify: `www/sp500-undervalued/app.js` — identical changes as Task 4
- Modify: `www/sp500-undervalued/style.css` — identical CSS as Task 4
- Modify: `www/nifty-undervalued/app.js` — identical changes as Task 4
- Modify: `www/nifty-undervalued/style.css` — identical CSS as Task 4

- [ ] **Step 1: Apply the same four JS changes to `www/sp500-undervalued/app.js`**

All three `app.js` files are byte-for-byte identical (confirmed). Apply the same four edits from Task 4 Steps 1–4 to `www/sp500-undervalued/app.js`:
1. Expand `Promise.all` to include `portfolioData` and `soldData`
2. Add `renderHeroCard` function
3. Add `renderActivityTable` function
4. Call both at the end of `init()`

- [ ] **Step 2: Append the same CSS block to `www/sp500-undervalued/style.css`**

Copy the full CSS block from Task 4 Step 5 and append it to `www/sp500-undervalued/style.css`.

- [ ] **Step 3: Apply the same four JS changes to `www/nifty-undervalued/app.js`**

Apply the same four edits from Task 4 Steps 1–4 to `www/nifty-undervalued/app.js`.

- [ ] **Step 4: Append the same CSS block to `www/nifty-undervalued/style.css`**

Copy the full CSS block from Task 4 Step 5 and append it to `www/nifty-undervalued/style.css`.

- [ ] **Step 5: Verify S&P 500 and NIFTY screens in the dev server**

```
npm run dev
```

Check `http://localhost:8000/sp500-undervalued/` and `http://localhost:8000/nifty-undervalued/`:
- Hero card shows `$10,000` base with live price movement applied
- NIFTY screen shows `₹` symbol (rows[0].currency === 'INR')
- No activity table (sold.json is empty)
- No regressions in either screen

- [ ] **Step 6: Commit**

```bash
git add www/sp500-undervalued/app.js www/sp500-undervalued/style.css
git add www/nifty-undervalued/app.js www/nifty-undervalued/style.css
git commit -m "feat: add paper portfolio hero card + activity table to S&P 500 and NIFTY screens"
```

---

### Task 6: Deploy

- [ ] **Step 1: Run full test suite**

```
npm test
```

Expected: all tests pass (5 existing portfolio tests + any pre-existing tests).

- [ ] **Step 2: xcopy to StockAnalysis and push**

```powershell
xcopy /E /Y /I "C:\Projects\DCFAnalysis\www" "C:\Projects\StockAnalysis\www\dcf"
cd "C:\Projects\StockAnalysis"
git add www/dcf/
git commit -m "Deploy: paper portfolio hero card on all three undervalued screens"
git push
```

- [ ] **Step 3: Hand off to user for live verification**

The user verifies the deployed site. Cloudflare Pages auto-deploys in ~1 min after push.

---

## Post-deploy: next batch run

On the next monthly `node scripts/rank-asx.js` (full fetch, no flags), the batch will:
1. Read old `rankings.json` before overwriting
2. Diff old top-N vs new top-N
3. Append any leavers to `sold.json` with their exit prices
4. Recompute `portfolio-value.json` with the new value and N
5. Print a "Portfolio:" summary line to the console

After that batch runs, the hero card will show the updated value and the activity table will show that month's exits.
