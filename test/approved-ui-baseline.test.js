import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const [
  html,
  themeBootstrap,
  approvedStyles,
  editorShell,
  visualFixture,
  deploymentConfigSource,
  exampleConfigSource,
] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public-v8/theme-bootstrap.js', import.meta.url), 'utf8'),
  readFile(new URL('../styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../maker-editor-shell.js', import.meta.url), 'utf8'),
  readFile(new URL('./fixtures/approved-creator-visual.html', import.meta.url), 'utf8'),
  readFile(new URL('../public-v8/config.js', import.meta.url), 'utf8'),
  readFile(new URL('../config.example.js', import.meta.url), 'utf8'),
]);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

test('unchanged UI baseline is byte locked outside explicit feature, retired collection and error wrapping deltas', () => {
  const back = '<button id="backToCreatorPreview" class="secondary" type="button" hidden>Back to Creator Studio</button>';
  const deletion = '<button id="deleteMakerDraft" class="danger-button" type="button" data-lifecycle-action="delete-draft" hidden>Delete local draft</button>';
  const collectionShortcut = '        <button data-page="collection"><strong data-i18n="myOcs">My Souls</strong><span data-i18n="myOcsCopy">Soulidity-owned characters</span></button>\n';
  const collectionPage = `      <section id="collection" class="page">
        <div class="page-head">
          <div>
            <p class="kicker" data-i18n="myPage">MyPage</p>
            <h1 data-i18n="myOcs">My Souls</h1>
            <p data-i18n="collectionSoulidityCopy">Finished characters, Living Content, social identity, and marketplace ownership are managed by Soulidity.</p>
          </div>
          <button id="refreshOwnedCharacters" class="secondary" type="button" data-i18n="openMySouls">Open My Souls</button>
        </div>
        <div id="ownedCharacterStatus" class="collection-status"></div>
        <div id="ownedCharacterGrid" class="collection-grid"></div>
      </section>

`;
  assert.equal(html.split(back).length, 2);
  assert.equal(html.split(deletion).length, 2);
  assert.doesNotMatch(html, /data-page="collection"|id="collection"|refreshOwnedCharacters|ownedCharacterGrid/);
  assert.ok(html.includes(`<section id="make" class="page">\n        ${back}\n        <div id="makerV4PlayerMount"`), 'Local Player return must be outside the hidden retired editor.');
  assert.match(html, /maker-lifecycle-manager-footer[\s\S]*?id="deleteMakerDraft"[\s\S]*?data-lifecycle-action="open-editor"/);
  const baselineHtml = html
    .replace('        <button data-page="creator"', `${collectionShortcut}        <button data-page="creator"`)
    .replace('      <section id="creator" class="page">', `${collectionPage}      <section id="creator" class="page">`)
    .replace(`        ${back}\n`, '')
    .replace('            <button id="downloadRecipe"', `            ${back}\n            <button id="downloadRecipe"`)
    .replace(`              ${deletion}\n`, '')
    .replace(/^(                    <p id="makerRetirementNotice"[^\n]+\n)/m, '$1                    <button id="deleteMakerDraft" class="danger-button" type="button" data-i18n="deleteDraft">Delete draft</button>\n');
  assert.equal(sha256(baselineHtml), 'e88319ae3d79831d9ae8f7a15623812579e20dbba48cb4850869b30111b3ba40');
  assert.equal(sha256(themeBootstrap), 'b3c771feafe6b8a92fd09210c6dbe7904c8fac030f67ab52f7749d7dbf1f2713');
  const completionStyles = `#makerPlayerCompletionStep {
  min-width: 0;
  overflow-wrap: anywhere;
}

#makerPlayerCompletionStep dl > div {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 8px;
  padding: 7px 0;
}

#makerPlayerCompletionStep footer {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

#makerPlayerCompletionStep footer button {
  flex: 1 1 140px;
  white-space: normal;
}

`;
  const collectionStyles = `.collection-status {
  margin-bottom: 14px;
  color: var(--muted);
  font-weight: 800;
}

.collection-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));
  gap: 16px;
}

.owned-oc-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--paper-strong);
  box-shadow: var(--shadow);
}

.owned-oc-media {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  overflow: hidden;
  border-bottom: 1px solid var(--line);
  background: var(--ui-canvas-checker-b);
  color: var(--muted);
}

.owned-oc-media img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.owned-oc-body {
  padding: 16px;
}

.owned-oc-body h2 {
  margin-top: 10px;
  overflow-wrap: anywhere;
}

.owned-oc-body p {
  margin-bottom: 12px;
}

.owned-oc-links {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
}

.owned-oc-links a {
  color: var(--ui-success);
  font-size: 13px;
  font-weight: 900;
}

`;
  assert.equal(approvedStyles.split(completionStyles).length, 2);
  const networkErrorWrapping = `.plaza-empty-state,
.chain-status-card {
  min-width: 0;
  overflow-wrap: anywhere;
}

`;
  assert.equal(approvedStyles.split(networkErrorWrapping).length, 2);
  assert.doesNotMatch(approvedStyles, /\.collection-(?:status|grid)|\.owned-oc-/);
  const baselineStyles = approvedStyles.replace(networkErrorWrapping, '')
    .replace('.badge-row,\n.template-footer,', `${collectionStyles}.badge-row,\n.template-footer,`);
  assert.equal(sha256(baselineStyles.replace(completionStyles, '')), '22f486c0fdc3e109703602ed27574300f1c2c8bf41f185a8b514beb46674d46d');
  assert.equal(sha256(editorShell), 'b01b9084154d6b14e2017340122cbbd7cac4b8e5cebfeb6435d05a36064ba6bb');
});

