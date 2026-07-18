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
  if (!t.includes('.')) return { rf: live.usRf ?? 0.045, erp: 0.055, terminalGrowth: 0.025 };
  return { rf: live.usRf ?? 0.045, erp: 0.055, terminalGrowth: 0.025 }; // other international — conservative US-style seed
}

module.exports = { marketParamsFor };
