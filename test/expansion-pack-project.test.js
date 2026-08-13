import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EXPANSION_PACK_ACCESS_MODES,
  EXPANSION_PACK_PARENT_INHERITANCE,
  EXPANSION_PACK_PARENT_BINDING_KINDS,
  EXPANSION_PACK_PART_MODES,
  EXPANSION_PACK_PROJECT_SCHEMA,
  addExpansionPackColorChannel,
  addExpansionPackColorSwatch,
  addExpansionPackItem,
  addExpansionPackLayerTrack,
  addExpansionPackOptionalPart,
  addExpansionPackRule,
  addExpansionPackStyle,
  createExpansionPackProjectPreviewRecipe,
  createExpansionPackProject,
  createExpansionPackProjectFromOverlay,
  mergeExpansionPackProjectPreview,
  preflightExpansionPackProject,
  readExpansionPackParentSnapshot,
  rebindExpansionPackProjectToPublishedRelease,
  moveExpansionPackLayerTrack,
  removeExpansionPackColorChannel,
  removeExpansionPackColorSwatch,
  removeExpansionPackItem,
  removeExpansionPackLayerTrack,
  removeExpansionPackPart,
  removeExpansionPackRule,
  removeExpansionPackStyle,
  renameExpansionPackLayerTrack,
  rehydrateExpansionPackProject,
  setExpansionPackLayerTrackLocked,
  setExpansionPackPartMode,
  updateExpansionPackColorChannel,
  updateExpansionPackColorSwatch,
  updateExpansionPackItemRules,
  updateExpansionPackPartRules,
  updateExpansionPackRule,
  updateExpansionPackStyle,
  updateExpansionPackStyleRules,
  updateExpansionPackCommerce,
} from '../expansion-pack-project.js';

function baseMaker() {
  return {
    schemaVersion: 'animacraft.maker.v5',
    version: {
      rootMakerId: 'maker-root',
      versionId: 'maker-root-v3',
      number: 3,
    },
    metadata: {
      id: 'maker-root',
      name: 'Parent Maker',
      license: { kind: 'personal-use', note: 'Parent terms' },
    },
    manifestHash: 'parent-manifest-hash',
    canvas: { width: 1024, height: 1024, pixelMode: 'smooth' },
    layerTracks: [{ id: 'body-track', name: 'Body', order: 0 }],
    colorChannels: [],
    assets: [{
      id: 'body-art',
      identifier: 'body.png',
      contentHash: 'body-hash',
      mediaType: 'image/png',
    }],
    parts: [{
      id: 'body',
      name: 'Body',
      required: true,
      allowRemove: false,
      defaultItemId: 'body-default',
      items: [{
        id: 'body-default',
        name: 'Default Body',
        defaultStyleId: 'default',
        requires: [],
        excludes: [],
        styles: [{
          id: 'default',
          name: 'Default',
          assetId: 'body-art',
          layerTrackId: 'body-track',
          transform: { x: 0, y: 0, scale: 1, rotation: 0 },
          opacity: 1,
          blendMode: 'normal',
          visibleWhen: null,
          requires: [],
          excludes: [],
        }],
      }],
    }],
    defaultRecipe: {
      selections: [{ partId: 'body', itemId: 'body-default', styleId: 'default' }],
      colors: [],
    },
    commerce: { schemaVersion: 'animacraft.maker-commerce.v5', marker: 'parent-access' },
    livingContent: { 'soul.md': '# Parent identity' },
    extensions: {
      composableV6: { schemaVersion: 'animacraft.maker-composable.v6', marker: 'parent-slots' },
      physicalStyleCatalogV7: { schemaVersion: 'animacraft.physical-style-catalog.v7', marker: 'parent-physical' },
    },
    rules: [],
  };
}

function createProject(parent = baseMaker(), overrides = {}) {
  return createExpansionPackProject(parent, {
    packId: 'moon-pack',
    namespace: 'moon',
    name: 'Moon Pack',
    walletAddress: '0xABCD',
    now: 100,
    ...overrides,
  });
}

test('captures a wallet-bound, deeply read-only parent Maker snapshot', () => {
  const parent = baseMaker();
  const project = createProject(parent);

  assert.equal(project.schemaVersion, EXPANSION_PACK_PROJECT_SCHEMA);
  assert.equal(project.ownerWalletAddress, '0xabcd');
  assert.equal(project.parentBinding.rootMakerId, 'maker-root');
  assert.equal(project.parentBinding.versionNumber, '3');
  assert.equal(project.parentBinding.kind, EXPANSION_PACK_PARENT_BINDING_KINDS.LOCAL_DRAFT);
  assert.equal(project.parentBinding.publishable, false);
  assert.equal(project.publication.publishable, false);
  assert.equal(project.pack.baseMakerId, 'maker-root');
  assert.equal(project.pack.baseVersion, '3');
  assert.equal(project.pack.baseManifestHash, 'parent-manifest-hash');
  assert.deepEqual(project.inheritance, EXPANSION_PACK_PARENT_INHERITANCE);
  assert.ok(Object.isFrozen(project.parentSnapshot));
  assert.ok(Object.isFrozen(project.parentSnapshot.parts));
  assert.ok(Object.isFrozen(project.parentSnapshot.parts[0].items[0]));
  assert.throws(() => {
    project.parentSnapshot.parts[0].name = 'Mutated';
  }, TypeError);
  assert.throws(() => {
    project.parentSnapshot = {};
  }, TypeError);

  parent.parts[0].name = 'Changed outside';
  assert.equal(project.parentSnapshot.parts[0].name, 'Body');
  const readonlyCopy = readExpansionPackParentSnapshot(project);
  assert.ok(Object.isFrozen(readonlyCopy.parts[0]));
});

