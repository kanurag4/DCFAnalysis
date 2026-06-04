# Most Undervalued S&P 500 Screen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a "Most Undervalued S&P 500" screen at `/dcf/sp500-undervalued/`, mirroring the live ASX 300 screen, by extracting a shared batch orchestrator and adding a US ticker list, a US risk-free fetch, and a USD output page.

**Architecture:** Reuse the pure calc/eval/rank modules unchanged. Extract the ASX batch's fetch/throttle/rank/funnel/write logic into `scripts/lib/run-screen.js`; `rank-asx.js` and a new `rank-sp500.js` become thin per-market config wrappers. Tickers come from stockanalysis.com, normalized dot→dash. The page is a USD copy of the ASX page.

**Tech Stack:** Node 18+ (built-in test runner, global `fetch`), vanilla JS front-end, Cloudflare Worker Yahoo proxy.

**Spec:** `docs/superpowers/specs/2026-06-04-sp500-undervalued-screen-design.md`

**HARD GATE:** No xcopy to StockAnalysis and no `git push` to the deploy repo until the testing gate (Task 8) passes and the user explicitly approves. Tasks 1–8 are local-only.

---

## File Structure

**New files:**
- `scripts/lib/sp500-list.js` — pure `normalizeUsTickers(raw)`; dot→dash, dedupe, uppercase.
- `scripts/build-sp500.js` — CLI: read a raw ticker file → write `scripts/sp500.json`.
- `scripts/sp500.json` — committed 502-ticker list (dash-normalized).
- `scripts/lib/rf.js` — pure-ish RF fetchers: `fetchRfRate`, `fetchAusRf`, `fetchUsRf`.
- `scripts/lib/run-screen.js` — shared `runScreen(config)` orchestrator.
- `scripts/rank-sp500.js` — thin US wrapper.
- `tests/sp500-list.test.js` — unit tests for `normalizeUsTickers`.
- `tests/rf.test.js` — unit tests for `fetchRfRate` with an injected fetcher.
- `www/sp500-undervalued/{index.html,app.js,style.css}` — USD page (copy of ASX page).
- `www/sp500-undervalued/{rankings.json,first-seen.json}` — generated batch output.

**Modified files:**
- `scripts/rank-asx.js` — refactor to a thin wrapper over `runScreen`.
- `www/asx-undervalued/index.html` — add reciprocal cross-link to the S&P 500 screen.

**Unchanged (reused):** `scripts/lib/{evaluate,rank,firstSeen,csv}.js`, `scripts/fetch-yahoo.js`, `scripts/lib/market.js`, `www/calc/*`, `www/utils.js`, `www/data.js`.

---

## Task 1: S&P 500 ticker list (normalize + build + generate)

**Files:**
- Create: `scripts/lib/sp500-list.js`
- Create: `tests/sp500-list.test.js`
- Create: `scripts/build-sp500.js`
- Create: `scripts/sp500.json` (generated)

- [ ] **Step 1: Write the failing test**

Create `tests/sp500-list.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeUsTickers } = require('../scripts/lib/sp500-list.js');

test('converts class-share dots to dashes', () => {
  assert.deepStrictEqual(normalizeUsTickers('BRK.B, BF.B'), ['BRK-B', 'BF-B']);
});

test('uppercases, trims, and splits on commas/whitespace/newlines', () => {
  assert.deepStrictEqual(normalizeUsTickers(' aapl,  msft\n nvda '), ['AAPL', 'MSFT', 'NVDA']);
});

test('de-duplicates while preserving first-seen order', () => {
  assert.deepStrictEqual(normalizeUsTickers('AAPL, aapl, MSFT, AAPL'), ['AAPL', 'MSFT']);
});

test('keeps legitimate dual classes as distinct tickers', () => {
  assert.deepStrictEqual(normalizeUsTickers('GOOGL,GOOG,FOX,FOXA'), ['GOOGL', 'GOOG', 'FOX', 'FOXA']);
});

test('drops empty tokens', () => {
  assert.deepStrictEqual(normalizeUsTickers('AAPL,,  ,MSFT,'), ['AAPL', 'MSFT']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/sp500-list.test.js`
Expected: FAIL — `Cannot find module '../scripts/lib/sp500-list.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/sp500-list.js`:

```js
// scripts/lib/sp500-list.js
// Pure: normalize a raw S&P 500 ticker list (comma/whitespace/newline separated)
// into de-duplicated Yahoo-form US tickers. stockanalysis.com writes class shares
// with a dot (BRK.B); Yahoo and the Worker use a dash (BRK-B). The dash form is
// ALSO required so marketParamsFor's `!ticker.includes('.')` US-detection works.
function normalizeUsTickers(raw) {
  const tokens = String(raw).split(/[\s,]+/);
  const seen = new Set();
  const out = [];
  for (const tok of tokens) {
    const t = tok.trim().toUpperCase().replace(/\./g, '-');
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

module.exports = { normalizeUsTickers };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/sp500-list.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the build CLI**

Create `scripts/build-sp500.js`:

```js
// scripts/build-sp500.js
// Usage: node scripts/build-sp500.js <raw-ticker-list.txt>
// Reads a comma/whitespace-separated S&P 500 ticker list (e.g. pasted from
// stockanalysis.com/list/sp-500-stocks/), normalizes it, writes scripts/sp500.json.
// Refresh manually when the index reconstitutes.
const fs = require('node:fs');
const path = require('node:path');
const { normalizeUsTickers } = require('./lib/sp500-list.js');

