import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPLETION_MODES,
  MAKER_ACCESS_MODES,
  PACK_ACCESS_MODES,
  RIGHTS_ORIGINS,
  createDefaultMakerCommerceV5,
  createPackCommercePolicyV5,
} from '../maker-commerce-v5.js';
import { createMakerV5Document } from '../maker-v4.js';
import { evaluateRecipe } from '../maker-rules.js';
import {
  MAKER_V4_COMMERCE_PROJECTION_V5_SCHEMA,
  MAKER_V4_ITEM_KEY_ENCODING_V2,
  MAKER_V4_MOVE_PROJECTION_V2_SCHEMA,
  MAKER_V4_NEUTRAL_COLOR,
  MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER,
  MakerV4PublicationError,
  buildMakerV4MoveSummaryV2,
  buildMakerV4OcPackage,
  buildMakerV4PublicationManifest,
  compileMakerV4MoveProjectionV2,
  createMakerV4ProjectionV2AuxiliaryEntry,
  flattenMakerV4RecipeV2,
} from '../maker-publication-v4.js';

const LOGICAL_AUXILIARY_BLOB_ID = 'protocol-logical-auxiliary-blob';

function style(id, displayOrder, trackId, assetId, extra = {}) {
  return {
    id,
    name: id,
    displayOrder,
    assetId,
    layerTrackId: trackId,
    colorChannelId: null,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    positionConfirmed: true,
    positionLocked: false,
    styleLocked: false,
    opacity: 1,
    blendMode: 'normal',
    visibleWhen: null,
    requires: [],
    excludes: [],
    ...extra,
  };
}

function item(id, displayOrder, styles, extra = {}) {
  return {
    id,
    name: id,
    displayOrder,
    importKey: id,
    status: 'public',
    thumbnailAssetId: null,
    visibleWhen: null,
    requires: [],
    excludes: [],
    defaultStyleId: styles[0].id,
    styles,
    ...extra,
  };
}

function part(id, menuOrder, required, items, extra = {}) {
  return {
    id,
    name: id,
    menuOrder,
    menuVisible: true,
    required,
    defaultItemId: items[0].id,
    parentPartId: null,
    iconAssetId: null,
    visibleWhen: null,
    requires: [],
    excludes: [],
    items,
    ...extra,
  };
}

function pngAsset(id) {
  return {
    id,
    identifier: `${id}.png`,
    kind: 'layer',
    mediaType: 'image/png',
    width: 1024,
    height: 1024,
  };
}

function makerCoverAsset(id = 'maker-cover') {
  return {
    ...pngAsset(id),
    kind: 'maker-cover',
  };
}

function swatch(id, hintColor) {
  return {
    id,
    name: id,
    hintColor,
    stops: [
      { offset: 0, color: '#000000' },
      { offset: 1, color: '#ffffff' },
    ],
  };
}

function makePublishableMetadata(document, coverAssetId) {
  document.metadata.license.note = 'Test publication license.';
  const dedicatedCoverAssetId = `${coverAssetId}-maker-cover`;
  if (!document.assets.some((asset) => asset.id === dedicatedCoverAssetId)) {
    document.assets.push(makerCoverAsset(dedicatedCoverAssetId));
  }
  document.metadata.coverAssetId = dedicatedCoverAssetId;
  return document;
}

function projectionMaker() {
  const document = createMakerV5Document({
    makerId: 'projection-maker',
    name: 'Projection Maker',
    creator: 'Animacraft',
  });
  document.metadata.summary = 'Projection v2 test fixture.';
  document.metadata.license.note = 'Test publication license.';
  document.metadata.coverAssetId = 'projection-maker-cover';
  // Track order deliberately differs from recipe/menu order.
  document.layerTracks = [
    { id: 'body-track', name: 'Body', order: 1, locked: true, referenceAssetId: null },
    { id: 'hat-track', name: 'Hat', order: 0, locked: true, referenceAssetId: null },
  ];
  document.assets = [
    makerCoverAsset('projection-maker-cover'),
    pngAsset('body-base'),
    pngAsset('body-armored'),
    pngAsset('hat-plain'),
    pngAsset('hat-star'),
  ];
  document.colorChannels = [{
    id: 'skin',
    name: 'Skin',
    order: 0,
    mode: 'gradient-map',
    defaultSwatchId: 'warm',
    swatches: [
      swatch('warm', '#d68f72'),
      swatch('cool', '#b9c8df'),
    ],
  }];
  document.parts = [
    part('body', 0, true, [
      item('shape', 0, [
        style('base', 0, 'body-track', 'body-base', { colorChannelId: 'skin' }),
        style('armored', 1, 'body-track', 'body-armored', { colorChannelId: 'skin' }),
      ]),
    ]),
    part('hat', 1, false, [
      item('cap', 0, [
        style('plain', 0, 'hat-track', 'hat-plain'),
        style('star', 1, 'hat-track', 'hat-star'),
      ]),
    ]),
  ];
  document.defaultRecipe = {
    selections: [
      { partId: 'body', itemId: 'shape', styleId: 'base' },
      { partId: 'hat', itemId: 'cap', styleId: 'plain' },
    ],
    colors: [{ channelId: 'skin', swatchId: 'warm' }],
  };
  return document;
}

function optionalExpansionPack({ packId, namespace, partId }) {
  const itemId = `${partId}-item`;
  return {
    schemaVersion: 'animacraft.expansion-pack.v1',
    packId,
    namespace,
    name: packId,
    version: '1.0.0',
    baseMakerId: 'projection-maker',
    baseVersion: '1',
    layerTracks: [],
    colorChannels: [],
    assets: [pngAsset('hat-plain')],
    rules: [],
    parts: [{
      id: partId,
      name: partId,
      menuOrder: 0,
      menuVisible: true,
      required: false,
      defaultItemId: itemId,
      parentPartId: null,
      iconAssetId: null,
      visibleWhen: null,
      requires: [],
      excludes: [],
      items: [{
        id: itemId,
        name: itemId,
        displayOrder: 0,
        importKey: itemId,
        status: 'public',
        thumbnailAssetId: null,
        visibleWhen: null,
        requires: [],
        excludes: [],
        defaultStyleId: 'default',
        styles: [style('default', 0, 'hat-track', 'hat-plain')],
      }],
    }],
  };
}

