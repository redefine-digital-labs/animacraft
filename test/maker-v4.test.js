import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_V4_BLEND_MODES,
  MAKER_V4_SCHEMA_VERSION,
  MakerV4ValidationError,
  collectMakerV4ValidationIssues,
  createCharacterMakerV4Starter,
  createMakerV4Document,
  isMakerV4Document,
  migrateMakerV3ToV4,
  validateMakerV4Document,
} from '../maker-v4.js';

test('character starter opens with a complete Part to LayerBinding upload graph', () => {
  const document = createCharacterMakerV4Starter({
    makerId: 'first-creator-maker',
    name: 'First Creator Maker',
    creator: '0xcreator',
  });

  assert.equal(document.parts.length, 8);
  assert.equal(document.layerTracks.length, 8);
  assert.equal(document.defaultRecipe.selections.length, 8);
  assert.deepEqual(document.parts.filter((part) => part.required).map((part) => part.id), ['skin-base', 'eyes']);
  document.parts.forEach((part, index) => {
    assert.equal(part.menuOrder, index);
    assert.equal(part.items.length, 1);
    assert.equal(part.items[0].variants.length, 1);
    assert.equal(part.items[0].variants[0].layerBindings.length, 1);
    assert.equal(part.items[0].variants[0].layerBindings[0].layerTrackId, document.layerTracks[index].id);
    assert.match(part.items[0].variants[0].layerBindings[0].assetId, /^pending-/);
  });
  assert.doesNotThrow(() => validateMakerV4Document(document, { mode: 'draft' }));
  assert.throws(() => validateMakerV4Document(document, { mode: 'publish' }), MakerV4ValidationError);
});

