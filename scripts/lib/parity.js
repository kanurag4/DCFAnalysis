// Pure helpers for the data-parity job (scripts/data-parity.js): compare a ticker valued from the own
// market-data store (staging Worker) with the same ticker valued from Yahoo (production Worker).
// Pass bar (spec docs/superpowers/specs/2026-10-25-own-market-data-store-design.md in StockAnalysis): same
// valuation model, Base value per share within 0.5%, same solvency readings, the store actually answered, and
// its stored prices agree with Yahoo's (newer Yahoo bars are fine). Other input differences are evidence only.

const BASE_TOLERANCE_PCT = 0.5;
const HISTORY_DIFF_CAP = 5;

function closeEnough(a, b, relTol) {
  if (a === b) return true;
  return Math.abs(a - b) <= relTol * Math.max(Math.abs(a), Math.abs(b));
}

function isObj(v) {
  return v !== null && typeof v === 'object';
}

// Deep field-by-field difference; numbers compared with a relative tolerance, arrays by index.
function diffInputs(yahoo, other, { relTol = 0.005 } = {}, prefix = '', out = []) {
  if (typeof yahoo === 'number' && typeof other === 'number') {
    if (!closeEnough(yahoo, other, relTol)) out.push({ field: prefix, yahoo, other });
    return out;
  }
  if (Array.isArray(yahoo) && Array.isArray(other)) {
    const n = Math.max(yahoo.length, other.length);
    for (let i = 0; i < n; i++) diffInputs(yahoo[i], other[i], { relTol }, `${prefix}[${i}]`, out);
    return out;
  }
  if (isObj(yahoo) && isObj(other) && !Array.isArray(yahoo) && !Array.isArray(other)) {
    const keys = new Set([...Object.keys(yahoo), ...Object.keys(other)]);
    for (const k of keys) diffInputs(yahoo[k], other[k], { relTol }, prefix ? `${prefix}.${k}` : k, out);
    return out;
  }
  if (yahoo !== other) out.push({ field: prefix, yahoo, other });
  return out;
}

function modelOf(result) {
  if (!result) return 'no-data';
  return result.excluded ? `excluded:${result.reason}` : result.method;
}

function solvencyDiffs(y, s) {
  const out = [];
  const ya = y && y.altmanZ;
  const sa = s && s.altmanZ;
  const altmanSame = (!ya && !sa) || (ya && sa && ya.zone === sa.zone && closeEnough(ya.score, sa.score, 0.005));
  if (!altmanSame) out.push({ field: 'solvency.altmanZ', yahoo: ya || null, other: sa || null });
  const yp = y && y.piotroskiF;
  const sp = s && s.piotroskiF;
  const pioSame = (!yp && !sp) || (yp && sp && yp.score === sp.score);
  if (!pioSame) out.push({ field: 'solvency.piotroskiF', yahoo: yp || null, other: sp || null });
  return out;
}

// One parity_results row (StockAnalysis worker/store/schema.sql) for a ticker.
function compareTicker({ ticker, market, yahoo, store, sources = {}, extraDiffs = [] }) {
  const yResult = yahoo && yahoo.result;
  const sResult = store && store.result;
  const row = {
    symbol: ticker, check_kind: 'store', market,
    model_yahoo: modelOf(yResult), model_other: modelOf(sResult),
    base_yahoo: yResult && !yResult.excluded ? (yResult.intrinsic ?? null) : null,
    base_other: null, diff_pct: null, pass: false, diffs: [],
  };
  if (!store || !store.data || !sResult) {
    row.model_other = 'no-data';
    return row;
  }
  if (sources.quoteSummary !== 'store') {
    row.model_other = 'store-miss';
    row.diffs.push({ field: 'source.quoteSummary', yahoo: 'yahoo', other: sources.quoteSummary || null });
    return row;
  }
  const diffs = [];
  if (sources.timeseries !== 'store') diffs.push({ field: 'source.timeseries', yahoo: 'yahoo', other: sources.timeseries || null });
  diffs.push(...solvencyDiffs(yResult, sResult));
  diffs.push(...diffInputs(yahoo.data || {}, store.data || {}));
  diffs.push(...extraDiffs);
  row.diffs = diffs;

  const sameModel = row.model_yahoo === row.model_other;
  let baseOk = true;
  if (!yResult.excluded && !sResult.excluded) {
    row.base_other = sResult.intrinsic ?? null;
    if (typeof row.base_yahoo === 'number' && typeof row.base_other === 'number' && row.base_yahoo !== 0) {
      row.diff_pct = Number((((row.base_other - row.base_yahoo) / Math.abs(row.base_yahoo)) * 100).toFixed(6));
      baseOk = Math.abs(row.diff_pct) <= BASE_TOLERANCE_PCT;
    } else {
      baseOk = row.base_yahoo === row.base_other;
    }
  }
  const solvencyOk = !diffs.some(d => d.field.startsWith('solvency.'));
  const sourcesOk = sources.timeseries === 'store';
  // Prices aren't a valuation input, so a broken price store would otherwise pass unseen (the panel lists
  // failures only). Only 'history.tail' -- Yahoo already has newer bars -- is allowed.
  const historyOk = !diffs.some(d => d.field === 'source.history' || (d.field.startsWith('history') && d.field !== 'history.tail'));
  row.pass = sameModel && baseOk && solvencyOk && sourcesOk && historyOk;
  return row;
}

// /history comparison over the dates both sides hold: close mismatches (capped), plus a note when Yahoo already
// has newer bars than the store (expected: the store is as of the last production fetch).
function historyDiffs(yPoints, sPoints, { relTol = 0.005, cap = HISTORY_DIFF_CAP } = {}) {
  const y = Array.isArray(yPoints) ? yPoints : [];
  if (!Array.isArray(sPoints) || sPoints.length === 0) {
    return [{ field: 'history', yahoo: y.length, other: null, note: 'no store history' }];
  }
  const byDate = new Map(sPoints.map(p => [p.date, p]));
  const lastStored = sPoints.reduce((m, p) => (p.date > m ? p.date : m), sPoints[0].date);
  const mismatches = [];
  let newer = 0;
  let newestYahoo = null;
  for (const p of y) {
    if (p.date > lastStored) {
      newer++;
      if (!newestYahoo || p.date > newestYahoo) newestYahoo = p.date;
      continue;
    }
    const s = byDate.get(p.date);
    if (s && !closeEnough(p.close, s.close, relTol)) mismatches.push({ field: `history[${p.date}].close`, yahoo: p.close, other: s.close });
  }
  const out = mismatches.slice(0, cap);
  if (mismatches.length > cap) out.push({ field: 'history', yahoo: mismatches.length, other: null, note: `${mismatches.length} close mismatches` });
  if (newer) out.push({ field: 'history.tail', yahoo: newestYahoo, other: lastStored, note: `${newer} newer Yahoo bar(s)` });
  return out;
}

function summarise(rows) {
  const byMarket = {};
  const byModel = {};
  const bump = (map, key, pass) => {
    map[key] = map[key] || { pass: 0, fail: 0 };
    map[key][pass ? 'pass' : 'fail'] += 1;
  };
  for (const r of rows) {
    bump(byMarket, r.market || 'unknown', r.pass);
    bump(byModel, r.model_yahoo || 'unknown', r.pass);
  }
  return { byMarket, byModel };
}

module.exports = { diffInputs, historyDiffs, modelOf, compareTicker, summarise, BASE_TOLERANCE_PCT };
