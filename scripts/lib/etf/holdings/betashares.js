// scripts/lib/etf/holdings/betashares.js — BetaShares full-holdings CSV adapter.
// Real download URL + column layout captured 2026-09-01 from HACK's fund page.
const https = require('node:https');
const { parseCsv } = require('./csv.js');

// Bloomberg composite exchange code (the token after the space in "PANW UW")
// -> a country string resolve.js's COUNTRY_SUFFIX understands. The code says
// where the line actually TRADES, which beats the file's "Country" column
// (issuer domicile) for Yahoo-symbol resolution: "CHKP UW" is the US-listed
// line of an Israel-domiciled company — Yahoo wants "CHKP", not "CHKP.TA".
const BBG_COUNTRY = {
  UW: 'United States', UN: 'United States', UQ: 'United States', UR: 'United States',
  UP: 'United States', UF: 'United States', UV: 'United States', US: 'United States',
  AU: 'Australia', CT: 'Canada', CN: 'Canada',
  LN: 'United Kingdom', FP: 'France', GY: 'Germany', GR: 'Germany', NA: 'Netherlands',
  IM: 'Italy', SM: 'Spain', SQ: 'Spain', BB: 'Belgium', PL: 'Portugal', AV: 'Austria',
  FH: 'Finland', ID: 'Ireland', SW: 'Switzerland', VX: 'Switzerland',
  SS: 'Sweden', NO: 'Norway', DC: 'Denmark',
  JT: 'Japan', JP: 'Japan', HK: 'Hong Kong', TT: 'Taiwan', KS: 'South Korea',
  KP: 'South Korea', IN: 'India', IS: 'India', SP: 'Singapore', NZ: 'New Zealand',
};

function holdingsUrl(fund) {
  const code = String((fund.listings && fund.listings[0] && fund.listings[0].ticker) || fund.slug || '')
    .replace(/\.AX$/i, '').toUpperCase();
  return `https://www.betashares.com.au/files/csv/${code}_Portfolio_Holdings.csv`;
}

function httpGetReal(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kashvector-etf-radar/1.0)' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`betashares ${res.statusCode} ${url}`)); }
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
    if (r[0] && /^date$/i.test(r[0].trim()) && r[1]) asOf = r[1].trim();
    if (r[0] && r[0].trim().toLowerCase() === 'ticker' && r.some(c => /weight/i.test(c))) { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('betashares: holdings header row not found');
  const header = rows[headerIdx].map(h => h.trim().toLowerCase());
  const iTicker = header.indexOf('ticker');
  const iName = header.indexOf('name');
  const iClass = header.indexOf('asset class');
  const iCountry = header.indexOf('country');
  const iCurrency = header.indexOf('currency');
  const iWeight = header.findIndex(h => h.startsWith('weight'));

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < header.length) continue;
    const assetClass = (r[iClass] || '').trim().toLowerCase();
    if (assetClass !== 'equities' && assetClass !== 'equity') continue;
    const rawSymbol = (r[iTicker] || '').trim();
    if (!rawSymbol) continue;
    const weight = parseFloat(String(r[iWeight] || '').replace(/[,%\s]/g, ''));
    if (!Number.isFinite(weight)) continue;
    const bbg = rawSymbol.split(/\s+/)[1];
    out.push({
      rawSymbol,
      name: (r[iName] || '').trim(),
      weight: weight / 100,
      country: (bbg && BBG_COUNTRY[bbg.toUpperCase()]) || (r[iCountry] || '').trim(),
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

module.exports = { issuer: 'betashares', holdingsUrl, parse, fetchHoldings, BBG_COUNTRY };
