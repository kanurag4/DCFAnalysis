# Undervalued-screen list backfill ("Still held") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When an undervalued screen produces fewer than 20 qualifying stocks in a week, top the list up toward 20 by retaining the best-performing stocks flagged in earlier weeks that no longer trade below fair value — shown as a separate "Still held" group, kept in the paper portfolio while ahead.

**Architecture:** A new pure function `selectRetained()` runs inside `run-screen.js`'s `rankAndWrite`, after `rankRows`, gated on a per-screen `config.retention` block. It reads last week's *committed* `rankings.json` for the candidate pool, `first-seen.json` for entry prices, and this run's evaluated set for current prices. Retained rows are written into `rankings.json` with a `retained: true` marker; `computeRebalance`/`updatePortfolio`/`mergeFirstSeen` need **no changes** — retained tickers are simply present in the written rows so the portfolio keeps their slots, and released ones are absent so the existing logic sells them. Pilot on NIFTY only.

**Tech Stack:** Node 20, `node:test` (`node --experimental-test-module-mocks --test tests/*.test.js`), plain CommonJS, no build step. Vanilla-JS screen pages (`www/nifty-undervalued/`). GitHub Actions (`publish-screen.yml`).

**Spec:** `docs/superpowers/specs/2026-08-29-undervalued-list-backfill-design.md` — read it alongside this plan.

## Global Constraints

- **Two repos.** Tasks 1–4, 6, 7 are in `DCFAnalysis` (this repo). Task 5 is in `stock-evaluator` (`C:\Projects\StockAnalysis`). Never cross-edit in one commit.
- **Pilot = NIFTY only.** Only `scripts/rank-nifty.js` gets a `retention` block. The other 5 screen configs (`rank-asx.js`, `rank-sp500.js`, `rank-kospi.js`, `rank-nikkei.js`, `rank-europe.js`) are **not touched** and must behave byte-for-byte as today.
- **`topN` is 20** for all screens (read from `config.topN`, never hard-code).
- **`retention.maxWeeks` is per-config** — NIFTY: `12`. No global constant.
- **"Prior week" = the committed `rankings.json`** (`git show HEAD:www/<outDir>/rankings.json`), not the working-tree file — stable across `--rerank`/`--reeval` reruns.
- **`returnSinceFlagged` is price-based:** `(thisPrice − firstPrice) / firstPrice`, where `firstPrice = first-seen.json[ticker].firstPrice` and `thisPrice` = this run's snapshot price from `data.evaluated`.
- **Winners only:** a candidate with `returnSinceFlagged <= 0`, or `weeksRetained >= maxWeeks`, or no `first-seen` entry, is **not** retained — it's released (absent from written rows → sold by existing portfolio logic).
- CRLF: several DCFAnalysis files are CRLF in the Windows working tree but `.gitattributes` is `* text=auto eol=lf` — commit diffs normalise to LF; verify `git diff --cached` shows only your intended lines, not a whole-file flip.
- Commit messages end with the Co-Authored-By / Claude-Session trailer already used in this repo's history.

---

## File Structure

**DCFAnalysis:**
| File | Responsibility |
|---|---|
| `scripts/lib/retention.js` (**create**) | Pure `selectRetained()` — the whole algorithm, no fs/no Date.now |
| `tests/retention.test.js` (**create**) | Unit tests for `selectRetained` |
| `scripts/lib/run-screen.js` (**modify**) | `readPublishedRankings()` helper; wire `selectRetained` into `rankAndWrite`; `--prior-rankings=<path>` dev flag |
| `tests/run-screen.test.js` (**modify**) | Integration test: prior rankings + evaluated fixture → 20 written rows, 6 retained |
| `scripts/rank-nifty.js` (**modify**) | Add `retention: { maxWeeks: 12 }` |
| `www/nifty-undervalued/app.js` (**modify**) | `renderScreenSummary` text; split rows; render "Still held" table |
| `www/nifty-undervalued/index.html` (**modify**) | One sentence in `.rules-intro` |
| `www/nifty-undervalued/style.css` (**modify**) | `.stillheld-*` block |
| `.github/workflows/publish-screen.yml` (**modify**) | Add `www/sector-margins.json` to the publish copy list + assertion |

**stock-evaluator:**
| File | Responsibility |
|---|---|
| `scripts/newsletter-subject-lines.js` (**modify**) | `groupTopN` filters `!row.retained` before sorting |
| `tests/newsletter-subject-lines.test.js` (**create**) | Test the filter (a high-margin retained row is excluded from the top 3) |

---

## Task 1: `retention.js` pure function (DCFAnalysis)

**Files:**
- Create: `scripts/lib/retention.js`
- Test: `tests/retention.test.js`

**Interfaces:**
- Consumes: nothing (pure)
- Produces:
  ```
  selectRetained({
    qualified,        // Array<{ticker}>  — this week's rankRows output (rank already assigned)
    priorRows,        // Array<{ticker, retained?, retainedSince?}> — last week's committed rankings.json rows (or [])
    firstSeen,        // { [ticker]: { firstSeen: 'YYYY-MM-DD', firstPrice: number } }
    evaluatedPrices,  // { [ticker]: number }  — this run's snapshot price per ticker
    asAt,             // 'YYYY-MM-DD'
    need,             // number  — topN - qualified.length  (caller guarantees > 0)
    maxWeeks,         // number  — config.retention.maxWeeks
    blacklist,        // Set<string>  — config.blacklist (may be empty)
  }) => {
    retained: Array<{ ticker, retainedSince, returnSinceFlagged }>,  // length <= need, sorted by returnSinceFlagged desc
    released: string[],                                              // tickers on priorRows, not qualified, not retained
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `tests/retention.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { selectRetained } = require('../scripts/lib/retention.js');

// Helpers to keep fixtures terse.
const q = (...tickers) => tickers.map((ticker, i) => ({ ticker, rank: i + 1 }));
const prior = (...tickers) => tickers.map((ticker) => ({ ticker }));

