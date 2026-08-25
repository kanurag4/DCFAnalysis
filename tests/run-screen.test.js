const { test, mock } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readProxyUrl } = require('../scripts/lib/run-screen.js');
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

  mock.module('../scripts/fetch-yahoo.js', {
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
    if (beforeMargins !== null) fs.writeFileSync(SECTOR_MARGINS_PATH, beforeMargins); else fs.writeFileSync(SECTOR_MARGINS_PATH, '{}\n');
    if (beforeRaw !== null) fs.writeFileSync(SECTOR_RAW_PATH, beforeRaw); else if (fs.existsSync(SECTOR_RAW_PATH)) fs.unlinkSync(SECTOR_RAW_PATH);
    if (fs.existsSync(TEST_TICKERS_PATH)) fs.unlinkSync(TEST_TICKERS_PATH);
    if (fs.existsSync(TEST_CACHE_PATH)) fs.unlinkSync(TEST_CACHE_PATH);
  }
});