test('published parent binding is exact while local drafts can never be marked publishable', () => {
  const local = addExpansionPackItem(createProject(), {
    partId: 'body',
    item: {
      id: 'local-item',
      styles: [{ id: 'default', assetId: 'body-art', layerTrackId: 'body-track' }],
    },
  });
  const localPreflight = preflightExpansionPackProject(local);
  assert.equal(localPreflight.valid, true);
  assert.equal(localPreflight.publishable, false);

  const incomplete = baseMaker();
  incomplete.publication = { state: 'active' };
  assert.equal(createProject(incomplete).parentBinding.kind, EXPANSION_PACK_PARENT_BINDING_KINDS.LOCAL_DRAFT);
  const forgedDocument = baseMaker();
  Object.assign(forgedDocument, {
    releaseId: '0xdocument-only-release',
    manifestBlobId: 'document-only-quilt',
    manifestHash: 'aa'.repeat(32),
  });
  assert.equal(createProject(forgedDocument).parentBinding.kind, EXPANSION_PACK_PARENT_BINDING_KINDS.LOCAL_DRAFT);
  assert.throws(() => createExpansionPackProject(forgedDocument, {
    packId: 'forged-parent',
    namespace: 'forged-parent',
    walletAddress: '0xabcd',
    parentRelease: { identityVerified: true },
  }), (error) => (
    error?.code === 'incomplete-published-parent-release'
    && error?.details?.missing?.includes('releaseId')
    && error?.details?.missing?.includes('manifestBlobId')
  ));
  assert.throws(() => createExpansionPackProject(incomplete, {
    packId: 'incomplete-parent',
    namespace: 'incomplete-parent',
    walletAddress: '0xabcd',
    parentRelease: { identityVerified: true },
  }), (error) => (
    error?.code === 'incomplete-published-parent-release'
  ));

  const parent = baseMaker();
  delete parent.manifestHash;
  const exact = addExpansionPackItem(createExpansionPackProject(parent, {
    packId: 'moon-pack',
    namespace: 'moon',
    name: 'Moon Pack',
    walletAddress: '0xABCD',
    parentRelease: {
      identityVerified: true,
      releaseId: '0xmaker-release',
      versionId: 'maker-root-v3',
      versionNumber: '3',
      manifestBlobId: 'walrus-quilt-parent-v3',
      manifestHash: 'ab'.repeat(32),
    },
  }), {
    partId: 'body',
    item: {
      id: 'published-item',
      styles: [{ id: 'default', assetId: 'body-art', layerTrackId: 'body-track' }],
    },
  });
  assert.equal(exact.parentBinding.kind, EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE);
  assert.equal(exact.parentBinding.releaseId, '0xmaker-release');
  assert.equal(exact.parentBinding.versionId, 'maker-root-v3');
  assert.equal(exact.parentBinding.manifestBlobId, 'walrus-quilt-parent-v3');
  assert.equal(exact.parentBinding.manifestHash, 'ab'.repeat(32));
  assert.equal(exact.parentBinding.publishable, true);
  assert.equal(preflightExpansionPackProject(exact).publishable, true);

  const tampered = rehydrateExpansionPackProject(exact);
  tampered.parentBinding.releaseId = '0xother-release';
  assert.equal(preflightExpansionPackProject(tampered).publishable, false);
});

test('rebinds a local Pack non-destructively to one fully compatible exact published parent', () => {
  const local = addExpansionPackItem(createProject(), {
    partId: 'body',
    item: {
      id: 'published-later',
      name: 'Published Later',
      styles: [{ id: 'default', assetId: 'body-art', layerTrackId: 'body-track' }],
    },
  });
  local.publication.localCheckpoint = { state: 'never-submitted' };
  const before = structuredClone(local);
  const overlayContent = (pack) => {
    const copy = structuredClone(pack);
    [
      'baseMakerId',
      'baseVersion',
      'baseVersionId',
      'baseReleaseId',
      'baseManifestBlobId',
      'baseBindingKind',
      'baseManifestHash',
    ].forEach((field) => delete copy[field]);
    return copy;
  };
  const publishedParent = baseMaker();
  delete publishedParent.manifestHash;
  const evidence = {
    identityVerified: true,
    releaseId: '0xmaker-release-v3',
    versionId: 'maker-root-v3',
    versionNumber: '3',
    manifestBlobId: 'walrus-parent-v3',
    manifestHash: 'cd'.repeat(32),
  };

  const rebound = rebindExpansionPackProjectToPublishedRelease(
    local,
    publishedParent,
    evidence,
    { now: 900 },
  );

  assert.deepEqual(local, before);
  assert.notEqual(rebound, local);
  assert.equal(rebound.parentBinding.kind, EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE);
  assert.equal(rebound.parentBinding.releaseId, evidence.releaseId);
  assert.equal(rebound.parentBinding.manifestBlobId, evidence.manifestBlobId);
  assert.equal(rebound.parentBinding.manifestHash, evidence.manifestHash);
  assert.equal(rebound.pack.baseBindingKind, EXPANSION_PACK_PARENT_BINDING_KINDS.PUBLISHED_RELEASE);
  assert.equal(rebound.pack.baseReleaseId, evidence.releaseId);
  assert.equal(rebound.pack.baseManifestBlobId, evidence.manifestBlobId);
  assert.equal(rebound.pack.baseManifestHash, evidence.manifestHash);
  assert.deepEqual(overlayContent(rebound.pack), overlayContent(local.pack));
  assert.notEqual(rebound.pack, local.pack);
  assert.deepEqual(rebound.publication, {
    state: 'draft',
    publishable: true,
    chainState: 'unpublished',
  });
  assert.equal(rebound.updatedAt, 900);
  assert.ok(Object.isFrozen(rebound.parentSnapshot));
  assert.equal(rebound.parentSnapshot.releaseId, evidence.releaseId);
  assert.equal(preflightExpansionPackProject(rebound).publishable, true);
});

