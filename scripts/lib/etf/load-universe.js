// scripts/lib/etf/load-universe.js — pure (fs read only).
const fs = require('node:fs');
const { ADAPTERS } = require('./holdings/index.js');

const REQUIRED_FIELDS = ['slug', 'name', 'theme', 'listings', 'issuer', 'issuerFundId', 'fee', 'assetClass'];

function loadUniverse(jsonPath, injected) {
  const funds = injected || JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const seen = new Set();
  for (const f of funds) {
    for (const k of REQUIRED_FIELDS) {
      if (f[k] == null) throw new Error(`etfs.json: ${f.slug || '?'} missing required field "${k}"`);
    }
    if (!Array.isArray(f.listings) || !f.listings.length) throw new Error(`etfs.json: ${f.slug} has no listings`);
    if (seen.has(f.slug)) throw new Error(`etfs.json: duplicate slug "${f.slug}"`);
    seen.add(f.slug);
    if (!ADAPTERS[f.issuer]) throw new Error(`etfs.json: ${f.slug} has unknown issuer "${f.issuer}" (no adapter)`);
  }
  return funds;
}

module.exports = { loadUniverse, REQUIRED_FIELDS };
