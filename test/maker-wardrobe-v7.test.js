import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COMPOSABLE_PROFILE_MODES,
  THIRD_PARTY_ADMISSION_MODES,
} from '../maker-composable-v6.js';
import { getMakerComposableV6Draft } from '../maker-composable-v6-bridge.js';
import {
  PHYSICAL_PART_BEHAVIORS,
  STYLE_PRODUCT_ADMISSION_CLASSES,
} from '../maker-physical-v7.js';
import { getPhysicalStyleCatalogV7Draft } from '../maker-physical-v7-workspace.js';
import {
  MAKER_WARDROBE_V7_PART_MODES,
  createMakerWardrobeV7ReleaseSnapshot,
  makerWardrobeV7PartMode,
  makerWardrobeV7PartModes,
  makerWardrobeV7ReleaseSourceIdentity,
  makerWardrobeV7Summary,
  setMakerWardrobeV7Enabled,
  setMakerWardrobeV7PartMode,
  synchronizeMakerWardrobeV7,
} from '../maker-wardrobe-v7.js';

const HASH = 'a'.repeat(64);
const OTHER_HASH = 'b'.repeat(64);

function fixture() {
  return {
    schemaVersion: 'animacraft.maker.v5',
    version: { rootMakerId: 'maker-one' },
    metadata: { creator: '0xabc' },
    canvas: { width: 1024, height: 1024, pixelMode: 'smooth' },
    layerTracks: [
      { id: 'body-track', order: 0 },
      { id: 'hair-track', order: 1 },
    ],
    assets: [
      { id: 'body-png', width: 1024, height: 1024, contentHash: HASH },
      { id: 'hair-png', width: 1024, height: 1024, contentHash: HASH },
    ],
    parts: [
      {
        id: 'body', name: 'Body', required: true, items: [{
          id: 'base', name: 'Base', styles: [{
            id: 'default', name: 'Default', assetId: 'body-png', layerTrackId: 'body-track',
            transform: { x: 0, y: 0, scale: 1, rotation: 0 }, opacity: 1, blendMode: 'normal',
          }],
        }],
      },
      {
        id: 'hair', name: 'Hair', required: false, items: [{
          id: 'long', name: 'Long Hair', styles: [{
            id: 'blue', name: 'Blue', assetId: 'hair-png', layerTrackId: 'hair-track',
            transform: { x: 20, y: 10, scale: 1, rotation: 0 }, opacity: 1, blendMode: 'normal',
          }],
        }],
      },
    ],
    defaultRecipe: {
      selections: [
        { partId: 'body', itemId: 'base', styleId: 'default' },
        { partId: 'hair', itemId: 'long', styleId: 'blue' },
      ],
      colors: [],
    },
    extensions: {},
  };
}

function enableWardrobeParts(document, partIds = ['body', 'hair'], options = {}) {
  const context = { profileId: 'profile-one', ...options };
  setMakerWardrobeV7Enabled(document, true, context);
  let result = null;
  partIds.forEach((partId) => {
    result = setMakerWardrobeV7PartMode(
      document,
      partId,
      MAKER_WARDROBE_V7_PART_MODES.SLOT,
      context,
    );
  });
  return result;
}

