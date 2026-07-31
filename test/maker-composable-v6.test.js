import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CANVAS_ORIGINS,
  COMPOSABLE_PROFILE_MODES,
  COORDINATE_UNITS,
  ITEM_ACCESS_MODES,
  ITEM_BINDING_MODES,
  ITEM_ORIGIN_CLASSES,
  ITEM_RIGHTS_ORIGINS,
  MAKER_COMPOSABLE_V6_SCHEMA_VERSION,
  THIRD_PARTY_ADMISSION_MODES,
  canTransferOwnedEntitlementV6,
  collectCompatibilityProfileV6Issues,
  collectComposableProfileV6Issues,
  collectItemEntitlementV6Issues,
  collectItemProductV6Issues,
  createCompatibilityProfileV6,
  createComposableProfileV6,
  createItemEntitlementV6,
  createItemProductV6,
  deriveInventoryV6,
  isTransferSafeLoadoutV6,
  validateLoadoutV6,
} from '../maker-composable-v6.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const HASH_C = 'c'.repeat(64);
const HASH_D = 'd'.repeat(64);
const HASH_E = 'e'.repeat(64);
const MAKER_ROOT = '0xmaker-root-v6';
const MAKER_OWNER = '0xmaker-owner';
const ITEM_CREATOR = '0xitem-creator';

function validComposableProfile(overrides = {}) {
  return createComposableProfileV6({
    mode: COMPOSABLE_PROFILE_MODES.COMPOSABLE,
    thirdPartyAdmission: THIRD_PARTY_ADMISSION_MODES.OPEN,
    itemAssetization: true,
    ...overrides,
  });
}

function validCompatibility(overrides = {}) {
  return createCompatibilityProfileV6({
    makerRootId: MAKER_ROOT,
    canvas: { width: 2048, height: 2048 },
    coordinate: {
      origin: CANVAS_ORIGINS.TOP_LEFT,
      unit: COORDINATE_UNITS.PIXEL,
      pixelMode: false,
    },
    renderer: { version: 'renderer-v6.1', commitment: HASH_A },
    layerTrackIds: ['base', 'wardrobe', 'front'],
    slots: [
      { id: 'body', capacity: 1, required: true, layerTrackIds: ['base'] },
      { id: 'top', capacity: 1, required: false, layerTrackIds: ['wardrobe'] },
      { id: 'accessory', capacity: 1, required: false, layerTrackIds: ['front'] },
    ],
    maskPolicyHash: HASH_B,
    rulesHash: HASH_C,
    fallbackProductIds: ['base-body'],
    fallbackLoadoutHash: HASH_D,
    manifestBlobId: 'walrus-compatibility-v6',
    manifestHash: HASH_E,
    ...overrides,
  });
}

