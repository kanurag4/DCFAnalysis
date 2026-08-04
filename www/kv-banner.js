(function () {
  var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  if (isNative) return;

  // SINGLE SOURCE OF TRUTH for the "Hot article" link — update this one object when
  // publishing a new article and every page follows, including the hub.
  //
  // Two render paths share it, which is why it lives here rather than in page markup:
  //   1. Tool/article pages — this script injects a .kv-article-banner after .kv-tool-nav.
  //   2. The hub (www/index.html) — has no tool nav; it renders its own .header-article-link
  //      pill in the hero instead, which syncHeaderLink() below keeps in step.
  // The hub previously hardcoded its own copy and silently drifted out of sync with this
  // file (hub showed one article, all 38 other pages showed an older one). Don't
  // reintroduce a second hardcoded copy in any page's HTML.
  //
  // shortTitle is optional — used only for the hub's hero pill, where the full headline
  // can wrap awkwardly inside the bordered pill. Falls back to title when omitted.
  const LATEST = {
    title: 'DCF Valuation Guide: A Walkthrough With Best Buy and Sonic Healthcare',
    shortTitle: 'DCF Valuation Guide: A Walkthrough With Two Real Stocks',
    href: '/articles/best-buy-sonic-healthcare-dcf/'
  };

  const style = document.createElement('style');
  style.textContent = `
    .kv-article-banner {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 16px;
      height: 40px;
      background: var(--kv-card, var(--card, #111a30));
      border-left: 3px solid var(--kv-accent, var(--accent, #f5a623));
      border-bottom: 1px solid var(--kv-border, var(--border, #223052));
      font-size: 0.82rem;
      overflow: hidden;
    }
    .kv-article-banner-label {
      color: var(--kv-muted, var(--muted, #93a0bd));
      flex-shrink: 0;
      white-space: nowrap;
    }
    .kv-article-banner a {
      color: var(--kv-text, var(--text, #f5f7fc));
      text-decoration: none;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      transition: color 0.15s;
    }
    .kv-article-banner a:hover { color: var(--kv-accent, var(--accent, #f5a623)); }
    html:not(.dark) .kv-article-banner {
      background: #ffffff;
      border-left-color: #1a3a5f;
      border-bottom-color: #e7e2d8;
    }
    html:not(.dark) .kv-article-banner-label { color: #4d5c6b; }
    html:not(.dark) .kv-article-banner a { color: #16202b; }
    html:not(.dark) .kv-article-banner a:hover { color: #1a3a5f; }
    @media (max-width: 600px) {
      .kv-article-banner { font-size: 0.75rem; padding: 0 12px; }
    }
  `;
  document.head.appendChild(style);

  function buildBanner() {
    const div = document.createElement('div');
    div.className = 'kv-article-banner';
    div.innerHTML =
      '<span class="kv-article-banner-label">Hot article:</span>' +
      '<a href="' + LATEST.href + '">' + LATEST.title + ' →</a>';
    return div;
  }

  function tryInsert() {
    if (document.querySelector('.kv-article-banner')) return true;
    const nav = document.querySelector('.kv-tool-nav');
    if (nav) { nav.insertAdjacentElement('afterend', buildBanner()); return true; }
    return false;
  }

  // The hub renders its own hero pill instead of the injected banner — keep it in sync
  // so LATEST above stays the only place an article link is edited.
  function syncHeaderLink() {
    const link = document.querySelector('.header-article-link');
    if (!link) return;
    link.href = LATEST.href;
    link.textContent = '🔥 Hot article: ' + (LATEST.shortTitle || LATEST.title) + ' →';
  }

  function init() {
    syncHeaderLink();

    // Pages without a tool nav (the hub) never get the injected banner — don't leave a
    // MutationObserver running for the life of the page waiting for a nav that never comes.
    if (!document.querySelector('.kv-tool-nav') && !document.getElementById('kv-nav-placeholder')) return;

    if (!tryInsert()) {
      const observer = new MutationObserver(function () {
        if (tryInsert()) observer.disconnect();
      });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.body) { init(); } else { document.addEventListener('DOMContentLoaded', init); }
}());
