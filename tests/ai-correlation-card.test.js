const { test } = require('node:test');
const assert = require('node:assert');
const { buildAiCorrelationCard, buildAiCorrelationFaqHtml, BAND_COLOR } = require('../scripts/lib/ai-correlation-card.js');

const HIGH = { r: 0.684, n: 249, band: 'high' };
const NONE = { r: -0.09, n: 249, band: 'none' };
const NULLBAND = { r: null, n: 40, band: null };

// ── card: single reading (AIQ) ───────────────────────────────────────────────

test('buildAiCorrelationCard renders the badge with value and label for a HIGH band', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: HIGH });
  assert.match(html, /AI Sector Correlation/);
  assert.match(html, /0\.68/);
  assert.match(html, /High/);
  assert.ok(html.includes(BAND_COLOR.high));
});

test('buildAiCorrelationCard renders cyan (neutral: not red, green or the old sky-blue) for a NONE band', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: NONE });
  assert.match(html, /None/);
  assert.ok(html.includes(BAND_COLOR.none));
  assert.ok(!html.includes(BAND_COLOR.high) && !html.includes(BAND_COLOR.low) && !html.includes('#0ea5e9'));
});

test('buildAiCorrelationCard colours run reversed traffic-light: Moderate amber, Low green', () => {
  const moderate = buildAiCorrelationCard({ aiCorrelation: { r: 0.25, n: 249, band: 'moderate' } });
  const low = buildAiCorrelationCard({ aiCorrelation: { r: 0.1, n: 249, band: 'low' } });
  assert.ok(moderate.includes(BAND_COLOR.moderate));
  assert.ok(low.includes(BAND_COLOR.low));
  assert.ok(!low.includes(BAND_COLOR.high));
});

test('buildAiCorrelationCard renders an Inverse (negative) reading red, with its label and the negative value', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: { r: -0.41, n: 249, band: 'inverse' } });
  assert.match(html, /-0\.41/);
  assert.match(html, /Inverse/);
  assert.ok(html.includes(BAND_COLOR.inverse));
  assert.match(html, /against the AI sector/);
});

// The badge is white text on a solid band colour, so each colour must clear WCAG AA (4.5:1) for it.
const channel = (hex, i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
const linear = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => 0.2126 * linear(channel(hex, 0)) + 0.7152 * linear(channel(hex, 1)) + 0.0722 * linear(channel(hex, 2));
const contrastOnWhite = (hex) => 1.05 / (luminance(hex) + 0.05);

test('every band colour gives the white badge text at least WCAG AA contrast (4.5:1)', () => {
  for (const [band, hex] of Object.entries(BAND_COLOR)) {
    assert.ok(contrastOnWhite(hex) >= 4.5, `${band} ${hex} is only ${contrastOnWhite(hex).toFixed(2)}:1 against white`);
  }
});

test('the reversed traffic-light hues are unchanged: red (High, Inverse), orange, green, cyan', () => {
  const ch = (hex) => [0, 1, 2].map((i) => channel(hex, i));
  const red = ch(BAND_COLOR.high), orange = ch(BAND_COLOR.moderate), green = ch(BAND_COLOR.low), cyan = ch(BAND_COLOR.none);
  assert.ok(red[0] > red[1] * 2 && red[0] > red[2] * 2, 'high is red');
  assert.ok(orange[0] > orange[1] && orange[1] > orange[2] * 2, 'moderate is orange');
  assert.ok(green[1] > green[0] * 1.5 && green[1] > green[2] * 1.5, 'low is green');
  assert.ok(cyan[0] < cyan[1] * 0.5 && cyan[2] > cyan[0] * 2, 'none is cyan');
  assert.strictEqual(BAND_COLOR.inverse, BAND_COLOR.high);
});

test('buildAiCorrelationCard returns empty string when band is null (insufficient history)', () => {
  assert.strictEqual(buildAiCorrelationCard({ aiCorrelation: NULLBAND }), '');
});

test('buildAiCorrelationCard returns empty string when aiCorrelation is missing entirely', () => {
  assert.strictEqual(buildAiCorrelationCard({ aiCorrelation: null }), '');
  assert.strictEqual(buildAiCorrelationCard({}), '');
});

test('the AI sector card links to its own glossary page, and not to the hardware page', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: HIGH });
  assert.match(html, /<a href="\/glossary\/ai-sector-correlation\/">How it's calculated/);
  assert.doesNotMatch(html, /ai-hardware-correlation/);
});

