import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPOSABLE_PROFILE_MODES,
  ITEM_ACCESS_MODES,
  ITEM_BINDING_MODES,
  ITEM_ORIGIN_CLASSES,
  ITEM_RIGHTS_ORIGINS,
  THIRD_PARTY_ADMISSION_MODES,
  createCompatibilityProfileV6,
  createComposableProfileV6,
  createItemProductV6,
} from '../maker-composable-v6.js';
import {
  MAKER_COMPOSABLE_V6_DRAFT_SCHEMA,
  MakerComposableV6BridgeError,
  attachMakerComposableV6Draft,
  buildMakerComposableV6Manifest,
  collectMakerComposableV6PreflightIssues,
  createCompatibilityDefinitionV6,
  createItemProductDefinitionV6,
  getMakerComposableV6Draft,
  hashCompatibilityDefinitionV6,
  hashItemProductDefinitionV6,
  hashMakerComposableV6BaseManifest,
  normalizeMakerComposableV6Draft,
} from '../maker-composable-v6-bridge.js';
import { createMakerV5Document } from '../maker-v4.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const HASH_E = 'e'.repeat(64);
const ROOT_OBJECT_ID = '0xmaker-root-v5';
const MAKER_OWNER = '0xmaker-owner';

function baseDocument() {
  return createMakerV5Document({
    makerId: 'wardrobe-maker',
    creator: MAKER_OWNER,
    version: {
      versionId: 'wardrobe-maker-v3',
      versionNumber: 3,
      parentVersionId: 'wardrobe-maker-v2',
      compatibility: 'compatible',
    },
  });
}

function baseManifestFor(document) {
  return {
    schemaVersion: 'animacraft.maker.v5',
    version: structuredClone(document.version),
    metadata: {
      id: document.metadata.id,
      name: document.metadata.name,
    },
  };
}

function validDraft(overrides = {}) {
  const compatibility = createCompatibilityProfileV6({
    makerRootId: ROOT_OBJECT_ID,
    canvas: { width: 1024, height: 1024 },
    coordinate: { origin: 'TOP_LEFT', unit: 'PIXEL', pixelMode: false },
    renderer: { version: 'renderer-v6.1', commitment: HASH_A },
    layerTrackIds: ['body-track', 'wardrobe-track'],
    slots: [
      { id: 'body', capacity: 1, required: true, layerTrackIds: ['body-track'] },
      { id: 'wardrobe', capacity: 1, required: false, layerTrackIds: ['wardrobe-track'] },
    ],
    maskPolicyHash: HASH_B,
    rulesHash: HASH_C,
    fallbackProductIds: ['base-body'],
    fallbackLoadoutHash: HASH_D,
    manifestBlobId: 'walrus-compatibility-v6',
    manifestHash: HASH_E,
  });
  const baseBody = createItemProductV6({
    id: 'base-body',
    version: 1,
    makerRootId: ROOT_OBJECT_ID,
    compatibilityHash: HASH_E,
    creator: MAKER_OWNER,
    publisher: MAKER_OWNER,
    originClass: ITEM_ORIGIN_CLASSES.OFFICIAL,
    display: {
      name: 'Base Body',
      description: 'Free embedded fallback body.',
      thumbnailBlobId: 'walrus-thumb-base-body',
      thumbnailHash: HASH_D,
    },
    components: [{
      id: 'base-body-component',
      layerTrackId: 'body-track',
      assetBlobId: 'walrus-asset-base-body',
      assetHash: HASH_E,
      assetWidth: 1024,
      assetHeight: 1024,
      transform: {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
      },
      baseSource: null,
    }],
    validation: {
      passed: true,
      attestationId: 'validation-base-body',
      epoch: 2,
    },
    certification: {
      certifier: MAKER_OWNER,
      ownershipEpoch: 9,
    },
    manifestBlobId: 'walrus-base-body',
    manifestHash: HASH_A,
    contentHash: HASH_B,
    slotClaims: [{ slotId: 'body', units: 1 }],
    rightsOrigin: ITEM_RIGHTS_ORIGINS.ONCHAIN_NATIVE,
    rightsManifestHash: HASH_C,
    access: {
      mode: ITEM_ACCESS_MODES.EMBEDDED,
      binding: ITEM_BINDING_MODES.EMBEDDED,
    },
  });
  return {
    schemaVersion: MAKER_COMPOSABLE_V6_DRAFT_SCHEMA,
    profile: createComposableProfileV6({
      mode: COMPOSABLE_PROFILE_MODES.COMPOSABLE,
      thirdPartyAdmission: THIRD_PARTY_ADMISSION_MODES.OPEN,
      itemAssetization: true,
    }),
    compatibility,
    compatibilitySealed: true,
    items: [baseBody],
    extensionsHash: '',
    ...overrides,
  };
}

