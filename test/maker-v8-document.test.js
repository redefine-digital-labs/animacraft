import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_V8_CAPABILITIES,
  MAKER_V8_COMPLETE_PACK_POLICY_MODES,
  MAKER_V8_COMPOSITION_MODES,
  MAKER_V8_DOCUMENT_SCHEMA,
  MAKER_V8_THIRD_PARTY_ADMISSION_MODES,
  MakerV8DocumentValidationError,
  assertMakerV8Document,
  collectMakerV8AuthorShapeIssues,
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
      byteLength: 1_024,
    },
    {
      id: 'base-png',
      kind: 'layer',
      mediaType: 'image/png',
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
        seal: { protected: false },
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
  assert.deepEqual(
    Object.fromEntries(MAKER_V8_CAPABILITIES.map((name) => [name, document.capabilities[name]])),
    Object.fromEntries(MAKER_V8_CAPABILITIES.map((name) => [name, true])),
  );
  assert.equal(document.capabilities.physical, true);
  assert.equal(document.capabilities.market, true);
  assert.equal(Object.hasOwn(document.lineage, 'previousRootId'), false);
  assert.equal(Object.hasOwn(document.lineage, 'previousVersionCommitment'), false);
  assert.equal(Object.hasOwn(document, 'packs'), false);
  assert.equal(Object.hasOwn(document.commerce, 'packPolicies'), false);
  assert.deepEqual(document.composition, {
    mode: MAKER_V8_COMPOSITION_MODES.FIXED,
    thirdPartyAdmission: MAKER_V8_THIRD_PARTY_ADMISSION_MODES.DISABLED,
    itemAssetization: false,
  });
  assert.deepEqual(document.complete.outputs[0].allowedPackPolicy, {
    mode: MAKER_V8_COMPLETE_PACK_POLICY_MODES.ALL_ADMITTED,
    packIds: [],
    scopes: [],
  });
  assert.equal(createMakerV8Document({
    capabilities: Object.fromEntries(MAKER_V8_CAPABILITIES.map((name) => [name, false])),
  }).capabilities.market, true);

  const canonicalPolicy = createMakerV8Document({
    complete: {
      outputs: [{
        id: 'png',
        name: 'PNG',
        protected: false,
        allowedPackPolicy: {
          mode: MAKER_V8_COMPLETE_PACK_POLICY_MODES.ALLOWLIST,
          packIds: ['z-pack', 'a-pack', 'a-pack'],
          scopes: ['z/scope', 'a/scope', 'a/scope'],
        },
      }],
    },
  }).complete.outputs[0].allowedPackPolicy;
  assert.deepEqual(canonicalPolicy.packIds, ['a-pack', 'z-pack']);
  assert.deepEqual(canonicalPolicy.scopes, ['a/scope', 'z/scope']);

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
  assert.equal(Object.hasOwn(part, 'kind'), false);
  assert.equal(item.displayOrder, 0);
  assert.equal(item.status, 'public');
  assert.equal(Object.hasOwn(item, 'gate'), false);
  assert.equal(style.displayOrder, 0);
  assert.equal(style.layerTrackId, document.layerTracks[0].id);
  assert.equal(Object.hasOwn(style, 'sourceKind'), false);
  assert.equal(Object.hasOwn(style, 'composition'), false);
  assert.deepEqual(style.seal, { protected: false });
  assert.deepEqual(document.defaultRecipe.selections[0], {
    partId: part.id,
    itemId: item.id,
    styleId: style.id,
  });

  const fixedWithOfficialChoice = structuredClone(document);
  fixedWithOfficialChoice.parts[0].wardrobeMode = 'SLOT';
  assert.deepEqual(
    collectMakerV8DocumentIssues(fixedWithOfficialChoice, { mode: 'draft' }),
    [],
    'Maker-wide FIXED blocks third-party gear; it does not force every Part to FIXED',
  );
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
    completeOutputs: 1,
  });

  document.metadata.coverAssetId = 'missing';
  assert.deepEqual(
    collectMakerV8DocumentIssues(document, { mode: 'compile' })
      .filter((entry) => entry.path === 'metadata.coverAssetId')
      .map((entry) => entry.code),
    ['MAKER_V8_COVER_REQUIRED'],
  );
});

