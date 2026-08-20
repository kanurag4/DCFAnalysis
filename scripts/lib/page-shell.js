// scripts/lib/page-shell.js
// Shared HTML chrome for the three per-ticker-SEO-page generators
// (generate-ticker-page.js, generate-market-index.js, generate-stocks-hub.js).
//
// All three previously inlined their own near-identical <head>/<header>/<footer>,
// so any change to the shared chrome — a new stylesheet link, a nav change, a
// footer tweak — had to be made in three places and would silently drift the
// moment one was missed. One copy now.

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// items: [{ name, url }] in crumb order, root first. The last item is rendered
// as the current page (no link) in the visible nav, but still gets a position
// in the JSON-LD, which is what Google expects.
function breadcrumbJsonLd(items) {
  const el = items.map((it, i) => `{"@type":"ListItem","position":${i + 1},"name":${JSON.stringify(it.name)},"item":${JSON.stringify(it.url)}}`).join(',');
  return `{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[${el}]}`;
}

function breadcrumbNav(items) {
  const parts = items.map((it, i) => (i === items.length - 1)
    ? `<span class="current">${escapeHtml(it.name)}</span>`
    : `<a href="${escapeHtml(it.path)}">${escapeHtml(it.name)}</a>`);
  return `<nav class="ticker-breadcrumb">${parts.join('<span class="sep">&rsaquo;</span>')}</nav>`;
}

// jsonLd: array of already-serialised JSON-LD strings.
function pageShell({ title, description, canonical, h1, subtitle, jsonLd = [], breadcrumbHtml = '', mainHtml }) {
  const ld = jsonLd.map(block => `  <script type="application/ld+json">\n  ${block}\n  </script>`).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#f8fafc">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <link rel="canonical" href="${escapeHtml(canonical)}">
${ld}
  <script src="/kv-theme.js"></script>
  <link rel="stylesheet" href="/brand.css">
  <link rel="stylesheet" href="/kv-shared.css">
  <link rel="stylesheet" href="/dcf/style.css">
  <link rel="icon" type="image/svg+xml" href="/dcf-icon.svg">
</head>
<body>
  <div id="kv-nav-placeholder" style="height:41px"></div>
  <script src="/kv-nav.js"></script>
  <script src="/kv-footer.js"></script>

  <header class="app-header">
    <h1>${escapeHtml(h1)}</h1>
    <button class="theme-toggle" onclick="window.kvTheme.toggle()" aria-label="Toggle theme"></button>
  </header>
  ${breadcrumbHtml}

  <main>
${mainHtml}
  </main>

  <footer>
    <p class="disclaimer">General information only, not financial advice. <a href="/privacy-site.html" id="privacy-link">Privacy Policy</a></p>
    <p><a href="/">&larr; All KashVector tools</a></p>
    <p>&copy; 2026 KashVector. All rights reserved.</p>
  </footer>
</body>
</html>
`;
}

module.exports = { pageShell, escapeHtml, breadcrumbJsonLd, breadcrumbNav };