const FS = {
  WIN1: { firstSeen: '2026-06-01', firstPrice: 100 },   // now 140 -> +40%
  WIN2: { firstSeen: '2026-06-08', firstPrice: 100 },   // now 120 -> +20%
  WIN3: { firstSeen: '2026-06-15', firstPrice: 100 },   // now 110 -> +10%
  LOSE: { firstSeen: '2026-06-01', firstPrice: 100 },   // now 90  -> -10%
  STALE: { firstSeen: '2026-01-01', firstPrice: 100 },  // retained since 2026-06-01, now 2026-08-31 -> 13 weeks
};
const PRICES = { WIN1: 140, WIN2: 120, WIN3: 110, LOSE: 90, STALE: 150 };
const ASAT = '2026-08-31';

test('takes the top `need` winners by return since flagged, desc', () => {
  const { retained, released } = selectRetained({
    qualified: q('AAA', 'BBB'),
    priorRows: prior('AAA', 'BBB', 'WIN1', 'WIN2', 'WIN3'),
    firstSeen: FS, evaluatedPrices: PRICES, asAt: ASAT,
    need: 2, maxWeeks: 12, blacklist: new Set(),
  });
  assert.deepStrictEqual(retained.map(r => r.ticker), ['WIN1', 'WIN2']);
  assert.deepStrictEqual(retained.map(r => r.returnSinceFlagged), [0.4, 0.2]);
  assert.deepStrictEqual(released, ['WIN3']); // eligible winner but no slot
});

test('a candidate down since flagged is released, never retained', () => {
  const { retained, released } = selectRetained({
    qualified: q('AAA'),
    priorRows: prior('AAA', 'LOSE', 'WIN1'),
    firstSeen: FS, evaluatedPrices: PRICES, asAt: ASAT,
    need: 5, maxWeeks: 12, blacklist: new Set(),
  });
  assert.deepStrictEqual(retained.map(r => r.ticker), ['WIN1']);
  assert.ok(released.includes('LOSE'));
});

test('carries retainedSince forward from the prior row', () => {
  const { retained } = selectRetained({
    qualified: q('AAA'),
    priorRows: [{ ticker: 'AAA' }, { ticker: 'WIN1', retained: true, retainedSince: '2026-08-10' }],
    firstSeen: FS, evaluatedPrices: PRICES, asAt: ASAT,
    need: 1, maxWeeks: 12, blacklist: new Set(),
  });
  assert.strictEqual(retained[0].retainedSince, '2026-08-10');
});

test('sets retainedSince to asAt when a ticker is first retained', () => {
  const { retained } = selectRetained({
    qualified: q('AAA'),
    priorRows: prior('AAA', 'WIN1'),
    firstSeen: FS, evaluatedPrices: PRICES, asAt: ASAT,
    need: 1, maxWeeks: 12, blacklist: new Set(),
  });
  assert.strictEqual(retained[0].retainedSince, ASAT);
});

test('releases a ticker that has been retained >= maxWeeks', () => {
  const { retained, released } = selectRetained({
    qualified: q('AAA'),
    priorRows: [{ ticker: 'AAA' }, { ticker: 'STALE', retained: true, retainedSince: '2026-06-01' }],
    firstSeen: FS, evaluatedPrices: PRICES, asAt: ASAT, // 2026-06-01 -> 2026-08-31 is ~13 weeks
    need: 1, maxWeeks: 12, blacklist: new Set(),
  });
  assert.deepStrictEqual(retained, []);
  assert.deepStrictEqual(released, ['STALE']);
});

test('releases a candidate with no first-seen entry', () => {
  const { retained, released } = selectRetained({
    qualified: q('AAA'),
    priorRows: prior('AAA', 'GHOST'),
    firstSeen: FS, evaluatedPrices: { ...PRICES, GHOST: 999 }, asAt: ASAT,
    need: 1, maxWeeks: 12, blacklist: new Set(),
  });
  assert.deepStrictEqual(retained, []);
  assert.deepStrictEqual(released, ['GHOST']);
});

test('releases a candidate with no fresh price this run', () => {
  const { retained, released } = selectRetained({
    qualified: q('AAA'),
    priorRows: prior('AAA', 'WIN1'),
    firstSeen: FS, evaluatedPrices: {}, asAt: ASAT, // WIN1 has no price
    need: 1, maxWeeks: 12, blacklist: new Set(),
  });
  assert.deepStrictEqual(retained, []);
  assert.deepStrictEqual(released, ['WIN1']);
});

test('excludes blacklisted tickers from retention (released)', () => {
  const { retained, released } = selectRetained({
    qualified: q('AAA'),
    priorRows: prior('AAA', 'WIN1'),
    firstSeen: FS, evaluatedPrices: PRICES, asAt: ASAT,
    need: 1, maxWeeks: 12, blacklist: new Set(['WIN1']),
  });
  assert.deepStrictEqual(retained, []);
  assert.deepStrictEqual(released, ['WIN1']);
});

test('a candidate that re-qualified this week is neither retained nor released', () => {
  const { retained, released } = selectRetained({
    qualified: q('AAA', 'WIN1'),           // WIN1 is back in the qualified set
    priorRows: prior('AAA', 'WIN1', 'WIN2'),
    firstSeen: FS, evaluatedPrices: PRICES, asAt: ASAT,
    need: 1, maxWeeks: 12, blacklist: new Set(),
  });
  assert.deepStrictEqual(retained.map(r => r.ticker), ['WIN2']);
  assert.ok(!released.includes('WIN1'));
});

