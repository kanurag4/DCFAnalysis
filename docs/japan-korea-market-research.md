# Japan (Nikkei 225) & Korea (KOSPI 200) — market research notes

**Status: exploratory only — no spec approved, no build committed.** Saved 2026-07-18 so this
research isn't lost while the decision is still open. If this ever turns into a real Spec A
(core tool market support) + Spec B/C (screen builds), start from here rather than re-researching.

---

## Why this exists

User asked about extending the "Most undervalued" DCF/DDM screens (ASX 300 / S&P 500 / NIFTY
500) to Japan and Korea. Originally considered Shanghai Composite too, but ruled out early —
Yahoo Finance's fundamentals coverage for mainland China A-shares is known to be spotty, and
"Shanghai Composite" itself has ~2,000+ constituents (not a tractable "top N" list the way
ASX 300/S&P 500/NIFTY 500 are). Nikkei 225 and KOSPI 200 were chosen instead as more tractable,
better-data-coverage alternatives.

## Feasibility spot-check (2026-07-18) — Yahoo data quality

Tested 6 real tickers through the live Cloudflare Worker (same one the shipped tool uses):
Toyota (7203.T), Sony (6758.T), NTT (9432.T), Samsung Electronics (005930.KS), SK hynix
(000660.KS), Hyundai Motor (005380.KS).

**Result: feasible.** All 6 returned real names, prices, market caps, sector/industry,
dividend rates, and FCF. No fetch failures. Negative FCF on 3 of 6 (Toyota, Sony, Hyundai) is
genuine (capex/inventory-heavy manufacturers), not a data gap — same "empty normalised-FCF
field, user overrides" handling the tool already has for any market.

## Risk-free rate — no live Yahoo ticker found

Unlike `^GSBG10.AX` (Australia) and `^INBMKG10.NS` (India), which work because they're
**exchange-listed bond-index products**, no equivalent exists for Tokyo Stock Exchange or Korea
Exchange as far as could be determined. Tested ~13 plausible ticker guesses (`^JP10Y`,
`JP10Y=RR`, `JP10Y-JP`, `^KR10Y`, `KR10YT=RR`, etc.) through the Worker — all HTTP 502
(unrecognized symbol). Direct WebFetch of `finance.yahoo.com/quote/JP10Y-JP` confirmed 404 —
a search-engine-synthesized answer had incorrectly conflated CNBC's ticker convention with
Yahoo's. **Conclusion: RF must be a static fallback for both markets**, same mechanism as the
existing US/AUS/IND fallbacks — and consistent with the fact that India's "live" RF already
falls back most of the time in practice per existing CLAUDE.md notes.

Current levels found via web search (mid-July 2026, for seeding the static fallback):
- **Japan 10Y JGB: ~2.71–2.88%** — a 30-year high; JGB yields were near-zero for decades,
  now in a genuine regime shift as BOJ exits deflation-era policy.
- **Korea 10Y KTB: ~4.32%**

## User-supplied research: Korea (KOSPI) — DCF considerations

Full text supplied by user, condensed here:

1. **"Korea Discount"** — Korean equities structurally trade below global peers (P/B often
   <1.0×). Must be baked into terminal-value sanity checks, not ignored.
2. **Chaebol complexity** — large family-controlled conglomerates (Samsung, Hyundai, SK, LG,
   Lotte, etc.) can shift cash between affiliates via transfer pricing, sub-optimal M&A, or
   related-party real-estate deals. Reported FCF for affiliate companies may not reflect real
   owner earnings. **Not detectable from Yahoo's basic fields** — same category as the
   RELINFRA.NS "FCF may be inflated by asset disposals" caveat already documented, but likely
   far more common in Korea (see empirical finding below).
3. **"Value-Up" reform (2025–2026)** — mandatory governance reforms; treasury shares must now
   be cancelled within a year of buyback (historically "warehoused" to block hostile
   takeovers). Affects future share-count/dilution modeling — the tool doesn't model
   *future* share-count changes for any market today, so this is a pre-existing limitation,
   not Korea-specific.
