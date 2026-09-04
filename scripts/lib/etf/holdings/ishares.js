// scripts/lib/etf/holdings/ishares.js — iShares full-holdings CSV adapter.
// One adapter covers every iShares fund (consistent CSV format). Real URL +
// layout captured 2026-09-01 from SOXX.
const https = require('node:https');
const { parseCsv } = require('./csv.js');

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function toIsoDate(s) {
  const str = String(s || '').trim();
  const usFormat = str.match(/([A-Za-z]{3})[a-z]*\s+(\d{1,2}),\s*(\d{4})/); // "Aug 28, 2026" (US site)
  if (usFormat) {
    const mo = MONTHS[usFormat[1].toLowerCase()];
    if (mo) return `${usFormat[3]}-${String(mo).padStart(2, '0')}-${usFormat[2].padStart(2, '0')}`;
  }
  const auFormat = str.match(/(\d{1,2})-([A-Za-z]{3})[a-z]*-(\d{4})/); // "03-Sept-2026" (AU/blackrock.com site)
  if (auFormat) {
    const mo = MONTHS[auFormat[2].toLowerCase()];
    if (mo) return `${auFormat[3]}-${String(mo).padStart(2, '0')}-${auFormat[1].padStart(2, '0')}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(str) ? str : null;
}

// iShares "Location" is issuer domicile; "Exchange" is where the held line
// trades. A US exchange means the Ticker column IS the US symbol (often an ADR),
// so resolve it as a US ticker regardless of the company's domicile. Same for
// Hong Kong: a mainland-China company listed as an H-share on HKEX (Location =
// "China") needs Yahoo's .HK suffix, not the mainland .SS/.SZ Location implies —
// found onboarding IAA (iShares Asia 50), whose ~20 H-share holdings (Tencent,
// Alibaba, the big state banks, etc.) all carry Location "China".
const US_EXCHANGES = new Set([
  'NASDAQ', 'NEW YORK STOCK EXCHANGE INC.', 'NYSE', 'NYSE ARCA', 'CBOE',
  'BATS', 'BATS EXCHANGE', 'NYSE MKT LLC', 'NASDAQ OMX', 'NYSE AMERICAN', 'CBOE BZX',
]);
const HK_EXCHANGES = new Set(['HONG KONG EXCHANGES AND CLEARING LTD']);

function holdingsUrl(fund) {
  // AU-domiciled iShares funds are hosted on blackrock.com/au, not ishares.com,
  // and the download path has a per-fund document hash with no derivable
  // pattern — fund.json carries the full URL for these instead of a template.
  if (fund.holdingsUrlOverride) return fund.holdingsUrlOverride;
  const fid = String(fund.issuerFundId || '').replace(/^\/+|\/+$/g, '');
  const region = fund.issuerRegion || 'us';
  return `https://www.ishares.com/${region}/products/${fid}/latest-holdings.csv`;
}

function httpGetReal(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kashvector-etf-radar/1.0)' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`ishares ${res.statusCode} ${url}`)); }
      let d = ''; res.setEncoding('utf8');
      res.on('data', c => { d += c; }); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function parse(csvText) {
  const rows = parseCsv(csvText);
  let asOf = null, headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r[0] && /fund holdings as of/i.test(r[0]) && r[1]) asOf = toIsoDate(r[1]);
    if (r[0] && r[0].trim().toLowerCase() === 'ticker' && r.some(c => /asset class/i.test(c))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('ishares: holdings header row not found');
  const header = rows[headerIdx].map(h => h.trim().toLowerCase());
  const iTicker = header.indexOf('ticker');
  const iName = header.indexOf('name');
  const iSector = header.indexOf('sector');
  const iClass = header.indexOf('asset class');
  const iWeight = header.findIndex(h => h.startsWith('weight'));
  const iLocation = header.indexOf('location');
  const iExchange = header.indexOf('exchange');
  const iCurrency = header.indexOf('currency');

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < header.length) continue;
    if ((r[iClass] || '').trim().toLowerCase() !== 'equity') continue;
    const rawSymbol = (r[iTicker] || '').trim();
    if (!rawSymbol || rawSymbol === '-') continue;
    const weight = parseFloat(String(r[iWeight] || '').replace(/[,%\s]/g, ''));
    if (!Number.isFinite(weight)) continue;
    const exch = (r[iExchange] || '').trim().toUpperCase();
    let country;
    if (US_EXCHANGES.has(exch)) country = 'United States';
    else if (HK_EXCHANGES.has(exch)) country = 'Hong Kong';
    else country = (r[iLocation] || '').trim();
    out.push({
      rawSymbol,
      name: (r[iName] || '').trim(),
      weight: weight / 100,
      sector: iSector >= 0 ? (r[iSector] || '').trim() : null,
      country,
      currency: (r[iCurrency] || '').trim(),
    });
  }
  return { asOf, rows: out };
}

async function fetchHoldings(fund, { httpGet = httpGetReal } = {}) {
  const url = holdingsUrl(fund);
  const text = await httpGet(url);
  const { asOf, rows } = parse(text);
  return { asOf, source: url, rows };
}

module.exports = { issuer: 'ishares', holdingsUrl, parse, fetchHoldings, toIsoDate };
