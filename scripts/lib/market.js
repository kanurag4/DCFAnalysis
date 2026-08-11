// scripts/lib/market.js
// Pure: per-market risk-free + ERP seeds, mirroring app.js prefillInputs().
// `live` lets the orchestrator inject a freshly-fetched RF rate; otherwise
// the documented fallback is used (matches the live tool's fallbacks).
function marketParamsFor(ticker, live = {}) {
  const t = (ticker || '').toUpperCase();
  if (t.endsWith('.AX')) return { rf: live.ausRf ?? 0.048, erp: 0.06, terminalGrowth: 0.025 };
  if (t.endsWith('.NS') || t.endsWith('.BO')) return { rf: live.indRf ?? 0.07, erp: 0.075, terminalGrowth: 0.025 };
  // Korea: no live 10-yr KTB yield ticker exists on Yahoo (confirmed via exhaustive search —
  // see docs/japan-korea-market-research.md) so rf is a fixed static value, never live-fetched.
  // erp is elevated to reflect a governance-risk premium (weak minority-shareholder protections);
  // terminalGrowth is lower to reflect Korea's structurally lower long-run growth expectations.
  if (t.endsWith('.KS')) return { rf: 0.043, erp: 0.075, terminalGrowth: 0.0175 };
  // Japan: same "no live RF ticker" situation as Korea (10-yr JGB has no Yahoo symbol —
  // see docs/japan-korea-market-research.md). rf reflects the post-deflation JGB regime
  // (~2.8%, a 30-yr high); erp is developed-market tier (~AUS level); terminalGrowth is
  // capped at 1.5% per the deflation-exit research (old 0–0.5% convention is outdated,
  // but 2.5% would overstate Japan's demographic-constrained long-run growth).
  if (t.endsWith('.T')) return { rf: 0.028, erp: 0.06, terminalGrowth: 0.015 };
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
  // from Hong Kong above -- different currency (CNY vs HKD) and risk profile. Terminal
  // growth kept at the tool's 2.5% default (China's still-above-developed-market
  // long-run growth despite its slowdown). Backported from www/dcf/app.js's
  // CHINA_RF/CHINA_ERP/CHINA_TGROWTH (commit 98dc69d).
  if (t.endsWith('.SS') || t.endsWith('.SZ')) return { rf: 0.017, erp: 0.052, terminalGrowth: 0.025 };
  if (!t.includes('.')) return { rf: live.usRf ?? 0.045, erp: 0.055, terminalGrowth: 0.025 };
  return { rf: live.usRf ?? 0.045, erp: 0.055, terminalGrowth: 0.025 }; // other international — conservative US-style seed
}

module.exports = { marketParamsFor };