function validProduct(overrides = {}) {
  const originClass = overrides.originClass || ITEM_ORIGIN_CLASSES.OFFICIAL;
  const productId = overrides.id || 'base-body';
  const slotId = overrides.slotClaims?.[0]?.slotId || 'body';
  const layerTrackId = {
    body: 'base',
    top: 'wardrobe',
    accessory: 'front',
  }[slotId] || 'base';
  const publisher = overrides.publisher
    || (originClass === ITEM_ORIGIN_CLASSES.OFFICIAL ? MAKER_OWNER : ITEM_CREATOR);
  const certification = Object.hasOwn(overrides, 'certification')
    ? overrides.certification
    : originClass === ITEM_ORIGIN_CLASSES.OPEN
      ? null
      : { certifier: MAKER_OWNER, ownershipEpoch: 7 };
  return createItemProductV6({
    id: productId,
    version: 1,
    makerRootId: MAKER_ROOT,
    compatibilityHash: HASH_E,
    creator: originClass === ITEM_ORIGIN_CLASSES.OFFICIAL
      ? MAKER_OWNER
      : ITEM_CREATOR,
    publisher,
    originClass,
    display: {
      name: `Display ${productId}`,
      description: `Player-facing description for ${productId}.`,
      thumbnailBlobId: `walrus-thumb-${productId}`,
      thumbnailHash: HASH_D,
    },
    components: [{
      id: `${productId}-component`,
      layerTrackId,
      assetBlobId: `walrus-asset-${productId}`,
      assetHash: HASH_E,
      assetWidth: 2048,
      assetHeight: 2048,
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
      attestationId: 'validation-attestation-1',
      epoch: 3,
    },
    certification,
    manifestBlobId: 'walrus-item-manifest',
    manifestHash: HASH_A,
    contentHash: HASH_B,
    slotClaims: [{ slotId: 'body', units: 1 }],
    rightsOrigin: ITEM_RIGHTS_ORIGINS.ONCHAIN_NATIVE,
    rightsManifestHash: HASH_C,
    access: {
      mode: ITEM_ACCESS_MODES.EMBEDDED,
      binding: ITEM_BINDING_MODES.EMBEDDED,
    },
    ...overrides,
  });
}

function publicationIssues(product, {
  profile = validComposableProfile(),
  compatibility = validCompatibility(),
} = {}) {
  return collectItemProductV6Issues(product, {
    profile,
    compatibility,
    makerOwner: MAKER_OWNER,
    currentOwnershipEpoch: 7,
    publish: true,
  });
}

function entitlementFor(product, overrides = {}) {
  const binding = product.access.binding;
  return createItemEntitlementV6(product, {
    id: `${product.id}-grant-${overrides.suffix || '1'}`,
    holderAddress: binding === ITEM_BINDING_MODES.ACCOUNT ? '0xplayer' : undefined,
    soulId: binding === ITEM_BINDING_MODES.SOUL_BOUND ? '0xsoul' : undefined,
    ownerAddress: binding === ITEM_BINDING_MODES.OWNED ? '0xplayer' : undefined,
    issuedAtMs: 100,
    paidAtomic: product.access.priceAtomic,
    issuanceNonce: `${product.id}-nonce-${overrides.suffix || '1'}`,
    ...overrides,
  });
}

test('Fixed and Composable profiles project strict executable invariants', () => {
  const fixed = createComposableProfileV6({
    mode: COMPOSABLE_PROFILE_MODES.FIXED,
    loadoutMutable: true,
    thirdPartyAdmission: THIRD_PARTY_ADMISSION_MODES.OPEN,
    itemAssetization: true,
  });
  assert.deepEqual(fixed, {
    schemaVersion: MAKER_COMPOSABLE_V6_SCHEMA_VERSION,
    mode: COMPOSABLE_PROFILE_MODES.FIXED,
    loadoutMutable: false,
    thirdPartyAdmission: THIRD_PARTY_ADMISSION_MODES.DISABLED,
    itemAssetization: false,
    extensionsHash: '',
  });
  assert.deepEqual(collectComposableProfileV6Issues(fixed), []);

  const composable = validComposableProfile({ extensionsHash: HASH_A });
  assert.equal(composable.loadoutMutable, true);
  assert.equal(composable.thirdPartyAdmission, THIRD_PARTY_ADMISSION_MODES.OPEN);
  assert.equal(composable.itemAssetization, true);
  assert.equal(composable.extensionsHash, HASH_A);
  assert.deepEqual(collectComposableProfileV6Issues(composable), []);

  const invalid = { ...fixed, loadoutMutable: true };
  assert.ok(collectComposableProfileV6Issues(invalid)
    .some((entry) => entry.code === 'fixed_loadout_must_be_immutable'));
});

test('Compatibility is Maker-local, strict, publishable and has no hidden shape fields', () => {
  const compatibility = validCompatibility();
  assert.deepEqual(
    collectCompatibilityProfileV6Issues(compatibility, { publish: true }),
    [],
  );
  assert.equal(compatibility.canvas.width, 2048);
  assert.deepEqual(compatibility.slots.map((slot) => slot.id), [
    'body',
    'top',
    'accessory',
  ]);

  const unexpected = {
    ...compatibility,
    anchors: [{ id: 'head' }],
  };
  assert.ok(collectCompatibilityProfileV6Issues(unexpected, { publish: true })
    .some((entry) => (
      entry.path === 'compatibility.anchors'
      && entry.code === 'unknown_schema_field'
    )));
});

test('Compatibility rejects unknown tracks, duplicate slots and incomplete release commitments', () => {
  const compatibility = validCompatibility();
  compatibility.slots.push({
    id: 'top',
    capacity: 1,
    required: false,
    layerTrackIds: ['missing-track'],
  });
  compatibility.renderer.commitment = '';
  compatibility.fallbackProductIds = [];
  const codes = new Set(
    collectCompatibilityProfileV6Issues(compatibility, { publish: true })
      .map((entry) => entry.code),
  );
  assert.ok(codes.has('duplicate_slot'));
  assert.ok(codes.has('unknown_slot_layer_track'));
  assert.ok(codes.has('missing_commitment'));
  assert.ok(codes.has('missing_fallback_loadout'));
});

test('Official Item publication snapshots current Maker authority and validation', () => {
  const product = validProduct();
  assert.deepEqual(publicationIssues(product), []);

  product.publisher = '0xold-owner';
  product.certification.ownershipEpoch = 6;
  const codes = new Set(publicationIssues(product).map((entry) => entry.code));
  assert.ok(codes.has('official_item_requires_maker_owner'));
  assert.ok(codes.has('stale_certification_epoch'));
});

test('Certified and Open are different provenance classes but both require validation', () => {
  const certified = validProduct({
    id: 'certified-coat',
    originClass: ITEM_ORIGIN_CLASSES.CERTIFIED,
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.ACCOUNT,
    },
    slotClaims: [{ slotId: 'top', units: 1 }],
  });
  assert.deepEqual(publicationIssues(certified), []);

  const open = validProduct({
    id: 'open-accessory',
    originClass: ITEM_ORIGIN_CLASSES.OPEN,
    certification: null,
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.ACCOUNT,
    },
    slotClaims: [{ slotId: 'accessory', units: 1 }],
  });
  assert.deepEqual(publicationIssues(open), []);
  open.validation.passed = false;
  assert.ok(publicationIssues(open)
    .some((entry) => entry.code === 'validation_required'));

  const certifiedOnly = validComposableProfile({
    thirdPartyAdmission: THIRD_PARTY_ADMISSION_MODES.CERTIFIED,
  });
  assert.ok(publicationIssues(open, { profile: certifiedOnly })
    .some((entry) => entry.code === 'open_item_not_admitted'));
});