const inPath = process.argv[2];
if (!inPath) { console.error('Usage: node scripts/build-sp500.js <raw-ticker-list.txt>'); process.exit(1); }
const tickers = normalizeUsTickers(fs.readFileSync(inPath, 'utf8'));
const outPath = path.join(__dirname, 'sp500.json');
fs.writeFileSync(outPath, JSON.stringify(tickers, null, 2) + '\n');
console.log(`Wrote ${tickers.length} tickers to ${outPath}`);
```

- [ ] **Step 6: Create the raw list scratch file**

Create `scripts/_sp500-raw.txt` (gitignored via `scripts/_*`) with the full list:

```
NVDA, AAPL, GOOGL, GOOG, MSFT, AMZN, AVGO, TSLA, META, MU, BRK.B, LLY, WMT, AMD, JPM, ORCL, XOM, V, INTC, JNJ, CSCO, LRCX, CAT, COST, MA, AMAT, ABBV, CVX, BAC, NFLX, UNH, PLTR, KO, MS, GE, PG, GS, HD, IBM, MRK, TXN, KLAC, PM, DELL, SNDK, QCOM, GEV, WFC, LIN, RTX, PANW, C, ANET, ADI, STX, AXP, WDC, TMUS, PEP, VZ, MCD, APP, CRWD, AMGN, APH, NEE, TMO, TJX, GLW, DIS, BA, T, ETN, BLK, GILD, DE, CRM, UNP, ABT, SCHW, UBER, COP, PFE, ISRG, HON, WELL, BX, PLD, BKNG, VRT, DHR, SPGI, NOW, CB, LMT, MO, CVS, LOW, NEM, SYK, PGR, CDNS, BMY, COF, SBUX, ACN, VRTX, PWR, FTNT, PH, EQIX, ADBE, TT, SO, FCX, MDT, HWM, MAR, BNY, CEG, SNPS, DUK, CMI, UPS, CME, ADP, GD, JCI, DDOG, MCK, CIEN, PNC, WMB, WM, MNST, CSX, INTU, SLB, ELV, AMT, CMCSA, MPWR, USB, COHR, KKR, NXPI, HCA, ABNB, MMM, EMR, MDLZ, ICE, MCO, MPC, VLO, SPG, FDX, RCL, MRSH, HLT, EOG, NOC, ROST, HOOD, PSX, GM, HPE, LITE, SHW, ORLY, ITW, ECL, APO, CI, BSX, CRH, CVNA, CTAS, KMI, AEP, NSC, CL, MSI, TDG, WBD, AON, DASH, URI, DLR, FIX, NKE, TER, BKR, TEL, REGN, APD, RSG, F, TRV, GWW, PCAR, KEYS, OXY, FANG, TFC, NUE, SRE, AFL, D, TGT, LHX, TRGP, CARR, O, OKE, ALL, FAST, DVN, PSA, ON, MCHP, AME, MET, CTVA, AJG, VST, DAL, ROK, COR, EA, AZO, ETR, EW, NDAQ, ODFL, ADSK, EBAY, XEL, EXC, GRMN, CAH, FITB, MSCI, WAB, IDXX, STT, COIN, KDP, XYZ, DHI, YUM, ARES, ADM, BDX, TTWO, JBL, STLD, AMP, HUM, IBKR, AXON, A, PEG, VTR, CCI, AIG, LYV, ED, IRM, TKO, PYPL, CCL, KR, EME, WAT, HSY, PCG, VMC, CBRE, CMG, WDAY, SYY, WEC, NTAP, PAYX, SATS, MLM, PRU, HIG, HAL, FSLR, UAL, EQT, LVS, ROP, ZTS, Q, KVUE, HBAN, EXR, KMB, MTB, NTRS, ACGL, IQV, CBOE, VICI, EL, DTE, CNC, AEE, FISV, BIIB, DOV, TDY, CASY, RJF, SMCI, NRG, GEHC, TPR, CPRT, ATO, DXCM, TPL, IR, EIX, FICO, CNP, VRSN, EXPE, RMD, FOXA, KHC, OTIS, JBHT, PPL, FE, AVB, XYL, CFG, ES, HUBB, DOW, FOX, BG, WRB, EQR, CTSH, PPG, CINF, WSM, AWK, HPQ, WTW, MTD, RF, VRSK, AKAM, STZ, DG, SYF, CPAY, FFIV, DRI, KEY, WST, PHM, TROW, SW, ROL, LEN, CHD, PFG, NI, EXE, LYB, CMS, DLTR, L, DGX, RL, CHRW, LH, FIS, OMC, SBAC, VLTO, EXPD, STE, EFX, ULTA, TSN, LUV, PKG, ALB, INCY, SNA, MRNA, DD, IFF, BRO, EVRG, GPN, FTV, ESS, LNT, VTRS, LII, CF, CHTR, IP, BR, WY, CDW, AMCR, INVH, GIS, GNRC, HST, NVR, ZBH, APTV, PTC, NDSN, KIM, GEN, IEX, TXT, MAA, BEN, LDOS, TSCO, BBY, DECK, NWS, LULU, J, REG, NWSA, BALL, MAS, CSGP, SOLV, APA, GPC, UDR, DOC, TRMB, TYL, HRL, EG, DVA, MKC, MGM, AIZ, SWK, SWKS, PNW, IVZ, AVY, HAS, ZBRA, COO, GL, PSKY, ALGN, PNR, BF.B, CPT, HII, RVTY, ALLE, GDDY, IT, BXP, ERIE, SJM, WYNN, CLX, AES, FRT, DPZ, PODD, TTD, BAX, JKHY, FDS, ARE, UHS, CRL, HSIC, NCLH, BLDR, TECH, AOS, MOS, TAP, POOL, CPB, CAG, EPAM
```

- [ ] **Step 7: Generate `sp500.json`**

Run: `node scripts/build-sp500.js scripts/_sp500-raw.txt`
Expected: `Wrote 502 tickers to .../scripts/sp500.json`.

Verify normalization landed: `node -e "const t=require('./scripts/sp500.json'); console.log(t.length, t.includes('BRK-B'), t.includes('BF-B'), t.some(x=>x.includes('.')))"`
Expected: `502 true true false` (no dotted tickers remain).

- [ ] **Step 8: Commit**

```bash
git add scripts/lib/sp500-list.js scripts/build-sp500.js scripts/sp500.json tests/sp500-list.test.js
git commit -m "feat: S&P 500 ticker list builder + normalized sp500.json (dot->dash)"
```

---

## Task 2: Shared risk-free fetcher (`scripts/lib/rf.js`)

**Files:**
- Create: `scripts/lib/rf.js`
- Create: `tests/rf.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/rf.test.js`. The fetcher takes an injectable `fetchSymbolImpl` returning the mapped `{ price }` object (like `fetchSymbol`), so it is testable without the network:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { fetchRfRate } = require('../scripts/lib/rf.js');

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `expected ~${b}, got ${a}`);

test('converts ^TNX percent price to a decimal rate (4.25 -> 0.0425)', async () => {
  const r = await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchSymbolImpl: async () => ({ price: 4.25 }) });
  near(r, 0.0425);
});

test('falls back when the fetch returns null', async () => {
  const r = await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchSymbolImpl: async () => null });
  near(r, 0.045);
});

test('falls back when the rate is out of the plausible band', async () => {
  const r = await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchSymbolImpl: async () => ({ price: 0 }) });
  near(r, 0.045);
  const r2 = await fetchRfRate('^GSBG10.AX', 0.048, { proxyUrl: 'x', fetchSymbolImpl: async () => ({ price: 99 }) });
  near(r2, 0.048);
});

test('falls back when the fetch throws', async () => {
  const r = await fetchRfRate('^TNX', 0.045, { proxyUrl: 'x', fetchSymbolImpl: async () => { throw new Error('boom'); } });
  near(r, 0.045);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/rf.test.js`
