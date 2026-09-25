// scripts/lib/ai-correlation-card.js — builds the "AI Sector
// Correlation" card + FAQ block for a per-ticker SEO page. Pure: takes the
// already-computed { r, n, band } readings (from www/calc/aiCorrelation.js's
// partialCorrelationAgainst(), via scripts/lib/ai-correlation-batch.js) and
// returns HTML strings. Mirrors solvency-scale.js's shape (same repo, same
// "pure card builder fed by data the caller already computed" pattern) -- see
// docs/superpowers/specs/2026-09-23-ai-sector-correlation-design.md.
//
// Two readings: `aiCorrelation` (vs AIQ, the broad AI basket) and
// `aiHardwareCorrelation` (vs SMH, semiconductors -- spec section 10). Each is
// shown only when it has a band; the card/FAQ are omitted when neither does.
const { bandLabel } = require('../../www/calc/aiCorrelation.js');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Reversed traffic light -- see spec §3 (user decision, 2026-09-24). Colour
// reads as dependence on the AI sector IN EITHER DIRECTION: High (moves with it)
// and Inverse (moves against it) are both red, told apart by their label.
// "None" is neutral cyan, never red or green, since no AI linkage isn't a
// verdict either way.
//
// These are the 600/700 shades of the four hues, not the 500s, because the badge
// is white text on the solid colour: red-500/orange-500/green-500/cyan-500 give
// 3.8/2.8/2.3/2.4:1, all below WCAG AA's 4.5:1 for text this size. Same hues;
// tests/ai-correlation-card.test.js asserts the contrast so a lighter shade can't creep back.
const BAND_COLOR = {
  high: '#dc2626',      // red-600
  moderate: '#c2410c',  // orange-700
  low: '#15803d',       // green-700
  none: '#0e7490',      // cyan-700
  inverse: '#dc2626',   // red-600, same as High
};

const BAND_DESCRIPTION = {
  ai: {
    high: 'Strong co-movement with the AI sector, beyond what broad-market exposure explains.',
    moderate: 'Moderate co-movement with the AI sector, beyond what broad-market exposure explains.',
    low: 'A weak but present link to AI-sector price moves.',
    none: 'Price moves show no meaningful link to the AI sector over the trailing year.',
    inverse: 'Tends to move against the AI sector, beyond what broad-market movement explains.',
  },
  hardware: {
    high: 'Moves closely with semiconductor stocks, the hardware side of the AI boom, beyond what broad-market exposure explains.',
    moderate: 'Moderate co-movement with semiconductor stocks, beyond what broad-market exposure explains.',
    low: 'A weak but present link to semiconductor stock moves.',
    none: 'Price moves show no meaningful link to semiconductor stocks over the trailing year.',
    inverse: 'Tends to move against semiconductor stocks, beyond what broad-market movement explains.',
  },
};

const READING_LABEL = {
  ai: 'AI sector (AIQ)',
  hardware: 'AI hardware (semiconductors, SMH)',
};

// Each card links to the glossary page that explains ITS reading.
const READING_GUIDE = {
  ai: '/glossary/ai-sector-correlation/',
  hardware: '/glossary/ai-hardware-correlation/',
};

// The only wording that differs between the DCF and growth generators' FAQ: what "above" refers to on that
// page. Kept on one line of its own so scripts/shared-files-manifest.json can ignore just this line and
// still catch any edit to the FAQ text itself.
const SCORES_ABOVE = 'valuation and framework scores';

function hasBand(reading) {
  return !!reading && reading.band != null;
}

function readingHtml(kind, reading) {
  if (!hasBand(reading)) return '';
  const { r, band } = reading;
  return `<div class="value-scale-block ai-corr-item">
        <span class="ai-corr-label">${escapeHtml(READING_LABEL[kind])}</span>
        <span class="ai-corr-badge" style="background:${BAND_COLOR[band]}"><span class="ai-corr-rval">${r.toFixed(2)}</span> ${escapeHtml(bandLabel(band))}</span>
        <p class="eval-card-note">${escapeHtml(BAND_DESCRIPTION[kind][band])}</p>
        <p class="eval-card-note ai-corr-guide"><a href="${READING_GUIDE[kind]}">How it's calculated →</a></p>
      </div>`;
}