test('Item Product access forms are explicit and Owned depends on assetization', () => {
  const account = validProduct({
    id: 'account-shirt',
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.ACCOUNT,
    },
    slotClaims: [{ slotId: 'top', units: 1 }],
  });
  assert.deepEqual(publicationIssues(account), []);

  const soulBound = validProduct({
    id: 'soul-aura',
    access: {
      mode: ITEM_ACCESS_MODES.PAID_ONCE,
      binding: ITEM_BINDING_MODES.SOUL_BOUND,
      priceAtomic: 2_000_000,
    },
    slotClaims: [{ slotId: 'accessory', units: 1 }],
  });
  assert.deepEqual(publicationIssues(soulBound), []);

  const owned = validProduct({
    id: 'owned-hat',
    access: {
      mode: ITEM_ACCESS_MODES.PAID_ONCE,
      binding: ITEM_BINDING_MODES.OWNED,
      priceAtomic: 5_000_000,
      transferable: true,
    },
    slotClaims: [{ slotId: 'accessory', units: 1 }],
  });
  assert.deepEqual(publicationIssues(owned), []);
  assert.ok(publicationIssues(owned, {
    profile: validComposableProfile({ itemAssetization: false }),
  }).some((entry) => entry.code === 'owned_item_assetization_disabled'));

  const fixed = createComposableProfileV6();
  assert.ok(publicationIssues(account, { profile: fixed })
    .some((entry) => entry.code === 'fixed_item_must_be_embedded'));
});

