(function () {
  var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());

  if (isNative) {
    var slot = document.getElementById('kv-nav-placeholder') || document.querySelector('.kv-tool-nav');
    if (slot) slot.remove();
    // Keep the logo element as an in-app "back" affordance rather than
    // removing it — Android users have the OS hardware/gesture back button
    // as a fallback, but iOS has no equivalent, so this was the only way
    // back to the app's home screen on iOS. Point it at the app's own
    // compact home screen directly (skips the web hub + its redirect hop);
    // dcf/app.js may further override this to /app/watchlist.html when a
    // ticker was opened from there (see its `from=watchlist` handling).
    var logo = document.querySelector('.home-logo');
    if (logo) {
      logo.setAttribute('href', '/app/index.html');
      // Swap the KashVector logo + "All tools" label for a plain back arrow —
      // the logo/label combo reads as branding chrome in a focused native
      // screen, not a navigation affordance. kv-shared.css's .home-logo rule
      // (position/size) is left untouched since it's shared with the web
      // experience; this inline override only ever applies natively.
      logo.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
      logo.style.cssText = 'position:absolute;top:16px;left:16px;display:flex;align-items:center;justify-content:center;width:32px;height:32px;color:var(--kv-text,var(--text,#f5f7fc));';
    }
    return;
  }

  const TOOLS = [
    { name: 'Stock Evaluator',  slug: 'stock' },
    { name: 'DCF Valuation',    slug: 'dcf' },
    { name: 'Gordon Growth',    slug: 'gordon-growth' },
    { name: 'Growth Evaluator', slug: 'growth' },
    { name: 'Portfolio',        slug: 'portfolio-health' },
    { name: 'Budget',           slug: 'budget' },
    { name: 'Debt Recycling',   slug: 'debt-recycling' },
    { name: 'FIRE',             slug: 'fire' },
    { name: 'Mortgage Calculator', slug: 'mortgage' },
    { name: 'Salary Sacrifice', slug: 'super-compare' },
    { name: 'Rent vs Buy',      slug: 'rent-vs-buy' },
    { name: 'Life Buyback',     slug: 'life-buyback' },
    { name: 'Budget Impact',    slug: 'budget-impact' },
    { name: 'HECS',             slug: 'hecs' },
    { name: 'Articles',         slug: 'articles' },
    { name: 'Glossary',         slug: 'glossary' },
    { name: 'Contact',          slug: 'contact' },
  ];

  const path = window.location.pathname;
  const currentSlug = TOOLS.find(
    t => path.includes('/' + t.slug + '/') || path.endsWith('/' + t.slug)
  )?.slug;

  // CSS — nested var fallbacks: --kv-* (most tools) → --* (Stock Evaluator) → hardcoded
  //
  // `safe center` (not plain `center`), found 2026-08-04: with plain `center`,
  // once TOOLS grows wide enough to overflow the viewport (17 items did, at
  // common desktop widths), the browser centers the flex line within the
  // scrollport and `scrollLeft: 0` shows neither true edge — items clip on
  // BOTH sides simultaneously ("Stock Evaluator" cut mid-word on the left,
  // "Contact" never reachable on the right) with no scroll gesture that shows
  // the true start. `safe center` (CSS Box Alignment L3) was tried here to
  // center on fit and fall back to start-alignment on overflow, but `safe`/
  // `unsafe` centering has inconsistent browser support (weak/no support in
  // Safari) — on unsupporting browsers it silently behaves as plain `center`,
  // which is the clipping bug all over again. `flex-start` always (matching
  // the mobile override, now redundant and removed) guarantees the nav never
  // clips: it always starts at position 0 and the existing overflow-x:auto
  // scrolls to reach anything past the fold.
  //
  // The scrollbar itself used to be hidden (scrollbar-width:none +
  // ::-webkit-scrollbar{display:none}) — that's a separate bug from the
  // clip-direction one above: it left the overflow technically scrollable
  // (wheel/trackpad/drag all worked) but with zero visual indication that
  // more items existed past the right edge, which looks identical to a
  // truncated/broken nav. Now shown as a thin themed scrollbar instead.
  const style = document.createElement('style');
  style.textContent = `
    .kv-tool-nav{display:flex;justify-content:flex-start;overflow-x:auto;border-bottom:1px solid var(--kv-border,var(--border,#223052));background:var(--kv-bg,var(--bg,#0b1120));padding:0 16px;scrollbar-width:thin;scrollbar-color:var(--kv-border,var(--border,#223052)) transparent;}
    .kv-tool-nav::-webkit-scrollbar{height:6px;}
    .kv-tool-nav::-webkit-scrollbar-track{background:transparent;}
    .kv-tool-nav::-webkit-scrollbar-thumb{background:var(--kv-border,var(--border,#223052));border-radius:3px;}
    .kv-tool-nav::-webkit-scrollbar-thumb:hover{background:var(--kv-muted,var(--muted,#93a0bd));}
    .kv-tool-nav a{flex-shrink:0;padding:10px 14px;font-size:0.82rem;font-weight:500;color:var(--kv-muted,var(--muted,#93a0bd));text-decoration:none;border-bottom:2px solid transparent;white-space:nowrap;transition:color 0.15s;}
    .kv-tool-nav a:hover{color:var(--kv-text,var(--text,#f5f7fc));}
    .kv-tool-nav a.kv-nav-active{color:var(--kv-accent,var(--accent,#f5a623));border-bottom-color:var(--kv-accent,var(--accent,#f5a623));}
    html:not(.dark) .kv-tool-nav{background:#faf8f4;border-color:#e7e2d8;}
    html:not(.dark) .kv-tool-nav a{color:#4d5c6b;}
    html:not(.dark) .kv-tool-nav a:hover{color:#16202b;}
    html:not(.dark) .kv-tool-nav a.kv-nav-active{color:#1a3a5f;border-bottom-color:#1a3a5f;}
  `;
  document.head.appendChild(style);

  function buildNav() {
    const nav = document.createElement('nav');
    nav.className = 'kv-tool-nav';
    nav.setAttribute('aria-label', 'KashVector tools');
    nav.innerHTML = TOOLS.map(t =>
      `<a href="/${t.slug}/"${t.slug === currentSlug ? ' class="kv-nav-active" aria-current="page"' : ''}>${t.name}</a>`
    ).join('');
    return nav;
  }

  function tryInsert() {
    if (document.querySelector('.kv-tool-nav')) return true;
    const placeholder = document.getElementById('kv-nav-placeholder');
    if (placeholder) {
      placeholder.replaceWith(buildNav());
      return true;
    }
    const header = document.querySelector('header.app-header') || document.querySelector('header');
    if (header) {
      header.insertAdjacentElement('afterend', buildNav());
      return true;
    }
    return false;
  }

  function init() {
    if (!tryInsert()) {
      const observer = new MutationObserver(function () {
        if (tryInsert()) observer.disconnect();
      });
      observer.observe(document.body || document.documentElement, { childList: true, subtree: true });
    }
  }

  // Run immediately if body is available (script placed after the placeholder) so nav is
  // part of the initial layout — no post-paint shift. The placeholder's own height reserves
  // the space even before this script runs, so this is zero-CLS regardless of timing.
  // Falls back to DOMContentLoaded/MutationObserver for scripts in <head> or React apps
  // where the placeholder isn't in the DOM yet (or absent).
  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }
}());