async function releaseContext(document) {
  const baseManifest = baseManifestFor(document);
  const baseManifestJson = JSON.stringify(baseManifest);
  return {
    baseManifest,
    baseManifestJson,
    baseManifestHash: await hashMakerComposableV6BaseManifest(baseManifestJson),
    baseMakerRootId: ROOT_OBJECT_ID,
    makerOwner: MAKER_OWNER,
    currentOwnershipEpoch: 9,
  };
}

async function creatorStyleRelease() {
  const document = baseDocument();
  const compatibility = createCompatibilityProfileV6({
    makerRootId: ROOT_OBJECT_ID,
    canvas: { width: 1024, height: 1024 },
    coordinate: { origin: 'TOP_LEFT', unit: 'PIXEL', pixelMode: false },
    renderer: { version: 'animacraft.shared-renderer.v5', commitment: '' },
    layerTrackIds: ['body-track'],
    slots: [{ id: 'body', capacity: 1, required: true, layerTrackIds: ['body-track'] }],
    fallbackProductIds: ['official:body:base:default:v1'],
  });
  const official = createItemProductV6({
    id: 'official:body:base:default:v1',
    version: 1,
    makerRootId: ROOT_OBJECT_ID,
    compatibilityHash: '',
    creator: MAKER_OWNER,
    publisher: MAKER_OWNER,
    originClass: ITEM_ORIGIN_CLASSES.OFFICIAL,
    display: {
      name: 'Base Body',
      description: 'Creator Studio embedded base Style.',
    },
    components: [{
      id: 'official:body:base:default:v1:component',
      layerTrackId: 'body-track',
      assetWidth: 1024,
      assetHeight: 1024,
      transform: {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
      },
      baseSource: { partId: 'body', itemId: 'base', styleId: 'default' },
    }],
    validation: { passed: false, attestationId: '', epoch: 0 },
    certification: null,
    slotClaims: [{ slotId: 'body', units: 1 }],
    rightsOrigin: ITEM_RIGHTS_ORIGINS.LICENSE_WRAPPED,
    access: {
      mode: ITEM_ACCESS_MODES.EMBEDDED,
      binding: ITEM_BINDING_MODES.EMBEDDED,
    },
  });
  const attached = attachMakerComposableV6Draft(document, {
    schemaVersion: MAKER_COMPOSABLE_V6_DRAFT_SCHEMA,
    profile: createComposableProfileV6({
      mode: COMPOSABLE_PROFILE_MODES.COMPOSABLE,
      thirdPartyAdmission: THIRD_PARTY_ADMISSION_MODES.OPEN,
      itemAssetization: true,
    }),
    compatibility,
    compatibilitySealed: true,
    items: [official],
  });
  const baseManifest = {
    ...baseManifestFor(document),
    metadata: {
      ...baseManifestFor(document).metadata,
      license: { kind: 'personal', note: 'Creator-owned source art.' },
    },
    parts: [{
      id: 'body',
      items: [{
        id: 'base',
        styles: [{ id: 'default', layerTrackId: 'body-track', assetId: 'body-png' }],
      }],
    }],
    assets: [{
      id: 'body-png',
      identifier: 'body.png',
      sha256: HASH_E,
      width: 1024,
      height: 1024,
    }],
  };
  const baseManifestJson = JSON.stringify(baseManifest);
  return {
    document: attached,
    context: {
      baseManifest,
      baseManifestJson,
      baseManifestHash: await hashMakerComposableV6BaseManifest(baseManifestJson),
      baseMakerRootId: ROOT_OBJECT_ID,
      makerOwner: MAKER_OWNER,
      currentOwnershipEpoch: 9,
    },
  };
}

