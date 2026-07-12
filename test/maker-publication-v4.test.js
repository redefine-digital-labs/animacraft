import assert from 'node:assert/strict';
import test from 'node:test';

import { createMakerV4Document, validateMakerV4Document } from '../maker-v4.js';
import {
  MAKER_V4_MANIFEST_IDENTIFIER,
  MAKER_V4_NEUTRAL_COLOR,
  MakerV4PublicationError,
  buildMakerV4MoveSummary,
  buildMakerV4OcPackage,
  buildMakerV4OcUploadEntries,
  buildMakerV4PublicationBundle,
  buildMakerV4PublicationManifest,
  buildMakerV4VersionMetadata,
  collectMakerV4UploadEntries,
  collectReferencedMakerV4AssetIds,
  flattenMakerV4Recipe,
  indexMakerV4UploadResults,
} from '../maker-publication-v4.js';

function binding(id, track, asset, colorChannelId = null, extra = {}) {
  return {
    id,
    layerTrackId: track,
    assetId: asset,
    colorChannelId,
    assetsBySwatch: [],
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    opacity: 1,
    blendMode: 'normal',
    visibleWhen: null,
    ...extra,
  };
}

function publicationMaker({ version = 1, compatibility = version === 1 ? 'initial' : 'compatible' } = {}) {
  const document = createMakerV4Document({
    makerId: 'astral-maker',
    name: 'Astral Maker',
    creator: 'Angie',
    version: version === 1 ? {} : {
      versionNumber: version,
      parentVersionId: `astral-maker-v${version - 1}`,
      compatibility,
      compatibleFrom: compatibility === 'breaking' ? version : 1,
      changelog: version === 1 ? '' : 'Adds new Maker content.',
    },
  });
  document.metadata.summary = 'A complete Maker v4 publication fixture.';
  document.metadata.style = 'Cel shaded';
  document.metadata.license.note = 'Personal use with creator credit.';
  document.metadata.coverAssetId = 'cover';
  document.canvas.pixelMode = 'pixelated';
  document.layerTracks = [
    { id: 'body-track', name: 'Body', order: 0 },
    { id: 'hat-track', name: 'Hat', order: 1 },
  ];
  document.colorChannels = [{
    id: 'skin',
    name: 'Skin',
    order: 0,
    mode: 'gradient-map',
    defaultSwatchId: 'warm',
    swatches: [
      {
        id: 'warm',
        name: 'Warm',
        hintColor: '#d68f72',
        stops: [{ offset: 0, color: '#3b1e18' }, { offset: 1, color: '#fff1e9' }],
      },
      {
        id: 'cool',
        name: 'Cool',
        hintColor: '#b9c8dfff',
        stops: [{ offset: 0, color: '#18233b' }, { offset: 1, color: '#eef4ff' }],
      },
    ],
  }];
  document.assets = [
    { id: 'unused', identifier: '00-unused.png', kind: 'layer', mediaType: 'image/png', width: 1024, height: 1024, url: 'blob:leak' },
    { id: 'cover', identifier: '10-cover.png', kind: 'cover', mediaType: 'image/png', width: 1024, height: 1024, source: 'local-draft' },
    { id: 'body-thumb', identifier: '20-body-thumb.png', kind: 'thumbnail', mediaType: 'image/png', width: 256, height: 256 },
    { id: 'body-default', identifier: '30-body-default.png', kind: 'layer', mediaType: 'image/png', width: 1024, height: 1024, legacy: { url: 'blob:leak' } },
    { id: 'body-armored', identifier: '40-body-armored.png', kind: 'layer', mediaType: 'image/png', width: 1024, height: 1024 },
    { id: 'hat', identifier: '50-hat.png', kind: 'layer', mediaType: 'image/png', width: 1024, height: 1024 },
  ];
  document.parts = [
    {
      id: 'body',
      name: 'Body',
      menuOrder: 0,
      menuVisible: true,
      required: true,
      defaultItemId: 'shape',
      parentPartId: null,
      iconAssetId: null,
      visibleWhen: null,
      requires: [],
      excludes: [],
      items: [{
        id: 'shape',
        name: 'Body Shape',
        displayOrder: 0,
        thumbnailAssetId: 'body-thumb',
        visibleWhen: null,
        requires: [],
        excludes: [],
        defaultVariantId: 'default',
        variants: [
          {
            id: 'default',
            name: 'Default',
            displayOrder: 0,
            visibleWhen: null,
            requires: [],
            excludes: [],
            layerBindings: [binding('body-default-binding', 'body-track', 'body-default', 'skin')],
          },
          {
            id: 'armored',
            name: 'Armored',
            displayOrder: 1,
            visibleWhen: null,
            requires: [],
            excludes: [],
            layerBindings: [binding('body-armored-binding', 'body-track', 'body-armored', 'skin', { blendMode: 'overlay' })],
          },
        ],
      }],
    },
    {
      id: 'hat',
      name: 'Hat',
      menuOrder: 1,
      menuVisible: true,
      required: false,
      defaultItemId: 'moon-hat',
      parentPartId: 'body',
      iconAssetId: null,
      visibleWhen: { op: 'selected', partId: 'body', itemId: 'shape' },
      requires: [{ partId: 'body' }],
      excludes: [],
      items: [{
        id: 'moon-hat',
        name: 'Moon Hat',
        displayOrder: 0,
        thumbnailAssetId: null,
        visibleWhen: null,
        requires: [],
        excludes: [],
        defaultVariantId: 'default',
        variants: [{
          id: 'default',
          name: 'Default',
          displayOrder: 0,
          visibleWhen: null,
          requires: [],
          excludes: [{ partId: 'body', itemId: 'shape', variantId: 'armored' }],
          layerBindings: [binding('hat-binding', 'hat-track', 'hat')],
        }],
      }],
    },
  ];
  document.defaultRecipe = {
    selections: [
      { partId: 'body', itemId: 'shape', variantId: 'default' },
      { partId: 'hat', itemId: 'moon-hat', variantId: 'default' },
    ],
    colors: [{ channelId: 'skin', swatchId: 'warm' }],
  };
  document.runtime = {
    walrusAggregatorUrl: 'https://runtime.example',
    selectedPartId: 'hat',
    undoStack: [{ secret: true }],
  };
  document.assetsById = { cover: { blob: new Blob(['leak']) } };
  document.extensions = { legacyV3: { unmappedTopLevel: { wallet: '0xprivate', objectUrl: 'blob:private' } } };
  validateMakerV4Document(document);
  return document;
}