test('all native capabilities are derived true and predecessor evidence is compiler context', () => {
  MAKER_V8_CAPABILITIES.forEach((capability) => {
    const document = structuredClone(createMakerV8Document());
    document.capabilities[capability] = false;
    assert.equal(
      collectMakerV8DocumentIssues(document, { mode: 'draft' }).some((entry) => (
        entry.path === `capabilities.${capability}`
        && entry.code === 'MAKER_V8_REQUIRED_CAPABILITY_DISABLED'
      )),
      true,
      capability,
    );
  });

  const successor = structuredClone(createMakerV8Document({
    lineage: {
      number: 2,
      previousRootId: `0x${'a'.repeat(64)}`,
      previousVersionCommitment: 'b'.repeat(64),
    },
  }));
  assert.equal(Object.hasOwn(successor.lineage, 'previousRootId'), false);
  assert.equal(Object.hasOwn(successor.lineage, 'previousVersionCommitment'), false);
  successor.lineage.previousRootId = `0x${'a'.repeat(64)}`;
  successor.lineage.previousVersionCommitment = 'b'.repeat(64);
  assert.deepEqual(
    collectMakerV8AuthorShapeIssues(successor).map(({ path, code }) => ({ path, code })),
    [
      { path: 'lineage.previousRootId', code: 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN' },
      { path: 'lineage.previousVersionCommitment', code: 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN' },
    ],
  );
});

test('Maker-wide composition reuses FIXED/COMPOSABLE admission vocabulary without per-Style sources', () => {
  const composable = compiledDocument();
  composable.composition = {
    mode: MAKER_V8_COMPOSITION_MODES.COMPOSABLE,
    thirdPartyAdmission: MAKER_V8_THIRD_PARTY_ADMISSION_MODES.CERTIFIED,
    itemAssetization: true,
  };
  composable.parts[0].wardrobeMode = 'SLOT';
  assert.deepEqual(collectMakerV8DocumentIssues(composable, { mode: 'compile' }), []);

  const fixed = compiledDocument();
  fixed.parts[0].wardrobeMode = 'SLOT';
  assert.deepEqual(collectMakerV8DocumentIssues(fixed, { mode: 'compile' }), []);

  fixed.composition.thirdPartyAdmission = MAKER_V8_THIRD_PARTY_ADMISSION_MODES.OPEN;
  fixed.composition.itemAssetization = true;
  const codes = new Set(collectMakerV8DocumentIssues(fixed, { mode: 'compile' })
    .map((entry) => entry.code));
  assert.equal(codes.has('MAKER_V8_FIXED_THIRD_PARTY_INVALID'), true);
  assert.equal(codes.has('MAKER_V8_FIXED_ASSETIZATION_INVALID'), true);
});

test('Complete authoring permits all admitted Packs or sorted semantic ID/scope allowlists', () => {
  const document = compiledDocument();
  document.complete.outputs[0].allowedPackPolicy = {
    mode: MAKER_V8_COMPLETE_PACK_POLICY_MODES.ALLOWLIST,
    packIds: ['official-hair', 'season-one'],
    scopes: ['creator/official', 'studio:seasonal'],
  };
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  assert.equal(Object.hasOwn(document, 'packs'), false);
  assert.equal(Object.hasOwn(document.complete.outputs[0], 'requiredPackSelections'), false);

  const unsorted = structuredClone(document);
  unsorted.complete.outputs[0].allowedPackPolicy.packIds.reverse();
  assert.equal(collectMakerV8DocumentIssues(unsorted, { mode: 'compile' })
    .some((entry) => entry.code === 'MAKER_V8_CANONICAL_LIST_ORDER_INVALID'), true);

  const frozenSet = structuredClone(document);
  frozenSet.packs = [{ id: 'season-one' }];
  frozenSet.commerce.packPolicies = [{
    packId: 'season-one',
    accessMode: 'FREE',
    purchasePriceAtomic: 0,
    completion: {
      mode: 'UNLIMITED_FREE', freeQuotaPerWallet: 0, priceAtomic: 0, totalCap: null,
    },
  }];
  const frozenCodes = new Set(collectMakerV8DocumentIssues(frozenSet, { mode: 'compile' })
    .map((entry) => entry.code));
  assert.equal(frozenCodes.has('MAKER_V8_EMBEDDED_PACKS_FORBIDDEN'), true);
  assert.equal(frozenCodes.has('MAKER_V8_EMBEDDED_PACK_POLICY_FORBIDDEN'), true);
});

test('the exact author contract rejects recursive field injection at every object boundary', () => {
  function shapeDocument() {
    const document = compiledDocument();
    const target = { partId: 'base', itemId: 'body', styleId: 'default' };
    document.parts[0].visibleWhen = { op: 'selected', ...target };
    document.parts[0].items[0].requires = [{ partId: 'base', itemId: 'body' }];
    document.rules = [{
      id: 'base-rule',
      type: 'requires',
      trigger: target,
      targets: [{ partId: 'base', itemId: 'body' }],
    }];
    return document;
  }

  const cases = [
    ['document', 'packs', 'MAKER_V8_EMBEDDED_PACKS_FORBIDDEN', (value) => { value.packs = []; }],
    ['document unknown', 'extensions', 'MAKER_V8_AUTHOR_FIELD_UNKNOWN', (value) => { value.extensions = {}; }],
    ['chain identity', 'chainId', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.chainId = 'sui:mainnet'; }],
    ['lineage', 'lineage.previousRootId', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.lineage.previousRootId = 'chain'; }],
    ['metadata', 'metadata.payloadCommitment', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.metadata.payloadCommitment = 'x'; }],
    ['license', 'metadata.license.sealId', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.metadata.license.sealId = 'x'; }],
    ['canvas', 'canvas.rootId', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.canvas.rootId = 'x'; }],
    ['capabilities', 'capabilities.commerce', 'MAKER_V8_AUTHOR_FIELD_UNKNOWN', (value) => { value.capabilities.commerce = true; }],
    ['composition', 'composition.loadoutMutable', 'MAKER_V8_AUTHOR_FIELD_UNKNOWN', (value) => { value.composition.loadoutMutable = true; }],
    ['track', 'layerTracks[0].payloadCommitment', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.layerTracks[0].payloadCommitment = 'x'; }],
    ['channel', 'colorChannels[0].sourceKind', 'MAKER_V8_AUTHOR_FIELD_UNKNOWN', (value) => { value.colorChannels[0].sourceKind = 'OFFICIAL'; }],
    ['swatch', 'colorChannels[0].swatches[0].contentHash', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.colorChannels[0].swatches[0].contentHash = 'x'; }],
    ['stop', 'colorChannels[0].swatches[0].stops[0].commitment', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.colorChannels[0].swatches[0].stops[0].commitment = 'x'; }],
    ['part', 'parts[0].kind', 'MAKER_V8_AUTHOR_FIELD_UNKNOWN', (value) => { value.parts[0].kind = 'standard'; }],
    ['condition', 'parts[0].visibleWhen.sourceKind', 'MAKER_V8_AUTHOR_FIELD_UNKNOWN', (value) => { value.parts[0].visibleWhen.sourceKind = 'OFFICIAL'; }],
    ['not condition', 'parts[0].visibleWhen.sealId', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => {
      value.parts[0].visibleWhen = {
        op: 'not', sealId: 'x', condition: { op: 'selected', partId: 'base' },
      };
    }],
    ['group condition', 'parts[0].visibleWhen.sourceKind', 'MAKER_V8_AUTHOR_FIELD_UNKNOWN', (value) => {
      value.parts[0].visibleWhen = {
        op: 'all', sourceKind: 'OFFICIAL', conditions: [{ op: 'selected', partId: 'base' }],
      };
    }],
    ['item', 'parts[0].items[0].gate', 'MAKER_V8_AUTHOR_FIELD_UNKNOWN', (value) => { value.parts[0].items[0].gate = 'INCLUDED'; }],
    ['embedded target', 'parts[0].items[0].requires[0].objectId', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.parts[0].items[0].requires[0].objectId = 'x'; }],
    ['style', 'parts[0].items[0].styles[0].sourceKind', 'MAKER_V8_AUTHOR_FIELD_UNKNOWN', (value) => { value.parts[0].items[0].styles[0].sourceKind = 'OFFICIAL'; }],
    ['transform', 'parts[0].items[0].styles[0].transform.contentHash', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.parts[0].items[0].styles[0].transform.contentHash = 'x'; }],
    ['seal', 'parts[0].items[0].styles[0].seal.sealId', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.parts[0].items[0].styles[0].seal.sealId = 'x'; }],
    ['physical', 'parts[0].items[0].styles[0].physical.registryId', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.parts[0].items[0].styles[0].physical.registryId = 'x'; }],
    ['rule', 'rules[0].ruleCommitment', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.rules[0].ruleCommitment = 'x'; }],
    ['rule trigger', 'rules[0].trigger.gate', 'MAKER_V8_AUTHOR_FIELD_UNKNOWN', (value) => { value.rules[0].trigger.gate = 'x'; }],
    ['rule target', 'rules[0].targets[0].sealId', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.rules[0].targets[0].sealId = 'x'; }],
    ['recipe', 'defaultRecipe.packSelections', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.defaultRecipe.packSelections = []; }],
    ['recipe selection', 'defaultRecipe.selections[0].rootId', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.defaultRecipe.selections[0].rootId = 'x'; }],
    ['recipe color', 'defaultRecipe.colors[0].colorHash', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.defaultRecipe.colors[0].colorHash = 'x'; }],
    ['complete', 'complete.registryCommitment', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.complete.registryCommitment = 'x'; }],
    ['complete output', 'complete.outputs[0].sealId', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.complete.outputs[0].sealId = 'x'; }],
    ['allowed Pack policy', 'complete.outputs[0].allowedPackPolicy.requiredPackSelections', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.complete.outputs[0].allowedPackPolicy.requiredPackSelections = []; }],
    ['commerce', 'commerce.economicsCommitment', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.commerce.economicsCommitment = 'x'; }],
    ['Maker access', 'commerce.makerAccess.objectId', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.commerce.makerAccess.objectId = 'x'; }],
    ['Complete commerce', 'commerce.baseCompletion.policyHash', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.commerce.baseCompletion.policyHash = 'x'; }],
    ['asset hash', 'assets[0].sha256', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.assets[0].sha256 = 'a'.repeat(64); }],
    ['asset commitment', 'assets[0].assetCommitment', 'MAKER_V8_COMPILER_OWNED_FIELD_FORBIDDEN', (value) => { value.assets[0].assetCommitment = 'x'; }],
  ];

  assert.deepEqual(collectMakerV8AuthorShapeIssues(shapeDocument()), []);
  cases.forEach(([label, path, code, mutate]) => {
    const value = shapeDocument();
    mutate(value);
    const matches = collectMakerV8AuthorShapeIssues(value)
      .filter((entry) => entry.path === path && entry.code === code);
    assert.equal(matches.length, 1, label);
  });
});

