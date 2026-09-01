const { test } = require('node:test');
const assert = require('node:assert/strict');
const { evSalesFallback } = require('../scripts/lib/etf/growth-eval.js');

test('values a non-financial by sector EV/Sales × revenue', () => {
  const data = {
    sector: 'Technology', totalRevenue: 1_000_000_000, totalDebt: 0, totalCash: 200_000_000,
    dilutedSharesOutstanding: 100_000_000, price: 50,
  };
  const r = evSalesFallback(data);
  assert.equal(r.method, 'EV/Sales');
  assert.ok(Number.isFinite(r.intrinsic) && r.intrinsic > 0);
  assert.ok(Number.isFinite(r.marginOfSafety));
});

test('returns null without revenue or shares', () => {
  assert.equal(evSalesFallback({ sector: 'Technology', totalRevenue: null }), null);
  assert.equal(evSalesFallback({ sector: 'Technology', totalRevenue: 1e9, dilutedSharesOutstanding: null, sharesOutstanding: null }), null);
});
