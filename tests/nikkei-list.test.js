const { test } = require('node:test');
const assert = require('node:assert');
const { parseNikkei225Wikitext } = require('../scripts/lib/nikkei-list.js');

const fixture = `Some preamble mentioning [[Tokyo Electron]] ({{tyo2|8035}}) in prose.
==Components==
{{Pie chart
|value1 = 0.3
}}
Intro sentence about the components.
===Air transport===
*[[All Nippon Airways|ANA Holdings]] Inc. ({{tyo2|9202}})
*[[Japan Airlines]] Co., Ltd. ({{tyo2|9201}})
===Automotive===
*[[Archion]] Corp. ({{tyo2|543A}})
*'''[[Toyota|Toyota Motor]] Corp.''' ({{tyo2|7203}})
==Statistics==
More text mentioning {{tyo2|9999}} after the section.`;

test('parses digit codes into .T tickers', () => {
  const tickers = parseNikkei225Wikitext(fixture);
  assert.ok(tickers.includes('9202.T'));
  assert.ok(tickers.includes('9201.T'));
});

test('parses new alphanumeric TSE codes (e.g. Archion 543A)', () => {
  const tickers = parseNikkei225Wikitext(fixture);
  assert.ok(tickers.includes('543A.T'));
});

test('parses bold (top-10 market cap) entries', () => {
  const tickers = parseNikkei225Wikitext(fixture);
  assert.ok(tickers.includes('7203.T'));
});

test('ignores tyo2 templates outside the Components section (prose + later sections)', () => {
  const tickers = parseNikkei225Wikitext(fixture);
  assert.ok(!tickers.includes('8035.T'));
  assert.ok(!tickers.includes('9999.T'));
});

test('returns exactly the components in the fixture, in order', () => {
  assert.deepStrictEqual(parseNikkei225Wikitext(fixture), ['9202.T', '9201.T', '543A.T', '7203.T']);
});

test('throws if no Components section is found', () => {
  assert.throws(() => parseNikkei225Wikitext('no components here'), /Could not find/);
});
