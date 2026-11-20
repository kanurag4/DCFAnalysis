// Return on equity on START-of-period equity (valuation method v2 Part 2, 2026-11-21; used only behind /dcf/'s method
// toggle). Damodaran, "Return on Capital (ROC), ROIC and ROE: Measurement and Implications" (2007), p.11: "Return on
// Equity = Net Income_t / Book Value of Equity_t-1"; p.12: with negative book equity "the return on equity becomes a
// meaningless number" -> no value. Pure, no DOM. Shared browser global scope: every top-level name starts with roe / ROE.

const ROE_METHOD_ON = false; // switched with the /dcf/ toggle only (scope change 2026-11-21)
const ROE_QUARTER_GAP_DAYS = 100;
const ROE_START_MIN_DAYS = 330, ROE_START_MAX_DAYS = 400;
const roeDay = d => Date.parse(d) / 86400000;

function roePoints(series) {
  return (Array.isArray(series) ? series : [])
    .filter(e => e && e.date && typeof e.value === 'number' && Number.isFinite(e.value))
    .slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

// The equity point dated a year (330-400 days) before `end`, nearest to 365 days.
function roeStartEquity(equity, end) {
  let best = null;
  for (const e of roePoints(equity)) {
    const gap = roeDay(end) - roeDay(e.date);
    if (gap < ROE_START_MIN_DAYS || gap > ROE_START_MAX_DAYS) continue;
    if (!best || Math.abs(gap - 365) < Math.abs(roeDay(end) - roeDay(best.date) - 365)) best = e;
  }
  return best ? best.value : null;
}

function roeStartOfPeriod({ quarterlyNetIncome, quarterlyEquity, annualNetIncome, annualEquity } = {}) {
  const q = roePoints(quarterlyNetIncome).slice(-4);
  const consecutive = q.length === 4 && q.every((e, i) => i === 0 || (roeDay(e.date) - roeDay(q[i - 1].date) > 0 && roeDay(e.date) - roeDay(q[i - 1].date) <= ROE_QUARTER_GAP_DAYS));
  if (consecutive) {
    const end = q[3].date;
    const start = roeStartEquity(quarterlyEquity, end) ?? roeStartEquity(annualEquity, end);
    const ni = q.reduce((s, e) => s + e.value, 0);
    if (start !== null) return start > 0 ? { value: ni / start, method: 'ttm', netIncome: ni, startEquity: start } : null;
  }
  const a = roePoints(annualNetIncome);
  if (!a.length) return null;
  const last = a[a.length - 1];
  const start = roeStartEquity(annualEquity, last.date);
  if (start === null || !(start > 0)) return null;
  return { value: last.value / start, method: 'annual', netIncome: last.value, startEquity: start };
}

if (typeof module !== 'undefined') module.exports = { ROE_METHOD_ON, roeStartOfPeriod };