function runtimeAssets(document) {
  return new Map(document.assets.filter((asset) => asset.id !== 'unused').map((asset) => [asset.id, {
    blob: new Blob([asset.id], { type: asset.mediaType }),
  }]));
}

function assetLocations() {
  return new Map([
    ['cover', { id: 'patch-cover' }],
    ['body-thumb', { id: 'patch-body-thumb' }],
    ['body-default', { id: 'patch-body-default' }],
    ['body-armored', { id: 'patch-body-armored' }],
    ['hat', { id: 'patch-hat' }],
  ]);
}

function recipe({ bodyVariant = 'default', hat = true, color = 'cool' } = {}) {
  return {
    selections: [
      { partId: 'body', itemId: 'shape', variantId: bodyVariant },
      ...(hat ? [{ partId: 'hat', itemId: 'moon-hat', variantId: 'default' }] : []),
    ],
    colors: [{ channelId: 'skin', swatchId: color }],
  };
}

test('publication manifest is immutable, referenced-only and strips runtime state', () => {
  const document = publicationMaker();
  const before = structuredClone(document);
  const manifest = buildMakerV4PublicationManifest(document);

  assert.deepEqual(document, before);
  assert.equal(manifest.schemaVersion, 'animacraft.maker.v4');
  assert.deepEqual(manifest.runtime, {});
  assert.equal('assetsById' in manifest, false);
  assert.deepEqual(manifest.extensions, {});
  assert.deepEqual(manifest.assets.map((asset) => asset.id), ['cover', 'body-thumb', 'body-default', 'body-armored', 'hat']);
  assert.equal(manifest.assets.some((asset) => 'url' in asset || 'source' in asset || 'legacy' in asset), false);
  assert.equal(JSON.stringify(manifest).includes('0xprivate'), false);
  assert.equal(JSON.stringify(manifest).includes('blob:private'), false);
  assert.equal(manifest.release.update.level, 'initial');
  assert.equal(manifest.legacyMoveProjection.authorizationCoverage, 'partial');
  assert.equal(manifest.legacyMoveProjection.parts[0].items[0].summaryItemKey, 'shape');
  assert.equal(manifest.legacyMoveProjection.parts[0].items[1].summaryItemKey, 'shape--armored');
  assert.equal(validateMakerV4Document(manifest), manifest);
});

