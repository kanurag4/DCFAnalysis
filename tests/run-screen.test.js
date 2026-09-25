const { test, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readProxyUrl, runScreen, applyAiCorrelation } = require('../scripts/lib/run-screen.js');
const { PUBLISHED_PATH: SECTOR_MARGINS_PATH, RAW_PATH: SECTOR_RAW_PATH } = require('../scripts/lib/sector-margin-tally.js');

test('readProxyUrl prefers YAHOO_PROXY_URL env var over www/config.js', () => {
  const prev = process.env.YAHOO_PROXY_URL;
  process.env.YAHOO_PROXY_URL = 'https://env-override.example/';
  try {
    assert.strictEqual(readProxyUrl(), 'https://env-override.example/');
  } finally {
    if (prev === undefined) delete process.env.YAHOO_PROXY_URL; else process.env.YAHOO_PROXY_URL = prev;
  }
});

test('readProxyUrl falls back to parsing www/config.js when the env var is unset', () => {
  const prev = process.env.YAHOO_PROXY_URL;
  delete process.env.YAHOO_PROXY_URL;
  try {
    assert.strictEqual(readProxyUrl(), 'https://stock-evaluator.anurag-kor.workers.dev');
  } finally {
    if (prev !== undefined) process.env.YAHOO_PROXY_URL = prev;
  }
});

// This suite has no pre-existing fetchSymbol-mocking convention to follow
// (readProxyUrl above is a pure env/file-read function -- no network at all).
// Uses node:test's built-in mock.module (requires --experimental-test-module-
// mocks, added to package.json's test script for this) since there is no
// dependency-injection seam for fetchSymbol in run-screen.js otherwise.
const TEST_TICKERS_FILE = '_test-tickers-sector-margin.json';
const TEST_TICKERS_PATH = path.join(__dirname, '..', 'scripts', TEST_TICKERS_FILE);
const TEST_CACHE_FILE = '_test-cache-sector-margin.json';
const TEST_CACHE_PATH = path.join(__dirname, '..', 'scripts', TEST_CACHE_FILE);

const GOLD_FIXTURE = {
  sector: 'Basic Materials', industry: 'Gold',
  price: 10, marketCap: 1e9, totalDebt: 1e8, totalCash: 5e7,
  sharesOutstanding: 1e8, beta: 0.9, interestExpense: -1e6, taxRate: 0.3,
  freeCashflow: 1.2e8, operatingCashflow: 1.5e8, capitalExpenditures: -3e7,
  revenueGrowth: 0.06, earningsGrowth: 0.08, trailingPE: 14,
  totalRevenue: 1e9,
  annualFcfHistory: [
    { date: '2024-06-30', value: 1.5e8 },
    { date: '2025-06-30', value: 1.7e8 },
  ],
  annualRevenueHistory: [
    { date: '2024-06-30', value: 9e8 },
    { date: '2025-06-30', value: 9.5e8 },
  ],
};

