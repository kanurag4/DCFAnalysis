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
  if (!t.includes('.')) return { rf: live.usRf ?? 0.045, erp: 0.055, terminalGrowth: 0.025 };
  return { rf: live.usRf ?? 0.045, erp: 0.055, terminalGrowth: 0.025 }; // other international — conservative US-style seed
}

module.exports = { marketParamsFor };
