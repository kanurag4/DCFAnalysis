// www/asx-undervalued/app.js — DOM-only. Pure helpers live in ../utils.js.
(function () {
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (isNative) { const b = document.getElementById('kv-play-badge'); if (b) b.hidden = true; }

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
    el.innerHTML = `From ${s.tickers} ${s.universe || 'ASX 300'} names, <strong>${s.qualified} qualified</strong> this month` +
      `${s.shown < s.qualified ? ` (showing the top ${s.shown})` : ''}.${dropText}`;
    el.hidden = false;
  }

  function row(r, livePrice, firstSeen) {
    const price = (typeof livePrice === 'number' && livePrice > 0) ? livePrice : r.snapshotPrice;
    const liveMargin = (price > 0) ? (r.intrinsic - price) / price : null;
    const sym = r.currency === 'GBp' ? 'p' : r.currency === 'INR' ? '₹' : '$';
    const fs = firstSeen ? `${firstSeen.firstSeen} @ ${sym}${Number(firstSeen.firstPrice).toFixed(2)}` : '—';
    const tag = r.method === 'DDM' ? 'ddm' : 'dcf';
    const mktCap = (r.marketCap == null) ? '—' : formatMarketCap(r.marketCap, sym);
    const target = (r.analystTarget == null) ? '—' : `${sym}${r.analystTarget.toFixed(2)}`;
    const opMargin = (r.operatingMargin == null) ? '—' : `${(r.operatingMargin * 100).toFixed(1)}%`;
    // % change from first-listed price to live price — tracks whether the screen's picks performed
    const firstPrice = firstSeen ? Number(firstSeen.firstPrice) : null;
    const sinceListed = (firstPrice && firstPrice > 0 && price > 0)
      ? (price - firstPrice) / firstPrice : null;
    const sinceListedHtml = sinceListed == null
      ? '—'
      : `<span class="${sinceListed >= 0 ? 'pos' : 'neg'}">${sinceListed >= 0 ? '+' : ''}${pct(sinceListed)}</span>`;
    return `<tr>
      <td>${r.rank}</td>
      <td><div class="tk">${escapeHtml(r.ticker)}${r.highLeverage ? '<sup title="High leverage — see note below">*</sup>' : ''}</div><div class="nm">${escapeHtml(r.name || '')}</div></td>
      <td>${escapeHtml(r.sector || '—')}</td>
      <td class="num">${mktCap}</td>
      <td><span class="tag ${tag}">${r.method}</span></td>
      <td class="num fv">${sym}${r.intrinsic.toFixed(2)}</td>
      <td class="num">${target}</td>
      <td class="num">${sym}${Number(price).toFixed(2)}</td>
      <td class="num">${sinceListedHtml}</td>
      <td class="num ${liveMargin > 0 ? 'pos' : ''}">${liveMargin == null ? '—' : pct(liveMargin)}</td>
      <td class="num">${pct(r.wacc)}</td>
      <td class="num">${r.terminalValuePct == null ? '—' : r.terminalValuePct.toFixed(0) + '%'}</td>
      <td class="num">${opMargin}</td>
      <td class="num">${r.trailingPE == null ? '—' : r.trailingPE.toFixed(1)}</td>
      <td>${fs}</td>
    </tr>`;
  }

  function renderHeroCard(portfolioData, rows, live) {
    if (!portfolioData || portfolioData.N === 0 || !rows.length) return;
    const slotBase = portfolioData.value / portfolioData.N;
    let liveValue = 0;
    for (const r of rows) {
      const lp = (typeof live[r.ticker] === 'number' && live[r.ticker] > 0)
        ? live[r.ticker] : r.snapshotPrice;
      liveValue += slotBase * (lp / r.snapshotPrice);
    }
    // Live value = sum of each holding's slot adjusted for intra-month price movement.
    // Since-inception gain is correct because portfolioData.value already bakes in all
    // prior rebalance gains; this only tracks movement since the last batch run.
    const startVal = portfolioData.startingValue || 10000;
    const gain    = liveValue - startVal;
    const gainPct = (gain / startVal * 100).toFixed(1);
    const gainStr = (gain >= 0 ? '+' : '') + gainPct + '%';
    const sym     = (rows[0] && rows[0].currency === 'INR') ? '₹' : '$';
    const since   = portfolioData.startedAt || portfolioData.asAt;
    const days    = Math.floor((Date.now() - new Date(since).getTime()) / 86400000);
    const startLabel = (sym === '₹' && startVal >= 100000)
      ? sym + (startVal / 100000) + 'L'
      : sym + (startVal / 1000) + 'K';

    const indexTicker   = portfolioData.indexTicker || null;
    const indexSeedPrice = portfolioData.indexSeedPrice || null;
    const indexName     = portfolioData.indexName || '';
    const liveIndexPrice = (indexTicker && typeof live[indexTicker] === 'number' && live[indexTicker] > 0)
      ? live[indexTicker] : null;
    const indexRet = (liveIndexPrice && indexSeedPrice && indexSeedPrice > 0)
      ? (liveIndexPrice - indexSeedPrice) / indexSeedPrice : null;
    const indexHtml = indexRet != null
      ? '<div class="portfolio-hero-index">' +
          '<span class="portfolio-hero-index-name">vs ' + escapeHtml(indexName) + '</span>' +
          '<span class="portfolio-hero-gain ' + (indexRet >= 0 ? 'pos' : 'neg') + '">' +
            (indexRet >= 0 ? '+' : '') + (indexRet * 100).toFixed(1) + '%' +
          '</span>' +
        '</div>'
      : '';

    const el = document.createElement('section');
    el.className = 'portfolio-hero';
    el.innerHTML =
      '<div class="portfolio-hero-inner">' +
        '<div class="portfolio-hero-label">' + startLabel + ' paper portfolio · equally weighted, rebalanced monthly</div>' +
        '<div class="portfolio-hero-stat">' +
          '<div class="portfolio-hero-left">' +
            '<span class="portfolio-hero-value">' + sym + Math.round(liveValue).toLocaleString() + '</span>' +
            '<span class="portfolio-hero-gain ' + (gain >= 0 ? 'pos' : 'neg') + '">' + gainStr + '</span>' +
          '</div>' +
          indexHtml +
        '</div>' +
        ((portfolioData.dividendsTotal && portfolioData.dividendsTotal > 0)
          ? '<div class="portfolio-hero-dividends">Dividends earned: ' + sym + Math.round(portfolioData.dividendsTotal).toLocaleString() + '</div>'
          : '') +
        '<div class="portfolio-hero-note">' + portfolioData.N + ' holdings · live prices · since ' + since + ' · ' + days + ' days</div>' +
      '</div>';

    tableEl.parentNode.insertAdjacentElement('beforebegin', el);
  }

  function renderActivityTable(soldData, asAt, currency) {
    // Only show exits from the most recent batch run; older history accumulates in sold.json but isn't shown.
    const recent = soldData.filter(function(s) { return s.exitDate === asAt; });
    const sym = currency === 'INR' ? '₹' : '$';
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const ap = String(asAt).split('-');
    const asAtLabel = ap.length === 3 ? (parseInt(ap[2]) + ' ' + months[parseInt(ap[1]) - 1] + ' ' + ap[0]) : asAt;

    let tbodyContent;
    if (!recent.length) {
      tbodyContent = '<tr><td colspan="6" class="activity-empty">No exits in the last run — check back after the next refresh.</td></tr>';
    } else {
      tbodyContent = recent.map(function(s) {
        const ret    = (s.exitPrice - s.entryPrice) / s.entryPrice;
        const retStr = (ret >= 0 ? '+' : '') + (ret * 100).toFixed(1) + '%';
        return '<tr>' +
          '<td>' + escapeHtml(s.ticker) + '</td>' +
          '<td>' + s.entryDate + '</td>' +
          '<td class="num">' + sym + Number(s.entryPrice).toFixed(2) + '</td>' +
          '<td>' + s.exitDate + '</td>' +
          '<td class="num">' + sym + Number(s.exitPrice).toFixed(2) + '</td>' +
          '<td class="num ' + (ret >= 0 ? 'pos' : 'neg') + '">' + retStr + '</td>' +
        '</tr>';
      }).join('');
    }

    const el = document.createElement('section');
    el.className = 'activity-card';
    el.innerHTML =
      '<h3 class="activity-title">Stocks exited after last run on ' + asAtLabel + '</h3>' +
      '<div class="table-scroll"><table class="activity-table">' +
        '<thead><tr>' +
          '<th>Stock</th><th>Entry date</th><th class="num">Entry price</th>' +
          '<th>Exit date</th><th class="num">Exit price</th><th class="num">Return</th>' +
        '</tr></thead>' +
        '<tbody>' + tbodyContent + '</tbody>' +
      '</table></div>';

    const leverageNote = document.querySelector('.leverage-note');
    const ref = leverageNote || tableEl.parentNode;
    ref.insertAdjacentElement('afterend', el);
  }

  async function init() {
    let rankings, firstSeen, portfolioData, soldData;
    try {
      [rankings, firstSeen, portfolioData, soldData] = await Promise.all([
        getJSON('./rankings.json'),
        getJSON('./first-seen.json').catch(() => ({})),
        getJSON('./portfolio-value.json').catch(() => null),
        getJSON('./sold.json').catch(() => []),
      ]);
    } catch (err) {
      statusEl.textContent = 'Could not load the rankings. Please try again later.';
      return;
    }

    const [ay, am, ad] = rankings.asAt.split('-');
    const aMonths = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    asAtEl.textContent = `Last refreshed: ${parseInt(ad)} ${aMonths[parseInt(am)-1]} ${ay}`;
    asAtEl.hidden = false;
    renderScreenSummary({ ...rankings.summary, universe: rankings.universe });
    const rows = rankings.rows || [];
    if (!rows.length) { statusEl.textContent = 'No stocks passed the screen this month.'; return; }

    const tickersForLive = rows.map(r => r.ticker);
    if (portfolioData && portfolioData.indexTicker) tickersForLive.push(portfolioData.indexTicker);
    const live = await fetchLivePrices(tickersForLive);
    bodyEl.innerHTML = rows.map(r => row(r, live[r.ticker], firstSeen[r.ticker])).join('');
    statusEl.hidden = true;
    tableEl.hidden = false;
    if (rows.some(r => r.highLeverage)) {
      const note = document.createElement('p');
      note.className = 'leverage-note';
      note.style.cssText = 'margin:8px 0 0;padding:8px 12px;background:#fff8e1;border-left:3px solid #f59e0b;border-radius:4px;font-size:0.82rem;color:#92400e;';
      note.textContent = '* High leverage — debt exceeds 65% of enterprise value. WACC is dominated by the cost of debt; a low interest expense (or null → 5% fallback) can understate the true discount rate. Treat the fair-value estimate with extra caution.';
      tableEl.parentNode.insertAdjacentElement('afterend', note);
    }
    if (portfolioData) renderHeroCard(portfolioData, rows, live);
    if (portfolioData) renderActivityTable(soldData || [], rankings.asAt, rows[0] ? rows[0].currency : null);
  }

  init();
}());
