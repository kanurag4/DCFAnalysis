// www/asx-undervalued/app.js — DOM-only. Pure helpers live in ../utils.js.
(function () {
  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const tableEl = $('rank-table');
  const bodyEl = $('rank-body');
  const asAtEl = $('as-at');

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
    return res.json();
  }

  async function fetchLivePrices(tickers) {
    try {
      const base = (CONFIG.YAHOO_PROXY_URL || '').replace(/\/$/, '');
      const url = `${base}/quote?symbols=${encodeURIComponent(tickers.join(','))}`;
      const arr = await getJSON(url);
      const map = {};
      for (const q of arr) if (q && q.symbol) map[q.symbol] = q.regularMarketPrice;
      return map;
    } catch (_) {
      return {}; // live prices are best-effort; fall back to snapshot price
    }
  }

  function pct(x) { return `${(x * 100).toFixed(1)}%`; }

  function renderScreenSummary(s) {
    const el = $('screen-summary');
    if (!el || !s) return;
    const d = s.dropped || {};
    const parts = [];
    const capPct = s.marginCapPct || 80;
    if (d.overvalued) parts.push(`${d.overvalued} overvalued`);
    if (d.unvaluable) parts.push(`${d.unvaluable} unvaluable`);
    if (d.proxyFcf) parts.push(`${d.proxyFcf} with rough cash-flow data`);
    if (d.marginOverCap) parts.push(`${d.marginOverCap} above the ${capPct}% margin cap`);
    if (d.fetchFailed) parts.push(`${d.fetchFailed} with no data`);
    const dropText = parts.length ? ` Screened out: ${parts.join(', ')}.` : '';
    el.innerHTML = `From ${s.tickers} ASX 300 names, <strong>${s.qualified} qualified</strong> this month` +
      `${s.shown < s.qualified ? ` (showing the top ${s.shown})` : ''}.${dropText}`;
    el.hidden = false;
  }

  function row(r, livePrice, firstSeen) {
    const price = (typeof livePrice === 'number' && livePrice > 0) ? livePrice : r.snapshotPrice;
    const liveMargin = (price > 0) ? (r.intrinsic - price) / price : null;
    const sym = r.currency === 'GBp' ? 'p' : '$';
    const fs = firstSeen ? `${firstSeen.firstSeen} @ ${sym}${Number(firstSeen.firstPrice).toFixed(2)}` : '—';
    const tag = r.method === 'DDM' ? 'ddm' : 'dcf';
    const mktCap = (r.marketCap == null) ? '—' : formatMarketCap(r.marketCap, sym);
    const target = (r.analystTarget == null) ? '—' : `${sym}${r.analystTarget.toFixed(2)}`;
    const opMargin = (r.operatingMargin == null) ? '—' : `${(r.operatingMargin * 100).toFixed(1)}%`;
    return `<tr>
      <td>${r.rank}</td>
      <td><div class="tk">${escapeHtml(r.ticker)}</div><div class="nm">${escapeHtml(r.name || '')}</div></td>
      <td>${escapeHtml(r.sector || '—')}</td>
      <td class="num">${mktCap}</td>
      <td><span class="tag ${tag}">${r.method}</span></td>
      <td class="num fv">${sym}${r.intrinsic.toFixed(2)}</td>
      <td class="num">${target}</td>
      <td class="num">${sym}${Number(r.snapshotPrice).toFixed(2)}</td>
      <td class="num">${sym}${Number(price).toFixed(2)}</td>
      <td class="num ${liveMargin > 0 ? 'pos' : ''}">${liveMargin == null ? '—' : pct(liveMargin)}</td>
      <td class="num">${pct(r.wacc)}</td>
      <td class="num">${r.terminalValuePct == null ? '—' : r.terminalValuePct.toFixed(0) + '%'}</td>
      <td class="num">${opMargin}</td>
      <td class="num">${r.trailingPE == null ? '—' : r.trailingPE.toFixed(1)}</td>
      <td>${fs}</td>
    </tr>`;
  }

  async function init() {
    let rankings, firstSeen;
    try {
      [rankings, firstSeen] = await Promise.all([
        getJSON('./rankings.json'),
        getJSON('./first-seen.json').catch(() => ({})),
      ]);
    } catch (err) {
      statusEl.textContent = 'Could not load the rankings. Please try again later.';
      return;
    }

    asAtEl.textContent = `As at ${rankings.asAt} · refreshed monthly.`;
    renderScreenSummary(rankings.summary);
    const rows = rankings.rows || [];
    if (!rows.length) { statusEl.textContent = 'No stocks passed the screen this month.'; return; }

    const live = await fetchLivePrices(rows.map(r => r.ticker));
    bodyEl.innerHTML = rows.map(r => row(r, live[r.ticker], firstSeen[r.ticker])).join('');
    statusEl.hidden = true;
    tableEl.hidden = false;
  }

  init();
}());