4. **Governance risk premium** — institutional investors typically add **1–3% to Cost of
   Equity** for weak minority-shareholder protections. This is the basis for the proposed
   Korea ERP of 7.5% (see Proposed parameters below).
5. **Terminal growth (g) discipline** — cap around 1.5–2%; check implied exit multiple
   (Terminal EV/EBITDA) against Korea's typically-lower real-world multiples — a DCF implying
   12× for a legacy industrial that trades at 6× is "fundamentally flawed" per the research.
   The implied-multiple sanity check itself is a bigger feature, deferred (see below).
6. **Cyclicality** — KOSPI is heavily weighted toward semiconductors (Samsung, SK hynix) and
   heavy industry; a linear 3–5yr DCF misses AI-capex/silicon-cycle swings. A normalized
   7-year-cycle approach is recommended over linear growth — a bigger feature, deferred.

## User-supplied research: Japan (Nikkei/TOPIX) — DCF considerations

1. **Unwinding of cross-shareholdings (keiretsu)** — companies are liquidating historic
   equity stakes in business partners under the revised Corporate Governance Code. Proceeds
   must be treated as non-operating cash (Terminal Value / net-debt adjustment), **not** mixed
   into Operating Cash Flow. Same "can't detect from Yahoo's basic fields" limitation as
   Korea's chaebol issue — Japanese conglomerates unwinding keiretsu stakes is a live version
   of the RELINFRA.NS caveat.
2. **TSE PBR-below-1× mandate → surging buybacks** — companies trading below 1.0× P/B face
   pressure to improve capital efficiency, often via aggressive buybacks. Future share-count
   reduction likely underestimated by historical trend — again, the tool doesn't model future
   share count for any market, pre-existing limitation.
3. **Cash-rich balance sheets** — naive EV→Equity bridging (adding back all cash) can distort
   valuation if management hoards rather than deploys it. No generic fix proposed; noted as a
   limitation.
4. **Risk-free rate normalization** — JGB yields have risen sharply as Japan exits deflation;
   the old "assume ~0%" heuristic is now wrong. Consistent with the 2.71–2.88% static RF found
   above — no numeric conflict with this research.
5. **Beta understatement** — mature Japanese firms historically showed low betas (0.5–0.7)
   partly because prices barely moved and firms carried little debt; with volatility
   returning, historical beta likely **understates** true cost of equity going forward. This
   is the basis for raising Japan's proposed beta floor from an initial 0.5 (matching
   ASX/"other international") to **0.6** (matching Korea/India) — see Proposed parameters.
6. **Terminal growth (g) trap** — old convention was 0–0.5% (deflation-era); research suggests
   1.0–1.5% is now reasonable for healthy domestic firms, "capping it there is vital." Basis
   for the proposed 1.5% Japan terminal-growth seed (upper bound of the range).
7. **Global exporter vs domestic-firm split** — Nikkei 225 is skewed by multinational
   exporters (Toyota, Tokyo Electron, Fast Retailing) whose growth should arguably track
   global GDP, not Japan's demographics. A single flat terminal-growth seed doesn't capture
   this distinction — noted as a limitation, same "it's a seed, not a rule, user can override"
   treatment used everywhere else in the tool. Building automatic domestic/exporter
   classification is out of scope.
8. **Nikkei 225 vs TOPIX for sanity-checking** — Nikkei 225 is *price-weighted* (like the Dow),
   so a handful of expensive stocks distort its average multiples; TOPIX (cap-weighted) is a
   more accurate reflection of "Japan Inc." valuations broadly. **Open question for Spec B**:
   every existing screen uses the same-named index as both universe and portfolio benchmark
   (ASX 300 screen → ^AXJO benchmark, etc.) — for Japan, keep that pattern (Nikkei 225 both
   ways, simple/consistent) or split it (Nikkei 225 universe, TOPIX benchmark, more defensible
   per this research)? **Not decided.**

## Proposed parameters (not yet implemented anywhere)

