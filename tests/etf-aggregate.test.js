const { test } = require('node:test');
const assert = require('node:assert/strict');
const { aggregateFund, detectCrypto } = require('../scripts/lib/etf/aggregate.js');

const V = {
  A: { mos: -0.40, method: 'DCF' },
  B: { mos: 0.20, method: 'DCF' },
  C: { unvaluable: true },
};

test('weighted look-through MoS over valued holdings only', () => {
  const holdings = [{ yahoo: 'A', weight: 0.5 }, { yahoo: 'B', weight: 0.3 }, { yahoo: 'C', weight: 0.2 }];
  const r = aggregateFund(holdings, V, { coverageGate: 0.70 });
  // valued weight 0.8; (0.5*-0.4 + 0.3*0.2)/0.8 = (-0.2 + 0.06)/0.8 = -0.175
  assert.ok(Math.abs(r.lookThroughMos - (-0.175)) < 1e-9);
  assert.ok(Math.abs(r.coverage - 0.8) < 1e-9);
  assert.equal(r.ranked, true);
});

test('below 70% coverage -> ranked false, lookThroughMos still computed for display', () => {
  const holdings = [{ yahoo: 'A', weight: 0.3 }, { yahoo: 'C', weight: 0.7 }];
  const r = aggregateFund(holdings, V, { coverageGate: 0.70 });
  assert.equal(r.ranked, false);
  assert.ok(r.lookThroughMos != null);
});

test('cheapest / priciest picked from valued set', () => {
  const holdings = [{ yahoo: 'A', weight: 0.5 }, { yahoo: 'B', weight: 0.5 }];
  const r = aggregateFund(holdings, V, {});
  assert.equal(r.priciest.yahoo, 'A'); // most negative mos = biggest premium
  assert.equal(r.cheapest.yahoo, 'B');
});

test('detectCrypto true when > 30% weight is CRYPTO quoteType', () => {
  const holdings = [{ yahoo: 'BTC', weight: 0.5 }, { yahoo: 'A', weight: 0.5 }];
  assert.equal(detectCrypto(holdings, { BTC: { quoteType: 'CRYPTO' }, A: { mos: 0.1 } }, {}), true);
});

test('70% gate boundary — 0.699 is not ranked, 0.70 is', () => {
  const h699 = [{ yahoo: 'A', weight: 0.699 }, { yahoo: 'C', weight: 0.301 }];
  const h70 = [{ yahoo: 'A', weight: 0.70 }, { yahoo: 'C', weight: 0.30 }];
  assert.equal(aggregateFund(h699, V, { coverageGate: 0.70 }).ranked, false);
  assert.equal(aggregateFund(h70, V, { coverageGate: 0.70 }).ranked, true);
});
