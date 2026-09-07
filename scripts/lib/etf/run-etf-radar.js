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
const { reitValue, airlineValue } = require('./sector-models.js');
const { lookThroughGrowth } = require('./growth-rate.js');
const { isReit, isAirline, isBankOrInsurance } = require('../../../www/utils.js');
const { marketParamsFor } = require('../market.js');
const { evaluateStock: realEvaluateStock } = require('../evaluate.js');
const { fetchSymbol: realFetchSymbol } = require('../../fetch-yahoo.js');
const { fetchFxRate } = require('../../../www/data.js');
const { fetchUsRf, fetchAusRf, fetchIndRf } = require('../rf.js');
const { batchHeaders } = require('../batch-auth.js');
const { renderEtfPage } = require('./etf-page.js');
const { renderRadarPage } = require('./etf-radar-page.js');
const { readGrowthManifest, listGrowthMarketFolders } = require('../growth-manifest-reader.js');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DCF_FALLBACK_REASONS = new Set(['dcf-unavailable', 'no-wacc']);
const FINANCIALish = /financial|bank|insurance/i;
const COOLDOWN_MS = 65000;
// A single holding's premium/discount outside this band is almost always a data
// artifact (ADR currency/share-count mismatch, one-off-inflated FCF), not a real
// valuation — the "Most Undervalued" screens drop anything over +80% for the
// same reason. Such a holding is treated as unvaluable (drags coverage down),
// never blended into the look-through average.
const MAX_HOLDING_MARGIN = 1.0;   // > +100% "undervalued" — implausibly cheap
const MIN_HOLDING_MARGIN = -2.0;  // trades at > 3x its intrinsic value — implausible

// Convert a holding's financial-statement figures from its reporting currency
// into its quote currency, mirroring www/data.js's fetchDCFData() exactly. ADRs
// (Yahoo `currency` USD, `financialCurrency` INR/CNY/TWD/…) otherwise feed a
// DCF that divides an INR-denominated intrinsic value by a USD price. Fail
// closed: no rate -> null the figures so evaluateStock excludes the holding.
async function convertFinancials(data, { proxyUrl, fxCache, fetchFx = fetchFxRate }) {
  if (!data || !data.currency || !data.financialCurrency || data.currency === data.financialCurrency) return data;
  const key = `${data.financialCurrency}>${data.currency}`;
  let rate = fxCache.get(key);
  if (rate === undefined) {
    rate = await fetchFx(data.financialCurrency, data.currency, proxyUrl, batchHeaders());
    fxCache.set(key, rate);
  }
  const FIELDS = ['freeCashflow', 'operatingCashflow', 'capitalExpenditures', 'totalCash', 'totalDebt',
    'totalRevenue', 'ebit', 'interestExpense', 'annualFcf', 'netIncome', 'depreciationAndAmortization', 'ebitda'];
  const out = { ...data };
  if (rate == null) {
    for (const f of FIELDS) out[f] = null;
    out.annualFcfHistory = []; out.annualRevenueHistory = [];
    out.annualNetIncomeHistory = []; out.annualStockholdersEquityHistory = []; out.annualDividendsPaidHistory = [];
    out.fxConversionFailed = true;
    return out;
  }
  const c = (v) => (v != null && Number.isFinite(v) ? v * rate : v);
  for (const f of FIELDS) out[f] = c(data[f]);
  out.annualFcfHistory = (data.annualFcfHistory || []).map(e => ({ date: e.date, value: c(e.value) }));
  out.annualRevenueHistory = (data.annualRevenueHistory || []).map(e => ({ date: e.date, value: c(e.value) }));
  out.annualNetIncomeHistory = (data.annualNetIncomeHistory || []).map(e => ({ date: e.date, value: c(e.value) }));
  out.annualStockholdersEquityHistory = (data.annualStockholdersEquityHistory || []).map(e => ({ date: e.date, value: c(e.value) }));
  out.annualDividendsPaidHistory = (data.annualDividendsPaidHistory || []).map(e => ({ date: e.date, value: c(e.value) }));
  return out;
}

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
        if (!searchSymbol) break;
        if (!u.name) continue;               // SEDOL-only row with no name — skip just this one
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
        rows: resolved.map(r => ({
          yahoo: r.yahoo, raw: r.rawSymbol, name: r.name, weight: r.weight,
          country: r.country || null, sector: r.sector || null,
        })),
      };
    } catch (e) { log(`  fetch failed: ${fund.slug} — ${e.message}`); }
  }

  const freshness = offline ? { ok: true, flags: [] } : evaluateFreshness(prev, fresh);
  const snapshot = (freshness.ok && fresh) ? fresh : prev;
  if (freshness.ok && fresh) writeSnapshot(holdingsDir, fund.slug, fresh);
  return { snapshot, flags: freshness.flags };
}

