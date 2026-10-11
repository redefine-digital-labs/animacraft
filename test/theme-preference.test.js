import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const bootstrapSource = await readFile(new URL('../public/theme-bootstrap.js', import.meta.url), 'utf8');

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
      setAttribute(name, value) {
        attributes.set(name, value);
      },
    },
    querySelector(selector) {
      if (selector !== 'meta[name="theme-color"]') return null;
      return {
        setAttribute(name, value) {
          metaAttributes.set(name, value);
        },
      };
    },
  };
  Object.defineProperty(documentObject, 'cookie', {
    get: () => cookie,
    set(value) {
      cookieWrites.push(value);
    },
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
  return {
    api: windowObject.ANIMACRAFT_THEME,
    attributes,
    colorScheme: documentObject.documentElement.style.colorScheme,
    metaAttributes,
    cookieWrites,
    storage,
  };
}

test('the synchronous bootstrap resolves only production theme ids before CSS', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const scriptIndex = html.indexOf('<script src="/theme-bootstrap.js');
  const stylesheetIndex = html.indexOf('<link rel="stylesheet"');

  assert.ok(scriptIndex > -1, 'theme bootstrap must be external');
  assert.ok(scriptIndex < stylesheetIndex, 'theme bootstrap must run before CSS');
  assert.match(html, /<meta name="theme-color" content="#f3f7f8"\s*\/>/);
  assert.doesNotMatch(
    html.slice(html.indexOf('<head>'), html.indexOf('</head>')),
    /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/,
    'the CSP-compatible theme bootstrap must not use inline JavaScript',
  );

  const defaults = runBootstrap();
  assert.deepEqual([...defaults.api.THEME_IDS], ['auto', 'animacraft', 'soulidity']);
  assert.equal(defaults.api.readPreference(), 'auto');
  assert.equal(defaults.attributes.get('data-theme'), 'animacraft');
  assert.equal(defaults.attributes.get('data-theme-preference'), 'auto');
  assert.equal(defaults.colorScheme, 'light');
  assert.equal(defaults.metaAttributes.get('content'), '#f3f7f8');
  assert.equal(defaults.api.resolveTheme('auto'), 'animacraft');
  assert.equal(defaults.api.resolveTheme('animacraft'), 'animacraft');
  assert.equal(defaults.api.resolveTheme('soulidity'), 'soulidity');
  assert.equal(defaults.api.resolveTheme('unsupported'), 'animacraft');
});

test('the cross-subdomain cookie wins and localStorage is the fallback', () => {
  const cookieWins = runBootstrap({
    cookie: 'session=abc; soulidity_visual_theme=auto',
    storedPreference: 'soulidity',
  });
  assert.equal(cookieWins.api.readPreference(), 'auto');
  assert.equal(cookieWins.attributes.get('data-theme'), 'animacraft');

  const localFallback = runBootstrap({
    cookie: 'soulidity_visual_theme=unsupported',
    storedPreference: 'soulidity',
  });
  assert.equal(localFallback.api.readPreference(), 'soulidity');
  assert.equal(localFallback.attributes.get('data-theme'), 'soulidity');
  assert.equal(localFallback.attributes.get('data-theme-preference'), 'soulidity');
  assert.equal(localFallback.colorScheme, 'dark');
  assert.equal(localFallback.metaAttributes.get('content'), '#0d0a1e');

  const unavailableStorage = runBootstrap({ storageThrows: true });
  assert.equal(unavailableStorage.api.readPreference(), 'auto');
  assert.equal(unavailableStorage.attributes.get('data-theme'), 'animacraft');
});

