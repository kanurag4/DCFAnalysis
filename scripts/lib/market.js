// scripts/lib/market.js
// Pure: per-market risk-free + ERP seeds, mirroring app.js prefillInputs().
// `live` lets the orchestrator inject a freshly-fetched RF rate; otherwise
// the documented fallback is used (matches the live tool's fallbacks).
//
// 2026-09-06: consolidated -- the 9 markets this file shares with the live
// web tool (us/aus/ind/kor/jpn/uk/eu/hk/cn) now read straight from the
// vendored www/calc/assumptions.js instead of duplicating their own copy of
// FALLBACK_RF/MARKET_ERP/MARKET_TGROWTH. Duplicating them here is exactly
// what caused the Hong Kong/Switzerland-class bugs found 2026-09-06 (a rate
// refreshed in assumptions.js but never carried over here, or vice versa,
// plus an outright terminalGrowth-exceeds-rf ceiling violation that went
// undetected because nothing compared the two copies) -- see
// docs/risk-free-rates.md for the full incident writeup. The 6 ETF-radar-
// only markets below (Taiwan/Israel/Switzerland/Sweden/Norway/Singapore)
// plus KOSDAQ have no second copy anywhere else to drift against, so they
// stay as local literals.
const { FALLBACK_RF, MARKET_ERP, MARKET_TGROWTH, MARKET_TGROWTH_DEFAULT } = require('../../www/calc/assumptions.js');

// MARKET_TGROWTH's values are whole-percent (1.8 = 1.8%); this file's terminalGrowth
// is a decimal fraction. Plain `x / 100` lands on 0.018000000000000002 for some inputs
// (IEEE 754), which broke deepStrictEqual in market.test.js -- found 2026-09-06.
// Round-tripping through toFixed(6) forces the same nearest-double as the literal.
function pct(wholePercent) {
  return Number((wholePercent / 100).toFixed(6));
}

