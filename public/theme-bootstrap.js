(function bootstrapAnimacraftTheme(windowObject, documentObject) {
  'use strict';

  const THEME_IDS = Object.freeze(['auto', 'animacraft', 'soulidity']);
  const COOKIE_NAME = 'soulidity_visual_theme';
  const STORAGE_KEY = 'soulidity-visual-theme';
  const THEME_META_COLORS = Object.freeze({
    animacraft: '#f3f7f8',
    soulidity: '#0d0a1e',
  });

  function normalizePreference(value) {
    return THEME_IDS.includes(value) ? value : null;
  }

  function readCookie(cookieSource = documentObject.cookie) {
    const prefix = `${COOKIE_NAME}=`;
    const entry = String(cookieSource || '')
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix));
    if (!entry) return null;
    try {
      return normalizePreference(decodeURIComponent(entry.slice(prefix.length)));
    } catch {
      return null;
    }
  }

  function readLocalPreference() {
    try {
      return normalizePreference(windowObject.localStorage?.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  function readPreference() {
    return readCookie() || readLocalPreference() || 'auto';
  }

  function resolveTheme(preference) {
    return normalizePreference(preference) === 'soulidity' ? 'soulidity' : 'animacraft';
  }

  function applyPreference(preference) {
    const normalized = normalizePreference(preference) || 'auto';
    const resolved = resolveTheme(normalized);
    documentObject.documentElement.setAttribute('data-theme', resolved);
    documentObject.documentElement.setAttribute('data-theme-preference', normalized);
    documentObject.documentElement.style.colorScheme = resolved === 'soulidity' ? 'dark' : 'light';
    documentObject.querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_META_COLORS[resolved]);
    return resolved;
  }

  function writeCookie(preference) {
    const hostname = String(windowObject.location?.hostname || '').toLowerCase();
    const soulidityHost = hostname === 'soulidity.ai' || hostname.endsWith('.soulidity.ai');
    const attributes = [
      `${COOKIE_NAME}=${encodeURIComponent(preference)}`,
      'Path=/',
      'Max-Age=31536000',
      'SameSite=Lax',
    ];
    if (soulidityHost) attributes.push('Domain=.soulidity.ai');
    if (windowObject.location?.protocol === 'https:') attributes.push('Secure');
    documentObject.cookie = attributes.join('; ');
  }

  function setPreference(preference) {
    const normalized = normalizePreference(preference) || 'auto';
    try {
      windowObject.localStorage?.setItem(STORAGE_KEY, normalized);
    } catch {
      // A valid cross-subdomain cookie still keeps the preference when storage is unavailable.
    }
    try {
      writeCookie(normalized);
    } catch {
      // Local development may reject the production cookie domain; localStorage remains the fallback.
    }
    applyPreference(normalized);
    return normalized;
  }

  const api = Object.freeze({
    THEME_IDS,
    COOKIE_NAME,
    STORAGE_KEY,
    THEME_META_COLORS,
    normalizePreference,
    readCookie,
    readPreference,
    resolveTheme,
    applyPreference,
    setPreference,
  });

  windowObject.ANIMACRAFT_THEME = api;
  applyPreference(readPreference());
}(window, document));
