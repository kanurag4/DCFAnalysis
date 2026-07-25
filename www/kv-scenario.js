// kv-scenario.js — shared cross-tool scenario links, profile, and next-step
// suggestions. Pure functions (readParams, buildLink) are Node-testable.
// Functions that touch localStorage/DOM (getProfile, saveProfile,
// renderSuggestion) are only ever called from a tool's own app.js, per the
// DOM boundary rule — this file does not act on its own on load.

(function (root) {
  'use strict';

  function readParams(fieldMap, search) {
    const qs = typeof search === 'string' ? search : (root.location ? root.location.search : '');
    const params = new URLSearchParams(qs);
    const out = {};
    for (const inputId in fieldMap) {
      const key = fieldMap[inputId].param;
      if (params.has(key)) out[inputId] = params.get(key);
    }
    return out;
  }

  function buildLink(fieldMap, getValue, base) {
    const origin = typeof base === 'string'
      ? base
      : (root.location.origin + root.location.pathname);
    const params = new URLSearchParams();
    for (const inputId in fieldMap) {
      const value = getValue(inputId);
      if (value === undefined || value === null || value === '') continue;
      params.set(fieldMap[inputId].param, value);
    }
    const qs = params.toString();
    return qs ? `${origin}?${qs}` : origin;
  }

  const PROFILE_KEY = 'kv-profile';

  function getProfile() {
    try {
      const raw = root.localStorage.getItem(PROFILE_KEY);
      if (!raw) return { fields: {}, updated: {} };
      const parsed = JSON.parse(raw);
      return {
        fields: parsed.fields || {},
        updated: parsed.updated || {},
      };
    } catch (_) {
      return { fields: {}, updated: {} };
    }
  }

  function saveProfile(patch) {
    const profile = getProfile();
    const now = new Date().toISOString();
    for (const key in patch) {
      profile.fields[key] = patch[key];
      profile.updated[key] = now;
    }
    try {
      root.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch (_) {}
  }

  const DISMISSED_KEY = 'kv-dismissed-suggestions';

  function getDismissed() {
    try {
      return JSON.parse(root.localStorage.getItem(DISMISSED_KEY) || '[]');
    } catch (_) {
      return [];
    }
  }

  function dismiss(dismissKey) {
    const list = getDismissed();
    if (!list.includes(dismissKey)) list.push(dismissKey);
    try {
      root.localStorage.setItem(DISMISSED_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  function renderSuggestion(container, opts) {
    if (!container) return;
    container.innerHTML = '';
    if (opts.dismissKey && getDismissed().includes(opts.dismissKey)) return;

    const card = root.document.createElement('a');
    card.className = 'kv-suggestion';
    card.href = opts.href;
    card.innerHTML = `<span class="kv-suggestion-text">${opts.text}</span><span class="kv-suggestion-arrow">→</span>`;

    const closeBtn = root.document.createElement('button');
    closeBtn.className = 'kv-suggestion-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Dismiss suggestion');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (opts.dismissKey) dismiss(opts.dismissKey);
      container.innerHTML = '';
    });

    card.appendChild(closeBtn);
    container.appendChild(card);
  }

  const kvScenario = { readParams, buildLink, getProfile, saveProfile, renderSuggestion };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = kvScenario;
  }
  if (typeof root !== 'undefined') {
    root.kvScenario = kvScenario;
  }
})(typeof window !== 'undefined' ? window : globalThis);