// Returns '' when neither reading has a band (insufficient trading-day
// history, or the AIQ/RSP/SMH fetch failed for this generation run) -- the
// card is omitted entirely rather than showing a number from too small a sample.
function buildAiCorrelationCard({ aiCorrelation, aiHardwareCorrelation } = {}) {
  const items = [readingHtml('ai', aiCorrelation), readingHtml('hardware', aiHardwareCorrelation)].filter(Boolean);
  if (!items.length) return '';

  // One common heading, then each reading as its own .value-scale-block card, laid out side by side
  // (wrapping to stacked on narrow screens) by .ai-corr-cards. The wrapper itself is deliberately NOT
  // a card, so there is no card nested inside a card.
  return `<section class="ai-corr-block">
    <h2>AI Sector Correlation</h2>
    <div class="ai-corr-cards">
      ${items.join('\n      ')}
    </div>
  </section>`;
}

// Returns '' when neither reading has a band -- no FAQ entries for a ticker
// whose card was omitted (nothing to explain if the stat isn't shown).
function buildAiCorrelationFaqHtml({ aiCorrelation, aiHardwareCorrelation } = {}) {
  if (!hasBand(aiCorrelation) && !hasBand(aiHardwareCorrelation)) return '';

  return `<details class="faq-item"><summary>What is "AI Sector Correlation"?</summary>
    <p>A measure of how closely this stock's daily price movements have tracked the AI sector over the trailing 12 months, after removing the effect of general stock-market movement. It is shown against two benchmarks: a broad AI-themed ETF (AIQ) and a semiconductor ETF (SMH), the hardware side of the AI boom. It answers "does this stock move with AI-sector sentiment specifically, beyond just moving with the market overall?" — not whether the company's revenue comes from AI.</p>
  </details>
  <details class="faq-item"><summary>How is it calculated?</summary>
    <p>We compute daily returns for the stock, the two AI ETFs (AIQ and SMH), and an equal-weight broad-market ETF over the trailing year, then calculate the <em>partial correlation</em> between the stock and each AI ETF while statistically controlling for the broad-market ETF. This isolates AI-specific co-movement from ordinary market-wide moves — a stock correlated with the market generally (which most large stocks are) doesn't automatically score as AI-correlated. See the <a href="/glossary/ai-sector-correlation/">full glossary entry</a> for the formula and its limits.</p>
  </details>
  <details class="faq-item"><summary>What does "Inverse" mean?</summary>
    <p>A reading of -0.20 or lower. After removing general market movement, the stock has tended to rise when the AI sector (or semiconductor stocks) fall, and fall when they rise. It is a strong link, just in the opposite direction, which is why it is coloured red like High. It describes past price behaviour, not a prediction.</p>
  </details>
  <details class="faq-item"><summary>What is the "AI hardware" reading, and why show two numbers?</summary>
    <p>The broad AI ETF mixes hardware, cloud and software companies, so a stock can look unrelated to it while moving strongly with, or against, semiconductor stocks. For example, some large software companies have shown a near-zero reading against the broad AI ETF but a clearly negative one against semiconductors. Showing both lets you see either pattern. See the <a href="/glossary/ai-hardware-correlation/">AI Hardware Correlation guide</a> for how the semiconductor reading works.</p>
  </details>
  <details class="faq-item"><summary>What do the colours mean?</summary>
    <p>The colour shows how strongly the stock's price has been tied to the AI sector, in either direction. It is not a good or bad rating. Red means a strong link: High (moves with the AI sector) or Inverse (moves against it). Amber is Moderate, green is Low, and cyan means no meaningful link (None). Red is not a quality or valuation warning.</p>
  </details>
  <details class="faq-item"><summary>Does a high score mean I should buy this stock?</summary>
    <p>No. This is a descriptive statistic about historical price co-movement, not a valuation judgment or a recommendation. A stock can show high AI correlation and still be overvalued, and a stock with no AI correlation can still be a sound investment for other reasons. Use it alongside the ${SCORES_ABOVE} above, not in place of them.</p>
  </details>
  <details class="faq-item"><summary>Why might a genuinely AI-linked company still show "None"?</summary>
    <p>Correlation measures how the <em>market has priced</em> the stock recently, not the company's actual business exposure. A company can have a real AI-infrastructure story (for example, supplying power or components to data centres) without the market yet trading its shares in sync with AI-sector sentiment — the underlying business case and the price pattern are two different things.</p>
  </details>
  <details class="faq-item"><summary>Why do some international stocks score lower than expected?</summary>
    <p>Stocks listed outside the US (for example on the ASX or KRX) trade on a different calendar to the US-listed AI ETFs used for this comparison, so there are fewer directly overlapping trading days to compare. This can understate the correlation for otherwise AI-linked international companies — a known limitation of the method, not a judgment about the company.</p>
  </details>`;
}

module.exports = { buildAiCorrelationCard, buildAiCorrelationFaqHtml, BAND_COLOR, BAND_DESCRIPTION };