test('returnSinceFlagged is rounded to 4 dp', () => {
  const { retained } = selectRetained({
    qualified: q('AAA'),
    priorRows: prior('AAA', 'ODD'),
    firstSeen: { ODD: { firstSeen: '2026-06-01', firstPrice: 3 } },
    evaluatedPrices: { ODD: 4 }, asAt: ASAT,      // 1/3 = 0.33333...
    need: 1, maxWeeks: 12, blacklist: new Set(),
  });
  assert.strictEqual(retained[0].returnSinceFlagged, 0.3333);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/retention.test.js`
Expected: FAIL — `Cannot find module '../scripts/lib/retention.js'`

- [ ] **Step 3: Write the implementation**

Create `scripts/lib/retention.js`:

```js
// scripts/lib/retention.js
// Pure: pick which stocks from last week's list to retain ("Still held") when
// fewer than topN qualify this week. See
// docs/superpowers/specs/2026-08-29-undervalued-list-backfill-design.md.
//
// A candidate is eligible only if it is UP since first flagged and has been
// retained for fewer than maxWeeks. Eligible candidates compete for the
// `need` slots by return-since-flagged, highest first. Everything on last
// week's list that isn't qualified this week and isn't retained is
// "released" -- the caller drops it from the written rows, and the existing
// portfolio rebalance logs it to sold.json at its real gain/loss.

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function weeksBetween(fromISO, toISO) {
  return Math.round((Date.parse(toISO) - Date.parse(fromISO)) / MS_PER_WEEK);
}

function selectRetained({ qualified, priorRows, firstSeen, evaluatedPrices, asAt, need, maxWeeks, blacklist }) {
  const qualifiedSet = new Set(qualified.map(r => r.ticker));
  const priorByTicker = new Map(priorRows.map(r => [r.ticker, r]));

  const candidates = [];
  const released = [];

  for (const row of priorRows) {
    const { ticker } = row;
    if (qualifiedSet.has(ticker)) continue; // re-qualified — handled by rankRows, not here

    const fs = firstSeen[ticker];
    const price = evaluatedPrices[ticker];
    const priceOk = typeof price === 'number' && price > 0;
    const fsOk = fs && typeof fs.firstPrice === 'number' && fs.firstPrice > 0;

    if (!fsOk || !priceOk || (blacklist && blacklist.has(ticker))) {
      released.push(ticker);
      continue;
    }

    const returnSinceFlagged = +(((price - fs.firstPrice) / fs.firstPrice).toFixed(4));
    const retainedSince = row.retained && row.retainedSince ? row.retainedSince : asAt;
    const weeksRetained = row.retained && row.retainedSince ? weeksBetween(row.retainedSince, asAt) : 0;

    if (returnSinceFlagged <= 0 || weeksRetained >= maxWeeks) {
      released.push(ticker);
      continue;
    }

    candidates.push({ ticker, retainedSince, returnSinceFlagged });
  }

  candidates.sort((a, b) => b.returnSinceFlagged - a.returnSinceFlagged);
  const retained = candidates.slice(0, need);
  const retainedSet = new Set(retained.map(r => r.ticker));

  // Eligible winners that didn't get a slot are released too.
  for (const c of candidates) {
    if (!retainedSet.has(c.ticker)) released.push(c.ticker);
  }

  return { retained, released };
}

module.exports = { selectRetained, weeksBetween };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/retention.test.js`
Expected: PASS (10/10)

- [ ] **Step 5: Run the full suite (nothing else broke)**

Run: `npm test`
Expected: all pass, retention.test.js included.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/retention.js tests/retention.test.js
git commit -m "feat(screens): pure selectRetained() for undervalued-list backfill

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BTUAdmeoXMj7k8RLvQ3Svh"
```

---

## Task 2: Wire retention into `run-screen.js` (DCFAnalysis)

**Files:**
- Modify: `scripts/lib/run-screen.js` — `readPublishedTickers` (refactor), `rankAndWrite` (lines ~142–221), add flag parsing
- Test: `tests/run-screen.test.js` (append)

**Interfaces:**
- Consumes: `selectRetained` from Task 1.
- Produces:
  - `readPublishedRankings(config, opts?)` → `{ rows: [...] } | null` — parsed committed `rankings.json` (or the file at `opts.priorPath` if given).
  - `rankings.json` `rows` now may contain rows with `{ retained: true, retainedSince, returnSinceFlagged }`; `summary.retained` (number) and `summary.shown = qualified + retained`.

- [ ] **Step 1: Refactor `readPublishedTickers` to expose the full rows**

Replace the existing `readPublishedTickers` (currently ~lines 127–140) with:

```js
// The last *published* (git HEAD) rankings.json for this screen -- the stable
// anchor for first-seen reentry AND for retention's candidate pool, since it
// survives --rerank/--reeval runs that mutate the on-disk file without
// committing. `opts.priorPath` overrides the source with an explicit file
// (dev-only, for the pilot preview).
function readPublishedRankings(config, opts = {}) {
  try {
    if (opts.priorPath) {
      return JSON.parse(fs.readFileSync(opts.priorPath, 'utf8'));
    }
    const repoRoot = path.join(__dirname, '../..');
    const rel = `www/${config.outDir}/rankings.json`;
    const out = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    return JSON.parse(out);
  } catch (_) {
    return null; // no committed rankings yet (first-ever run) / bad file
  }
}

function readPublishedTickers(config) {
  const published = readPublishedRankings(config);
  return new Set((published && published.rows ? published.rows : []).map(r => r.ticker));
}
```

Add near the other requires (top of file):
```js
const { selectRetained } = require('./retention.js');
```

- [ ] **Step 2: Parse the `--prior-rankings` dev flag**

In `runScreen` (near the top, ~line 362), after `let data;`:
```js
  const priorFlag = argv.find(a => a.startsWith('--prior-rankings='));
  const priorPath = priorFlag ? priorFlag.slice('--prior-rankings='.length) : null;
```
Thread `priorPath` into every `rankAndWrite(config, data)` call → `rankAndWrite(config, data, { priorPath })` (three call sites: `--reeval`, `--rerank`, full-fetch).

- [ ] **Step 3: Add the retention block to `rankAndWrite`**

Change the signature:
```js
function rankAndWrite(config, { asAt, tickerCount, evaluated, fx }, opts = {}) {
```

After `const ranked = rankRows(eligible, { topN, maxMargin });` and the funnel `console.log`, before building `rounded`:

```js
  // ── Retention / "Still held" backfill ────────────────────────────────
  // Only when this screen opts in (config.retention) AND fewer than topN
  // qualified. See the design doc. Everything below is a no-op for the
  // other 5 screens (no config.retention) -- their output is byte-identical.
  let retainedRows = [];
  let releasedTickers = [];
  if (config.retention && ranked.length < topN) {
    const prior = readPublishedRankings(config, opts);
    const priorRows = (prior && prior.rows) ? prior.rows : [];
    if (priorRows.length) {
      const fsPathForRetention = path.join(__dirname, '../../www', config.outDir, 'first-seen.json');
      const firstSeen = fs.existsSync(fsPathForRetention)
        ? JSON.parse(fs.readFileSync(fsPathForRetention, 'utf8'))
        : {};
      const evaluatedPrices = {};
      for (const e of evaluated) {
        if (e.ticker && e.snapshotPrice != null && e.snapshotPrice > 0) evaluatedPrices[e.ticker] = e.snapshotPrice;
      }
      const { retained, released } = selectRetained({
        qualified: ranked,
        priorRows,
        firstSeen,
        evaluatedPrices,
        asAt,
        need: topN - ranked.length,
        maxWeeks: config.retention.maxWeeks,
        blacklist,
      });
      releasedTickers = released;
      // Hydrate each retained ticker's display fields from this run's
      // evaluated row (name/sector/method/price) + the retention result.
      const evalByTicker = new Map(evaluated.map(e => [e.ticker, e]));
      retainedRows = retained.map((r, i) => {
        const e = evalByTicker.get(r.ticker) || {};
        return {
          rank: ranked.length + i + 1,
          ticker: r.ticker,
          name: e.name ?? null,
          sector: e.sector ?? null,
          method: e.method ?? null,
          intrinsic: e.intrinsic != null ? +e.intrinsic.toFixed(2) : null,
          snapshotPrice: e.snapshotPrice != null ? +Number(e.snapshotPrice).toFixed(2) : null,
          marginOfSafety: e.marginOfSafety != null ? +e.marginOfSafety.toFixed(4) : null,
          currency: e.currency ?? config.currency,
          retained: true,
          retainedSince: r.retainedSince,
          returnSinceFlagged: r.returnSinceFlagged,
        };
      });
    }
  }
```

- [ ] **Step 4: Append retained rows to the written output**

Where `rankings.json` is written (`fs.writeFileSync(path.join(outDir, 'rankings.json'), JSON.stringify({ asAt, universe, summary, rows: rounded, ... }))`):

- change `rows: rounded` → `rows: [...rounded, ...retainedRows]`
- in the `summary` object add: `retained: retainedRows.length,`
- change `shown: ranked.length` → `shown: ranked.length + retainedRows.length,`

Where `mergeFirstSeen` is called: change `rounded` → `[...rounded, ...retainedRows]` so retained tickers are seen as continuing (they're in `readPublishedTickers`, so `isContinuing` is true and their entry is preserved — verified against `firstSeen.js`).

After the existing `Top ${rounded.length}` console loop, add:
```js
  if (retainedRows.length) {
    console.log(`\nStill held (${retainedRows.length}): ${retainedRows.map(r => `${r.ticker} +${(r.returnSinceFlagged * 100).toFixed(0)}%`).join(', ')}`);
  }
  if (releasedTickers.length) {
    console.log(`Released from retention: ${releasedTickers.join(', ')}`);
  }
```

- [ ] **Step 5: Write the integration test**

Append to `tests/run-screen.test.js`:

```js
const os = require('node:os');
const { execFileSync: _exec } = require('node:child_process');

test('rankAndWrite backfills to topN with retained rows when a screen opts in', () => {
  // Build a throwaway screen dir with a committed prior rankings.json + a
  // first-seen ledger, then rerank a fixture evaluated set through it.
  const { runScreen } = require('../scripts/lib/run-screen.js');
  const repoRoot = path.join(__dirname, '..');
  const outDir = '_test-retention-screen';
  const absOut = path.join(repoRoot, 'www', outDir);
  fs.mkdirSync(absOut, { recursive: true });

  // Prior week: 2 qualified + 1 already-retained
  fs.writeFileSync(path.join(absOut, 'rankings.json'), JSON.stringify({
    asAt: '2026-08-24', universe: 'TEST',
    summary: { tickers: 5, evaluated: 5, qualified: 2, retained: 1, shown: 3, marginCapPct: 80, dropped: {} },
    rows: [
      { rank: 1, ticker: 'QUAL1', snapshotPrice: 10 },
      { rank: 2, ticker: 'QUAL2', snapshotPrice: 10 },
      { rank: 3, ticker: 'WINNER', snapshotPrice: 10, retained: true, retainedSince: '2026-08-17' },
    ],
  }, null, 2) + '\n');
  fs.writeFileSync(path.join(absOut, 'first-seen.json'), JSON.stringify({
    QUAL1: { firstSeen: '2026-08-01', firstPrice: 8 },
    QUAL2: { firstSeen: '2026-08-01', firstPrice: 8 },
    WINNER: { firstSeen: '2026-07-01', firstPrice: 5 },   // now 12 -> +140%
    DROPPED: { firstSeen: '2026-08-10', firstPrice: 20 }, // now 10 -> -50%, released
  }, null, 2) + '\n');

  // Commit so `git show HEAD:` sees the prior rankings.
  _exec('git', ['add', `www/${outDir}/rankings.json`, `www/${outDir}/first-seen.json`], { cwd: repoRoot });
  _exec('git', ['commit', '-m', 'test: fixture prior rankings', '--no-verify'], { cwd: repoRoot });

  // This week: only QUAL1 qualifies; WINNER is up, DROPPED is down.
  const evaluated = [
    { ticker: 'QUAL1', name: 'Q1', sector: 'Tech', method: 'DCF', fcfMethod: 'reported', intrinsic: 20, snapshotPrice: 10, marginOfSafety: 1.0, wacc: 0.08, currency: 'USD' },
    { ticker: 'WINNER', name: 'W', sector: 'Tech', method: 'DCF', fcfMethod: 'reported', intrinsic: 11, snapshotPrice: 12, marginOfSafety: -0.083, wacc: 0.08, currency: 'USD' },
    { ticker: 'DROPPED', name: 'D', sector: 'Tech', method: 'DCF', fcfMethod: 'reported', intrinsic: 9, snapshotPrice: 10, marginOfSafety: -0.1, wacc: 0.08, currency: 'USD' },
  ];
  const cacheFile = `_test-retention-cache.json`;
  fs.writeFileSync(path.join(repoRoot, 'scripts', cacheFile), JSON.stringify({ asAt: '2026-08-31', tickerCount: 3, evaluated }) + '\n');

  const config = { outDir, cacheFile, universe: 'TEST', currency: 'USD', topN: 3, maxMargin: 0.8, retention: { maxWeeks: 12 } };

  try {
    return runScreen(config, ['node', 'x', '--rerank']).then(() => {
      const out = JSON.parse(fs.readFileSync(path.join(absOut, 'rankings.json'), 'utf8'));
      assert.strictEqual(out.rows.length, 2);                 // 1 qualified + 1 retained (only WINNER eligible)
      assert.strictEqual(out.summary.qualified, 1);
      assert.strictEqual(out.summary.retained, 1);
      assert.strictEqual(out.summary.shown, 2);
      const w = out.rows.find(r => r.ticker === 'WINNER');
      assert.strictEqual(w.retained, true);
      assert.strictEqual(w.retainedSince, '2026-08-17');      // carried forward
      assert.strictEqual(w.returnSinceFlagged, 1.4);          // (12-5)/5
      assert.strictEqual(w.rank, 2);
    });
  } finally {
    _exec('git', ['reset', '--hard', 'HEAD~1'], { cwd: repoRoot });
    fs.rmSync(absOut, { recursive: true, force: true });
    fs.rmSync(path.join(repoRoot, 'scripts', cacheFile), { force: true });
  }
});
```

- [ ] **Step 6: Run the integration test**

Run: `node --test tests/run-screen.test.js`
Expected: PASS. (If the `git commit` in the test complains about identity, the CI/dev env already has `user.name`/`user.email` set from other tests — if not, the test's `_exec` calls will need `-c user.email=t@t -c user.name=t` prepended; add that only if it actually fails.)

- [ ] **Step 7: Full suite**

Run: `npm test`
Expected: all pass. Pay attention that `rank.test.js`, `portfolio.test.js`, `firstSeen.test.js` still pass unchanged.

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/run-screen.js tests/run-screen.test.js
git commit -m "feat(screens): wire selectRetained into rankAndWrite (opt-in via config.retention)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BTUAdmeoXMj7k8RLvQ3Svh"
```

---

## Task 3: NIFTY config + confirm other screens inert (DCFAnalysis)

**Files:**
- Modify: `scripts/rank-nifty.js`
- Test: `tests/run-screen.test.js` (append one assertion)

**Interfaces:**
- Consumes: `rankAndWrite`'s `config.retention` branch from Task 2.
- Produces: NIFTY's `config` object gains `retention: { maxWeeks: 12 }`.

- [ ] **Step 1: Write the "inert without config.retention" test**

Append to `tests/run-screen.test.js`:

```js
test('rankAndWrite is unchanged for a screen with no config.retention', () => {
  const { runScreen } = require('../scripts/lib/run-screen.js');
  const repoRoot = path.join(__dirname, '..');
  const outDir = '_test-no-retention-screen';
  const absOut = path.join(repoRoot, 'www', outDir);
  fs.mkdirSync(absOut, { recursive: true });
  fs.writeFileSync(path.join(absOut, 'first-seen.json'), '{}\n');

  const evaluated = [
    { ticker: 'A', name: 'A', method: 'DCF', fcfMethod: 'reported', intrinsic: 20, snapshotPrice: 10, marginOfSafety: 1.0, wacc: 0.08, currency: 'USD' },
  ];
  const cacheFile = '_test-no-retention-cache.json';
  fs.writeFileSync(path.join(repoRoot, 'scripts', cacheFile), JSON.stringify({ asAt: '2026-08-31', tickerCount: 1, evaluated }) + '\n');
  const config = { outDir, cacheFile, universe: 'TEST', currency: 'USD', topN: 20, maxMargin: 0.8 }; // NO retention

  try {
    return runScreen(config, ['node', 'x', '--rerank']).then(() => {
      const out = JSON.parse(fs.readFileSync(path.join(absOut, 'rankings.json'), 'utf8'));
      assert.strictEqual(out.rows.length, 1);
      assert.strictEqual(out.summary.retained, 0);           // present, zero
      assert.strictEqual(out.summary.shown, 1);
      assert.ok(!out.rows.some(r => r.retained));
    });
  } finally {
    fs.rmSync(absOut, { recursive: true, force: true });
    fs.rmSync(path.join(repoRoot, 'scripts', cacheFile), { force: true });
  }
});
```

> Note on `summary.retained` for non-retention screens: Task 2 Step 4 sets `retained: retainedRows.length` unconditionally, so it's always `0` when there's no `config.retention`. That's a harmless new field; the other screens' pages ignore it. If you prefer it fully absent for non-opt-in screens, wrap it: `...(config.retention ? { retained: retainedRows.length } : {})` and change this test to `assert.strictEqual(out.summary.retained, undefined)`. Either is fine — pick one and keep the test matching.

- [ ] **Step 2: Run it — verify it passes** (the behaviour already exists from Task 2)

Run: `node --test tests/run-screen.test.js`
Expected: PASS.

- [ ] **Step 3: Add the retention block to NIFTY's config**

In `scripts/rank-nifty.js`, inside the config object (next to `topN: 20,` / `maxMargin: 0.8,`):

```js
  // Backfill the list toward topN with retained "Still held" winners from
  // earlier weeks when a strict week produces < 20 qualifiers. NIFTY pilot —
  // see docs/superpowers/specs/2026-08-29-undervalued-list-backfill-design.md.
  retention: { maxWeeks: 12 },
```

- [ ] **Step 4: Full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/rank-nifty.js tests/run-screen.test.js
git commit -m "feat(nifty): opt into list backfill (retention.maxWeeks = 12)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BTUAdmeoXMj7k8RLvQ3Svh"
```

---

## Task 4: NIFTY page — "Still held" section + explainer (DCFAnalysis)

**Files:**
- Modify: `www/nifty-undervalued/app.js` — `renderScreenSummary`, the render pipeline
- Modify: `www/nifty-undervalued/index.html` — `.rules-intro`
- Modify: `www/nifty-undervalued/style.css` — `.stillheld-*`

**Interfaces:**
- Consumes: `rankings.json` rows with `retained: true`, `retainedSince`, `returnSinceFlagged`; `summary.retained`.
- Produces: no exports — page rendering only.

No unit-test framework runs against `app.js` (it's browser vanilla JS). Verification is the local render in Task 7.

- [ ] **Step 1: Update the rules intro in `index.html`**

Find `<p class="rules-intro">Every NIFTY 500 company is run through the base-case engine, then must clear <strong>all five</strong> rules below. The list is capped at 20 — so a strict week can show fewer.</p>` and replace the trailing sentence:

```html
<p class="rules-intro">Every NIFTY 500 company is run through the base-case engine, then must clear <strong>all five</strong> rules below. The list is capped at 20 — a strict week can show fewer qualifying. When fewer than 20 clear all five rules, the list is topped up with the best-performing stocks flagged in earlier weeks that are still held while they're ahead — shown separately below as <strong>Still held</strong>, and no longer trading below fair value.</p>
```

- [ ] **Step 2: Update `renderScreenSummary` in `app.js`**

Replace the `el.innerHTML = ...` line (currently ends `${s.shown < s.qualified ? ...}.${dropText}`):

```js
    const retained = s.retained || 0;
    const topUp = retained > 0
      ? ` Topped up to ${s.shown} with the ${retained} best-performing ${retained === 1 ? 'stock' : 'stocks'} flagged earlier — still held while ahead, though no longer below fair value.`
      : '';
    el.innerHTML = `From ${s.tickers} ${s.universe || 'NIFTY 500'} names, <strong>${s.qualified} qualified</strong> this week.${dropText}${topUp}`;
    el.hidden = false;
```

(The old `s.shown < s.qualified` "(showing the top N)" branch is removed — `shown` is now `qualified + retained`, never `< qualified`.)

- [ ] **Step 3: Split rows and render the "Still held" table in `app.js`**

Find where the main table body is populated from `data.rows` (search for `rank-table` / the `.map(row(...))` / `tbody`). Wherever the rows array is consumed, split it:

```js
    const allRows = data.rows || [];
    const mainRows = allRows.filter(r => !r.retained);
    const heldRows = allRows.filter(r => r.retained);
```

Use `mainRows` everywhere the code currently uses the full rows for the main `#rank-table` (row rendering, live-price count, etc. — the qualified list only).

After the main table render, add:

```js
  function fmtHeldDate(iso) {
    // '2026-08-24' -> '24 Aug'
    const d = new Date(iso + 'T00:00:00Z');
    return `${d.getUTCDate()} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]}`;
  }

  function renderStillHeld(heldRows, firstSeenMap, livePrices) {
    const card = $('stillheld-card');
    if (!card) return;
    if (!heldRows.length) { card.hidden = true; return; }
    const body = card.querySelector('tbody');
    body.innerHTML = heldRows.map(r => {
      const fsRec = firstSeenMap ? firstSeenMap[r.ticker] : null;
      const heldSince = fsRec ? fmtHeldDate(fsRec.firstSeen) : (r.retainedSince ? fmtHeldDate(r.retainedSince) : '—');
      const ret = r.returnSinceFlagged;
      const retClass = ret >= 0 ? 'num pos' : 'num neg';
      const retTxt = `${ret >= 0 ? '+' : ''}${(ret * 100).toFixed(1)}%`;
      const sym = r.currency === 'GBp' ? 'p' : r.currency === 'INR' ? '₹' : '$';
      const live = (livePrices && typeof livePrices[r.ticker] === 'number' && livePrices[r.ticker] > 0)
        ? livePrices[r.ticker] : r.snapshotPrice;
      const liveTxt = (typeof live === 'number') ? `${sym}${live.toFixed(2)}` : '—';
      const nm = r.name ? `${r.ticker} · ${r.name}` : r.ticker;
      return `<tr><td>${r.rank}</td><td>${nm}</td><td class="num">${heldSince}</td><td class="${retClass}">${retTxt}</td><td class="num">${liveTxt}</td></tr>`;
    }).join('');
    card.hidden = false;
  }
```

Call `renderStillHeld(heldRows, firstSeen, livePrices)` right after the main table is rendered, passing the same `firstSeen` object and `livePrices` map the main render already has in scope (search the file — `renderScreenSummary` and the main row renderer both already receive `firstSeen`; live prices come from the existing `fetchLivePrices`). If live prices aren't available at first paint, call it once with `null` and again after the live-price fetch resolves, mirroring how the main table already re-renders.

- [ ] **Step 4: Add the "Still held" card markup to `index.html`**

Immediately after the `</section>` that closes `.table-card` (the main rankings table), add:

```html
    <section class="stillheld-card" id="stillheld-card" hidden>
      <h2 class="stillheld-title">Still held</h2>
      <p class="stillheld-note">Added in an earlier week and no longer trading below fair value — kept in the ₹-equivalent €10,000 paper portfolio while they're ahead of the price we first flagged them at. Released (and counted as an exit) once they fall back below that price or after 12 weeks.</p>
      <div class="table-scroll">
        <table>
          <thead><tr><th>#</th><th>Stock</th><th class="num">Held since</th><th class="num">Return since flagged</th><th class="num">Live price</th></tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </section>
```

- [ ] **Step 5: Add `.stillheld-*` CSS to `style.css`**

Append (mirror `.table-card` / `table` styles already in the file — match their exact tokens):

```css
/* ── "Still held" retained-stocks section ── */
.stillheld-card {
  background: var(--kv-card, #fff);
  border: 1px solid var(--kv-border, #e7e2d8);
  border-radius: 12px;
  padding: 18px 20px;
  margin-top: 20px;
}
.stillheld-title {
  font-size: 1rem;
  font-weight: 700;
  color: var(--kv-text, #16202b);
  margin: 0 0 4px;
}
.stillheld-note {
  font-size: 0.82rem;
  color: var(--kv-muted, #4d5c6b);
  line-height: 1.5;
  margin: 0 0 12px;
}
.stillheld-card table { width: 100%; border-collapse: collapse; font-size: 0.86rem; min-width: 420px; }
.stillheld-card th, .stillheld-card td { padding: 8px 10px; text-align: left; border-bottom: 1px solid var(--kv-border, #e7e2d8); }
.stillheld-card th.num, .stillheld-card td.num { text-align: right; }
.stillheld-card td.pos { color: var(--kv-pass, #15803d); font-weight: 600; }
.stillheld-card td.neg { color: var(--kv-fail, #dc2626); font-weight: 600; }
```

> If `style.css` uses unprefixed tokens (`--text`, `--card`) rather than `--kv-*`, match that — grep the file first. The main table's own rules are the reference.

- [ ] **Step 6: Commit**

```bash
git add www/nifty-undervalued/app.js www/nifty-undervalued/index.html www/nifty-undervalued/style.css
git commit -m "feat(nifty page): render the 'Still held' retained-stocks section

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BTUAdmeoXMj7k8RLvQ3Svh"
```

---

## Task 5: Newsletter — exclude retained rows from Top 3 (stock-evaluator)

**Repo:** `C:\Projects\StockAnalysis` (stock-evaluator). `cd` there.

**Files:**
- Modify: `scripts/newsletter-subject-lines.js` — `groupTopN`
- Test: `tests/newsletter-subject-lines.test.js` (**create**)

**Interfaces:**
- Consumes: `rankings.json` rows (some may have `retained: true`).
- Produces: `groupTopN` skips `retained` rows.

- [ ] **Step 1: Write the failing test**

Create `C:\Projects\StockAnalysis\tests\newsletter-subject-lines.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { groupTopN } = require('../scripts/newsletter-subject-lines.js');

test('groupTopN excludes retained rows even when their margin sorts highest', () => {
  const rankingsByKey = {
    sp500: {
      rows: [
        { ticker: 'RETAINED', marginOfSafety: 0.95, retained: true },  // capped-margin retained — would sort first
        { ticker: 'REAL1', marginOfSafety: 0.60 },
        { ticker: 'REAL2', marginOfSafety: 0.40 },
        { ticker: 'REAL3', marginOfSafety: 0.20 },
      ],
    },
  };
  const top = groupTopN(['sp500'], rankingsByKey, 3);
  assert.deepStrictEqual(top.map(r => r.ticker), ['REAL1', 'REAL2', 'REAL3']);
});

test('groupTopN is unchanged when no rows are retained', () => {
  const rankingsByKey = {
    asx: { rows: [
      { ticker: 'A', marginOfSafety: 0.5 },
      { ticker: 'B', marginOfSafety: 0.3 },
    ] },
  };
  assert.deepStrictEqual(groupTopN(['asx'], rankingsByKey, 5).map(r => r.ticker), ['A', 'B']);
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `node --test tests/newsletter-subject-lines.test.js`
Expected: FAIL — first test returns `['RETAINED', 'REAL1', 'REAL2']`.

- [ ] **Step 3: Add the filter**

In `scripts/newsletter-subject-lines.js`, `groupTopN`:

```js
function groupTopN(screenKeys, rankingsByKey, n) {
  const pooled = [];
  screenKeys.forEach((key) => {
    rankingsByKey[key].rows
      .filter((row) => !row.retained)   // "Still held" rows are not undervalued — never a Top-N pick
      .forEach((row) => pooled.push({ ...row, screenKey: key }));
  });
  pooled.sort((a, b) => b.marginOfSafety - a.marginOfSafety);
  return pooled.slice(0, n);
}
```

- [ ] **Step 4: Run — verify it passes**

Run: `node --test tests/newsletter-subject-lines.test.js`
Expected: PASS (2/2).

- [ ] **Step 5: Full suite**

Run: `npm test`
Expected: all pass (437+ existing + 2 new).

- [ ] **Step 6: Commit** (in stock-evaluator)

```bash
git add scripts/newsletter-subject-lines.js tests/newsletter-subject-lines.test.js
git commit -m "newsletter: exclude retained 'Still held' rows from Top 3 per group

A stock retained because it was over the 80% margin cap still has a high
marginOfSafety, so an unfiltered margin-sort would float it into a 'most
undervalued' newsletter slot. Filter !row.retained before sorting.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BTUAdmeoXMj7k8RLvQ3Svh"
```

---

## Task 6: `sector-margins.json` publish fix (DCFAnalysis)

**Files:**
- Modify: `.github/workflows/publish-screen.yml`

**Interfaces:** none — CI config.

- [ ] **Step 1: Read the current publish step**

Run: `cat .github/workflows/publish-screen.yml`
Find the step that copies the per-market snapshot files into the `stock-evaluator` checkout (look for `rankings.json`, `first-seen.json`, `portfolio-value.json`, `portfolio-history.json`, `sold.json`) and the subsequent `git status --porcelain` assertion that fails on unexpected paths.

- [ ] **Step 2: Add `sector-margins.json` to the copy list**

`www/sector-margins.json` lives at the repo root of `www/`, not under a per-market dir. Add a copy line alongside the 5 per-market files, e.g. (adjust to match the file's actual shell style):

```yaml
      cp "dcf/www/sector-margins.json" "kv/www/sector-margins.json"
```

- [ ] **Step 3: Allow it in the porcelain assertion**

Wherever the workflow does something like `git status --porcelain | grep -v '^?? ' | grep -vE 'www/dcf/<market>-undervalued/'` and fails on any remaining line, add `www/sector-margins.json` to the allowed set:

```yaml
        # the sector-margin lookup is a byproduct of every screen run and is
        # published alongside the per-market snapshots
        ALLOWED='www/dcf/'"$MARKET"'-undervalued/|www/sector-margins.json'
```

(Match the exact variable / grep the workflow already uses — do not rewrite the assertion, just widen its allow-list.)

- [ ] **Step 4: Sanity-check the YAML**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/publish-screen.yml')); print('ok')"`
Expected: `ok`

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/publish-screen.yml
git commit -m "ci(publish-screen): carry www/sector-margins.json through to master

The sector-margin tally is regenerated by every screen run but was never in
the publish allow-list, so the Sector-Average Cyclical Margin Fallback ran on
the 2026-08-25 seed. See the design doc §10.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01BTUAdmeoXMj7k8RLvQ3Svh"
```

- [ ] **Step 6: Verify on the next real publish** (not now): after the next NIFTY (or any) screen publish from the admin console, `git log -1 --stat origin/main` in stock-evaluator should show `www/sector-margins.json` changed, and the workflow's assertion step must be green.

---

## Task 7: NIFTY preview (verification — no commit)

**Goal:** show the user what the NIFTY page looks like with a real "Still held" section, using this weekend's cached data against last week's committed rankings as the "prior week".

- [ ] **Step 1: Find a genuinely-older committed `rankings.json`**

```bash
cd C:/Projects/DCFAnalysis
git log --oneline -- www/nifty-undervalued/rankings.json | head -8
```
Pick a commit ~1–2 weeks before HEAD's NIFTY snapshot. Extract it:
```bash
git show <OLDER_SHA>:www/nifty-undervalued/rankings.json > /tmp/nifty-prior.json
```

- [ ] **Step 2: Rerank this weekend's cached NIFTY data with that prior**

```bash
node scripts/rank-nifty.js --rerank --prior-rankings=/tmp/nifty-prior.json
```
Expected console: the funnel, then `Still held (N): TICKER +X%, …` if any qualified-short + eligible winners exist. If NIFTY had ≥ 20 qualifiers this weekend, temporarily lower `topN` in a scratch copy of the config, or pick an older cache — note that in the report.

- [ ] **Step 3: Render the page locally**

```bash
npm run dev   # http-server on :8000
```
Open `http://localhost:8000/nifty-undervalued/` — the main table + the new "Still held" section + the updated "How a stock makes this list" summary line.

- [ ] **Step 4: Screenshot the "Still held" section and the summary line.** Save to `/tmp` or the scratchpad. These go to the user.

- [ ] **Step 5: Discard the preview changes**

```bash
git checkout -- www/nifty-undervalued/rankings.json www/nifty-undervalued/first-seen.json
git status   # must be clean apart from the (committed) Task 1–6 work
```

- [ ] **Step 6: Report to the user** with the screenshots and: how many qualified, how many retained, which tickers, their returns. Wait for approval before anything deploys.

---

## Rollout (follow-up, NOT this plan)

After 1–2 weekends of NIFTY behaving: add `retention: { maxWeeks: 12 }` to the other 5 `rank-*.js` configs and port the Task 4 page changes (`app.js` split + `renderStillHeld` + `index.html` card + `style.css`) to the other 5 `www/<market>-undervalued/` dirs. One commit. The `www/<market>/` files are the source of truth that `xcopy` publishes — see `Kashvector.md`'s "DCF Ranking Sub-Screens" note. Optionally: admin-console funnel shows the `retained` count (`www/admin/admin.js` + `worker-admin/admin.js`, cosmetic).

---

## Self-Review

**Spec coverage:**
- §2 retention rule → Task 1 (`selectRetained`) + Task 2 (wiring, `need`/`priorRows`/`evaluatedPrices` assembly). ✓
- §2 `returnSinceFlagged` definition → Task 1 impl + rounding test. ✓
- §3 `rankings.json` schema (retained rows, `summary.retained`/`shown`) → Task 2 Steps 3–4 + integration test. ✓
- §4 order of operations, no `portfolio.js` change → Task 2 (retention before write; `mergeFirstSeen` fed the combined rows; `updatePortfolio` unchanged). ✓
- §5 pure `retention.js` (no fs, takes `asAt`) → Task 1. ✓
- §6 newsletter filter (correctness, not tidiness) → Task 5 + test with a high-margin retained row. ✓
- §7a rules intro → Task 4 Step 1. §7b `renderScreenSummary` → Step 2. §7c "Still held" table → Steps 3–5. §7d no portfolio/index change → nothing to do. ✓
- §8 consumer checklist → Tasks 2 (run-screen), 4 (nifty page), 5 (newsletter); ticker-page generator explicitly untouched; admin console deferred to Rollout. ✓
- §9 pilot (NIFTY config only, `--prior-rankings`, preview, discard) → Task 3 + Task 7. ✓
- §10 `sector-margins.json` publish → Task 6. ✓
- §11 edge cases → covered by Task 1 tests (down-since-flagged, 12-week, missing first-seen, missing price, blacklist, re-qualified, `need<=0` via the `ranked.length < topN` guard in Task 2). ✓
- §12 test plan → Task 1 (unit), Task 2 (integration: 20 rows / retained count / carry-forward), Task 5 (newsletter). Portfolio "sells only released" is covered transitively — Task 2's integration test asserts released tickers are absent from `rows`, and `computeRebalance` already has its own `portfolio.test.js` coverage for "not in newRows → sold". If you want it explicit, add an assertion to the Task 2 test that runs a *full* mock rebalance — optional.

**Placeholder scan:** No TBD/TODO. Task 6 Steps 2–3 say "adjust to match the file's actual shell style / grep the workflow" — that's unavoidable without the file contents in hand; Step 1 has the reader read it first, and the intent (add one file to the copy list + widen one allow-list) is unambiguous. Task 4 Step 3 says "search the file" for the live-price re-render seam — acceptable, the file is ~200 lines and the pattern (main table already re-renders on live-price resolve) is stated.

**Type consistency:** `selectRetained` signature identical in Task 1 Interfaces, Task 1 impl, Task 2 Step 3 call site. `retained` row fields (`retained`, `retainedSince`, `returnSinceFlagged`) identical across Task 2 (write), Task 4 (read), Task 5 (filter), spec §3. `summary.retained` / `summary.shown` consistent Task 2 ↔ Task 3 ↔ Task 4. `readPublishedRankings(config, opts)` defined Task 2 Step 1, used Task 2 Step 3.