function styleExpansionPack({
  packId = 'moon-styles',
  namespace = 'moon',
  styleId = 'moon-trim',
  targetItemId = 'shape',
} = {}) {
  return {
    schemaVersion: 'animacraft.expansion-pack.v1',
    packId,
    namespace,
    name: 'Moon Styles',
    version: '1.0.0',
    baseMakerId: 'projection-maker',
    baseVersion: '1',
    layerTracks: [],
    colorChannels: [],
    assets: [],
    rules: [],
    parts: [{
      extendsPartId: 'body',
      items: [{
        extendsItemId: targetItemId,
        styles: [
          style(styleId, 0, 'body-track', 'body-armored'),
        ],
      }],
    }],
  };
}

function itemExpansionPack({
  packId = 'wardrobe-plus',
  namespace = 'wardrobe',
  itemId = 'coat',
} = {}) {
  return {
    schemaVersion: 'animacraft.expansion-pack.v1',
    packId,
    namespace,
    name: 'Wardrobe Plus',
    version: '1.0.0',
    baseMakerId: 'projection-maker',
    baseVersion: '1',
    layerTracks: [],
    colorChannels: [],
    assets: [],
    rules: [],
    parts: [{
      extendsPartId: 'body',
      items: [{
        id: itemId,
        name: 'Coat',
        displayOrder: 0,
        importKey: itemId,
        status: 'public',
        thumbnailAssetId: null,
        visibleWhen: null,
        requires: [],
        excludes: [],
        defaultStyleId: 'default',
        styles: [style('default', 0, 'body-track', 'body-armored')],
      }],
    }],
  };
}

function commerceForPacks(packPolicies, overrides = {}) {
  const commerce = createDefaultMakerCommerceV5({
    rightsOrigin: RIGHTS_ORIGINS.LICENSE_WRAPPED,
    rightsOriginConfirmed: true,
    makerAccess: {
      mode: MAKER_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 10_000_000,
    },
    baseCompletion: {
      mode: COMPLETION_MODES.FREE_QUOTA_THEN_PAID,
      freeQuotaPerWallet: 3,
      priceAtomic: 1_000_000,
    },
    soulCreatorRoyaltyBps: 100,
    makerSourceRoyaltyBps: 200,
    makerResaleRoyaltyBps: 500,
    ...overrides,
  });
  commerce.packPolicies = packPolicies;
  return commerce;
}

function expectPublicationError(callback, code) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof MakerV4PublicationError);
    assert.equal(error.code, code);
    return true;
  });
}

function projectedConflictsFor(projection, mapping) {
  return projection.rules.filter((rule) => (
    (rule.leftPartKey === mapping.partKey && rule.leftItemKey === mapping.itemKey)
    || (rule.rightPartKey === mapping.partKey && rule.rightItemKey === mapping.itemKey)
  )).map((rule) => (
    rule.leftPartKey === mapping.partKey && rule.leftItemKey === mapping.itemKey
      ? `${rule.rightPartKey}\u0000${rule.rightItemKey}`
      : `${rule.leftPartKey}\u0000${rule.leftItemKey}`
  )).sort();
}

test('projection v2 is complete, bijective, neutral and independent from LayerTrack order', () => {
  const document = projectionMaker();
  const projection = compileMakerV4MoveProjectionV2(document);

  assert.equal(projection.schemaVersion, MAKER_V4_MOVE_PROJECTION_V2_SCHEMA);
  assert.equal(projection.itemKeyEncoding, MAKER_V4_ITEM_KEY_ENCODING_V2);
  assert.equal(projection.authorizationCoverage, 'complete');
  assert.equal(projection.colorCoverage, 'complete');
  assert.deepEqual(projection.paletteLinks, []);
  assert.deepEqual(projection.parts.map((entry) => entry.renderOrder), [0, 1, 2]);
  assert.deepEqual(projection.parts.map((entry) => entry.sourcePartId || entry.sourceChannelId), [
    'body',
    'hat',
    'skin',
  ]);
  assert.ok(projection.parts.every((entry) => entry.required));
  assert.ok(projection.parts.every((entry) => (
    entry.colors.length === 1 && entry.colors[0] === MAKER_V4_NEUTRAL_COLOR
  )));
  assert.equal(projection.mappings.none.some((entry) => entry.partId === 'body'), false);
  assert.equal(projection.mappings.none.some((entry) => entry.partId === 'hat'), true);
  assert.equal(projection.mappings.styles.length, 4);
  assert.equal(new Set(projection.mappings.styles.map((entry) => (
    `${entry.partKey}\u0000${entry.itemKey}`
  ))).size, 4);

  const colorPart = projection.parts.find((entry) => entry.sourceChannelId === 'skin');
  assert.equal(colorPart.menuVisible, false);
  assert.equal(colorPart.projectionKind, 'color-channel');
  assert.deepEqual(
    projection.mappings.colorChannels[0].swatches.map((entry) => entry.swatchId),
    ['warm', 'cool'],
  );
  assert.equal(projection.auxiliary.identifier, MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER);
  assert.equal(projection.auxiliary.projectionOnly, true);
});

test('requires rules cannot be bypassed with a None sentinel and recipes remain exact', () => {
  const document = projectionMaker();
  document.parts[0].items[0].styles[0].requires = [{
    partId: 'hat',
    itemId: 'cap',
    styleIds: ['plain', 'star'],
  }];
  const projection = compileMakerV4MoveProjectionV2(document);
  const body = projection.mappings.styles.find((entry) => (
    entry.partId === 'body' && entry.styleId === 'base'
  ));
  const none = projection.mappings.none.find((entry) => entry.partId === 'hat');
  assert.ok(projection.rules.some((rule) => (
    [rule.leftPartKey, rule.rightPartKey].includes(body.partKey)
    && [rule.leftItemKey, rule.rightItemKey].includes(body.itemKey)
    && [rule.leftPartKey, rule.rightPartKey].includes(none.partKey)
    && [rule.leftItemKey, rule.rightItemKey].includes(none.itemKey)
  )));

  expectPublicationError(() => flattenMakerV4RecipeV2(document, {
    selections: [{ partId: 'body', itemId: 'shape', styleId: 'base' }],
    colors: [{ channelId: 'skin', swatchId: 'warm' }],
  }), 'invalid-maker-recipe');

  const flattened = flattenMakerV4RecipeV2(document, {
    selections: [
      { partId: 'body', itemId: 'shape', styleId: 'armored' },
    ],
    colors: [{ channelId: 'skin', swatchId: 'cool' }],
  });
  assert.equal(flattened.suiRecipe.length, 3);
  assert.deepEqual(flattened.suiRecipe.map((slot) => slot.renderOrder), [0, 1, 2]);
  assert.ok(flattened.suiRecipe.every((slot) => slot.colorHex === MAKER_V4_NEUTRAL_COLOR));
  assert.equal(flattened.suiRecipe[1].itemKey, none.itemKey);
});