Expected: FAIL — `Cannot find module '../scripts/lib/rf.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/lib/rf.js`. Mirrors the existing inline `fetchAusRf` and the live tool's `^TNX` handling (`app.js:1146` — `^TNX` price is the yield in percent, e.g. 4.25 = 4.25%):

```js
// scripts/lib/rf.js
// IO: fetch a market 10-yr govt-bond / treasury yield via the Worker proxy and
// return it as a DECIMAL rate. The quoted price is the yield in percent
// (^TNX 4.25 -> 0.0425; ^GSBG10.AX 4.80 -> 0.048), so we divide by 100.
// Clamped to a plausible band; otherwise the documented per-market fallback is
// returned (matches the live tool's silent fallbacks). fetchSymbolImpl is
// injectable for testing; defaults to the real fetchSymbol.
const { fetchSymbol } = require('../fetch-yahoo.js');

async function fetchRfRate(symbol, fallback, { proxyUrl, fetchSymbolImpl = fetchSymbol } = {}) {
  let d = null;
  try { d = await fetchSymbolImpl(symbol, { proxyUrl }); } catch (_) { d = null; }
  const pct = (d && d.price != null) ? d.price / 100 : null;
  return (pct && pct > 0 && pct < 0.15) ? pct : fallback;
}

const fetchUsRf  = (proxyUrl) => fetchRfRate('^TNX',        0.045, { proxyUrl });
const fetchAusRf = (proxyUrl) => fetchRfRate('^GSBG10.AX',  0.048, { proxyUrl });

module.exports = { fetchRfRate, fetchUsRf, fetchAusRf };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/rf.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/rf.js tests/rf.test.js
git commit -m "feat: shared RF fetcher (fetchUsRf via ^TNX, fetchAusRf) with fallback"
```

