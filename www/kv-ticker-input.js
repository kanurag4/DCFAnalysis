// www/kv-ticker-input.js — shared ticker-input module for the four stock
// tools (stock, dcf, gordon-growth, growth). Follows the same root-level
// shared-script precedent as kv-theme.js/kv-nav.js/kv-scenario.js: it is
// allowed to touch the DOM (unlike config/utils/data/calc/scorers, which
// must stay pure per the DOM boundary rule).
//
// Two halves:
//   - Pure functions (resolveSymbol, parseUrlState, buildUrlQuery,
//     buildToolHref, mergeLegacyRecents, upsertRecent, recentLabel) — no
//     DOM access, Node-testable, dual-exported below.
//   - mount(config) — owns the ticker input, autocomplete, checkbox
//     mutual-exclusion + suffix auto-tick, market-hint text, recent-ticker
//     chips, ?ticker= URL read/write, and (once a tool's markup includes
//     the nav) the evaluation-switcher hrefs. Each tool's own app.js keeps
//     only its fetch + render pipeline, wired in via the onAnalyse callback.
(function (root) {
  'use strict';

  // ── Pure logic ──────────────────────────────────────────────────────────

  // Turn typed input + checkbox state into a resolved Yahoo symbol. Unifies
  // to Gordon Growth Model's behaviour (params/flags OR the typed suffix
  // both count, ASX and NSE/BSE are mutually exclusive with ASX taking
  // priority) and fixes www/growth/data.js's old casing bug by always
  // trimming/uppercasing before resolving.
  function resolveSymbol(input) {
    input = input || {};
    var t = String(input.raw == null ? '' : input.raw).trim().toUpperCase();
    if (!t) return { symbol: '', isAsx: false, isNse: false };
    var isAsx = !!input.isAsx || t.slice(-3) === '.AX';
    var isNse = !isAsx && (!!input.isNse || t.slice(-3) === '.NS' || t.slice(-3) === '.BO');
    var symbol = t;
    if (t.indexOf('.') === -1) {
      if (isAsx) symbol = t + '.AX';
      else if (isNse) symbol = t + '.NS';
    }
    return { symbol: symbol, isAsx: isAsx, isNse: isNse };
  }

  // Read ?ticker=/&asx=/&nse= from a query string (with or without the
  // leading '?'). Returns null when there's no usable ticker param — the
  // same length guard (20 chars) every tool's bootstrapFromUrl already used.
  function parseUrlState(search) {
    var params = new URLSearchParams(search || '');
    var raw = params.get('ticker');
    if (!raw) return null;
    raw = raw.trim();
    if (!raw || raw.length > 20) return null;
    var upper = raw.toUpperCase();
    var isAsx = params.get('asx') === '1' || upper.slice(-3) === '.AX';
    var isNse = !isAsx && (params.get('nse') === '1' || upper.slice(-3) === '.NS' || upper.slice(-3) === '.BO');
    return { ticker: raw, isAsx: isAsx, isNse: isNse };
  }

  // Build the '?ticker=...&asx=1' query string for a resolved state.
  function buildUrlQuery(state) {
    state = state || {};
    var p = new URLSearchParams({ ticker: state.symbol || '' });
    if (state.isAsx) p.set('asx', '1');
    if (state.isNse) p.set('nse', '1');
    return '?' + p.toString();
  }

  var TOOL_PATHS = {
    stock:  '/stock/',
    dcf:    '/dcf/',
    ggm:    '/gordon-growth/',
    growth: '/growth/',
  };

  // Build the href for the evaluation switcher / any cross-tool link.
  // Capacitor's local WebView server redirect-loops on directory-style
  // paths, so native links must carry an explicit index.html.
  function buildToolHref(toolId, state, opts) {
    var base = TOOL_PATHS[toolId];
    if (!base) return null;
    opts = opts || {};
    var path = opts.isNative ? base + 'index.html' : base;
    if (!state || !state.symbol) return path;
    return path + buildUrlQuery(state);
  }

  // Insert/replace an entry at the front of a recents list, deduping on
  // ticker+asx, capped at max.
  function upsertRecent(list, entry, max) {
    list = Array.isArray(list) ? list : [];
    var filtered = list.filter(function (e) {
      return !(e && e.ticker === entry.ticker && !!e.asx === !!entry.asx);
    });
    filtered.unshift(entry);
    return filtered.slice(0, max == null ? 10 : max);
  }

  // Display label for a recent-ticker entry. Only appends .AX when the
  // stored ticker doesn't already carry a market suffix — stock's old
  // per-tool code appended unconditionally, which doubled up to "X.AX.AX"
  // for entries that already had the suffix. This is the safe version
  // every other tool already used; unifying up to it for free.
  function recentLabel(entry) {
    if (!entry || !entry.ticker) return '';
    if (entry.ticker.indexOf('.') !== -1) return entry.ticker;
    return entry.asx ? entry.ticker + '.AX' : entry.ticker;
  }

  // One-time migration: merge the four legacy per-tool recent-ticker lists
  // (each already newest-first, no timestamps) into one list. Since there's
  // no real recency data across lists, round-robin interleaving in the
  // given priority order is the fairest reconstruction — it guarantees each
  // source list's most-recent entry survives the cap rather than one list's
  // entire history crowding out the others.
  function mergeLegacyRecents(lists, max) {
    lists = (lists || []).map(function (l) { return Array.isArray(l) ? l.slice() : []; });
    var merged = [];
    var seen = Object.create(null);
    var round = 0;
    var anyLeft = true;
    while (anyLeft) {
      anyLeft = false;
      for (var i = 0; i < lists.length; i++) {
        var entry = lists[i][round];
        if (!entry || !entry.ticker) continue;
        anyLeft = true;
        var raw = String(entry.ticker).trim().toUpperCase();
        var asx = !!entry.asx;
        var nse = raw.slice(-3) === '.NS' || raw.slice(-3) === '.BO';
        if (asx && raw.indexOf('.') === -1) raw = raw + '.AX';
        var key = raw + '|' + (asx ? '1' : '0');
        if (seen[key]) continue;
        seen[key] = true;
        merged.push({
          ticker: raw,
          asx: asx,
          nse: nse,
          score: (entry.score === undefined ? null : entry.score),
        });
      }
      round++;
      if (round > 50) break; // safety valve — no legacy list should ever be this long
    }
    return merged.slice(0, max == null ? 10 : max);
  }

  var pure = {
    resolveSymbol: resolveSymbol,
    parseUrlState: parseUrlState,
    buildUrlQuery: buildUrlQuery,
    buildToolHref: buildToolHref,
    upsertRecent: upsertRecent,
    recentLabel: recentLabel,
    mergeLegacyRecents: mergeLegacyRecents,
  };

  // ── DOM side ────────────────────────────────────────────────────────────

  // Phase 2 wired each tool with its own legacy key (recent_tickers,
  // dcf_recent_tickers, ggm_recent_tickers, growth_recent_tickers) so the
  // shared module could land without touching user data. This is the one-
  // time migration into the shared key, run once globally the first time
  // ANY tool mounts (the flag and target key are both shared across pages
  // on the same origin, so it doesn't matter which tool the user visits
  // first). Order matches each list's own newest-first ordering.
  var LEGACY_RECENT_KEYS = ['recent_tickers', 'dcf_recent_tickers', 'ggm_recent_tickers', 'growth_recent_tickers'];
  var LEGACY_MIGRATION_FLAG = 'kv_recent_migrated';

  function migrateLegacyRecentsOnce(recentKey, recentMax) {
    try {
      if (localStorage.getItem(LEGACY_MIGRATION_FLAG) === '1') return;
      var legacyLists = LEGACY_RECENT_KEYS.map(function (k) {
        try {
          var raw = localStorage.getItem(k);
          var list = raw ? JSON.parse(raw) : [];
          return Array.isArray(list) ? list : [];
        } catch (_) { return []; }
      });
      // Never overwrite existing data in the shared key — this only ever
      // runs once (the flag prevents re-running), but if it somehow already
      // has entries (e.g. a race between two tabs), don't clobber them.
      var existingRaw = localStorage.getItem(recentKey);
      var existing = existingRaw ? JSON.parse(existingRaw) : [];
      if (!Array.isArray(existing) || existing.length === 0) {
        var merged = mergeLegacyRecents(legacyLists, recentMax);
        if (merged.length > 0) localStorage.setItem(recentKey, JSON.stringify(merged));
      }
      localStorage.setItem(LEGACY_MIGRATION_FLAG, '1');
    } catch (_) {
      // best-effort — a migration failure should never block the page
    }
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function mount(config) {
    config = config || {};
    var tool       = config.tool;
    var proxyUrl   = config.proxyUrl || '';
    var minChars   = config.minChars == null ? 2 : config.minChars;
    var showScores = !!config.showScores;
    var recentKey  = config.recentKey || 'kv_recent_tickers';
    var recentMax  = config.recentMax == null ? 10 : config.recentMax;
    var hints      = config.hints || null;
    var onAnalyse  = config.onAnalyse || function () {};
    var switcherOn = config.switcher !== false;

    var doc = document;
    var tickerEl = doc.getElementById('ticker-input');
    var acListEl = doc.getElementById('autocomplete-list');
    var asxEl    = doc.getElementById('asx-checkbox');
    var nseEl    = doc.getElementById('nse-checkbox');
    var analyseBtn = doc.getElementById('analyse-btn');
    var goBtn      = doc.getElementById('go-btn');
    var hintEl     = doc.getElementById('market-hint');
    var recentEl   = doc.getElementById('recent');

    var required = { 'ticker-input': tickerEl, 'analyse-btn': analyseBtn, 'recent': recentEl };
    for (var id in required) {
      if (!required[id]) { console.warn('kv-ticker-input: mount() could not find #' + id + ' — markup may have drifted'); }
    }
    if (!tickerEl) return null; // nothing to wire without the input itself

    var isNative = !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform());
    var acSeq = 0;
    var acTimer = null;

    // ── Market hint text ───────────────────────────────────────────────────
    function updateHint() {
      if (!hintEl || !hints) return;
      if (nseEl && nseEl.checked && hints.nse) {
        hintEl.innerHTML = hints.nse;
      } else if (asxEl && asxEl.checked && hints.asx) {
        hintEl.innerHTML = hints.asx;
      } else {
        hintEl.innerHTML = hints.none || '';
      }
    }

    // ── Switcher (Phase 4 — no-ops until a page has the markup) ────────────
    function updateSwitcher() {
      if (!switcherOn) return;
      var nav = doc.querySelector('.kv-eval-switcher');
      if (!nav) return;
      var resolved = resolveSymbol({ raw: tickerEl.value, isAsx: asxEl && asxEl.checked, isNse: nseEl && nseEl.checked });
      var links = nav.querySelectorAll('a[data-kv-tool]');
      for (var i = 0; i < links.length; i++) {
        var a = links[i];
        var toolId = a.getAttribute('data-kv-tool');
        // Rewrite every link, including the active tool's own — on native this
        // is the only thing that gives the active pill an index.html-suffixed
        // href instead of the bare directory-style one hardcoded in markup,
        // which would otherwise redirect-loop back to the app's home screen
        // (see the .screen-pill Capacitor trap this codebase already fixed
        // once). On web this is a same-value no-op for the active tool.
        var href = buildToolHref(toolId, resolved.symbol ? resolved : null, { isNative: isNative });
        if (href) a.setAttribute('href', href);
      }
    }

    // ── Recents ─────────────────────────────────────────────────────────────
    function loadRecent() {
      try {
        var raw = localStorage.getItem(recentKey);
        var list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
      } catch (_) { return []; }
    }

    function saveRecentList(list) {
      try { localStorage.setItem(recentKey, JSON.stringify(list)); } catch (_) {}
    }

    function chipColorClass(score) {
      if (!showScores || score == null) return '';
      if (score >= 13) return ' chip-green';
      if (score >= 8)  return ' chip-amber';
      return ' chip-red';
    }

    function renderRecent() {
      var list = loadRecent();
      if (!recentEl) return;
      if (list.length === 0) { recentEl.hidden = true; return; }
      recentEl.hidden = false;
      recentEl.innerHTML = '<span class="recent-label">Recent:</span>' +
        list.map(function (e) {
          return '<span class="chip' + chipColorClass(e.score) + '" data-t="' + esc(e.ticker) +
            '" data-asx="' + (e.asx ? '1' : '0') + '" data-nse="' + (e.nse ? '1' : '0') + '">' +
            '<span class="label">' + esc(recentLabel(e)) + '</span>' +
            '<span class="x" data-remove="1">×</span>' +
            '</span>';
        }).join('');
      var chips = recentEl.querySelectorAll('.chip');
      for (var i = 0; i < chips.length; i++) {
        chips[i].addEventListener('click', function (ev) {
          var chip = ev.currentTarget;
          var t   = chip.getAttribute('data-t');
          var asx = chip.getAttribute('data-asx') === '1';
          var nse = chip.getAttribute('data-nse') === '1';
          if (ev.target.getAttribute('data-remove')) {
            ev.stopPropagation();
            var remaining = loadRecent().filter(function (e) { return !(e.ticker === t && !!e.asx === asx); });
            saveRecentList(remaining);
            renderRecent();
            return;
          }
          tickerEl.value = t;
          if (asxEl) asxEl.checked = asx;
          if (nseEl) nseEl.checked = nse;
          updateHint();
          triggerAnalyse();
        });
      }
    }

    // extra: optional { score } — only Stock Evaluator passes one.
    function recordRecent(symbol, state, extra) {
      extra = extra || {};
      var entry = {
        ticker: symbol,
        asx: !!(state && state.isAsx),
        nse: !!(state && state.isNse),
        score: extra.score === undefined ? null : extra.score,
      };
      var list = upsertRecent(loadRecent(), entry, recentMax);
      saveRecentList(list);
      renderRecent();
    }

    // ── Autocomplete ────────────────────────────────────────────────────────
    function hideAutocomplete() {
      if (!acListEl) return;
      acListEl.hidden = true;
      acListEl.innerHTML = '';
    }

    function renderAc(results) {
      if (!acListEl) return;
      acListEl.innerHTML = results.map(function (r) {
        return '<div class="ac-item" data-symbol="' + esc(r.symbol) + '" role="option" tabindex="-1">' +
          '<span class="ac-name">' + esc(r.name) + '</span>' +
          '<span class="ac-meta">' + esc(r.symbol) + (r.exchange ? ' · ' + esc(r.exchange) : '') + '</span>' +
          '</div>';
      }).join('');
      acListEl.hidden = false;
      var items = acListEl.querySelectorAll('.ac-item');
      for (var i = 0; i < items.length; i++) {
        items[i].addEventListener('click', function (ev) {
          var sym = ev.currentTarget.getAttribute('data-symbol');
          tickerEl.value = sym;
          var upper = sym.toUpperCase();
          var isAsx = upper.slice(-3) === '.AX';
          var isNse = !isAsx && (upper.slice(-3) === '.NS' || upper.slice(-3) === '.BO');
          if (asxEl) asxEl.checked = isAsx;
          if (nseEl) nseEl.checked = isNse;
          if (isAsx || isNse) updateHint();
          hideAutocomplete();
          triggerAnalyse();
        });
      }
    }

    function fetchAc(q) {
      var seq = ++acSeq;
      var url = proxyUrl.replace(/\/$/, '') + '/search?q=' + encodeURIComponent(q);
      fetch(url).then(function (resp) {
        if (seq !== acSeq) return;
        if (!resp.ok) { hideAutocomplete(); return; }
        return resp.json().then(function (results) {
          if (seq !== acSeq) return;
          if (!Array.isArray(results) || results.length === 0) { hideAutocomplete(); return; }
          if (nseEl && nseEl.checked) {
            results = results.filter(function (r) { return r.symbol.slice(-3) === '.NS'; })
              .concat(results.filter(function (r) { return r.symbol.slice(-3) !== '.NS'; }));
          }
          renderAc(results);
        });
      }).catch(function () { if (seq === acSeq) hideAutocomplete(); });
    }

    // ── Checkbox mutual exclusion + suffix auto-tick ───────────────────────
    if (asxEl) {
      asxEl.addEventListener('change', function () {
        if (asxEl.checked && nseEl) nseEl.checked = false;
        updateHint();
        updateSwitcher();
      });
    }
    if (nseEl) {
      nseEl.addEventListener('change', function () {
        if (nseEl.checked && asxEl) asxEl.checked = false;
        updateHint();
        updateSwitcher();
      });
    }

    tickerEl.addEventListener('input', function () {
      var upper = tickerEl.value.toUpperCase();
      if (upper.slice(-3) === '.AX') {
        if (asxEl) asxEl.checked = true;
        if (nseEl) nseEl.checked = false;
      } else if (upper.slice(-3) === '.NS' || upper.slice(-3) === '.BO') {
        if (nseEl) nseEl.checked = true;
        if (asxEl) asxEl.checked = false;
      }
      updateSwitcher();

      clearTimeout(acTimer);
      var q = tickerEl.value.trim();
      if (q.length < minChars) { hideAutocomplete(); return; }
      acTimer = setTimeout(function () { fetchAc(q); }, 300);
    });

    doc.addEventListener('click', function (e) {
      if (acListEl && !tickerEl.contains(e.target) && !acListEl.contains(e.target)) hideAutocomplete();
    });

    tickerEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { hideAutocomplete(); triggerAnalyse(); }
      if (e.key === 'Escape') hideAutocomplete();
    });

    // ── Analyse trigger + URL bootstrap ─────────────────────────────────────
    // opts.fromUrl skips the pushState — used when replaying ?ticker= on
    // load or back/forward navigation rather than a fresh user action.
    function triggerAnalyse(opts) {
      opts = opts || {};
      hideAutocomplete();
      var raw = tickerEl.value.trim();
      var resolved = resolveSymbol({ raw: raw, isAsx: asxEl && asxEl.checked, isNse: nseEl && nseEl.checked });
      if (!raw) {
        onAnalyse({ symbol: '', raw: '', isAsx: resolved.isAsx, isNse: resolved.isNse }, opts);
        return;
      }
      if (!opts.fromUrl) {
        history.pushState({}, '', buildUrlQuery(resolved));
      }
      updateSwitcher();
      onAnalyse({ symbol: resolved.symbol, raw: raw, isAsx: resolved.isAsx, isNse: resolved.isNse }, opts);
    }

    function bootstrapFromUrl() {
      var parsed = parseUrlState(location.search);
      if (!parsed) return;
      tickerEl.value = parsed.ticker;
      if (asxEl) asxEl.checked = parsed.isAsx;
      if (nseEl) nseEl.checked = parsed.isNse;
      updateHint();
      triggerAnalyse({ fromUrl: true });
    }

    // Wrapped in plain functions — addEventListener would otherwise pass the
    // click MouseEvent through as triggerAnalyse's opts argument.
    analyseBtn && analyseBtn.addEventListener('click', function () { triggerAnalyse(); });
    goBtn && goBtn.addEventListener('click', function () { triggerAnalyse(); });

    root.addEventListener('popstate', bootstrapFromUrl);

    migrateLegacyRecentsOnce(recentKey, recentMax);
    updateHint();
    renderRecent();
    updateSwitcher();

    // Deferred one microtask: mount() hasn't returned yet at this point, so
    // a caller doing `var ctl = kvTickerInput.mount(...)` hasn't assigned
    // `ctl` yet either. An onAnalyse callback that synchronously touches the
    // returned controller before its first await (e.g. ctl.setLoading(true)
    // at the top of an async function) would otherwise throw — this defers
    // the initial ?ticker= replay just long enough for that assignment to
    // land. popstate-triggered replays are unaffected (already long after
    // mount() returned).
    Promise.resolve().then(bootstrapFromUrl);

    return {
      getRequest: function () {
        return resolveSymbol({ raw: tickerEl.value, isAsx: asxEl && asxEl.checked, isNse: nseEl && nseEl.checked });
      },
      setLoading: function (on) {
        if (analyseBtn) { analyseBtn.disabled = on; analyseBtn.textContent = on ? 'Analysing…' : 'Analyse'; }
        if (goBtn)      { goBtn.disabled = on;      goBtn.textContent = on ? '…' : 'Go'; }
      },
      recordRecent: recordRecent,
      renderRecent: renderRecent,
      setValue: function (ticker, state) {
        tickerEl.value = ticker;
        if (asxEl) asxEl.checked = !!(state && state.isAsx);
        if (nseEl) nseEl.checked = !!(state && state.isNse);
        updateHint();
        updateSwitcher();
      },
      hideAutocomplete: hideAutocomplete,
      updateSwitcher: updateSwitcher,
      triggerAnalyse: triggerAnalyse,
    };
  }

  var api = Object.assign({ mount: mount, migrateLegacyRecentsOnce: migrateLegacyRecentsOnce }, pure);

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.kvTickerInput = api;
})(typeof window !== 'undefined' ? window : globalThis);
