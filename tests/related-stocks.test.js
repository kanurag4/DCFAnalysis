const { test } = require('node:test');
const assert = require('node:assert');
const { selectRelatedStocks, buildRelatedStocksHtml, MARKET_META } = require('../scripts/lib/related-stocks.js');

function candidate(overrides = {}) {
  return {
    ticker: 'ABC', name: 'ABC Corp', sector: 'Financial Services', market: 'asx',
    method: 'DCF', marginOfSafety: 0.1, marketCap: 10e9,
    url: '/dcf/stocks/asx/abc/',
    ...overrides,
  };
}

test('selectRelatedStocks returns [] when fewer than 3 same-sector candidates exist', () => {
  const current = { ticker: 'QBE.AX', sector: 'Financial Services', marketCap: 33.87e9 };
  const pool = [
    candidate({ ticker: 'CPU.AX', marketCap: 23.4e9 }),
    candidate({ ticker: 'SUN.AX', marketCap: 19.8e9 }),
  ];
  assert.deepStrictEqual(selectRelatedStocks(current, pool), []);
});

test('selectRelatedStocks excludes candidates from a different sector', () => {
  const current = { ticker: 'QBE.AX', sector: 'Financial Services', marketCap: 33.87e9 };
  const pool = [
    candidate({ ticker: 'CPU.AX', marketCap: 23.4e9 }),
    candidate({ ticker: 'SUN.AX', marketCap: 19.8e9 }),
    candidate({ ticker: 'IAG.AX', marketCap: 19.0e9 }),
    candidate({ ticker: 'LLY', sector: 'Healthcare', marketCap: 1051e9 }),
  ];
  const result = selectRelatedStocks(current, pool);
  assert.strictEqual(result.length, 3);
  assert.ok(!result.some(c => c.ticker === 'LLY'));
});

test('selectRelatedStocks excludes the current ticker itself even if present in the pool', () => {
  const current = { ticker: 'QBE.AX', sector: 'Financial Services', marketCap: 33.87e9 };
  const pool = [
    candidate({ ticker: 'QBE.AX', marketCap: 33.87e9 }),
    candidate({ ticker: 'CPU.AX', marketCap: 23.4e9 }),
    candidate({ ticker: 'SUN.AX', marketCap: 19.8e9 }),
    candidate({ ticker: 'IAG.AX', marketCap: 19.0e9 }),
  ];
  const result = selectRelatedStocks(current, pool);
  assert.ok(!result.some(c => c.ticker === 'QBE.AX'));
  assert.strictEqual(result.length, 3);
});

test('selectRelatedStocks excludes candidates missing a usable marketCap', () => {
  const current = { ticker: 'QBE.AX', sector: 'Financial Services', marketCap: 33.87e9 };
  const pool = [
    candidate({ ticker: 'CPU.AX', marketCap: 23.4e9 }),
    candidate({ ticker: 'SUN.AX', marketCap: 19.8e9 }),
    candidate({ ticker: 'IAG.AX', marketCap: null }),
    candidate({ ticker: 'MPL.AX', marketCap: 0 }),
  ];
  // Only 2 candidates have a usable marketCap -> below the 3-candidate floor.
  assert.deepStrictEqual(selectRelatedStocks(current, pool), []);
});

test('selectRelatedStocks sorts by closest market cap and caps at 5', () => {
  const current = { ticker: 'QBE.AX', sector: 'Financial Services', marketCap: 33.87e9 };
  const pool = [
    candidate({ ticker: 'A', marketCap: 23.4e9 }),  // diff 10.47e9
    candidate({ ticker: 'B', marketCap: 19.8e9 }),  // diff 14.07e9
    candidate({ ticker: 'C', marketCap: 19.0e9 }),  // diff 14.87e9
    candidate({ ticker: 'D', marketCap: 13.9e9 }),  // diff 19.97e9
    candidate({ ticker: 'E', marketCap: 6.3e9 }),   // diff 27.57e9
    candidate({ ticker: 'F', marketCap: 6.5e9 }),   // diff 27.37e9
    candidate({ ticker: 'G', marketCap: 500e9 }),   // diff huge, excluded by cap
  ];
  const result = selectRelatedStocks(current, pool);
  assert.deepStrictEqual(result.map(c => c.ticker), ['A', 'B', 'C', 'D', 'F']);
});

test('buildRelatedStocksHtml renders only the browse link when candidates is empty', () => {
  const html = buildRelatedStocksHtml([], { browseHref: '/dcf/stocks/asx/', browseLabel: 'Browse all &rarr;' });
  assert.ok(html.includes('ticker-chip-row'));
  assert.ok(html.includes('/dcf/stocks/asx/'));
  assert.ok(!html.includes('related-stocks-grid'));
});

test('buildRelatedStocksHtml renders a card per candidate with the right verdict pill class', () => {
  const candidates = [
    candidate({ ticker: 'CPU.AX', name: 'Computershare Limited', marginOfSafety: -0.657, market: 'asx', method: 'DCF', url: '/dcf/stocks/asx/cpu-ax/' }),
    candidate({ ticker: 'SUN.AX', name: 'Suncorp Group Limited', marginOfSafety: 0.062, market: 'asx', method: 'DDM', url: '/dcf/stocks/asx/sun-ax/' }),
    candidate({ ticker: 'EDEN.PA', name: 'Edenred SE', marginOfSafety: 1.192, market: 'other', method: 'DCF', url: '/dcf/stocks/other/eden-pa/' }),
  ];
  const html = buildRelatedStocksHtml(candidates, { browseHref: '/dcf/stocks/asx/', browseLabel: 'Browse all &rarr;' });
  assert.ok(html.includes('related-stocks-grid'));
  assert.ok(html.includes('Computershare Limited'));
  assert.ok(html.includes('rsc-bad'));   // CPU.AX: -65.7% -> Overvalued
  assert.ok(html.includes('rsc-ok'));    // SUN.AX: +6.2% -> Fairly Valued
  assert.ok(html.includes('rsc-good'));  // EDEN.PA: +119.2% -> Undervalued
  assert.ok(html.includes('-65.7%'));
  assert.ok(html.includes('+6.2%'));
  assert.ok(html.includes('🌐'));        // "other" market flag
});

test('buildRelatedStocksHtml escapes company names', () => {
  const candidates = [
    candidate({ ticker: 'A', name: 'A & B <Corp>', marketCap: 20e9 }),
    candidate({ ticker: 'C', name: 'C Corp', marketCap: 21e9 }),
    candidate({ ticker: 'D', name: 'D Corp', marketCap: 22e9 }),
  ];
  const html = buildRelatedStocksHtml(candidates, { browseHref: '/x/', browseLabel: 'x' });
  assert.ok(html.includes('A &amp; B &lt;Corp&gt;'));
  assert.ok(!html.includes('<Corp>'));
});

test('MARKET_META has an entry for every market folder the site currently uses', () => {
  for (const folder of ['asx', 'sp500', 'nifty', 'kospi', 'nikkei', 'other']) {
    assert.ok(MARKET_META[folder], `missing MARKET_META for ${folder}`);
    assert.ok(MARKET_META[folder].flag);
    assert.ok(MARKET_META[folder].label);
  }
});
