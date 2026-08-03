import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ITEM_FAMILY_V7_SCHEMA,
  PHYSICAL_STYLE_CATALOG_V7_SCHEMA,
  STYLE_ASSET_KINDS,
  STYLE_PRODUCT_ADMISSION_CLASSES,
  STYLE_PRODUCT_PLAYER_STATES,
  STYLE_PRODUCT_RIGHTS_ORIGINS,
  STYLE_PRODUCT_SUPPLY_MODES,
  THIRD_PARTY_STYLE_PRODUCT_PACKAGE_V7_SCHEMA,
  collectPhysicalStyleCatalogV7Issues,
  collectThirdPartyStyleProductPackageV7Issues,
  createPhysicalStyleCatalogPublicationV7,
  createThirdPartyStyleProductPackageV7,
  createStyleAssetV7,
  createStyleProductV7,
  derivePhysicalStylePlayerCatalogV7,
  hashPhysicalStyleCatalogPublicationV7,
} from '../maker-physical-v7.js';
import {
  addMakerStyleProductV7,
  collectPhysicalStyleCatalogDocumentIssuesV7,
  createPhysicalStyleCatalogV7DraftForDocument,
  getPhysicalStyleCatalogV7Draft,
  inspectPhysicalStyleCatalogManifestV7,
  createThirdPartyStyleProductTemplateV7,
  importThirdPartyStyleProductPackageV7,
  setPhysicalStyleCatalogV7Draft,
  updateStyleProductV7,
} from '../maker-physical-v7-workspace.js';
import {
  PHYSICAL_STYLE_V7_DICTIONARIES,
  physicalStyleV7Text,
} from '../maker-physical-v7-i18n.js';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const MAKER = 'maker-root';
const PROFILE = 'profile-1';

function documentFixture() {
  return {
    schemaVersion: 'animacraft.maker.v5',
    version: { rootMakerId: MAKER },
    metadata: { creator: '0xabc' },
    assets: [{
      id: 'hair-blue-png',
      blobId: 'walrus-blue-png',
      contentHash: HASH_A,
      width: 1024,
      height: 1024,
    }],
    layerTracks: [{ id: 'hair-front', order: 1 }],
    parts: [{
      id: 'hair',
      name: 'Hair',
      items: [{
        id: 'long-hair',
        name: 'Long Hair',
        styles: [{
          id: 'blue',
          name: 'Ocean Blue',
          assetId: 'hair-blue-png',
          layerTrackId: 'hair-front',
          transform: { x: 10, y: 20, scale: 0.8, rotation: 0 },
          opacity: 1,
          blendMode: 'normal',
        }],
      }],
    }],
    extensions: {
      composableV6: {
        profile: { mode: 'COMPOSABLE' },
        compatibility: {
          makerRootId: MAKER,
          manifestHash: HASH_B,
        },
      },
    },
  };
}

function draftFixture() {
  const document = documentFixture();
  let catalog = createPhysicalStyleCatalogV7DraftForDocument(document, {
    makerRootId: MAKER,
    profileId: PROFILE,
    compatibilityHash: HASH_B,
    certified: true,
    open: true,
  });
  catalog = addMakerStyleProductV7(catalog, {
    document,
    partId: 'hair',
    itemId: 'long-hair',
    styleId: 'blue',
    creator: '0xabc',
    publisher: '0xabc',
    rightsOrigin: STYLE_PRODUCT_RIGHTS_ORIGINS.ONCHAIN_NATIVE,
    rightsManifestHash: HASH_A,
  }).catalog;
  return { document, catalog };
}

function publishableCatalog() {
  const { catalog } = draftFixture();
  catalog.families[0].styles[0] = createStyleProductV7({
    ...catalog.families[0].styles[0],
    validation: { passed: true, attestationId: 'attestation-1', epoch: 1 },
    manifestBlobId: 'walrus-manifest',
    manifestHash: HASH_B,
  });
  return catalog;
}

test('models Part -> Item Family -> exact Style Product without Smart Color', () => {
  const { catalog } = draftFixture();
  assert.equal(catalog.families.length, 1);
  const family = catalog.families[0];
  assert.equal(family.schemaVersion, ITEM_FAMILY_V7_SCHEMA);
  assert.equal(family.targetPartId, 'hair');
  assert.equal(family.name, 'Long Hair');
  assert.equal(family.styles.length, 1);
  const product = family.styles[0];
  assert.equal(product.name, 'Ocean Blue');
  assert.equal(product.exactPng.assetId, 'hair-blue-png');
  assert.equal(product.exactPng.width, 1024);
  assert.equal(product.baseSource.styleId, 'blue');
  assert.doesNotMatch(JSON.stringify(product), /smart.?color|colorChannel|swatches/i);
});