test('Item Products reject invalid slots and contradictory dependency rules', () => {
  const product = validProduct({
    id: 'bad-coat',
    requires: ['base-body', 'bad-coat', 'same-rule'],
    excludes: ['same-rule'],
  });
  product.slotClaims = [
    { slotId: 'top', units: 2 },
    { slotId: 'accessory', units: 1 },
  ];
  const codes = new Set(publicationIssues(product).map((entry) => entry.code));
  assert.ok(codes.has('invalid_slot_units'));
  assert.ok(codes.has('item_requires_exactly_one_slot'));
  assert.ok(codes.has('self_referential_item_rule'));
  assert.ok(codes.has('contradictory_item_rule'));
});

test('Item Product display and Components resolve immutable simultaneous render layers', () => {
  const product = validProduct({
    id: 'renderable-coat',
    slotClaims: [{ slotId: 'top', units: 1 }],
    display: {
      name: 'Renderable Coat',
      description: 'A player-visible coat with two simultaneous PNG layers.',
      thumbnailBlobId: 'walrus-thumb-renderable-coat',
      thumbnailHash: HASH_D,
    },
    components: [
      {
        id: 'coat-back',
        layerTrackId: 'wardrobe',
        assetBlobId: 'walrus-coat-back',
        assetHash: HASH_A,
        assetWidth: 2048,
        assetHeight: 2048,
        transform: {
          x: -12,
          y: 8,
          scale: 0.95,
          rotation: 0,
          opacity: 1,
          blendMode: 'multiply',
        },
        baseSource: null,
      },
      {
        id: 'coat-front',
        layerTrackId: 'wardrobe',
        assetBlobId: 'walrus-coat-front',
        assetHash: HASH_B,
        assetWidth: 1024,
        assetHeight: 1536,
        transform: {
          x: -12,
          y: 8,
          scale: 0.95,
          rotation: 0,
          opacity: 0.9,
          blendMode: 'normal',
        },
        baseSource: null,
      },
    ],
  });
  assert.deepEqual(publicationIssues(product), []);
  assert.equal(product.display.name, 'Renderable Coat');
  assert.deepEqual(product.components.map((component) => component.id), [
    'coat-back',
    'coat-front',
  ]);
});

test('render payload fails closed on missing blobs, wrong tracks, base-source misuse and hidden sublayers', () => {
  const product = validProduct({
    id: 'external-bad-render',
    originClass: ITEM_ORIGIN_CLASSES.OPEN,
    creator: ITEM_CREATOR,
    publisher: ITEM_CREATOR,
    certification: null,
    slotClaims: [{ slotId: 'top', units: 1 }],
  });
  product.display.description = '';
  product.display.thumbnailHash = '';
  product.components = [
    {
      ...product.components[0],
      id: 'duplicate-component',
      layerTrackId: 'front',
      assetBlobId: '',
      assetHash: '',
      assetWidth: 0,
      assetHeight: 1.5,
      transform: {
        ...product.components[0].transform,
        opacity: 2,
      },
      baseSource: {
        partId: 'outfit',
        itemId: 'coat',
        styleId: 'default',
      },
      anchors: ['body'],
    },
    {
      ...product.components[0],
      id: 'duplicate-component',
      variants: [{ id: 'red' }],
    },
  ];
  const codes = new Set(publicationIssues(product).map((entry) => entry.code));
  assert.ok(codes.has('missing_item_description'));
  assert.ok(codes.has('missing_commitment'));
  assert.ok(codes.has('invalid_component_asset_blob'));
  assert.ok(codes.has('invalid_component_asset_dimension'));
  assert.ok(codes.has('invalid_component_opacity'));
  assert.ok(codes.has('duplicate_item_component'));
  assert.ok(codes.has('component_track_outside_claimed_slot'));
  assert.ok(codes.has('external_component_cannot_use_base_source'));
  assert.ok(codes.has('unknown_schema_field'));
});

