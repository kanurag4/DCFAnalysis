// DCFAnalysis/scripts/lib/ai-correlation-card.js — builds the "AI Sector
// Correlation" card + FAQ block for a per-ticker SEO page. Pure: takes an
// already-computed { r, n, band } (from www/calc/aiCorrelation.js's
// partialCorrelation()), returns HTML strings. Mirrors solvency-scale.js's
// shape (same repo, same "pure card builder fed by data the caller already
// computed" pattern) -- see
// docs/superpowers/specs/2026-09-23-ai-sector-correlation-design.md.
const { bandLabel } = require('../../www/calc/aiCorrelation.js');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Deliberately NOT literal Red/Amber/Green -- see spec §3. "None" (no
// meaningful AI-sector link) isn't a failure, so it renders sky-blue, not
// red, to avoid reading as a verdict on this codebase's fixed
// green=pass/red=fail/amber=caution convention.
const BAND_COLOR = {
  high: '#22c55e',
  moderate: '#f97316',
  low: '#06b6d4',
  none: '#0ea5e9',
};

const BAND_DESCRIPTION = {
  high: 'Strong co-movement with the AI sector, beyond what broad-market exposure explains.',
  moderate: 'Moderate co-movement with the AI sector, beyond what broad-market exposure explains.',
  low: 'A weak but present link to AI-sector price moves.',
  none: 'Price moves show no meaningful link to the AI sector over the trailing year.',
};

// `aiCorrelation`: the { r, n, band } object partialCorrelation() returns.
// Returns '' when band is null (insufficient trading-day history, or the
// AIQ/RSP fetch failed for this generation run) -- the card is omitted
// entirely rather than showing a number from too small a sample.
function buildAiCorrelationCard({ aiCorrelation }) {
  if (!aiCorrelation || aiCorrelation.band == null) return '';

  const { r, band } = aiCorrelation;
  const label = bandLabel(band);
  const color = BAND_COLOR[band];
  const desc = BAND_DESCRIPTION[band];

  return `<section class="value-scale-block ai-corr-block">
    <h2>AI Sector Correlation</h2>
    <div class="ai-corr-card">
      <span class="ai-corr-badge" style="background:${color}"><span class="ai-corr-rval">${r.toFixed(2)}</span> ${escapeHtml(label)}</span>
      <p class="eval-card-note">${escapeHtml(desc)} <a href="/glossary/ai-sector-correlation/">How it's calculated →</a></p>
    </div>
  </section>`;
}

// Returns '' when band is null -- no FAQ entries for a ticker whose card
// was omitted (nothing to explain if the stat isn't shown).
function buildAiCorrelationFaqHtml({ aiCorrelation }) {
  if (!aiCorrelation || aiCorrelation.band == null) return '';

  return `<details class="faq-item"><summary>What is "AI Sector Correlation"?</summary>
    <p>A measure of how closely this stock's daily price movements have tracked the AI sector (represented by a broad AI-themed ETF) over the trailing 12 months, after removing the effect of general stock-market movement. It answers "does this stock move with AI-sector sentiment specifically, beyond just moving with the market overall?" — not whether the company's revenue comes from AI.</p>
  </details>
  <details class="faq-item"><summary>How is it calculated?</summary>
    <p>We compute daily returns for the stock, an AI-sector ETF, and an equal-weight broad-market ETF over the trailing year, then calculate the <em>partial correlation</em> between the stock and the AI ETF while statistically controlling for the broad-market ETF. This isolates AI-specific co-movement from ordinary market-wide moves — a stock correlated with the market generally (which most large stocks are) doesn't automatically score as AI-correlated. See the <a href="/glossary/ai-sector-correlation/">full glossary entry</a> for the formula and its limits.</p>
  </details>
  <details class="faq-item"><summary>Does a high score mean I should buy this stock?</summary>
    <p>No. This is a descriptive statistic about historical price co-movement, not a valuation judgment or a recommendation. A stock can show high AI correlation and still be overvalued, and a stock with no AI correlation can still be a sound investment for other reasons. Use it alongside the valuation and framework scores above, not in place of them.</p>
  </details>
  <details class="faq-item"><summary>Why might a genuinely AI-linked company still show "None"?</summary>
    <p>Correlation measures how the <em>market has priced</em> the stock recently, not the company's actual business exposure. A company can have a real AI-infrastructure story (for example, supplying power or components to data centres) without the market yet trading its shares in sync with AI-sector sentiment — the underlying business case and the price pattern are two different things.</p>
  </details>
  <details class="faq-item"><summary>Why do some international stocks score lower than expected?</summary>
    <p>Stocks listed outside the US (for example on the ASX or KRX) trade on a different calendar to the US-listed AI ETF used for this comparison, so there are fewer directly overlapping trading days to compare. This can understate the correlation for otherwise AI-linked international companies — a known limitation of the method, not a judgment about the company.</p>
  </details>`;
}

module.exports = { buildAiCorrelationCard, buildAiCorrelationFaqHtml, BAND_COLOR, BAND_DESCRIPTION };