test('a required conditional Part uses None only while its unary activation is false', () => {
  const document = projectionMaker();
  document.parts[1].required = true;
  document.parts[1].visibleWhen = {
    op: 'selected',
    partId: 'body',
    itemId: 'shape',
    styleId: 'base',
  };
  const projection = compileMakerV4MoveProjectionV2(document);
  const none = projection.mappings.none.find((entry) => entry.partId === 'hat');
  const base = projection.mappings.styles.find((entry) => (
    entry.partId === 'body' && entry.styleId === 'base'
  ));
  assert.ok(projection.rules.some((rule) => (
    [rule.leftItemKey, rule.rightItemKey].includes(none.itemKey)
    && [rule.leftItemKey, rule.rightItemKey].includes(base.itemKey)
  )));

  expectPublicationError(() => flattenMakerV4RecipeV2(document, {
    selections: [{ partId: 'body', itemId: 'shape', styleId: 'base' }],
    colors: [{ channelId: 'skin', swatchId: 'warm' }],
  }), 'invalid-maker-recipe');

  const inactive = flattenMakerV4RecipeV2(document, {
    selections: [{ partId: 'body', itemId: 'shape', styleId: 'armored' }],
    colors: [{ channelId: 'skin', swatchId: 'warm' }],
  });
  assert.equal(inactive.suiRecipe[1].itemKey, none.itemKey);
});

test('a self-activated required Part does not create a false cross-Part sentinel ban', () => {
  const document = projectionMaker();
  document.parts[1].required = true;
  document.parts[1].visibleWhen = { op: 'selected', partId: 'hat' };
  const projection = compileMakerV4MoveProjectionV2(document);
  const none = projection.mappings.none.find((entry) => entry.partId === 'hat');
  assert.ok(none);
  assert.equal(projection.rules.some((rule) => (
    rule.leftItemKey === none.itemKey || rule.rightItemKey === none.itemKey
  )), false);
});

test('every ColorChannel becomes its own hidden required swatch Part', () => {
  const document = projectionMaker();
  document.colorChannels.push({
    id: 'hair',
    name: 'Hair',
    order: 1,
    mode: 'gradient-map',
    defaultSwatchId: 'ink',
    swatches: [
      swatch('ink', '#111827'),
      swatch('ocean', '#2563eb'),
      swatch('rose', '#e11d48'),
    ],
  });
  document.defaultRecipe.colors.push({ channelId: 'hair', swatchId: 'ink' });
  const projection = compileMakerV4MoveProjectionV2(document);
  assert.equal(projection.mappings.colorChannels.length, 2);
  assert.deepEqual(projection.mappings.colorChannels.map((entry) => entry.channelId), ['skin', 'hair']);
  assert.deepEqual(
    projection.mappings.colorChannels.find((entry) => entry.channelId === 'hair').swatches
      .map((entry) => entry.swatchId),
    ['ink', 'ocean', 'rose'],
  );

  const flattened = flattenMakerV4RecipeV2(document, {
    selections: [
      { partId: 'body', itemId: 'shape', styleId: 'base' },
      { partId: 'hat', itemId: 'cap', styleId: 'plain' },
    ],
    colors: [
      { channelId: 'skin', swatchId: 'cool' },
      { channelId: 'hair', swatchId: 'rose' },
    ],
  });
  assert.equal(flattened.suiRecipe.length, 4);
  assert.ok(flattened.suiRecipe.every((slot) => slot.colorHex === MAKER_V4_NEUTRAL_COLOR));
});

test('all embedded ExpansionPacks define one stable projection independent of Player enablement', () => {
  const document = projectionMaker();
  document.extensions.expansionDrafts = [
    optionalExpansionPack({ packId: 'crown-pack', namespace: 'crown', partId: 'crown' }),
    optionalExpansionPack({ packId: 'aura-pack', namespace: 'aura', partId: 'aura' }),
  ];
  const projection = compileMakerV4MoveProjectionV2(document);
  assert.deepEqual(
    projection.commerce.packPolicies.map((policy) => ({
      packId: policy.packId,
      accessMode: policy.accessMode,
      completionMode: policy.completion.mode,
    })),
    [{
      packId: 'aura-pack',
      accessMode: PACK_ACCESS_MODES.FREE,
      completionMode: COMPLETION_MODES.UNLIMITED_FREE,
    }, {
      packId: 'crown-pack',
      accessMode: PACK_ACCESS_MODES.FREE,
      completionMode: COMPLETION_MODES.UNLIMITED_FREE,
    }],
    'legacy/newly-added Packs without an authored policy normalize to explicit FREE defaults',
  );
  assert.deepEqual(
    projection.parts.map((entry) => entry.sourcePartId || entry.sourceChannelId),
    ['body', 'hat', 'crown__crown', 'aura__aura', 'skin'],
  );
  assert.ok(projection.items
    .filter((entry) => entry.projectionKind === 'style'
      && ['crown__crown', 'aura__aura'].includes(entry.sourcePartId))
    .every((entry) => entry.sourceAssetId === 'hat-plain'));

  const noPack = buildMakerV4OcPackage({
    document,
    recipe: {
      selections: [{ partId: 'body', itemId: 'shape', styleId: 'base' }],
      colors: [{ channelId: 'skin', swatchId: 'warm' }],
    },
  });
  const crownOnly = buildMakerV4OcPackage({
    document,
    recipe: {
      selections: [
        { partId: 'body', itemId: 'shape', styleId: 'base' },
        {
          partId: 'crown__crown',
          itemId: 'crown__crown-item',
          styleId: 'crown__default',
        },
      ],
      colors: [{ channelId: 'skin', swatchId: 'warm' }],
    },
  });
  assert.deepEqual(
    crownOnly.suiRecipe.map((slot) => slot.partKey),
    noPack.suiRecipe.map((slot) => slot.partKey),
  );
  assert.equal(noPack.suiRecipe.length, projection.counts.recipeSlots);
  assert.equal(crownOnly.suiRecipe.length, projection.counts.recipeSlots);
  const crownOrder = projection.parts.find((entry) => entry.sourcePartId === 'crown__crown').renderOrder;
  const auraOrder = projection.parts.find((entry) => entry.sourcePartId === 'aura__aura').renderOrder;
  const crownNone = projection.mappings.none.find((entry) => entry.partId === 'crown__crown');
  const auraNone = projection.mappings.none.find((entry) => entry.partId === 'aura__aura');
  assert.equal(noPack.suiRecipe[crownOrder].itemKey, crownNone.itemKey);
  assert.notEqual(crownOnly.suiRecipe[crownOrder].itemKey, crownNone.itemKey);
  assert.equal(noPack.suiRecipe[auraOrder].itemKey, auraNone.itemKey);
  assert.equal(crownOnly.suiRecipe[auraOrder].itemKey, auraNone.itemKey);

  const manifest = buildMakerV4PublicationManifest(document, {
    logicalAuxiliaryBlobId: LOGICAL_AUXILIARY_BLOB_ID,
    publicExtensions: {
      expansionRuntime: 'embedded-v1',
      expansionDrafts: document.extensions.expansionDrafts,
    },
  });
  assert.equal(manifest.moveProjectionV2.schemaVersion, MAKER_V4_MOVE_PROJECTION_V2_SCHEMA);
  assert.deepEqual(manifest.moveProjectionV2.parts, projection.parts);
  assert.deepEqual(manifest.moveProjectionV2.mappings, projection.mappings);
  const summary = buildMakerV4MoveSummaryV2(manifest, {
    assetLocations: new Map(manifest.assets.map((asset) => [asset.id, `patch-${asset.id}`])),
    auxiliaryLocation: 'patch-auxiliary',
    logicalAuxiliaryBlobId: LOGICAL_AUXILIARY_BLOB_ID,
  });
  assert.deepEqual(summary.projection.parts, projection.parts);
  assert.ok(summary.items
    .filter((entry) => entry.projectionKind === 'style'
      && ['crown__crown', 'aura__aura'].includes(entry.sourcePartId))
    .every((entry) => entry.blobId === 'patch-hat-plain'));
  const tamperedManifest = structuredClone(manifest);
  tamperedManifest.moveProjectionV2.itemKeyEncoding = 'tampered';
  expectPublicationError(
    () => buildMakerV4MoveSummaryV2(tamperedManifest, {
      assetLocations: new Map(manifest.assets.map((asset) => [asset.id, `patch-${asset.id}`])),
      auxiliaryLocation: 'patch-auxiliary',
      logicalAuxiliaryBlobId: LOGICAL_AUXILIARY_BLOB_ID,
    }),
    'move-projection-v2-manifest-mismatch',
  );
});