test('published-parent rebind fails closed for identity drift, inherited-contract drift and a non-local source', () => {
  const local = addExpansionPackItem(createProject(), {
    partId: 'body',
    item: {
      id: 'moon-item',
      styles: [{ id: 'default', assetId: 'body-art', layerTrackId: 'body-track' }],
    },
  });
  const evidence = {
    identityVerified: true,
    releaseId: '0xmaker-release-v3',
    versionId: 'maker-root-v3',
    versionNumber: '3',
    manifestBlobId: 'walrus-parent-v3',
    manifestHash: 'ef'.repeat(32),
  };
  const matchingParent = baseMaker();
  delete matchingParent.manifestHash;

  const wrongVersion = structuredClone(matchingParent);
  wrongVersion.version.versionId = 'maker-root-v4';
  wrongVersion.version.number = 4;
  assert.throws(() => rebindExpansionPackProjectToPublishedRelease(
    local,
    wrongVersion,
    { ...evidence, versionId: 'maker-root-v4', versionNumber: '4' },
  ), (error) => error?.code === 'parent-release-version-mismatch');

  const changedCanvas = structuredClone(matchingParent);
  changedCanvas.canvas.width = 2048;
  assert.throws(() => rebindExpansionPackProjectToPublishedRelease(
    local,
    changedCanvas,
    evidence,
  ), (error) => (
    error?.code === 'parent-release-inheritance-mismatch'
    && error?.details?.fields?.includes('canvas')
  ));

  const changedRules = structuredClone(matchingParent);
  changedRules.rules.push({ id: 'new-parent-rule', type: 'excludes' });
  assert.throws(() => rebindExpansionPackProjectToPublishedRelease(
    local,
    changedRules,
    evidence,
  ), (error) => (
    error?.code === 'parent-release-inheritance-mismatch'
    && error?.details?.fields?.includes('selectionRules')
  ));

  const published = rebindExpansionPackProjectToPublishedRelease(local, matchingParent, evidence);
  assert.throws(() => rebindExpansionPackProjectToPublishedRelease(
    published,
    matchingParent,
    evidence,
  ), (error) => error?.code === 'pack-parent-rebind-source-not-local');
});

test('migrates a matching embedded overlay into an independent deeply copied project', () => {
  const parent = baseMaker();
  const embedded = structuredClone(createProject(parent).pack);
  embedded.parts.push({
    extendsPartId: 'body',
    items: [{
      id: 'armor',
      name: 'Armor',
      styles: [{ id: 'default', assetId: 'body-art', layerTrackId: 'body-track' }],
    }],
  });

  const project = createExpansionPackProjectFromOverlay(parent, embedded, {
    walletAddress: '0xBEEF',
    projectId: 'migrated-moon-pack',
    now: 777,
  });
  assert.equal(project.projectId, 'migrated-moon-pack');
  assert.equal(project.ownerWalletAddress, '0xbeef');
  assert.equal(project.createdAt, 777);
  assert.equal(project.parentBinding.rootMakerId, 'maker-root');
  assert.equal(project.parentBinding.versionNumber, '3');
  assert.equal(project.parentBinding.manifestHash, 'parent-manifest-hash');
  assert.deepEqual(project.pack, {
    ...embedded,
    wardrobe: {
      schemaVersion: 'animacraft.expansion-pack-wardrobe.v1',
      partModes: {},
    },
    commerce: project.pack.commerce,
  });
  assert.notEqual(project.pack, embedded);
  assert.notEqual(project.pack.parts, embedded.parts);
  assert.ok(Object.isFrozen(project.parentSnapshot));
  assert.ok(Object.isFrozen(project.parentSnapshot.parts[0]));

  embedded.name = 'Mutated embedded draft';
  embedded.parts[0].items[0].name = 'Mutated embedded Item';
  parent.parts[0].name = 'Mutated parent';
  assert.equal(project.pack.name, 'Moon Pack');
  assert.equal(project.pack.parts[0].items[0].name, 'Armor');
  assert.equal(project.parentSnapshot.parts[0].name, 'Body');
});

test('embedded overlay migration strictly rejects parent root, version and manifest drift', () => {
  const parent = baseMaker();
  const overlay = createProject(parent).pack;
  const migrate = (patch) => createExpansionPackProjectFromOverlay(
    parent,
    { ...structuredClone(overlay), ...patch },
    { walletAddress: '0xBEEF' },
  );

  assert.throws(() => migrate({ baseMakerId: 'another-maker' }), (error) => (
    error?.code === 'parent-maker-id-mismatch'
  ));
  assert.throws(() => migrate({ baseVersion: '2' }), (error) => (
    error?.code === 'parent-version-mismatch'
  ));
  assert.throws(() => migrate({ baseManifestHash: 'another-manifest' }), (error) => (
    error?.code === 'parent-manifest-mismatch'
  ));
  assert.throws(() => migrate({ baseManifestHash: undefined }), (error) => (
    error?.code === 'parent-manifest-mismatch'
  ));
});

