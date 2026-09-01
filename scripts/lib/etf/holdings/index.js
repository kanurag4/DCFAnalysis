// scripts/lib/etf/holdings/index.js — issuer adapter registry.
const betashares = require('./betashares.js');
const ishares = require('./ishares.js');

module.exports = { ADAPTERS: { betashares, ishares } };