---

## Task 3: Extract shared orchestrator (`scripts/lib/run-screen.js`)

This moves the gather/rank/write logic out of `rank-asx.js` verbatim, parameterized by a market config. No behaviour change yet — `rank-asx.js` is refactored to call it in Task 4, and the byte-identical check there proves equivalence.

**Files:**
- Create: `scripts/lib/run-screen.js`

- [ ] **Step 1: Write `run-screen.js`**

Create `scripts/lib/run-screen.js`:

```js
// scripts/lib/run-screen.js
// Shared batch orchestrator for the per-market "undervalued" screens.
// Fetch every ticker (throttled under the Worker's 20 req/60s cap, with retry +
// a cooldown sweep), evaluate the base case, rank by margin of safety, and write
// www/<outDir>/rankings.json + merge first-seen.json. Market differences are
// injected via `config`; the calc/eval/rank modules are market-agnostic.
//
//   runScreen(config)            fetch all tickers, evaluate, rank, write
//   runScreen(config, '--rerank') re-rank config.cacheFile (no fetch)
const fs = require('node:fs');
const path = require('node:path');
const { fetchSymbol } = require('../fetch-yahoo.js');
const { marketParamsFor } = require('./market.js');
const { evaluateStock } = require('./evaluate.js');
const { rankRows, rankFunnel } = require('./rank.js');
const { mergeFirstSeen } = require('./firstSeen.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const THROTTLE_MS = 3200; // ~18.75 req/min keeps us under the 20/60s Worker cap

// Read the proxy URL straight from www/config.js without a DOM.
function readProxyUrl() {
  const src = fs.readFileSync(path.join(__dirname, '../../www/config.js'), 'utf8');
  const m = src.match(/YAHOO_PROXY_URL\s*[:=]\s*['"]([^'"]+)['"]/);
  if (!m) throw new Error('Could not find YAHOO_PROXY_URL in www/config.js');
  return m[1];
}

async function gather(config) {
  const proxyUrl = readProxyUrl();
  const tickers = JSON.parse(fs.readFileSync(path.join(__dirname, '..', config.tickersFile), 'utf8'));
  const asAt = new Date().toISOString().slice(0, 10);

  const rf = await config.fetchRf(proxyUrl);
  const live = { [config.liveKey]: rf };
  console.log(`${config.rfLabel}: ${(rf * 100).toFixed(2)}%  | tickers: ${tickers.length}  | asAt: ${asAt}`);

  const evaluated = [];
  const failed = [];
  let done = 0;
  for (const ticker of tickers) {
    const data = await fetchSymbol(ticker, { proxyUrl, retries: 2, backoffMs: 4000 });
    if (data) evaluated.push(evaluateStock(data, marketParamsFor(ticker, live)));
    else failed.push(ticker);
    if (++done % 25 === 0) console.log(`  …${done}/${tickers.length}  (failed so far: ${failed.length})`);
    await sleep(THROTTLE_MS);
  }

  if (failed.length) {
    console.log(`\n${failed.length} still missing — cooling down 65s then retrying them…`);
    await sleep(65000);
    const stillFailed = [];
    for (const ticker of failed) {
      const data = await fetchSymbol(ticker, { proxyUrl, retries: 2, backoffMs: 4000 });
      if (data) evaluated.push(evaluateStock(data, marketParamsFor(ticker, live)));
      else stillFailed.push(ticker);
      await sleep(THROTTLE_MS);
    }
    console.log(`Sweep recovered ${failed.length - stillFailed.length}; ${stillFailed.length} unrecoverable: ${stillFailed.join(', ') || '—'}`);
  }

  const out = { asAt, tickerCount: tickers.length, evaluated };
  fs.writeFileSync(path.join(__dirname, '..', config.cacheFile), JSON.stringify(out) + '\n');
  return out;
}

function rankAndWrite(config, { asAt, tickerCount, evaluated }) {
  const { topN, maxMargin } = config;
  const ranked = rankRows(evaluated, { topN, maxMargin });
  const f = rankFunnel(evaluated, { maxMargin });
  const fetchFailed = tickerCount - evaluated.length;
  const capPct = Math.round(maxMargin * 100);
  console.log(
    `\nFunnel: ${tickerCount} tickers → ${fetchFailed} fetch-failed → ${f.evaluated} evaluated` +
    `\n        − ${f.unvaluable} unvaluable (no/neg FCF, neg equity, bank w/o dividend)` +
    `\n        − ${f.overvalued} overvalued (price ≥ intrinsic)` +
    `\n        − ${f.capped} margin > ${capPct}% (likely one-off-inflated FCF)` +
    `\n        − ${f.proxyDropped} rough proxy-FCF (no reported FCF or CapEx)` +
    `\n        = ${f.kept} qualified → showing top ${ranked.length} (cap ${topN})`
  );

  const outDir = path.join(__dirname, '../../www', config.outDir);
  fs.mkdirSync(outDir, { recursive: true });

  const rounded = ranked.map(r => ({
    rank: r.rank, ticker: r.ticker, name: r.name, sector: r.sector ?? null,
    method: r.method,
    intrinsic: +r.intrinsic.toFixed(2),
    snapshotPrice: +Number(r.snapshotPrice).toFixed(2),
    marginOfSafety: +r.marginOfSafety.toFixed(4),
    wacc: +r.wacc.toFixed(4),
    terminalValuePct: r.terminalValuePct != null ? +r.terminalValuePct.toFixed(1) : null,
    trailingPE: r.trailingPE != null ? +r.trailingPE.toFixed(1) : null,
    marketCap: r.marketCap != null ? Math.round(r.marketCap) : null,
    operatingMargin: r.operatingMargin != null ? +r.operatingMargin.toFixed(4) : null,
    analystTarget: r.analystTarget != null ? +r.analystTarget.toFixed(2) : null,
    currency: r.currency ?? config.currency,
  }));

  const summary = {
    tickers: tickerCount,
    evaluated: f.evaluated,
    qualified: f.kept,
    shown: ranked.length,
    marginCapPct: capPct,
    dropped: {
      fetchFailed,
      unvaluable: f.unvaluable,
      overvalued: f.overvalued,
      marginOverCap: f.capped,
      proxyFcf: f.proxyDropped,
    },
  };

  fs.writeFileSync(path.join(outDir, 'rankings.json'),
    JSON.stringify({ asAt, universe: config.universe, summary, rows: rounded }, null, 2) + '\n');

  const fsPath = path.join(outDir, 'first-seen.json');
  const ledger = fs.existsSync(fsPath) ? JSON.parse(fs.readFileSync(fsPath, 'utf8')) : {};
  fs.writeFileSync(fsPath, JSON.stringify(mergeFirstSeen(ledger, rounded, asAt), null, 2) + '\n');

  console.log(`\nTop ${rounded.length}:`);
  for (const r of rounded) console.log(`  ${r.rank}. ${r.ticker} ${(r.marginOfSafety * 100).toFixed(0)}% (${r.method})`);
  console.log(`\nWrote ${outDir}\\rankings.json and first-seen.json`);
}

async function runScreen(config, argv = process.argv) {
  const cachePath = path.join(__dirname, '..', config.cacheFile);
  let data;
  if (argv.includes('--rerank')) {
    if (!fs.existsSync(cachePath)) throw new Error(`No cached data at ${config.cacheFile} — run without --rerank first.`);
    data = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    console.log(`Re-ranking ${data.evaluated.length} cached rows from ${data.asAt} (no fetch).`);
  } else {
    data = await gather(config);
  }
  rankAndWrite(config, data);
}

module.exports = { runScreen };
```