test('gather() updates the sector-margins lookup as a byproduct of a full-fetch run', async () => {
  fs.writeFileSync(TEST_TICKERS_PATH, JSON.stringify(['TESTGOLD1.AX', 'TESTGOLD2.AX', 'TESTGOLD3.AX']));

  const fetchYahooMock = mock.module('../scripts/fetch-yahoo.js', {
    namedExports: {
      fetchSymbol: async (ticker) => ({ ticker, name: ticker, ...GOLD_FIXTURE }),
    },
  });
  delete require.cache[require.resolve('../scripts/lib/run-screen.js')];
  const { gather } = require('../scripts/lib/run-screen.js');

  const beforeMargins = fs.existsSync(SECTOR_MARGINS_PATH) ? fs.readFileSync(SECTOR_MARGINS_PATH, 'utf8') : null;
  const beforeRaw = fs.existsSync(SECTOR_RAW_PATH) ? fs.readFileSync(SECTOR_RAW_PATH, 'utf8') : null;

  try {
    const testConfig = {
      universe: 'Test', tickersFile: TEST_TICKERS_FILE, outDir: 'sector-margin-test-fixture',
      currency: 'AUD', liveKey: 'testRf', rfLabel: 'TEST RF', topN: 20, maxMargin: 0.8,
      cacheFile: TEST_CACHE_FILE, throttleMs: 1, // skip the real 3200ms per-ticker delay in tests
    };
    await gather(testConfig);
    const after = JSON.parse(fs.readFileSync(SECTOR_MARGINS_PATH, 'utf8'));
    assert.ok(after.Gold);
    assert.ok(after.Gold.peerCount >= 3);
  } finally {
    fetchYahooMock.restore();   // a module can only be mocked once at a time; later tests mock it again themselves
    if (beforeMargins !== null) fs.writeFileSync(SECTOR_MARGINS_PATH, beforeMargins); else fs.writeFileSync(SECTOR_MARGINS_PATH, '{}\n');
    if (beforeRaw !== null) fs.writeFileSync(SECTOR_RAW_PATH, beforeRaw); else if (fs.existsSync(SECTOR_RAW_PATH)) fs.unlinkSync(SECTOR_RAW_PATH);
    if (fs.existsSync(TEST_TICKERS_PATH)) fs.unlinkSync(TEST_TICKERS_PATH);
    if (fs.existsSync(TEST_CACHE_PATH)) fs.unlinkSync(TEST_CACHE_PATH);
  }
});
// --- AI Sector Correlation column (spec section 9) ---
const AI_OUT_DIR = 'ai-corr-test-fixture';
const AI_OUT_PATH = path.join(__dirname, '..', 'www', AI_OUT_DIR);
const AI_CACHE_FILE = '_test-cache-ai-corr.json';
const AI_CACHE_PATH = path.join(__dirname, '..', 'scripts', AI_CACHE_FILE);
const AI_CONFIG = {
  universe: 'Test', outDir: AI_OUT_DIR, currency: 'USD', topN: 10, maxMargin: 1.0,
  cacheFile: AI_CACHE_FILE, throttleMs: 1,
};
const evalRow = (ticker, marginOfSafety) => ({
  ticker, name: ticker + ' Inc', sector: 'Technology', method: 'DCF', fcfMethod: 'reported',
  intrinsic: 100, snapshotPrice: 100 / (1 + marginOfSafety), marginOfSafety, wacc: 0.09,
  terminalValuePct: 60, trailingPE: 12, marketCap: 1e9, operatingMargin: 0.2, analystTarget: 110,
  currency: 'USD', altmanZ: null, piotroskiF: null,
});
function cleanAiFixtures() {
  fs.rmSync(AI_OUT_PATH, { recursive: true, force: true });
  if (fs.existsSync(AI_CACHE_PATH)) fs.unlinkSync(AI_CACHE_PATH);
}

test('--rerank carries an existing aiCorrelation forward by ticker and emits null for a ticker without one', async () => {
  cleanAiFixtures();
  try {
    fs.mkdirSync(AI_OUT_PATH, { recursive: true });
    const prior = { r: 0.55, n: 200, band: 'high' };
    const priorHw = { r: -0.31, n: 200, band: 'inverse' };
    fs.writeFileSync(path.join(AI_OUT_PATH, 'rankings.json'), JSON.stringify({
      asAt: '2026-09-17',
      rows: [{ ticker: 'AAA', aiCorrelation: prior, aiHardwareCorrelation: priorHw }, { ticker: 'BBB', aiCorrelation: null, aiHardwareCorrelation: null }],
    }));
    fs.writeFileSync(AI_CACHE_PATH, JSON.stringify({
      asAt: '2026-09-24', tickerCount: 3,
      evaluated: [evalRow('AAA', 0.5), evalRow('BBB', 0.4), evalRow('CCC', 0.3)],
    }));

    await runScreen(AI_CONFIG, ['--rerank']);

    const rows = JSON.parse(fs.readFileSync(path.join(AI_OUT_PATH, 'rankings.json'), 'utf8')).rows;
    const by = Object.fromEntries(rows.map(r => [r.ticker, r]));
    assert.deepStrictEqual(by.AAA.aiCorrelation, prior);
    assert.deepStrictEqual(by.AAA.aiHardwareCorrelation, priorHw);
    assert.strictEqual(by.BBB.aiCorrelation, null);
    assert.strictEqual(by.BBB.aiHardwareCorrelation, null);
    assert.strictEqual(by.CCC.aiCorrelation, null);
    assert.strictEqual(by.CCC.aiHardwareCorrelation, null);
  } finally { cleanAiFixtures(); }
});

