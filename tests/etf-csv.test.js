const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv } = require('../scripts/lib/etf/holdings/csv.js');

test('parses simple rows', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3\n'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('quoted fields with embedded commas', () => {
  assert.deepEqual(parseCsv('"x","1,234.50","y"\n'), [['x', '1,234.50', 'y']]);
});

test('escaped double-quotes', () => {
  assert.deepEqual(parseCsv('"a ""b"" c"\n'), [['a "b" c']]);
});

test('tolerates CRLF and a missing trailing newline', () => {
  assert.deepEqual(parseCsv('a,b\r\n1,2'), [['a', 'b'], ['1', '2']]);
});

test('blank line becomes an empty-string row', () => {
  assert.deepEqual(parseCsv('a\n\nb\n'), [['a'], [''], ['b']]);
});
