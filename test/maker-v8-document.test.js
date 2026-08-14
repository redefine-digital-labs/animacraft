import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_V8_DOCUMENT_SCHEMA,
  MakerV8DocumentValidationError,
  assertMakerV8Document,
  collectMakerV8DocumentIssues,
  createCharacterMakerV8Starter,
  createMakerV8ActivationIntent,
  createMakerV8Document,
  isMakerV8Document,
  makerV8Inventory,
} from '../maker-v8-document.js';

function compiledDocument() {
  const document = structuredClone(createMakerV8Document({
    makerId: 'astral-courier',
    name: 'Astral Courier',
    creator: '0xcreator',
    commerce: { rightsOriginConfirmed: true },
  }));
  document.metadata.summary = 'A unified v8 Maker.';
  document.metadata.coverAssetId = 'cover';
  document.assets = [
    {
      id: 'cover',
      kind: 'maker-cover',
      mediaType: 'image/png',
      sha256: '1'.repeat(64),
      byteLength: 1_024,
    },
    {
      id: 'base-png',
      kind: 'layer',
      mediaType: 'image/png',
      sha256: '2'.repeat(64),
      byteLength: 2_048,
    },
  ];
  document.layerTracks = [{
    id: 'base-track', name: 'Base', order: 0, locked: false, referenceAssetId: null,
  }];
  document.colorChannels = [{
    id: 'skin-tone',
    name: 'Skin tone',
    order: 0,
    mode: 'gradient-map',
    defaultSwatchId: 'default-skin',
    swatches: [{
      id: 'default-skin',
      name: 'Default',
      hintColor: '#f1c5a8',
      stops: [
        { offset: 0, color: '#5a321f' },
        { offset: 1, color: '#f1c5a8' },
      ],
    }],
  }];
  document.parts = [{
    id: 'base',
    name: 'Base',
    menuOrder: 0,
    menuVisible: true,
    required: true,
    wardrobeMode: 'FIXED',
    defaultItemId: 'body',
    parentPartId: null,
    iconAssetId: null,
    visibleWhen: null,
    requires: [],
    excludes: [],
    items: [{
      id: 'body',
      name: 'Body',
      displayOrder: 0,
      importKey: 'body',
      status: 'public',
      thumbnailAssetId: null,
      visibleWhen: null,
      requires: [],
      excludes: [],
      defaultStyleId: 'default',
      styles: [{
        id: 'default',
        name: 'Default',
        displayOrder: 0,
        layerTrackId: 'base-track',
        colorChannelId: 'skin-tone',
        assetId: 'base-png',
        transform: { x: 0, y: 0, scale: 1, rotation: 0 },
        positionConfirmed: true,
        positionLocked: false,
        styleLocked: false,
        opacity: 1,
        blendMode: 'normal',
        visibleWhen: null,
        requires: [],
        excludes: [],
        seal: { protected: false, scopeId: '' },
        physical: { enabled: false },
      }],
    }],
  }];
  document.defaultRecipe = {
    selections: [{ partId: 'base', itemId: 'body', styleId: 'default' }],
    colors: [{ channelId: 'skin-tone', swatchId: 'default-skin' }],
  };
  return document;
}

function commitments() {
  return {
    core: { expectedCount: 5, expectedCommitment: '3'.repeat(64) },
    composition: { expectedCount: 0, expectedCommitment: '4'.repeat(64) },
    packs: { expectedCount: 0, expectedCommitment: '5'.repeat(64) },
    complete: { expectedCount: 1, expectedCommitment: '6'.repeat(64) },
    seal: { expectedCount: 0, expectedCommitment: '7'.repeat(64) },
    physical: { expectedCount: 0, expectedCommitment: '8'.repeat(64) },
  };
}

test('new Maker documents are exact v8 drafts and reject every older schema', () => {
  const document = createMakerV8Document();
  assert.equal(document.schemaVersion, MAKER_V8_DOCUMENT_SCHEMA);
  assert.equal(document.protocolVersion, 8);
  assert.equal(Object.isFrozen(document), true);
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'draft' }).length, 0);
  assert.equal(isMakerV8Document(document), true);

  for (const schemaVersion of [
    'animacraft.maker.v5',
    'animacraft.creator-template.v4',
    'animacraft.creator-template.v3',
  ]) {
    const old = { ...document, schemaVersion };
    assert.equal(isMakerV8Document(old), false);
    assert.throws(
      () => assertMakerV8Document(old),
      (error) => error instanceof MakerV8DocumentValidationError
        && error.code === 'MAKER_V8_DOCUMENT_SCHEMA_INVALID',
    );
  }
});

