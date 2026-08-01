import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPOSABLE_PROFILE_MODES,
  ITEM_ACCESS_MODES,
  ITEM_BINDING_MODES,
  ITEM_ORIGIN_CLASSES,
  ITEM_RIGHTS_ORIGINS,
  THIRD_PARTY_ADMISSION_MODES,
  createComposableProfileV6,
  createItemProductV6,
} from '../maker-composable-v6.js';
import {
  MakerComposableV6WorkspaceError,
  createOfficialEmbeddedItemProductDraftV6,
  deriveMakerLocalCompatibilityV6,
  deriveWardrobeCardsV6,
  inspectThirdPartyItemManifestV6,
  itemProductComponentsToRendererLayersV6,
  mergeEmbeddedProductSelectionIntoRecipeV6,
  validateWardrobeLoadoutV6,
} from '../maker-composable-v6-workspace.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const HASH_E = 'e'.repeat(64);
const MAKER_ROOT = '0xmaker-root';
const MAKER_OWNER = '0xmaker-owner';

function documentFixture() {
  return {
    schemaVersion: 'animacraft.maker.v5',
    version: { rootMakerId: 'maker-family' },
    metadata: { creator: MAKER_OWNER },
    canvas: { width: 800, height: 600, pixelMode: 'pixelated' },
    layerTracks: [
      { id: 'front', name: 'Front', order: 1 },
      { id: 'back', name: 'Back', order: 0 },
      { id: 'fx', name: 'FX', order: 2 },
    ],
    assets: [
      { id: 'body-png', width: 800, height: 600, contentHash: HASH_A },
      { id: 'hair-png', width: 400, height: 500, contentHash: HASH_B },
      { id: 'hair-back-png', width: 400, height: 500, contentHash: HASH_C },
    ],
    parts: [{
      id: 'body',
      name: 'Body',
      required: true,
      items: [{
        id: 'base',
        name: 'Base',
        styles: [{
          id: 'default',
          name: 'Default',
          assetId: 'body-png',
          layerTrackId: 'back',
          transform: { x: 0, y: 0, scale: 1, rotation: 0 },
          opacity: 1,
          blendMode: 'normal',
          requires: [],
          excludes: [],
        }],
      }],
    }, {
      id: 'hair',
      name: 'Hair',
      required: false,
      items: [{
        id: 'long',
        name: 'Long Hair',
        styles: [{
          id: 'front-style',
          name: 'Front Style',
          assetId: 'hair-png',
          layerTrackId: 'front',
          transform: { x: 120, y: 25, scale: 0.75, rotation: 5 },
          opacity: 0.8,
          blendMode: 'multiply',
          requires: ['base-body'],
          excludes: [],
        }, {
          id: 'back-style',
          name: 'Back Style',
          assetId: 'hair-back-png',
          layerTrackId: 'back',
          transform: { x: 100, y: 20, scale: 0.75, rotation: 0 },
          opacity: 1,
          blendMode: 'normal',
          requires: [],
          excludes: [],
        }],
      }],
    }],
  };
}

function compatibilityFixture(overrides = {}) {
  return deriveMakerLocalCompatibilityV6(documentFixture(), {
    makerRootId: MAKER_ROOT,
    rendererVersion: 'renderer-v6.1',
    rendererCommitment: HASH_A,
    maskPolicyHash: HASH_B,
    rulesHash: HASH_C,
    manifestBlobId: 'compatibility-blob',
    manifestHash: HASH_D,
    ...overrides,
  });
}

function composableProfile() {
  return createComposableProfileV6({
    mode: COMPOSABLE_PROFILE_MODES.COMPOSABLE,
    thirdPartyAdmission: THIRD_PARTY_ADMISSION_MODES.OPEN,
    itemAssetization: true,
  });
}