test('adds Items, Styles and optional Parts without mutating earlier revisions or the parent', () => {
  const parent = baseMaker();
  const parentBefore = structuredClone(parent);
  const created = createProject(parent);

  const withItem = addExpansionPackItem(created, {
    partId: 'body',
    item: {
      id: 'armored',
      name: 'Armored Body',
      defaultStyleId: 'armor',
      styles: [{
        id: 'armor',
        name: 'Armor',
        assetId: 'body-art',
        layerTrackId: 'body-track',
      }],
    },
  }, { now: 200 });

  const withStyle = addExpansionPackStyle(withItem, {
    partId: 'body',
    itemId: 'body-default',
    assets: [{
      id: 'spark-art',
      identifier: 'spark.png',
      contentHash: 'spark-hash',
      mediaType: 'image/png',
    }],
    style: {
      id: 'spark',
      name: 'Spark',
      assetId: 'spark-art',
      layerTrackId: 'body-track',
      blendMode: 'screen',
    },
  }, { now: 300 });

  const completed = addExpansionPackOptionalPart(withStyle, {
    part: {
      id: 'accessory',
      name: 'Accessory',
      required: true,
      allowRemove: false,
      defaultItemId: 'charm',
      items: [{
        id: 'charm',
        name: 'Charm',
        defaultStyleId: 'default',
        styles: [{
          id: 'default',
          name: 'Default',
          assetId: 'spark-art',
          layerTrackId: 'body-track',
        }],
      }],
    },
  }, { now: 400 });

  assert.deepEqual(parent, parentBefore);
  assert.deepEqual(created.pack.parts, []);
  assert.equal(withItem.pack.parts[0].items.length, 1);
  assert.equal(withStyle.pack.parts[0].items.length, 2);
  assert.equal(completed.pack.parts[1].required, false);
  assert.equal(completed.pack.parts[1].allowRemove, true);
  assert.equal(completed.updatedAt, 400);

  const preflight = preflightExpansionPackProject(completed);
  assert.equal(preflight.valid, true, JSON.stringify(preflight.errors));
  const preview = mergeExpansionPackProjectPreview(completed);
  const body = preview.parts.find((part) => part.id === 'body');
  const baseItem = body.items.find((item) => item.id === 'body-default');
  assert.ok(body.items.some((item) => item.id === 'moon__armored'));
  assert.ok(baseItem.styles.some((style) => style.id === 'moon__spark'));
  assert.ok(preview.parts.some((part) => (
    part.id === 'moon__accessory'
    && part.required === false
    && part.allowRemove === true
  )));
});

test('preflight rejects empty Packs and detects a tampered parent binding', () => {
  const empty = createProject();
  const emptyResult = preflightExpansionPackProject(empty);
  assert.equal(emptyResult.valid, false);
  assert.ok(emptyResult.errors.some((issue) => issue.code === 'empty-expansion-pack'));

  const tampered = rehydrateExpansionPackProject(empty);
  tampered.parentBinding.versionNumber = '99';
  tampered.pack.baseVersion = '99';
  const result = preflightExpansionPackProject(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => issue.code === 'parent-version-mismatch'));
  assert.ok(result.errors.some((issue) => issue.code === 'base-version-mismatch'));
});

test('parent inheritance is explicit, complete and cannot be weakened by a Pack', () => {
  const project = addExpansionPackItem(createProject(), {
    partId: 'body',
    item: {
      id: 'armor',
      name: 'Armor',
      defaultStyleId: 'default',
      styles: [{
        id: 'default',
        name: 'Armor',
        assetId: 'armor-art',
        layerTrackId: 'body-track',
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        opacity: 1,
        blendMode: 'normal',
      }],
    },
    assets: [{ id: 'armor-art', identifier: 'armor.png', mediaType: 'image/png' }],
  });
  assert.equal(preflightExpansionPackProject(project).valid, true);
  const merged = mergeExpansionPackProjectPreview(project);
  assert.deepEqual(merged.canvas, project.parentSnapshot.canvas);
  assert.deepEqual(merged.metadata.license, project.parentSnapshot.metadata.license);
  assert.deepEqual(merged.defaultRecipe, project.parentSnapshot.defaultRecipe);
  assert.deepEqual(merged.commerce, project.parentSnapshot.commerce);
  assert.deepEqual(merged.livingContent, project.parentSnapshot.livingContent);
  assert.deepEqual(merged.extensions.composableV6, project.parentSnapshot.extensions.composableV6);
  assert.deepEqual(
    merged.extensions.physicalStyleCatalogV7,
    project.parentSnapshot.extensions.physicalStyleCatalogV7,
  );

  const tampered = rehydrateExpansionPackProject(project);
  tampered.inheritance.layerTracks = 'override';
  const result = preflightExpansionPackProject(tampered);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((issue) => (
    issue.code === 'pack-parent-inheritance-mismatch'
    && issue.field === 'layerTracks'
  )));
});