test('Entitlements pin exact Product identity, rights and one holder model', () => {
  const accountProduct = validProduct({
    id: 'account-shirt',
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.ACCOUNT,
    },
    slotClaims: [{ slotId: 'top', units: 1 }],
  });
  const account = entitlementFor(accountProduct);
  assert.deepEqual(collectItemEntitlementV6Issues(account, {
    product: accountProduct,
  }), []);
  assert.equal(account.holderAddress, '0xplayer');
  assert.equal(account.soulId, null);

  const soulProduct = validProduct({
    id: 'soul-aura',
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.SOUL_BOUND,
    },
    slotClaims: [{ slotId: 'accessory', units: 1 }],
  });
  const soul = entitlementFor(soulProduct);
  assert.deepEqual(collectItemEntitlementV6Issues(soul, {
    product: soulProduct,
  }), []);
  assert.equal(soul.soulId, '0xsoul');

  soul.rightsSnapshotHash = HASH_D;
  assert.ok(collectItemEntitlementV6Issues(soul, { product: soulProduct })
    .some((entry) => entry.code === 'rights_snapshot_mismatch'));
});

test('Inventory is derived from embedded, account, Soul-bound and owned authorities', () => {
  const embedded = validProduct();
  const accountProduct = validProduct({
    id: 'account-shirt',
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.ACCOUNT,
    },
    slotClaims: [{ slotId: 'top', units: 1 }],
  });
  const soulProduct = validProduct({
    id: 'soul-aura',
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.SOUL_BOUND,
    },
    slotClaims: [{ slotId: 'accessory', units: 1 }],
  });
  const ownedProduct = validProduct({
    id: 'owned-pin',
    access: {
      mode: ITEM_ACCESS_MODES.PAID_ONCE,
      binding: ITEM_BINDING_MODES.OWNED,
      priceAtomic: 1_000_000,
      transferable: true,
    },
    slotClaims: [{ slotId: 'accessory', units: 1 }],
  });
  const otherSoulOwned = entitlementFor(ownedProduct, {
    suffix: 'other',
    equippedSoulId: '0xother-soul',
  });
  const inventory = deriveInventoryV6({
    products: [embedded, accountProduct, soulProduct, ownedProduct],
    entitlements: [
      entitlementFor(accountProduct),
      entitlementFor(soulProduct),
      entitlementFor(ownedProduct),
      otherSoulOwned,
    ],
    makerRootId: MAKER_ROOT,
    compatibilityHash: HASH_E,
    ownerAddress: '0xplayer',
    soulId: '0xsoul',
  });
  assert.deepEqual(inventory.map((entry) => entry.productId), [
    'base-body',
    'account-shirt',
    'soul-aura',
    'owned-pin',
  ]);
});

test('Loadout enforces slot capacity, requires and excludes across products', () => {
  const compatibility = validCompatibility();
  const body = validProduct();
  const shirt = validProduct({
    id: 'shirt',
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.ACCOUNT,
    },
    slotClaims: [{ slotId: 'top', units: 1 }],
    requires: ['base-body'],
  });
  const coat = validProduct({
    id: 'coat',
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.ACCOUNT,
    },
    slotClaims: [{ slotId: 'top', units: 1 }],
    excludes: ['shirt'],
  });
  const entitlements = [entitlementFor(shirt), entitlementFor(coat)];

  const valid = validateLoadoutV6({
    profile: validComposableProfile(),
    compatibility,
    products: [body, shirt, coat],
    entitlements,
    selected: ['base-body', 'shirt'],
    ownerAddress: '0xplayer',
    soulId: '0xsoul',
    postMint: true,
  });
  assert.equal(valid.valid, true);
  assert.deepEqual(valid.occupancy, { body: 1, top: 1 });

  const invalid = validateLoadoutV6({
    profile: validComposableProfile(),
    compatibility,
    products: [body, shirt, coat],
    entitlements,
    selected: ['shirt', 'coat'],
    ownerAddress: '0xplayer',
    soulId: '0xsoul',
    postMint: true,
  });
  const codes = new Set(invalid.issues.map((entry) => entry.code));
  assert.ok(codes.has('missing_required_item'));
  assert.ok(codes.has('excluded_item_selected'));
  assert.ok(codes.has('slot_capacity_exceeded'));
  assert.ok(codes.has('required_slot_empty'));
});

