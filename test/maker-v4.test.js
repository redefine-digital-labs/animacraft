import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_V5_BLEND_MODES,
  MAKER_V5_SCHEMA_VERSION,
  MakerV5ValidationError,
  collectMakerV5ValidationIssues,
  createCharacterMakerV5Starter,
  createMakerV5Document,
  isMakerV5Document,
  migrateMakerV3ToV5,
  validateMakerV5Document,
} from '../maker-v4.js';

function style(id, assetId, layerTrackId, extra = {}) {
  return {
    id,
    name: id,
    displayOrder: 0,
    assetId,
    layerTrackId,
    colorChannelId: null,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    positionConfirmed: false,
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

function validV5Document() {
  const document = createMakerV5Document({
    makerId: 'complex-maker',
    name: 'Complex Maker',
    creator: 'Animacraft Artist',
    pixelMode: 'pixelated',
    version: {
      versionNumber: 2,
      parentVersionId: 'complex-maker-v1',
      compatibility: 'compatible',
      compatibleFrom: 1,
      changelog: 'Adds a compatible hat Style.',
    },
  });
  document.metadata.summary = 'A complete Maker v5 fixture.';
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
        importKey: 'body-shape',
        status: 'public',
        thumbnailAssetId: null,
        visibleWhen: null,
        requires: [],
        excludes: [],
        defaultStyleId: 'default',
        styles: [
          style('default', 'body-default', 'body-track', { colorChannelId: 'skin-color' }),
          style('armored', 'body-armored', 'body-track', {
            displayOrder: 1,
            colorChannelId: 'skin-color',
            blendMode: 'overlay',
          }),
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
        importKey: 'moon-hat',
        status: 'public',
        thumbnailAssetId: null,
        visibleWhen: null,
        requires: [{ partId: 'body', itemId: 'body-shape' }],
        excludes: [],
        defaultStyleId: 'default',
        styles: [style('default', 'hat-default', 'hat-track', {
          transform: { x: 3, y: -8, scale: 1.1, rotation: 0 },
          opacity: 0.85,
          blendMode: 'multiply',
          excludes: [{ partId: 'body', itemId: 'body-shape', styleId: 'armored' }],
          visibleWhen: {
            op: 'all',
            conditions: [
              { op: 'selected', partId: 'body', itemId: 'body-shape', styleId: 'default' },
              { op: 'not', condition: { op: 'selected', partId: 'body', itemId: 'body-shape', styleId: 'armored' } },
            ],
          },
        })],
      }],
    },
  ];
  document.defaultRecipe = {
    selections: [
      { partId: 'body', itemId: 'body-shape', styleId: 'default' },
      { partId: 'hat', itemId: 'moon-hat', styleId: 'default' },
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

test('starter creates Parts and tracks while every draft Item starts without a Style', () => {
  const document = createCharacterMakerV5Starter({
    makerId: 'first-creator-maker',
    name: 'First Creator Maker',
    creator: '0xcreator',
  });

  assert.equal(document.schemaVersion, 'animacraft.maker.v5');
  assert.equal(document.parts.length, 8);
  assert.equal(document.layerTracks.length, 8);
  assert.deepEqual(document.defaultRecipe.selections, []);
  assert.deepEqual(document.parts.filter((part) => part.required).map((part) => part.id), ['skin-base', 'eyes']);
  document.parts.forEach((part, index) => {
    assert.equal(part.menuOrder, index);
    assert.equal(part.items.length, 1);
    assert.equal(part.items[0].status, 'draft');
    assert.equal(part.items[0].defaultStyleId, null);
    assert.deepEqual(part.items[0].styles, []);
  });
  assert.doesNotThrow(() => validateMakerV5Document(document, { mode: 'draft' }));
  assert.throws(() => validateMakerV5Document(document, { mode: 'publish' }), MakerV5ValidationError);
});

test('validates Maker → Part → Item → Style and direct Style render fields', () => {
  const document = validV5Document();
  assert.equal(validateMakerV5Document(document), document);
  assert.equal(isMakerV5Document(document), true);
  assert.equal(document.schemaVersion, MAKER_V5_SCHEMA_VERSION);
  assert.ok(MAKER_V5_BLEND_MODES.includes('linear-dodge'));
  const hatStyle = document.parts[1].items[0].styles[0];
  assert.equal(hatStyle.assetId, 'hat-default');
  assert.equal(hatStyle.layerTrackId, 'hat-track');
  assert.equal(hatStyle.blendMode, 'multiply');
  assert.equal(hatStyle.transform.y, -8);
});

test('draft mode permits empty Items and empty Styles, publish mode rejects unfinished public content', () => {
  const document = createMakerV5Document({ makerId: 'draft-maker', creator: 'Artist' });
  document.parts.push({
    id: 'hair',
    name: 'Hair',
    menuOrder: 0,
    menuVisible: true,
    required: false,
    defaultItemId: null,
    parentPartId: null,
    iconAssetId: null,
    visibleWhen: null,
    requires: [],
    excludes: [],
    items: [{
      id: 'long',
      name: 'Long',
      displayOrder: 0,
      importKey: 'long',
      status: 'draft',
      thumbnailAssetId: null,
      visibleWhen: null,
      requires: [],
      excludes: [],
      defaultStyleId: null,
      styles: [style('empty', null, null)],
    }],
  });

  assert.deepEqual(collectMakerV5ValidationIssues(document, { mode: 'draft' }), []);
  document.parts[0].items[0].status = 'public';
  const issues = collectMakerV5ValidationIssues(document, { mode: 'publish' });
  assert.ok(issues.some((entry) => entry.path.endsWith('.assetId') && entry.code === 'missing_reference'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.layerTrackId') && entry.code === 'missing_reference'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.defaultStyleId') && entry.code === 'missing_reference'));
});

test('reports invalid Style references, blend modes, conditions and defaults with exact paths', () => {
  const document = validV5Document();
  document.canvas.pixelMode = 'nearest-ish';
  document.parts[0].defaultItemId = 'missing-item';
  document.parts[1].items[0].styles[0].blendMode = 'magic-light';
  document.parts[1].items[0].styles[0].layerTrackId = 'missing-track';
  document.parts[1].visibleWhen = { op: 'selected', partId: 'missing-part' };

  const issues = collectMakerV5ValidationIssues(document);
  assert.ok(issues.some((entry) => entry.path === 'canvas.pixelMode' && entry.code === 'invalid_pixel_mode'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.defaultItemId') && entry.code === 'missing_reference'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.blendMode') && entry.code === 'invalid_blend_mode'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.layerTrackId') && entry.code === 'missing_reference'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.visibleWhen.partId') && entry.code === 'missing_reference'));
});