test('wardrobe master switch keeps every Part fixed until the creator explicitly enables a Slot', () => {
  const document = fixture();
  document.parts.push({
    id: 'background',
    name: 'Background',
    required: false,
    items: [],
  });
  assert.deepEqual(makerWardrobeV7PartModes(document), {
    body: MAKER_WARDROBE_V7_PART_MODES.FIXED,
    hair: MAKER_WARDROBE_V7_PART_MODES.FIXED,
    background: MAKER_WARDROBE_V7_PART_MODES.FIXED,
  });

  const result = setMakerWardrobeV7Enabled(document, true, {
    profileId: 'profile-one',
    rendererVersion: 'renderer-v7',
  });
  assert.ok(result.issues.some((entry) => entry.code === 'wardrobe_slot_required'));

  let draft = getMakerComposableV6Draft(document);
  assert.equal(draft.profile.mode, COMPOSABLE_PROFILE_MODES.COMPOSABLE);
  assert.equal(draft.profile.thirdPartyAdmission, THIRD_PARTY_ADMISSION_MODES.OPEN);
  assert.equal(draft.profile.itemAssetization, true);
  assert.deepEqual(draft.compatibility.slots, []);
  assert.deepEqual(draft.items, []);

  let catalog = getPhysicalStyleCatalogV7Draft(document);
  assert.equal(catalog.enabled, true);
  assert.equal(catalog.admission.open, true);
  assert.equal(catalog.families.length, 0);
  assert.ok(catalog.partPolicies.every((policy) => (
    policy.behavior === PHYSICAL_PART_BEHAVIORS.FIXED
    && policy.maxSourceKind === STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL
  )));

  const slotted = setMakerWardrobeV7PartMode(
    document,
    'hair',
    MAKER_WARDROBE_V7_PART_MODES.SLOT,
    { profileId: 'profile-one', rendererVersion: 'renderer-v7' },
  );
  assert.deepEqual(slotted.issues, []);
  assert.equal(makerWardrobeV7PartMode(document, 'hair'), MAKER_WARDROBE_V7_PART_MODES.SLOT);
  assert.equal(makerWardrobeV7PartMode(document, 'background'), MAKER_WARDROBE_V7_PART_MODES.FIXED);
  draft = getMakerComposableV6Draft(document);
  assert.deepEqual(draft.compatibility.slots.map((slot) => [slot.id, slot.capacity, slot.required]), [
    ['hair', 1, false],
  ]);
  assert.deepEqual(draft.items.map((product) => product.id), [
    'official:hair:long:blue:v1',
  ]);
  catalog = getPhysicalStyleCatalogV7Draft(document);
  assert.equal(catalog.families.length, 1);
  assert.equal(
    catalog.partPolicies.find((policy) => policy.partId === 'hair').behavior,
    PHYSICAL_PART_BEHAVIORS.HYBRID,
  );
  assert.equal(
    catalog.partPolicies.find((policy) => policy.partId === 'background').behavior,
    PHYSICAL_PART_BEHAVIORS.FIXED,
  );
  assert.deepEqual(makerWardrobeV7Summary(document), {
    schemaVersion: 'animacraft.maker-wardrobe.v7',
    enabled: true,
    fixedPartCount: 2,
    configuredSlotCount: 1,
    slotCount: 1,
    itemProductCount: 1,
    styleProductCount: 1,
    openToValidatedThirdPartyItems: true,
  });
});

test('required Slots need an included fallback while optional Slots may be empty', () => {
  const optionalDocument = fixture();
  optionalDocument.parts[1].items = [];
  setMakerWardrobeV7Enabled(optionalDocument, true, { profileId: 'profile-one' });
  const optionalResult = setMakerWardrobeV7PartMode(
    optionalDocument,
    'hair',
    MAKER_WARDROBE_V7_PART_MODES.SLOT,
    { profileId: 'profile-one' },
  );
  assert.deepEqual(optionalResult.issues, []);
  assert.deepEqual(getMakerComposableV6Draft(optionalDocument).compatibility.fallbackProductIds, []);

  const requiredDocument = fixture();
  requiredDocument.parts[0].items = [];
  setMakerWardrobeV7Enabled(requiredDocument, true, { profileId: 'profile-one' });
  const requiredResult = setMakerWardrobeV7PartMode(
    requiredDocument,
    'body',
    MAKER_WARDROBE_V7_PART_MODES.SLOT,
    { profileId: 'profile-one' },
  );
  assert.ok(requiredResult.issues.some((entry) => (
    entry.code === 'wardrobe_required_slot_fallback_required'
  )));
});

test('turning the master switch off makes all Part policies effectively fixed without forgetting choices', () => {
  const document = fixture();
  enableWardrobeParts(document, ['hair']);
  setMakerWardrobeV7Enabled(document, false);

  assert.equal(
    makerWardrobeV7PartMode(document, 'hair'),
    MAKER_WARDROBE_V7_PART_MODES.FIXED,
  );
  assert.equal(
    makerWardrobeV7PartMode(document, 'hair', { effective: false }),
    MAKER_WARDROBE_V7_PART_MODES.SLOT,
  );
  assert.ok(getPhysicalStyleCatalogV7Draft(document).partPolicies.every((policy) => (
    policy.behavior === PHYSICAL_PART_BEHAVIORS.FIXED
  )));

  setMakerWardrobeV7Enabled(document, true, { profileId: 'profile-one' });
  assert.equal(
    makerWardrobeV7PartMode(document, 'hair'),
    MAKER_WARDROBE_V7_PART_MODES.SLOT,
  );
  assert.deepEqual(
    getMakerComposableV6Draft(document).compatibility.slots.map((slot) => slot.id),
    ['hair'],
  );
});