test('merged preview Recipe selects Pack-owned Items, Styles and optional Parts without changing the parent default', () => {
  const parent = baseMaker();
  const originalDefault = structuredClone(parent.defaultRecipe);
  let project = addExpansionPackItem(createProject(parent), {
    partId: 'body',
    item: {
      id: 'armor',
      name: 'Armor',
      defaultStyleId: 'default',
      styles: [{
        id: 'default',
        name: 'Default Armor',
        assetId: 'armor-art',
        layerTrackId: 'body-track',
      }],
    },
    assets: [{ id: 'armor-art', identifier: 'armor.png', mediaType: 'image/png' }],
  });
  project = addExpansionPackOptionalPart(project, {
    part: {
      id: 'hat',
      name: 'Hat',
      defaultItemId: 'cap',
      items: [{
        id: 'cap',
        name: 'Cap',
        defaultStyleId: 'default',
        styles: [{
          id: 'default',
          name: 'Default Cap',
          assetId: 'armor-art',
          layerTrackId: 'body-track',
        }],
      }],
    },
  });
  const merged = mergeExpansionPackProjectPreview(project);
  const recipe = createExpansionPackProjectPreviewRecipe(project, merged);

  assert.deepEqual(parent.defaultRecipe, originalDefault);
  assert.deepEqual(merged.defaultRecipe, originalDefault);
  assert.deepEqual(
    recipe.selections.find((selection) => selection.partId === 'body'),
    { partId: 'body', itemId: 'moon__armor', styleId: 'moon__default' },
  );
  assert.deepEqual(
    recipe.selections.find((selection) => selection.partId === 'moon__hat'),
    { partId: 'moon__hat', itemId: 'moon__cap', styleId: 'moon__default' },
  );
});

test('updates and removes only Pack-owned content while pruning empty parent extensions', () => {
  const parent = baseMaker();
  const parentBefore = structuredClone(parent);
  const created = createProject(parent);
  const withItem = addExpansionPackItem(created, {
    partId: 'body',
    item: {
      id: 'armor',
      name: 'Armor',
      defaultStyleId: 'default',
      styles: [{
        id: 'default',
        name: 'Default Armor',
        assetId: 'body-art',
        layerTrackId: 'body-track',
      }],
    },
  }, { now: 200 });
  const withStyle = addExpansionPackStyle(withItem, {
    partId: 'body',
    itemId: 'body-default',
    assets: [{
      id: 'spark-art',
      identifier: 'spark.png',
      contentHash: 'spark-hash',
      mediaType: 'image/png',
    }],
    style: {
      id: 'spark',
      name: 'Spark',
      assetId: 'spark-art',
      layerTrackId: 'body-track',
    },
  }, { now: 300 });
  const withPart = addExpansionPackOptionalPart(withStyle, {
    part: {
      id: 'hat',
      name: 'Hat',
      items: [{
        id: 'cap',
        name: 'Cap',
        styles: [{
          id: 'blue',
          name: 'Blue',
          assetId: 'spark-art',
          layerTrackId: 'body-track',
        }],
      }],
    },
  }, { now: 400 });

  const updated = updateExpansionPackStyle(
    withPart,
    'body',
    'armor',
    'default',
    {
      assetId: 'armor-v2-art',
      layerTrackId: 'armor-track',
      transform: { x: -24, y: 18, scale: 0.75, rotation: 12 },
      opacity: 0.6,
      blendMode: 'multiply',
    },
    {
      now: 500,
      assets: [{
        id: 'armor-v2-art',
        identifier: 'armor-v2.png',
        contentHash: 'armor-v2-hash',
        mediaType: 'image/png',
      }],
      layerTracks: [{ id: 'armor-track', name: 'Armor', order: 1 }],
    },
  );

  const armor = updated.pack.parts[0].items.find((item) => item.id === 'armor');
  assert.deepEqual(armor.styles[0].transform, { x: -24, y: 18, scale: 0.75, rotation: 12 });
  assert.equal(armor.styles[0].assetId, 'armor-v2-art');
  assert.equal(armor.styles[0].layerTrackId, 'armor-track');
  assert.equal(armor.styles[0].opacity, 0.6);
  assert.equal(armor.styles[0].blendMode, 'multiply');
  assert.equal(withPart.pack.assets.some((asset) => asset.id === 'armor-v2-art'), false);
  assert.equal(withPart.pack.parts[0].items[0].styles[0].assetId, 'body-art');

  const withoutStyle = removeExpansionPackStyle(
    updated,
    'body',
    'body-default',
    'spark',
    { now: 600 },
  );
  assert.deepEqual(withoutStyle.pack.parts[0].items.map((item) => item.id), ['armor']);

  const withoutItem = removeExpansionPackItem(withoutStyle, 'body', 'armor', { now: 700 });
  assert.equal(withoutItem.pack.parts.some((part) => part.extendsPartId === 'body'), false);

  const withoutPart = removeExpansionPackPart(withoutItem, 'hat', { now: 800 });
  assert.deepEqual(withoutPart.pack.parts, []);
  assert.equal(withoutPart.updatedAt, 800);
  assert.deepEqual(parent, parentBefore);
  assert.equal(withPart.pack.parts.length, 2);
});

test('parent definitions cannot be removed, renamed through update, or edited as Pack Styles', () => {
  const project = createProject();
  const isReadonly = (error) => error?.code === 'parent-definition-readonly';

  assert.throws(() => removeExpansionPackPart(project, 'body'), isReadonly);
  assert.throws(() => removeExpansionPackItem(project, 'body', 'body-default'), isReadonly);
  assert.throws(() => removeExpansionPackStyle(project, 'body', 'body-default', 'default'), isReadonly);
  assert.throws(
    () => updateExpansionPackStyle(project, 'body', 'body-default', 'default', { opacity: 0.5 }),
    isReadonly,
  );
});

