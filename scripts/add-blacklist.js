// scripts/add-blacklist.js
// CLI: node scripts/add-blacklist.js <market> <ticker1,ticker2,...> [reason]
// Called by refresh-screen.yml when dispatched with a non-empty `exclude` input
// (the admin console's "Exclude & re-run" action). See scripts/lib/blacklist.js
// for the testable implementation.
const { addToBlacklist } = require('./lib/blacklist.js');

const [market, tickersArg, reason] = process.argv.slice(2);
if (!market || !tickersArg) {
  console.error('Usage: node scripts/add-blacklist.js <market> <ticker1,ticker2,...> [reason]');
  process.exit(1);
}

const tickers = tickersArg.split(',').map((s) => s.trim()).filter(Boolean);
const { added } = addToBlacklist(market, tickers, reason ? { reason } : undefined);

if (added.length) {
  console.log(`Added to blacklist-${market}.json: ${added.join(', ')}`);
} else {
  console.log('No new tickers added (already present, or input was empty).');
}
