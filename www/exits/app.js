(function () {
  const SOURCES = [
    { market: 'ASX 300',    path: '../asx-undervalued/sold.json',    currency: 'AUD' },
    { market: 'S&P 500',    path: '../sp500-undervalued/sold.json',  currency: 'USD' },
    { market: 'NIFTY 500',  path: '../nifty-undervalued/sold.json',  currency: 'INR' },
    { market: 'KOSPI 200',  path: '../kospi-undervalued/sold.json',  currency: 'KRW' },
    { market: 'Nikkei 225', path: '../nikkei-undervalued/sold.json', currency: 'JPY' },
    { market: 'Europe',     path: '../europe-undervalued/sold.json', currency: 'EUR' },
  ];
  const symbols = { AUD: '$', USD: '$', INR: '₹', KRW: '₩', JPY: '¥', EUR: '€' };

  const statusEl = document.getElementById('status');
  const marketsEl = document.getElementById('markets');

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed: ' + url);
    return res.json();
  }

  function daysBetween(a, b) {
    const ms = new Date(b) - new Date(a);
    return Math.round(ms / 86400000);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function renderMarketCard(src, sold) {
    const rows = sold.slice().sort((a, b) => (a.exitDate < b.exitDate ? 1 : a.exitDate > b.exitDate ? -1 : 0));
    const sym = symbols[src.currency] || '$';

    // ASX and S&P 500 are the two markets with a full 90-day track record
    // (see the article) -- open by default so the two most-checked markets
    // don't require a click. The other four collapse: real content, one tap
    // away, without pushing a first-time visitor past four thin markets
    // before reaching anything they came for.
    const isOpenByDefault = src.market === 'ASX 300' || src.market === 'S&P 500';
    const section = document.createElement('details');
    section.className = 'market-card';
    if (isOpenByDefault) section.setAttribute('open', '');

    if (!rows.length) {
      section.innerHTML =
        '<summary class="market-title">' + escapeHtml(src.market) + '</summary>' +
        '<p class="status">No exits recorded yet.</p>';
      marketsEl.appendChild(section);
      return;
    }

    let wins = 0;
    let returnSum = 0;
    let pnlSum = 0;
    let pnlCount = 0;
    const bodyHtml = rows.map(r => {
      const ret = (r.exitPrice - r.entryPrice) / r.entryPrice;
      if (ret >= 0) wins++;
      returnSum += ret;
      const retStr = (ret >= 0 ? '+' : '') + (ret * 100).toFixed(1) + '%';
      const days = daysBetween(r.entryDate, r.exitDate);
      const hasPnl = typeof r.dollarPnl === 'number';
      let pnlCell = '<td class="num pnl-na">—</td>';
      if (hasPnl) {
        pnlSum += r.dollarPnl;
        pnlCount++;
        const pnlStr = (r.dollarPnl >= 0 ? '+' : '') + sym + Math.abs(r.dollarPnl).toFixed(2);
        pnlCell = '<td class="num ' + (r.dollarPnl >= 0 ? 'pos' : 'neg') + '">' + pnlStr + '</td>';
      }
      return '<tr>' +
        '<td>' + escapeHtml(r.ticker) + '</td>' +
        '<td>' + r.entryDate + '</td>' +
        '<td class="num">' + sym + Number(r.entryPrice).toFixed(2) + '</td>' +
        '<td>' + r.exitDate + '</td>' +
        '<td class="num">' + sym + Number(r.exitPrice).toFixed(2) + '</td>' +
        '<td class="num ' + (ret >= 0 ? 'pos' : 'neg') + '">' + retStr + '</td>' +
        '<td class="num">' + days + '</td>' +
        pnlCell +
      '</tr>';
    }).join('');

    const winRate = (wins / rows.length) * 100;
    const avgReturn = (returnSum / rows.length) * 100;
    const avgReturnStr = (avgReturn >= 0 ? '+' : '') + avgReturn.toFixed(1) + '%';
    const pnlTotalStr = pnlCount
      ? (pnlSum >= 0 ? '+' : '') + sym + Math.abs(pnlSum).toFixed(2) + (pnlCount < rows.length ? ' (' + pnlCount + '/' + rows.length + ' exits)' : '')
      : '—';

    section.innerHTML =
      '<summary class="market-title">' + escapeHtml(src.market) +
        '<span class="market-summary-inline">' + rows.length + ' exits · ' + winRate.toFixed(0) + '% win rate · avg ' +
        avgReturnStr + ' return</span>' +
      '</summary>' +
      '<div class="table-scroll"><table class="exits-table">' +
        '<thead><tr>' +
          '<th>Stock</th><th>Entry date</th><th class="num">Entry price</th>' +
          '<th>Exit date</th><th class="num">Exit price</th><th class="num">Return</th><th class="num">Days held</th>' +
          '<th class="num">$ P&amp;L (final period)</th>' +
        '</tr></thead>' +
        '<tbody>' + bodyHtml + '</tbody>' +
        '<tfoot><tr>' +
          '<td colspan="5">Average / total</td>' +
          '<td class="num ' + (avgReturn >= 0 ? 'pos' : 'neg') + '">' + avgReturnStr + '</td>' +
          '<td></td>' +
          '<td class="num ' + (pnlCount && pnlSum >= 0 ? 'pos' : pnlCount ? 'neg' : '') + '">' + pnlTotalStr + '</td>' +
        '</tr></tfoot>' +
      '</table></div>' +
      (pnlCount < rows.length
        ? '<p class="pnl-note">$ P&amp;L is the dollar gain/loss for that position\'s final rebalance period only (not the cumulative gain since entry) — a partial-period figure, not total return. Use the Return column for the full entry-to-exit result. "—" = exited before this field started being recorded.</p>'
        : '<p class="pnl-note">$ P&amp;L is the dollar gain/loss for that position\'s final rebalance period only (not the cumulative gain since entry) — a partial-period figure, not total return. Use the Return column for the full entry-to-exit result.</p>');

    marketsEl.appendChild(section);
  }

  async function init() {
    let anyLoaded = false;
    for (const src of SOURCES) {
      try {
        const sold = await getJSON(src.path);
        renderMarketCard(src, sold);
        anyLoaded = true;
      } catch (err) {
        // Missing/unreachable sold.json for one market shouldn't block the others.
      }
    }

    if (!anyLoaded) {
      statusEl.textContent = 'Could not load exit history for any market.';
      return;
    }
    statusEl.hidden = true;
  }

  init();
})();