test('Maker without the extension remains Fixed/default and needs no companion', async () => {
  const document = baseDocument();
  assert.equal(getMakerComposableV6Draft(document), null);
  assert.deepEqual(collectMakerComposableV6PreflightIssues(document), []);
  assert.equal(await buildMakerComposableV6Manifest(document), null);
});

test('attach/get/normalize use only extensions.composableV6 and never mutate the base document', () => {
  const document = baseDocument();
  document.extensions.keepMe = { value: 1 };
  const next = attachMakerComposableV6Draft(document, validDraft());

  assert.equal(document.extensions.composableV6, undefined);
  assert.deepEqual(next.extensions.keepMe, { value: 1 });
  assert.equal(next.extensions.composableV6.schemaVersion, MAKER_COMPOSABLE_V6_DRAFT_SCHEMA);
  assert.equal(next.extensions.composableV6.profile.mode, COMPOSABLE_PROFILE_MODES.COMPOSABLE);

  const detached = getMakerComposableV6Draft(next);
  detached.items[0].id = 'changed-locally';
  assert.equal(next.extensions.composableV6.items[0].id, 'base-body');

  const normalized = normalizeMakerComposableV6Draft({
    profile: { mode: COMPOSABLE_PROFILE_MODES.FIXED, loadoutMutable: true },
    hiddenRuntimeInstruction: { execute: true },
  });
  assert.equal(normalized.profile.loadoutMutable, false);
  assert.equal(Object.hasOwn(normalized, 'hiddenRuntimeInstruction'), false);
});

test('Composable preflight blocks unsealed compatibility, incomplete fallback and invalid Items', async () => {
  const document = baseDocument();
  const draft = validDraft({ compatibilitySealed: false });
  draft.compatibility.fallbackProductIds = ['missing-product'];
  draft.items[0].validation.passed = false;
  const attached = attachMakerComposableV6Draft(document, draft);
  const context = await releaseContext(document);
  const issues = collectMakerComposableV6PreflightIssues(attached, context);
  const codes = new Set(issues.map((entry) => entry.code));

  assert.ok(codes.has('compatibility_not_sealed'));
  assert.ok(codes.has('validation_required'));
  assert.ok(codes.has('missing_fallback_product'));
  assert.deepEqual(
    issues.find((entry) => entry.code === 'missing_fallback_product'),
    {
      path: 'extensions.composableV6.compatibility.fallbackProductIds[0]',
      code: 'missing_fallback_product',
      message: 'Every fallback reference must resolve to a published Item Product.',
    },
  );
  assert.ok(codes.has('item_not_in_inventory'));
  assert.ok(codes.has('required_slot_empty'));
});

test('every Official, Certified and Open Item requires technical validation', async () => {
  const document = baseDocument();
  const draft = validDraft();
  const openItem = createItemProductV6({
    ...draft.items[0],
    id: 'open-hat',
    creator: '0xthird-party',
    publisher: '0xthird-party',
    originClass: ITEM_ORIGIN_CLASSES.OPEN,
    validation: { passed: false, attestationId: '', epoch: 2 },
    certification: null,
    slotClaims: [{ slotId: 'wardrobe', units: 1 }],
    display: {
      name: 'Open Hat',
      description: 'Validated Open wardrobe component.',
      thumbnailBlobId: 'walrus-thumb-open-hat',
      thumbnailHash: HASH_D,
    },
    components: [{
      id: 'open-hat-component',
      layerTrackId: 'wardrobe-track',
      assetBlobId: 'walrus-asset-open-hat',
      assetHash: HASH_E,
      assetWidth: 1024,
      assetHeight: 1024,
      transform: {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
      },
      baseSource: null,
    }],
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.ACCOUNT,
    },
  });
  draft.items.push(openItem);
  const context = await releaseContext(document);
  const issues = collectMakerComposableV6PreflightIssues(
    attachMakerComposableV6Draft(document, draft),
    context,
  );
  assert.ok(issues.some((entry) => (
    entry.code === 'validation_required'
    && entry.path.includes('items[1]')
  )));
  assert.ok(issues.some((entry) => entry.code === 'validation_attestation_required'));
});