function publishedProduct(originClass, overrides = {}) {
  const creator = originClass === ITEM_ORIGIN_CLASSES.OFFICIAL
    ? MAKER_OWNER
    : '0xthird-party-creator';
  return createItemProductV6({
    id: `${originClass.toLowerCase()}:hair:v1`,
    version: 1,
    makerRootId: MAKER_ROOT,
    compatibilityHash: HASH_D,
    creator,
    publisher: originClass === ITEM_ORIGIN_CLASSES.OFFICIAL ? MAKER_OWNER : creator,
    originClass,
    display: {
      name: `${originClass} Hair`,
      description: 'A technically validated external hair Item.',
      thumbnailBlobId: `${originClass.toLowerCase()}-thumb`,
      thumbnailHash: HASH_A,
    },
    components: [{
      id: `${originClass.toLowerCase()}:front-component`,
      layerTrackId: 'front',
      assetBlobId: `${originClass.toLowerCase()}-png`,
      assetHash: HASH_B,
      assetWidth: 400,
      assetHeight: 500,
      transform: {
        x: 110,
        y: 20,
        scale: 0.75,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
      },
      baseSource: null,
    }],
    validation: { passed: true, attestationId: `${originClass.toLowerCase()}-validation`, epoch: 3 },
    certification: originClass === ITEM_ORIGIN_CLASSES.OPEN
      ? null
      : { certifier: MAKER_OWNER, ownershipEpoch: 7 },
    manifestBlobId: `${originClass.toLowerCase()}-manifest`,
    manifestHash: HASH_C,
    contentHash: HASH_D,
    slotClaims: [{ slotId: 'hair', units: 1 }],
    requires: [],
    excludes: [],
    rightsOrigin: ITEM_RIGHTS_ORIGINS.ONCHAIN_NATIVE,
    rightsManifestHash: HASH_E,
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.ACCOUNT,
      priceAtomic: 0,
      transferable: false,
    },
    makerEcosystemFeeBps: 100,
    ...overrides,
  });
}

test('derives only Maker-local canvas, Layer Tracks and one capacity-one Slot per Part', () => {
  const compatibility = compatibilityFixture();
  assert.deepEqual(compatibility.canvas, { width: 800, height: 600 });
  assert.deepEqual(compatibility.coordinate, {
    origin: 'TOP_LEFT',
    unit: 'PIXEL',
    pixelMode: true,
  });
  assert.deepEqual(compatibility.renderer, {
    version: 'renderer-v6.1',
    commitment: HASH_A,
  });
  assert.deepEqual(compatibility.layerTrackIds, ['back', 'front', 'fx']);
  assert.deepEqual(compatibility.slots, [{
    id: 'body',
    capacity: 1,
    required: true,
    layerTrackIds: ['back'],
  }, {
    id: 'hair',
    capacity: 1,
    required: false,
    layerTrackIds: ['back', 'front'],
  }]);
  assert.doesNotMatch(JSON.stringify(compatibility), /anchor|skeleton|bodyPoint/i);
});

test('creates an Official embedded Product from exact source PNG dimensions and Style transform', () => {
  const product = createOfficialEmbeddedItemProductDraftV6({
    document: documentFixture(),
    compatibility: compatibilityFixture(),
    partId: 'hair',
    itemId: 'long',
    styleId: 'front-style',
    asset: {
      assetId: 'hair-png',
      assetBlobId: 'hair-png-blob',
      assetHash: HASH_B,
      width: 400,
      height: 500,
    },
  });
  assert.equal(product.originClass, ITEM_ORIGIN_CLASSES.OFFICIAL);
  assert.deepEqual(product.access, {
    mode: ITEM_ACCESS_MODES.EMBEDDED,
    binding: ITEM_BINDING_MODES.EMBEDDED,
    priceAtomic: 0,
    transferable: false,
  });
  assert.deepEqual(product.slotClaims, [{ slotId: 'hair', units: 1 }]);
  assert.deepEqual(product.components[0].baseSource, {
    partId: 'hair',
    itemId: 'long',
    styleId: 'front-style',
  });
  assert.equal(product.components[0].assetWidth, 400);
  assert.equal(product.components[0].assetHeight, 500);
  assert.deepEqual(product.components[0].transform, {
    x: 120,
    y: 25,
    scale: 0.75,
    rotation: 5,
    opacity: 0.8,
    blendMode: 'multiply',
  });
});

test('never derives dimensions from transparent content and rejects mismatched tracks', () => {
  const document = documentFixture();
  assert.throws(() => createOfficialEmbeddedItemProductDraftV6({
    document,
    compatibility: compatibilityFixture(),
    partId: 'hair',
    itemId: 'long',
    styleId: 'front-style',
    asset: { assetId: 'hair-png', width: 0, height: 500 },
  }), (error) => (
    error instanceof MakerComposableV6WorkspaceError
    && error.code === 'missing-source-png-dimensions'
  ));

  const compatibility = compatibilityFixture();
  compatibility.slots.find((slot) => slot.id === 'hair').layerTrackIds = ['back'];
  assert.throws(() => createOfficialEmbeddedItemProductDraftV6({
    document,
    compatibility,
    partId: 'hair',
    itemId: 'long',
    styleId: 'front-style',
    asset: { assetId: 'hair-png', width: 400, height: 500 },
  }), (error) => error.code === 'base-style-outside-slot');
});

