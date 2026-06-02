const { test } = require('node:test');
const assert = require('node:assert');
const { csvToTickers } = require('../scripts/lib/csv.js');

const csv = [
  'Code,Company,Sector',
  'BHP,BHP Group,Materials',
  'CBA,Commonwealth Bank,Financials',
  'bhp,Duplicate,Materials',       // dup (case-insensitive) — ignored
  ',Blank code,X',                 // blank — ignored
].join('\n');

test('extracts unique .AX tickers from a marketindex-style CSV', () => {
  assert.deepStrictEqual(csvToTickers(csv), ['BHP.AX', 'CBA.AX']);
});