test('--rerank emits aiCorrelation: null on every row when there is no prior rankings.json (first-ever run)', async () => {
  cleanAiFixtures();
  try {
    fs.writeFileSync(AI_CACHE_PATH, JSON.stringify({
      asAt: '2026-09-24', tickerCount: 1, evaluated: [evalRow('AAA', 0.5)],
    }));
    await runScreen(AI_CONFIG, ['--rerank']);
    const rows = JSON.parse(fs.readFileSync(path.join(AI_OUT_PATH, 'rankings.json'), 'utf8')).rows;
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].aiCorrelation, null);
    assert.strictEqual(rows[0].aiHardwareCorrelation, null);
  } finally { cleanAiFixtures(); }
});

test('applyAiCorrelation runs the helper once over the written rows and persists what it returns', async () => {
  cleanAiFixtures();
  try {
    fs.mkdirSync(AI_OUT_PATH, { recursive: true });
    const rankingsPath = path.join(AI_OUT_PATH, 'rankings.json');
    fs.writeFileSync(rankingsPath, JSON.stringify({
      asAt: '2026-09-24', universe: 'Test', summary: { shown: 2 },
      rows: [{ ticker: 'AAA', rank: 1, aiCorrelation: null }, { ticker: 'BBB', rank: 2, aiCorrelation: null }],
    }));
    const calls = [];
    const fake = async (rows, opts) => {
      calls.push({ tickers: rows.map(r => r.ticker), throttleMs: opts.throttleMs, hasProxy: typeof opts.proxyUrl === 'string' });
      return rows.map((r, i) => ({
        ...r,
        aiCorrelation: i === 0 ? { r: 0.61, n: 240, band: 'high' } : null,
        aiHardwareCorrelation: i === 0 ? { r: -0.28, n: 240, band: 'inverse' } : null,
      }));
    };

    await applyAiCorrelation(AI_CONFIG, { addAiCorrelationImpl: fake });

    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0].tickers, ['AAA', 'BBB']);
    assert.strictEqual(calls[0].throttleMs, 1);   // config.throttleMs override honoured
    assert.strictEqual(calls[0].hasProxy, true);
    const written = JSON.parse(fs.readFileSync(rankingsPath, 'utf8'));
    assert.deepStrictEqual(written.rows[0].aiCorrelation, { r: 0.61, n: 240, band: 'high' });
    assert.deepStrictEqual(written.rows[0].aiHardwareCorrelation, { r: -0.28, n: 240, band: 'inverse' });
    assert.strictEqual(written.rows[1].aiCorrelation, null);
    assert.strictEqual(written.rows[1].aiHardwareCorrelation, null);
    assert.strictEqual(written.asAt, '2026-09-24');       // non-row content untouched
    assert.deepStrictEqual(written.summary, { shown: 2 });
  } finally { cleanAiFixtures(); }
});

// --- applyAiCorrelation is display-only: it must never take the portfolio accounting down with it ---
const ORDER_TICKERS_FILE = '_test-tickers-ai-order.json';
const ORDER_TICKERS_PATH = path.join(__dirname, '..', 'scripts', ORDER_TICKERS_FILE);

test('applyAiCorrelation never throws: a failing helper leaves rankings.json byte-for-byte unchanged', async () => {
  cleanAiFixtures();
  try {
    fs.mkdirSync(AI_OUT_PATH, { recursive: true });
    const rankingsPath = path.join(AI_OUT_PATH, 'rankings.json');
    const original = JSON.stringify({ asAt: '2026-09-24', rows: [{ ticker: 'AAA', rank: 1, aiCorrelation: { r: 0.5, n: 240, band: 'high' } }] }, null, 2) + '\n';
    fs.writeFileSync(rankingsPath, original);
    await assert.doesNotReject(applyAiCorrelation(AI_CONFIG, { addAiCorrelationImpl: async () => { throw new Error('worker down'); } }));
    assert.strictEqual(fs.readFileSync(rankingsPath, 'utf8'), original);
    JSON.parse(fs.readFileSync(rankingsPath, 'utf8'));            // still valid JSON
  } finally { cleanAiFixtures(); }
});

