// scripts/lib/market.js
// Pure: per-market risk-free + ERP seeds, mirroring app.js prefillInputs().
// `live` lets the orchestrator inject a freshly-fetched RF rate; otherwise
// the documented fallback is used (matches the live tool's fallbacks).
function marketParamsFor(ticker, live = {}) {
  const t = (ticker || '').toUpperCase();
  if (t.endsWith('.AX')) return { rf: live.ausRf ?? 0.048, erp: 0.06, terminalGrowth: 0.025 };
  // India (.NS/.BO): rf was the raw 10-yr G-Sec yield (~6.8-7%) until 2026-08-15 --
  // that double-counts country risk, since erp already carries India's country risk
  // premium (Damodaran's ~7.1-7.3% total ERP for India). Damodaran's own convention:
  // riskfree rate = government bond rate minus that country's default spread. India is
  // Baa3-rated with a 1.87% default spread (Damodaran, Jan 2026) -- 6.8% G-Sec yield -
  // 1.87% ≈ 4.9%. erp is left unchanged (already close to Damodaran's figure). terminalGrowth
  // is ALSO left at 0.025 -- that's a 51% ratio to the corrected 4.9% rf, right in the
  // ~40-57% band every other market bucket in this file already uses (ASX 52%, US 56%,
  // UK 40%, eurozone 56%, HK 57%) -- Damodaran's own rule is only a ceiling ("stable
  // growth should not exceed the riskfree rate"), no specific numeric gap below it, so
  // there's no reason to push India toward China's 88%-of-rf outlier ratio instead.
  if (t.endsWith('.NS') || t.endsWith('.BO')) return { rf: live.indRf ?? 0.049, erp: 0.075, terminalGrowth: 0.025 };
  // Korea: no live 10-yr KTB yield ticker exists on Yahoo (confirmed via exhaustive search —
  // see docs/japan-korea-market-research.md) so rf is a fixed static value, never live-fetched.
  // rf corrected 2026-08-15: was the raw ~4.3% KTB yield, which double-counts country risk
  // the same way India's did -- Korea is Aa2-rated with a 0.42% default spread (Damodaran,
  // Jan 2026), so 4.29% (spot, Aug 2026) - 0.42% ~= 3.9%. terminalGrowth is UNCHANGED --
  // 1.75% against the corrected 3.9% rf is a ~45% ratio, already in the same ~40-57% band
  // every other market bucket here uses, so no reason to touch it. erp is elevated to
  // reflect a governance-risk premium (weak minority-shareholder protections) -- left as-is,
  // not re-verified against Damodaran's Korea-specific figure in this pass.
  if (t.endsWith('.KS')) return { rf: 0.039, erp: 0.075, terminalGrowth: 0.0175 };
  // Japan: same "no live RF ticker" situation as Korea (10-yr JGB has no Yahoo symbol —
  // see docs/japan-korea-market-research.md). rf corrected 2026-08-15: was the raw ~2.8%
  // JGB yield -- Japan is A1-rated with a 0.60% default spread (Damodaran, Jan 2026), so
  // 2.84% (spot, Aug 2026) - 0.60% ~= 2.2%. terminalGrowth lowered 1.5%->1.2% too: against
  // the OLD 2.8% rf, 1.5% was a 54% ratio (in-band); against the corrected 2.2% rf it would
  // become 68%, drifting out of the ~40-57% band every other market uses -- 1.2% restores
  // ~55%. Not a ceiling violation either way (1.5% < 2.2%), just an internal-consistency
  // nudge, same reasoning as India's "why touch/not touch terminalGrowth" note above. erp
  // is developed-market tier (~AUS level) -- left as-is.
  if (t.endsWith('.T')) return { rf: 0.022, erp: 0.06, terminalGrowth: 0.012 };
  // UK: no live 10-yr Gilt yield ticker on Yahoo (same "no live source" situation as
  // Korea/Japan) -- fixed rf reflects the ~5.0% Gilt regime (spot-checked 2026-08-03).
  // erp/terminalGrowth are near-US-tier (mature, liquid developed market).
  if (t.endsWith('.L')) return { rf: 0.050, erp: 0.06, terminalGrowth: 0.02 };
  // Eurozone: same "no live source" situation -- fixed rf reflects the ~3.2% Bund
  // regime (spot-checked 2026-08-03). One bucket for every eurozone exchange suffix
  // (Germany/France/Netherlands/Italy/Spain/Belgium/Portugal/Austria/Finland/Ireland) --
  // the DCF discount rate is already a market-wide seed, not a country-specific one,
  // matching how ASX/NIFTY/etc. each get one rf regardless of which state/exchange
  // within that market a ticker is on.
  const EUROZONE_SUFFIXES = ['.DE', '.PA', '.AS', '.MI', '.MC', '.BR', '.LS', '.VI', '.HE', '.IR'];
  if (EUROZONE_SUFFIXES.some(sfx => t.endsWith(sfx))) return { rf: 0.032, erp: 0.055, terminalGrowth: 0.018 };
  // Hong Kong: same "no live source" situation as Korea/Japan/UK/eurozone -- fixed rf
  // is an approximate HK Exchange Fund Note yield. Unlike every other market seed here,
  // erp is NOT backed by a clean current Damodaran country-risk figure specifically for
  // Hong Kong (checked 2026-08-10) -- set at developed-market tier (same as UK/Japan) as
  // a best estimate. Backported from www/dcf/app.js's HK_RF/HK_ERP/HK_TGROWTH (commit
  // 98dc69d) -- keep these two in sync if the live tool's seed ever changes.
  if (t.endsWith('.HK')) return { rf: 0.035, erp: 0.06, terminalGrowth: 0.02 };
  // China A-shares (Shanghai .SS / Shenzhen .SZ): same "no live source" situation --
  // rf/erp sourced from Damodaran's country-risk dataset (checked 2026-08-10). Distinct
  // from Hong Kong above -- different currency (CNY vs HKD) and risk profile.
  // rf corrected 2026-08-15: 0.017 was the raw ~1.7% CNY govt bond yield -- same
  // double-counting issue India/Japan/Korea had, and here it's proportionally the
  // largest of the four, since China's default spread (A1-rated, 0.60%, Damodaran
  // Jan 2026) is a big chunk of its already-tiny base yield: 1.70% (spot, Aug 2026) -
  // 0.60% ~= 1.1%. terminalGrowth MUST also drop as a direct consequence -- the old
  // 0.015 (set 2026-08-11 specifically to sit under the old 0.017 rf) now exceeds the
  // corrected 0.011 rf outright, which would violate Damodaran's stable-growth ceiling
  // (terminal growth can't exceed the risk-free rate proxy for long-run economy growth
  // in perpetuity) the moment rf changed under it. Lowered to 0.006 -- a ~55% ratio to
  // the new rf, back in the same ~40-57% band every other market bucket here uses,
  // rather than picking another value that just barely clears the new lower ceiling.
  // Backported from www/dcf/app.js's CHINA_RF/CHINA_ERP/CHINA_TGROWTH (commit 98dc69d)
  // -- keep these two in sync if the live tool's seed ever changes.
  if (t.endsWith('.SS') || t.endsWith('.SZ')) return { rf: 0.011, erp: 0.052, terminalGrowth: 0.006 };
  // ETF radar additions (2026-08-31): suffixes that thematic-fund holdings pull in
  // and that currently hit the generic US-style fallback. No live govt-bond ticker
  // on Yahoo for any of these -> static seeds, Damodaran country-risk-based, same
  // "documented, refine later" convention as every non-US bucket above.
  // Taiwan (.TW): rf ~1.7% 10-yr TGB spot (Aug 2026) minus Taiwan's ~0.5% default
  // spread (Aa3, Damodaran Jan 2026) ~= 1.2% -- but the raw yield is already so low
  // that keeping rf at the raw 1.7% and setting terminalGrowth well under it (0.012,
  // ~70% ratio) is the internally-consistent choice, same posture as China's
  // tiny-base-yield handling above. erp elevated ~0.3pp over the developed-market
  // tier for Taiwan Strait geopolitical risk (Damodaran country ERP).
  if (t.endsWith('.TW')) return { rf: 0.017, erp: 0.058, terminalGrowth: 0.012 };
  // Israel (.TA): rf ~4.0% 10-yr Shekel bond spot minus ~0.9% default spread
  // (A2, Damodaran Jan 2026) ~= 3.1%. erp carries an elevated country-risk premium.
  if (t.endsWith('.TA')) return { rf: 0.031, erp: 0.072, terminalGrowth: 0.018 };
  // Switzerland (.SW): rf ~0.6% 10-yr Confederation bond (structurally low-yield
  // safe haven); terminalGrowth 0.008 keeps a ~55% ratio. AAA, zero default spread.
  if (t.endsWith('.SW')) return { rf: 0.006, erp: 0.05, terminalGrowth: 0.008 };
  // Sweden (.ST) / Norway (.OL): rf ~2.4% / ~3.5% 10-yr govt bond spot; both AAA
  // (zero default spread). Developed-market erp.
  if (t.endsWith('.ST')) return { rf: 0.024, erp: 0.052, terminalGrowth: 0.015 };
  if (t.endsWith('.OL')) return { rf: 0.035, erp: 0.052, terminalGrowth: 0.018 };
  // Singapore (.SI): rf ~2.5% 10-yr SGS bond; AAA. Developed-market erp.
  if (t.endsWith('.SI')) return { rf: 0.025, erp: 0.053, terminalGrowth: 0.016 };
  // KOSDAQ (.KQ): same market as KOSPI (.KS) for valuation-parameter purposes.
  if (t.endsWith('.KQ')) return { rf: 0.039, erp: 0.075, terminalGrowth: 0.0175 };
  if (!t.includes('.')) return { rf: live.usRf ?? 0.045, erp: 0.055, terminalGrowth: 0.025 };
  return { rf: live.usRf ?? 0.045, erp: 0.055, terminalGrowth: 0.025 }; // other international — conservative US-style seed
}

module.exports = { marketParamsFor };
