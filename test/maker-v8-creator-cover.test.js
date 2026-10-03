import assert from 'node:assert/strict';
import test from 'node:test';
import { indexedDB } from 'fake-indexeddb';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { applyMakerV8WorkspaceCommand } from '../maker-v8-workspace.js';
import { createMakerV8DraftPersistence } from '../maker-v8-draft-store.js';
import { prepareCreatorCover, MAKER_V8_CREATOR_COVER_MAX_BYTES } from '../maker-v8-creator-cover.js';

// Header-only fixtures exercise preparation, not browser image decoding.
function png(width = 24, height = 32, size = 33) {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  view.setUint32(12, 0x49484452);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function jpeg(width = 40, height = 30, marker = 0xc0) {
  // APP1 segment followed by one-component SOF, including the complete header.
  const bytes = new Uint8Array([255, 216, 255, 225, 0, 4, 0, 0,
    255, marker, 0, 11, 8, 0, 0, 0, 0, 1, 1, 17, 0, 255, 217]);
  const view = new DataView(bytes.buffer);
  view.setUint16(13, height);
  view.setUint16(15, width);
  return bytes;
}

function fixture(withCover = false) {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'cover-test' }));
  const assets = [{ assetId: 'base-default', revision: 4, kind: 'layer', mediaType: 'image/png', byteLength: 1, bytesBase64: 'AA==' }];
  if (withCover) {
    document.metadata.coverAssetId = 'old-cover';
    document.assets.push({ id: 'old-cover', kind: 'cover', mediaType: 'image/png', byteLength: 33 });
    assets.push({ assetId: 'old-cover', revision: 7, kind: 'cover', mediaType: 'image/png', byteLength: 33,
      bytesBase64: Buffer.from(png()).toString('base64') });
  }
  return { document, assets, bytes: jpeg() };
}

function apply(input, prepared) {
  return prepared.commands.reduce(applyMakerV8WorkspaceCommand, input.document);
}

test('first PNG/JPEG cover has exact byte descriptor and CAS, preserving all layer data', () => {
  for (const bytes of [png(), jpeg(), jpeg(40, 30, 0xc2)]) {
    const input = { ...fixture(), bytes };
    const before = structuredClone(input);
    const prepared = prepareCreatorCover(input);
    const next = apply(input, prepared);
    assert.equal(prepared.changed, true);
    assert.equal(next.metadata.coverAssetId, 'maker-cover-1');
    assert.deepEqual(next.parts, input.document.parts);
    assert.deepEqual(next.defaultRecipe, input.document.defaultRecipe);
    assert.deepEqual(prepared.assetDeletes, []);
    assert.deepEqual(prepared.assetUpserts, [{ assetId: 'maker-cover-1', expectedRevision: null,
      kind: 'cover', mediaType: prepared.mediaType, bytesBase64: Buffer.from(bytes).toString('base64') }]);
    assert.deepEqual(next.assets.at(-1), { id: 'maker-cover-1', kind: 'cover', mediaType: prepared.mediaType, byteLength: bytes.length });
    assert.deepEqual(input, before);
  }
});

test('exclusive replacement removes old descriptor/bytes without leaving an orphan', () => {
  const input = fixture(true);
  const before = structuredClone(input);
  const prepared = prepareCreatorCover(input);
  const next = apply(input, prepared);
  assert.deepEqual(prepared.assetDeletes, [{ assetId: 'old-cover', expectedRevision: 7 }]);
  assert.deepEqual(next.assets.map((row) => row.id), ['base-default', 'maker-cover-1']);
  assert.deepEqual(next.parts, input.document.parts);
  assert.deepEqual(input, before);
});