test('referenced assets and quilt entries have deterministic identifier order', async () => {
  const document = publicationMaker();
  assert.deepEqual(collectReferencedMakerV4AssetIds(document), [
    'cover',
    'body-thumb',
    'body-default',
    'body-armored',
    'hat',
  ]);
  const entries = collectMakerV4UploadEntries(document, runtimeAssets(document));
  assert.deepEqual(entries.map((entry) => entry.identifier), [
    '10-cover.png',
    '20-body-thumb.png',
    '30-body-default.png',
    '40-body-armored.png',
    '50-hat.png',
  ]);

  const bundle = buildMakerV4PublicationBundle(document, runtimeAssets(document));
  assert.equal(bundle.entries.at(-1).identifier, MAKER_V4_MANIFEST_IDENTIFIER);
  assert.equal(bundle.entries.at(-1).kind, 'maker-manifest');
  assert.deepEqual(JSON.parse(await bundle.entries.at(-1).blob.text()), bundle.manifest);
  assert.equal(bundle.manifestJson, JSON.stringify(bundle.manifest));

  const files = bundle.entries.map((_, index) => ({ id: `patch-${index}`, blobId: `blob-${index}` }));
  const indexed = indexMakerV4UploadResults(bundle.entries, files);
  assert.equal(indexed.get('cover').id, 'patch-0');
  assert.equal(indexed.has(null), false);
});

test('embedded ExpansionPack assets stay in the immutable release graph', () => {
  const document = publicationMaker();
  document.extensions.expansionDrafts = [{
    packId: 'season-one',
    namespace: 's1',
    assets: [structuredClone(document.assets.find((asset) => asset.id === 'unused'))],
    parts: [],
    layerTracks: [],
    colorChannels: [],
    rules: [],
  }];
  assert.deepEqual(collectReferencedMakerV4AssetIds(document), [
    'unused',
    'cover',
    'body-thumb',
    'body-default',
    'body-armored',
    'hat',
  ]);
  const manifest = buildMakerV4PublicationManifest(document, {
    publicExtensions: { expansionRuntime: 'embedded-v1', expansionDrafts: document.extensions.expansionDrafts },
  });
  assert.equal(manifest.assets[0].id, 'unused');
  assert.equal(manifest.extensions.expansionRuntime, 'embedded-v1');
});

test('asset collection fails rather than silently replacing a missing Blob', () => {
  const document = publicationMaker();
  const runtime = runtimeAssets(document);
  runtime.delete('hat');
  assert.throws(
    () => collectMakerV4UploadEntries(document, runtime),
    (error) => error instanceof MakerV4PublicationError
      && error.code === 'missing-runtime-asset'
      && error.details.assetId === 'hat',
  );
});

test('Move summary projects Parts, Variants, colors and representable exclusions', () => {
  const document = publicationMaker();
  const summary = buildMakerV4MoveSummary(document, {
    assetLocations: assetLocations(),
    coverUrl: 'https://walrus.example/cover',
  });

  assert.deepEqual(summary.parts.map((part) => ({
    key: part.key,
    kind: part.kind,
    renderOrder: part.renderOrder,
    required: part.required,
    colors: part.colors,
  })), [
    { key: 'body', kind: 'standard', renderOrder: 0, required: true, colors: ['#d68f72', '#b9c8df'] },
    { key: 'hat', kind: 'standard', renderOrder: 1, required: false, colors: [MAKER_V4_NEUTRAL_COLOR] },
  ]);
  assert.deepEqual(summary.items.map((item) => ({
    partKey: item.partKey,
    itemKey: item.itemKey,
    blobId: item.blobId,
    iconBlobId: item.iconBlobId,
  })), [
    { partKey: 'body', itemKey: 'shape', blobId: 'patch-body-default', iconBlobId: 'patch-body-thumb' },
    { partKey: 'body', itemKey: 'shape--armored', blobId: 'patch-body-armored', iconBlobId: 'patch-body-thumb' },
    { partKey: 'hat', itemKey: 'moon-hat', blobId: 'patch-hat', iconBlobId: '' },
  ]);
  assert.deepEqual(summary.rules, [{
    leftPartKey: 'hat',
    leftItemKey: 'moon-hat',
    rightPartKey: 'body',
    rightItemKey: 'shape--armored',
  }]);
  assert.ok(summary.unrepresentedRules.some((issue) => issue.code === 'requires-not-supported-by-move-summary'));
  assert.ok(summary.unrepresentedRules.some((issue) => issue.code === 'parent-hierarchy-retained-on-walrus'));
  assert.equal(summary.authorizationCoverage, 'partial');
  assert.equal(summary.maker.coverUrl, 'https://walrus.example/cover');
  assert.throws(
    () => buildMakerV4MoveSummary(document, {
      assetLocations: assetLocations(),
      requireCompleteRuleProjection: true,
    }),
    (error) => error.code === 'partial-move-rule-projection',
  );
});