test('legacy v4 projections remain byte-shape compatible when Commerce v5 is absent', () => {
  const document = projectionMaker();
  delete document.commerce;
  const projection = compileMakerV4MoveProjectionV2(document);

  assert.equal(Object.hasOwn(projection, 'commerce'), false);
  assert.equal(Object.hasOwn(projection.mappings, 'packBindings'), false);
  assert.equal(Object.hasOwn(projection.counts, 'commercePacks'), false);
  assert.ok(projection.items.every((entry) => (
    !Object.hasOwn(entry, 'requiredPackIds')
    && !Object.hasOwn(entry, 'selectedStylePackId')
  )));

  const manifest = buildMakerV4PublicationManifest(document);
  assert.equal(Object.hasOwn(manifest, 'commerce'), false);
  assert.equal(Object.hasOwn(manifest.moveProjectionV2, 'commerce'), false);
});

test('Commerce v5 publication binds a paid Pack Style added to a Base Item', () => {
  const document = projectionMaker();
  document.extensions.expansionDrafts = [styleExpansionPack()];
  document.commerce = commerceForPacks([
    createPackCommercePolicyV5('moon-styles', {
      accessMode: PACK_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 6_000_000,
      completion: {
        mode: COMPLETION_MODES.UNLIMITED_FREE,
      },
    }),
  ]);
  document.publication.royaltyBps = document.commerce.makerSourceRoyaltyBps;
  document.commerce.privateRuntimeEndpoint = 'https://must-not-publish.invalid';
  document.commerce.packPolicies[0].privateReceipt = 'must-not-publish';

  const projection = compileMakerV4MoveProjectionV2(document);
  const mapping = projection.mappings.styles.find((entry) => (
    entry.partId === 'body'
    && entry.itemId === 'shape'
    && entry.styleId === 'moon__moon-trim'
  ));
  assert.ok(mapping);
  const projectedItem = projection.items.find((entry) => (
    entry.partKey === mapping.partKey && entry.itemKey === mapping.itemKey
  ));
  assert.deepEqual({
    gateKind: projectedItem.gateKind,
    sourcePartPackId: projectedItem.sourcePartPackId,
    sourceItemPackId: projectedItem.sourceItemPackId,
    sourceStylePackId: projectedItem.sourceStylePackId,
    selectedStylePackId: projectedItem.selectedStylePackId,
    requiredPackIds: projectedItem.requiredPackIds,
  }, {
    gateKind: 1,
    sourcePartPackId: null,
    sourceItemPackId: null,
    sourceStylePackId: 'moon-styles',
    selectedStylePackId: 'moon-styles',
    requiredPackIds: ['moon-styles'],
  });
  assert.deepEqual(projection.mappings.packBindings, [{
    packId: 'moon-styles',
    partKey: mapping.partKey,
    itemKey: mapping.itemKey,
    sourcePartId: 'body',
    sourceItemId: 'shape',
    sourceStyleId: 'moon__moon-trim',
    sources: ['style'],
  }]);
  assert.equal(
    projection.commerce.schemaVersion,
    MAKER_V4_COMMERCE_PROJECTION_V5_SCHEMA,
  );
  assert.deepEqual(projection.commerce.makerAccess, {
    mode: MAKER_ACCESS_MODES.ONE_TIME_PAID,
    purchasePriceAtomic: 10_000_000,
  });
  assert.deepEqual(projection.commerce.baseCompletion, {
    mode: COMPLETION_MODES.FREE_QUOTA_THEN_PAID,
    freeQuotaPerWallet: 3,
    priceAtomic: 1_000_000,
    totalCap: null,
  });
  assert.deepEqual(projection.commerce.royalties, {
    soulCreatorBps: 100,
    makerSourceBps: 200,
    makerResaleBps: 500,
  });
  assert.deepEqual(projection.commerce.protocol, {
    enabled: false,
    primaryContentFeeBps: 1_000,
    fixedCompleteFeeAtomic: 0,
    makerMarketFeeBps: 250,
    soulMarketFeeBps: 250,
  });
  const paidStyleProduct = projection.commerce.styleProducts.find((entry) => (
    entry.partKey === mapping.partKey && entry.itemKey === mapping.itemKey
  ));
  assert.deepEqual(paidStyleProduct, {
    partKey: mapping.partKey,
    itemKey: mapping.itemKey,
    styleKey: 'moon__moon-trim',
    packId: 'moon-styles',
    rowKind: 'VISUAL',
  });
  assert.equal(
    projection.commerce.styleProducts.length,
    projection.items.length,
    'every real, None, and Smart Color projection Item receives one sealed Style product row',
  );

  const manifest = buildMakerV4PublicationManifest(document, {
    logicalAuxiliaryBlobId: LOGICAL_AUXILIARY_BLOB_ID,
  });
  assert.deepEqual(manifest.commerce, {
    schemaVersion: 'animacraft.maker-commerce.v5',
    rightsOrigin: RIGHTS_ORIGINS.LICENSE_WRAPPED,
    rightsOriginConfirmed: true,
    makerAccess: {
      mode: MAKER_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 10_000_000,
    },
    baseCompletion: {
      mode: COMPLETION_MODES.FREE_QUOTA_THEN_PAID,
      freeQuotaPerWallet: 3,
      priceAtomic: 1_000_000,
      totalCap: null,
    },
    packPolicies: [{
      packId: 'moon-styles',
      accessMode: PACK_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 6_000_000,
      completion: {
        mode: COMPLETION_MODES.UNLIMITED_FREE,
        freeQuotaPerWallet: 0,
        priceAtomic: 0,
        totalCap: null,
      },
    }],
    soulCreatorRoyaltyBps: 100,
    makerSourceRoyaltyBps: 200,
    makerResaleRoyaltyBps: 500,
    protocol: {
      enabled: false,
      primaryContentFeeBps: 1_000,
      fixedCompleteFeeAtomic: 0,
      makerMarketFeeBps: 250,
      soulMarketFeeBps: 250,
    },
  });
  assert.equal(Object.hasOwn(manifest.commerce, 'privateRuntimeEndpoint'), false);
  assert.equal(Object.hasOwn(manifest.commerce.packPolicies[0], 'privateReceipt'), false);
  assert.deepEqual(
    manifest.moveProjectionV2.mappings.packBindings,
    projection.mappings.packBindings,
  );

  const summary = buildMakerV4MoveSummaryV2(manifest, {
    assetLocations: new Map(manifest.assets.map((asset) => [
      asset.id,
      `patch-${asset.id}`,
    ])),
    auxiliaryLocation: 'patch-auxiliary',
    logicalAuxiliaryBlobId: LOGICAL_AUXILIARY_BLOB_ID,
  });
  const summaryItem = summary.items.find((entry) => (
    entry.partKey === mapping.partKey && entry.itemKey === mapping.itemKey
  ));
  assert.equal(summaryItem.gateKind, 1);
  assert.deepEqual(summaryItem.requiredPackIds, ['moon-styles']);
  assert.deepEqual(summary.packBindings, projection.mappings.packBindings);

  const oc = buildMakerV4OcPackage({
    document,
    recipe: {
      selections: [{
        partId: 'body',
        itemId: 'shape',
        styleId: 'moon__moon-trim',
      }],
      colors: [{ channelId: 'skin', swatchId: 'warm' }],
    },
  });
  assert.deepEqual(oc.usedPackIds, ['moon-styles']);
  assert.deepEqual(oc.package.commerce.usedPackIds, ['moon-styles']);
  assert.deepEqual(oc.package.suiSummary.usedPackIds, ['moon-styles']);
  assert.deepEqual(
    oc.package.commerce.royalties,
    projection.commerce.royalties,
    'the certified OC must freeze the same royalty projection used by the Maker release',
  );
  assert.equal(
    oc.styleSelections.length,
    oc.suiRecipe.length,
    'the exact Style selection vector must align one-to-one with the legacy recipe',
  );
  assert.deepEqual(
    oc.package.suiSummary.styleSelections,
    oc.styleSelections,
  );
  assert.ok(oc.styleSelections.some((selection) => (
    selection.partKey === mapping.partKey
    && selection.itemKey === mapping.itemKey
    && selection.styleKey === 'moon__moon-trim'
  )));
  assert.deepEqual(oc.package.commerce.packBindings, [{
    packId: 'moon-styles',
    partKey: mapping.partKey,
    itemKey: mapping.itemKey,
    sourcePartId: 'body',
    sourceItemId: 'shape',
    sourceStyleId: 'moon__moon-trim',
    sources: ['style'],
  }]);
  assert.deepEqual(
    oc.package.commerce.packPolicies.map((policy) => policy.packId),
    ['moon-styles'],
    'the OC provenance freezes only the Pack policies actually used by its exact Style',
  );
});

