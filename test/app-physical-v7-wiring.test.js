import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WORKSPACE_URL = new URL('../maker-workspace.js', import.meta.url);
const APP_URL = new URL('../app.js', import.meta.url);
const WARDROBE_URL = new URL('../maker-wardrobe-v7.js', import.meta.url);
const PUBLICATION_APP_URL = new URL('../maker-physical-publication-v7-app.js', import.meta.url);

test('Creator and Player wire the additive v7 catalog while keeping chain actions fail-closed', async () => {
  const [workspace, app, wardrobe, publicationApp] = await Promise.all([
    readFile(WORKSPACE_URL, 'utf8'),
    readFile(APP_URL, 'utf8'),
    readFile(WARDROBE_URL, 'utf8'),
    readFile(PUBLICATION_APP_URL, 'utf8'),
  ]);
  assert.match(workspace, /getPhysicalStyleCatalogV7Draft/);
  assert.match(workspace, /add-selected-physical-style/);
  assert.match(workspace, /physical-style-supply/);
  assert.match(workspace, /export-physical-supplier-template/);
  assert.match(workspace, /physical-catalog-open/);
  assert.match(workspace, /importThirdPartyStyleProductPackageV7/);
  assert.match(workspace, /smartColorMustBeBaked/);
  assert.match(wardrobe, /wardrobe_smart_color_bake_required/);
  assert.match(workspace, /derivePhysicalStylePlayerCatalogV7/);
  assert.match(workspace, /Physical Style catalog v7|physical Style catalog v7/i);
  assert.match(app, /physicalStyleV7ReleaseEnabled:\s*runtimeConfig\.physicalStyleV7ReleaseEnabled === true/);
  assert.match(app, /advancePhysicalV7Publication/);
  assert.match(app, /preparePhysicalV7Publication/);
  assert.match(app, /readPhysicalV7PublicationSubmission/);
  assert.match(app, /transactionFromPhysicalV7PublicationAction/);
  assert.match(app, /currentMakerReleaseDocumentV7\(\)/);
  assert.match(app, /baseManifestBlobId/);
  assert.match(app, /advanceCurrentMakerAdditivePublication/);
  assert.match(app, /physicalStyleV7PlayerActionsEnabled:\s*false/);
  assert.match(app, /Player purchase\/equip remains explicitly disabled/);
  assert.match(publicationApp, /persistProgress/);
  assert.match(publicationApp, /progress:\s*structuredClone\(progress\)/);
  assert.doesNotMatch(workspace, /onPhysicalStylePurchase/);
  assert.doesNotMatch(workspace, /onPhysicalStyleEquip/);
  assert.match(workspace, /physicalStyleV7PlayerActionsEnabled/);
});

test('v7 release gate is configured false by default', async () => {
  const runtime = await import('../runtime-config.js');
  assert.equal(runtime.DEFAULT_RUNTIME_CONFIG.physicalStyleV7ReleaseEnabled, false);
  assert.ok(runtime.validateRuntimeConfig({
    ...runtime.DEFAULT_RUNTIME_CONFIG,
    physicalStyleV7ReleaseEnabled: true,
    compositionV6ReleaseEnabled: false,
  }).errors.some((message) => /requires Composable Assets v6/.test(message)));
});