Note: `readProxyUrl` and `outDir` use `../../www` because this file sits one level deeper (`scripts/lib/`) than the old `rank-asx.js` (`scripts/`).

- [ ] **Step 2: Sanity-check it loads**

Run: `node -e "require('./scripts/lib/run-screen.js'); console.log('ok')"`
Expected: `ok` (no syntax/require errors).

- [ ] **Step 3: Commit**

```bash
git add scripts/lib/run-screen.js
git commit -m "refactor: extract shared runScreen orchestrator for market screens"
```

---

## Task 4: Refactor `rank-asx.js` to a thin wrapper + verify byte-identical

**Files:**
- Modify: `scripts/rank-asx.js` (replace entirely)

- [ ] **Step 1: Capture the current ASX output baseline**

Confirm the cached evaluated set and committed rankings exist and are clean:

Run: `git status --porcelain www/asx-undervalued/rankings.json && ls scripts/_evaluated.json`
Expected: no output from `git status` (file is clean / committed) and the cache file path printed.

- [ ] **Step 2: Replace `rank-asx.js` with the thin wrapper**

Overwrite `scripts/rank-asx.js`:

```js
// scripts/rank-asx.js
// Monthly batch: evaluate the ASX 300 base case, rank by margin of safety,
// write www/asx-undervalued/rankings.json + merge first-seen.json.
//
//   node scripts/rank-asx.js            fetch all tickers, evaluate, rank, write
//   node scripts/rank-asx.js --rerank   re-rank the LAST run's cached data (no fetch)
const { runScreen } = require('./lib/run-screen.js');
const { fetchAusRf } = require('./lib/rf.js');

const config = {
  universe: 'ASX 300',
  tickersFile: 'asx300.json',
  outDir: 'asx-undervalued',
  currency: 'AUD',
  liveKey: 'ausRf',
  fetchRf: fetchAusRf,
  rfLabel: 'AUS RF',
  topN: 20,
  maxMargin: 0.8,          // drop > 80% margins — the most assumption-fragile valuations
  cacheFile: '_evaluated.json', // unchanged so existing cache + --rerank keep working
};

runScreen(config).catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Verify the refactor is behaviour-preserving (byte-identical)**

Run: `node scripts/rank-asx.js --rerank`
Then: `git diff --exit-code www/asx-undervalued/rankings.json`
Expected: the rerank prints the same funnel + top-20, and `git diff --exit-code` produces **no output and exits 0** (the regenerated rankings.json matches the committed one byte-for-byte).

If there IS a diff: stop and reconcile — the extraction changed behaviour. Likely causes: a changed path, a dropped field, or number formatting. Fix `run-screen.js` until the diff is empty. (Also check `first-seen.json` shows no diff: `git diff --exit-code www/asx-undervalued/first-seen.json`.)

- [ ] **Step 4: Run the full unit suite**

Run: `npm test`
Expected: all existing tests pass (22 calc/ddm + the new sp500-list + rf tests). No regressions.

- [ ] **Step 5: Commit**

```bash
git add scripts/rank-asx.js
git commit -m "refactor: rank-asx.js is now a thin runScreen wrapper (output unchanged)"
```

---

## Task 5: Add the S&P 500 wrapper (`scripts/rank-sp500.js`)

**Files:**
- Create: `scripts/rank-sp500.js`

- [ ] **Step 1: Write the wrapper**

Create `scripts/rank-sp500.js`:

```js
// scripts/rank-sp500.js
// Monthly batch: evaluate the S&P 500 base case, rank by margin of safety,
// write www/sp500-undervalued/rankings.json + merge first-seen.json.
//
//   node scripts/rank-sp500.js            fetch all tickers, evaluate, rank, write
//   node scripts/rank-sp500.js --rerank   re-rank the LAST run's cached data (no fetch)
const { runScreen } = require('./lib/run-screen.js');
const { fetchUsRf } = require('./lib/rf.js');

