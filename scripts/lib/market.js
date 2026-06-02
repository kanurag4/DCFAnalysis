// scripts/lib/market.js
// Pure: per-market risk-free + ERP seeds, mirroring app.js prefillInputs().
// `live` lets the orchestrator inject a freshly-fetched RF rate; otherwise
// the documented fallback is used (matches the live tool's fallbacks).
function marketParamsFor(ticker, live = {}) {
  const t = (ticker || '').toUpperCase();
  if (t.endsWith('.AX')) return { rf: live.ausRf ?? 0.048, erp: 0.06 };
  if (t.endsWith('.NS') || t.endsWith('.BO')) return { rf: live.indRf ?? 0.07, erp: 0.075 };
  if (!t.includes('.')) return { rf: live.usRf ?? 0.045, erp: 0.055 };
  return { rf: live.usRf ?? 0.045, erp: 0.055 }; // other international — conservative US-style seed
}

module.exports = { marketParamsFor };