test('Style updates reject unsupported fields and invalid render parameters', () => {
  const project = addExpansionPackItem(createProject(), {
    partId: 'body',
    item: {
      id: 'armor',
      styles: [{ id: 'default', assetId: 'body-art', layerTrackId: 'body-track' }],
    },
  });
  const update = (patch) => updateExpansionPackStyle(project, 'body', 'armor', 'default', patch);

  assert.throws(() => update({ name: 'not-an-update-field' }), (error) => (
    error?.code === 'unsupported-pack-style-update'
  ));
  assert.throws(() => update({ transform: { scale: 0 } }), (error) => (
    error?.code === 'invalid-pack-style-scale'
  ));
  assert.throws(() => update({ transform: { anchor: 3 } }), (error) => (
    error?.code === 'unsupported-pack-style-transform'
  ));
  assert.throws(() => update({ opacity: 1.1 }), (error) => (
    error?.code === 'invalid-pack-style-opacity'
  ));
  assert.throws(() => update({ blendMode: 'unknown-mode' }), (error) => (
    error?.code === 'invalid-pack-style-blend-mode'
  ));
});

test('Pack commerce is independently configurable as Free or one-time permanent USDC access', () => {
  const source = createProject();
  assert.deepEqual(
    {
      accessMode: source.pack.commerce.accessMode,
      price: source.pack.commerce.purchasePriceAtomic,
      currency: source.pack.commerce.currency,
      fee: source.pack.commerce.protocolFeeBps,
    },
    { accessMode: EXPANSION_PACK_ACCESS_MODES.FREE, price: '0', currency: 'USDC', fee: 1000 },
  );

  const paid = updateExpansionPackCommerce(source, {
    accessMode: EXPANSION_PACK_ACCESS_MODES.PAID_ONCE,
    priceDecimal: '6.25',
  }, { now: 900 });
  assert.equal(paid.pack.commerce.purchasePriceAtomic, '6250000');
  assert.equal(paid.pack.commerce.priceDecimal, '6.25');
  assert.equal(paid.pack.commerce.entitlement, 'PERMANENT_WALLET_BOUND_PASS');
  assert.equal(paid.pack.commerce.completeMode, 'INHERIT_BASE_AND_UNLIMITED_AFTER_ACCESS');
  assert.equal(source.pack.commerce.accessMode, EXPANSION_PACK_ACCESS_MODES.FREE);

  const freeAgain = updateExpansionPackCommerce(paid, {
    accessMode: EXPANSION_PACK_ACCESS_MODES.FREE,
  });
  assert.equal(freeAgain.pack.commerce.purchasePriceAtomic, '0');
  assert.equal(freeAgain.pack.commerce.priceDecimal, '0');
  assert.throws(
    () => updateExpansionPackCommerce(source, {
      accessMode: EXPANSION_PACK_ACCESS_MODES.PAID_ONCE,
      priceDecimal: '1.0000001',
    }),
    { code: 'invalid-pack-purchase-price' },
  );
});

function moonSwatch(id, color) {
  return {
    id,
    name: id,
    hintColor: color,
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 1, color },
    ],
  };
}

test('Pack-owned Layer Tracks support immutable CRUD, suffix ordering and lock safety', () => {
  const parent = baseMaker();
  const parentJson = JSON.stringify(parent);
  const source = createProject(parent);
  const one = addExpansionPackLayerTrack(source, {
    id: 'behind',
    name: 'Behind',
    locked: false,
  }, { now: 200 });
  const two = addExpansionPackLayerTrack(one, {
    id: 'front',
    name: 'Front',
    locked: false,
  }, { now: 300 });
  const reordered = moveExpansionPackLayerTrack(two, 'front', 0, { now: 400 });
  const renamed = renameExpansionPackLayerTrack(reordered, 'front', 'Moon Front', { now: 500 });
  const locked = setExpansionPackLayerTrackLocked(renamed, 'front', true, { now: 600 });

  assert.deepEqual(source.pack.layerTracks, []);
  assert.deepEqual(two.pack.layerTracks.map((track) => track.id), ['behind', 'front']);
  assert.deepEqual(reordered.pack.layerTracks.map((track) => [track.id, track.order]), [
    ['front', 0],
    ['behind', 1],
  ]);
  assert.equal(renamed.pack.layerTracks[0].name, 'Moon Front');
  assert.equal(locked.pack.layerTracks[0].locked, true);
  assert.equal(locked.updatedAt, 600);
  assert.throws(() => removeExpansionPackLayerTrack(locked, 'front'), { code: 'pack-layer-track-locked' });
  assert.throws(() => moveExpansionPackLayerTrack(locked, 'behind', 0), { code: 'pack-layer-track-locked' });
  assert.throws(() => renameExpansionPackLayerTrack(source, 'body-track', 'Nope'), { code: 'parent-definition-readonly' });
  assert.throws(() => setExpansionPackLayerTrackLocked(source, 'body-track', true), { code: 'parent-definition-readonly' });

  const unlocked = setExpansionPackLayerTrackLocked(locked, 'front', false);
  const removed = removeExpansionPackLayerTrack(unlocked, 'front', { now: 700 });
  assert.deepEqual(removed.pack.layerTracks.map((track) => [track.id, track.order]), [['behind', 0]]);
  const merged = mergeExpansionPackProjectPreview(removed);
  assert.deepEqual(merged.layerTracks.map((track) => track.id), ['body-track', 'moon__behind']);
  assert.deepEqual(merged.layerTracks.map((track) => track.order), [0, 1]);
  assert.equal(JSON.stringify(parent), parentJson);
  assert.equal(JSON.stringify(source.parentSnapshot), parentJson);
});