for (const reference of ['Style', 'rights', 'payload']) {
  for (const remove of [false, true]) {
    test(`${remove ? 'remove' : 'replace'} preserves cover shared by ${reference}`, () => {
      const input = fixture(true);
      if (reference === 'Style') input.document.parts[0].items[0].styles[0].assetId = 'old-cover';
      if (reference === 'rights') {
        input.document.commerce.rightsOrigin = 'LICENSE_WRAPPED';
        input.document.commerce.rightsEvidence = { licensor: 'Artist', evidenceAssetId: 'old-cover' };
      }
      if (reference === 'payload') input.document.parts[0].items[0].payload.image = 'old-cover';
      const before = structuredClone(input);
      const prepared = prepareCreatorCover({ ...input, remove });
      const next = apply(input, prepared);
      assert.deepEqual(prepared.assetDeletes, []);
      assert.deepEqual(next.assets.find((row) => row.id === 'old-cover'), input.document.assets[1]);
      assert.deepEqual(next.parts, input.document.parts);
      assert.deepEqual(next.commerce, input.document.commerce);
      assert.deepEqual(input, before);
    });
  }
}

test('remove is pure; missing cover and identical upload are noops', () => {
  const input = fixture(true);
  const before = structuredClone(input);
  const removed = prepareCreatorCover({ ...input, remove: true });
  const next = apply(input, removed);
  assert.equal(next.metadata.coverAssetId, null);
  assert.deepEqual(next.assets, input.document.assets.slice(0, 1));
  assert.deepEqual(removed.assetUpserts, []);
  assert.equal(removed.mediaType, null);
  const noop = { commands: [], assetUpserts: [], assetDeletes: [], width: null, height: null, mediaType: null, changed: false };
  assert.deepEqual(prepareCreatorCover({ ...fixture(), remove: true }), noop);
  assert.deepEqual(prepareCreatorCover({ ...input, bytes: png() }), { ...noop, width: 24, height: 32, mediaType: 'image/png' });
  assert.deepEqual(input, before);
});

test('new ID avoids both descriptor and durable row collisions', () => {
  const input = fixture();
  input.document.assets.push({ ...input.document.assets[0], id: 'maker-cover-1' });
  input.assets.push({ ...input.assets[0], assetId: 'maker-cover-2' });
  assert.equal(prepareCreatorCover(input).assetUpserts[0].assetId, 'maker-cover-3');
});

test('PNG/JPEG dimensions, 5 MB inclusive limit and Uint8Array views are checked', () => {
  assert.equal(prepareCreatorCover({ ...fixture(), bytes: png(8192, 4096, MAKER_V8_CREATOR_COVER_MAX_BYTES) }).width, 8192);
  assert.equal(prepareCreatorCover({ ...fixture(), bytes: jpeg(4096, 8192) }).height, 8192);
  const padded = new Uint8Array(100);
  padded.set(jpeg(), 7);
  const result = prepareCreatorCover({ ...fixture(), bytes: padded.subarray(7, 30) });
  assert.equal(result.width, 40);
  assert.equal(Buffer.from(result.assetUpserts[0].bytesBase64, 'base64').length, 23);
  for (const bytes of [png(0, 1), png(1, 0), png(8193, 1), png(1, 8193), png(8192, 4097),
    jpeg(0, 1), jpeg(8193, 1), jpeg(8192, 4097)]) {
    assert.throws(() => prepareCreatorCover({ ...fixture(), bytes }), { code: 'MAKER_V8_CREATOR_COVER_DIMENSIONS_INVALID' });
  }
  assert.throws(() => prepareCreatorCover({ ...fixture(), bytes: png(1, 1, MAKER_V8_CREATOR_COVER_MAX_BYTES + 1) }),
    { code: 'MAKER_V8_CREATOR_COVER_TOO_LARGE' });
});

test('wrong signatures and malformed/truncated PNG/JPEG headers fail without mutation', () => {
  const badPng = png(); badPng[12] = 0;
  const badLength = png(); badLength[11] = 12;
  const truncatedJpeg = jpeg().subarray(0, 20);
  const badJpeg = jpeg(); badJpeg[5] = 255;
  const badSof = jpeg(); badSof[17] = 2;
  const cases = [new Uint8Array(), png().subarray(0, 32), new Uint8Array(33), badPng, badLength,
    truncatedJpeg, badJpeg, badSof, jpeg().subarray(0, 9), [1, 2, 3],
    new Uint8Array([255, 216, 255, 218, 0, 2]), new Uint8Array([255, 216, 255, 0]),
    new Uint8Array([255, 216, 255, 225, 0, 1])];
  for (const bytes of cases) {
    const input = { ...fixture(true), bytes };
    const before = structuredClone(input);
    assert.throws(() => prepareCreatorCover(input), { code: 'MAKER_V8_CREATOR_COVER_INVALID' });
    assert.deepEqual(input, before);
  }
});