test('rejects Smart Color asset fields and invalid Included/Limited supply', () => {
  const catalog = publishableCatalog();
  const raw = structuredClone(catalog);
  raw.families[0].styles[0].smartColor = { channelId: 'hair-color' };
  raw.families[0].styles[0].commerce.priceAtomic = 5;
  raw.families[0].styles[0].supply = {
    mode: STYLE_PRODUCT_SUPPLY_MODES.LIMITED_EDITION,
    cap: 2,
    minted: 3,
  };
  const issues = collectPhysicalStyleCatalogV7Issues(raw, { publish: true });
  assert.ok(issues.some((entry) => entry.code === 'smart_color_not_assetized'));
  assert.ok(issues.some((entry) => entry.code === 'minted_exceeds_cap'));

  raw.families[0].styles[0].supply.mode = STYLE_PRODUCT_SUPPLY_MODES.INCLUDED;
  const includedIssues = collectPhysicalStyleCatalogV7Issues(raw, { publish: false });
  assert.ok(includedIssues.some((entry) => entry.code === 'included_product_must_be_free'));
});

test('publication projection is exact, deterministic and strips local asset IDs and live minted counters', async () => {
  const catalog = publishableCatalog();
  catalog.families[0].styles[0].supply = {
    mode: STYLE_PRODUCT_SUPPLY_MODES.LIMITED_EDITION,
    cap: 100,
    minted: 41,
  };
  const projection = createPhysicalStyleCatalogPublicationV7(catalog);
  assert.equal(projection.schemaVersion, PHYSICAL_STYLE_CATALOG_V7_SCHEMA);
  const product = projection.families[0].styles[0];
  assert.equal(product.exactPng.assetId, '');
  assert.equal(product.supply.minted, 0);
  assert.equal(product.exactPng.contentHash, HASH_A);
  assert.equal(await hashPhysicalStyleCatalogPublicationV7(catalog), await hashPhysicalStyleCatalogPublicationV7(structuredClone(catalog)));
});

test('player catalog distinguishes Included, Owned, purchasable and sold out concrete Styles', () => {
  const catalog = publishableCatalog();
  const base = catalog.families[0].styles[0];
  catalog.families[0].styles = [
    base,
    createStyleProductV7({
      ...base,
      id: 'style-product:hair:long-hair:red:v1',
      name: 'Signal Red',
      supply: { mode: STYLE_PRODUCT_SUPPLY_MODES.OPEN_EDITION, minted: 9 },
      commerce: { ...base.commerce, priceAtomic: 2_000_000 },
    }),
    createStyleProductV7({
      ...base,
      id: 'style-product:hair:long-hair:gold:v1',
      name: 'One Gold',
      supply: { mode: STYLE_PRODUCT_SUPPLY_MODES.LIMITED_EDITION, cap: 1, minted: 1 },
      commerce: { ...base.commerce, priceAtomic: 9_000_000 },
    }),
  ];
  const player = derivePhysicalStylePlayerCatalogV7({
    catalog,
    releaseEnabled: true,
    entitlements: [{ productId: 'style-product:hair:long-hair:red:v1' }],
  });
  const cards = player[0].families[0].styles;
  assert.deepEqual(cards.map((card) => card.state), [
    STYLE_PRODUCT_PLAYER_STATES.INCLUDED,
    STYLE_PRODUCT_PLAYER_STATES.OWNED,
    STYLE_PRODUCT_PLAYER_STATES.SOLD_OUT,
  ]);
  assert.equal(cards[0].canEquip, true);
  assert.equal(cards[1].canEquip, true);
  assert.equal(cards[2].canPurchase, false);

  const notOwned = derivePhysicalStylePlayerCatalogV7({ catalog, releaseEnabled: true });
  assert.equal(notOwned[0].families[0].styles[1].state, STYLE_PRODUCT_PLAYER_STATES.FOR_SALE);
});