test('nested collections and concrete Rule/Complete expansion are bounded', () => {
  const document = compiledDocument();
  const ids = Array.from({ length: 32 }, (_, index) => `item-${String(index).padStart(2, '0')}`);
  document.rules = [{
    id: 'wide-edge',
    type: 'requires',
    trigger: { partId: 'base', itemIds: ids },
    targets: [{ partId: 'base', itemIds: ids }],
  }];
  document.parts[0].visibleWhen = {
    op: 'all',
    conditions: Array.from({ length: 1_001 }, () => ({ op: 'selected', partId: 'base' })),
  };
  document.colorChannels[0].swatches[0].stops = Array.from({ length: 65 }, (_, index) => ({
    offset: index / 64,
    color: '#112233',
  }));
  document.complete.outputs[0].allowedPackPolicy = {
    mode: MAKER_V8_COMPLETE_PACK_POLICY_MODES.ALLOWLIST,
    packIds: Array.from({ length: 1_000 }, (_, index) => `pack-${String(index).padStart(4, '0')}`),
    scopes: ['scope/overflow'],
  };
  const codes = new Set(collectMakerV8DocumentIssues(document, { mode: 'compile' })
    .map((entry) => entry.code));
  assert.equal(codes.has('MAKER_V8_RULE_EXPANDED_EDGE_LIMIT'), true);
  assert.equal(codes.has('MAKER_V8_CONDITION_CHILD_LIMIT'), true);
  assert.equal(codes.has('MAKER_V8_CONDITION_NODE_LIMIT'), true);
  assert.equal(codes.has('MAKER_V8_SWATCH_STOP_LIMIT'), true);
  assert.equal(codes.has('MAKER_V8_COMPLETE_PACK_EDGE_LIMIT'), true);
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