test('wardrobe synchronization is idempotent and preserves Style commerce settings', () => {
  const document = fixture();
  enableWardrobeParts(document);
  const first = getPhysicalStyleCatalogV7Draft(document);
  first.families[0].styles[0].supply = { mode: 'OPEN_EDITION', cap: null, minted: 3 };
  first.families[0].styles[0].commerce.priceAtomic = 123;
  document.extensions.physicalStyleCatalogV7 = first;

  synchronizeMakerWardrobeV7(document, { profileId: 'profile-one' });
  synchronizeMakerWardrobeV7(document, { profileId: 'profile-one' });

  const draft = getMakerComposableV6Draft(document);
  const catalog = getPhysicalStyleCatalogV7Draft(document);
  assert.equal(new Set(draft.items.map((item) => item.id)).size, 2);
  assert.equal(catalog.families.flatMap((family) => family.styles).length, 2);
  const product = catalog.families.flatMap((family) => family.styles)
    .find((candidate) => candidate.commerce.priceAtomic === 123);
  assert.ok(product);
  assert.equal(product.supply.mode, 'OPEN_EDITION');
});

test('synchronization never carries attestations across access, rights, rules, supply or identity changes', () => {
  const document = fixture();
  enableWardrobeParts(document);

  const v6 = document.extensions.composableV6.items
    .find((product) => product.id === 'official:body:base:default:v1');
  v6.requires = ['another-product'];
  v6.rightsOrigin = 'ONCHAIN_NATIVE';
  v6.rightsManifestHash = OTHER_HASH;
  v6.access = {
    mode: 'PAID_ONCE',
    binding: 'OWNED',
    priceAtomic: 99,
    transferable: true,
  };
  v6.validation = { passed: true, attestationId: 'stale-v6', epoch: 9 };
  v6.certification = { certifier: '0xabc', ownershipEpoch: 9 };
  v6.manifestBlobId = 'stale-v6-blob';
  v6.manifestHash = OTHER_HASH;

  const physical = getPhysicalStyleCatalogV7Draft(document);
  const v7 = physical.families.flatMap((family) => family.styles)
    .find((product) => product.id === 'style-product:body:base:default:v1');
  v7.supply = { mode: 'OPEN_EDITION', cap: null, minted: 4 };
  v7.commerce.priceAtomic = 777;
  v7.rights = { origin: 'ONCHAIN_NATIVE', manifestHash: OTHER_HASH };
  v7.validation = { passed: true, attestationId: 'stale-v7', epoch: 9 };
  v7.certification = { certifier: '0xabc', ownershipEpoch: 9 };
  v7.manifestBlobId = 'stale-v7-blob';
  v7.manifestHash = OTHER_HASH;
  document.extensions.physicalStyleCatalogV7 = physical;

  synchronizeMakerWardrobeV7(document, { profileId: 'profile-one' });

  const nextV6 = getMakerComposableV6Draft(document).items
    .find((product) => product.id === 'official:body:base:default:v1');
  assert.deepEqual(nextV6.requires, []);
  assert.equal(nextV6.access.mode, 'EMBEDDED');
  assert.equal(nextV6.access.binding, 'EMBEDDED');
  assert.equal(nextV6.rightsOrigin, 'LICENSE_WRAPPED');
  assert.equal(nextV6.validation.passed, false);
  assert.equal(nextV6.certification, null);
  assert.equal(nextV6.manifestBlobId, '');
  assert.equal(nextV6.manifestHash, '');

  const nextV7 = getPhysicalStyleCatalogV7Draft(document)
    .families.flatMap((family) => family.styles)
    .find((product) => product.id === 'style-product:body:base:default:v1');
  assert.equal(nextV7.supply.mode, 'OPEN_EDITION');
  assert.equal(nextV7.supply.minted, 4);
  assert.equal(nextV7.commerce.priceAtomic, 777);
  assert.equal(nextV7.rights.origin, 'ONCHAIN_NATIVE');
  assert.equal(nextV7.validation.passed, false);
  assert.equal(nextV7.certification.certifier, '');
  assert.equal(nextV7.certification.ownershipEpoch, 0);
  assert.equal(nextV7.manifestBlobId, '');
  assert.equal(nextV7.manifestHash, '');

  const identityDocument = fixture();
  enableWardrobeParts(identityDocument);
  const identityCatalog = getPhysicalStyleCatalogV7Draft(identityDocument);
  const identityProduct = identityCatalog.families[0].styles[0];
  identityProduct.v6ProductId = 'third-party:spoofed-v6-product';
  identityProduct.validation = { passed: true, attestationId: 'stale-identity', epoch: 3 };
  identityProduct.certification = { certifier: '0xabc', ownershipEpoch: 3 };
  identityProduct.manifestBlobId = 'stale-identity-blob';
  identityProduct.manifestHash = OTHER_HASH;
  identityDocument.extensions.physicalStyleCatalogV7 = identityCatalog;
  synchronizeMakerWardrobeV7(identityDocument, { profileId: 'profile-one' });
  const rebuiltIdentity = getPhysicalStyleCatalogV7Draft(identityDocument)
    .families.flatMap((family) => family.styles)
    .find((product) => product.id === identityProduct.id);
  assert.equal(rebuiltIdentity.v6ProductId, 'official:body:base:default:v1');
  assert.equal(rebuiltIdentity.validation.passed, false);
  assert.equal(rebuiltIdentity.certification.certifier, '');
  assert.equal(rebuiltIdentity.certification.ownershipEpoch, 0);
  assert.equal(rebuiltIdentity.manifestHash, '');
});

