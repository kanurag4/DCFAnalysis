// www/kv-glossary.js — dotted-underline term annotations + popover engine,
// shared across the 4 stock tools. Root-level shared script allowed to touch
// the DOM (same precedent as kv-ticker-input.js/kv-theme.js/kv-nav.js) —
// www/kv-glossary-data.js stays the pure/DOM-free half.
//
// window.kvGlossary.term(key, label) returns the HTML for an annotated term.
// Event delegation on `document` (not per-element listeners) means the
// annotations survive stock/growth's full innerHTML rebuilds on every
// Analyse with zero re-binding — same reasoning as kv-ticker-input.js's
// delegated autocomplete-item clicks.
(function (root, doc) {
  'use strict';

  var DATA = root.kvGlossaryData || {};
  var POPOVER_ID = 'kv-glossary-popover';
  var isNative = !!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform());
  var hoverCapable = !!(root.matchMedia && root.matchMedia('(hover: hover)').matches);

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  // Unknown key -> plain escaped label, no wrapper, no dotted underline.
  // A stale/typo'd key degrades to invisible-plain-text rather than a
  // broken interactive element.
  function term(key, label) {
    var entry = DATA[key];
    var text = esc(label);
    if (!entry) return text;
    return '<span class="kv-term" data-term="' + esc(key) + '" tabindex="0" role="button" aria-expanded="false">' + text + '</span>';
  }

  // ── Popover singleton ──────────────────────────────────────────────────
  var popoverEl = null;
  var currentTrigger = null;
  var showTimer = null;
  var hideTimer = null;

  function glossaryHref(key) {
    return isNative ? '/glossary/index.html#' + key : '/glossary/#' + key;
  }

  function ensurePopover() {
    if (popoverEl) return popoverEl;
    popoverEl = doc.createElement('div');
    popoverEl.id = POPOVER_ID;
    popoverEl.className = 'kv-glossary-popover';
    popoverEl.setAttribute('role', 'tooltip');
    popoverEl.hidden = true;
    doc.body.appendChild(popoverEl);
    popoverEl.addEventListener('mouseover', clearHideTimer);
    popoverEl.addEventListener('mouseout', function (e) {
      if (!hoverCapable) return;
      var to = e.relatedTarget;
      if (to && (popoverEl.contains(to) || (currentTrigger && currentTrigger.contains(to)))) return;
      scheduleHide();
    });
    return popoverEl;
  }

  function clearShowTimer() { if (showTimer) { clearTimeout(showTimer); showTimer = null; } }
  function clearHideTimer() { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; } }

  function position(triggerEl) {
    var pop = popoverEl;
    var rect = triggerEl.getBoundingClientRect();
    var vw = root.innerWidth;
    var vh = root.innerHeight;
    var margin = 8;

    pop.style.left = '0px';
    pop.style.top = '0px';
    pop.style.visibility = 'hidden';
    pop.hidden = false;
    var pw = pop.offsetWidth;
    var ph = pop.offsetHeight;

    var left = rect.left + rect.width / 2 - pw / 2;
    left = Math.max(margin, Math.min(left, vw - pw - margin));

    var below = rect.bottom + 8;
    var above = rect.top - 8 - ph;
    var top, flipped;
    if (below + ph <= vh - margin || below + ph - vh < rect.top - above) {
      top = below;
      flipped = false;
    } else {
      top = Math.max(margin, above);
      flipped = true;
    }

    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.style.visibility = '';
    pop.classList.toggle('kv-glossary-popover-flip', flipped);
    // Caret points at the trigger's horizontal center, clamped inside the box.
    var caretLeft = Math.max(10, Math.min(rect.left + rect.width / 2 - left, pw - 10));
    pop.style.setProperty('--kv-caret-left', caretLeft + 'px');
  }

  function show(triggerEl, key) {
    var entry = DATA[key];
    if (!entry) return;
    ensurePopover();
    clearShowTimer();
    clearHideTimer();
    if (currentTrigger && currentTrigger !== triggerEl) {
      currentTrigger.setAttribute('aria-expanded', 'false');
    }
    currentTrigger = triggerEl;
    popoverEl.innerHTML =
      '<div class="kv-glossary-popover-title">' + esc(entry.term) + '</div>' +
      '<div class="kv-glossary-popover-body">' + esc(entry.short) + '</div>' +
      '<a class="kv-glossary-popover-link" href="' + esc(glossaryHref(key)) + '">Learn more →</a>';
    triggerEl.setAttribute('aria-expanded', 'true');
    var popId = POPOVER_ID;
    triggerEl.setAttribute('aria-describedby', popId);
    position(triggerEl);
  }

  function hide() {
    clearShowTimer();
    clearHideTimer();
    if (!popoverEl || popoverEl.hidden) return;
    popoverEl.hidden = true;
    if (currentTrigger) {
      currentTrigger.setAttribute('aria-expanded', 'false');
      currentTrigger.removeAttribute('aria-describedby');
    }
    currentTrigger = null;
  }

  function scheduleShow(triggerEl, key) {
    clearHideTimer();
    if (currentTrigger === triggerEl && popoverEl && !popoverEl.hidden) return;
    clearShowTimer();
    showTimer = setTimeout(function () { show(triggerEl, key); }, 150);
  }

  function scheduleHide() {
    clearShowTimer();
    clearHideTimer();
    hideTimer = setTimeout(hide, 200);
  }

  function closestTerm(el) {
    return el && el.closest ? el.closest('.kv-term') : null;
  }

  // A tap on a focusable element fires `focus` before `click` (same tick).
  // Without this guard, tapping a term on a touch device would open the
  // popover on focusin, then immediately close it again when the
  // click handler's toggle branch ran a moment later — net effect: nothing
  // visible. Set on pointerdown (fires before both focus and click),
  // consumed by the next focusin, with a timeout safety net in case focus
  // never follows (e.g. the element was already focused).
  var pointerFocusPending = false;
  var pointerFocusTimer = null;
  doc.addEventListener('pointerdown', function (e) {
    if (!closestTerm(e.target)) return;
    pointerFocusPending = true;
    clearTimeout(pointerFocusTimer);
    pointerFocusTimer = setTimeout(function () { pointerFocusPending = false; }, 500);
  }, true);

  // ── Delegated event wiring ──────────────────────────────────────────────
  if (hoverCapable) {
    doc.addEventListener('mouseover', function (e) {
      var trigger = closestTerm(e.target);
      if (trigger) scheduleShow(trigger, trigger.getAttribute('data-term'));
    });
    doc.addEventListener('mouseout', function (e) {
      var trigger = closestTerm(e.target);
      if (!trigger) return;
      var to = e.relatedTarget;
      if (to && (trigger.contains(to) || (popoverEl && popoverEl.contains(to)))) return;
      scheduleHide();
    });
  }

  // Tap-to-toggle: always wired (covers touch devices, and hover-capable
  // devices where a user taps rather than hovers, e.g. hybrid laptops).
  doc.addEventListener('click', function (e) {
    var trigger = closestTerm(e.target);
    if (trigger) {
      // Several tool pages nest a .kv-term inside a <label> (e.g. GGM's
      // franking-credits checkbox label, DCF's fcf/dividend/rf/erp
      // labels). A click on ANY non-form descendant of a <label> forwards
      // to that label's associated control by native browser behaviour —
      // without this, clicking a term to read its definition also toggles
      // a checkbox or focuses a text input underneath it. preventDefault()
      // suppresses that forwarding; it does not affect this span's own
      // focus (which already happened on mousedown, a separate event).
      e.preventDefault();
      var key = trigger.getAttribute('data-term');
      if (currentTrigger === trigger && popoverEl && !popoverEl.hidden) {
        hide();
      } else {
        show(trigger, key);
      }
      return;
    }
    if (popoverEl && !popoverEl.hidden && !popoverEl.contains(e.target)) hide();
  });

  doc.addEventListener('keydown', function (e) {
    var trigger = closestTerm(e.target);
    if (trigger && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      show(trigger, trigger.getAttribute('data-term'));
      return;
    }
    // The popover is appended once at the end of <body>, so it sits outside
    // the natural tab order right after its trigger — without this, the
    // "Learn more" link is reachable only by mouse/touch. Tab from an open
    // trigger jumps straight into the link; Shift+Tab from the link jumps
    // back to the trigger. (Tab forward out of the link is left to the
    // browser's default order — a known minor rough edge, not fixed here.)
    if (trigger && e.key === 'Tab' && !e.shiftKey && currentTrigger === trigger && popoverEl && !popoverEl.hidden) {
      var link = popoverEl.querySelector('.kv-glossary-popover-link');
      if (link) { e.preventDefault(); link.focus(); return; }
    }
    if (e.key === 'Tab' && e.shiftKey && popoverEl && !popoverEl.hidden &&
        e.target === popoverEl.querySelector('.kv-glossary-popover-link') && currentTrigger) {
      e.preventDefault();
      currentTrigger.focus();
      return;
    }
    if (e.key === 'Escape' && popoverEl && !popoverEl.hidden) {
      var toFocus = currentTrigger;
      hide();
      if (toFocus) toFocus.focus();
    }
  });

  doc.addEventListener('focusin', function (e) {
    var trigger = closestTerm(e.target);
    if (!trigger) return;
    if (pointerFocusPending) { pointerFocusPending = false; return; } // let the click handler own opening
    show(trigger, trigger.getAttribute('data-term'));
  });

  doc.addEventListener('focusout', function (e) {
    var trigger = closestTerm(e.target);
    if (!trigger) return;
    var to = e.relatedTarget;
    if (to && popoverEl && popoverEl.contains(to)) return;
    hide();
  });

  root.addEventListener('scroll', function () { if (popoverEl && !popoverEl.hidden) hide(); }, { passive: true, capture: true });

  root.kvGlossary = { term: term };
})(typeof window !== 'undefined' ? window : this, typeof document !== 'undefined' ? document : null);
