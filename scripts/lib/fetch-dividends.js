// scripts/lib/fetch-dividends.js
// IO: fetch real ex-dividend events for a symbol over a date window via the
// Worker's /dividends endpoint, and return only the events in (fromISO, toISO].
// Best-effort: any failure yields [] so a rebalance never breaks on a missing
// dividend history. fetchImpl/sleepImpl are injectable for testing.

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const toUnix = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / 1000);

async function fetchDividends(symbol, fromISO, toISO, {
  proxyUrl, fetchImpl = fetch, retries = 0, backoffMs = 3000, sleepImpl = sleep,
} = {}) {
  const p1 = toUnix(fromISO);
  const p2 = toUnix(toISO);
  const url = `${proxyUrl.replace(/\/$/, '')}/dividends/${encodeURIComponent(symbol)}?period1=${p1}&period2=${p2}`;
  for (let attempt = 0; ; attempt++) {
    let events = null;
    try {
      const res = await fetchImpl(url);
      if (res && res.ok) {
        const body = await res.json();
        if (Array.isArray(body)) events = body;
      }
    } catch (_) { events = null; }

    if (events) {
      return events.filter(e =>
        e && typeof e.date === 'string' && typeof e.amount === 'number' &&
        e.date > fromISO && e.date <= toISO
      );
    }
    if (attempt >= retries) return [];
    await sleepImpl(backoffMs * (attempt + 1));
  }
}

module.exports = { fetchDividends };
