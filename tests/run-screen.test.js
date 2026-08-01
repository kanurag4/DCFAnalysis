const { test } = require('node:test');
const assert = require('node:assert');
const { readProxyUrl } = require('../scripts/lib/run-screen.js');

test('readProxyUrl prefers YAHOO_PROXY_URL env var over www/config.js', () => {
  const prev = process.env.YAHOO_PROXY_URL;
  process.env.YAHOO_PROXY_URL = 'https://env-override.example/';
  try {
    assert.strictEqual(readProxyUrl(), 'https://env-override.example/');
  } finally {
    if (prev === undefined) delete process.env.YAHOO_PROXY_URL; else process.env.YAHOO_PROXY_URL = prev;
  }
});

test('readProxyUrl falls back to parsing www/config.js when the env var is unset', () => {
  const prev = process.env.YAHOO_PROXY_URL;
  delete process.env.YAHOO_PROXY_URL;
  try {
    assert.strictEqual(readProxyUrl(), 'https://stock-evaluator.anurag-kor.workers.dev');
  } finally {
    if (prev !== undefined) process.env.YAHOO_PROXY_URL = prev;
  }
});
