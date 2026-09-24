// Pure: partial correlation of a stock's daily returns with the AI-sector
// ETF (AIQ), controlling for the broad equal-weight market (RSP). See
// docs/superpowers/specs/2026-09-23-ai-sector-correlation-design.md.
//
// SPY was rejected as the market control: SPY and AIQ have ~0.84 raw
// correlation with each other (SPY is now heavily AI-mega-cap-weighted), so
// controlling for SPY would strip out real AI signal along with market
// noise. RSP (S&P 500 Equal Weight) has only ~0.51-0.53 correlation with
// AIQ -- a much cleaner "broad economy" proxy. Validated empirically
// against 20+ real tickers before landing on this design.

const AI_ETF_TICKER = 'AIQ';
// Second benchmark (added 2026-09-24, spec §10): the semiconductor / AI-hardware side of the AI
// boom. SaaS names read ~0 against the broad AIQ basket but clearly negative against semis, while
// NVDA/AMD are strongly positive against both.
const AI_HARDWARE_ETF_TICKER = 'SMH';
const MARKET_ETF_TICKER = 'RSP';
const MIN_TRADING_DAYS = 90; // card/FAQ are omitted at or below this many overlapping days
const INVERSE_MAX = -0.20;   // r at or below this = Inverse (moves AGAINST the benchmark)

const BANDS = [
  { key: 'high', label: 'High', min: 0.40 },
  { key: 'moderate', label: 'Moderate', min: 0.20 },
  { key: 'low', label: 'Low', min: 0.05 },
  { key: 'none', label: 'None', min: -Infinity },
  // Never matched by the loop below (None's -Infinity catches everything first); bandFor()
  // checks INVERSE_MAX explicitly, this entry only supplies the label.
  { key: 'inverse', label: 'Inverse', min: -Infinity },
];

function bandFor(r) {
  if (r == null) return null;
  if (r <= INVERSE_MAX) return 'inverse';
  for (const b of BANDS) {
    if (r >= b.min) return b.key;
  }
  return 'none';
}

function bandLabel(bandKey) {
  const b = BANDS.find(x => x.key === bandKey);
  return b ? b.label : null;
}

// [{date, close}] (ascending, one entry per trading day) -> [{date, ret}]
function toDailyReturns(closes) {
  const rets = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1].close, cur = closes[i].close;
    if (prev == null || cur == null || prev === 0) continue;
    rets.push({ date: closes[i].date, ret: (cur - prev) / prev });
  }
  return rets;
}

// Inner-joins N { date, ret } arrays on `date` -- only dates present in
// EVERY series survive. This is the alignment step that (deliberately, see
// spec §5) dampens non-US tickers: fewer overlapping trading days with the
// US-listed AIQ/RSP benchmarks means a smaller n, not a different formula.
function innerJoinByDate(seriesList) {
  const maps = seriesList.map(s => new Map(s.map(p => [p.date, p.ret])));
  const [first, ...rest] = maps;
  const dates = [];
  for (const date of first.keys()) {
    if (rest.every(m => m.has(date))) dates.push(date);
  }
  dates.sort();
  return seriesList.map((_, i) => dates.map(d => maps[i].get(d)));
}

function mean(xs) { return xs.reduce((a, b) => a + b, 0) / xs.length; }

function pearson(xs, ys) {
  const n = xs.length;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

// Regresses y on x (simple OLS), returns y's residuals.
function residualsAfterRegression(y, x) {
  const n = y.length;
  const mx = mean(x), my = mean(y);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); den += (x[i] - mx) ** 2; }
  const beta = den === 0 ? 0 : num / den;
  const alpha = my - beta * mx;
  return y.map((v, i) => v - (alpha + beta * x[i]));
}

// Main entry point. stock/aiq/rsp are each [{date: 'YYYY-MM-DD', close:
// number}], ascending, one entry per trading day (the shape
// fetchDailyPriceHistory() returns).
//
// Returns { r: number|null, n: number, band: string|null }. r is rounded to 2dp
// and band is derived from that rounded value. r/band are null
// when MIN_TRADING_DAYS or fewer overlapping trading days exist after
// alignment (too small a sample to trust -- covers recent IPOs and
// thinly-traded tickers).
function partialCorrelationAgainst({ stock, benchmark, market }) {
  const stockRets = toDailyReturns(stock || []);
  const benchRets = toDailyReturns(benchmark || []);
  const marketRets = toDailyReturns(market || []);

  const [stockAligned, benchAligned, marketAligned] = innerJoinByDate([stockRets, benchRets, marketRets]);
  const n = stockAligned.length;

  if (n <= MIN_TRADING_DAYS) return { r: null, n, band: null };

  const stockResid = residualsAfterRegression(stockAligned, marketAligned);
  const benchResid = residualsAfterRegression(benchAligned, marketAligned);
  // Rounded BEFORE banding: r is shown to 2dp everywhere, so a raw 0.3985 must band as the "0.40" it displays as.
  const r = Math.round(pearson(stockResid, benchResid) * 100) / 100;

  return { r, n, band: bandFor(r) };
}

// The original AIQ-vs-RSP entry point; the generic form above serves any benchmark (e.g. SMH).
function partialCorrelation({ stock, aiq, rsp }) {
  return partialCorrelationAgainst({ stock, benchmark: aiq, market: rsp });
}

if (typeof module !== 'undefined') module.exports = {
  AI_ETF_TICKER, AI_HARDWARE_ETF_TICKER, MARKET_ETF_TICKER, MIN_TRADING_DAYS, INVERSE_MAX, BANDS,
  bandFor, bandLabel, toDailyReturns, innerJoinByDate, partialCorrelation, partialCorrelationAgainst,
};