const config = {
  universe: 'S&P 500',
  tickersFile: 'sp500.json',
  outDir: 'sp500-undervalued',
  currency: 'USD',
  liveKey: 'usRf',
  fetchRf: fetchUsRf,
  rfLabel: 'US RF',
  topN: 20,
  maxMargin: 0.8,
  cacheFile: '_evaluated-sp500.json', // gitignored (scripts/_*)
};

runScreen(config).catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Smoke-check the config loads (no network)**

Run: `node -e "process.argv=['node','x']; const m=require('./scripts/lib/run-screen.js'); console.log(typeof m.runScreen)"`
Expected: `function`.

- [ ] **Step 3: Commit**

```bash
git add scripts/rank-sp500.js
git commit -m "feat: rank-sp500.js wrapper (US universe, ^TNX RF, USD output)"
```

---

## Task 6: Run the S&P 500 batch + review the funnel

This is the ~27-minute live fetch (502 × 3.2s + sweep). It produces the data files.

- [ ] **Step 1: Run the batch**

Run: `node scripts/rank-sp500.js`
Expected: prints `US RF: ~4.xx%`, periodic progress, a cooldown sweep if any failed, then the funnel and top-20. Writes `www/sp500-undervalued/rankings.json` and `first-seen.json`.

- [ ] **Step 2: Sanity-review the funnel**

Confirm: `fetchFailed` is ≈ 0 (≤ a handful) — a large number means the rate limit bit; if so, re-run (the cache + sweep recover most). Confirm the top-20 are plausible US names with positive margins ≤ 80%, methods DCF/DDM, and currency USD.

Run: `node -e "const r=require('./www/sp500-undervalued/rankings.json'); console.log('universe',r.universe,'shown',r.summary.shown,'fetchFailed',r.summary.dropped.fetchFailed); console.log(r.rows.slice(0,5).map(x=>x.ticker+' '+Math.round(x.marginOfSafety*100)+'% '+x.method+' '+x.currency))"`
Expected: `universe S&P 500`, a sensible `shown` (up to 20), low `fetchFailed`, USD rows.

- [ ] **Step 3: Commit the data**

```bash
git add www/sp500-undervalued/rankings.json www/sp500-undervalued/first-seen.json
git commit -m "data: S&P 500 undervalued snapshot (top 20, 80% cap)"
```

---

## Task 7: Build the S&P 500 page (`www/sp500-undervalued/`)

**Files:**
- Create: `www/sp500-undervalued/index.html`
- Create: `www/sp500-undervalued/app.js`
- Create: `www/sp500-undervalued/style.css`
- Modify: `www/asx-undervalued/index.html` (reciprocal cross-link)

- [ ] **Step 1: Copy the ASX page files**

Run (PowerShell):
```powershell
Copy-Item www/asx-undervalued/app.js   www/sp500-undervalued/app.js
Copy-Item www/asx-undervalued/style.css www/sp500-undervalued/style.css
Copy-Item www/asx-undervalued/index.html www/sp500-undervalued/index.html
```
`app.js` and `style.css` are reused **verbatim** — `app.js` loads its own `./rankings.json` + `./first-seen.json` and `row()` already defaults the currency symbol to `$` (correct for USD). Only `index.html` is edited.

- [ ] **Step 2: Retheme `www/sp500-undervalued/index.html` copy**

Apply these exact replacements (S&P 500 / USD), keeping everything else identical to the ASX page:

