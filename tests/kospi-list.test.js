const { test } = require('node:test');
const assert = require('node:assert');
const { parseKospi200Wikitext } = require('../scripts/lib/kospi-list.js');

const fixture = `Some preamble text.
==Components==
{| class="wikitable sortable" id="constituents"
|-
! Company !! Symbol !! [[GICS]] Sector
|-
| [[Samsung Electronics]] || 005930 || IT
|-
| Samsung Epis || 0126Z0 || Health Care
|-
| [[Amorepacific]] || 090430 || Consumer Staples
|}
==Statistics==
More text.`;

test('parses plain-digit codes into .KS tickers', () => {
  const tickers = parseKospi200Wikitext(fixture);
  assert.ok(tickers.includes('005930.KS'));
  assert.ok(tickers.includes('090430.KS'));
});

test('parses mixed alphanumeric codes (e.g. Samsung Epis Holdings)', () => {
  const tickers = parseKospi200Wikitext(fixture);
  assert.ok(tickers.includes('0126Z0.KS'));
});

test('returns exactly the rows in the fixture, in order', () => {
  assert.deepStrictEqual(parseKospi200Wikitext(fixture), ['005930.KS', '0126Z0.KS', '090430.KS']);
});

test('throws if no Components table is found', () => {
  assert.throws(() => parseKospi200Wikitext('no components here'), /Could not find/);
});
