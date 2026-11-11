// www/dcf/chart-model.js — DOM-free. Geometry and collision-free labels for /dcf/'s year-by-year value chart (P62,
// docs/superpowers/specs/2026-11-10-interactive-dcf-results-design.md "Right 2"). app.js turns the result into an
// inline <svg>; every decision about scale, ticks and where each label goes is made here so it can be tested.
//
// Rules (user, 2026-11-10: "never overlapping, never squashed"):
// - The y-range comes from the three lines and the price only; a target outside it becomes an edge marker.
// - Labels: Base first (above its point), then Bull (above), then Bear (below). On a collision try the other side;
//   interior years may then be dropped; first and last years are nudged vertically instead, never dropped.
// - Compact (narrow, or more than 6 years): interior years thinned to every other year, first and last kept.
// - The price label and the line names sit outside the plot on the right.
// Authored in StockAnalysis www/dcf/, vendored byte-identical into DCFAnalysis www/ (pair "dcf-chart-model").

const CM_LABEL_H = 14;
const CM_GAP = 5;
const CM_KEYS = ['base', 'bull', 'bear'];
const CM_NAMES = { bull: 'Bull', base: 'Base', bear: 'Bear' };

function cmTextWidth(text) { return text.length * 6.6 + 4; }

function cmMoney(v, prefix) {
  const p = prefix == null ? '$' : prefix;
  if (v == null || !isFinite(v)) return '';
  const a = Math.abs(v);
  const body = a >= 1000 ? Math.round(a).toLocaleString('en-US') : a.toFixed(2);
  return (v < 0 ? '-' : '') + p + body;
}

function cmNiceStep(raw) {
  if (!(raw > 0)) return 1;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / pow;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return nice * pow;
}