function validV4Document() {
  const document = createMakerV4Document({
    makerId: 'complex-maker',
    name: 'Complex Maker',
    creator: 'Animacraft Artist',
    pixelMode: 'pixelated',
    version: {
      versionNumber: 2,
      parentVersionId: 'complex-maker-v1',
      compatibility: 'compatible',
      compatibleFrom: 1,
      changelog: 'Adds a compatible hat layer.',
    },
  });
  document.metadata.summary = 'A complete Maker v4 fixture.';
  document.metadata.license.note = 'Personal use with creator credit.';
  document.metadata.coverAssetId = 'cover';
  document.assets = [
    { id: 'cover', identifier: 'maker-cover.png', kind: 'cover', mediaType: 'image/png', width: 1024, height: 1024 },
    { id: 'body-default', identifier: 'body-default.png', kind: 'layer', mediaType: 'image/png', width: 1024, height: 1024 },
    { id: 'body-armored', identifier: 'body-armored.png', kind: 'layer', mediaType: 'image/png', width: 1024, height: 1024 },
    { id: 'hat-default', identifier: 'hat-default.png', kind: 'layer', mediaType: 'image/png', width: 1024, height: 1024 },
  ];
  document.layerTracks = [
    { id: 'body-track', name: 'Body', order: 0 },
    { id: 'hat-track', name: 'Hat', order: 1 },
  ];
  document.colorChannels = [{
    id: 'skin-color',
    name: 'Skin Color',
    order: 0,
    mode: 'gradient-map',
    defaultSwatchId: 'warm',
    swatches: [{
      id: 'warm',
      name: 'Warm',
      hintColor: '#d68f72',
      stops: [
        { offset: 0, color: '#3b1e18' },
        { offset: 0.5, color: '#d68f72' },
        { offset: 1, color: '#fff1e9' },
      ],
    }],
  }];
  document.parts = [
    {
      id: 'body',
      name: 'Body',
      menuOrder: 0,
      menuVisible: true,
      required: true,
      defaultItemId: 'body-shape',
      parentPartId: null,
      iconAssetId: null,
      visibleWhen: null,
      requires: [],
      excludes: [],
      items: [{
        id: 'body-shape',
        name: 'Body Shape',
        displayOrder: 0,
        thumbnailAssetId: null,
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
            layerBindings: [{
              id: 'body-default-binding',
              layerTrackId: 'body-track',
              assetId: 'body-default',
              colorChannelId: 'skin-color',
              assetsBySwatch: [],
              transform: { x: 0, y: 0, scale: 1, rotation: 0 },
              opacity: 1,
              blendMode: 'normal',
              visibleWhen: null,
            }],
          },
          {
            id: 'armored',
            name: 'Armored',
            displayOrder: 1,
            visibleWhen: null,
            requires: [],
            excludes: [],
            layerBindings: [{
              id: 'body-armored-binding',
              layerTrackId: 'body-track',
              assetId: 'body-armored',
              colorChannelId: 'skin-color',
              assetsBySwatch: [],
              transform: { x: 0, y: 0, scale: 1, rotation: 0 },
              opacity: 1,
              blendMode: 'overlay',
              visibleWhen: null,
            }],
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
      visibleWhen: { op: 'selected', partId: 'body', itemId: 'body-shape' },
      requires: [{ partId: 'body' }],
      excludes: [],
      items: [{
        id: 'moon-hat',
        name: 'Moon Hat',
        displayOrder: 0,
        thumbnailAssetId: null,
        visibleWhen: null,
        requires: [{ partId: 'body', itemId: 'body-shape' }],
        excludes: [],
        defaultVariantId: 'default',
        variants: [{
          id: 'default',
          name: 'Default',
          displayOrder: 0,
          visibleWhen: null,
          requires: [],
          excludes: [{ partId: 'body', itemId: 'body-shape', variantId: 'armored' }],
          layerBindings: [{
            id: 'hat-default-binding',
            layerTrackId: 'hat-track',
            assetId: 'hat-default',
            colorChannelId: null,
            assetsBySwatch: [],
            transform: { x: 3, y: -8, scale: 1.1, rotation: 0 },
            opacity: 0.85,
            blendMode: 'multiply',
            visibleWhen: {
              op: 'all',
              conditions: [
                { op: 'selected', partId: 'body', itemId: 'body-shape', variantId: 'default' },
                { op: 'not', condition: { op: 'selected', partId: 'body', itemId: 'body-shape', variantId: 'armored' } },
              ],
            },
          }],
        }],
      }],
    },
  ];
  document.defaultRecipe = {
    selections: [
      { partId: 'body', itemId: 'body-shape', variantId: 'default' },
      { partId: 'hat', itemId: 'moon-hat', variantId: 'default' },
    ],
    colors: [{ channelId: 'skin-color', swatchId: 'warm' }],
  };
  document.expansionPacks = [{
    id: 'season-one',
    name: 'Season One',
    version: 1,
    manifestIdentifier: 'expansions/season-one.json',
    baseMakerId: 'complex-maker',
    baseMakerVersion: 2,
    required: false,
  }];
  return document;
}

function v3Item(id, layerIds, colorIds, prefix) {
  return {
    id,
    label: id,
    displayOrder: 1,
    visibility: 'public',
    iconIdentifier: '',
    images: layerIds.flatMap((layerId) => colorIds.map((colorId) => ({
      layerId,
      colorId,
      identifier: `${prefix}-${layerId}-${colorId}.png`,
    }))),
  };
}

function validV3Manifest() {
  const colors = [
    { id: 'violet', name: 'Violet', value: '#7b5cff' },
    { id: 'silver', name: 'Silver', value: '#d8deef' },
  ];
  const parts = [
    {
      key: 'base',
      label: 'Base',
      kind: 'last-bastion',
      menuVisible: true,
      allowRemove: false,
      defaultItemId: 'normal',
      iconIdentifier: '',
      layers: [{ id: 'body', name: 'Body', x: 0, y: 0, opacity: 100, blendMode: 'normal', renderOrder: 0 }],
      colors,
      items: [v3Item('normal', ['body'], ['violet', 'silver'], 'base')],
    },
    {
      key: 'hair',
      label: 'Hair',
      kind: 'standard',
      menuVisible: true,
      allowRemove: true,
      defaultItemId: 'long',
      iconIdentifier: '',
      layers: [
        { id: 'back', name: 'Hair Back', x: -2, y: 4, opacity: 100, blendMode: 'multiply', renderOrder: 1 },
        { id: 'front', name: 'Hair Front', x: -2, y: 4, opacity: 90, blendMode: 'screen', renderOrder: 2 },
      ],
      colors,
      items: [v3Item('long', ['back', 'front'], ['violet', 'silver'], 'hair')],
    },
    {
      key: 'outfit',
      label: 'Outfit',
      kind: 'standard',
      menuVisible: true,
      allowRemove: true,
      defaultItemId: 'coat',
      iconIdentifier: '',
      layers: [{ id: 'coat', name: 'Coat', x: 0, y: 0, opacity: 100, blendMode: 'overlay', renderOrder: 3 }],
      colors: [{ id: 'navy', name: 'Navy', value: '#1a2552' }],
      items: [v3Item('coat', ['coat'], ['navy'], 'outfit')],
    },
  ];
  const identifiers = parts.flatMap((part) => part.items.flatMap((item) => item.images.map((image) => image.identifier)));
  return {
    schemaVersion: 'animacraft.creator-template.v3',
    template: {
      id: 'astral-courier',
      name: 'Astral Courier',
      summary: 'Migration fixture.',
      creator: 'Angie',
      style: 'Cel shaded',
      license: 'personal-use',
      licenseNote: 'Personal use with credit.',
      royaltyBps: 300,
      mintingEnabled: true,
      mintFeeEnabled: false,
      mintPriceAtomic: 0,
      paymentCoinType: '',
      paymentCoinSymbol: 'USDC',
      storage: 'walrus',
      chain: 'sui',
      canvas: { width: 1024, height: 1024 },
      coverIdentifier: 'maker-cover.png',
    },
    runtime: { network: 'mainnet', assetAddressing: 'walrus-quilt-id+identifier' },
    parts,
    rules: [{ leftPartKey: 'hair', leftItemKey: 'long', rightPartKey: 'outfit', rightItemKey: 'coat' }],
    paletteLinks: [{ primaryPartKey: 'base', linkedPartKey: 'hair' }],
    livingContent: { schemaVersion: 'animacraft.living-content.v1', soulMd: '# Soul' },
    assets: [...identifiers, 'maker-cover.png'].map((identifier) => ({ identifier, type: 'image/png' })),
    customV3Field: { retained: true },
  };
}

test('validates the complete Maker v4 hierarchy and advanced editor fields', () => {
  const document = validV4Document();
  assert.equal(validateMakerV4Document(document), document);
  assert.equal(isMakerV4Document(document), true);
  assert.equal(document.schemaVersion, MAKER_V4_SCHEMA_VERSION);
  assert.ok(MAKER_V4_BLEND_MODES.includes('linear-dodge'));
  assert.equal(document.canvas.pixelMode, 'pixelated');
  assert.equal(document.parts[1].parentPartId, 'body');
  assert.equal(document.parts[1].items[0].variants[0].layerBindings[0].blendMode, 'multiply');
  assert.equal(document.expansionPacks[0].baseMakerVersion, 2);
});

test('strict validation reports invalid references, modes, conditions, and defaults with paths', () => {
  const document = validV4Document();
  document.canvas.pixelMode = 'nearest-ish';
  document.parts[0].defaultItemId = 'missing-item';
  document.parts[1].items[0].variants[0].layerBindings[0].blendMode = 'magic-light';
  document.parts[1].items[0].variants[0].layerBindings[0].layerTrackId = 'missing-track';
  document.parts[1].visibleWhen = { op: 'selected', partId: 'missing-part' };

  const issues = collectMakerV4ValidationIssues(document);
  assert.ok(issues.some((entry) => entry.path === 'canvas.pixelMode' && entry.code === 'invalid_pixel_mode'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.defaultItemId') && entry.code === 'missing_reference'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.blendMode') && entry.code === 'invalid_blend_mode'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.layerTrackId') && entry.code === 'missing_reference'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.visibleWhen.partId') && entry.code === 'missing_reference'));
  assert.throws(
    () => validateMakerV4Document(document),
    (error) => error instanceof MakerV4ValidationError
      && error.issues.some((entry) => entry.code === 'invalid_pixel_mode'),
  );
});