test('Commerce v5 projection rejects one Style that depends on two independent paid products', () => {
  const document = projectionMaker();
  document.extensions.expansionDrafts = [
    itemExpansionPack(),
    styleExpansionPack({
      packId: 'moon-effects',
      namespace: 'moon',
      targetItemId: 'wardrobe__coat',
    }),
  ];
  document.commerce = commerceForPacks([
    createPackCommercePolicyV5('moon-effects'),
    createPackCommercePolicyV5('wardrobe-plus', {
      accessMode: PACK_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 8_000_000,
    }),
  ]);

  assert.throws(
    () => compileMakerV4MoveProjectionV2(document),
    (error) => error?.code === 'ambiguous-style-pack-provenance'
      && error.details?.packIds?.length === 2,
  );
});

test('Commerce v5 publication normalizes a missing embedded Pack policy to FREE', () => {
  const document = projectionMaker();
  document.extensions.expansionDrafts = [styleExpansionPack()];
  document.commerce = commerceForPacks([]);
  document.publication.royaltyBps = document.commerce.makerSourceRoyaltyBps;

  const manifest = buildMakerV4PublicationManifest(document);
  assert.deepEqual(manifest.commerce.packPolicies, [{
    packId: 'moon-styles',
    accessMode: PACK_ACCESS_MODES.FREE,
    purchasePriceAtomic: 0,
    completion: {
      mode: COMPLETION_MODES.UNLIMITED_FREE,
      freeQuotaPerWallet: 0,
      priceAtomic: 0,
      totalCap: null,
    },
  }]);
});

test('Commerce v5 publication rejects a Maker-source royalty that differs from its Soulidity snapshot', () => {
  const document = projectionMaker();
  document.commerce = commerceForPacks([]);
  document.publication.royaltyBps = 300;

  expectPublicationError(
    () => buildMakerV4PublicationManifest(document),
    'maker-source-royalty-mismatch',
  );
});