test('deployment and example configs expose the canonical Soulidity origin in an independent frozen namespace', () => {
  for (const [label, configSource] of [
    ['deployment', deploymentConfigSource],
    ['example', exampleConfigSource],
  ]) {
    const context = { window: {} };
    runInNewContext(configSource, context);
    const product = context.window.ANIMACRAFT_CONFIG;
    assert.equal(product.soulidityAppUrl, 'https://www.soulidity.ai', label);
    assert.equal(Object.isFrozen(product), true, label);
    assert.deepEqual(Object.keys(product), ['soulidityAppUrl'], label);
    assert.equal(Object.hasOwn(context.window.SoulidityMakerV8, 'soulidityAppUrl'), false, label);
    assert.equal(Object.hasOwn(context.window.SoulidityV8Execution, 'soulidityAppUrl'), false, label);
  }
});

test('index.html loads only the original approved presentation assets', () => {
  const themeScript = '<script src="/theme-bootstrap.js?v=animacraft-theme-v1"></script>';
  const stylesheet = '<link rel="stylesheet" href="./styles.css?v=animacraft-docs-single-scroll-v5" />';
  const configScript = '<script src="/config.js"></script>';
  const appScript = '<script type="module" src="./app.js?v=animacraft-docs-single-scroll-v5"></script>';

  assert.ok(html.indexOf(themeScript) > -1);
  assert.ok(html.indexOf(themeScript) < html.indexOf(stylesheet));
  assert.ok(html.indexOf(stylesheet) < html.indexOf(configScript));
  assert.ok(html.indexOf(configScript) < html.indexOf('<body>'));
  assert.ok(html.indexOf(appScript) > html.indexOf('</main>'));

  const stylesheetLinks = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s*\/>/g)]
    .map((match) => match[1]);
  assert.deepEqual(stylesheetLinks, ['./styles.css?v=animacraft-docs-single-scroll-v5']);

  assert.doesNotMatch(html, /fresh-v8-bindings\.css|creator-workspace\.css/i);
  assert.doesNotMatch(html, /product-shell\.js|id="productShell"|data-fresh-v8-creator/i);
});

