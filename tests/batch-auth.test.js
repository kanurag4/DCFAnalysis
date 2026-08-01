const { test } = require('node:test');
const assert = require('node:assert');
const { batchHeaders } = require('../scripts/lib/batch-auth.js');

test('batchHeaders returns the X-KV-Batch-Key header when KV_BATCH_KEY is set', () => {
  const prev = process.env.KV_BATCH_KEY;
  process.env.KV_BATCH_KEY = 'test-secret';
  try {
    assert.deepStrictEqual(batchHeaders(), { 'X-KV-Batch-Key': 'test-secret' });
  } finally {
    if (prev === undefined) delete process.env.KV_BATCH_KEY; else process.env.KV_BATCH_KEY = prev;
  }
});

test('batchHeaders returns {} when KV_BATCH_KEY is unset', () => {
  const prev = process.env.KV_BATCH_KEY;
  delete process.env.KV_BATCH_KEY;
  try {
    assert.deepStrictEqual(batchHeaders(), {});
  } finally {
    if (prev !== undefined) process.env.KV_BATCH_KEY = prev;
  }
});
