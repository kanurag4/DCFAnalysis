// scripts/lib/etf/holdings/index.js — issuer adapter registry.
const betashares = require('./betashares.js');
const ishares = require('./ishares.js');
const globalx = require('./globalx.js');

module.exports = { ADAPTERS: { betashares, ishares, globalx } };