function plausible(mos, { maxMargin = MAX_HOLDING_MARGIN, minMargin = MIN_HOLDING_MARGIN } = {}) {
  return Number.isFinite(mos) && mos <= maxMargin && mos >= minMargin;
}

function valueOne(sym, data, evaluateStock, bounds = {}, live = {}) {
  if (!data) return { unvaluable: true, reason: 'fetch-failed' };
  if (data.quoteType === 'CRYPTO' || data.quoteType === 'CRYPTOCURRENCY') return { quoteType: 'CRYPTO' };

  // REITs and airlines are structurally wrong for FCF-based DCF — value them
  // with the same P/AFFO / EV-EBITDA engines the per-ticker pages use, before
  // the DCF path, exactly as ticker-page.js dispatches. This branch is
  // radar-only: scripts/lib/evaluate.js (the undervalued-screen engine)
  // deliberately has no REIT/airline branch, and keeping the logic here rather
  // than there is what stops it from moving the screen rankings. Mortgage REITs
  // are excluded by isReit() itself and still route through evaluateStock's DDM
  // (via isBankOrInsurance); the !isBank guard mirrors ticker-page.js:756-757.
  const isBank = isBankOrInsurance(data.sector, data.industry, data.ticker);
  if (!isBank && isReit(data.sector, data.industry)) {
    const rr = reitValue(data);
    if (!rr) return { unvaluable: true, reason: 'reit-unavailable' };
    return plausible(rr.marginOfSafety, bounds)
      ? { mos: rr.marginOfSafety, method: 'REIT' }
      : { unvaluable: true, reason: 'implausible-margin' };
  }
  if (!isBank && isAirline(data.sector, data.industry)) {
    const ar = airlineValue(data);
    if (!ar) return { unvaluable: true, reason: 'airline-unavailable' };
    return plausible(ar.marginOfSafety, bounds)
      ? { mos: ar.marginOfSafety, method: 'Airline' }
      : { unvaluable: true, reason: 'implausible-margin' };
  }

  // Replace the engine's 1-year revenue/earnings growth with the conservative
  // multi-year trend (growth-rate.js). Setting both fields equal makes
  // deriveBaseGrowth()'s avg() return that value (still clamped [-0.05, 0.25]),
  // and also feeds deriveDividendGrowth() for bank/insurer/utility holdings
  // (clamped [0, 0.06] there — a conservative dividend-growth input, fine).
  // The EV/Sales fallback + quoteType read the raw `data`.
  const g = lookThroughGrowth(data);
  const ev = evaluateStock({ ...data, revenueGrowth: g, earningsGrowth: g }, marketParamsFor(sym, live));
  if (!ev.excluded && Number.isFinite(ev.marginOfSafety)) {
    return plausible(ev.marginOfSafety, bounds)
      ? { mos: ev.marginOfSafety, method: ev.method }
      : { unvaluable: true, reason: 'implausible-margin' };
  }
  const nonFinancial = !FINANCIALish.test(data.sector || '');
  if (nonFinancial && (!ev.reason || DCF_FALLBACK_REASONS.has(ev.reason))) {
    const gg = evSalesFallback(data);
    if (gg) {
      return plausible(gg.marginOfSafety, bounds)
        ? { mos: gg.marginOfSafety, method: gg.method }
        : { unvaluable: true, reason: 'implausible-margin' };
    }
  }
  return { unvaluable: true, reason: ev.reason || 'unvaluable' };
}