test('Commerce v5 publication still rejects a malformed authored policy', () => {
  const document = projectionMaker();
  document.extensions.expansionDrafts = [styleExpansionPack()];
  document.commerce = commerceForPacks([
    createPackCommercePolicyV5('moon-styles', {
      accessMode: PACK_ACCESS_MODES.ONE_TIME_PAID,
      purchasePriceAtomic: 6_000_000,
    }),
  ]);
  document.commerce.packPolicies[0].purchasePriceAtomic = 0;

  assert.throws(() => buildMakerV4PublicationManifest(document), (error) => {
    assert.ok(Array.isArray(error.issues));
    assert.ok(error.issues.some((issue) => issue.code === 'invalid_pack_price'));
    return true;
  });
});

test('grouped Item/Style selectors enumerate exact keys without wildcards', () => {
  const document = projectionMaker();
  document.parts[0].items[0].styles[1].excludes = [{
    partId: 'hat',
    itemId: 'cap',
    styleIds: ['plain', 'star'],
  }];
  const projection = compileMakerV4MoveProjectionV2(document);
  const armored = projection.mappings.styles.find((entry) => entry.styleId === 'armored');
  const hatKeys = projection.mappings.styles
    .filter((entry) => entry.partId === 'hat')
    .map((entry) => entry.itemKey)
    .sort();
  const paired = projection.rules.filter((rule) => (
    rule.leftItemKey === armored.itemKey || rule.rightItemKey === armored.itemKey
  )).map((rule) => (
    rule.leftItemKey === armored.itemKey ? rule.rightItemKey : rule.leftItemKey
  )).sort();
  assert.deepEqual(paired, hatKeys);
  assert.equal(projection.rules.some((rule) => !rule.leftItemKey || !rule.rightItemKey), false);
});

test('Style visibility projects exact Item and Style selectors and survives publication Preflight', () => {
  const document = projectionMaker();
  document.assets.push(pngAsset('hat-helmet'));
  document.parts[1].items.push(item('helmet', 1, [
    style('heavy', 0, 'hat-track', 'hat-helmet'),
  ]));
  document.parts[0].items[0].styles[0].visibleWhen = {
    op: 'selected',
    partId: 'hat',
    itemId: 'cap',
  };
  document.parts[0].items[0].styles[1].visibleWhen = {
    op: 'selected',
    partId: 'hat',
    itemId: 'cap',
    styleId: 'star',
  };

  const projection = compileMakerV4MoveProjectionV2(document);
  const mapping = new Map(projection.mappings.styles.map((entry) => [
    `${entry.partId}/${entry.itemId}/${entry.styleId}`,
    entry,
  ]));
  const none = projection.mappings.none.find((entry) => entry.partId === 'hat');
  const base = mapping.get('body/shape/base');
  const armored = mapping.get('body/shape/armored');
  const plain = mapping.get('hat/cap/plain');
  const star = mapping.get('hat/cap/star');
  const heavy = mapping.get('hat/helmet/heavy');

  assert.deepEqual(projectedConflictsFor(projection, base), [
    `${heavy.partKey}\u0000${heavy.itemKey}`,
    `${none.partKey}\u0000${none.itemKey}`,
  ].sort(), 'an exact Item selector must allow every Style in that Item');
  assert.deepEqual(projectedConflictsFor(projection, armored), [
    `${heavy.partKey}\u0000${heavy.itemKey}`,
    `${none.partKey}\u0000${none.itemKey}`,
    `${plain.partKey}\u0000${plain.itemKey}`,
  ].sort(), 'an exact Style selector must allow only that Style');
  assert.equal(
    projectedConflictsFor(projection, armored).includes(`${star.partKey}\u0000${star.itemKey}`),
    false,
  );

  const manifest = buildMakerV4PublicationManifest(document);
  assert.deepEqual(
    manifest.moveProjectionV2.rules,
    projection.rules,
    'the publication Preflight manifest must store the same exact visibility projection',
  );
});

test('not-selected visibility treats an omitted optional Part as None in Sui projection and Preflight', () => {
  const document = projectionMaker();
  document.parts[0].items[0].styles[0].visibleWhen = {
    op: 'not',
    condition: {
      op: 'selected',
      partId: 'hat',
      itemId: 'cap',
      styleId: 'star',
    },
  };

  const projection = compileMakerV4MoveProjectionV2(document);
  const mapping = new Map(projection.mappings.styles.map((entry) => [
    `${entry.partId}/${entry.itemId}/${entry.styleId}`,
    entry,
  ]));
  const base = mapping.get('body/shape/base');
  const star = mapping.get('hat/cap/star');
  const none = projection.mappings.none.find((entry) => entry.partId === 'hat');

  assert.deepEqual(
    projectedConflictsFor(projection, base),
    [`${star.partKey}\u0000${star.itemKey}`],
    'not-selected must forbid only the selected target, not the optional None sentinel',
  );
  assert.equal(
    projectedConflictsFor(projection, base).includes(`${none.partKey}\u0000${none.itemKey}`),
    false,
  );

  const omitted = {
    selections: [{ partId: 'body', itemId: 'shape', styleId: 'base' }],
    colors: [{ channelId: 'skin', swatchId: 'warm' }],
  };
  assert.equal(evaluateRecipe(document, omitted).valid, true);
  assert.doesNotThrow(() => flattenMakerV4RecipeV2(document, omitted));

  const selected = {
    selections: [
      { partId: 'body', itemId: 'shape', styleId: 'base' },
      { partId: 'hat', itemId: 'cap', styleId: 'star' },
    ],
    colors: [{ channelId: 'skin', swatchId: 'warm' }],
  };
  assert.equal(evaluateRecipe(document, selected).valid, false);
  expectPublicationError(
    () => flattenMakerV4RecipeV2(document, selected),
    'invalid-maker-recipe',
  );

  const manifest = buildMakerV4PublicationManifest(document);
  assert.deepEqual(
    manifest.moveProjectionV2.rules,
    projection.rules,
    'publication Preflight must preserve the optional-Part not-selected projection',
  );
});