test('the visual fixture projects the canonical index DOM instead of recreating it', () => {
  assert.match(visualFixture, /fetch\('\/index\.html', \{ cache: 'no-store' \}\)/);
  assert.match(visualFixture, /document\.body\.replaceChildren\(\.\.\.parsed\.body\.children\)/);
  assert.doesNotMatch(visualFixture, /product-shell\.js|createProductShell|fresh-v8-bindings\.css|creator-workspace\.css/i);
});

test('the original header, theme menu and account popover DOM are preserved', () => {
  assert.match(
    html,
    /<header class="topbar">[\s\S]*?<a class="brand" href="#templates"[\s\S]*?<nav class="main-nav"[\s\S]*?<div class="account-cluster">/,
  );
  assert.match(html, /id="walletButton" class="wallet-button"/);
  assert.match(html, /id="themeButton"[\s\S]*class="theme-button"[\s\S]*aria-controls="themeMenu"/);
  assert.match(html, /id="themeMenu"[\s\S]*class="theme-menu"[\s\S]*role="menu"/);
  assert.match(
    html,
    /id="accountButton" class="account-button"[\s\S]*class="account-avatar">A<[\s\S]*class="account-label"/,
  );
  assert.match(html, /id="accountPanel" class="account-panel" aria-hidden="true"/);
  assert.match(html, /class="account-panel-head"/);
  assert.match(html, /class="account-summary"/);
  assert.match(html, /class="account-grid"/);
  assert.match(html, /class="soulidity-account-actions"/);
  assert.doesNotMatch(html, /id="mainNavigation"|mobile-menu-button|class="main-nav open"/);
});

test('the original route tree has no competing local collection and preserves the Creator mount contract', () => {
  const pageIds = [...html.matchAll(/<section id="([^"]+)" class="page(?:\s|")/g)]
    .map((match) => match[1]);
  assert.deepEqual(pageIds, ['templates', 'template', 'make', 'creator', 'docs']);
  assert.doesNotMatch(html, /data-page="collection"|id="refreshOwnedCharacters"|id="ownedCharacter(?:Status|Grid)"/);

  assert.match(
    html,
    /<div id="makerV4PlayerMount" class="maker-v4-mount maker-v4-player-mount" aria-live="polite"><\/div>/,
  );
  assert.match(
    html,
    /<div id="makerV4CreatorMount" class="maker-v4-mount maker-v4-creator-mount" aria-live="polite"><\/div>/,
  );
  assert.match(html, /id="creatorWalletGate" class="creator-wallet-gate"/);
  assert.match(html, /id="creatorConsole" class="creator-console" hidden/);
  assert.match(html, /data-creator-view="list"/);
  assert.match(html, /data-creator-view="edit"/);
  assert.match(
    html,
    /data-editor-panel-button="top"[\s\S]*data-editor-panel-button="parts"[\s\S]*data-editor-panel-button="living"[\s\S]*data-open-maker-release[\s\S]*data-editor-panel-button="settings"/,
  );
});

test('the original dialogs and detailed interaction anchors remain available to the app controller', () => {
  for (const id of [
    'makerRegistrationModal',
    'draftRecoveryModal',
    'makerLifecycleManagerModal',
    'partRegistrationModal',
    'confirmActionModal',
  ]) {
    assert.match(html, new RegExp(`id="${id}" class="maker-modal" aria-hidden="true"`));
  }

  assert.match(html, /id="playMakerPreview" class="secondary"/);
  assert.match(html, /id="saveMakerDraft" class="secondary"/);
  assert.match(html, /id="downloadManifest" class="secondary"/);
  assert.match(html, /data-open-maker-release/);
  assert.match(html, /id="makerLifecycleCard"/);
  assert.match(html, /id="makerLifecycleManagerModal"/);
  assert.doesNotMatch(html, /Fresh Maker v8 market|Astral Courier|Hanamori Spirit|Local starter/i);
});