test('each card links to ITS OWN glossary page, with the link inside that card and no shared link below', () => {
  const html = buildAiCorrelationCard({
    aiCorrelation: { r: 0.07, n: 249, band: 'low' },
    aiHardwareCorrelation: { r: -0.24, n: 249, band: 'inverse' },
  });
  const [, sectorCard, hardwareCard] = html.split('class="value-scale-block ai-corr-item"');
  assert.match(sectorCard, /href="\/glossary\/ai-sector-correlation\/">How it's calculated/);
  assert.doesNotMatch(sectorCard, /ai-hardware-correlation/);
  assert.match(hardwareCard, /href="\/glossary\/ai-hardware-correlation\/">How it's calculated/);
  assert.doesNotMatch(hardwareCard, /ai-sector-correlation/);
  assert.strictEqual((html.match(/class="eval-card-note ai-corr-guide"/g) || []).length, 2);
});

test('a lone AI-hardware card links only to the hardware page', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: null, aiHardwareCorrelation: { r: 0.66, n: 249, band: 'high' } });
  assert.match(html, /href="\/glossary\/ai-hardware-correlation\/"/);
  assert.doesNotMatch(html, /ai-sector-correlation\//);
});

// ── card: second reading (AI hardware / semiconductors) ──────────────────────

test('both readings sit under ONE common "AI Sector Correlation" heading, as two side-by-side cards', () => {
  const html = buildAiCorrelationCard({
    aiCorrelation: { r: 0.07, n: 249, band: 'low' },
    aiHardwareCorrelation: { r: -0.24, n: 249, band: 'inverse' },
  });
  // exactly one heading, and it comes before the cards
  assert.strictEqual((html.match(/<h2>/g) || []).length, 1);
  assert.match(html, /<h2>AI Sector Correlation<\/h2>/);
  assert.ok(html.indexOf('<h2>') < html.indexOf('ai-corr-cards'), 'heading should precede the cards');
  // one container holding exactly two card-styled items, each with its own label and badge
  assert.strictEqual((html.match(/class="ai-corr-cards"/g) || []).length, 1);
  assert.strictEqual((html.match(/class="value-scale-block ai-corr-item"/g) || []).length, 2);
  assert.match(html, />AI sector \(AIQ\)</);
  assert.match(html, />AI hardware \(semiconductors, SMH\)</);
  assert.match(html, /0\.07/);
  assert.match(html, /-0\.24/);
  assert.strictEqual((html.match(/class="ai-corr-badge"/g) || []).length, 2);
  assert.match(html, /semiconductor/);
});

test('the wrapper is not itself a card (no card nested inside a card)', () => {
  const html = buildAiCorrelationCard({
    aiCorrelation: { r: 0.07, n: 249, band: 'low' },
    aiHardwareCorrelation: { r: -0.24, n: 249, band: 'inverse' },
  });
  assert.match(html, /^<section class="ai-corr-block">/);
  assert.doesNotMatch(html, /<section class="value-scale-block/);
});

test('the card still renders, under the common heading, when only the AI-hardware reading is available', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: null, aiHardwareCorrelation: { r: 0.66, n: 249, band: 'high' } });
  assert.match(html, /<h2>AI Sector Correlation<\/h2>/);
  assert.match(html, />AI hardware \(semiconductors, SMH\)</);
  assert.doesNotMatch(html, />AI sector \(AIQ\)</);
  assert.strictEqual((html.match(/class="value-scale-block ai-corr-item"/g) || []).length, 1);
  assert.strictEqual((html.match(/class="ai-corr-badge"/g) || []).length, 1);
});