test('Smart Color CRUD, Style linkage and preview colors remain Pack-owned and fail closed', () => {
  const parent = baseMaker();
  const parentJson = JSON.stringify(parent);
  let project = addExpansionPackColorChannel(createProject(parent), {
    id: 'moon-tone',
    name: 'Moon Tone',
    mode: 'gradient-map',
    defaultSwatchId: 'silver',
    swatches: [moonSwatch('silver', '#c0c0c0')],
  }, { now: 200 });
  project = addExpansionPackColorSwatch(project, 'moon-tone', moonSwatch('gold', '#ffd700'), { now: 300 });
  project = updateExpansionPackColorSwatch(project, 'moon-tone', 'gold', {
    name: 'Solar Gold',
    hintColor: '#ffcc00',
    stops: [{ offset: 0, color: '#000000' }, { offset: 1, color: '#ffcc00' }],
  }, { now: 400 });
  project = updateExpansionPackColorChannel(project, 'moon-tone', {
    name: 'Celestial Tone',
    defaultSwatchId: 'gold',
  }, { now: 500 });
  project = addExpansionPackItem(project, {
    partId: 'body',
    item: {
      id: 'lunar-body',
      styles: [{ id: 'default', assetId: 'body-art', layerTrackId: 'body-track' }],
    },
  });
  project = updateExpansionPackStyle(project, 'body', 'lunar-body', 'default', {
    colorChannelId: 'moon-tone',
  }, { now: 600 });

  assert.equal(project.pack.colorChannels[0].name, 'Celestial Tone');
  assert.equal(project.pack.colorChannels[0].swatches[1].name, 'Solar Gold');
  assert.equal(project.pack.parts[0].items[0].styles[0].colorChannelId, 'moon-tone');
  assert.throws(() => removeExpansionPackColorChannel(project, 'moon-tone'), { code: 'pack-color-channel-in-use' });
  const merged = mergeExpansionPackProjectPreview(project);
  const style = merged.parts[0].items.find((item) => item.id === 'moon__lunar-body').styles[0];
  assert.equal(style.colorChannelId, 'moon__moon-tone');
  assert.equal(merged.colorChannels.at(-1).id, 'moon__moon-tone');
  assert.deepEqual(createExpansionPackProjectPreviewRecipe(project, merged).colors.at(-1), {
    channelId: 'moon__moon-tone',
    swatchId: 'gold',
  });

  const detached = updateExpansionPackStyle(project, 'body', 'lunar-body', 'default', { colorChannelId: null });
  const oneSwatch = removeExpansionPackColorSwatch(detached, 'moon-tone', 'silver');
  assert.throws(() => removeExpansionPackColorSwatch(oneSwatch, 'moon-tone', 'gold'), { code: 'last-pack-color-swatch' });
  const removed = removeExpansionPackColorChannel(oneSwatch, 'moon-tone');
  assert.deepEqual(removed.pack.colorChannels, []);
  assert.throws(() => updateExpansionPackColorChannel(createProject(parent), 'parent-tone', { name: 'Nope' }), {
    code: 'parent-definition-readonly',
  });

  const invalidRef = updateExpansionPackStyle(detached, 'body', 'lunar-body', 'default', { colorChannelId: 'missing' });
  const invalidResult = preflightExpansionPackProject(invalidRef);
  assert.equal(invalidResult.valid, false);
  assert.ok(invalidResult.errors.some((issue) => issue.code === 'missing-pack-style-color-channel'));
  assert.equal(JSON.stringify(parent), parentJson);
});

test('Pack rules and embedded requires/excludes/visibleWhen preserve base/local scope restrictions', () => {
  let project = addExpansionPackOptionalPart(createProject(), {
    part: {
      id: 'hat',
      name: 'Hat',
      items: [{
        id: 'halo',
        name: 'Halo',
        styles: [{ id: 'default', assetId: 'body-art', layerTrackId: 'body-track' }],
      }],
    },
  });
  project = addExpansionPackRule(project, {
    id: 'hat-needs-body',
    type: 'requires',
    trigger: { scope: 'pack', partId: 'hat', itemId: 'halo' },
    targets: [{ scope: 'base', partId: 'body', itemId: 'body-default' }],
  }, { now: 200 });
  project = updateExpansionPackRule(project, 'hat-needs-body', {
    type: 'excludes',
    targets: [{ scope: 'base', partId: 'body', itemId: 'body-default', styleId: 'default' }],
  }, { now: 300 });
  project = updateExpansionPackPartRules(project, 'hat', {
    requires: [{ scope: 'base', partId: 'body' }],
    visibleWhen: { op: 'selected', scope: 'base', partId: 'body' },
  });
  project = updateExpansionPackItemRules(project, 'hat', 'halo', {
    excludes: [{ scope: 'base', partId: 'body', itemId: 'body-default' }],
  });
  project = updateExpansionPackStyleRules(project, 'hat', 'halo', 'default', {
    visibleWhen: { op: 'selected', scope: 'base', partId: 'body', itemId: 'body-default' },
  }, { now: 400 });

  assert.equal(project.updatedAt, 400);
  const merged = mergeExpansionPackProjectPreview(project);
  const hat = merged.parts.find((part) => part.id === 'moon__hat');
  assert.deepEqual(hat.requires, [{ scope: 'base', partId: 'body' }]);
  assert.equal(hat.items[0].styles[0].visibleWhen.partId, 'body');
  assert.equal(merged.rules[0].id, 'moon__hat-needs-body');

  assert.throws(() => addExpansionPackRule(project, {
    id: 'base-needs-hat',
    type: 'requires',
    trigger: { scope: 'base', partId: 'body' },
    targets: [{ scope: 'pack', partId: 'hat' }],
  }), (error) => (
    error?.code === 'invalid-pack-rule-model'
    && error.details.errors.some((issue) => issue.code === 'pack-rule-breaks-base-recipe')
  ));
  assert.throws(() => addExpansionPackRule(project, {
    id: 'base-excludes-base',
    type: 'excludes',
    trigger: { scope: 'base', partId: 'body' },
    targets: [{ scope: 'base', partId: 'body', itemId: 'body-default' }],
  }), { code: 'invalid-pack-rule-model' });
  assert.throws(() => updateExpansionPackPartRules(project, 'body', { requires: [] }), {
    code: 'parent-definition-readonly',
  });
  const removed = removeExpansionPackRule(project, 'hat-needs-body', { now: 500 });
  assert.deepEqual(removed.pack.rules, []);
});

