// scripts/lib/etf/resolve.js — DOM-free, network-free.
// Maps an issuer holdings row's raw identifier to the Yahoo Finance symbol
// scripts/fetch-yahoo.js expects. Deterministic: override map, then an already-
// suffixed symbol trusted as-is, then a Bloomberg exchange code / country ->
// suffix table with issuer-quirk normalisation, then give up (caller logs it;
// that weight counts as unvaluable). A name-based /search fallback is added by
// the orchestrator, not here, to keep this module network-free.

const COUNTRY_SUFFIX = {
  'United States': '', 'USA': '', 'US': '',
  'Australia': '.AX',
  'Japan': '.T',
  'South Korea': '.KS', 'Korea': '.KS', 'Korea, Republic Of': '.KS', 'Korea (South)': '.KS',
  'Hong Kong': '.HK',
  'China': '.SS', // ambiguous SS/SZ — a Bloomberg exchange code or an override pins Shenzhen
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
  'Singapore': '.SI', 'New Zealand': '.NZ',
  'Canada': '.TO',
  'Turkey': '.IS',
};

// Bloomberg composite exchange code — the token after the space in "300124 C2",
// "700 HK", "277810 KQ" — for the codes that pin a Yahoo suffix the issuer's
// Country column cannot: Shenzhen vs Shanghai, KOSDAQ vs KOSPI, and Hong Kong
// (whose numeric code Yahoo also wants zero-padded to 4 digits). A code that
// isn't here falls through to the Country -> suffix table.
const BBG_EXCH_SUFFIX = {
  HK: '.HK',
  C1: '.SS', CH: '.SS',   // Shanghai (Connect / native)
  C2: '.SZ', CS: '.SZ',   // Shenzhen (Connect / native)
  KP: '.KS', KS: '.KS',   // KOSPI
  KQ: '.KQ',              // KOSDAQ
  TI: '.IS',               // Istanbul
  IT: '.TA',               // Tel Aviv (not to be confused with Italy, which has no Bloomberg code collision here)
};

const KNOWN_SUFFIXES = new Set(Object.values(COUNTRY_SUFFIX).filter(Boolean).concat(
  ['.KQ', '.SZ', '.BO', '.NZ', '.TWO'],
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

  // "TICKER EXCH" (Bloomberg "PANW UW", "300124 C2") or "TICKER CLASS"
  // (iShares "NOVO B") or bare "TICKER".
  const [rawBase, secondTok = ''] = raw.split(/\s+/);
  const tok = secondTok.toUpperCase();

  // A lone trailing "A"/"B" token is a share class, not an exchange code.
  const shareClass = /^[AB]$/.test(tok) ? tok : '';

  // Suffix: a pinning Bloomberg exchange code beats the Country -> suffix table.
  let sfx = BBG_EXCH_SUFFIX[tok];
  if (sfx === undefined) {
    const country = (row.country || '').trim();
    if (!Object.prototype.hasOwnProperty.call(COUNTRY_SUFFIX, country)) return null;
    sfx = COUNTRY_SUFFIX[country];
  }

  // Normalise the ticker part.
  let base = rawBase
    .replace(/\.[A-Z]{2,4}$/i, '')   // dot-delimited Bloomberg exchange code ("PANW.UW", "HO.FP")
    .replace(/\.{2,}/g, '.')         // stray double dot
    .replace(/\.$/, '');             // trailing dot ("SN." -> "SN", so we don't build "SN..L")

  // Bloomberg "/" class separator: "AV/" -> "AV", "RCI/B" -> "RCI-B".
  if (base.includes('/')) {
    const [l, r] = base.split('/');
    base = r ? `${l}-${r.toUpperCase()}` : l;
  }

  // Hong Kong: Yahoo wants a 4-digit zero-padded code ("700" -> "0700").
  if (sfx === '.HK' && /^\d{1,4}$/.test(base)) base = base.padStart(4, '0');

  // US share class glued with a dot ("BRK.B" -> "BRK-B"). A class letter glued
  // with NO separator ("HEIA") is indistinguishable from a ticker that just ends
  // in A/B ("ZETA", "BETA") — those go through etf-symbol-overrides.json instead.
  if (sfx === '' && /\.[A-Za-z]$/.test(base)) {
    base = base.replace(/\.([A-Za-z])$/, (_, c) => `-${c.toUpperCase()}`);
  }

  if (shareClass) base = `${base}-${shareClass}`;         // iShares "NOVO B" -> "NOVO-B"

  return sfx ? `${base}${sfx}` : base;
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

module.exports = { resolveYahooSymbol, resolveHoldings, COUNTRY_SUFFIX, BBG_EXCH_SUFFIX };
