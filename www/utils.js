function safe(v) {
  return (v != null && isFinite(v)) ? v : null;
}

function fmt(v, decimals = 1, suffix = '', prefix = '') {
  const s = safe(v);
  return s !== null ? `${prefix}${s.toFixed(decimals)}${suffix}` : 'N/A';
}

function formatMarketCap(v, sym = '') {
  const s = safe(v);
  if (s === null) return 'N/A';
  if (Math.abs(s) >= 1e12) return `${sym}${(s / 1e12).toFixed(2)}T`;
  if (Math.abs(s) >= 1e9)  return `${sym}${(s / 1e9).toFixed(2)}B`;
  if (Math.abs(s) >= 1e6)  return `${sym}${(s / 1e6).toFixed(1)}M`;
  return `${sym}${s.toFixed(0)}`;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function isFinancialSector(sector) {
  return !!(sector && /financial|insurance/i.test(sector));
}

function isRealEstateSector(sector) {
  return !!(sector && /real estate/i.test(sector));
}

// Average of revenueGrowth + earningsGrowth, clamped to [-0.05, 0.25]. Falls back to 0.05.
function deriveBaseGrowth(revenueGrowth, earningsGrowth) {
  const valid = [revenueGrowth, earningsGrowth].filter(v => safe(v) !== null);
  if (valid.length === 0) return 0.05;
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  return Math.max(-0.05, Math.min(0.25, avg));
}

if (typeof module !== 'undefined') module.exports = {
  safe, fmt, formatMarketCap, escapeHtml,
  isFinancialSector, isRealEstateSector, deriveBaseGrowth,
};