test('build emits an independent manifest with exact base root, version and JSON hash', async () => {
  const document = baseDocument();
  const attached = attachMakerComposableV6Draft(document, validDraft());
  const context = await releaseContext(document);
  const manifest = await buildMakerComposableV6Manifest(attached, context);

  assert.equal(manifest.schemaVersion, 'animacraft.maker-composable.v6');
  assert.deepEqual(manifest.baseMaker, {
    manifestSchemaVersion: 'animacraft.maker.v5',
    makerRootId: ROOT_OBJECT_ID,
    rootMakerId: document.version.rootMakerId,
    versionId: document.version.versionId,
    versionNumber: document.version.number,
    manifestHash: context.baseManifestHash,
  });
  assert.equal(manifest.compatibilitySealed, true);
  assert.equal(manifest.items[0].display.name, 'Base Body');
  assert.deepEqual(manifest.items[0].components[0], {
    id: 'base-body-component',
    layerTrackId: 'body-track',
    assetBlobId: 'walrus-asset-base-body',
    assetHash: HASH_E,
    assetWidth: 1024,
    assetHeight: 1024,
    transform: {
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
      opacity: 1,
      blendMode: 'normal',
    },
    baseSource: null,
  });
  assert.deepEqual(manifest.fallbackLoadout, {
    productIds: ['base-body'],
    commitment: manifest.compatibility.fallbackLoadoutHash,
  });
  assert.notEqual(manifest.compatibility.manifestHash, HASH_E);
  assert.notEqual(manifest.items[0].manifestHash, HASH_A);
  assert.deepEqual(manifest.items[0].validation, {
    passed: false,
    attestationId: '',
    epoch: 0,
  });
  assert.equal(Object.hasOwn(manifest, 'runtime'), false);
  assert.equal(Object.hasOwn(manifest, 'extensions'), false);
  assert.equal(Object.hasOwn(context.baseManifest, 'composableV6'), false);
});

test('Creator-style empty commitments build canonical definitions without pre-attestation', async () => {
  const { document, context } = await creatorStyleRelease();
  const manifest = await buildMakerComposableV6Manifest(document, context);

  assert.match(manifest.compatibility.manifestHash, /^[0-9a-f]{64}$/);
  assert.equal(manifest.compatibility.manifestBlobId, '');
  assert.equal(
    manifest.compatibility.manifestHash,
    await hashCompatibilityDefinitionV6(manifest.compatibility),
  );
  assert.deepEqual(
    createCompatibilityDefinitionV6(manifest.compatibility),
    createCompatibilityDefinitionV6({
      ...manifest.compatibility,
      manifestBlobId: 'ignored-locator',
      manifestHash: HASH_A,
    }),
  );

  const product = manifest.items[0];
  assert.equal(product.manifestBlobId, '');
  assert.equal(product.display.thumbnailBlobId, '');
  assert.equal(product.components[0].assetBlobId, '');
  assert.equal(product.components[0].assetHash, HASH_E);
  assert.equal(product.rightsManifestHash.length, 64);
  assert.equal(product.contentHash.length, 64);
  assert.equal(product.manifestHash, await hashItemProductDefinitionV6(product));
  assert.deepEqual(product.validation, { passed: false, attestationId: '', epoch: 0 });
});

test('Official embedded baseSource can rely on the exact base manifest without a second asset hash', async () => {
  const { document, context } = await creatorStyleRelease();
  const baseManifest = structuredClone(context.baseManifest);
  delete baseManifest.assets[0].sha256;
  const baseManifestJson = JSON.stringify(baseManifest);
  const manifest = await buildMakerComposableV6Manifest(document, {
    ...context,
    baseManifest,
    baseManifestJson,
    baseManifestHash: await hashMakerComposableV6BaseManifest(baseManifestJson),
  });

  const product = manifest.items[0];
  assert.equal(product.manifestBlobId, '');
  assert.equal(product.display.thumbnailBlobId, '');
  assert.equal(product.components[0].assetBlobId, '');
  assert.match(product.components[0].assetHash, /^[0-9a-f]{64}$/);
  assert.equal(product.manifestHash, await hashItemProductDefinitionV6(product));
});

