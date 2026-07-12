import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('the live canvas empty state obeys the HTML hidden contract', async () => {
  const [html, app, styles] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="creatorCanvasEmpty" class="creator-canvas-empty"/);
  assert.match(app, /\$\('creatorCanvasEmpty'\)\.hidden = images\.length > 0;/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important;/);
});

test('the player workbench constrains the canvas and scrolls its side panels', async () => {
  const [html, styles] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /class="avatar-viewport">\s*<div id="avatar" class="avatar"/);
  assert.match(styles, /\.maker-layout\s*\{[^}]*height:\s*clamp\(520px,\s*calc\(100dvh - 222px\),\s*760px\);/s);
  assert.match(styles, /\.canvas-panel\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.parts-panel\s*\{[^}]*overflow-y:\s*auto;/s);
});

test('the certified OC handoff uses the dedicated Soulidity adapter for free and paid Makers', async () => {
  const [html, app, runtime] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../runtime-config.js', import.meta.url), 'utf8'),
  ]);

  assert.match(runtime, /soulidityIntegrationPath:\s*'\/integrations\/animacraft'/);
  assert.match(app, /soulidityAppLink\(runtimeConfig\.soulidityIntegrationPath/);
  assert.match(app, /profileBlob:\s*state\.ocProfilePatchId/);
  assert.match(app, /imageBlob:\s*state\.ocImagePatchId/);
  assert.match(app, /recipeHash:\s*bytesToHex\(state\.pendingOcRecipeHash\)/);
  assert.match(app, /const adapterReady = canonicalSoulMintEnabled;/);
  assert.match(app, /if \(!canonicalSoulMintEnabled\) throw new Error\('Canonical Soul minting is not activated for this release\.'\);/);
  assert.doesNotMatch(app, /&& !activeTemplate\(\)\?\.mintFeeEnabled && ocRecipeIssues/);
  assert.match(html, /id="soulidityMySoulsLink" data-soulidity-auth/);
  assert.match(html, /<strong>Dedicated handoff<\/strong>/);
  assert.doesNotMatch(html, /<strong>Temporary Import Kit<\/strong>/);
});