test('theme changes persist to the shared cookie and local fallback without app side effects', () => {
  const secure = runBootstrap({ protocol: 'https:' });
  assert.equal(secure.api.setPreference('soulidity'), 'soulidity');
  assert.equal(secure.storage.get('soulidity-visual-theme'), 'soulidity');
  assert.equal(secure.attributes.get('data-theme'), 'soulidity');
  assert.match(secure.cookieWrites.at(-1), /^soulidity_visual_theme=soulidity;/);
  assert.match(secure.cookieWrites.at(-1), /;\s*Domain=\.soulidity\.ai(?:;|$)/);
  assert.match(secure.cookieWrites.at(-1), /;\s*Path=\//);
  assert.match(secure.cookieWrites.at(-1), /;\s*Max-Age=31536000/);
  assert.match(secure.cookieWrites.at(-1), /;\s*SameSite=Lax/);
  assert.match(secure.cookieWrites.at(-1), /;\s*Secure$/);

  const local = runBootstrap({ protocol: 'http:', hostname: 'localhost' });
  assert.equal(local.api.setPreference('unsupported'), 'auto');
  assert.equal(local.storage.get('soulidity-visual-theme'), 'auto');
  assert.equal(local.attributes.get('data-theme'), 'animacraft');
  assert.doesNotMatch(local.cookieWrites.at(-1), /Domain=/);
  assert.doesNotMatch(local.cookieWrites.at(-1), /;\s*Secure(?:;|$)/);

  const securePreview = runBootstrap({ protocol: 'https:', hostname: 'animacraft-preview.vercel.app' });
  securePreview.api.setPreference('animacraft');
  assert.doesNotMatch(securePreview.cookieWrites.at(-1), /Domain=/);
  assert.match(securePreview.cookieWrites.at(-1), /;\s*Secure$/);

  const insecureSoulidityHost = runBootstrap({
    protocol: 'http:',
    hostname: 'animacraft.soulidity.ai',
  });
  insecureSoulidityHost.api.setPreference('soulidity');
  assert.match(insecureSoulidityHost.cookieWrites.at(-1), /;\s*Domain=\.soulidity\.ai(?:;|$)/);
  assert.doesNotMatch(
    insecureSoulidityHost.cookieWrites.at(-1),
    /;\s*Secure(?:;|$)/,
    'Secure must only be emitted for HTTPS',
  );
});

test('the topbar theme menu exposes radio semantics and keyboard-safe application wiring', async () => {
  const [html, app] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="themeButton"[\s\S]*?aria-haspopup="menu"[\s\S]*?aria-expanded="false"/);
  assert.match(html, /id="themeMenu"[\s\S]*?role="menu"[\s\S]*?aria-labelledby="themeButton"/);
  assert.equal((html.match(/role="menuitemradio"/g) || []).length, 3);
  assert.deepEqual(
    [...html.matchAll(/data-theme-option="([^"]+)"/g)].map((match) => match[1]),
    ['auto', 'animacraft', 'soulidity'],
  );

  assert.match(app, /function setVisualThemePreference\(preference\)[\s\S]*?visualThemeRuntime\?\.setPreference/);
  const setter = app.slice(
    app.indexOf('function setVisualThemePreference(preference)'),
    app.indexOf('function renderI18n()', app.indexOf('function setVisualThemePreference(preference)')),
  );
  assert.doesNotMatch(setter, /renderAll|makerWorkspace|save|wallet|chain|renderer/i);
  assert.match(app, /\['ArrowDown', 'ArrowUp', 'Home', 'End'\]/);
  assert.match(app, /event\.key === 'Escape'[\s\S]*?closeThemeMenu\(\)/);
  assert.match(app, /event\.target\.closest\('\.theme-control'\)[\s\S]*?closeThemeMenu\(\)/);
  assert.match(app, /closeThemeMenu\(\{ returnFocus = true \} = \{\}\)/);
  assert.match(app, /window\.addEventListener\('focus', syncVisualThemePreference\)/);
  assert.match(app, /window\.addEventListener\('pageshow', syncVisualThemePreference\)/);
});

test('all five application languages own the complete visual-theme vocabulary', async () => {
  const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
  const requiredKeys = [
    'visualThemeLabel',
    'themeButtonAria',
    'themeAuto',
    'themeAutoCopy',
    'themeAnimacraft',
    'themeAnimacraftCopy',
    'themeSoulidity',
    'themeSoulidityCopy',
  ];
  for (const locale of ['en', 'zh', 'ja', 'ko', 'vi']) {
    const start = app.indexOf(`  ${locale}: {`, app.indexOf('const visualThemeI18n ='));
    const end = app.indexOf('\n  },', start);
    const dictionarySource = app.slice(start, end);
    requiredKeys.forEach((key) => {
      assert.match(dictionarySource, new RegExp(`\\b${key}:\\s*'[^']+'`), `${locale}.${key} must be translated`);
    });
  }
});

test('both palettes expose the same semantic contract while artwork keeps neutral canvas tokens', async () => {
  const styles = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
  const soulidityStart = styles.indexOf(':root[data-theme="soulidity"]');
  const soulidityEnd = styles.indexOf('\n}', soulidityStart);
  const animacraftPalette = styles.slice(0, soulidityStart);
  const soulidityPalette = styles.slice(soulidityStart, soulidityEnd);
  const requiredTokens = [
    'bg',
    'surface',
    'text',
    'muted',
    'border',
    'action',
    'brand',
    'value',
    'tech',
    'success',
    'warning',
    'danger',
    'overlay',
    'focus',
    'shadow',
    'radius-control',
    'radius-panel',
    'radius-modal',
    'font-sans',
    'font-mono',
  ];

  assert.ok(soulidityStart > -1, 'Soulidity must own an explicit resolved palette');
  requiredTokens.forEach((token) => {
    assert.match(animacraftPalette, new RegExp(`--ui-${token}:`), `shared contract is missing --ui-${token}`);
  });
  requiredTokens
    .filter((token) => !['font-sans', 'font-mono'].includes(token))
    .forEach((token) => {
      assert.match(soulidityPalette, new RegExp(`--ui-${token}:`), `Soulidity is missing --ui-${token}`);
    });
  assert.match(animacraftPalette, /--ui-action:\s*#6d4fe8;/);
  assert.match(soulidityPalette, /--ui-action:\s*#7c3aed;/);
  assert.doesNotMatch(
    soulidityPalette,
    /--ui-canvas-/,
    'brand switching must not recolor the Maker observation surface',
  );
  assert.match(styles, /\.v4-canvas-viewport\s*\{[\s\S]*?var\(--ui-canvas-checker-a\)/);
  assert.match(styles, /\.theme-option\[aria-checked="true"\]/);
  for (const legacyToken of ['mint-dark', 'mint-soft', 'teal', 'teal-dark', 'sun']) {
    assert.match(styles, new RegExp(`--${legacyToken}:`), `legacy alias --${legacyToken} must be defined`);
  }
});