test('missing, duplicate, mismatched or corrupt saved cover bytes fail before replacement/removal', () => {
  const input = fixture(true);
  const cover = input.assets[1];
  const cases = [null, [], [...input.assets, cover], [input.assets[0], { ...cover, revision: 0 }],
    [input.assets[0], { ...cover, kind: 'layer' }], [input.assets[0], { ...cover, mediaType: 'image/jpeg' }],
    [input.assets[0], { ...cover, byteLength: 1 }], [input.assets[0], { ...cover, bytesBase64: 'AA==' }],
    [input.assets[0], { ...cover, bytesBase64: `${cover.bytesBase64}\n` }], [input.assets[0], { ...cover, bytesBase64: '?' }]];
  for (const assets of cases) {
    for (const remove of [false, true]) {
      const attempt = { ...input, assets, remove };
      const before = structuredClone(attempt);
      assert.throws(() => prepareCreatorCover(attempt), { code: 'MAKER_V8_CREATOR_COVER_ASSET_UNAVAILABLE' });
      assert.deepEqual(attempt, before);
    }
  }
});

test('bundle CAS makes upload/replace/remove atomic and historical restoration recovers exact original bytes', async () => {
  const initial = fixture();
  const persistence = createMakerV8DraftPersistence(indexedDB, { databaseName: `cover-${crypto.randomUUID()}` });
  try {
    await persistence.createBundle({ draftId: 'cover-test', document: initial.document, createdAt: 100,
      assets: initial.assets.map(({ assetId, kind, mediaType, bytesBase64 }) => ({ assetId, kind, mediaType, bytesBase64 })) });
    for (const [index, change] of [{ bytes: png() }, { bytes: jpeg() }, { remove: true }].entries()) {
      const snapshot = await persistence.export('cover-test');
      const input = { document: snapshot.draft.document, assets: snapshot.assets, ...change };
      const prepared = prepareCreatorCover(input);
      const document = apply(input, prepared);
      const mutation = { draftId: 'cover-test', expectedRevision: snapshot.draft.revision, document,
        assetUpserts: prepared.assetUpserts, assetDeletes: prepared.assetDeletes, updatedAt: 101 + index };
      await assert.rejects(persistence.compareAndSwapBundle({ ...mutation, expectedRevision: 999 }), { code: 'MAKER_V8_DRAFT_CAS_MISMATCH' });
      if (prepared.assetDeletes.length) {
        await assert.rejects(persistence.compareAndSwapBundle({ ...mutation,
          assetDeletes: prepared.assetDeletes.map((row) => ({ ...row, expectedRevision: 999 })) }), { code: 'MAKER_V8_DRAFT_ASSET_CAS_MISMATCH' });
      }
      assert.deepEqual(await persistence.export('cover-test'), snapshot);
      await persistence.compareAndSwapBundle(mutation);
      const saved = await persistence.export('cover-test');
      assert.deepEqual(saved.draft.document, document);
      assert.equal(saved.assets.length, change.remove ? 1 : 2);
      assert.equal(saved.assets.find((row) => row.assetId === 'base-default').bytesBase64, 'AA==');
    }
    await persistence.restoreVersion({ draftId: 'cover-test', expectedRevision: 4, revision: 2, updatedAt: 104 });
    const restored = await persistence.export('cover-test');
    assert.equal(restored.draft.document.metadata.coverAssetId, 'maker-cover-1');
    assert.equal(restored.assets.find((row) => row.assetId === 'maker-cover-1').bytesBase64, Buffer.from(png()).toString('base64'));
    await persistence.restoreVersion({ draftId: 'cover-test', expectedRevision: 5, revision: 1, updatedAt: 105 });
    assert.deepEqual((await persistence.load('cover-test')).document, initial.document);
    assert.equal((await persistence.export('cover-test')).assets.length, 1);
  } finally { persistence.close(); }
});
