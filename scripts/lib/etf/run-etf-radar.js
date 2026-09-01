// scripts/lib/etf/run-etf-radar.js — the only non-pure module besides the CLI.
// Orchestrates: holdings (issuer download or committed snapshot) -> union of
// resolved Yahoo symbols -> evaluate each once (throttled) -> per-fund
// look-through MoS + coverage + sisters -> result object + etf-rankings.json.
const fs = require('node:fs');
const path = require('node:path');
const { loadUniverse } = require('./load-universe.js');
const { ADAPTERS } = require('./holdings/index.js');
const { resolveHoldings } = require('./resolve.js');
const { readSnapshot, writeSnapshot, evaluateFreshness } = require('./holdings-store.js');
const { aggregateFund, detectCrypto } = require('./aggregate.js');
const { sistersFor } = require('./overlap.js');
const { evSalesFallback } = require('./growth-eval.js');
const { marketParamsFor } = require('../market.js');
const { evaluateStock: realEvaluateStock } = require('../evaluate.js');
const { fetchSymbol: realFetchSymbol } = require('../../fetch-yahoo.js');
const { renderEtfPage } = require('./etf-page.js');
const { renderRadarPage } = require('./etf-radar-page.js');
const { readGrowthManifest, listGrowthMarketFolders } = require('../growth-manifest-reader.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DCF_FALLBACK_REASONS = new Set(['dcf-unavailable', 'no-wacc']);
const FINANCIALish = /financial|bank|insurance/i;
const COOLDOWN_MS = 65000;

async function ensureHoldings(fund, { holdingsDir, overridesPath, offline, log, searchSymbol }) {
  const overrides = overridesPath && fs.existsSync(overridesPath)
    ? JSON.parse(fs.readFileSync(overridesPath, 'utf8')) : {};
  const prev = readSnapshot(holdingsDir, fund.slug);
  let fresh = null;
  let overridesDirty = false;

  if (!offline) {
    try {
      const adapter = ADAPTERS[fund.issuer];
      const raw = await adapter.fetchHoldings(fund, {});
      let { resolved, unresolved } = resolveHoldings(raw.rows, { issuer: fund.issuer, overrides });
      // Last-resort name-search fallback (network — lives here, not in pure
      // resolve.js). A confident hit is written into the overrides map so it is
      // never searched again.
      for (const u of unresolved.slice()) {
        if (!u.name || !searchSymbol) break;
        const hit = await searchSymbol(u.name);
        if (hit) {
          overrides[`${fund.issuer}:${u.rawSymbol}`] = hit;
          overridesDirty = true;
          resolved.push({ ...u, yahoo: hit });
          unresolved = unresolved.filter(x => x !== u);
        }
      }
      unresolved.forEach(u => log(`  unresolved: ${fund.slug} ${u.rawSymbol} (${u.country || '?'})`));
      if (overridesDirty && overridesPath) {
        fs.writeFileSync(overridesPath, JSON.stringify(overrides, null, 2) + '\n');
      }
      fresh = {
        asOf: raw.asOf, source: raw.source, fetchedAt: new Date().toISOString(),
        rows: resolved.map(r => ({ yahoo: r.yahoo, raw: r.rawSymbol, name: r.name, weight: r.weight, country: r.country })),
      };
    } catch (e) { log(`  fetch failed: ${fund.slug} — ${e.message}`); }
  }

  const freshness = offline ? { ok: true, flags: [] } : evaluateFreshness(prev, fresh);
  const snapshot = (freshness.ok && fresh) ? fresh : prev;
  if (freshness.ok && fresh) writeSnapshot(holdingsDir, fund.slug, fresh);
  return { snapshot, flags: freshness.flags };
}

function valueOne(sym, data, evaluateStock) {
  if (!data) return { unvaluable: true, reason: 'fetch-failed' };
  if (data.quoteType === 'CRYPTO' || data.quoteType === 'CRYPTOCURRENCY') return { quoteType: 'CRYPTO' };
  const ev = evaluateStock(data, marketParamsFor(sym, {}));
  if (!ev.excluded && Number.isFinite(ev.marginOfSafety)) {
    return { mos: ev.marginOfSafety, method: ev.method };
  }
  const nonFinancial = !FINANCIALish.test(data.sector || '');
  if (nonFinancial && (!ev.reason || DCF_FALLBACK_REASONS.has(ev.reason))) {
    const g = evSalesFallback(data);
    if (g) return { mos: g.marginOfSafety, method: g.method };
  }
  return { unvaluable: true, reason: ev.reason || 'unvaluable' };
}

// Thin wrapper over the Worker /search?q= endpoint — returns the top match's
// symbol when the query looks unambiguous, else null. Injected so tests stub it.
async function searchSymbolReal(name, proxyUrl) {
  if (!proxyUrl) return null;
  try {
    const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(name)}`);
    if (!res.ok) return null;
    const body = await res.json();
    const hit = (body.quotes || body.results || [])[0];
    return hit && hit.symbol ? hit.symbol : null;
  } catch (_) { return null; }
}

async function runEtfRadar(deps, opts = {}) {
  const {
    universePath, injectedUniverse, holdingsDir, overridesPath, proxyUrl,
    fetchSymbol = realFetchSymbol, evaluateStock = realEvaluateStock,
    searchSymbol = (name) => searchSymbolReal(name, proxyUrl),
    now = () => new Date(), log = console.log,
  } = deps;
  const { throttleMs = 3200, coverageGate = 0.70, offline = false } = opts;
  const asAt = now().toISOString().slice(0, 10);

  const universe = loadUniverse(universePath, injectedUniverse);

  // 1. holdings for every fund (fresh issuer download, or committed snapshot)
  const withHoldings = [];
  for (const fund of universe) {
    const { snapshot, flags } = await ensureHoldings(fund, { holdingsDir, overridesPath, offline, log, searchSymbol });
    withHoldings.push({
      fund, holdings: (snapshot && snapshot.rows) || [],
      holdingsAsOf: snapshot && snapshot.asOf, flags,
    });
  }

  // 2. union of resolved Yahoo symbols -> evaluate each once
  const union = [...new Set(withHoldings.flatMap(w => w.holdings.map(h => h.yahoo)))];
  const valuations = {};
  let fetched = 0, failed = 0;
  for (const sym of union) {
    const data = await fetchSymbol(sym, { proxyUrl, retries: 2, backoffMs: 4000 });
    valuations[sym] = valueOne(sym, data, evaluateStock);
    if (data) fetched++; else failed++;
    if (throttleMs) await sleep(throttleMs);
  }
  // one cooldown sweep for the fetch-failures (mirrors run-screen.js)
  if (failed && !offline) {
    await sleep(COOLDOWN_MS);
    for (const sym of union) {
      const v = valuations[sym];
      if (!v.unvaluable || v.reason !== 'fetch-failed') continue;
      const data = await fetchSymbol(sym, { proxyUrl, retries: 2, backoffMs: 4000 });
      if (data) { valuations[sym] = valueOne(sym, data, evaluateStock); failed--; fetched++; }
      if (throttleMs) await sleep(throttleMs);
    }
  }

  // 2b. fund-level listing snapshot prices — for the detail pages (like ticker
  // pages, a monthly snapshot price, not a live refresh). Best-effort: a page
  // just shows the ticker without a price if this misses.
  for (const w of withHoldings) {
    w.snapshotPrices = {};
    for (const l of (w.fund.listings || [])) {
      const d = await fetchSymbol(l.ticker, { proxyUrl, retries: 1, backoffMs: 4000 });
      if (d && Number.isFinite(d.price)) {
        w.snapshotPrices[l.ticker] = { price: d.price, currency: d.currency || l.currency || null };
      }
      if (throttleMs) await sleep(throttleMs);
    }
  }

  // 3. aggregate per fund + crypto detection + sisters
  const fundsForOverlap = withHoldings.map(w => ({ slug: w.fund.slug, holdings: w.holdings }));
  const funds = withHoldings.map(w => {
    const isCrypto = w.fund.assetClass === 'crypto' || detectCrypto(w.holdings, valuations, {});
    const agg = isCrypto ? null : aggregateFund(w.holdings, valuations, { coverageGate });
    return {
      slug: w.fund.slug, name: w.fund.name, theme: w.fund.theme, fee: w.fund.fee,
      listings: w.fund.listings, assetClass: isCrypto ? 'crypto' : 'equity',
      holdingsAsOf: w.holdingsAsOf, flags: w.flags,
      holdingsCount: w.holdings.length,
      lookThroughMos: agg ? agg.lookThroughMos : null,
      coverage: agg ? agg.coverage : null,
      ranked: agg ? agg.ranked : false,
      valued: agg ? agg.valued : [], unvalued: agg ? agg.unvalued : [],
      cheapest: agg ? agg.cheapest : null, priciest: agg ? agg.priciest : null,
      sisters: sistersFor(w.fund.slug, fundsForOverlap, {}),
      snapshotPrices: w.snapshotPrices || {},
    };
  });

  const ranked = funds.filter(f => f.ranked)
    .sort((a, b) => b.lookThroughMos - a.lookThroughMos)
    .map((f, i) => ({ ...f, rank: i + 1 }));
  const unranked = funds.filter(f => !f.ranked && f.assetClass !== 'crypto');
  const notValued = funds.filter(f => f.assetClass === 'crypto');

  return {
    asAt, funds,
    union: { count: union.length, fetched, failed },
    rankings: { ranked, unranked, notValued },
  };
}

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Map every published DCF + growth ticker page's Yahoo symbol -> its URL, so a
// detail-page holdings row can link to it. Same manifests ticker-page.js's
// related-stocks pool reads.
function buildTickerPageIndex(stocksRoot) {
  const idx = {};
  const dcfBase = stocksRoot || path.join(__dirname, '..', '..', '..', 'www', 'stocks');
  try {
    for (const folder of fs.readdirSync(dcfBase, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
      let m = [];
      try { m = JSON.parse(fs.readFileSync(path.join(dcfBase, folder, 'manifest.json'), 'utf8')); } catch (_) { m = []; }
      for (const e of m) if (e.ticker && e.slug) idx[e.ticker] = `/dcf/stocks/${folder}/${e.slug}/`;
    }
  } catch (_) { /* no local stocks dir — links just won't render */ }
  try {
    for (const folder of listGrowthMarketFolders()) {
      for (const e of readGrowthManifest(folder)) {
        if (e.ticker && e.slug && !idx[e.ticker]) idx[e.ticker] = `/growth/stocks/${folder}/${e.slug}/`;
      }
    }
  } catch (_) { /* growth checkout not resolvable */ }
  return idx;
}

function writeRadarArtifacts(result, outDir, { generatePages = false, pagesRoot, tickerPageIndex, asAt } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'etf-rankings.json'), JSON.stringify(result, null, 2) + '\n');
  if (!generatePages) return;

  const at = asAt || result.asAt;
  const idx = tickerPageIndex || buildTickerPageIndex();
  const sisterMeta = {};
  for (const f of result.funds) {
    sisterMeta[f.slug] = {
      name: f.name, fee: f.fee, lookThroughMos: f.lookThroughMos,
      tickers: (f.listings || []).map(l => l.ticker),
    };
  }
  const rankBySlug = {};
  const total = result.rankings.ranked.length;
  result.rankings.ranked.forEach(f => { rankBySlug[f.slug] = f.rank; });

  const etfsDir = path.join(pagesRoot, 'etfs');
  const manifest = [];
  for (const f of result.funds) {
    const rank = rankBySlug[f.slug];
    const rankLine = rank ? `${ordinal(rank)} of ${total}` : null;
    const { html } = renderEtfPage(f, {
      snapshotPrices: f.snapshotPrices || {}, tickerPageIndex: idx, asAt: at, rankLine, sisterMeta,
    });
    const d = path.join(etfsDir, f.slug);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'index.html'), html);
    manifest.push({ slug: f.slug, name: f.name, theme: f.theme, updated: at });
  }
  fs.writeFileSync(path.join(etfsDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const radarDir = path.join(pagesRoot, 'etf-radar');
  fs.mkdirSync(radarDir, { recursive: true });
  fs.writeFileSync(path.join(radarDir, 'index.html'), renderRadarPage(result, { asAt: at }).html);
}

module.exports = { runEtfRadar, writeRadarArtifacts, valueOne, ensureHoldings, buildTickerPageIndex, ordinal };
