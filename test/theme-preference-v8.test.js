import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const bootstrapSource = await readFile(new URL('../public-v8/theme-bootstrap.js', import.meta.url), 'utf8');

function runBootstrap({
  cookie = '',
  storedPreference = null,
  protocol = 'https:',
  hostname = 'animacraft.soulidity.ai',
  storageThrows = false,
} = {}) {
  const attributes = new Map();
  const metaAttributes = new Map();
  const storage = new Map(storedPreference === null ? [] : [['soulidity-visual-theme', storedPreference]]);
  const cookieWrites = [];
  const documentObject = {
    documentElement: {
      style: {},
      setAttribute(name, value) { attributes.set(name, value); },
    },
    querySelector(selector) {
      if (selector !== 'meta[name="theme-color"]') return null;
      return { setAttribute(name, value) { metaAttributes.set(name, value); } };
    },
  };
  Object.defineProperty(documentObject, 'cookie', {
    get: () => cookie,
    set(value) { cookieWrites.push(value); },
  });
  const windowObject = {
    location: { protocol, hostname },
    localStorage: {
      getItem(key) {
        if (storageThrows) throw new Error('storage unavailable');
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        if (storageThrows) throw new Error('storage unavailable');
        storage.set(key, value);
      },
    },
  };
  runInNewContext(bootstrapSource, {
    window: windowObject,
    document: documentObject,
    encodeURIComponent,
    decodeURIComponent,
  });
  return { api: windowObject.ANIMACRAFT_THEME, attributes, metaAttributes, cookieWrites, storage };
}

test('the synchronous bootstrap runs before CSS and resolves only approved themes', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const themeBootstrapIndex = html.indexOf('<script src="/theme-bootstrap.js?v=animacraft-theme-v1"');
  assert.ok(themeBootstrapIndex > -1);
  assert.ok(themeBootstrapIndex < html.indexOf('<link rel="stylesheet"'));
  assert.match(html, /<meta name="theme-color" content="#f3f7f8" \/>/);
  assert.doesNotMatch(html.slice(html.indexOf('<head>'), html.indexOf('</head>')), /<script(?![^>]*\bsrc=)[^>]*>/);

  const result = runBootstrap();
  assert.deepEqual([...result.api.THEME_IDS], ['auto', 'animacraft', 'soulidity']);
  assert.equal(result.api.readPreference(), 'auto');
  assert.equal(result.attributes.get('data-theme'), 'animacraft');
  assert.equal(result.attributes.get('data-theme-preference'), 'auto');
  assert.equal(result.metaAttributes.get('content'), '#f3f7f8');
  assert.equal(result.api.resolveTheme('unsupported'), 'animacraft');
});

test('shared cookie wins, storage remains the fallback, and failures stay safe', () => {
  const cookieWins = runBootstrap({ cookie: 'session=abc; soulidity_visual_theme=auto', storedPreference: 'soulidity' });
  assert.equal(cookieWins.api.readPreference(), 'auto');
  assert.equal(cookieWins.attributes.get('data-theme'), 'animacraft');

  const localFallback = runBootstrap({ cookie: 'soulidity_visual_theme=unsupported', storedPreference: 'soulidity' });
  assert.equal(localFallback.api.readPreference(), 'soulidity');
  assert.equal(localFallback.attributes.get('data-theme'), 'soulidity');
  assert.equal(localFallback.metaAttributes.get('content'), '#0d0a1e');

  const unavailable = runBootstrap({ storageThrows: true });
  assert.equal(unavailable.api.readPreference(), 'auto');
  assert.equal(unavailable.attributes.get('data-theme'), 'animacraft');
});

test('theme changes persist with correct production and preview cookie boundaries', () => {
  const secure = runBootstrap();
  assert.equal(secure.api.setPreference('soulidity'), 'soulidity');
  assert.equal(secure.storage.get('soulidity-visual-theme'), 'soulidity');
  assert.match(secure.cookieWrites.at(-1), /^soulidity_visual_theme=soulidity;/);
  assert.match(secure.cookieWrites.at(-1), /Domain=\.soulidity\.ai/);
  assert.match(secure.cookieWrites.at(-1), /Secure$/);

  const preview = runBootstrap({ hostname: 'animacraft-preview.vercel.app' });
  preview.api.setPreference('animacraft');
  assert.doesNotMatch(preview.cookieWrites.at(-1), /Domain=/);
  assert.match(preview.cookieWrites.at(-1), /Secure$/);

  const local = runBootstrap({ protocol: 'http:', hostname: 'localhost' });
  local.api.setPreference('unsupported');
  assert.equal(local.storage.get('soulidity-visual-theme'), 'auto');
  assert.doesNotMatch(local.cookieWrites.at(-1), /Domain=|Secure/);
});

test('theme menu semantics and both palette contracts remain complete', async () => {
  const [html, originalApp, styles] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../original-product-app.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(html, /id="themeButton"[^>]*aria-haspopup="menu"[^>]*aria-expanded="false"/);
  assert.match(html, /id="themeMenu"[^>]*role="menu"[^>]*aria-labelledby="themeButton"/);
  assert.equal((html.match(/role="menuitemradio"/g) || []).length, 3);
  assert.deepEqual([...html.matchAll(/data-theme-option="([^"]+)"/g)].map((match) => match[1]), ['auto', 'animacraft', 'soulidity']);
  assert.match(originalApp, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/);
  assert.match(originalApp, /event\.key === 'Escape'/);
  assert.match(originalApp, /win\.ANIMACRAFT_THEME/);
  assert.match(originalApp, /runtime\?\.readPreference\?\.\(\)/);

  const soulidityStart = styles.indexOf(':root[data-theme="soulidity"]');
  const soulidityEnd = styles.indexOf('\n}', soulidityStart);
  const light = styles.slice(0, soulidityStart);
  const dark = styles.slice(soulidityStart, soulidityEnd);
  for (const token of ['bg', 'surface', 'text', 'muted', 'border', 'action', 'brand', 'value', 'tech', 'success', 'warning', 'danger', 'overlay', 'focus', 'shadow', 'radius-control', 'radius-panel', 'radius-modal']) {
    assert.match(light, new RegExp(`--ui-${token}:`), `light --ui-${token}`);
    assert.match(dark, new RegExp(`--ui-${token}:`), `dark --ui-${token}`);
  }
  assert.match(light, /--ui-action:\s*#6d4fe8;/);
  assert.match(dark, /--ui-action:\s*#7c3aed;/);
  assert.doesNotMatch(dark, /--ui-canvas-/, 'theme switching must not recolor character artwork');
  assert.match(styles, /\.v4-canvas-viewport\s*\{[\s\S]*?var\(--ui-canvas-checker-a\)/);
  assert.match(styles, /\.theme-option\[aria-checked="true"\]/);
});