| Parameter | Japan (`.T`) | Korea (`.KS`) | Basis |
|---|---|---|---|
| RF (static fallback) | 2.8% | 4.3% | Current real yields, no live ticker exists |
| ERP / MRP | 6.0% | **7.5%** | Japan: developed-market tier (~AUS level). Korea: baseline + explicit 1–3% governance-risk premium from user research, landing near India's 7.5% for a different underlying reason |
| Beta floor | **0.6** | 0.6 | Japan raised from initial 0.5 proposal — research says historical low Japanese betas likely understate current risk. Korea matches India's EM-classification-debate reasoning |
| Terminal growth seed | **1.5%** | **1.75%** | Both below the tool's current flat 2.5% (used by every other market today) — first-ever market-specific terminal-growth seeds. Japan: upper bound of user-researched 1.0–1.5% range. Korea: midpoint of user-researched 1.5–2% range |
| Currency symbol | ¥ | ₩ | New `CURRENCY_SYMBOLS` entries |

**Architecture implication**: today `TERMINAL_GROWTH` is a single hardcoded constant in
`scripts/lib/evaluate.js`, and `getMarketBetaFloor()` has no override path per new market
beyond ticker-suffix branching. Making these real (not just exploratory-script copies) means
`marketParamsFor()` needs to start returning a per-market terminal growth, not just RF/ERP.

**Explicitly out of scope / deferred** (documented as known limitations, not code gaps to
close): chaebol/keiretsu-driven FCF distortion (can't detect from Yahoo's basic fields —
expect this needs curation, see empirical finding below), cycle-normalized FCF for
cyclical/semiconductor sectors, implied-terminal-multiple sanity check. All three are flagged
as potentially cross-market features (useful for any market's cyclicals/related-party-risk
names, not Japan/Korea-specific), worth their own future spec rather than folding into this one.

## Empirical validation — KOSPI 200 exploratory run (2026-07-18)

Ran all 199 (of 200; 1 didn't parse cleanly from the Wikipedia source table) KOSPI 200
constituents through a throwaway script using the proposed Korea parameters above. Ticker list
sourced from Wikipedia's KOSPI 200 constituent table (raw wikitext, parsed programmatically —
`stockanalysis.com`'s KODEX 200 ETF holdings page only exposes the top 10 on its free tier).

**Funnel:** 199 tickers → 0 fetch-failed → 199 evaluated → 78 unvaluable → 57 overvalued →
**50 capped (>80% margin, 25% of the universe)** → 1 proxy-FCF dropped → **13 qualified**.

The 25% capped rate is far higher than any existing market (ASX ~12%, S&P 500 ~16%, NIFTY
~3%) — read as the safety net (the >80% margin cap) doing more work here, not necessarily a
sign the whole approach is broken.

**Top 13 (hypothetical, not published anywhere):**
1. SL Corp 76% · 2. Hotel Shilla 74% · 3. Hyundai Dept Store 58% · 4. Chong Kun Dang Pharma 53%
· 5. HD-Hyundai Marine Engine 49% · 6. Kumho Petrochemical 48% · 7. Kolmar Korea 18% ·
8. KEPCO Plant Service 16% · 9. Samsung E&A 12% · 10. Ottogi 7% · 11. KT Corp 7% ·
12. Kangwon Land 5% · 13. Hyundai Glovis 4%

**Key finding: chaebol-affiliate concentration in the surviving list.** Of the top 6, at least
3 are chaebol-group affiliates that passed the 80% cap yet are exactly the "opaque
related-party transaction" risk the user's research flagged — **Hotel Shilla** (Samsung
Group), **HD-Hyundai Marine Engine** (Hyundai Heavy Industries group), **Samsung E&A**
(Samsung Group). This means the margin cap alone isn't sufficient to filter chaebol-affiliate
FCF distortion — unlike ASX's REIT problem (a handful of names: WPR.AX, MFF.AX, GOZ.AX,
RGN.AX), chaebol affiliation isn't rare in KOSPI 200 — most of Korea's largest companies
belong to one of ~10–15 major groups, so a reactive blacklist (the ASX/S&P/NIFTY pattern —
add a name after it reappears a few times) doesn't scale here.

