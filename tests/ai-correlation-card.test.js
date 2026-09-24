const { test } = require('node:test');
const assert = require('node:assert');
const { buildAiCorrelationCard, buildAiCorrelationFaqHtml } = require('../scripts/lib/ai-correlation-card.js');

const HIGH = { r: 0.684, n: 249, band: 'high' };
const NONE = { r: -0.09, n: 249, band: 'none' };
const NULLBAND = { r: null, n: 40, band: null };

// ── card: single reading (AIQ) ───────────────────────────────────────────────

test('buildAiCorrelationCard renders the badge with value and label for a HIGH band', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: HIGH });
  assert.match(html, /AI Sector Correlation/);
  assert.match(html, /0\.68/);
  assert.match(html, /High/);
  assert.match(html, /#ef4444/);
});

test('buildAiCorrelationCard renders cyan (neutral: not red, green or the old sky-blue) for a NONE band', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: NONE });
  assert.match(html, /None/);
  assert.match(html, /#06b6d4/);
  assert.doesNotMatch(html, /#ef4444|#22c55e|#0ea5e9/);
});

test('buildAiCorrelationCard colours run reversed traffic-light: Moderate amber, Low green', () => {
  const moderate = buildAiCorrelationCard({ aiCorrelation: { r: 0.25, n: 249, band: 'moderate' } });
  const low = buildAiCorrelationCard({ aiCorrelation: { r: 0.1, n: 249, band: 'low' } });
  assert.match(moderate, /#f97316/);
  assert.match(low, /#22c55e/);
  assert.doesNotMatch(low, /#ef4444/);
});

test('buildAiCorrelationCard renders an Inverse (negative) reading red, with its label and the negative value', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: { r: -0.41, n: 249, band: 'inverse' } });
  assert.match(html, /-0\.41/);
  assert.match(html, /Inverse/);
  assert.match(html, /#ef4444/);
  assert.match(html, /against the AI sector/);
});

test('buildAiCorrelationCard returns empty string when band is null (insufficient history)', () => {
  assert.strictEqual(buildAiCorrelationCard({ aiCorrelation: NULLBAND }), '');
});

test('buildAiCorrelationCard returns empty string when aiCorrelation is missing entirely', () => {
  assert.strictEqual(buildAiCorrelationCard({ aiCorrelation: null }), '');
  assert.strictEqual(buildAiCorrelationCard({}), '');
});

test('the card links to the glossary page so readers can see how the number is calculated', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: HIGH });
  assert.match(html, /<a href="\/glossary\/ai-sector-correlation\/">How it's calculated/);
});

// ── card: second reading (AI hardware / semiconductors) ──────────────────────

test('the card shows BOTH readings, each labelled, when both are available', () => {
  const html = buildAiCorrelationCard({
    aiCorrelation: { r: 0.07, n: 249, band: 'low' },
    aiHardwareCorrelation: { r: -0.24, n: 249, band: 'inverse' },
  });
  assert.match(html, /AI sector/);
  assert.match(html, /AI hardware/);
  assert.match(html, /0\.07/);
  assert.match(html, /-0\.24/);
  assert.strictEqual((html.match(/class="ai-corr-badge"/g) || []).length, 2);
  assert.match(html, /semiconductor/);
});

test('the card still renders when only the AI-hardware reading is available, and omits the missing one', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: null, aiHardwareCorrelation: { r: 0.66, n: 249, band: 'high' } });
  assert.match(html, /AI hardware/);
  assert.doesNotMatch(html, /AI sector \(AIQ\)/);
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