test('Official, Certified and Open all require the same technical validation attestation', () => {
  for (const originClass of Object.values(ITEM_ORIGIN_CLASSES)) {
    const product = publishedProduct(originClass);
    const compatibility = compatibilityFixture();
    const valid = inspectThirdPartyItemManifestV6(product, {
      profile: composableProfile(),
      compatibility,
      makerOwner: MAKER_OWNER,
      currentOwnershipEpoch: 7,
      trustedAttestation: {
        verified: true,
        attestationId: product.validation.attestationId,
        productId: product.id,
        definitionCommitment: product.manifestHash,
        slotSchemaCommitment: compatibility.manifestHash,
        epoch: product.validation.epoch,
      },
    });
    assert.equal(valid.valid, true, `${originClass}: ${JSON.stringify(valid.issues)}`);

    const invalid = publishedProduct(originClass, {
      validation: { passed: false, attestationId: '', epoch: 3 },
    });
    const result = inspectThirdPartyItemManifestV6(invalid, {
      profile: composableProfile(),
      compatibility: compatibilityFixture(),
      makerOwner: MAKER_OWNER,
      currentOwnershipEpoch: 7,
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.some((entry) => entry.code === 'technical-validation-required'));
    assert.ok(result.issues.some((entry) => entry.code === 'technical-attestation-required'));
  }
});

test('trusted attestation is applied to the normalized Product, not raw self-report fields', () => {
  const product = publishedProduct(ITEM_ORIGIN_CLASSES.OPEN, {
    validation: { passed: false, attestationId: '', epoch: 0 },
  });
  const result = inspectThirdPartyItemManifestV6(product, {
    profile: composableProfile(),
    compatibility: compatibilityFixture(),
    makerOwner: MAKER_OWNER,
    currentOwnershipEpoch: 7,
    trustedAttestation: {
      verified: true,
      attestationId: 'trusted-chain-attestation',
      productId: product.id,
      definitionCommitment: product.manifestHash,
      slotSchemaCommitment: compatibilityFixture().manifestHash,
      epoch: 12,
    },
  });

  assert.equal(result.valid, true, JSON.stringify(result.issues));
  assert.equal(result.technicallyValidated, true);
  assert.deepEqual(result.product.validation, {
    passed: true,
    attestationId: 'trusted-chain-attestation',
    epoch: 12,
  });
});

test('third-party JSON cannot self-declare a trusted validator attestation', () => {
  const product = publishedProduct(ITEM_ORIGIN_CLASSES.OPEN);
  const pending = inspectThirdPartyItemManifestV6(product, {
    profile: composableProfile(),
    compatibility: compatibilityFixture(),
    makerOwner: MAKER_OWNER,
    currentOwnershipEpoch: 7,
    publish: false,
  });
  assert.equal(pending.valid, true, JSON.stringify(pending.issues));
  assert.equal(pending.technicallyValidated, false);
  assert.deepEqual(pending.product.validation, {
    passed: false,
    attestationId: '',
    epoch: 0,
  });

  const publishAttempt = inspectThirdPartyItemManifestV6(product, {
    profile: composableProfile(),
    compatibility: compatibilityFixture(),
    makerOwner: MAKER_OWNER,
    currentOwnershipEpoch: 7,
  });
  assert.equal(publishAttempt.valid, false);
  assert.ok(publishAttempt.issues.some((entry) => entry.code === 'technical-validation-required'));
  assert.ok(publishAttempt.issues.some((entry) => entry.code === 'technical-attestation-required'));
});

test('third-party import reports source dimension and Layer Track failures clearly', () => {
  const product = publishedProduct(ITEM_ORIGIN_CLASSES.OPEN);
  product.components[0].assetWidth = 0;
  product.components[0].layerTrackId = 'missing-track';
  const result = inspectThirdPartyItemManifestV6(JSON.stringify(product), {
    profile: composableProfile(),
    compatibility: compatibilityFixture(),
    makerOwner: MAKER_OWNER,
    currentOwnershipEpoch: 7,
  });
  assert.equal(result.valid, false);
  assert.ok(result.issues.some((entry) => entry.code === 'invalid_component_asset_dimension'));
  assert.ok(result.issues.some((entry) => entry.code === 'component_track_outside_claimed_slot'));
});

test('merges embedded baseSource into the player recipe without changing other selections or colors', () => {
  const product = createOfficialEmbeddedItemProductDraftV6({
    document: documentFixture(),
    compatibility: compatibilityFixture(),
    partId: 'hair',
    itemId: 'long',
    styleId: 'front-style',
    asset: { assetId: 'hair-png', width: 400, height: 500 },
  });
  const original = {
    selections: [
      { partId: 'body', itemId: 'base', styleId: 'default' },
      { partId: 'hair', itemId: 'short', styleId: 'short-style', color: 'blue' },
    ],
    colors: [{ channelId: 'hair-color', swatchId: 'navy' }],
  };
  const next = mergeEmbeddedProductSelectionIntoRecipeV6(original, product);
  assert.deepEqual(next.selections, [
    { partId: 'body', itemId: 'base', styleId: 'default' },
    { partId: 'hair', itemId: 'long', styleId: 'front-style', color: 'blue' },
  ]);
  assert.deepEqual(next.colors, original.colors);
  assert.equal(original.selections[1].itemId, 'short');
});

test('converts external Components to shared Renderer layers in global back-to-front order', () => {
  const compatibility = compatibilityFixture();
  const product = publishedProduct(ITEM_ORIGIN_CLASSES.OPEN, {
    components: [{
      id: 'front-component',
      layerTrackId: 'front',
      assetBlobId: 'front-blob',
      assetHash: HASH_A,
      assetWidth: 320,
      assetHeight: 480,
      transform: { x: 20, y: 30, scale: 0.5, rotation: 5, opacity: 0.9, blendMode: 'screen' },
      baseSource: null,
    }, {
      id: 'back-component',
      layerTrackId: 'back',
      assetBlobId: 'back-blob',
      assetHash: HASH_B,
      assetWidth: 400,
      assetHeight: 500,
      transform: { x: 10, y: 15, scale: 0.75, rotation: 0, opacity: 1, blendMode: 'multiply' },
      baseSource: null,
    }],
  });
  const layers = itemProductComponentsToRendererLayersV6(product, {
    compatibility,
    profile: composableProfile(),
    layerTracks: documentFixture().layerTracks,
  });
  assert.deepEqual(layers.map((layer) => layer.componentId), ['back-component', 'front-component']);
  assert.deepEqual(layers[0].transform, {
    x: 10,
    y: 15,
    width: 400,
    height: 500,
    scaleX: 0.75,
    scaleY: 0.75,
    rotation: 0,
    originX: 200,
    originY: 250,
  });
  assert.equal(layers[0].pixelMode, 'nearest');
  assert.equal(layers[0].partId, 'hair');
  assert.equal(layers[0].asset.blobId, 'back-blob');
  assert.equal(layers[1].compositeOperation, 'screen');
});

test('Wardrobe cards and post-mint loadout validation distinguish Fixed and Composable Makers', () => {
  const compatibility = compatibilityFixture();
  compatibility.slots = compatibility.slots.map((slot) => ({ ...slot, required: false }));
  const document = documentFixture();
  document.parts[1].items[0].styles[0].requires = [];
  const embedded = createOfficialEmbeddedItemProductDraftV6({
    document,
    compatibility,
    partId: 'hair',
    itemId: 'long',
    styleId: 'front-style',
    asset: { assetId: 'hair-png', width: 400, height: 500 },
    validation: { passed: true, attestationId: 'official-validation', epoch: 1 },
    certification: { certifier: MAKER_OWNER, ownershipEpoch: 7 },
  });
  const fixed = createComposableProfileV6({ mode: COMPOSABLE_PROFILE_MODES.FIXED });
  const composable = composableProfile();
  assert.equal(deriveWardrobeCardsV6({
    profile: fixed,
    compatibility,
    products: [embedded],
    selected: [embedded.id],
  })[0].canEquip, false);
  assert.equal(deriveWardrobeCardsV6({
    profile: composable,
    compatibility,
    products: [embedded],
    selected: [embedded.id],
  })[0].canEquip, true);

  const fixedResult = validateWardrobeLoadoutV6({
    profile: fixed,
    compatibility,
    products: [embedded],
    selected: [embedded.id],
    postMint: true,
  });
  assert.equal(fixedResult.valid, false);
  assert.ok(fixedResult.issues.some((entry) => entry.code === 'fixed_loadout_immutable'));

  const composableResult = validateWardrobeLoadoutV6({
    profile: composable,
    compatibility,
    products: [embedded],
    selected: [embedded.id],
    postMint: true,
  });
  assert.equal(composableResult.valid, true, JSON.stringify(composableResult.issues));
  assert.deepEqual(composableResult.selectedProductIds, [embedded.id]);
});