test('canonical commitments are deterministic and ignore locator, self-hash and trust readback', async () => {
  const { document, context } = await creatorStyleRelease();
  const first = await buildMakerComposableV6Manifest(document, context);
  const changed = structuredClone(document);
  const draft = changed.extensions.composableV6;
  draft.compatibility.manifestBlobId = 'caller-compatibility-locator';
  draft.compatibility.manifestHash = HASH_A;
  draft.items[0].manifestBlobId = 'caller-product-locator';
  draft.items[0].manifestHash = HASH_B;
  draft.items[0].validation = { passed: true, attestationId: 'self-report', epoch: 999 };
  draft.items[0].certification = { certifier: 'self-report', ownershipEpoch: 999 };
  const second = await buildMakerComposableV6Manifest(changed, context);

  assert.equal(second.compatibility.manifestHash, first.compatibility.manifestHash);
  assert.equal(second.items[0].manifestHash, first.items[0].manifestHash);
  assert.deepEqual(second.items[0].validation, {
    passed: false,
    attestationId: '',
    epoch: 0,
  });
});

test('exact base bytes and source asset bytes are locked into the resulting release', async () => {
  const { document, context } = await creatorStyleRelease();
  const first = await buildMakerComposableV6Manifest(document, context);

  const whitespaceJson = `${context.baseManifestJson}\n`;
  const whitespace = await buildMakerComposableV6Manifest(document, {
    ...context,
    baseManifestJson: whitespaceJson,
    baseManifestHash: await hashMakerComposableV6BaseManifest(whitespaceJson),
  });
  assert.notEqual(whitespace.baseMaker.manifestHash, first.baseMaker.manifestHash);
  assert.notEqual(whitespace.items[0].manifestHash, first.items[0].manifestHash);

  const changedManifest = structuredClone(context.baseManifest);
  changedManifest.assets[0].sha256 = HASH_D;
  const changedJson = JSON.stringify(changedManifest);
  const changed = await buildMakerComposableV6Manifest(document, {
    ...context,
    baseManifest: changedManifest,
    baseManifestJson: changedJson,
    baseManifestHash: await hashMakerComposableV6BaseManifest(changedJson),
  });
  assert.equal(changed.items[0].components[0].assetHash, HASH_D);
  assert.notEqual(changed.items[0].contentHash, first.items[0].contentHash);
  assert.notEqual(changed.items[0].manifestHash, first.items[0].manifestHash);
});

test('external Items still require independent thumbnail, asset and Item locators', async () => {
  const { document, context } = await creatorStyleRelease();
  const external = createItemProductV6({
    ...document.extensions.composableV6.items[0],
    id: 'open:body:v1',
    creator: '0xexternal',
    publisher: '0xexternal',
    originClass: ITEM_ORIGIN_CLASSES.OPEN,
    display: {
      name: 'External Body',
      description: 'Independent external Item.',
      thumbnailHash: HASH_A,
    },
    components: [{
      ...document.extensions.composableV6.items[0].components[0],
      id: 'open:body:v1:component',
      assetHash: HASH_B,
      baseSource: null,
    }],
    certification: null,
    contentHash: HASH_C,
    rightsManifestHash: HASH_D,
    access: { mode: ITEM_ACCESS_MODES.FREE_CLAIM, binding: ITEM_BINDING_MODES.ACCOUNT },
  });
  document.extensions.composableV6.items.push(external);

  await assert.rejects(
    buildMakerComposableV6Manifest(document, context),
    (error) => error.code === 'companion-preflight-failed'
      && error.details.issues.some((entry) => entry.code === 'invalid_item_thumbnail_blob')
      && error.details.issues.some((entry) => entry.code === 'invalid_component_asset_blob')
      && error.details.issues.some((entry) => entry.code === 'missing_item_manifest'),
  );
});