test('StyleAsset records distinguish Soul-local defaults from withdrawable owned assets', () => {
  const local = createStyleAssetV7({ id: 'local-1', productId: 'blue', kind: STYLE_ASSET_KINDS.SOUL_LOCAL, soulId: '0xsoul' });
  const owned = createStyleAssetV7({ id: 'owned-1', productId: 'red', kind: STYLE_ASSET_KINDS.OWNED, ownerAddress: '0xabc' });
  assert.equal(local.kind, STYLE_ASSET_KINDS.SOUL_LOCAL);
  assert.equal(owned.kind, STYLE_ASSET_KINDS.OWNED);
});

test('document bridge persists v7 independently and detects changed exact PNG sources', () => {
  const { document, catalog } = draftFixture();
  setPhysicalStyleCatalogV7Draft(document, catalog);
  assert.equal(getPhysicalStyleCatalogV7Draft(document).families.length, 1);
  assert.equal(collectPhysicalStyleCatalogDocumentIssuesV7(document).length, 0);
  document.parts[0].items[0].styles[0].assetId = 'replacement-png';
  assert.ok(collectPhysicalStyleCatalogDocumentIssuesV7(document)
    .some((entry) => entry.code === 'base_style_png_changed'));
  assert.ok(document.extensions.composableV6, 'v6 companion remains untouched');
});

test('fixed-color Style Products reject Smart Color at creation and after later relinking', () => {
  const document = documentFixture();
  const catalog = createPhysicalStyleCatalogV7DraftForDocument(document, {
    makerRootId: MAKER,
    profileId: PROFILE,
    compatibilityHash: HASH_B,
    certified: true,
    open: true,
  });
  document.parts[0].items[0].styles[0].colorChannelId = 'hair-color';
  assert.throws(
    () => addMakerStyleProductV7(catalog, {
      document,
      partId: 'hair',
      itemId: 'long-hair',
      styleId: 'blue',
    }),
    (error) => error.code === 'PHYSICAL_V7_SMART_COLOR_MUST_BE_BAKED'
      && /Bake the exact current color/.test(error.message),
  );

  document.parts[0].items[0].styles[0].colorChannelId = null;
  const created = addMakerStyleProductV7(catalog, {
    document,
    partId: 'hair',
    itemId: 'long-hair',
    styleId: 'blue',
  }).catalog;
  setPhysicalStyleCatalogV7Draft(document, created);
  document.parts[0].items[0].styles[0].colorChannelId = 'hair-color';
  assert.ok(collectPhysicalStyleCatalogDocumentIssuesV7(document)
    .some((entry) => entry.code === 'base_style_uses_smart_color'));
});

test('independent third-party creator can prepare and Maker can admit one exact Style package', () => {
  const { catalog, document } = draftFixture();
  const template = createThirdPartyStyleProductTemplateV7(catalog, {
    targetPartId: 'hair',
    creator: '0xabc',
  });
  assert.equal(template.schemaVersion, THIRD_PARTY_STYLE_PRODUCT_PACKAGE_V7_SCHEMA);
  assert.equal(template.authoring.independent, true);
  assert.ok(collectThirdPartyStyleProductPackageV7Issues(template)
    .some((entry) => entry.code === 'missing_png_dimensions'));

  const supplier = createThirdPartyStyleProductPackageV7({
    ...template,
    authoring: { independent: true, template: false },
    family: {
      ...template.family,
      id: 'family:third-party:hair:braid',
      name: 'Braid',
    },
    product: {
      ...template.product,
      id: 'style-product:third-party:hair:braid-red:v1',
      familyId: 'family:third-party:hair:braid',
      name: 'Braid · fixed red',
      creator: '0xabc',
      publisher: '0xabc',
      admissionClass: STYLE_PRODUCT_ADMISSION_CLASSES.OPEN,
      exactPng: {
        assetId: '',
        blobId: 'walrus-third-party-red',
        contentHash: HASH_A,
        mediaType: 'image/png',
        width: 1024,
        height: 1024,
      },
      placement: {
        layerTrackId: 'hair-front',
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
        opacity: 1,
        blendMode: 'normal',
      },
      supply: { mode: STYLE_PRODUCT_SUPPLY_MODES.OPEN_EDITION },
      commerce: { ...template.product.commerce, priceAtomic: 1_000_000 },
      rights: { origin: STYLE_PRODUCT_RIGHTS_ORIGINS.LICENSE_WRAPPED, manifestHash: HASH_B },
    },
  });
  assert.deepEqual(collectThirdPartyStyleProductPackageV7Issues(supplier), []);
  const imported = importThirdPartyStyleProductPackageV7(catalog, supplier, { document });
  assert.equal(imported.productId, 'style-product:third-party:hair:braid-red:v1');
  assert.equal(imported.catalog.families.at(-1).name, 'Braid');
  assert.equal(imported.catalog.families.at(-1).styles[0].baseSource, null);
});