test('the card is omitted when NEITHER reading is available', () => {
  assert.strictEqual(buildAiCorrelationCard({ aiCorrelation: NULLBAND, aiHardwareCorrelation: NULLBAND }), '');
  assert.strictEqual(buildAiCorrelationCard({ aiCorrelation: null, aiHardwareCorrelation: null }), '');
});

// ── FAQ ──────────────────────────────────────────────────────────────────────

test('buildAiCorrelationFaqHtml renders every FAQ entry when a reading is present', () => {
  const html = buildAiCorrelationFaqHtml({ aiCorrelation: { r: 0.68, n: 249, band: 'high' } });
  for (const q of [
    'What is "AI Sector Correlation"?',
    'How is it calculated?',
    'What does "Inverse" mean?',
    'What is the "AI hardware" reading, and why show two numbers?',
    'What do the colours mean?',
    'Does a high score mean I should buy this stock?',
    'Why might a genuinely AI-linked company still show "None"?',
    'Why do some international stocks score lower than expected?',
  ]) assert.ok(html.includes(q), `missing FAQ: ${q}`);
});

test('buildAiCorrelationFaqHtml returns empty string when neither reading is available', () => {
  assert.strictEqual(buildAiCorrelationFaqHtml({ aiCorrelation: NULLBAND }), '');
  assert.strictEqual(buildAiCorrelationFaqHtml({ aiCorrelation: null, aiHardwareCorrelation: null }), '');
});

test('buildAiCorrelationFaqHtml renders when only the AI-hardware reading is available', () => {
  const html = buildAiCorrelationFaqHtml({ aiCorrelation: null, aiHardwareCorrelation: { r: 0.66, n: 249, band: 'high' } });
  assert.match(html, /What does "Inverse" mean\?/);
});

test('FAQ copy describes daily (not weekly) movements, matching the calculation', () => {
  const html = buildAiCorrelationFaqHtml({ aiCorrelation: { r: 0.68, n: 249, band: 'high' } });
  assert.match(html, /daily price movements/);
  assert.doesNotMatch(html, /weekly/);
});

test('the "How is it calculated?" FAQ answer names both benchmarks and links to the full glossary entry', () => {
  const html = buildAiCorrelationFaqHtml({ aiCorrelation: { r: 0.68, n: 249, band: 'high' } });
  const answer = html.split('How is it calculated?')[1].split('</details>')[0];
  assert.match(answer, /AIQ/);
  assert.match(answer, /SMH/);
  assert.match(answer, /<a href="\/glossary\/ai-sector-correlation\/">full glossary entry<\/a>/);
});

test('the colours FAQ says red means strong dependence in either direction, not a rating', () => {
  const html = buildAiCorrelationFaqHtml({ aiCorrelation: { r: 0.68, n: 249, band: 'high' } });
  const answer = html.split('What do the colours mean?')[1].split('</details>')[0];
  assert.match(answer, /red/i);
  assert.match(answer, /Inverse/);
  assert.match(answer, /not a (good|quality)/i);
});

test('DCF FAQ refers to the valuation and framework scores above', () => {
  const html = buildAiCorrelationFaqHtml({ aiCorrelation: { r: 0.68, n: 249, band: 'high' } });
  assert.match(html, /valuation and framework scores above/);
  assert.doesNotMatch(html, /growth score and valuation above/);
});

test('the "AI hardware" FAQ answer links to its own glossary page', () => {
  const html = buildAiCorrelationFaqHtml({ aiCorrelation: { r: 0.68, n: 249, band: 'high' } });
  const answer = html.split('What is the "AI hardware" reading, and why show two numbers?')[1].split('</details>')[0];
  assert.match(answer, /<a href="\/glossary\/ai-hardware-correlation\/">/);
});