test('the v8 starter keeps the established Creator Track, Part, Item, Style, and Recipe vocabulary', () => {
  const document = createCharacterMakerV8Starter({ makerId: 'shared-editor' });
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'draft' }), []);
  assert.equal(document.parts.length, 8);
  assert.equal(document.layerTracks.length, 8);
  const part = document.parts[0];
  const item = part.items[0];
  const style = item.styles[0];
  assert.equal(part.menuOrder, 0);
  assert.equal(part.menuVisible, true);
  assert.equal(part.wardrobeMode, 'FIXED');
  assert.equal(Object.hasOwn(part, 'layerTrackId'), false);
  assert.equal(Object.hasOwn(part, 'order'), false);
  assert.equal(item.displayOrder, 0);
  assert.equal(item.status, 'public');
  assert.equal(style.displayOrder, 0);
  assert.equal(style.layerTrackId, document.layerTracks[0].id);
  assert.deepEqual(document.defaultRecipe.selections[0], {
    partId: part.id,
    itemId: item.id,
    styleId: style.id,
  });
});

test('compile validation binds cover, assets, shared definitions, rules, and native commerce', () => {
  const document = compiledDocument();
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  assert.deepEqual(makerV8Inventory(document), {
    tracks: 1,
    parts: 1,
    items: 1,
    styles: 1,
    colorChannels: 1,
    colors: 1,
    rules: 0,
    packs: 0,
    assets: 2,
    compositionSlots: 0,
    protectedStyles: 0,
    physicalStyles: 0,
  });

  document.metadata.coverAssetId = 'missing';
  assert.deepEqual(
    collectMakerV8DocumentIssues(document, { mode: 'compile' })
      .filter((entry) => entry.path === 'metadata.coverAssetId')
      .map((entry) => entry.code),
    ['MAKER_V8_COVER_REQUIRED'],
  );
});

test('activation intent binds exact document inventory and every explicit registry', () => {
  const document = compiledDocument();
  const intent = createMakerV8ActivationIntent(document, {
    manifestBlobId: 'walrus-quilt-id',
    manifestSha256: '9'.repeat(64),
    contentCommitment: 'a'.repeat(64),
    registryCommitments: commitments(),
    physicalWitnessType: `0x${'b'.repeat(64)}::physical_v8::PhysicalBindingWitnessV8`,
  });
  assert.equal(intent.schemaVersion, 'animacraft.maker-v8-activation-intent.v1');
  assert.equal(intent.registries.core.expectedCount, 5);
  assert.equal(intent.registries.complete.expectedCount, 1);
  assert.equal(Object.isFrozen(intent), true);
  assert.equal('legacyMakerId' in intent, false);
  assert.equal('commerceV5RootId' in intent, false);

  const wrong = commitments();
  wrong.core.expectedCount = 4;
  assert.throws(
    () => createMakerV8ActivationIntent(document, {
      manifestBlobId: 'walrus-quilt-id',
      manifestSha256: '9'.repeat(64),
      contentCommitment: 'a'.repeat(64),
      registryCommitments: wrong,
      physicalWitnessType: `0x${'b'.repeat(64)}::physical_v8::PhysicalBindingWitnessV8`,
    }),
    /core registry count does not match/,
  );
});

test('disabled capabilities cannot silently carry v8 feature declarations', () => {
  const document = compiledDocument();
  document.capabilities.seal = false;
  document.capabilities.physical = false;
  document.parts[0].items[0].styles[0].seal = { protected: true, scopeId: 'base-style' };
  document.parts[0].items[0].styles[0].physical = { enabled: true };
  const codes = collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .map((entry) => entry.code);
  assert.equal(codes.includes('MAKER_V8_SEAL_CAPABILITY_REQUIRED'), true);
  assert.equal(codes.includes('MAKER_V8_PHYSICAL_CAPABILITY_REQUIRED'), true);
});

test('shared references, hierarchy, embedded rules, and default Recipe fail closed', () => {
  const document = compiledDocument();
  document.layerTracks[0].referenceAssetId = 'missing-reference';
  document.parts[0].parentPartId = 'base';
  document.parts[0].items[0].requires = [{ partId: 'missing-part' }];
  document.defaultRecipe.selections[0].styleId = 'missing-style';
  document.defaultRecipe.colors[0].swatchId = 'missing-swatch';
  const codes = new Set(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .map((entry) => entry.code));
  assert.equal(codes.has('MAKER_V8_TRACK_REFERENCE_UNKNOWN'), true);
  assert.equal(codes.has('MAKER_V8_PARENT_PART_SELF'), true);
  assert.equal(codes.has('MAKER_V8_RULE_PART_UNKNOWN'), true);
  assert.equal(codes.has('MAKER_V8_RULE_STYLE_UNKNOWN'), true);
  assert.equal(codes.has('MAKER_V8_DEFAULT_STYLE_MISMATCH'), true);
  assert.equal(codes.has('MAKER_V8_DEFAULT_SWATCH_UNKNOWN'), true);
  assert.equal(codes.has('MAKER_V8_DEFAULT_SWATCH_MISMATCH'), true);
});