test('pairwise projection authorizes exactly the same finite recipe space', () => {
  const document = projectionMaker();
  document.parts[0].items[0].styles[0].requires = [{
    partId: 'hat',
    itemId: 'cap',
    styleId: 'plain',
  }];
  document.parts[0].items[0].styles[1].excludes = [{
    partId: 'hat',
    itemId: 'cap',
    styleId: 'star',
  }];
  document.parts[1].items[0].styles[0].visibleWhen = {
    op: 'selected',
    partId: 'body',
    itemId: 'shape',
    styleId: 'base',
  };
  document.parts[1].items[0].styles[1].visibleWhen = {
    op: 'selected',
    partId: 'body',
    itemId: 'shape',
    styleId: 'armored',
  };
  const projection = compileMakerV4MoveProjectionV2(document);
  const mapping = new Map(projection.mappings.styles.map((entry) => [
    `${entry.partId}/${entry.itemId}/${entry.styleId}`,
    entry,
  ]));
  const none = projection.mappings.none.find((entry) => entry.partId === 'hat');
  const color = projection.mappings.colorChannels[0];
  const warm = color.swatches.find((entry) => entry.swatchId === 'warm');

  ['base', 'armored'].forEach((bodyStyle) => {
    [null, 'plain', 'star'].forEach((hatStyle) => {
      const recipe = {
        selections: [
          { partId: 'body', itemId: 'shape', styleId: bodyStyle },
          ...(hatStyle ? [{ partId: 'hat', itemId: 'cap', styleId: hatStyle }] : []),
        ],
        colors: [{ channelId: 'skin', swatchId: 'warm' }],
      };
      const selected = new Set([
        `${mapping.get(`body/shape/${bodyStyle}`).partKey}\u0000${mapping.get(`body/shape/${bodyStyle}`).itemKey}`,
        `${hatStyle ? mapping.get(`hat/cap/${hatStyle}`).partKey : none.partKey}\u0000${hatStyle ? mapping.get(`hat/cap/${hatStyle}`).itemKey : none.itemKey}`,
        `${color.partKey}\u0000${warm.itemKey}`,
      ]);
      const chainAllowed = projection.rules.every((rule) => !(
        selected.has(`${rule.leftPartKey}\u0000${rule.leftItemKey}`)
        && selected.has(`${rule.rightPartKey}\u0000${rule.rightItemKey}`)
      ));
      assert.equal(
        chainAllowed,
        evaluateRecipe(document, recipe).valid,
        `authorization mismatch for body=${bodyStyle}, hat=${hatStyle || 'None'}`,
      );
    });
  });
});

test('cross-Part OR visibility is rejected with a stable path and code', () => {
  const document = projectionMaker();
  document.layerTracks.push({
    id: 'eyes-track',
    name: 'Eyes',
    order: 2,
    locked: true,
    referenceAssetId: null,
  });
  document.assets.push(pngAsset('eyes-blue'));
  document.parts.push(part('eyes', 2, false, [
    item('iris', 0, [style('blue', 0, 'eyes-track', 'eyes-blue')]),
  ]));
  document.defaultRecipe.selections.push({ partId: 'eyes', itemId: 'iris', styleId: 'blue' });
  document.parts[0].items[0].styles[0].visibleWhen = {
    op: 'any',
    conditions: [
      { op: 'selected', partId: 'hat', itemId: 'cap', styleId: 'plain' },
      { op: 'selected', partId: 'eyes', itemId: 'iris', styleId: 'blue' },
    ],
  };
  assert.throws(() => compileMakerV4MoveProjectionV2(document), (error) => {
    assert.ok(error instanceof MakerV4PublicationError);
    assert.equal(error.code, 'unrepresentable-projection-condition');
    assert.equal(error.details.path, 'parts.body.items.shape.styles.base.visibleWhen');
    assert.equal(error.details.reason, 'cross-part-any');
    return true;
  });
});

test('projection keys are deterministic and collision-safe under source array reordering', () => {
  const document = projectionMaker();
  document.assets.push(pngAsset('body-collision'));
  document.parts[0].items.push(item('shape--armored', 1, [
    style('base', 0, 'body-track', 'body-collision'),
  ]));
  const reordered = structuredClone(document);
  reordered.parts.reverse();
  reordered.parts.forEach((entry) => entry.items.reverse());
  reordered.layerTracks.reverse();
  reordered.colorChannels.reverse();

  const first = compileMakerV4MoveProjectionV2(document);
  const second = compileMakerV4MoveProjectionV2(reordered);
  assert.deepEqual(second, first);

  const bodyKeys = first.mappings.styles
    .filter((entry) => entry.partId === 'body')
    .map((entry) => entry.itemKey);
  assert.equal(new Set(bodyKeys).size, bodyKeys.length);
  assert.equal(
    first.mappings.styles.find((entry) => entry.itemId === 'shape--armored').itemKey,
    'shape--armored',
  );
  assert.notEqual(
    first.mappings.styles.find((entry) => entry.itemId === 'shape' && entry.styleId === 'armored').itemKey,
    'shape--armored',
  );
});

test('projection enforces Move Part, Item and Rule count limits', async (context) => {
  await context.test('Part count includes synthetic ColorChannels', () => {
    const document = createMakerV5Document({ makerId: 'part-limit', name: 'Part limit', creator: 'Animacraft' });
    document.layerTracks = [];
    document.assets = [pngAsset('shared')];
    document.parts = Array.from({ length: 750 }, (_, index) => {
      const trackId = `track-${index}`;
      document.layerTracks.push({ id: trackId, name: trackId, order: index, locked: true, referenceAssetId: null });
      return part(`part-${index}`, index, true, [
        item('item', 0, [style('style', 0, trackId, 'shared')]),
      ]);
    });
    document.defaultRecipe.selections = document.parts.map((entry) => ({
      partId: entry.id,
      itemId: 'item',
      styleId: 'style',
    }));
    document.colorChannels = [{
      id: 'color',
      name: 'Color',
      order: 0,
      mode: 'gradient-map',
      defaultSwatchId: 'default',
      swatches: [swatch('default', '#000000')],
    }];
    document.defaultRecipe.colors = [{ channelId: 'color', swatchId: 'default' }];
    makePublishableMetadata(document, 'shared');
    expectPublicationError(() => compileMakerV4MoveProjectionV2(document), 'move-part-limit');
  });

  await context.test('Item count includes every public Style', () => {
    const document = createMakerV5Document({ makerId: 'item-limit', name: 'Item limit', creator: 'Animacraft' });
    document.layerTracks = [{ id: 'track', name: 'Track', order: 0, locked: true, referenceAssetId: null }];
    document.assets = [pngAsset('shared')];
    const items = Array.from({ length: 79 }, (_, itemIndex) => {
      const count = itemIndex < 78 ? 64 : 9;
      return item(`item-${itemIndex}`, itemIndex, Array.from({ length: count }, (_, styleIndex) => (
        style(`style-${styleIndex}`, styleIndex, 'track', 'shared')
      )));
    });
    document.parts = [part('part', 0, true, items)];
    document.defaultRecipe.selections = [{ partId: 'part', itemId: 'item-0', styleId: 'style-0' }];
    makePublishableMetadata(document, 'shared');
    expectPublicationError(() => compileMakerV4MoveProjectionV2(document), 'move-item-limit');
  });

  await context.test('expanded pairwise rules stop at the protocol limit', () => {
    const document = createMakerV5Document({ makerId: 'rule-limit', name: 'Rule limit', creator: 'Animacraft' });
    document.layerTracks = [
      { id: 'a-track', name: 'A', order: 0, locked: true, referenceAssetId: null },
      { id: 'b-track', name: 'B', order: 1, locked: true, referenceAssetId: null },
    ];
    document.assets = [pngAsset('shared')];
    const stylesA = Array.from({ length: 32 }, (_, index) => style(`a-${index}`, index, 'a-track', 'shared'));
    const stylesB = Array.from({ length: 32 }, (_, index) => style(`b-${index}`, index, 'b-track', 'shared'));
    document.parts = [
      part('a', 0, true, [item('a-item', 0, stylesA)], { excludes: [{ partId: 'b' }] }),
      part('b', 1, true, [item('b-item', 0, stylesB)]),
    ];
    document.defaultRecipe.selections = [
      { partId: 'a', itemId: 'a-item', styleId: 'a-0' },
      { partId: 'b', itemId: 'b-item', styleId: 'b-0' },
    ];
    makePublishableMetadata(document, 'shared');
    expectPublicationError(() => compileMakerV4MoveProjectionV2(document), 'move-rule-limit');
  });
});