test('Official component baseSource resolves one exact base Style and Layer Track', async () => {
  const document = baseDocument();
  const draft = validDraft();
  draft.items[0].components[0].baseSource = {
    partId: 'skin-base',
    itemId: 'skin-default',
    styleId: 'skin-style',
  };
  const attached = attachMakerComposableV6Draft(document, draft);
  const context = await releaseContext(document);
  context.baseManifest.parts = [{
    id: 'skin-base',
    items: [{
      id: 'skin-default',
      styles: [{ id: 'skin-style', layerTrackId: 'body-track', assetId: 'base-body-png' }],
    }],
  }];
  context.baseManifest.assets = [{
    id: 'base-body-png',
    sha256: HASH_E,
    width: 1024,
    height: 1024,
  }];
  context.baseManifestJson = JSON.stringify(context.baseManifest);
  context.baseManifestHash = await hashMakerComposableV6BaseManifest(
    context.baseManifestJson,
  );
  assert.deepEqual(
    collectMakerComposableV6PreflightIssues(attached, context),
    [],
  );

  context.baseManifest.parts[0].items[0].styles[0].layerTrackId = 'other-track';
  context.baseManifestJson = JSON.stringify(context.baseManifest);
  context.baseManifestHash = await hashMakerComposableV6BaseManifest(
    context.baseManifestJson,
  );
  assert.ok(collectMakerComposableV6PreflightIssues(attached, context)
    .some((entry) => entry.code === 'component_base_source_track_mismatch'));
});

test('build rejects a claimed hash, JSON, root or version that differs from the exact base release', async () => {
  const document = baseDocument();
  const attached = attachMakerComposableV6Draft(document, validDraft());
  const context = await releaseContext(document);

  await assert.rejects(
    buildMakerComposableV6Manifest(attached, {
      ...context,
      baseManifestHash: HASH_A,
    }),
    (error) => (
      error instanceof MakerComposableV6BridgeError
      && error.code === 'base-manifest-hash-mismatch'
    ),
  );

  await assert.rejects(
    buildMakerComposableV6Manifest(attached, {
      ...context,
      baseManifestJson: JSON.stringify({
        ...context.baseManifest,
        metadata: { id: 'different' },
      }),
    }),
    (error) => error.code === 'base-manifest-json-mismatch',
  );

  await assert.rejects(
    buildMakerComposableV6Manifest(attached, {
      ...context,
      baseMakerRootId: '0xdifferent-root',
    }),
    (error) => (
      error.code === 'companion-preflight-failed'
      && error.details.issues.some((entry) => entry.code === 'companion_base_root_mismatch')
    ),
  );

  const wrongVersionManifest = structuredClone(context.baseManifest);
  wrongVersionManifest.version.number += 1;
  const wrongVersionJson = JSON.stringify(wrongVersionManifest);
  await assert.rejects(
    buildMakerComposableV6Manifest(attached, {
      ...context,
      baseManifest: wrongVersionManifest,
      baseManifestJson: wrongVersionJson,
      baseManifestHash: await hashMakerComposableV6BaseManifest(wrongVersionJson),
    }),
    (error) => (
      error.code === 'companion-preflight-failed'
      && error.details.issues.some((entry) => entry.code === 'base_document_version_mismatch')
    ),
  );
});

test('unknown executable draft fields fail closed instead of leaking into publication', async () => {
  const document = baseDocument();
  document.extensions.composableV6 = {
    ...validDraft(),
    bodyAnchors: [{ id: 'head' }],
    rentalDuration: 30,
    extensionsHash: 'not-a-hash',
  };
  const context = await releaseContext(document);
  const issues = collectMakerComposableV6PreflightIssues(document, context);
  assert.deepEqual(
    issues.filter((entry) => entry.code === 'unknown_companion_draft_field')
      .map((entry) => entry.path)
      .sort(),
    [
      'extensions.composableV6.bodyAnchors',
      'extensions.composableV6.rentalDuration',
    ],
  );
  assert.ok(issues.some((entry) => entry.code === 'invalid_extensions_hash'));
  await assert.rejects(
    buildMakerComposableV6Manifest(document, context),
    (error) => error.code === 'companion-preflight-failed',
  );
});
