// www/nikkei-undervalued/app.js — DOM-only. Pure helpers live in ../utils.js.
(function () {
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (isNative) { const b = document.getElementById('kv-play-badge'); if (b) b.hidden = true; }

  const $ = (id) => document.getElementById(id);
  const statusEl = $('status');
  const tableEl = $('rank-table');
  const bodyEl = $('rank-body');
  const asAtEl = $('as-at');

  // Local currency-symbol lookup (this screen only deals with JPY, but keeps the
  // same fallback shape as the DCF tool's CURRENCY_SYMBOLS for consistency).
  const CURRENCY_SYMBOLS = { INR: '₹', KRW: '₩', JPY: '¥', GBp: 'p' };
  function currencySymbol(currency) { return CURRENCY_SYMBOLS[currency] || '$'; }

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

  // Index tickers need the summaryDetail chain, not the bulk /quote endpoint used
  // for regular stocks — confirmed via direct comparison (2026-07-19) that /quote
  // returns a value ~4% off from /quoteSummary for ^N225, the same per-symbol Yahoo
  // quirk ^KS200 has (see the KOSPI screen). Fetching the index price the same way
  // the batch does (scripts/lib/rf.js's fetchIndexPrice) keeps the hero card's live
  // comparison internally consistent with the seed it's being compared against.
  async function fetchIndexPriceLive(indexTicker) {
    try {
      const base = (CONFIG.YAHOO_PROXY_URL || '').replace(/\/$/, '');
      const url = `${base}/quoteSummary/${encodeURIComponent(indexTicker)}`;
      const body = await getJSON(url);
      const r = body?.quoteSummary?.result?.[0];
      const raw = r?.summaryDetail?.regularMarketPrice?.raw
        ?? r?.summaryDetail?.previousClose?.raw
        ?? r?.financialData?.currentPrice?.raw
        ?? null;
      return (raw != null && isFinite(raw) && raw > 0) ? raw : null;
    } catch (_) {
      return null;
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
    el.innerHTML = `From ${s.tickers} ${s.universe || 'Nikkei 225'} names, <strong>${s.qualified} qualified</strong> this month` +
      `${s.shown < s.qualified ? ` (showing the top ${s.shown})` : ''}.${dropText}`;
    el.hidden = false;
  }

  function row(r, livePrice, firstSeen) {
    const price = (typeof livePrice === 'number' && livePrice > 0) ? livePrice : r.snapshotPrice;
    const liveMargin = (price > 0) ? (r.intrinsic - price) / price : null;
    const sym = currencySymbol(r.currency);
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
    const flags = r.highLeverage ? '<sup title="High leverage — see note below">*</sup>' : '';
    return `<tr>
      <td>${r.rank}</td>
      <td><div class="tk">${escapeHtml(r.ticker)}${flags}</div><div class="nm">${escapeHtml(r.name || '')}</div></td>
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

  function drawPortfolioChart(canvas, history, sym, indexName, showLine) {
    if (!history || history.length < 1 || typeof Chart === 'undefined') return;
    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? 'rgba(148,163,184,0.15)' : 'rgba(15,23,42,0.1)';
    const tickColor = isDark ? '#94a3b8' : '#475569';
    // Sky-400 (#38bdf8) is the dark-mode accent — too light/low-contrast against the
    // light-mode background and too close to the portfolio green. Use navy (kv-accent
    // light-mode token) in light mode for real separation between the two lines.
    const indexColor = isDark ? '#38bdf8' : '#0369a1';
    const labels = history.map(h => {
      const [y, m, d] = h.date.split('-');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return h.date === 'Now' ? 'Now' : `${parseInt(d)} ${months[parseInt(m) - 1]}`;
    });
    new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Portfolio',
            data: history.map(h => h.portfolioPct),
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34,197,94,0.1)',
            borderWidth: 2,
            pointRadius: showLine ? 2 : 4,
            tension: 0.25,
            fill: showLine,
            showLine,
          },
          {
            label: indexName || 'Index',
            data: history.map(h => h.indexPct),
            borderColor: indexColor,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 3],
            pointRadius: showLine ? 2 : 4,
            tension: 0.25,
            fill: false,
            showLine,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: { color: tickColor, boxWidth: 10, boxHeight: 2, font: { size: 10 }, padding: 8 },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y >= 0 ? '+' : ''}${ctx.parsed.y.toFixed(1)}%`,
            },
          },
        },
        scales: {
          x: { ticks: { color: tickColor, font: { size: 10 }, maxRotation: 0 }, grid: { display: false } },
          y: {
            // Both series' first point is exactly 0% by construction (day-1 return vs
            // itself) — force the axis to include 0 so that's visually the shared
            // starting line, regardless of how far the "Now" point has since drifted.
            beginAtZero: true,
            ticks: { color: tickColor, font: { size: 10 }, callback: v => `${v >= 0 ? '+' : ''}${v}%` },
            grid: { color: gridColor },
            afterFit: (scale) => { scale.width = 44; },
          },
        },
      },
    });
  }

  function renderHeroCard(portfolioData, rows, live, history) {
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
    const sym     = currencySymbol(rows[0] && rows[0].currency);
    const since   = portfolioData.startedAt || portfolioData.asAt;
    const days    = Math.floor((Date.now() - new Date(since).getTime()) / 86400000);
    // ₹ uses lakhs (100,000) per KashVector convention; large non-INR seeds (KRW's
    // 10,000,000, JPY's 1,000,000) use millions instead of an unwieldy "K" label.
    const startLabel = (sym === '₹' && startVal >= 100000)
      ? sym + (startVal / 100000) + 'L'
      : startVal >= 1000000
        ? sym + (startVal / 1000000) + 'M'
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

    // Build the chart series: historical snapshots (% return vs the inception date)
    // plus a final "Now" point using today's live figures, so the line always reaches
    // today even between batch runs. If the latest snapshot IS today's batch run,
    // skip the synthetic "Now" point entirely — it would just duplicate the same day
    // as a second dot (e.g. "18 Jul" + "Now" both being 18 Jul). Only add "Now" when
    // there's a genuine gap between the last snapshot and the moment the page loads.
    let chartPoints = null;
    if (Array.isArray(history) && history.length) {
      // Use indexSeedPrice (same baseline as the hero stat's % figure) so the chart
      // and the hero card never disagree — history[0].indexPrice can drift from
      // indexSeedPrice if the seed was patched after the fact (see kashvector-lessons.md).
      const indexBaseline = indexSeedPrice || history[0].indexPrice;
      chartPoints = history.map(h => ({
        date: h.date,
        portfolioPct: (h.portfolioValue - startVal) / startVal * 100,
        indexPct: (indexBaseline > 0) ? (h.indexPrice - indexBaseline) / indexBaseline * 100 : null,
      }));
      const lastHistoryDate = history[history.length - 1].date;
      const todayStr = new Date().toISOString().slice(0, 10);
      if (lastHistoryDate !== todayStr) {
        const lastIndexPct = chartPoints[chartPoints.length - 1].indexPct;
        chartPoints.push({
          date: 'Now',
          portfolioPct: parseFloat(gainPct),
          indexPct: (liveIndexPrice && indexBaseline > 0)
            ? (liveIndexPrice - indexBaseline) / indexBaseline * 100
            : lastIndexPct,
        });
      }
    }
    const chartHtml = chartPoints && chartPoints.length >= 1
      ? '<div class="portfolio-hero-chart-col">' +
          '<div class="portfolio-hero-chart-title">Portfolio vs ' + escapeHtml(indexName || 'index') + ' over time</div>' +
          '<div class="portfolio-hero-chart-wrap"><canvas id="portfolio-history-chart"></canvas></div>' +
        '</div>'
      : '';

    const el = document.createElement('section');
    el.className = 'portfolio-hero';
    el.innerHTML =
      '<div class="portfolio-hero-row">' +
        '<div class="portfolio-hero-col">' +
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
          '</div>' +
        '</div>' +
        chartHtml +
      '</div>';

    tableEl.parentNode.insertAdjacentElement('beforebegin', el);
    if (chartPoints && chartPoints.length >= 1) {
      // showLine requires >=2 chart points spanning genuinely different dates. The
      // same-day dedup above (skipping the synthetic "Now" point when it would land
      // on the last real snapshot's date) already guarantees that whenever chartPoints
      // has 2+ entries, they're on different days — so gating on chartPoints.length is
      // both correct and less strict than the old history.length>=2 gate, which kept
      // showing two disconnected dots even once "Now" was a day past the single seed
      // snapshot, right up until the second monthly batch run.
      const showLine = chartPoints.length >= 2;
      drawPortfolioChart($('portfolio-history-chart'), chartPoints, sym, indexName, showLine);
    }
  }

  function renderActivityTable(soldData, asAt, currency) {
    // Only show exits from the most recent batch run; older history accumulates in sold.json but isn't shown.
    const recent = soldData.filter(function(s) { return s.exitDate === asAt; });
    const sym = currencySymbol(currency);
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

    const lastNote = document.querySelector('.leverage-note');
    const ref = lastNote || tableEl.parentNode;
    ref.insertAdjacentElement('afterend', el);
  }

  async function init() {
    let rankings, firstSeen, portfolioData, soldData, portfolioHistory;
    try {
      [rankings, firstSeen, portfolioData, soldData, portfolioHistory] = await Promise.all([
        getJSON('./rankings.json'),
        getJSON('./first-seen.json').catch(() => ({})),
        getJSON('./portfolio-value.json').catch(() => null),
        getJSON('./sold.json').catch(() => []),
        getJSON('./portfolio-history.json').catch(() => []),
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
    const live = await fetchLivePrices(tickersForLive);
    if (portfolioData && portfolioData.indexTicker) {
      const indexPrice = await fetchIndexPriceLive(portfolioData.indexTicker);
      if (indexPrice != null) live[portfolioData.indexTicker] = indexPrice;
    }
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
    if (portfolioData) renderHeroCard(portfolioData, rows, live, portfolioHistory);
    if (portfolioData) renderActivityTable(soldData || [], rankings.asAt, rows[0] ? rows[0].currency : null);
  }

  init();
}());
