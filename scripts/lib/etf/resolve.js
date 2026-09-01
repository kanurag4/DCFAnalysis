// scripts/lib/etf/resolve.js — DOM-free, network-free.
// Maps an issuer holdings row's raw identifier to the Yahoo Finance symbol
// scripts/fetch-yahoo.js expects. Deterministic: country/exchange -> suffix
// table, then a manual override file, then give up (caller logs it; that
// weight counts as unvaluable). A name-based /search fallback is added by the
// orchestrator, not here, to keep this module network-free.

const COUNTRY_SUFFIX = {
  'United States': '', 'USA': '', 'US': '',
  'Australia': '.AX',
  'Japan': '.T',
  'South Korea': '.KS', 'Korea': '.KS', 'Korea, Republic Of': '.KS', 'Korea (South)': '.KS',
  'Hong Kong': '.HK',
  'China': '.SS', // ambiguous SS/SZ — rely on override for the exceptions
  'Taiwan': '.TW',
  'Israel': '.TA',
  'India': '.NS',
  'Brazil': '.SA', 'Malaysia': '.KL', 'Indonesia': '.JK', 'Thailand': '.BK',
  'Mexico': '.MX', 'South Africa': '.JO', 'Poland': '.WA',
  'United Kingdom': '.L', 'UK': '.L', 'Britain': '.L',
  'Germany': '.DE', 'France': '.PA', 'Netherlands': '.AS', 'Italy': '.MI',
  'Spain': '.MC', 'Belgium': '.BR', 'Portugal': '.LS', 'Austria': '.VI',
  'Finland': '.HE', 'Ireland': '.IR',
  'Switzerland': '.SW', 'Sweden': '.ST', 'Norway': '.OL', 'Denmark': '.CO',
  'Singapore': '.SI',
  'Canada': '.TO',
};

const KNOWN_SUFFIXES = new Set(Object.values(COUNTRY_SUFFIX).filter(Boolean).concat(
  ['.KQ', '.SZ', '.BO', '.NZ'],
));

function hasKnownSuffix(sym) {
  const dot = sym.lastIndexOf('.');
  return dot > 0 && KNOWN_SUFFIXES.has(sym.slice(dot).toUpperCase());
}

function resolveYahooSymbol(row, overrides = {}, issuer) {
  const raw = String(row.rawSymbol || '').trim();
  if (!raw) return null;

  const scoped = issuer ? overrides[`${issuer}:${raw}`] : undefined;
  if (scoped) return scoped;
  if (overrides[raw]) return overrides[raw];

  if (hasKnownSuffix(raw)) return raw;                     // issuer already gave a Yahoo-style symbol

  const country = (row.country || '').trim();
  if (Object.prototype.hasOwnProperty.call(COUNTRY_SUFFIX, country)) {
    const sfx = COUNTRY_SUFFIX[country];
    // Drop the exchange token from a Bloomberg-style identifier ("PANW UW",
    // "6861 JP", "HO.FP"). Only strip a *2+*-letter trailing ".XX" — a single
    // trailing ".A"/".B" is a US share class (BRK.B, BF.B), not an exchange
    // code, and Yahoo wants that as "BRK-B". Leave anything else for the
    // name-search fallback / override map.
    let base = raw.split(/\s+/)[0].replace(/\.[A-Z]{2,4}$/i, '');
    if (sfx === '' && /\.[A-Za-z]$/.test(base)) base = base.replace(/\.([A-Za-z])$/, '-$1');
    return sfx ? `${base}${sfx}` : base;
  }
  return null;
}

function resolveHoldings(rows, { issuer, overrides = {} } = {}) {
  const resolved = [], unresolved = [];
  for (const row of rows) {
    const yahoo = resolveYahooSymbol(row, overrides, issuer);
    if (yahoo) resolved.push({ ...row, yahoo });
    else unresolved.push(row);
  }
  return { resolved, unresolved };
}

module.exports = { resolveYahooSymbol, resolveHoldings, COUNTRY_SUFFIX };
