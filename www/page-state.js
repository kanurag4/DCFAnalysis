// www/dcf/page-state.js — DOM-free. /dcf/'s assumption state (P62,
// docs/superpowers/specs/2026-11-10-interactive-dcf-results-design.md): the Bear/Base/Bull inputs behind the
// sliders, re-deriving Bear and Bull when a Base slider moves (today's spreads from calc/assumptions.js), whether the
// visitor has changed anything ("Your numbers"), and the shareable link (only the changed fields go in the URL).
//
// State = { model, years, midYear, fade, beta: 'stock'|'industry'|'custom', growth, tgrowth, discount, multiple,
// start }, each of growth/tgrowth/discount/multiple either { bear, base, bull } or null when the model has no such
// input. URL names: g (growth, or the multiple for REIT/airline) t (terminal) w (discount) y (years) s (starting
// figure) m (mid-year) f (fade) beta (=industry) and gb gu tb tu wb wu for Bear/Bull cells that differ from the
// re-derived values. A discount is only written when the visitor set it (beta 'custom'); with beta=industry the page
// recomputes it from the industry beta.
// Authored in StockAnalysis www/dcf/, vendored byte-identical into DCFAnalysis www/ (pair "dcf-page-state").

const PS_RANGES = { growth: [-50, 150], multiple: [0.5, 200], tgrowth: [0, 10], discount: [0.5, 60] };
const PS_URL = { growth: 'g', tgrowth: 't', discount: 'w', multiple: 'g' };

function psCopy(o) { return JSON.parse(JSON.stringify(o)); }

function psFromSeeds(model, seeds, extras) {
  const x = extras || {};
  const pick = k => (seeds && seeds[k] && seeds[k].base != null ? { bear: seeds[k].bear, base: seeds[k].base, bull: seeds[k].bull } : null);
  const multipleModel = model === 'reit' || model === 'airline';
  return {
    model,
    years: x.years != null ? x.years : 5,
    midYear: !!x.midYear,
    fade: !!x.fade,
    beta: 'stock',
    growth: multipleModel ? null : pick('growth'),
    tgrowth: (model === 'dcf' || model === 'ddm') ? pick('tgrowth') : null,
    discount: multipleModel ? null : pick('discount'),
    multiple: multipleModel ? pick('multiple') : null,
    start: x.start != null ? x.start : null,
  };
}

// Bear/Bull for a Base value, with today's spreads.
function psDerived(state, field, base) {
  if (field === 'growth') {
    const sp = state.model === 'excess-return' ? roeOffsetSpread(base) : growthOffsetSpread(base);
    return { bear: sp.bear, base, bull: sp.bull };
  }
  if (field === 'discount') { const sp = discountRateSpread(base); return { bear: sp.bear, base, bull: sp.bull }; }
  if (field === 'multiple') return { bear: +(base * 0.8).toFixed(1), base, bull: +(base * 1.2).toFixed(1) };
  return { bear: base, base, bull: base }; // tgrowth
}

function psSetBase(state, field, value) {
  const s = psCopy(state);
  if (!s[field]) return s;
  s[field] = psDerived(s, field, value);
  if (field === 'discount') s.beta = 'custom';
  return s;
}

function psSetCell(state, field, key, value) {
  const s = psCopy(state);
  if (!s[field]) return s;
  s[field][key] = value;
  return s;
}

function psIsEdited(state, ours) {
  return JSON.stringify(state) !== JSON.stringify(ours);
}

function psNum(v) { return String(+(+v).toFixed(4)); }

function psEncode(state, ours) {
  const out = [];
  const field = (f, allow) => {
    const cur = state[f];
    if (!cur || !allow) return;
    const name = PS_URL[f];
    const baseMoved = !ours[f] || cur.base !== ours[f].base;
    if (baseMoved) out.push(name + '=' + psNum(cur.base));
    // What decode will produce for the cells without a cell param: our own seeds while the Base is untouched (they
    // need not equal today's spread, e.g. DDM's dividend-derived Bear/Bull), else the re-derived spread.
    const d = baseMoved ? psDerived(state, f, cur.base) : ours[f];
    if (cur.bear !== d.bear) out.push(name + 'b=' + psNum(cur.bear));
    if (cur.bull !== d.bull) out.push(name + 'u=' + psNum(cur.bull));
  };
  field(state.multiple ? 'multiple' : 'growth', true);
  field('tgrowth', true);
  field('discount', state.beta === 'custom');
  if (state.years !== ours.years) out.push('y=' + state.years);
  if (state.start !== ours.start && state.start != null) out.push('s=' + psNum(state.start));
  if (state.midYear !== ours.midYear) out.push('m=' + (state.midYear ? 1 : 0));
  if (state.fade !== ours.fade) out.push('f=' + (state.fade ? 1 : 0));
  if (state.beta === 'industry') out.push('beta=industry');
  return out.join('&');
}

function psDecode(query, ours, opts) {
  const p = new URLSearchParams(String(query || '').replace(/^\?/, ''));
  let s = psCopy(ours);
  const num = (name, range) => {
    if (!p.has(name)) return null;
    const raw = p.get(name);
    if (raw === '' || !/^-?\d+(\.\d+)?(e\d+)?$/i.test(raw.trim())) return null;
    const v = Number(raw);
    if (!isFinite(v)) return null;
    if (range && (v < range[0] || v > range[1])) return null;
    return v;
  };
  const fields = [ours.multiple ? 'multiple' : 'growth', 'tgrowth', 'discount'];
  for (const f of fields) {
    if (!s[f]) continue;
    const name = PS_URL[f];
    const base = num(name, PS_RANGES[f]);
    if (base != null) s = psSetBase(s, f, base);
    const bear = num(name + 'b', PS_RANGES[f]);
    const bull = num(name + 'u', PS_RANGES[f]);
    if (bear != null) s = psSetCell(s, f, 'bear', bear);
    if (bull != null) s = psSetCell(s, f, 'bull', bull);
  }
  const y = num('y', [3, 10]);
  if (y != null && Number.isInteger(y)) s.years = y;
  const st = num('s', [Number.MIN_VALUE, Infinity]);
  if (st != null) s.start = st;
  if (p.get('m') === '1' || p.get('m') === '0') s.midYear = p.get('m') === '1';
  if (p.get('f') === '1' || p.get('f') === '0') s.fade = p.get('f') === '1';
  if (p.get('beta') === 'industry' && opts && opts.betaAllowed && s.beta !== 'custom' && s.discount) s.beta = 'industry';
  return s;
}

if (typeof module !== 'undefined') module.exports = { psFromSeeds, psSetBase, psSetCell, psIsEdited, psEncode, psDecode };
if (typeof window !== 'undefined') { window.psFromSeeds = psFromSeeds; window.psSetBase = psSetBase; window.psSetCell = psSetCell; window.psIsEdited = psIsEdited; window.psEncode = psEncode; window.psDecode = psDecode; }
