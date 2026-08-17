// scripts/lib/growth-manifest-reader.js
// Growth-method ticker pages (Multi-Stage DCF/EV-Sales) live in a different
// repo (StockAnalysis), not here. This resolves the same "wherever it's
// reachable" path order generate-market-index.js originally hardcoded
// inline: a dedicated read-only checkout the refresh-ticker-pages.yml
// workflow adds specifically for this (CI), or a local sibling checkout
// (dev machine). Extracted 2026-08-17 so generate-market-index.js and the
// related-stocks pool builder in ticker-page.js share one resolution order
// instead of two copies that could silently drift.
const fs = require('fs');
const path = require('path');

function resolveGrowthStocksRoot() {
  const candidates = [
    path.join(__dirname, '..', '..', 'stock-evaluator-growth', 'www', 'growth', 'stocks'), // CI checkout
    path.join(__dirname, '..', '..', '..', 'StockAnalysis', 'www', 'growth', 'stocks'), // local sibling checkout
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function readGrowthManifest(folder) {
  const root = resolveGrowthStocksRoot();
  if (!root) return [];
  const manifestPath = path.join(root, folder, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return [];
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {
    return [];
  }
}

function listGrowthMarketFolders() {
  const root = resolveGrowthStocksRoot();
  if (!root) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
}

module.exports = { readGrowthManifest, listGrowthMarketFolders };
