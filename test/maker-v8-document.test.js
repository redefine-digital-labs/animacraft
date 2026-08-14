import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAKER_V8_DOCUMENT_SCHEMA,
  MakerV8DocumentValidationError,
  assertMakerV8Document,
  collectMakerV8DocumentIssues,
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
    { id: 'cover', kind: 'image', sha256: '1'.repeat(64), byteLength: 1_024 },
    { id: 'base-png', kind: 'image', sha256: '2'.repeat(64), byteLength: 2_048 },
  ];
  document.layerTracks = [{ id: 'base-track', name: 'Base', order: 0 }];
  document.colorChannels = [{
    id: 'skin-tone',
    name: 'Skin tone',
    defaultSwatchId: 'default-skin',
    swatches: [{ id: 'default-skin', name: 'Default', stops: [] }],
  }];
  document.parts = [{
    id: 'base',
    name: 'Base',
    order: 0,
    required: true,
    layerTrackId: 'base-track',
    wardrobeMode: 'FIXED',
    items: [{
      id: 'body',
      name: 'Body',
      styles: [{
        id: 'default',
        name: 'Default',
        layerTrackId: 'base-track',
        colorChannelId: 'skin-tone',
        assetId: 'base-png',
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

test('compile validation binds cover, assets, shared definitions, rules, and native commerce', () => {
  const document = compiledDocument();
  assert.deepEqual(collectMakerV8DocumentIssues(document, { mode: 'compile' }), []);
  assert.deepEqual(makerV8Inventory(document), {
    tracks: 1,
    parts: 1,
    items: 1,
    styles: 1,
    colorChannels: 1,
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
