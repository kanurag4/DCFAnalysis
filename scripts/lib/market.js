// scripts/lib/market.js
// Pure: per-market risk-free + ERP seeds, mirroring app.js prefillInputs().
// `live` lets the orchestrator inject a freshly-fetched RF rate; otherwise
// the documented fallback is used (matches the live tool's fallbacks).
function marketParamsFor(ticker, live = {}) {
  const t = (ticker || '').toUpperCase();
  // AU/US fallbacks corrected 2026-09-02 (was 0.048/0.045) -- found live-testing the
  // multi-year growth work: AU's live fetch (^GSBG10.AX, see rf.js's fetchAusRf) has
  // been silently 404ing, so this static fallback is what actually feeds every batch
  // consumer (6 screens, ETF radar, ticker pages) via this file, completely
  // independently of www/dcf/calc/assumptions.js's FALLBACK_RF (also corrected the
  // same day) and app.js's own inline defaults -- THREE separate copies of the same
  // conceptual data, discovered out of sync in the same session. Keep all three in
  // sync by hand until they're consolidated into one source (see docs/TODO.md P6).
  // ind/kor/jpn/eu/uk/cn rf refreshed again 2026-09-04 against fresh raw 10yr yields --
  // same Damodaran default spreads kept unchanged for the 4 spread-adjusted markets
  // (ratings move far slower than yields); hk deliberately left stale, no trustworthy
  // current figure found. Applied to all 3 copies (this file, assumptions.js, app.js's
  // liveIndRfRate) in the same pass -- see docs/TODO.md P4.
  // hk/tw/il/ch/se/no/si rf refreshed 2026-09-06 -- hk finally got a trustworthy current
  // figure; tw/il/se/no/si were simple raw-yield updates; ch (Switzerland) also fixed a
  // real terminalGrowth-exceeds-rf ceiling violation found in the same pass. This same
  // 09-04 session also found app.js's KOR_RF/JPN_RF/UK_RF/EU_RF/HK_RF/CHINA_RF constants
  // (a FOURTH copy, display-only but also what recomputeDiscount() uses on "Adjust
  // assumptions" -- see app.js) had been silently missed by the 09-04 refresh entirely --
  // fixed in the same pass. See docs/risk-free-rates.md.
  if (t.endsWith('.AX')) return { rf: live.ausRf ?? 0.052, erp: 0.06, terminalGrowth: 0.025 };
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
  // rf refreshed 2026-09-04: raw G-Sec 6.96% (Sept 1) - unchanged 1.87% spread ~= 5.09%.
  if (t.endsWith('.NS') || t.endsWith('.BO')) return { rf: live.indRf ?? 0.0509, erp: 0.075, terminalGrowth: 0.025 };
  // Korea: no live 10-yr KTB yield ticker exists on Yahoo (confirmed via exhaustive search —
  // see docs/japan-korea-market-research.md) so rf is a fixed static value, never live-fetched.
  // rf corrected 2026-08-15: was the raw ~4.3% KTB yield, which double-counts country risk
  // the same way India's did -- Korea is Aa2-rated with a 0.42% default spread (Damodaran,
  // Jan 2026), so 4.29% (spot, Aug 2026) - 0.42% ~= 3.9%. terminalGrowth is UNCHANGED --
  // 1.75% against the corrected 3.9% rf is a ~45% ratio, already in the same ~40-57% band
  // every other market bucket here uses, so no reason to touch it. erp is elevated to
  // reflect a governance-risk premium (weak minority-shareholder protections) -- left as-is,
  // not re-verified against Damodaran's Korea-specific figure in this pass.
  // rf refreshed 2026-09-04: raw yield 4.42% (Sept 2, 2 sources) - unchanged 0.42% spread ~= 4.0%.
  if (t.endsWith('.KS')) return { rf: 0.040, erp: 0.075, terminalGrowth: 0.0175 };
  // Japan: same "no live RF ticker" situation as Korea (10-yr JGB has no Yahoo symbol —
  // see docs/japan-korea-market-research.md). rf corrected 2026-08-15: was the raw ~2.8%
  // JGB yield -- Japan is A1-rated with a 0.60% default spread (Damodaran, Jan 2026), so
  // 2.84% (spot, Aug 2026) - 0.60% ~= 2.2%. terminalGrowth lowered 1.5%->1.2% too: against
  // the OLD 2.8% rf, 1.5% was a 54% ratio (in-band); against the corrected 2.2% rf it would
  // become 68%, drifting out of the ~40-57% band every other market uses -- 1.2% restores
  // ~55%. Not a ceiling violation either way (1.5% < 2.2%), just an internal-consistency
  // nudge, same reasoning as India's "why touch/not touch terminalGrowth" note above. erp
  // is developed-market tier (~AUS level) -- left as-is.
  // rf refreshed 2026-09-04: raw JGB yield 2.96% (Sept 4) - unchanged 0.60% spread ~= 2.36%.
  if (t.endsWith('.T')) return { rf: 0.0236, erp: 0.06, terminalGrowth: 0.012 };
  // UK: no live 10-yr Gilt yield ticker on Yahoo (same "no live source" situation as
  // Korea/Japan) -- fixed rf reflects the ~5.0% Gilt regime (spot-checked 2026-08-03).
  // erp/terminalGrowth are near-US-tier (mature, liquid developed market).
  // rf refreshed 2026-09-04: raw Gilt yield 5.07% (Sept 2026).
  if (t.endsWith('.L')) return { rf: 0.0507, erp: 0.06, terminalGrowth: 0.02 };
  // Eurozone: same "no live source" situation -- fixed rf reflects the ~3.2% Bund
  // regime (spot-checked 2026-08-03). One bucket for every eurozone exchange suffix
  // (Germany/France/Netherlands/Italy/Spain/Belgium/Portugal/Austria/Finland/Ireland) --
  // the DCF discount rate is already a market-wide seed, not a country-specific one,
  // matching how ASX/NIFTY/etc. each get one rf regardless of which state/exchange
  // within that market a ticker is on.
  const EUROZONE_SUFFIXES = ['.DE', '.PA', '.AS', '.MI', '.MC', '.BR', '.LS', '.VI', '.HE', '.IR'];
  // rf refreshed 2026-09-04: raw German Bund yield 3.35% (Sept 3).
  if (EUROZONE_SUFFIXES.some(sfx => t.endsWith(sfx))) return { rf: 0.0335, erp: 0.055, terminalGrowth: 0.018 };
  // Hong Kong: same "no live source" situation as Korea/Japan/UK/eurozone -- fixed rf
  // is an approximate HK Exchange Fund Note yield. Unlike every other market seed here,
  // erp is NOT backed by a clean current Damodaran country-risk figure specifically for
  // Hong Kong (checked 2026-08-10) -- set at developed-market tier (same as UK/Japan) as
  // a best estimate. Backported from www/dcf/app.js's HK_RF/HK_ERP/HK_TGROWTH (commit
  // 98dc69d) -- keep these two in sync if the live tool's seed ever changes.
  // rf refreshed 2026-09-06: first trustworthy current figure found (TradingEconomics,
  // 3.65% Sept 4 2026, corroborated by an HKMA 10yr institutional bond tender on Aug 12
  // 2026 at 3.58%) -- was 0.035, a long-standing placeholder never actually verified.
  if (t.endsWith('.HK')) return { rf: 0.0365, erp: 0.06, terminalGrowth: 0.02 };
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
  // rf refreshed 2026-09-04: raw yield 1.68% (Sept 1) - unchanged 0.60% spread ~= 1.08% (smallest move).
  if (t.endsWith('.SS') || t.endsWith('.SZ')) return { rf: 0.0108, erp: 0.052, terminalGrowth: 0.006 };
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
  // rf refreshed 2026-09-06: raw TGB yield 1.91% (TradingEconomics, Sept 4 2026).
  // terminalGrowth kept at 0.012 (now a ~63% ratio) -- same tiny-base-yield exception
  // as before, not a ceiling violation (0.012 < 0.0191).
  if (t.endsWith('.TW')) return { rf: 0.0191, erp: 0.058, terminalGrowth: 0.012 };
  // Israel (.TA): rf ~4.0% 10-yr Shekel bond spot minus ~0.9% default spread
  // (A2, Damodaran Jan 2026) ~= 3.1%. erp carries an elevated country-risk premium.
  // rf refreshed 2026-09-06: raw yield 3.88% (TradingEconomics, Sept 4 2026) minus the
  // unchanged 0.9% spread ~= 2.98%.
  if (t.endsWith('.TA')) return { rf: 0.0298, erp: 0.072, terminalGrowth: 0.018 };
  // Switzerland (.SW): rf ~0.6% 10-yr Confederation bond (structurally low-yield
  // safe haven); terminalGrowth 0.008 keeps a ~55% ratio. AAA, zero default spread.
  // BUG FOUND + FIXED 2026-09-06: that "~55% ratio" comment was never actually true --
  // 0.008 / 0.006 = 133%, an outright Damodaran stable-growth-ceiling violation
  // (terminalGrowth > rf) that had been live since this bucket was added 2026-08-31.
  // Also refreshed the rf itself against a real current reading: TradingEconomics has
  // the actual Swiss 10yr yield at just 0.42-0.44% (Sept 4 2026) -- the original 0.6%
  // was never a verified figure either. terminalGrowth lowered to 0.0024 to restore the
  // same ~55% ratio every other market bucket in this file uses.
  if (t.endsWith('.SW')) return { rf: 0.0043, erp: 0.05, terminalGrowth: 0.0024 };
  // Sweden (.ST) / Norway (.OL): rf ~2.4% / ~3.5% 10-yr govt bond spot; both AAA
  // (zero default spread). Developed-market erp.
  // rf refreshed 2026-09-06 (TradingEconomics, Sept 4 2026): Sweden 3.09% (was a stale
  // 2.4% -- the biggest gap found in this pass), Norway 4.47% (was a stale 3.5%, driven
  // by Norges Bank's rate-hike cycle through 2026). terminalGrowth ratios land at ~49%
  // (Sweden) and ~40% (Norway) against the corrected rf -- both still in-band, no change.
  if (t.endsWith('.ST')) return { rf: 0.0309, erp: 0.052, terminalGrowth: 0.015 };
  if (t.endsWith('.OL')) return { rf: 0.0447, erp: 0.052, terminalGrowth: 0.018 };
  // Singapore (.SI): rf ~2.5% 10-yr SGS bond; AAA. Developed-market erp.
  // rf refreshed 2026-09-06: 2.38% (TradingEconomics, Sept 4 2026).
  if (t.endsWith('.SI')) return { rf: 0.0238, erp: 0.053, terminalGrowth: 0.016 };
  // KOSDAQ (.KQ): same market as KOSPI (.KS) for valuation-parameter purposes.
  // A separate hardcoded copy, not derived from the .KS branch -- keep in sync by hand.
  if (t.endsWith('.KQ')) return { rf: 0.040, erp: 0.075, terminalGrowth: 0.0175 };
  // US fallback corrected 2026-09-02 (was 0.045) -- same three-copy sync issue as AU
  // above (this file, assumptions.js's FALLBACK_RF.us, app.js's liveRfRate default).
  if (!t.includes('.')) return { rf: live.usRf ?? 0.048, erp: 0.055, terminalGrowth: 0.025 };
  return { rf: live.usRf ?? 0.048, erp: 0.055, terminalGrowth: 0.025 }; // other international — conservative US-style seed
}

module.exports = { marketParamsFor };