test('rejects parent cycles, contradictory requires/excludes, and incompatible ExpansionPack refs', () => {
  const document = validV4Document();
  document.parts[0].parentPartId = 'hat';
  document.parts[1].requires.push({ partId: 'body', itemId: 'body-shape' });
  document.parts[1].excludes.push({ partId: 'body', itemId: 'body-shape' });
  document.expansionPacks[0].baseMakerVersion = 99;

  const issues = collectMakerV4ValidationIssues(document);
  assert.ok(issues.some((entry) => entry.code === 'cycle'));
  assert.ok(issues.some((entry) => entry.code === 'contradictory_rule'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.baseMakerVersion')));
});

test('migrates a published v3 manifest without mutating it or losing layer/color/rule semantics', () => {
  const source = validV3Manifest();
  const before = structuredClone(source);
  const document = migrateMakerV3ToV4(source, { validate: 'publish' });

  assert.deepEqual(source, before);
  assert.equal(document.schemaVersion, MAKER_V4_SCHEMA_VERSION);
  assert.equal(document.version.number, 1);
  assert.equal(document.version.compatibility, 'initial');
  assert.equal(document.metadata.name, source.template.name);
  assert.equal(document.publication.royaltyBps, 300);
  assert.deepEqual(document.runtime, source.runtime);
  assert.deepEqual(document.livingContent, source.livingContent);
  assert.deepEqual(document.extensions.legacyV3.unmappedTopLevel.customV3Field, { retained: true });

  assert.deepEqual(document.layerTracks.map((track) => track.name), ['Body', 'Hair Back', 'Hair Front', 'Coat']);
  assert.equal(document.colorChannels.length, 2, 'linked base/hair palettes become one shared channel');
  const base = document.parts.find((part) => part.id === 'base');
  const hair = document.parts.find((part) => part.id === 'hair');
  const outfit = document.parts.find((part) => part.id === 'outfit');
  assert.equal(base.required, true);
  assert.equal(hair.items[0].variants.length, 1);
  assert.equal(hair.items[0].variants[0].layerBindings.length, 2);
  assert.equal(hair.items[0].variants[0].layerBindings[0].transform.x, -2);
  assert.equal(hair.items[0].variants[0].layerBindings[0].blendMode, 'multiply');
  assert.equal(hair.items[0].variants[0].layerBindings[0].assetsBySwatch.length, 2);
  assert.equal(
    hair.items[0].variants[0].layerBindings[0].colorChannelId,
    base.items[0].variants[0].layerBindings[0].colorChannelId,
  );
  assert.deepEqual(hair.items[0].excludes, [{ partId: 'outfit', itemId: 'coat' }]);
  assert.deepEqual(outfit.items[0].excludes, [{ partId: 'hair', itemId: 'long' }]);
  assert.equal(validateMakerV4Document(document), document);
});

test('migrates the current local v3 model as a recoverable draft and preserves local asset incompleteness', () => {
  const source = {
    canvas: { width: 2048, height: 2048 },
    slots: [{
      key: 'face',
      label: 'Face',
      kind: 'last-bastion',
      menuVisible: true,
      allowRemove: false,
      defaultItemId: 'round',
      layers: [{ id: 'base', name: 'Face Base', x: 12, y: -4, scale: 1.2, opacity: 75, blendMode: 'screen', renderOrder: 0 }],
      colors: [
        { id: 'default', name: 'Default', value: '#f1c9b1' },
        { id: 'cool', name: 'Cool', value: '#b9c8df' },
      ],
      iconAsset: null,
    }],
    parts: {
      face: [{
        id: 'round',
        label: 'Round',
        displayOrder: 1,
        images: { 'base:default': { url: 'blob:local-face', width: 2048, height: 2048 } },
        iconAsset: null,
      }],
    },
    slotOrder: ['face'],
    layerOrder: ['face:base'],
    visual: { face: 'round', palette: { face: '#f1c9b1' } },
    rules: [],
    paletteLinks: [],
    assets: [],
    publishDigest: 'local-session-field',
  };
  const before = structuredClone(source);
  const document = migrateMakerV3ToV4(source, {
    makerId: 'local-face-maker',
    metadata: { name: 'Local Face Maker' },
    validate: 'draft',
  });

  assert.deepEqual(source, before);
  assert.equal(document.canvas.width, 2048);
  assert.equal(document.parts[0].required, true);
  const binding = document.parts[0].items[0].variants[0].layerBindings[0];
  assert.deepEqual(binding.transform, { x: 12, y: -4, scale: 1.2, rotation: 0 });
  assert.equal(binding.opacity, 0.75);
  assert.equal(binding.blendMode, 'screen');
  assert.equal(document.assets.find((asset) => asset.id === binding.assetId).identifier, null);
  assert.equal(document.extensions.legacyV3.unmappedTopLevel.publishDigest, 'local-session-field');
  assert.deepEqual(collectMakerV4ValidationIssues(document, { mode: 'draft' }), []);
  const publishIssues = collectMakerV4ValidationIssues(document, { mode: 'publish' });
  assert.ok(publishIssues.some((entry) => entry.code === 'missing_asset_identifier'));
  assert.ok(publishIssues.some((entry) => entry.code === 'invalid_color_mapping'));
  assert.ok(publishIssues.some((entry) => entry.path === 'metadata.coverAssetId'));
});

test('migrates the existing IndexedDB v3 draft wrapper and keeps its session recovery fields', () => {
  const manifest = validV3Manifest();
  const source = {
    templateId: 'astral-courier',
    savedAt: '2026-07-12T00:00:00.000Z',
    manifest,
    visual: {
      base: 'normal',
      hair: 'long',
      outfit: 'coat',
      palette: { base: '#d8deef', hair: '#d8deef', outfit: '#1a2552' },
    },
    rules: manifest.rules,
    paletteLinks: manifest.paletteLinks,
    chain: { makerObjectId: '0x123' },
  };
  const document = migrateMakerV3ToV4(source, { validate: 'publish' });

  assert.equal(document.extensions.legacyV3.sourceKind, 'saved-draft');
  assert.equal(document.extensions.legacyV3.unmappedTopLevel.templateId, 'astral-courier');
  assert.deepEqual(document.extensions.legacyV3.unmappedTopLevel.chain, { makerObjectId: '0x123' });
  const sharedChannel = document.colorChannels.find((channel) => channel.name.includes('Base'));
  assert.equal(sharedChannel.defaultSwatchId, 'silver');
});

test('migration clones an already-v4 document rather than aliasing mutable data', () => {
  const source = validV4Document();
  const migrated = migrateMakerV3ToV4(source, { validate: true });
  assert.deepEqual(migrated, source);
  assert.notEqual(migrated, source);
  migrated.parts[0].name = 'Changed';
  assert.equal(source.parts[0].name, 'Body');
});