test('Transfer-safe Loadout keeps only embedded and Soul-bound rights', () => {
  const compatibility = validCompatibility();
  const body = validProduct();
  const soulProduct = validProduct({
    id: 'soul-aura',
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.SOUL_BOUND,
    },
    slotClaims: [{ slotId: 'accessory', units: 1 }],
  });
  const accountProduct = validProduct({
    id: 'account-pin',
    access: {
      mode: ITEM_ACCESS_MODES.FREE_CLAIM,
      binding: ITEM_BINDING_MODES.ACCOUNT,
    },
    slotClaims: [{ slotId: 'accessory', units: 1 }],
  });
  const common = {
    profile: validComposableProfile(),
    compatibility,
    products: [body, soulProduct, accountProduct],
    entitlements: [
      entitlementFor(soulProduct),
      entitlementFor(accountProduct),
    ],
    ownerAddress: '0xplayer',
    soulId: '0xsoul',
  };
  assert.equal(isTransferSafeLoadoutV6({
    ...common,
    selected: ['base-body', 'soul-aura'],
  }), true);
  assert.equal(isTransferSafeLoadoutV6({
    ...common,
    selected: ['base-body', 'account-pin'],
  }), false);

  const fixedResult = validateLoadoutV6({
    ...common,
    profile: createComposableProfileV6(),
    selected: ['base-body'],
    postMint: true,
  });
  assert.ok(fixedResult.issues
    .some((entry) => entry.code === 'fixed_loadout_immutable'));
});

test('Owned Item transfer requires exact valid entitlement and an unequipped state', () => {
  const product = validProduct({
    id: 'owned-pin',
    access: {
      mode: ITEM_ACCESS_MODES.PAID_ONCE,
      binding: ITEM_BINDING_MODES.OWNED,
      priceAtomic: 1_000_000,
      transferable: true,
    },
    slotClaims: [{ slotId: 'accessory', units: 1 }],
  });
  const entitlement = entitlementFor(product);
  assert.equal(canTransferOwnedEntitlementV6(entitlement, product), true);
  entitlement.equippedSoulId = '0xsoul';
  assert.equal(canTransferOwnedEntitlementV6(entitlement, product), false);
  entitlement.equippedSoulId = null;
  product.access.transferable = false;
  assert.equal(canTransferOwnedEntitlementV6(entitlement, product), false);
});

test('Only generic extensionsHash is accepted as the forward upgrade surface', () => {
  const profile = validComposableProfile({ extensionsHash: HASH_A });
  assert.deepEqual(collectComposableProfileV6Issues(profile), []);

  const product = validProduct({ extensionsHash: HASH_B });
  product.runtimeFeatures = { arbitrary: true };
  const unknown = publicationIssues(product)
    .find((entry) => entry.path === 'product.runtimeFeatures');
  assert.equal(unknown?.code, 'unknown_schema_field');

  product.extensionsHash = 'not-a-hash';
  assert.ok(publicationIssues(product)
    .some((entry) => entry.code === 'invalid_commitment'));

  const supplyClaims = validProduct();
  supplyClaims.access.maxSupply = 100;
  supplyClaims.access.perWalletLimit = 1;
  const supplyIssues = publicationIssues(supplyClaims);
  assert.ok(supplyIssues.some((entry) => (
    entry.path === 'product.access.maxSupply'
    && entry.code === 'unknown_schema_field'
  )));
  assert.ok(supplyIssues.some((entry) => (
    entry.path === 'product.access.perWalletLimit'
    && entry.code === 'unknown_schema_field'
  )));
});
