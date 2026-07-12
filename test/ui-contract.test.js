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
  assert.match(styles, /\.v4-player-header\s*\{\s*position:\s*relative;/s);
});