test('each immutable product field independently invalidates old attestations', () => {
  const v6Cases = [
    ['asset', (product) => { product.components[0].assetHash = OTHER_HASH; }],
    ['placement', (product) => { product.components[0].transform.x = 91; }],
    ['rules', (product) => { product.requires = ['another-product']; }],
    ['access', (product) => {
      product.access = {
        mode: 'PAID_ONCE', binding: 'OWNED', priceAtomic: 99, transferable: true,
      };
    }],
    ['rights', (product) => { product.rightsOrigin = 'ONCHAIN_NATIVE'; }],
  ];
  v6Cases.forEach(([label, mutate]) => {
    const document = fixture();
    enableWardrobeParts(document);
    const product = document.extensions.composableV6.items[0];
    mutate(product);
    product.validation = { passed: true, attestationId: `stale-v6-${label}`, epoch: 7 };
    product.certification = { certifier: '0xabc', ownershipEpoch: 7 };
    product.manifestBlobId = `stale-v6-${label}-blob`;
    product.manifestHash = OTHER_HASH;

    synchronizeMakerWardrobeV7(document, { profileId: 'profile-one' });

    const rebuilt = getMakerComposableV6Draft(document).items
      .find((candidate) => candidate.id === 'official:body:base:default:v1');
    assert.equal(rebuilt.validation.passed, false, `v6 ${label}`);
    assert.equal(rebuilt.certification, null, `v6 ${label}`);
    assert.equal(rebuilt.manifestHash, '', `v6 ${label}`);
  });

  const v7Cases = [
    ['asset', (product) => { product.exactPng.contentHash = OTHER_HASH; }],
    ['placement', (product) => { product.placement.x = 91; }],
    ['supply identity', (product) => {
      product.supply = { mode: 'LIMITED_EDITION', cap: 25, minted: 3 };
    }],
    ['rights', (product) => { product.rights.origin = 'ONCHAIN_NATIVE'; }],
    ['product identity', (product) => { product.v6ProductId = 'third-party:replacement:v1'; }],
  ];
  v7Cases.forEach(([label, mutate]) => {
    const document = fixture();
    enableWardrobeParts(document);
    const catalog = getPhysicalStyleCatalogV7Draft(document);
    const product = catalog.families[0].styles[0];
    mutate(product);
    product.validation = { passed: true, attestationId: `stale-v7-${label}`, epoch: 7 };
    product.certification = { certifier: '0xabc', ownershipEpoch: 7 };
    product.manifestBlobId = `stale-v7-${label}-blob`;
    product.manifestHash = OTHER_HASH;
    document.extensions.physicalStyleCatalogV7 = catalog;

    synchronizeMakerWardrobeV7(document, { profileId: 'profile-one' });

    const rebuilt = getPhysicalStyleCatalogV7Draft(document)
      .families.flatMap((family) => family.styles)
      .find((candidate) => candidate.id === 'style-product:body:base:default:v1');
    assert.equal(rebuilt.validation.passed, false, `v7 ${label}`);
    assert.equal(rebuilt.certification.certifier, '', `v7 ${label}`);
    assert.equal(rebuilt.manifestHash, '', `v7 ${label}`);
  });
});