- `<title>` → `Most Undervalued S&P 500 Stocks — DCF Screen | KashVector`
- `<meta name="description" ...>` → `content="A monthly, automated DCF/DDM screen of the S&P 500 ranking stocks by margin of safety. Not financial advice — assumptions-driven. Free, no sign-up."`
- JSON-LD: `"name":"Most Undervalued S&P 500 Stocks"`, `"url":"https://kashvector.com/dcf/sp500-undervalued/"`, `"description":"Automated monthly DCF/DDM screen ranking S&P 500 stocks by margin of safety."`, `"priceCurrency":"USD"`
- `<h1>` text → `Most Undervalued S&P 500`
- Every visible `ASX 300` → `S&P 500`; in the rules/about copy, `every ASX 300 company` → `every S&P 500 company`, `From {n} ASX 300 names` stays in `app.js` (it reads `summary.tickers`; the literal label there is `ASX 300` — see Step 3).
- The DCF nav link keeps `class="kv-nav-active" aria-current="page"` (still a DCF sub-page).

Add a cross-link line at the top of `<main>`, immediately after the opening of the `editorial` section's `<p>` (or as the first child of `<main>`):

```html
<section class="editorial cross-link">
  <p>🇦🇺 Looking for Australian stocks? <a href="../asx-undervalued/">See the Most Undervalued ASX 300 screen →</a></p>
</section>
```

- [ ] **Step 3: Fix the one market literal in the page's summary copy**

The shared `app.js` `renderScreenSummary` hardcodes `ASX 300` in one string:
`From ${s.tickers} ASX 300 names, ...`. Since `app.js` is shared verbatim, make that label data-driven from the rankings file instead of forking the file. In **both** `www/asx-undervalued/app.js` and `www/sp500-undervalued/app.js`, change that line to read the universe from the loaded rankings:

Find in `renderScreenSummary(s)`:
```js
    el.innerHTML = `From ${s.tickers} ASX 300 names, <strong>${s.qualified} qualified</strong> this month` +
```
Replace with:
```js
    el.innerHTML = `From ${s.tickers} ${s.universe || 'ASX 300'} names, <strong>${s.qualified} qualified</strong> this month` +
```
And pass the universe through: in `init()`, after `renderScreenSummary(rankings.summary);`, change to:
```js
    renderScreenSummary({ ...rankings.summary, universe: rankings.universe });
```
Apply this identical edit to **both** copies so they stay in sync. (The ASX `rankings.json` already carries `universe: 'ASX 300'`, so its copy is unchanged in output — verify in Step 5.)

- [ ] **Step 4: Add the reciprocal cross-link to the ASX page**

In `www/asx-undervalued/index.html`, add immediately inside `<main>` (before the existing `editorial` section):

```html
<section class="editorial cross-link">
  <p>🇺🇸 Looking for US stocks? <a href="../sp500-undervalued/">See the Most Undervalued S&P 500 screen →</a></p>
</section>
```

- [ ] **Step 5: Verify the ASX page output is unchanged by the app.js edit**

Run: `npm run dev` (serves `www/` on :8000), open `http://localhost:8000/asx-undervalued/`.
Expected: the summary line still reads `From 300 ASX 300 names …` (now sourced from `rankings.universe`), table renders as before. The only visible addition is the US cross-link banner.

- [ ] **Step 6: Commit**

```bash
git add www/sp500-undervalued/index.html www/sp500-undervalued/app.js www/sp500-undervalued/style.css www/asx-undervalued/app.js www/asx-undervalued/index.html
git commit -m "feat: S&P 500 undervalued page + reciprocal cross-links (universe-driven summary)"
```

---

## Task 8: Local verification (TESTING GATE — stop for approval)

No deploy actions in this task. Verify everything locally, then hand back to the user.

- [ ] **Step 1: Full unit suite green**

Run: `npm test`
Expected: all pass (calc/ddm/wacc + sp500-list + rf).

- [ ] **Step 2: ASX regression still clean**

Run: `node scripts/rank-asx.js --rerank && git diff --exit-code www/asx-undervalued/rankings.json`
Expected: empty diff, exit 0.

- [ ] **Step 3: Page renders in the local server**

Run: `npm run dev`, then open `http://localhost:8000/sp500-undervalued/`.
Check:
- Table loads with the top-20 USD rows; Fair value bold green; `$` symbols.
- Live prices populate (best-effort) and "Margin (live)" shows.
- Cross-link banner to the ASX screen works; ASX page's banner to S&P 500 works.
- Toggle **dark/light** — both readable.
- Narrow the window to ~390px — header, nav, and table scroll behave (no overflow of the whole page).

- [ ] **Step 4: STOP — report results and await deploy approval**

Summarize for the user: funnel numbers, top-5 names, screenshots/notes from the local check, and confirm the ASX byte-identical check passed. **Do not proceed to Task 9 until the user explicitly approves deployment.**

---

## Task 9: Deploy + discoverability (GATED — only after explicit approval)

**Files:**
- Modify: `www/sitemap.xml` (in StockAnalysis)
- Modify: DCF tool page / hub cross-links as noted
- Modify: `www/privacy-site.html` (verify coverage)