function cmIntersects(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function buildChartModel({ paths, price, target, width, height, compact, prefix }) {
  const keys = CM_KEYS.filter(k => paths && Array.isArray(paths[k]) && paths[k].length > 1);
  const N = keys.length ? paths[keys[0]].length - 1 : 1;
  const isCompact = compact != null ? !!compact : (width < 520 || N > 6);
  const fmt = v => cmMoney(v, prefix);

  // Domain: lines + price only.
  const vals = [];
  keys.forEach(k => paths[k].forEach(v => { if (isFinite(v)) vals.push(v); }));
  if (isFinite(price)) vals.push(price);
  const minV = vals.length ? Math.min.apply(null, vals) : 0;
  const maxV = vals.length ? Math.max.apply(null, vals) : 1;
  let hi = Math.max(maxV, 0) * 1.12;
  let lo = Math.min(0, minV);
  if (lo < 0) lo -= (hi - lo) * 0.08;
  if (!(hi > lo)) hi = lo + 1;

  const priceText = 'Price ' + fmt(price);
  const left = 52, top = 18, bottom = 30;
  const right = Math.max(64, cmTextWidth(priceText) + 12);
  const plotW = Math.max(40, width - left - right);
  const plotH = Math.max(40, height - top - bottom);
  const x = t => left + plotW * t / N;
  const y = v => top + plotH * (1 - (v - lo) / (hi - lo));

  const step = cmNiceStep((hi - lo) / 5);
  const yTicks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
    const vv = Math.abs(v) < step * 1e-9 ? 0 : +v.toPrecision(12);
    yTicks.push({ v: vv, y: y(vv), label: fmt(vv) });
  }

  const lines = keys.map(k => ({ key: k, points: paths[k].map((v, t) => ({ t, x: x(t), y: y(v), v })) }));

  // Price label: outside the plot on the right, centred on the price line.
  const py = y(price);
  const priceBox = { x: left + plotW + 6, y: py - CM_LABEL_H / 2, w: cmTextWidth(priceText), h: CM_LABEL_H };
  const priceLine = { y: py, label: priceText, box: priceBox };

  // Point labels.
  const placed = [];
  const shown = t => !isCompact || t === 0 || t === N || t % 2 === 0;
  const fits = b => b.y >= 0 && b.y + b.h <= height && !placed.some(p => cmIntersects(p, b)) && !cmIntersects(b, priceBox);
  const boxAt = (px, yTop, text, t) => {
    const w = cmTextWidth(text);
    let bx = px - w / 2;
    if (t === 0) bx = px;               // first point: label runs right
    if (t === N) bx = px - w;           // last point: label runs left
    bx = Math.min(Math.max(bx, left), left + plotW - w);
    return { x: bx, y: yTop, w, h: CM_LABEL_H };
  };
  const labels = [];
  for (const k of keys) {
    const pref = k === 'bear' ? 'below' : 'above';
    for (let t = 0; t <= N; t++) {
      if (!shown(t)) continue;
      const v = paths[k][t];
      if (!isFinite(v)) continue;
      const text = fmt(v);
      const px = x(t), pyv = y(v);
      const above = pyv - CM_GAP - CM_LABEL_H, below = pyv + CM_GAP;
      const order = pref === 'above' ? [above, below] : [below, above];
      let box = null;
      for (const yt of order) { const b = boxAt(px, yt, text, t); if (fits(b)) { box = b; break; } }
      const mustKeep = k === 'base' || t === 0 || t === N;
      if (!box && mustKeep) {
        for (let d = 4; d <= 96 && !box; d += 4) {
          for (const yt of [order[0] - d, order[0] + d, order[1] - d, order[1] + d]) {
            const b = boxAt(px, yt, text, t);
            if (fits(b)) { box = b; break; }
          }
        }
      }
      if (!box) continue;
      placed.push(box);
      labels.push({ key: k, t, x: box.x, y: box.y, w: box.w, h: box.h, text, anchor: 'start', bold: k === 'base' });
    }
  }

  // Line names at the right end, in the margin, clear of the price label and each other.
  const endPlaced = [priceBox];
  const endLabels = [];
  for (const k of ['bull', 'base', 'bear'].filter(kk => keys.indexOf(kk) >= 0)) {
    const v = paths[k][N];
    if (!isFinite(v)) continue;
    const text = CM_NAMES[k];
    const w = cmTextWidth(text);
    let box = null;
    for (let d = 0; d <= 60 && !box; d += 2) {
      for (const yy of d === 0 ? [y(v) - CM_LABEL_H / 2] : [y(v) - CM_LABEL_H / 2 - d, y(v) - CM_LABEL_H / 2 + d]) {
        const b = { x: left + plotW + 6, y: yy, w, h: CM_LABEL_H };
        if (b.y >= 0 && b.y + b.h <= height && !endPlaced.some(p => cmIntersects(p, b))) { box = b; break; }
      }
    }
    if (!box) continue;
    endPlaced.push(box);
    endLabels.push({ key: k, t: N, x: box.x, y: box.y, w: box.w, h: box.h, text });
  }

  // Target.
  let targetMarker = null;
  if (target && isFinite(target.value)) {
    const label = 'Target ' + fmt(target.value);
    const tx = target.kind === 'year-n' ? x(N) : null;
    if (target.value > hi) targetMarker = { edge: 'top', label, x: tx };
    else if (target.value < lo) targetMarker = { edge: 'bottom', label, x: tx };
    else targetMarker = { y: y(target.value), label, x: tx };
  }

  return {
    width, height, plot: { left, top, width: plotW, height: plotH }, domain: [lo, hi], years: N, compact: isCompact,
    yTicks, lines, labels, endLabels, priceLine, targetMarker,
    xTicks: Array.from({ length: N + 1 }, (_, t) => ({ t, x: x(t), label: t === 0 ? 'Today' : (isCompact && N > 6 ? String(t) : 'Year ' + t) })),
  };
}

if (typeof module !== 'undefined') module.exports = { buildChartModel, cmMoney };
if (typeof window !== 'undefined') { window.buildChartModel = buildChartModel; window.cmMoney = cmMoney; }
