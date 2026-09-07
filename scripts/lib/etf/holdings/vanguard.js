// scripts/lib/etf/holdings/vanguard.js — Vanguard Australia full-holdings JSON adapter.
// Unlike every other issuer here, Vanguard's fund site exposes a clean JSON data
// API behind the "Holdings" tab
// (https://www.vanguard.com.au/personal/api/data/products/holdings/<portId>) —
// no CSV/XLSX to parse at all. Captured 2026-09-07 onboarding VTEK: `limit`
// above ~300 doesn't return every line (327 total holdings, 298 returned even
// at limit=1000), but the missing tail is under 1% of fund weight (99.28%
// covered on VTEK) — well within the resolve threshold, so no pagination
// (there's a `lastItemKey` cursor field, always null on this fund) was built.
const https = require('node:https');

// Vanguard's countryCode is ISO alpha-2, not the country-name strings
// resolve.js's COUNTRY_SUFFIX table keys on — translate here rather than
// touching that shared table's key format for one issuer. Saudi Arabia (SA)
// deliberately has no entry: resolve.js has no Yahoo suffix for it either, so
// those rows fall through to unresolved, same as any other issuer's holdings
// in a market this project doesn't cover yet.
const ISO2_COUNTRY = {
  US: 'United States', AU: 'Australia', JP: 'Japan', KR: 'South Korea',
  HK: 'Hong Kong', TW: 'Taiwan', IN: 'India', IL: 'Israel', GB: 'United Kingdom',
  DE: 'Germany', FR: 'France', NL: 'Netherlands', IT: 'Italy', ES: 'Spain',
  SE: 'Sweden', NO: 'Norway', CH: 'Switzerland', CA: 'Canada', BR: 'Brazil',
  SG: 'Singapore', TH: 'Thailand', ZA: 'South Africa',
};

function holdingsUrl(fund) {
  const portId = String(fund.issuerFundId || '').trim();
  return `https://www.vanguard.com.au/personal/api/data/products/holdings/${portId}?limit=1000`;
}

function httpGetReal(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kashvector-etf-radar/1.0)', Accept: 'application/json' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`vanguard ${res.statusCode} ${url}`)); }
      let d = ''; res.setEncoding('utf8');
      res.on('data', (c) => { d += c; }); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

// Mainland China A-shares split across two exchanges with no separate column
// in this feed — disambiguate by numeric ticker prefix (Shenzhen: 00/30,
// Shanghai: 60/68/90) and encode it as a Bloomberg-style "TICKER C1"/"TICKER
// C2" composite so resolve.js's existing BBG_EXCH_SUFFIX table (built for
// exactly this ambiguity) resolves it correctly, without a second China
// special-case living in resolve.js itself.
function cnRawSymbol(ticker) {
  if (/^(00|30)\d{4}$/.test(ticker)) return `${ticker} C2`; // Shenzhen
  if (/^(60|68|90)\d{4}$/.test(ticker)) return `${ticker} C1`; // Shanghai
  return ticker;
}

function parse(jsonText) {
  const body = typeof jsonText === 'string' ? JSON.parse(jsonText) : jsonText;
  const items = (body && body.data && body.data.items) || [];
  let asOf = null;
  const out = [];
  for (const it of items) {
    const weight = it.marketValPercent;
    if (!Number.isFinite(weight) || weight <= 0) continue;
    const ticker = String(it.ticker || '').trim();
    if (!ticker) continue;
    if (!asOf && it.effectiveDate) asOf = it.effectiveDate; // already ISO (yyyy-mm-dd)
    const countryCode = String(it.countryCode || '').trim().toUpperCase();
    const rawSymbol = countryCode === 'CN' ? cnRawSymbol(ticker) : ticker;
    out.push({
      rawSymbol,
      name: (it.longName || it.name || '').trim(),
      weight: weight / 100,
      sector: it.sectorName || null,
      country: ISO2_COUNTRY[countryCode] || countryCode,
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

module.exports = { issuer: 'vanguard', holdingsUrl, parse, fetchHoldings };
