const { test } = require('node:test');
const assert = require('node:assert');
const { buildAiCorrelationCard, buildAiCorrelationFaqHtml } = require('../scripts/lib/ai-correlation-card.js');

test('buildAiCorrelationCard renders the badge with value and label for a HIGH band', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: { r: 0.684, n: 249, band: 'high' } });
  assert.match(html, /AI Sector Correlation/);
  assert.match(html, /0\.68/);
  assert.match(html, /High/);
  assert.match(html, /#ef4444/);
});

test('buildAiCorrelationCard renders cyan (neutral: not red, green or the old sky-blue) for a NONE band', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: { r: -0.09, n: 249, band: 'none' } });
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

test('buildAiCorrelationCard returns empty string when band is null (insufficient history)', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: { r: null, n: 40, band: null } });
  assert.strictEqual(html, '');
});

test('buildAiCorrelationCard returns empty string when aiCorrelation is missing entirely', () => {
  assert.strictEqual(buildAiCorrelationCard({ aiCorrelation: null }), '');
  assert.strictEqual(buildAiCorrelationCard({}), '');
});

test('buildAiCorrelationFaqHtml renders all 5 FAQ entries when band is present', () => {
  const html = buildAiCorrelationFaqHtml({ aiCorrelation: { r: 0.68, n: 249, band: 'high' } });
  assert.match(html, /What is "AI Sector Correlation"\?/);
  assert.match(html, /How is it calculated\?/);
  assert.match(html, /Does a high score mean I should buy this stock\?/);
  assert.match(html, /Why might a genuinely AI-linked company still show "None"\?/);
  assert.match(html, /Why do some international stocks score lower than expected\?/);
});

test('buildAiCorrelationFaqHtml returns empty string when band is null', () => {
  assert.strictEqual(buildAiCorrelationFaqHtml({ aiCorrelation: { r: null, n: 40, band: null } }), '');
});

test('FAQ copy describes daily (not weekly) movements, matching the calculation', () => {
  const html = buildAiCorrelationFaqHtml({ aiCorrelation: { r: 0.68, n: 249, band: 'high' } });
  assert.match(html, /daily price movements/);
  assert.doesNotMatch(html, /weekly/);
});

test('the card links to the glossary page so readers can see how the number is calculated', () => {
  const html = buildAiCorrelationCard({ aiCorrelation: { r: 0.684, n: 249, band: 'high' } });
  assert.match(html, /<a href="\/glossary\/ai-sector-correlation\/">How it's calculated/);
});

test('the "How is it calculated?" FAQ answer links to the full glossary entry', () => {
  const html = buildAiCorrelationFaqHtml({ aiCorrelation: { r: 0.68, n: 249, band: 'high' } });
  const answer = html.split('How is it calculated?')[1].split('</details>')[0];
  assert.match(answer, /<a href="\/glossary\/ai-sector-correlation\/">full glossary entry<\/a>/);
});