// One batch call to the Worker's /quote?symbols= endpoint for the fund listing
// tickers — price + currency for all of them in a single request (ETF quotes
// come back via regularMarketPrice, which the per-symbol quoteSummary path
// often lacks). Returns { [ticker]: { price, currency } }. Injected for tests.
async function fetchQuotesReal(tickers, proxyUrl) {
  if (!tickers.length || !proxyUrl) return {};
  const url = `${proxyUrl.replace(/\/$/, '')}/quote?symbols=${encodeURIComponent(tickers.join(','))}`;
  // One retry: a single transient 502 here would otherwise blank every listing
  // price + Implied fair value column for the whole run, silently.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { headers: batchHeaders() });
      if (res.ok) {
        const body = await res.json();
        const out = {};
        for (const q of (Array.isArray(body) ? body : body.quotes || body.result || [])) {
          const price = q.regularMarketPrice ?? q.price;
          if (q.symbol && Number.isFinite(price)) out[q.symbol] = { price, currency: q.currency || null };
        }
        if (Object.keys(out).length) return out;
      }
    } catch (_) { /* retry */ }
    if (attempt === 0) await sleep(4000);
  }
  return {};
}

// Thin wrapper over the Worker /search?q= endpoint — returns the top match's
// symbol when the query looks unambiguous, else null. Injected so tests stub it.
async function searchSymbolReal(name, proxyUrl) {
  if (!proxyUrl) return null;
  try {
    const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/search?q=${encodeURIComponent(name)}`,
      { headers: batchHeaders() });
    if (!res.ok) return null;
    const body = await res.json();
    const hit = (body.quotes || body.results || [])[0];
    return hit && hit.symbol ? hit.symbol : null;
  } catch (_) { return null; }
}

// Live risk-free rates for the markets market.js can override (us/aus/ind — the
// rest have no live source). Fetched once, reused for every holding, so the ETF
// DCFs use the same rf as the "Most Undervalued" screens and the /dcf/stocks/
// pages rather than a stale static seed. Injected for tests.
async function fetchLiveRatesReal(proxyUrl) {
  if (!proxyUrl) return {};
  const [usRf, ausRf, indRf] = await Promise.all([
    fetchUsRf(proxyUrl), fetchAusRf(proxyUrl), fetchIndRf(proxyUrl),
  ]);
  return { usRf, ausRf, indRf };
}

async function runEtfRadar(deps, opts = {}) {
  const {
    universePath, injectedUniverse, holdingsDir, overridesPath, proxyUrl, rawCachePath,
    fetchSymbol = realFetchSymbol, evaluateStock = realEvaluateStock, fetchFx = fetchFxRate,
    fetchQuotes = fetchQuotesReal, fetchLiveRates = fetchLiveRatesReal,
    searchSymbol = (name) => searchSymbolReal(name, proxyUrl),
    now = () => new Date(), log = console.log,
  } = deps;
  const { throttleMs = 3200, coverageGate = 0.70, offline = false, reagg = false,
    bounds = {} } = opts;
  const asAt = now().toISOString().slice(0, 10);
  const fxCache = new Map();

  const universe = loadUniverse(universePath, injectedUniverse);

  // 1. holdings for every fund. --reagg still re-downloads issuer files (cheap,
  //    ~10s, and picks up adapter changes) — only the Yahoo union fetch is cached.
  //    ensureHoldings() keeps last-good on any data-integrity flag, including a
  //    re-downloaded file whose asOf goes backwards (holdings-store.js).
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

  // --reagg: reuse the cached union (the 25-50 min fetch) and re-run FX +
  // valueOne + aggregate + pages. Still hits the network for the cheap parts —
  // issuer holdings (above), /quote listing prices, name-search. A symbol added
  // to a fund since the cached run has no cache entry -> counts as fetch-failed;
  // funds added via `--only` avoid this because that path folds its per-fund
  // cache back into _raw-etf.json (see refresh-etf-radar.js's --only branch).
  const cache = (reagg && rawCachePath && fs.existsSync(rawCachePath))
    ? JSON.parse(fs.readFileSync(rawCachePath, 'utf8')) : null;

  const live = (cache && cache.live) ? cache.live : await fetchLiveRates(proxyUrl);

  let listingPrices = {};

  if (cache) {
    for (const [k, v] of Object.entries(cache.fx || {})) fxCache.set(k, v);
    const noNetFx = async () => null; // every pair is already in fxCache on reagg
    for (const sym of union) {
      const data = cache.union[sym] || null;
      const converted = data ? await convertFinancials(data, { proxyUrl, fxCache, fetchFx: noNetFx }) : null;
      valuations[sym] = valueOne(sym, converted, evaluateStock, bounds, live);
      if (data) fetched++; else failed++;
    }
  } else {
    const rawUnion = {};
    // Written after every symbol so a killed long run still leaves a usable
    // partial cache for --reagg (the union fetch is 25-50 min).
    const flushCache = () => {
      if (rawCachePath) {
        fs.writeFileSync(rawCachePath, JSON.stringify({
          asAt, live, union: rawUnion, listingPrices, fx: Object.fromEntries(fxCache),
        }));
      }
    };
    let i = 0;
    for (const sym of union) {
      const data = await fetchSymbol(sym, { proxyUrl, retries: 2, backoffMs: 4000 });
      rawUnion[sym] = data || null;
      const converted = await convertFinancials(data, { proxyUrl, fxCache, fetchFx });
      valuations[sym] = valueOne(sym, converted, evaluateStock, bounds, live);
      if (data) fetched++; else failed++;
      if (++i % 10 === 0) { flushCache(); log(`  … ${i}/${union.length} fetched (${failed} failed)`); }
      if (throttleMs) await sleep(throttleMs);
    }
    flushCache();
    // one cooldown sweep for the fetch-failures (mirrors run-screen.js)
    if (failed && !offline) {
      await sleep(COOLDOWN_MS);
      for (const sym of union) {
        const v = valuations[sym];
        if (!v.unvaluable || v.reason !== 'fetch-failed') continue;
        const data = await fetchSymbol(sym, { proxyUrl, retries: 2, backoffMs: 4000 });
        if (data) {
          rawUnion[sym] = data;
          const converted = await convertFinancials(data, { proxyUrl, fxCache, fetchFx });
          valuations[sym] = valueOne(sym, converted, evaluateStock, bounds, live);
          failed--; fetched++;
        }
        if (throttleMs) await sleep(throttleMs);
      }
      flushCache();
    }
    flushCache();
  }

  // Fund-level listing prices — one batch /quote call for every listing ticker
  // (cheap enough to redo even on --reagg for a fresh snapshot price).
  const allTickers = [...new Set(withHoldings.flatMap(w => (w.fund.listings || []).map(l => l.ticker)))];
  listingPrices = await fetchQuotes(allTickers, proxyUrl);
  for (const w of withHoldings) {
    w.snapshotPrices = {};
    for (const l of (w.fund.listings || [])) {
      if (listingPrices[l.ticker]) w.snapshotPrices[l.ticker] = listingPrices[l.ticker];
    }
  }
  if (rawCachePath && fs.existsSync(rawCachePath)) {
    try {
      const cur = JSON.parse(fs.readFileSync(rawCachePath, 'utf8'));
      cur.listingPrices = listingPrices;
      cur.live = live;
      fs.writeFileSync(rawCachePath, JSON.stringify(cur));
    } catch (_) { /* cache write is best-effort */ }
  }

  // 3. crypto safety-net, then aggregate per fund + sisters.
  // A fund whose holdings are mostly crypto proxies is dropped entirely — no
  // ranked row, no page. (Crypto isn't something the radar values; there are no
  // crypto funds in etfs.json.) Excluded funds are also removed from the
  // sister-overlap pool so no detail page links to a page that won't exist.
  const cryptoExcluded = withHoldings
    .filter(w => detectCrypto(w.holdings, valuations, {}))
    .map(w => w.fund.slug);
  cryptoExcluded.forEach(s => log(`  excluded (crypto-heavy): ${s}`));
  const rankable = withHoldings.filter(w => !cryptoExcluded.includes(w.fund.slug));
  const fundsForOverlap = rankable.map(w => ({ slug: w.fund.slug, holdings: w.holdings }));

  const funds = [];
  for (const w of rankable) {
    const agg = aggregateFund(w.holdings, valuations, { coverageGate });
    funds.push({
      slug: w.fund.slug, name: w.fund.name, theme: w.fund.theme, fee: w.fund.fee,
      listings: w.fund.listings,
      holdingsAsOf: w.holdingsAsOf, flags: w.flags,
      holdingsCount: w.holdings.length,
      lookThroughMos: agg.lookThroughMos,
      coverage: agg.coverage,
      ranked: agg.ranked,
      valued: agg.valued, unvalued: agg.unvalued,
      cheapest: agg.cheapest, priciest: agg.priciest,
      sisters: sistersFor(w.fund.slug, fundsForOverlap, {}),
      snapshotPrices: w.snapshotPrices || {},
      sectorMix: weightMix(w.holdings, 'sector'),
      countryMix: weightMix(w.holdings, 'country'),
    });
  }

  const ranked = funds.filter(f => f.ranked)
    .sort((a, b) => b.lookThroughMos - a.lookThroughMos)
    .map((f, i) => ({ ...f, rank: i + 1 }));
  const unranked = funds.filter(f => !f.ranked);

  return {
    asAt, funds,
    union: { count: union.length, fetched, failed },
    rankings: { ranked, unranked },
    cryptoExcluded,
  };
}

// weight-share breakdown by a row key (sector / country), top entries first.
function weightMix(holdings, key) {
  const by = new Map();
  let total = 0;
  for (const h of holdings) {
    const k = (h[key] || '').trim() || 'Other';
    by.set(k, (by.get(k) || 0) + (h.weight || 0));
    total += h.weight || 0;
  }
  if (!(total > 0)) return [];
  return [...by.entries()]
    .map(([name, w]) => ({ name, weight: w / total }))
    .sort((a, b) => b.weight - a.weight);
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

// Slim per-fund summary for the published etf-rankings.json — the full valued/
// unvalued/sectorMix/... arrays are consumed at page-gen time and don't need to
// ship to the CDN (they made the file ~8k lines with valued[] duplicated across
// funds + rankings). Enough here for the skill's "biggest movers vs last run"
// diff and any future data feed.
function slimResult(result) {
  const fund = (f) => ({
    slug: f.slug, name: f.name, theme: f.theme, fee: f.fee,
    lookThroughMos: f.lookThroughMos, coverage: f.coverage, ranked: f.ranked,
    holdingsCount: f.holdingsCount, valuedCount: (f.valued || []).length,
    rank: f.rank ?? null, flags: f.flags || [],
  });
  return {
    asAt: result.asAt,
    union: result.union,
    cryptoExcluded: result.cryptoExcluded || [],
    ranked: result.rankings.ranked.map(fund),
    unranked: result.rankings.unranked.map(fund),
  };
}

function writeRadarArtifacts(result, outDir, { generatePages = false, pagesRoot, tickerPageIndex, asAt } = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'etf-rankings.json'), JSON.stringify(slimResult(result), null, 2) + '\n');
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

  // Keep the /dcf/stocks/ hub's "Thematic ETFs" section in sync (it reads the
  // manifest just written). Best-effort — a hub without a stocks manifest yet
  // just throws and is skipped.
  try {
    require('../../generate-stocks-hub.js').generateStocksHub();
  } catch (_) { /* no stocks manifest, or hub gen unavailable */ }

  const radarDir = path.join(pagesRoot, 'etf-radar');
  fs.mkdirSync(radarDir, { recursive: true });
  fs.writeFileSync(path.join(radarDir, 'index.html'), renderRadarPage(result, { asAt: at }).html);
  // The ranking page reuses the "Most Undervalued <market>" screen stylesheet
  // (all six are byte-identical). Copy the ASX one alongside so /dcf/etf-radar/
  // style.css resolves like the screens' in local preview. trimEnd() drops a
  // stray trailing newline this repo's copy carries but the deploy target's
  // doesn't, keeping the drift pair clean. (The publish step re-copies from the
  // deploy target's own screen CSS regardless — see the refresh-etf-radar skill.)
  const screenCss = path.join(__dirname, '..', '..', '..', 'www', 'asx-undervalued', 'style.css');
  if (fs.existsSync(screenCss)) {
    fs.writeFileSync(path.join(radarDir, 'style.css'), fs.readFileSync(screenCss, 'utf8').replace(/\s+$/, '\n'));
  }
}

module.exports = {
  runEtfRadar, writeRadarArtifacts, slimResult, valueOne, plausible, convertFinancials,
  ensureHoldings, buildTickerPageIndex, ordinal, fetchQuotesReal,
  MAX_HOLDING_MARGIN, MIN_HOLDING_MARGIN,
};