test('Pack wardrobe modes namespace only optional Pack Parts and append compatible extension deltas', () => {
  const parent = baseMaker();
  parent.extensions.wardrobeV7 = {
    schemaVersion: 'animacraft.maker-wardrobe.v7',
    marker: 'keep-parent-wardrobe',
    partModes: { body: 'FIXED' },
  };
  parent.extensions.composableV6 = {
    schemaVersion: 'animacraft.maker-composable-draft.v6',
    marker: 'keep-parent-composable',
    profile: { mode: 'COMPOSABLE' },
    compatibility: {
      makerRootId: 'maker-root',
      marker: 'keep-compatibility',
      layerTrackIds: ['body-track'],
      slots: [{ id: 'body', capacity: 1, required: true, layerTrackIds: ['body-track'] }],
    },
  };
  const parentJson = JSON.stringify(parent);
  let project = addExpansionPackLayerTrack(createProject(parent), { id: 'hat-track', name: 'Hat' });
  project = addExpansionPackOptionalPart(project, {
    part: {
      id: 'hat',
      name: 'Hat',
      items: [{
        id: 'halo',
        styles: [{ id: 'default', assetId: 'body-art', layerTrackId: 'hat-track' }],
      }],
    },
  });
  project = setExpansionPackPartMode(project, 'hat', EXPANSION_PACK_PART_MODES.SLOT, { now: 300 });
  const merged = mergeExpansionPackProjectPreview(project);

  assert.equal(project.pack.wardrobe.partModes.hat, 'SLOT');
  assert.deepEqual(merged.extensions.wardrobeV7, {
    schemaVersion: 'animacraft.maker-wardrobe.v7',
    marker: 'keep-parent-wardrobe',
    partModes: { body: 'FIXED', moon__hat: 'SLOT' },
  });
  assert.equal(merged.extensions.composableV6.marker, 'keep-parent-composable');
  assert.equal(merged.extensions.composableV6.compatibility.marker, 'keep-compatibility');
  assert.deepEqual(merged.extensions.composableV6.compatibility.layerTrackIds, ['body-track', 'moon__hat-track']);
  assert.deepEqual(merged.extensions.composableV6.compatibility.slots.at(-1), {
    id: 'moon__hat',
    capacity: 1,
    required: false,
    layerTrackIds: ['moon__hat-track'],
  });
  assert.equal(JSON.stringify(parent), parentJson);
  assert.equal(JSON.stringify(project.parentSnapshot), parentJson);
  assert.throws(() => setExpansionPackPartMode(project, 'body', 'SLOT'), { code: 'parent-definition-readonly' });
  const withoutPart = removeExpansionPackPart(project, 'hat');
  assert.deepEqual(withoutPart.pack.wardrobe.partModes, {});

  const noComposableParent = baseMaker();
  delete noComposableParent.extensions.composableV6;
  let noComposable = addExpansionPackOptionalPart(createProject(noComposableParent), {
    part: { id: 'cape', name: 'Cape', items: [] },
  });
  noComposable = setExpansionPackPartMode(noComposable, 'cape', 'SLOT');
  const noComposableMerged = mergeExpansionPackProjectPreview(noComposable);
  assert.equal(Object.hasOwn(noComposableMerged.extensions, 'composableV6'), false);
  assert.equal(noComposableMerged.extensions.wardrobeV7.partModes.moon__cape, 'SLOT');
});

test('legacy project rehydration backfills additive arrays and wardrobe without mutating input', () => {
  const legacy = structuredClone(createProject());
  delete legacy.pack.layerTracks;
  delete legacy.pack.colorChannels;
  delete legacy.pack.rules;
  delete legacy.pack.wardrobe;
  const before = structuredClone(legacy);
  const rehydrated = rehydrateExpansionPackProject(legacy);

  assert.deepEqual(legacy, before);
  assert.deepEqual(rehydrated.pack.layerTracks, []);
  assert.deepEqual(rehydrated.pack.colorChannels, []);
  assert.deepEqual(rehydrated.pack.rules, []);
  assert.deepEqual(rehydrated.pack.wardrobe, {
    schemaVersion: 'animacraft.expansion-pack-wardrobe.v1',
    partModes: {},
  });
  assert.ok(Object.isFrozen(rehydrated.parentSnapshot));
  assert.throws(() => { rehydrated.parentSnapshot.parts[0].name = 'mutated'; }, TypeError);
});