function marketParamsFor(ticker, live = {}) {
  const t = (ticker || '').toUpperCase();

  if (t.endsWith('.AX')) return { rf: live.ausRf ?? FALLBACK_RF.aus, erp: MARKET_ERP.aus, terminalGrowth: pct(MARKET_TGROWTH_DEFAULT) };

  // India (.NS/.BO): rf is spread-adjusted (raw G-Sec yield minus Damodaran's Baa3
  // default spread) -- see calc/assumptions.js's FALLBACK_RF.ind comment for the math
  // and docs/risk-free-rates.md for the current figures. erp/terminalGrowth are the
  // tool's India-specific seeds, also sourced from assumptions.js.
  if (t.endsWith('.NS') || t.endsWith('.BO')) return { rf: live.indRf ?? FALLBACK_RF.ind, erp: MARKET_ERP.ind, terminalGrowth: pct(MARKET_TGROWTH_DEFAULT) };

  // Korea: no live 10-yr KTB yield ticker exists on Yahoo (confirmed via exhaustive
  // search -- see docs/japan-korea-market-research.md), so rf/erp/terminalGrowth come
  // from assumptions.js's static tables, never live-fetched. `live.krRf` is accepted
  // (for API-shape parity with aus/ind) but intentionally ignored.
  if (t.endsWith('.KS')) return { rf: FALLBACK_RF.kor, erp: MARKET_ERP.kor, terminalGrowth: pct(MARKET_TGROWTH.kor) };

  // Japan: same "no live source" situation as Korea (10-yr JGB has no Yahoo symbol).
  if (t.endsWith('.T')) return { rf: FALLBACK_RF.jpn, erp: MARKET_ERP.jpn, terminalGrowth: pct(MARKET_TGROWTH.jpn) };

  // UK: no live 10-yr Gilt yield ticker on Yahoo.
  if (t.endsWith('.L')) return { rf: FALLBACK_RF.uk, erp: MARKET_ERP.uk, terminalGrowth: pct(MARKET_TGROWTH.uk) };

  // Eurozone: same "no live source" situation -- one bucket for every eurozone exchange
  // suffix (Germany/France/Netherlands/Italy/Spain/Belgium/Portugal/Austria/Finland/
  // Ireland), matching how ASX/NIFTY/etc. each get one rf regardless of which
  // state/exchange within that market a ticker is on.
  const EUROZONE_SUFFIXES = ['.DE', '.PA', '.AS', '.MI', '.MC', '.BR', '.LS', '.VI', '.HE', '.IR'];
  if (EUROZONE_SUFFIXES.some(sfx => t.endsWith(sfx))) return { rf: FALLBACK_RF.eu, erp: MARKET_ERP.eu, terminalGrowth: pct(MARKET_TGROWTH.eu) };

  // Hong Kong: same "no live source" situation. Unlike every other market seed, erp
  // here is NOT backed by a clean current Damodaran country-risk figure specifically
  // for Hong Kong (checked 2026-08-10) -- set at developed-market tier as a best
  // estimate. rf finally given a real verification 2026-09-06 (was a never-checked
  // 3.5% placeholder since this tool launched) -- see docs/risk-free-rates.md.
  if (t.endsWith('.HK')) return { rf: FALLBACK_RF.hk, erp: MARKET_ERP.hk, terminalGrowth: pct(MARKET_TGROWTH.hk) };

  // China A-shares (Shanghai .SS / Shenzhen .SZ): same "no live source" situation --
  // rf/erp sourced from Damodaran's country-risk dataset. Distinct from Hong Kong above
  // -- different currency (CNY vs HKD) and risk profile.
  if (t.endsWith('.SS') || t.endsWith('.SZ')) return { rf: FALLBACK_RF.cn, erp: MARKET_ERP.cn, terminalGrowth: pct(MARKET_TGROWTH.cn) };

  // ETF radar additions (2026-08-31): no www/ mirror exists for these -- the live web
  // tool's own market detection never routes to them (ETF-holdings look-through only),
  // so there's no second copy anywhere else to drift against. Static Damodaran-style
  // seeds, refreshed 2026-09-06 against TradingEconomics (Sept 4 2026 readings) -- see
  // docs/risk-free-rates.md's "Other markets" section for the full table and sourcing.
  if (t.endsWith('.TW')) return { rf: 0.0191, erp: 0.058, terminalGrowth: 0.012 };
  if (t.endsWith('.TA')) return { rf: 0.0298, erp: 0.072, terminalGrowth: 0.018 };
  // Switzerland: BUG FOUND + FIXED 2026-09-06 -- terminalGrowth (0.008) exceeded rf
  // (0.006), an outright Damodaran stable-growth-ceiling violation live since this
  // bucket was added 2026-08-31. rf also refreshed to the real current reading
  // (TradingEconomics: 0.42-0.44% Sept 4 2026); terminalGrowth lowered to restore the
  // ~55% ratio every other market bucket here uses.
  if (t.endsWith('.SW')) return { rf: 0.0043, erp: 0.05, terminalGrowth: 0.0024 };
  if (t.endsWith('.ST')) return { rf: 0.0309, erp: 0.052, terminalGrowth: 0.015 };
  if (t.endsWith('.OL')) return { rf: 0.0447, erp: 0.052, terminalGrowth: 0.018 };
  if (t.endsWith('.SI')) return { rf: 0.0238, erp: 0.053, terminalGrowth: 0.016 };
  // Denmark (.CO): added 2026-10-07 for the STOXX 600 Europe screen -- before this a Danish
  // ticker fell through to the US-seed default below (a ~5% US risk-free rate on a market
  // whose 10-yr yield tracks the Bund). DKK is pegged to the euro, Denmark is Aaa (same
  // Damodaran tier as Germany), so it reuses the eurozone bucket as a PROXY rather than a
  // separately sourced Danish yield -- revisit if a sourced DKK 10-yr reading is wanted.
  if (t.endsWith('.CO')) return { rf: FALLBACK_RF.eu, erp: MARKET_ERP.eu, terminalGrowth: pct(MARKET_TGROWTH.eu) };

  // KOSDAQ (.KQ): same market as KOSPI (.KS) for valuation-parameter purposes -- reuses
  // the Korea branch's values directly rather than a separate hardcoded copy (that
  // separate copy was itself found to be a drift risk 2026-09-04 -- this fixes it).
  if (t.endsWith('.KQ')) return { rf: FALLBACK_RF.kor, erp: MARKET_ERP.kor, terminalGrowth: pct(MARKET_TGROWTH.kor) };

  if (!t.includes('.')) return { rf: live.usRf ?? FALLBACK_RF.us, erp: MARKET_ERP.us, terminalGrowth: pct(MARKET_TGROWTH_DEFAULT) };
  return { rf: live.usRf ?? FALLBACK_RF.us, erp: MARKET_ERP.us, terminalGrowth: pct(MARKET_TGROWTH_DEFAULT) }; // other international — conservative US-style seed
}

module.exports = { marketParamsFor };
