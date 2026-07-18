// scripts/lib/kospi-list.js
// Pure: parse the KOSPI 200 Wikipedia page's raw wikitext Components table into
// a list of .KS-suffixed Yahoo tickers. Most codes are 5-6 plain digits; a few
// (e.g. Samsung Epis Holdings, 0126Z0) mix in letters — both resolve on Yahoo.
function parseKospi200Wikitext(text) {
  const m = text.match(/==Components==\n\{\|[\s\S]*?\n([\s\S]*?)\n\|\}/);
  if (!m) throw new Error('Could not find a ==Components== wikitable in the fetched page.');
  const rows = m[1].split('|-');
  const codes = [];
  for (let row of rows) {
    row = row.trim();
    if (!row) continue;
    const cells = row.split('||').map((c) => c.trim());
    if (cells.length < 2) continue;
    const symbol = cells[1].trim();
    if (/^[0-9A-Z]{5,6}$/i.test(symbol)) codes.push(symbol);
  }
  return codes.map((code) => `${code}.KS`);
}

module.exports = { parseKospi200Wikitext };
