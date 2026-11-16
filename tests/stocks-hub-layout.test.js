// /dcf/stocks/ hub: the market tiles must sit inside .screens-row-pills. Since the 2026-11-14 "flatter market
// cards" change, style.css puts display:flex on .screens-row-pills, not .screens-row, so tiles placed directly
// in .screens-row stacked vertically (found live 2026-11-16).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('stocks hub wraps every market tile in .screens-row-pills (the flex container in style.css)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'stocks', 'index.html'), 'utf8');
  const row = html.match(/<div class="screens-row">([\s\S]*?)<\/section>/);
  assert.ok(row, 'hub has a .screens-row');
  assert.match(row[1], /^<div class="screens-row-pills">/, '.screens-row must open with the .screens-row-pills wrapper');
  const pills = (row[1].match(/class="screen-pill"/g) || []).length;
  assert.ok(pills >= 1, 'at least one market tile');
});

test('style.css still makes .screens-row-pills the horizontal flex row', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'www', 'style.css'), 'utf8');
  assert.match(css, /\.screens-row-pills\s*\{[^}]*display:\s*flex/);
});
