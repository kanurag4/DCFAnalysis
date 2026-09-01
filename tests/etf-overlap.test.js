const { test } = require('node:test');
const assert = require('node:assert/strict');
const { weightOverlap, sistersFor } = require('../scripts/lib/etf/overlap.js');

test('identical holdings -> overlap 1', () => {
  const h = [{ yahoo: 'A', weight: 0.6 }, { yahoo: 'B', weight: 0.4 }];
  assert.equal(weightOverlap(h, h), 1);
});

test('no shared holdings -> overlap 0', () => {
  assert.equal(weightOverlap([{ yahoo: 'A', weight: 1 }], [{ yahoo: 'B', weight: 1 }]), 0);
});

test('overlap is sum of min(weight) over shared names', () => {
  const a = [{ yahoo: 'NVDA', weight: 0.2 }, { yahoo: 'AMD', weight: 0.1 }, { yahoo: 'X', weight: 0.7 }];
  const b = [{ yahoo: 'NVDA', weight: 0.15 }, { yahoo: 'AMD', weight: 0.2 }, { yahoo: 'Y', weight: 0.65 }];
  assert.ok(Math.abs(weightOverlap(a, b) - (0.15 + 0.1)) < 1e-9);
});

test('sistersFor returns funds >= threshold, sorted desc, capped', () => {
  const funds = [
    { slug: 'hack', holdings: [{ yahoo: 'A', weight: 1 }] },
    { slug: 'bug',  holdings: [{ yahoo: 'A', weight: 0.5 }, { yahoo: 'B', weight: 0.5 }] }, // overlap 0.5
    { slug: 'cibr', holdings: [{ yahoo: 'A', weight: 0.2 }, { yahoo: 'C', weight: 0.8 }] }, // overlap 0.2
  ];
  const s = sistersFor('hack', funds, { threshold: 0.30, cap: 5 });
  assert.deepEqual(s.map(x => x.slug), ['bug']);
});