test('recipe projection keeps explicit None and never substitutes an optional default', () => {
  const document = publicationMaker();
  const result = flattenMakerV4Recipe(document, recipe({ hat: false }));

  assert.deepEqual(result.fullRecipe.selections, [{ partId: 'body', itemId: 'shape', variantId: 'default' }]);
  assert.deepEqual(result.suiRecipe, [{
    partKey: 'body',
    itemKey: 'shape',
    colorHex: '#b9c8df',
    renderOrder: 0,
  }]);
  assert.equal(result.fullRecipeJson, JSON.stringify(result.fullRecipe));
});

test('recipe projection rejects missing required Parts, implicit Variants and conflicts', () => {
  const document = publicationMaker();
  assert.throws(
    () => flattenMakerV4Recipe(document, { selections: [], colors: [{ channelId: 'skin', swatchId: 'warm' }] }),
    (error) => error.code === 'invalid-maker-recipe',
  );
  assert.throws(
    () => flattenMakerV4Recipe(document, {
      selections: [{ partId: 'body', itemId: 'shape' }],
      colors: [{ channelId: 'skin', swatchId: 'warm' }],
    }),
    (error) => error.code === 'missing-recipe-variant',
  );
  assert.throws(
    () => flattenMakerV4Recipe(document, {
      selections: { body: { itemId: 'shape' } },
      colors: [{ channelId: 'skin', swatchId: 'warm' }],
    }),
    (error) => error.code === 'missing-recipe-variant',
  );
  assert.throws(
    () => flattenMakerV4Recipe(document, recipe({ bodyVariant: 'armored', hat: true })),
    (error) => error.code === 'invalid-maker-recipe',
  );
  assert.throws(
    () => flattenMakerV4Recipe(document, { selections: recipe().selections, colors: [] }),
    (error) => error.code === 'missing-recipe-colors',
  );
});

test('OC package retains full v4 recipe beside the Sui summary recipe', async () => {
  const document = publicationMaker();
  const bridge = buildMakerV4OcPackage({
    document,
    recipe: recipe({ hat: false }),
    profile: { name: 'Mira', world: 'Astral Courier' },
    livingContent: { schemaVersion: 'animacraft.living-content.v1' },
    makerObjectId: '0xmaker',
    manifestBlobId: 'quilt-maker-v1',
    createdAt: '2026-07-12T12:00:00.000Z',
  });
  assert.equal(bridge.package.schemaVersion, 'animacraft.oc-package.v2');
  assert.equal(bridge.package.maker.versionId, 'astral-maker-v1');
  assert.deepEqual(bridge.package.recipe, bridge.fullRecipe);
  assert.deepEqual(bridge.package.suiSummary.recipe, bridge.suiRecipe);
  assert.equal(bridge.package.maker.manifestBlobId, 'quilt-maker-v1');

  const entries = buildMakerV4OcUploadEntries(new Blob(['png'], { type: 'image/png' }), bridge);
  assert.deepEqual(entries.map((entry) => entry.identifier), ['animacraft-oc.png', 'animacraft-oc.json']);
  const uploadedPackage = JSON.parse(await entries[1].blob.text());
  assert.deepEqual(uploadedPackage.recipe, bridge.fullRecipe);
  assert.deepEqual(uploadedPackage.suiSummary.recipe, bridge.suiRecipe);
});

test('version metadata detects breaking rendering updates and declaration mismatch', () => {
  const previous = publicationMaker();
  const breaking = publicationMaker({ version: 2, compatibility: 'breaking' });
  breaking.parts[0].items[0].variants[0].layerBindings[0].transform.x = 20;
  const metadata = buildMakerV4VersionMetadata(breaking, previous);
  assert.equal(metadata.update.level, 'breaking');
  assert.equal(metadata.update.renderCompatible, false);
  assert.equal(metadata.update.requiresPinnedVersion, true);
  assert.ok(metadata.update.breaking.some((issue) => issue.code === 'variant-rendering-changed'));

  const wronglyCompatible = structuredClone(breaking);
  wronglyCompatible.version.compatibility = 'compatible';
  wronglyCompatible.version.compatibleFrom = 1;
  assert.throws(
    () => buildMakerV4PublicationManifest(wronglyCompatible, { previousDocument: previous }),
    (error) => error.code === 'compatibility-declaration-mismatch',
  );
});
