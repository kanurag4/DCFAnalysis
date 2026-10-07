// scripts/build-europe600.js
// Usage: node scripts/build-europe600.js [path/to/holdings.csv]
//
// Builds scripts/europe600.json -- the Europe undervalued screen's universe -- from
// the iShares STOXX Europe 600 UCITS ETF (DE) (EXSA, product 251931) full-holdings
// CSV, which tracks the STOXX Europe 600 by full replication. The CSV lists the
// LOCAL exchange mnemonic + the venue the line trades on, so the Yahoo suffix comes
// from the venue (not the issuer's country): Shell is "SHELL" on Euronext Amsterdam
// -> SHELL.AS, not SHELL.L. With no argument the CSV is downloaded; the product
// page is scraped for the current download link because its document id changes.
//
// Deliberately NOT in the universe (reported on every run, never silently dropped):
//   Poland (.WA) and Greece (.AT) -- no sourced risk-free/ERP bucket exists for them
//   in scripts/lib/market.js, and an unsourced bucket would silently fall back to the
//   US rate. Add a sourced bucket there first, then remove them from EXCLUDED_EXCHANGES.
//
// Refresh quarterly (STOXX reviews the index in March/June/Sept/Dec) or when a run's
// funnel shows a cluster of fetchFailed tickers.
const fs = require('node:fs');
const path = require('node:path');
const { parseCsv } = require('./lib/etf/holdings/csv.js');
const { normalizeEuropeTickers } = require('./lib/europe-list.js');

const PRODUCT_PAGE = 'https://www.ishares.com/ch/individual/en/products/251931/ishares-stoxx-europe-600-ucits-etf-de';
const BASE = 'https://www.ishares.com';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';

// Venue (iShares "Exchange" column, upper-cased) -> Yahoo suffix.
const EXCHANGE_SUFFIX = {
  'EURONEXT AMSTERDAM': '.AS',
  'LONDON STOCK EXCHANGE': '.L',
  'SIX SWISS EXCHANGE': '.SW',
  'XETRA': '.DE',
  'DEUTSCHE BOERSE XETRA': '.DE',
  'BOLSA DE MADRID': '.MC',
  'NYSE EURONEXT - EURONEXT PARIS': '.PA',
  'BORSA ITALIANA': '.MI',
  'OMX NORDIC EXCHANGE COPENHAGEN A/S': '.CO',
  'NYSE EURONEXT - EURONEXT BRUSSELS': '.BR',
  'NASDAQ OMX NORDIC': '.ST',
  'NASDAQ OMX HELSINKI LTD.': '.HE',
  'WIENER BOERSE AG': '.VI',
  'OSLO BORS ASA': '.OL',
  'IRISH STOCK EXCHANGE - ALL MARKET': '.IR',
  'NYSE EURONEXT - EURONEXT LISBON': '.LS',
};
const EXCLUDED_EXCHANGES = new Set([
  'WARSAW STOCK EXCHANGE/EQUITIES/MAIN MARKET',
  'ATHENS EXCHANGE S.A. CASH MARKET',
]);

// iShares mnemonic -> Yahoo symbol where the generic rules below get it wrong.
// Grow this from a run's fetchFailed list.
const OVERRIDES = {
  'ROP': 'ROG.SW', // Roche (non-voting certificate)
};

// Pure: one holdings row -> Yahoo symbol, or null if the venue is not mapped.
function toYahoo(raw, exchange) {
  const key = String(exchange || '').trim().toUpperCase();
  const sym = String(raw || '').trim();
  if (OVERRIDES[sym]) return OVERRIDES[sym];
  const suffix = EXCHANGE_SUFFIX[key];
  if (!suffix || !sym || sym === '-') return null;
  let base = sym.replace(/\.+$/, '')   // "BP." -> "BP"
    .replace(/\s+/g, '-')              // "VOLV B" -> "VOLV-B" (Nordic share class)
    .toUpperCase();
  if (suffix === '.L') base = base.replace(/\./g, '-'); // "BT.A" -> "BT-A"
  return base + suffix;
}

function parseHoldings(csvText) {
  const rows = parseCsv(csvText.replace(/^﻿/, ''));
  let asOf = null, hi = -1;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] && /fund holdings as of/i.test(rows[i][0])) asOf = rows[i][1];
    if (rows[i][0] && rows[i][0].trim().toLowerCase() === 'ticker') { hi = i; break; }
  }
  if (hi < 0) throw new Error('holdings header row not found');
  const h = rows[hi].map(x => x.trim().toLowerCase());
  const col = n => h.indexOf(n);
  const out = [];
  for (const r of rows.slice(hi + 1)) {
    if (r.length < h.length) continue;
    if ((r[col('asset class')] || '').trim().toLowerCase() !== 'equity') continue;
    out.push({
      raw: (r[col('ticker')] || '').trim(),
      name: (r[col('name')] || '').trim(),
      exchange: (r[col('exchange')] || '').trim(),
      currency: (r[col('market currency')] || '').trim(),
    });
  }
  return { asOf, equities: out };
}

async function download() {
  const page = await (await fetch(PRODUCT_PAGE, { headers: { 'User-Agent': UA } })).text();
  const m = page.match(/(\/ch\/individual\/en\/products\/251931\/[^"' ]*\.ajax\?fileType=csv&fileName=EXSA_holdings&dataType=fund)/);
  if (!m) throw new Error('holdings download link not found on the iShares product page');
  const res = await fetch(BASE + m[1], { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`holdings download ${res.status}`);
  return res.text();
}

async function main() {
  const arg = process.argv[2];
  const csvText = arg ? fs.readFileSync(arg, 'utf8') : await download();
  if (!arg) fs.writeFileSync(path.join(__dirname, '_europe600-raw.csv'), csvText); // gitignored provenance copy
  const { asOf, equities } = parseHoldings(csvText);

  const mapped = [], excluded = [], unmapped = [];
  for (const e of equities) {
    const ex = e.exchange.toUpperCase();
    if (EXCLUDED_EXCHANGES.has(ex)) { excluded.push(e); continue; }
    const y = toYahoo(e.raw, e.exchange);
    if (!y) { unmapped.push(e); continue; }
    mapped.push(y);
  }
  const { tickers, dropped, duplicates } = normalizeEuropeTickers(mapped.join(','));
  fs.writeFileSync(path.join(__dirname, 'europe600.json'), JSON.stringify(tickers.slice().sort(), null, 2) + '\n');

  const bySuffix = {};
  for (const t of tickers) { const s = t.slice(t.lastIndexOf('.')); bySuffix[s] = (bySuffix[s] || 0) + 1; }
  console.log(`Holdings as of ${asOf}: ${equities.length} equity lines -> wrote ${tickers.length} tickers to scripts/europe600.json`);
  console.log('  by suffix:', JSON.stringify(bySuffix));
  if (excluded.length) console.log(`  excluded (no sourced rate bucket): ${excluded.length} -- ${excluded.map(e => e.raw).join(' ')}`);
  if (unmapped.length) console.log(`  ⚠ unmapped venue: ${unmapped.map(e => `${e.raw}[${e.exchange}]`).join(' ')}`);
  if (duplicates.length) console.log(`  duplicates collapsed: ${duplicates.join(' ')}`);
  if (dropped.length) console.log(`  ⚠ dropped by normalizer: ${dropped.join(' ')}`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { toYahoo, parseHoldings };
