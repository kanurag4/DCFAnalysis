// www/dcf/calc/fiscalYearAlign.js — joins several {date, value}[] history
// series by exact fiscal-year date into one row per date, most-recent-first.
// Pure: no DOM, no network. Shared by Solvency Check's two Phase-1
// consumers (www/evaluate/app.js, DCFAnalysis/scripts/lib/ticker-page.js) so
// the join logic exists once, not twice -- same "paired by date via a Map,
// not array position" convention calc/cyclicalNormalization.js already
// established, since Yahoo's per-series /timeseries arrays aren't
// guaranteed to share length or have entries for identical dates.

// Latest 4 fiscal years only -- same window as utils.js's HISTORY_WINDOW_YEARS (own name: these files share
// one browser global scope). Our market-data store can hold more years than Yahoo's 4.
const FY_ALIGN_YEARS = 4;

function alignFiscalYears(seriesMap) {
  const names = Object.keys(seriesMap || {});
  const byName = {};
  const dateSet = new Set();
  for (const name of names) {
    const series = Array.isArray(seriesMap[name]) ? seriesMap[name] : [];
    const map = new Map();
    for (const entry of series) {
      if (!entry || !entry.date) continue;
      const v = entry.value;
      map.set(entry.date, (v != null && isFinite(v)) ? v : null);
      dateSet.add(entry.date);
    }
    byName[name] = map;
  }

  const dates = [...dateSet].sort().reverse().slice(0, FY_ALIGN_YEARS); // most recent first
  return dates.map(date => {
    const row = { date };
    for (const name of names) {
      const v = byName[name].get(date);
      row[name] = (v !== undefined) ? v : null;
    }
    return row;
  });
}

if (typeof module !== 'undefined') module.exports = { alignFiscalYears, FY_ALIGN_YEARS };