test('applyAiCorrelation never throws when rankings.json is missing or unreadable either', async () => {
  cleanAiFixtures();
  try {
    await assert.doesNotReject(applyAiCorrelation(AI_CONFIG, { addAiCorrelationImpl: async (rows) => rows }));   // no file at all
    fs.mkdirSync(AI_OUT_PATH, { recursive: true });
    fs.writeFileSync(path.join(AI_OUT_PATH, 'rankings.json'), '{ not json');
    await assert.doesNotReject(applyAiCorrelation(AI_CONFIG, { addAiCorrelationImpl: async (rows) => rows }));
    assert.strictEqual(fs.readFileSync(path.join(AI_OUT_PATH, 'rankings.json'), 'utf8'), '{ not json');
  } finally { cleanAiFixtures(); }
});

test('a full-fetch run finishes the portfolio accounting first, so an AI-correlation failure cannot strand it half-written', async () => {
  cleanAiFixtures();
  fs.writeFileSync(ORDER_TICKERS_PATH, JSON.stringify(['TESTGOLD1.AX', 'TESTGOLD2.AX']));
  let portfolioWrittenWhenAiRan = null;
  let fetchYahooMock, aiBatchMock, sectorMarginMock;
  try {
    // gather() would otherwise rewrite the real www/sector-margins.json, which ticker-page.js and evaluate.js
    // read at load time in OTHER test processes running in parallel: a half-written file there fails those
    // files intermittently. This test has no business touching it, so the tally module is stubbed out.
    sectorMarginMock = mock.module('../scripts/lib/sector-margin-tally.js', {
      namedExports: { tallyTickerMargin: () => null, updateSectorMarginLookup: () => {} },
    });
    fetchYahooMock = mock.module('../scripts/fetch-yahoo.js', {
      // intrinsic is ~34.6 at this fixture, so price 22 is a ~57% margin: it qualifies for the ranking.
      namedExports: { fetchSymbol: async (ticker) => ({ ticker, name: ticker, ...GOLD_FIXTURE, price: 22 }) },
    });
    aiBatchMock = mock.module('../scripts/lib/ai-correlation-batch.js', {
      namedExports: {
        addAiCorrelation: async () => {
          portfolioWrittenWhenAiRan = fs.existsSync(path.join(AI_OUT_PATH, 'portfolio-value.json'));
          throw new Error('worker down');
        },
      },
    });
    delete require.cache[require.resolve('../scripts/lib/run-screen.js')];
    const { runScreen: freshRunScreen } = require('../scripts/lib/run-screen.js');

    await freshRunScreen({
      universe: 'Test', tickersFile: ORDER_TICKERS_FILE, outDir: AI_OUT_DIR, currency: 'USD', liveKey: 'testRf',
      rfLabel: 'TEST RF', topN: 5, maxMargin: 1.0, cacheFile: AI_CACHE_FILE, throttleMs: 1,
    }, []);   // no --rerank/--reeval: the full-fetch path

    assert.strictEqual(portfolioWrittenWhenAiRan, true, 'AI correlation must run after the portfolio files are written');
    for (const f of ['rankings.json', 'portfolio-value.json', 'portfolio-history.json', 'sold.json']) {
      assert.ok(fs.existsSync(path.join(AI_OUT_PATH, f)), `${f} should exist`);
      JSON.parse(fs.readFileSync(path.join(AI_OUT_PATH, f), 'utf8'));
    }
  } finally {
    if (fetchYahooMock) fetchYahooMock.restore();
    if (aiBatchMock) aiBatchMock.restore();
    if (sectorMarginMock) sectorMarginMock.restore();
    delete require.cache[require.resolve('../scripts/lib/run-screen.js')];   // drop the copy bound to the mocks
    if (fs.existsSync(ORDER_TICKERS_PATH)) fs.unlinkSync(ORDER_TICKERS_PATH);
    cleanAiFixtures();
  }
});
