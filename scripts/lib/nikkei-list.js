// scripts/lib/nikkei-list.js
// Pure: parse the Nikkei 225 Wikipedia page's raw wikitext Components section into
// a list of .T-suffixed Yahoo tickers. Unlike KOSPI 200's single wikitable, the
// Nikkei components are a sector-grouped bulleted list (===Sector=== headings with
// *[[Company]] ({{tyo2|CODE}}) bullets), so we scope to the ==Components== section
// (the code template also appears in the article prose) and extract the {{tyo2|...}}
// templates. Codes are 4 chars — historically all digits, but TSE now issues
// alphanumeric codes too (e.g. Archion, 543A); both resolve on Yahoo.
function parseNikkei225Wikitext(text) {
  const m = text.match(/==Components==\n([\s\S]*?)(?:\n==[^=]|$)/);
  if (!m) throw new Error('Could not find a ==Components== section in the fetched page.');
  const codes = [];
  const re = /\{\{tyo2?\|([0-9A-Z]{4})\}\}/gi;
  let match;
  while ((match = re.exec(m[1])) !== null) codes.push(match[1].toUpperCase());
  return codes.map((code) => `${code}.T`);
}

module.exports = { parseNikkei225Wikitext };