test('non-Official products cannot occupy official identities and synchronization removes duplicates', () => {
  const document = fixture();
  enableWardrobeParts(document);

  const v6Official = structuredClone(document.extensions.composableV6.items[0]);
  document.extensions.composableV6.items.push(
    {
      ...structuredClone(v6Official),
      originClass: 'OPEN',
      id: v6Official.id.toUpperCase(),
    },
    {
      ...structuredClone(v6Official),
      originClass: 'OPEN',
      id: 'third-party:shared:v1',
    },
    {
      ...structuredClone(v6Official),
      originClass: 'CERTIFIED',
      id: 'third-party:shared:v1',
    },
  );

  const physical = getPhysicalStyleCatalogV7Draft(document);
  const officialStyle = structuredClone(physical.families[0].styles[0]);
  const thirdPartyBase = {
    ...officialStyle,
    admissionClass: STYLE_PRODUCT_ADMISSION_CLASSES.OPEN,
    creator: '0xdef',
    publisher: '0xdef',
  };
  physical.families.push({
    ...structuredClone(physical.families[0]),
    id: 'family:third-party:test',
    styles: [
      {
        ...structuredClone(thirdPartyBase),
        id: officialStyle.id,
        v6ProductId: 'third-party:v6:collision',
      },
      {
        ...structuredClone(thirdPartyBase),
        id: 'OFFICIAL:spoofed-style:v1',
        v6ProductId: 'third-party:v6:reserved-id',
      },
      {
        ...structuredClone(thirdPartyBase),
        id: 'style-product:third-party:reserved-v6:v1',
        v6ProductId: officialStyle.v6ProductId,
      },
      {
        ...structuredClone(thirdPartyBase),
        id: 'style-product:third-party:shared:v1',
        v6ProductId: 'third-party:v6:shared',
      },
      {
        ...structuredClone(thirdPartyBase),
        id: 'style-product:third-party:shared:v1',
        v6ProductId: 'third-party:v6:second',
      },
    ],
  });
  document.extensions.physicalStyleCatalogV7 = physical;

  const result = synchronizeMakerWardrobeV7(document, { profileId: 'profile-one' });
  const nextV6 = getMakerComposableV6Draft(document).items;
  const nextCatalog = getPhysicalStyleCatalogV7Draft(document);
  const nextStyles = nextCatalog.families.flatMap((family) => family.styles);

  assert.equal(new Set(nextV6.map((product) => product.id)).size, nextV6.length);
  assert.ok(nextV6.every((product) => (
    product.originClass === 'OFFICIAL'
    || !product.id.toLowerCase().startsWith('official:')
  )));
  assert.equal(nextV6.filter((product) => product.id === v6Official.id).length, 1);
  assert.equal(new Set(nextStyles.map((product) => product.id)).size, nextStyles.length);
  assert.equal(new Set(nextStyles.map((product) => product.v6ProductId)).size, nextStyles.length);
  assert.ok(nextStyles.every((product) => (
    product.admissionClass === STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL
    || (
      !product.id.toLowerCase().startsWith('official:')
      && !product.v6ProductId.toLowerCase().startsWith('official:')
    )
  )));
  assert.equal(nextStyles.filter((product) => product.id === officialStyle.id).length, 1);
  assert.ok(result.issues.some((entry) => entry.code === 'wardrobe_reserved_official_product_id'));
  assert.ok(result.issues.some((entry) => entry.code === 'wardrobe_duplicate_item_product_id'));
  assert.ok(result.issues.some((entry) => entry.code === 'wardrobe_official_product_id_collision'));
  assert.ok(result.issues.some((entry) => entry.code === 'wardrobe_duplicate_style_product_id'));
});

