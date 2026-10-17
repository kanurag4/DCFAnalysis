// scripts/lib/etf/holdings/globalx.js — Global X full-holdings CSV adapter.
// The holdings CSV filename is date-stamped (e.g. shld_full-holdings_20260902.csv)
// and changes every time the issuer refreshes it, so the URL can't be built from
// a fixed template the way BetaShares'/iShares' can -- it's discovered by
// fetching the fund's own page and regex-extracting the current asset link.
// Real download URL + column layout captured 2026-09-03 from SHLD's fund page.
const https = require('node:https');
const { parseCsv } = require('./csv.js');
// Global X's CSV uses the same Bloomberg "TICKER EXCH" convention BetaShares'
// does ("ASELS TI", "272210 KS") -- reuse its exchange-code -> country map
// rather than duplicating it.
const { BBG_COUNTRY } = require('./betashares.js');

const CSV_LINK_RE = /https:\/\/assets\.globalxetfs\.com\/funds\/holdings\/[^"'\\ ]*\.csv/;

function fundPageUrl(fund) {
  return `https://www.globalxetfs.com/funds/${fund.slug}/`;
}

function httpGetReal(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; kashvector-etf-radar/1.0)' } }, (res) => {
      // The fund page 30x-redirects once (http -> https / trailing-slash
      // canonicalisation) -- follow a single hop rather than failing on it.
      if ([301, 302, 307, 308].includes(res.statusCode)) {
        res.resume();
        if (!res.headers.location) return reject(new Error(`globalx redirect with no location: ${url}`));
        return resolve(httpGetReal(new URL(res.headers.location, url).toString()));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`globalx ${res.statusCode} ${url}`)); }
      let d = ''; res.setEncoding('utf8');
      res.on('data', c => { d += c; }); res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

function parse(csvText) {
  const rows = parseCsv(csvText);
  // Row 0: fund name. Row 1: "Fund Holdings Data as of MM/DD/YYYY". Row 2: header.
  let asOf = null, headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const m = r[0] && /as of (\d{2})\/(\d{2})\/(\d{4})/i.exec(r[0]);
    if (m) asOf = `${m[3]}-${m[1]}-${m[2]}`;
    if (r[1] && r[1].trim().toLowerCase() === 'ticker') { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('globalx: holdings header row not found');
  const header = rows[headerIdx].map(h => h.trim().toLowerCase());
  const iWeight = header.indexOf('% of net assets');
  const iTicker = header.indexOf('ticker');
  const iName = header.indexOf('name');

  const out = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 3) continue; // trailing disclaimer line etc. -- no ticker column at all
    const rawSymbol = (r[iTicker] || '').trim();
    if (!rawSymbol) continue; // cash/other non-equity lines
    const weight = parseFloat(String(r[iWeight] || '').replace(/[,%\s]/g, ''));
    if (!Number.isFinite(weight)) continue;
    // No "Country" column in this file at all (unlike BetaShares'), so a bare
    // ticker with no Bloomberg exchange code has no explicit signal -- default
    // it to United States, which is this issuer's convention (a non-US line
    // always carries a "TICKER EXCH" suffix; a bare ticker never does).
    const bbg = rawSymbol.split(/\s+/)[1];
    out.push({
      rawSymbol,
      name: (r[iName] || '').trim(),
      weight: weight / 100,
      sector: null, // not present in this file's columns
      country: bbg ? (BBG_COUNTRY[bbg.toUpperCase()] || null) : 'United States',
    });
  }
  return { asOf, rows: out };
}

const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

// Global X's fund pages moved to Next.js (seen 2026-10-17): the static
// assets.globalxetfs.com CSV link is gone -- "Download Full CSV" now builds the
// file client-side via a server action. The full holdings list is still
// embedded in the page's React Server Components payload (the
// self.__next_f.push([1,"..."]) string chunks), one JSON object per holding
// with the same "TICKER EXCH" ticker convention as the old CSV.
function parsePage(html) {
  const chunks = [];
  const pushRe = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  let m;
  while ((m = pushRe.exec(html))) chunks.push(JSON.parse(m[1]));
  const flight = chunks.join('');

  const asOfM = /"As of"," ","([A-Za-z]{3}) (\d{1,2}), (\d{4})"/.exec(flight);
  const asOf = asOfM && MONTHS[asOfM[1].toLowerCase()]
    ? `${asOfM[3]}-${MONTHS[asOfM[1].toLowerCase()]}-${asOfM[2].padStart(2, '0')}`
    : null;

  // The same holding can appear in both the top-10 table and the "All Holdings"
  // dialog -- key on ticker+name+shares so each line is counted once.
  const seen = new Set();
  const out = [];
  for (const s of flight.match(/\{"exposurePercent":"[^"]*"[^{}]*\}/g) || []) {
    let h;
    try { h = JSON.parse(s); } catch { continue; }
    const rawSymbol = (h.ticker || '').trim();
    if (!rawSymbol) continue; // currency / cash lines carry no ticker
    const key = `${rawSymbol}|${h.name}|${h.shares}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const weight = parseFloat(String(h.netAssets || '').replace(/[,%\s]/g, ''));
    if (!Number.isFinite(weight)) continue;
    const bbg = rawSymbol.split(/\s+/)[1];
    out.push({
      rawSymbol,
      name: (h.name || '').trim(),
      weight: weight / 100,
      sector: null,
      country: bbg ? (BBG_COUNTRY[bbg.toUpperCase()] || null) : 'United States',
    });
  }
  return { asOf, rows: out };
}

async function fetchHoldings(fund, { httpGet = httpGetReal } = {}) {
  const pageHtml = await httpGet(fundPageUrl(fund));
  const m = CSV_LINK_RE.exec(pageHtml);
  if (m) {
    const csvUrl = m[0];
    const text = await httpGet(csvUrl);
    const { asOf, rows } = parse(text);
    return { asOf, source: csvUrl, rows };
  }
  const { asOf, rows } = parsePage(pageHtml);
  if (rows.length === 0) throw new Error(`globalx: no holdings CSV link or embedded holdings on ${fundPageUrl(fund)}`);
  return { asOf, source: fundPageUrl(fund), rows };
}

module.exports = { issuer: 'globalx', fundPageUrl, parse, parsePage, fetchHoldings };
