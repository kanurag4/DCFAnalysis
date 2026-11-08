// Three-stage DCF (method 4) on the DCF ticker pages (StockAnalysis plan Task 10). buildTickerPage runs on replayed
// Worker replies (tests/fixtures/ticker-page-replay/, recorded 2026-11-08 with the batch key), and its Base must equal
// the screen engine's (evaluateStock) for the same replies and rates -- parallel reimplementations drift (lesson
// 2026-11: PSX was -44.7% on its page vs +24.9% on the screen).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPLAY = path.join(__dirname, 'fixtures', 'ticker-page-replay');
const PROXY = 'https://proxy.test';

function replayFetch(name) {
  const rec = JSON.parse(fs.readFileSync(path.join(REPLAY, name + '.json'), 'utf8')).responses;
  return async (url) => {
    const r = rec[new URL(String(url)).pathname];
    if (!r) return new Response('not recorded', { status: 404 });
    return new Response(r.body, { status: r.status, headers: { 'content-type': 'application/json' } });
  };
}

// The generator spaces its requests 3.2 s apart; replayed replies need no spacing.
async function withReplay(name, fn) {
  const realFetch = global.fetch, realTimeout = global.setTimeout;
  global.fetch = replayFetch(name);
  global.setTimeout = (cb, _ms, ...args) => realTimeout(cb, 0, ...args);
  try { return await fn(); } finally { global.fetch = realFetch; global.setTimeout = realTimeout; }
}

const { buildTickerPage } = require('../scripts/lib/ticker-page.js');
const { evaluateStock } = require('../scripts/lib/evaluate.js');
const { marketParamsFor } = require('../scripts/lib/market.js');
const { fetchSymbol } = require('../scripts/fetch-yahoo.js');
const { convertFinancials } = require('../scripts/lib/convert-financials.js');
const { fetchUsRf, fetchAusRf } = require('../scripts/lib/rf.js');

async function page(t, threeStage) {
  return buildTickerPage(t, { proxyUrl: PROXY, indexHistoryCache: new Map(), aiCorrelationCache: new Map(), threeStage });
}
async function screen(t, threeStage) {
  const fetchImpl = global.fetch;
  let d = await fetchSymbol(t, { proxyUrl: PROXY, fetchImpl, retries: 0 });
  d = await convertFinancials(d, { proxyUrl: PROXY, fxCache: new Map() });
  const live = t.endsWith('.AX') ? { ausRf: await fetchAusRf(PROXY) } : { usRf: await fetchUsRf(PROXY) };
  return evaluateStock(d, marketParamsFor(t, live), { threeStage });
}

for (const [t, name] of [['NVDA', 'nvda']]) {
  test(`${t}: three-stage page Base = the screen engine's three-stage Base on the same replies`, async () => {
    await withReplay(name, async () => {
      const r = await page(t, true);
      assert.strictEqual(r.status, 'ok', r.reason);
      const s = await screen(t, true);
      assert.strictEqual(s.fcfMethod, 'three-stage');
      assert.ok(Math.abs(r.entry.intrinsic / s.intrinsic - 1) < 1e-9, `${t}: page ${r.entry.intrinsic} vs screen ${s.intrinsic}`);
      assert.strictEqual(r.entry.method, 'DCF');
    });
  });

  test(`${t}: three-stage page text names the method-4 inputs; meta description stays number-free`, async () => {
    await withReplay(name, async () => {
      const { html, entry } = await page(t, true);
      for (const label of ['Starting growth (yrs 1–5)', 'Long-run growth', 'Operating margin', 'Sales to capital', 'Projection horizon']) {
        assert.ok(html.includes(label), `${t}: "${label}"`);
      }
      assert.ok(html.includes('10 years'), `${t}: 10-year horizon`);
      assert.ok(!html.includes('5-yr FCF growth'), `${t}: no classic growth row`);
      assert.ok(html.includes('re-levered'), `${t}: bottom-up beta explained`);
      const meta = /<meta name="description" content="([^"]*)"/.exec(html)[1];
      assert.ok(meta.includes('?'), 'question-led');
      assert.ok(!meta.includes(entry.intrinsic.toFixed(2)), 'no Base number in the snippet');
    });
  });

  test(`${t}: switch off -> the classic page, same value as recorded`, async () => {
    await withReplay(name, async () => {
      const r = await page(t, false);
      const s = await screen(t, false);
      assert.ok(Math.abs(r.entry.intrinsic / s.intrinsic - 1) < 1e-9, `${t}: classic page = classic screen`);
      assert.ok(r.html.includes('5-yr FCF growth') || r.html.includes('Starting free cash flow'));
      assert.ok(!r.html.includes('Starting growth (yrs 1–5)'));
    });
  });
}

test('US only: BHP.AX with the switch on is the classic page, value and text', async () => {
  await withReplay('bhp-ax', async () => {
    const on = await page('BHP.AX', true);
    const off = await page('BHP.AX', false);
    assert.strictEqual(on.entry.intrinsic, off.entry.intrinsic);
    assert.ok(!on.html.includes('Starting growth (yrs 1–5)'));
  });
});

test('US lenders: COF ticker page with the switch on uses the bank model', async () => {
  await withReplay('cof', async () => {
    const on = await page('COF', true);
    assert.strictEqual(on.status, 'ok', on.reason);
    assert.ok(['DDM', 'ExcessReturn'].includes(on.entry.method), on.entry.method);
    const off = await page('COF', false);
    assert.strictEqual(off.entry.method, 'DCF');
  });
});

test('#1 negative trailing FCF: the ticker page stays classic (NVDA replay with FCF made negative)', async () => {
  const rec = JSON.parse(fs.readFileSync(path.join(REPLAY, 'nvda.json'), 'utf8')).responses;
  const qs = JSON.parse(rec['/quoteSummary/NVDA'].body);
  qs.quoteSummary.result[0].financialData.freeCashflow = { raw: -1e9 };
  // Non-cyclical industry, or the cycle-normalised FCF (positive for NVDA) would rightly stand in for it.
  qs.quoteSummary.result[0].assetProfile.industry = 'Software - Application';
  rec['/quoteSummary/NVDA'] = { status: 200, body: JSON.stringify(qs) };
  const realFetch = global.fetch, realTimeout = global.setTimeout;
  global.fetch = async (url) => { const r = rec[new URL(String(url)).pathname]; return r ? new Response(r.body, { status: r.status }) : new Response('nr', { status: 404 }); };
  global.setTimeout = (cb, _ms, ...args) => realTimeout(cb, 0, ...args);
  try {
    const r = await page('NVDA', true);
    assert.ok(!r.html || !r.html.includes('Starting growth (yrs 1–5)'), 'no three-stage text');
  } finally { global.fetch = realFetch; global.setTimeout = realTimeout; }
});