test('Smart Color is not silently assetized and disabling restores fixed behavior', () => {
  const document = fixture();
  document.parts[1].items[0].styles[0].colorChannelId = 'hair-color';
  const result = enableWardrobeParts(document);
  assert.ok(result.issues.some((entry) => entry.code === 'wardrobe_smart_color_bake_required'));
  assert.equal(getMakerComposableV6Draft(document).items.length, 1);
  assert.equal(getPhysicalStyleCatalogV7Draft(document).families.length, 1);

  setMakerWardrobeV7Enabled(document, false);
  assert.equal(getMakerComposableV6Draft(document).profile.mode, COMPOSABLE_PROFILE_MODES.FIXED);
  const catalog = getPhysicalStyleCatalogV7Draft(document);
  assert.equal(catalog.enabled, false);
  assert.ok(catalog.partPolicies.every((policy) => policy.behavior === PHYSICAL_PART_BEHAVIORS.FIXED));
});

test('a sealed release snapshot is detached and idempotent when wardrobe semantics are unchanged', () => {
  const document = fixture();
  enableWardrobeParts(document);
  const sourceJson = JSON.stringify(document);

  const release = createMakerWardrobeV7ReleaseSnapshot(document, {
    profileId: 'profile-one',
    rendererVersion: 'renderer-v7',
  });

  assert.deepEqual(release.issues, []);
  assert.equal(JSON.stringify(document), sourceJson, 'release derivation must not mutate the draft');
  assert.notEqual(release.document, document);
  assert.equal(getMakerComposableV6Draft(document).compatibilitySealed, false);
  assert.equal(getMakerComposableV6Draft(release.document).compatibilitySealed, true);

  const sealedJson = JSON.stringify(release.document);
  const synchronized = synchronizeMakerWardrobeV7(release.document, {
    profileId: 'profile-one',
    rendererVersion: 'renderer-v7',
  });
  assert.deepEqual(synchronized.issues, []);
  assert.equal(JSON.stringify(release.document), sealedJson);
  assert.equal(getMakerComposableV6Draft(release.document).compatibilitySealed, true);
});

test('a sealed wardrobe rejects semantic drift but ignores unrelated Maker metadata changes', () => {
  const document = fixture();
  enableWardrobeParts(document);
  const release = createMakerWardrobeV7ReleaseSnapshot(document, {
    profileId: 'profile-one',
  });
  assert.deepEqual(release.issues, []);

  release.document.metadata.summary = 'A new public summary does not change wardrobe semantics.';
  assert.deepEqual(
    synchronizeMakerWardrobeV7(release.document, { profileId: 'profile-one' }).issues,
    [],
  );

  release.document.parts[1].items[0].styles[0].transform.x += 1;
  const changed = synchronizeMakerWardrobeV7(release.document, { profileId: 'profile-one' });
  assert.equal(changed.issues.length, 1);
  assert.equal(changed.issues[0].code, 'wardrobe_compatibility_locked');
  assert.equal(getMakerComposableV6Draft(release.document).compatibilitySealed, true);
});

test('release source identity changes with draft bytes or derivation context', () => {
  const document = fixture();
  const first = makerWardrobeV7ReleaseSourceIdentity(document, {
    profileId: 'profile-one',
    rendererVersion: 'renderer-v7',
  });
  const unchangedClone = makerWardrobeV7ReleaseSourceIdentity(structuredClone(document), {
    profileId: 'profile-one',
    rendererVersion: 'renderer-v7',
  });
  assert.equal(unchangedClone, first);

  document.parts[0].name = 'Body v2';
  assert.notEqual(makerWardrobeV7ReleaseSourceIdentity(document, {
    profileId: 'profile-one',
    rendererVersion: 'renderer-v7',
  }), first);
  assert.notEqual(makerWardrobeV7ReleaseSourceIdentity(structuredClone(document), {
    profileId: 'profile-two',
    rendererVersion: 'renderer-v7',
  }), first);
});