**Proposed design response (not yet built): flag, don't filter.** Mirror the existing
high-leverage flag pattern (S&P 500's CHTR shows an asterisk + tooltip + amber footnote,
stays on the list rather than being excluded) with a parallel "chaebol affiliate — FCF may be
distorted by related-party transactions" flag. Preserves the genuinely useful signal (several
of the 13 — Chong Kun Dang Pharma, Kolmar Korea, Ottogi, KT Corp, Kangwon Land — aren't
chaebol affiliates and carry no such caveat) while being honest about which names need extra
scrutiny.

Throwaway exploration script: `explore-kospi.js` (repo root, not committed — duplicates
`evaluateStock` logic locally with the proposed Korea params since the real shared engine
doesn't know about Korea yet). Ticker list: `kospi200-list.json`. Raw evaluated output:
`_explore-kospi-evaluated.json`. Delete all three once this research is either acted on or
shelved — they are not meant to survive into any real implementation.

## Empirical validation — Nikkei 225 exploratory run (2026-07-18)

Ran all 225 Nikkei 225 constituents through the same throwaway-script pattern, using the
proposed Japan parameters above. Ticker list sourced from Wikipedia's Nikkei 225 page (a
different wikitext structure than KOSPI 200's — sector-grouped bulleted list, not a single
wikitable; parsed with a dedicated regex).

**Funnel:** 225 tickers → 0 fetch-failed → 225 evaluated → 89 unvaluable → 74 overvalued →
**33 capped (14.7% of the universe)** → 0 proxy-FCF dropped → **29 qualified**, top 20 shown.

The 14.7% capped rate is meaningfully lower than KOSPI's 25% — consistent with Japan having
fewer of the acute related-party-transaction distortions the chaebol structure produces (still
somewhat elevated vs ASX's ~12%/S&P 500's ~16%/NIFTY's ~3%, which tracks the cross-shareholding
and cash-hoarding concerns from the user's Japan research, just less severe than Korea's).

**Top 20:** Astellas Pharma 74% · Takeda Pharma 68% · Kyowa Kirin 62% · NEC 60% · Yamato
Holdings 55% · SECOM 52% · Nissan Chemical 52% · Mitsubishi Heavy Industries 51% · Sumitomo
Chemical 46% · Konami Group 43% · Kobe Steel 40% · Subaru 36% · Japan Exchange Group 35% ·
ZOZO 34% · Yamaha 22% · Amada 22% · Hitachi 20% · Terumo 18% · Baycurrent 17% · NSK 17%.

**Qualitative read:** unlike KOSPI's top 6 (half chaebol-affiliate names), Japan's top 20 spans
pharma, logistics, industrials, and tech with no single keiretsu group obviously dominating the
upper ranks. Mitsubishi Heavy Industries and Sumitomo Chemical are keiretsu-descended names
worth a similar cross-shareholding-proceeds caveat, but they read as core operating businesses
rather than holding-company-style entities (the closer analogue to Hotel Shilla/Samsung E&A).
This is a materially cleaner-looking list than KOSPI's — doesn't mean Japan is risk-free (the
cross-shareholding-unwinding caveat still applies to any name that's been liquidating keiretsu
stakes), but the structural-distortion concentration looks lower.

Throwaway exploration script: `explore-nikkei.js` (repo root, not committed). Ticker list:
`nikkei225-list.json`. Raw evaluated output: `_explore-nikkei-evaluated.json`. Wikitext source:
`nikkei225.wiki`. Parser: `parse-nikkei.js`. Delete all once this research is acted on or
shelved — not meant to survive into any real implementation.

## Status (2026-07-18)

**Korea (KOSPI 200): approved, in build.** User decided to proceed despite the chaebol-affiliate
finding, with the flag-not-filter design (see the KOSPI design spec,
`docs/superpowers/specs/2026-07-18-kospi-undervalued-screen-design.md`, approved and in
implementation as of this writing).

**Japan (Nikkei 225): still an open, separate decision.** Not yet brainstormed into a spec. The
empirical picture is more favorable than Korea's (lower capped rate, less concentrated
structural-risk names at the top), which may make the "on the fence" calculus different for
Japan than it was for Korea — but that's a decision for whenever this gets picked up, not
assumed here.
