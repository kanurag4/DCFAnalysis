// Builds the "Value investing scale" card shown on every per-ticker SEO page
// (both /dcf/stocks/ and /growth/stocks/) — the Stock Evaluator's combined
// Buffett + Dalio + Graham gauge, plus a link into /stock/ prefilled with
// the ticker. Pure: takes an already-fetched quoteSummary body, returns an
// HTML string (or '' when the card shouldn't render). No network calls of
// its own — callers already have a quoteSummary rawBody in scope from their
// own DCF/growth fetch and pass it straight through.
//
// This file is byte-identical between StockAnalysis and DCFAnalysis (see
// shared-files-manifest.json) — it only ever talks to ./stock-scorers,
// which is NOT identical between the two repos (it points at wherever that
// repo's copy of the scorer source lives). That split is what lets this
// file stay repo-agnostic despite the two repos' different file layouts.
const { buffettScore, dalioScore, grahamScore, mapStockData } = require('./stock-scorers');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A ticker page counts "no data" as "more than a third of the (non-skipped)
// criteria never got a real Yahoo value" — past that point the combined
// score is more measurement noise than signal, and showing it (even with a
// caveat) would read as a confident verdict on a data gap. 20 criteria
// normally, 17 for financials (D/E skipped in all three scorers).
const OMIT_THRESHOLD = 1 / 3;

// Verdict thresholds and marker math ported verbatim from the live
// Stock Evaluator's renderGauge() (www/stock/app.js). Deliberately absolute,
// not ratio-based — they do not rescale when D/E is skipped for financials,
// so a bank/insurer is held to a very slightly higher bar out of 17 than a
// non-financial is out of 20. Reproducing that quirk here, rather than
// "fixing" it, is what keeps a ticker page's score in exact agreement with
// /stock/?ticker=X for the same company.
function gaugeVerdict(combinedScore) {
  if (combinedScore >= 13) return { cls: 'good', verdict: 'Strong Fit' };
  if (combinedScore >= 8) return { cls: 'ok', verdict: 'Partial Fit' };
  return { cls: 'bad', verdict: 'Poor Fit' };
}

// Derives the asx=1/nse=1 query params from the ticker's own suffix, the
// same convention www/kv-ticker-input.js's resolveSymbol() uses — NOT from
// market.folder. The two repos' marketMeta() disagree on where a .T ticker
// files (DCFAnalysis: 'other'; StockAnalysis's growth generator: 'nikkei'),
// so a folder-based rule would need two different implementations to stay
// correct; suffix-based needs only one, and matches what the Stock
// Evaluator's own URL bootstrap (parseUrlState) re-derives anyway — these
// params are belt-and-braces, ticking the checkbox for display only.
function evaluatorSuffixParams(symbol) {
  const t = String(symbol || '').toUpperCase();
  if (t.endsWith('.AX')) return '&amp;asx=1';
  if (t.endsWith('.NS') || t.endsWith('.BO')) return '&amp;nse=1';
  return '';
}

// Builds the card, or returns '' when it shouldn't render. `market` is
// currently unused (kept in the call signature for forward-compatibility —
// both callers already have it in scope) now that the CTA link derives its
// query params from the ticker suffix rather than the market folder.
function buildValueScaleCard({ rawBody, symbol, market }) {
  const result = rawBody?.quoteSummary?.result?.[0];
  if (!result) return '';

  let data;
  try {
    data = mapStockData(result, symbol);
  } catch (_) {
    return '';
  }

  const buffett = buffettScore(data);
  const dalio = dalioScore(data);
  const graham = grahamScore(data);

  const combinedScore = buffett.totalScore + dalio.totalScore + graham.totalScore;
  const maxCombined = buffett.maxScore + dalio.maxScore + graham.maxScore;
  if (maxCombined === 0) return '';

  const allResults = [...buffett.results, ...dalio.results, ...graham.results];
  const missing = allResults.filter(r => !r.skipped && r.dataMissing).length;
  if (missing / maxCombined > OMIT_THRESHOLD) return '';

  const pct = Math.min((combinedScore / maxCombined) * 100, 100);
  const { cls, verdict } = gaugeVerdict(combinedScore);

  const gapNote = missing > 0
    ? `<p class="value-scale-gap">${missing} criteri${missing === 1 ? 'on' : 'a'} had no data</p>`
    : '';

  const t = encodeURIComponent(symbol);
  const stockHref = `/stock/?ticker=${t}${evaluatorSuffixParams(symbol)}`;

  return `
    <section class="value-scale-block">
      <h2>Value investing scale <span class="value-scale-sub">&middot; Buffett &middot; Dalio &middot; Graham</span></h2>
      <div class="gauge-wrap">
        <div class="gauge-bar-area">
          <div class="gauge-marker-area ${cls}" style="left:${pct}%">
            <span class="gauge-pill">${verdict}</span>
            <div class="gauge-stem"></div>
          </div>
          <div class="gauge-zones">
            <div class="gauge-z bad"></div>
            <div class="gauge-z ok"></div>
            <div class="gauge-z good"></div>
          </div>
        </div>
        <div class="gauge-sub">${combinedScore} / ${maxCombined} combined score</div>
        ${gapNote}
      </div>
      <p class="value-scale-cta"><a href="${stockHref}">See the full Buffett, Dalio &amp; Graham breakdown for ${escapeHtml(symbol)} &rarr;</a></p>
    </section>`;
}

module.exports = { buildValueScaleCard, gaugeVerdict, OMIT_THRESHOLD };