- [ ] **Step 1: Deploy the tool tree**

```powershell
xcopy /E /Y /I "C:\Projects\DCFAnalysis\www" "C:\Projects\StockAnalysis\www\dcf"
```
This carries `www/sp500-undervalued/` (and the ASX `app.js` edit) across.

- [ ] **Step 2: Sitemap entry**

In `C:\Projects\StockAnalysis\www\sitemap.xml`, copy the existing `asx-undervalued` `<url>` block and change `<loc>` to `https://kashvector.com/dcf/sp500-undervalued/`.

- [ ] **Step 3: Cross-links from the DCF tool page**

On the DCF tool page (`www/dcf/index.html` in StockAnalysis, sourced from `C:\Projects\DCFAnalysis\www\index.html`) wherever the ASX screen is linked, add a sibling link to the S&P 500 screen. (Edit the source `C:\Projects\DCFAnalysis\www\index.html` first, then re-xcopy — never edit the deploy target by hand.)

- [ ] **Step 4: Privacy policy coverage**

Open `C:\Projects\StockAnalysis\www\privacy-site.html`. Confirm the DCF tool's network-requests entry covers the screens (the page fetches live prices via the Worker). If the ASX screen is listed explicitly, add the S&P 500 screen alongside it and bump "Last updated". If DCF is covered generically, no change.

- [ ] **Step 5: Commit + push StockAnalysis**

```bash
cd "C:/Projects/StockAnalysis"
git add www/dcf/ www/sitemap.xml www/privacy-site.html
git commit -m "Deploy: Most Undervalued S&P 500 screen + sitemap + cross-links"
git push
```
Cloudflare Pages auto-deploys in ~1 min. Verify live: `https://kashvector.com/dcf/sp500-undervalued/` returns 200 and renders.

- [ ] **Step 6: Push the source repo**

```bash
cd "C:/Projects/DCFAnalysis"
git push -u origin feature/sp500-undervalued
```
(Or merge to `master` per the finishing-a-development-branch flow.)

---

## Task 10: Refresh runbook skill (`/refresh-sp500-undervalued`)

**Files:**
- Create: `C:\Users\Anurag\.claude\skills\refresh-sp500-undervalued\SKILL.md` (mirror `refresh-asx-undervalued`)

- [ ] **Step 1: Mirror the ASX refresh skill**

Read the existing `refresh-asx-undervalued` skill and create the S&P 500 equivalent: run `node scripts/rank-sp500.js` → review funnel/top-20 → approve → deploy (Task 9 steps). Swap ASX→S&P 500, `rank-asx.js`→`rank-sp500.js`, `asx-undervalued`→`sp500-undervalued`, the quarterly list refresh step uses `build-sp500.js` from a fresh stockanalysis.com paste.

- [ ] **Step 2: Update CLAUDE.md**

Add an "S&P 500 undervalued screen — LIVE" section mirroring the ASX one (batch command, refresh skill, rate-limit note, page path), and flip the "TOMORROW: extend to S&P 500" section to done.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: S&P 500 undervalued screen live; refresh runbook"
```

---

## Self-Review Notes

- **Spec coverage:** ticker list+normalize (T1), US RF/^TNX (T2), shared orchestrator (T3), ASX byte-identical (T4), US wrapper (T5), batch+funnel (T6), USD page+cross-links (T7), testing gate (T8), gated deploy (T9), refresh skill (T10). All spec sections mapped.
- **No-deploy gate:** enforced — Tasks 1–8 are local; Task 9 is explicitly gated on approval.
- **Type/name consistency:** `runScreen(config)` config keys (`universe, tickersFile, outDir, currency, liveKey, fetchRf, rfLabel, topN, maxMargin, cacheFile`) are identical across T3/T4/T5. `fetchUsRf`/`fetchAusRf`/`fetchRfRate` signatures match T2 across consumers. `normalizeUsTickers` matches T1.
- **Deviation from spec (intentional):** ASX cache stays `_evaluated.json` (not renamed to `_evaluated-asx.json`) so the existing cache powers the byte-identical check with zero prep; SP500 cache is `_evaluated-sp500.json`. The shared-`app.js` `ASX 300` literal is made universe-driven (T7 Step 3) rather than forking `app.js`, preserving DRY.

## Post-build addendum (2026-06-04)

Verifying fair values against the live tool surfaced three engine-parity bugs not in
the original plan, all fixed in the shared engine (see the spec addendum for detail):
**(1)** non-bank financial `fcf × 0.6` haircut, **(2)** `^TNX` RF read from raw
`summaryDetail` (mapQuoteSummary leaves index `.price` null), **(3)** seeds rounded to
the tool's display precision (growth 1 dp, WACC/Re 2 dp). Added `--reeval` + a raw-data
cache to `run-screen.js` so parity fixes re-apply in ~2s. New tests in
`tests/evaluate.test.js` and `tests/rf.test.js`. The S&P 500 snapshot was re-run to
apply all three; the **ASX screen still needs its own re-run + redeploy** (separate,
user-approved follow-up) since it's live with the pre-fix engine.
```
