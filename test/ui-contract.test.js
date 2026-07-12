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

test('Maker v4 mounts separate Creator and Player workspaces on one renderer', async () => {
  const [html, app, workspace, styles] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../app.js', import.meta.url), 'utf8'),
    readFile(new URL('../maker-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="makerV4CreatorMount"/);
  assert.match(html, /id="makerV4PlayerMount"/);
  assert.match(html, /id="legacyPlayerEditor"[^>]*hidden/);
  assert.match(app, /buildMakerV4PublicationBundle/);
  assert.match(app, /makerWorkspace\.renderRecipeToBlob\(recipe\)/);
  assert.match(workspace, /renderResolvedScene\(scene, canvas/);
  assert.match(workspace, /data-action="player-none"/);
  assert.match(styles, /\.maker-v4-mount\s*\{[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/s);
  assert.match(styles, /@media \(max-width:\s*820px\)[\s\S]*?\.creator-function-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  assert.match(styles, /\.v4-player-header\s*\{\s*position:\s*relative;/s);
});
