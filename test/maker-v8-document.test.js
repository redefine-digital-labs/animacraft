import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_V8_DOCUMENT_SCHEMA,
  MakerV8DocumentValidationError,
  assertMakerV8Document,
  collectMakerV8DocumentIssues,
  createCharacterMakerV8Starter,
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

test('new Maker documents are exact v8 drafts and reject every older schema', () => {
  const document = createMakerV8Document();
  assert.equal(document.schemaVersion, MAKER_V8_DOCUMENT_SCHEMA);
  assert.equal(document.protocolVersion, 8);
  assert.equal(Object.isFrozen(document), true);
  assert.equal(collectMakerV8DocumentIssues(document, { mode: 'draft' }).length, 0);
  assert.equal(isMakerV8Document(document), true);
  assert.equal(Object.hasOwn(document.capabilities, 'commerce'), false);
  assert.equal(document.lineage.previousVersionCommitment, null);

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

test('only Physical is optional and successor lineage binds the previous version commitment', () => {
  const initial = compiledDocument();
  initial.capabilities.complete = false;
  initial.capabilities.commerce = true;
  const initialCodes = new Set(collectMakerV8DocumentIssues(initial, { mode: 'compile' })
    .map((entry) => entry.code));
  assert.equal(initialCodes.has('MAKER_V8_REQUIRED_CAPABILITY_DISABLED'), true);
  assert.equal(initialCodes.has('MAKER_V8_CAPABILITY_UNKNOWN'), true);

  const successor = structuredClone(createMakerV8Document({
    lineage: {
      number: 2,
      previousRootId: `0x${'a'.repeat(64)}`,
      previousVersionCommitment: 'b'.repeat(64),
    },
  }));
  assert.equal(successor.lineage.previousVersionCommitment, 'b'.repeat(64));
  assert.equal(collectMakerV8DocumentIssues(successor, { mode: 'draft' })
    .some((entry) => entry.code === 'MAKER_V8_PREVIOUS_COMMITMENT_INVALID'), false);

  successor.lineage.previousVersionCommitment = null;
  assert.equal(collectMakerV8DocumentIssues(successor, { mode: 'draft' })
    .some((entry) => entry.code === 'MAKER_V8_PREVIOUS_COMMITMENT_INVALID'), true);
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

test('constructors, validation modes, and Creator limits fail closed without raw crashes', () => {
  assert.doesNotThrow(() => createMakerV8Document(null));
  assert.doesNotThrow(() => createMakerV8Document({
    lineage: null,
    capabilities: null,
    commerce: null,
  }));
  const document = structuredClone(createMakerV8Document());
  document.metadata.id = 'x'.repeat(129);
  document.layerTracks = Array.from({ length: 2_049 }, (_, order) => ({
    id: `track-${order}`,
    name: `Track ${order}`,
    order,
    locked: false,
    referenceAssetId: null,
  }));
  const codes = new Set(collectMakerV8DocumentIssues(document, { mode: 'unsupported' })
    .map((entry) => entry.code));
  assert.equal(codes.has('MAKER_V8_VALIDATION_MODE_INVALID'), true);
  assert.equal(codes.has('MAKER_V8_ID_INVALID'), true);
  assert.equal(codes.has('MAKER_V8_TRACK_LIMIT'), true);
});

test('compile validation executes the shared Creator rule engine', () => {
  const document = compiledDocument();
  const selection = { partId: 'base', itemId: 'body', styleId: 'default' };
  document.rules.push({
    id: 'self-exclude',
    type: 'excludes',
    trigger: selection,
    targets: [selection],
  });
  const codes = new Set(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .map((entry) => entry.code));
  assert.equal(codes.has('MAKER_V8_DEFAULT_RECIPE_RULE_VIOLATION'), true);
  assert.equal(codes.has('MAKER_V8_RULE_GRAPH_UNSATISFIABLE'), true);
});