test('third-party supply rejects Maker-local assets, Smart Color, Official claims and target drift', () => {
  const { catalog } = draftFixture();
  const template = createThirdPartyStyleProductTemplateV7(catalog, { targetPartId: 'hair' });
  const malformed = structuredClone(template);
  malformed.product.exactPng = {
    assetId: 'maker-local',
    blobId: 'walrus-exact',
    contentHash: HASH_A,
    mediaType: 'image/png',
    width: 1024,
    height: 1024,
  };
  malformed.product.placement.layerTrackId = 'hair-front';
  malformed.product.admissionClass = STYLE_PRODUCT_ADMISSION_CLASSES.OFFICIAL;
  malformed.product.smartColor = { channelId: 'hair-color' };
  const issues = collectThirdPartyStyleProductPackageV7Issues(malformed);
  assert.ok(issues.some((entry) => entry.code === 'maker_local_asset_forbidden'));
  assert.ok(issues.some((entry) => entry.code === 'official_supplier_forbidden'));
  assert.ok(issues.some((entry) => entry.code === 'smart_color_not_assetized'));

  const validShape = structuredClone(malformed);
  validShape.product.exactPng.assetId = '';
  validShape.product.admissionClass = STYLE_PRODUCT_ADMISSION_CLASSES.OPEN;
  delete validShape.product.smartColor;
  validShape.target.compatibilityHash = HASH_B;
  validShape.family.id = 'family:external';
  validShape.family.name = 'External';
  validShape.product.familyId = 'family:external';
  validShape.product.id = 'style-product:external:red:v1';
  validShape.product.name = 'External red';
  validShape.product.rights.manifestHash = HASH_A;
  validShape.product.creator = '0xabc';
  validShape.product.publisher = '0xabc';
  validShape.target.profileId = 'different-profile';
  validShape.product.targetProfileId = 'different-profile';
  validShape.family.targetProfileId = 'different-profile';
  assert.throws(
    () => importThirdPartyStyleProductPackageV7(catalog, validShape),
    (error) => error.code === 'PHYSICAL_V7_SUPPLIER_TARGET_MISMATCH',
  );

  validShape.target.profileId = PROFILE;
  validShape.product.targetProfileId = PROFILE;
  validShape.family.targetProfileId = PROFILE;
  validShape.product.placement.layerTrackId = 'not-a-maker-track';
  assert.throws(
    () => importThirdPartyStyleProductPackageV7(catalog, validShape, {
      document: documentFixture(),
    }),
    (error) => error.code === 'PHYSICAL_V7_SUPPLIER_TRACK_INCOMPATIBLE',
  );
});

test('catalog manifest inspection, product editing and i18n are usable without a chain executor', () => {
  const { catalog } = draftFixture();
  const edited = updateStyleProductV7(catalog, catalog.families[0].styles[0].id, {
    admissionClass: STYLE_PRODUCT_ADMISSION_CLASSES.OPEN,
    supply: { mode: STYLE_PRODUCT_SUPPLY_MODES.OPEN_EDITION },
    commerce: { priceAtomic: 1_000_000, creatorRoyaltyBps: 500 },
  });
  assert.equal(edited.product.admissionClass, STYLE_PRODUCT_ADMISSION_CLASSES.OPEN);
  assert.equal(edited.product.commerce.creatorRoyaltyBps, 500);
  const inspection = inspectPhysicalStyleCatalogManifestV7(JSON.stringify(edited.catalog));
  assert.equal(inspection.valid, true);
  assert.equal(physicalStyleV7Text('zh', 'physicalPlayerTitle'), '样式商品');
  assert.match(physicalStyleV7Text('en', 'exactStyleProducts', { count: 3 }), /3/);
  const englishKeys = Object.keys(PHYSICAL_STYLE_V7_DICTIONARIES.en).sort();
  Object.entries(PHYSICAL_STYLE_V7_DICTIONARIES).forEach(([locale, dictionary]) => {
    assert.deepEqual(Object.keys(dictionary).sort(), englishKeys, `${locale} dictionary must own every v7 key`);
  });
});