test('projection auxiliary PNG is reusable chain-only data, never a render asset', () => {
  const blob = new Blob(['png'], { type: 'image/png' });
  const entry = createMakerV4ProjectionV2AuxiliaryEntry(blob);
  assert.equal(entry.blob, blob);
  assert.equal(entry.identifier, MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER);
  assert.equal(entry.kind, 'chain-auxiliary');
  assert.equal(entry.assetId, null);
  assert.equal(entry.projectionOnly, true);
  assert.equal(entry.renderAsset, false);
  expectPublicationError(
    () => createMakerV4ProjectionV2AuxiliaryEntry(new Blob(['no'], { type: 'image/webp' })),
    'invalid-projection-auxiliary',
  );
});

test('v2 Move summary resolves every logical asset to one quilt-patch location', () => {
  const document = projectionMaker();
  const assetLocations = new Map(document.assets.map((asset) => [
    asset.id,
    { id: `patch-${asset.id}`, blobId: 'whole-quilt-id' },
  ]));
  const summary = buildMakerV4MoveSummaryV2(document, {
    assetLocations,
    auxiliaryLocation: {
      id: 'patch-auxiliary',
      blobId: 'whole-quilt-id',
      identifier: MAKER_V4_PROJECTION_V2_AUXILIARY_IDENTIFIER,
      projectionOnly: true,
      renderAsset: false,
    },
    logicalAuxiliaryBlobId: LOGICAL_AUXILIARY_BLOB_ID,
    coverUrl: 'https://example.test/cover',
  });
  assert.equal(summary.authorizationCoverage, 'complete');
  assert.equal(summary.auxiliary.patchId, 'patch-auxiliary');
  assert.equal(
    summary.auxiliary.canonicalBlobId,
    LOGICAL_AUXILIARY_BLOB_ID,
  );
  assert.equal(
    summary.items.find((entry) => entry.sourceAssetId === 'body-base').blobId,
    'patch-body-base',
  );
  assert.ok(summary.items
    .filter((entry) => entry.renderAsset === false)
    .every((entry) => entry.blobId === LOGICAL_AUXILIARY_BLOB_ID));
  assert.equal(
    summary.singlePublishRecords,
    (summary.parts.length * 2) + summary.items.length + summary.rules.length,
  );

  expectPublicationError(
    () => buildMakerV4MoveSummaryV2(document, {
      assetLocations,
      logicalAuxiliaryBlobId: LOGICAL_AUXILIARY_BLOB_ID,
    }),
    'missing-projection-auxiliary-location',
  );
  const missingRealAsset = new Map(assetLocations);
  missingRealAsset.delete('body-base');
  expectPublicationError(
    () => buildMakerV4MoveSummaryV2(document, {
      assetLocations: missingRealAsset,
      auxiliaryLocation: 'patch-auxiliary',
      logicalAuxiliaryBlobId: LOGICAL_AUXILIARY_BLOB_ID,
    }),
    'missing-walrus-asset-location',
  );
});

test('v2 summary rejects a Maker above the one-PTB publication record budget', () => {
  const document = createMakerV5Document({ makerId: 'ptb-limit', name: 'PTB limit', creator: 'Animacraft' });
  document.assets = [pngAsset('shared')];
  document.parts = Array.from({ length: 151 }, (_, index) => {
    const trackId = `track-${index}`;
    document.layerTracks.push({
      id: trackId,
      name: trackId,
      order: index,
      locked: true,
      referenceAssetId: null,
    });
    return part(`part-${index}`, index, true, [
      item('item', 0, [style('style', 0, trackId, 'shared')]),
    ]);
  });
  document.defaultRecipe.selections = document.parts.map((entry) => ({
    partId: entry.id,
    itemId: 'item',
    styleId: 'style',
  }));
  makePublishableMetadata(document, 'shared');
  expectPublicationError(
    () => buildMakerV4MoveSummaryV2(document, { assetLocations: new Map() }),
    'single-publish-record-limit',
  );
});

test('v5 OC packages use the same v2 projection and neutral complete recipe as publication', () => {
  const document = projectionMaker();
  document.commerce.soulCreatorRoyaltyBps = 0;
  const bridge = buildMakerV4OcPackage({
    document,
    recipe: {
      selections: [{ partId: 'body', itemId: 'shape', styleId: 'armored' }],
      colors: [{ channelId: 'skin', swatchId: 'cool' }],
    },
  });
  assert.equal(bridge.package.suiSummary.projectionSchema, MAKER_V4_MOVE_PROJECTION_V2_SCHEMA);
  assert.equal(bridge.package.suiSummary.itemKeyEncoding, MAKER_V4_ITEM_KEY_ENCODING_V2);
  assert.equal(bridge.suiRecipe.length, 3);
  assert.ok(bridge.suiRecipe.every((slot) => slot.colorHex === MAKER_V4_NEUTRAL_COLOR));
  assert.equal(
    bridge.package.commerce.royalties.soulCreatorBps,
    0,
    'an explicit zero creator royalty is immutable data and must not fall back to the v5 default',
  );
});