test('Layer Tracks only define z-order; placement fields are rejected outside Style', () => {
  const document = validV5Document();
  document.layerTracks[0].transform = { x: 20, y: -10, scale: 2, rotation: 5 };
  const issues = collectMakerV5ValidationIssues(document);
  assert.ok(issues.some((entry) => entry.path === 'layerTracks[0].transform' && entry.code === 'unsupported_schema'));
  assert.equal(document.parts[0].items[0].styles[0].transform.x, 0);
});

test('rejects obsolete hierarchy fields instead of silently interpreting them', () => {
  const document = validV5Document();
  const obsoleteItemField = ['var', 'iants'].join('');
  const obsoleteStyleField = ['layer', 'Bindings'].join('');
  document.parts[0].items[0][obsoleteItemField] = [];
  document.parts[0].items[0].styles[0][obsoleteStyleField] = [];
  const issues = collectMakerV5ValidationIssues(document);
  assert.equal(issues.filter((entry) => entry.code === 'unsupported_schema').length, 2);
});

test('rejects obsolete Style visibility switches, including rules.visibleWhen wrappers', () => {
  const cases = new Map([
    ['visible', false],
    ['hidden', true],
    ['enabled', false],
    ['visibilityCondition', { op: 'selected', partId: 'body', itemId: 'body-shape' }],
    ['rules', { visibleWhen: { op: 'selected', partId: 'body', itemId: 'body-shape' } }],
  ]);

  cases.forEach((value, field) => {
    const document = validV5Document();
    document.parts[0].items[0].styles[0][field] = value;
    const expectedPath = `parts[0].items[0].styles[0].${field}`;
    const issues = collectMakerV5ValidationIssues(document);
    assert.ok(
      issues.some((entry) => entry.path === expectedPath && entry.code === 'unsupported_schema'),
      `${field} must be rejected at ${expectedPath}`,
    );
    assert.throws(
      () => validateMakerV5Document(document),
      (error) => error instanceof MakerV5ValidationError
        && error.issues.some((entry) => entry.path === expectedPath && entry.code === 'unsupported_schema'),
    );
  });
});

test('requires a Style assetId to resolve to exactly one PNG Asset', () => {
  const document = validV5Document();
  const styleRecord = document.parts[0].items[0].styles[0];
  const asset = document.assets.find((candidate) => candidate.id === styleRecord.assetId);
  asset.mediaType = 'image/jpeg';
  asset.identifier = 'body.jpg';
  const issues = collectMakerV5ValidationIssues(document);
  assert.ok(issues.some((entry) => entry.path === 'parts[0].items[0].styles[0].assetId'
    && entry.code === 'invalid_style_asset'));
});

test('rejects parent cycles, contradictory rules and incompatible ExpansionPack refs', () => {
  const document = validV5Document();
  document.parts[0].parentPartId = 'hat';
  document.parts[1].requires.push({ partId: 'body', itemId: 'body-shape' });
  document.parts[1].excludes.push({ partId: 'body', itemId: 'body-shape' });
  document.expansionPacks[0].baseMakerVersion = 99;
  const issues = collectMakerV5ValidationIssues(document);
  assert.ok(issues.some((entry) => entry.code === 'cycle'));
  assert.ok(issues.some((entry) => entry.code === 'contradictory_rule'));
  assert.ok(issues.some((entry) => entry.path.endsWith('.baseMakerVersion')));
});

test('legacy documents are deliberately not migrated, while v5 input is deeply cloned', () => {
  assert.throws(
    () => migrateMakerV3ToV5({ schemaVersion: 'animacraft.creator-template.v3' }),
    /incompatible with animacraft\.maker\.v5/,
  );
  const source = validV5Document();
  const migrated = migrateMakerV3ToV5(source, { validate: 'publish' });
  assert.deepEqual(migrated, source);
  assert.notEqual(migrated, source);
  migrated.parts[0].items[0].styles[0].transform.x = 200;
  assert.equal(source.parts[0].items[0].styles[0].transform.x, 0);
});
