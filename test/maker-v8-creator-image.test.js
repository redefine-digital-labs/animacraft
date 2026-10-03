import assert from 'node:assert/strict';
import test from 'node:test';
import { createCharacterMakerV8Starter } from '../maker-v8-document.js';
import { applyMakerV8WorkspaceCommand } from '../maker-v8-workspace.js';
import { prepareCreatorStylePng, MAKER_V8_CREATOR_PNG_MAX_BYTES } from '../maker-v8-creator-image.js';
import { prepareCreatorStructure } from '../maker-v8-creator-structure.js';
import { indexedDB } from 'fake-indexeddb';
import { createMakerV8DraftPersistence } from '../maker-v8-draft-store.js';
import { createMakerV8Document } from '../maker-v8-document.js';

// Header-only fixture: this pure preparation layer does not replace actual decoding.
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

function fixture() {
  const document = structuredClone(createCharacterMakerV8Starter({ makerKey: 'image-test', name: 'Image Test' }));
  return { document, assets: [{ assetId: 'base-default', revision: 4, kind: 'layer', mediaType: 'image/png', byteLength: 1 }],
    partKey: 'base', itemKey: 'default', styleKey: 'default', bytes: png() };
}

test('new source PNG keeps native aspect and is centered without upscaling', () => {
  const input = fixture();
  input.document.canvas = { width: 1080, height: 1920, pixelMode: 'smooth' };
  input.bytes = png(800, 800);
  const result = prepareCreatorStylePng(input);
  const next = result.commands.reduce(applyMakerV8WorkspaceCommand, input.document);
  assert.deepEqual(next.parts[0].items[0].styles[0].transform, { x: 140, y: 560, scale: 1, rotation: 0 });
});

test('upload and replacement fit full PNG extent only when position is unlocked', () => {
  for (const first of [false, true]) for (const locked of [false, true]) for (const [width, height, transform] of [
    [800, 800, { x: 140, y: 560, scale: 1, rotation: 0 }],
    [2160, 800, { x: 0, y: 760, scale: 0.5, rotation: 0 }],
    [400, 3840, { x: 440, y: 0, scale: 0.5, rotation: 0 }],
    [1080, 1920, { x: 0, y: 0, scale: 1, rotation: 0 }],
  ]) {
    const input = fixture();
    input.document.canvas = { width: 1080, height: 1920, pixelMode: 'smooth' };
    input.bytes = png(width, height);
    const style = input.document.parts[0].items[0].styles[0];
    if (first) style.assetId = null;
    style.transform = { x: -12.125, y: 18.5, scale: 0.75, rotation: 90 };
    style.payload.animacraftEditor = { positionLocked: locked, positionConfirmed: true, custom: 'keep' };
    const original = structuredClone(input);
    const prepared = prepareCreatorStylePng(input);
    const result = prepared.commands.reduce(applyMakerV8WorkspaceCommand, input.document).parts[0].items[0].styles[0];
    assert.deepEqual(result.transform, locked ? style.transform : transform);
    assert.deepEqual(result.payload.animacraftEditor, { positionLocked: locked, positionConfirmed: locked, custom: 'keep' });
    assert.equal(prepared.assetUpserts[0].bytesBase64, Buffer.from(input.bytes).toString('base64'));
    assert.deepEqual(input, original);
  }
});

test('whole-style lock and malformed editor metadata cannot be bypassed by PNG replacement', () => {
  for (const editor of [{ styleLocked: true }, { positionLocked: 'true' }, null]) {
    const input = fixture(); input.document.parts[0].items[0].styles[0].payload.animacraftEditor = editor;
    const original = structuredClone(input);
    assert.throws(() => prepareCreatorStylePng(input));
    assert.deepEqual(input, original);
  }
});

test('nonintegral initial fit uses the nearest six-place scale that never exceeds the canvas', () => {
  for (const [canvasWidth, canvasHeight, width, height, expectedScale] of [
    [1000, 1000, 1500, 500, 0.666666],
    [1000, 1000, 500, 1500, 0.666666],
    [1080, 1920, 2161, 800, 0.499768],
    [1, 1, 8192, 1, 0.000122],
  ]) {
    const input = fixture();
    input.document.canvas = { width: canvasWidth, height: canvasHeight, pixelMode: 'smooth' };
    input.bytes = png(width, height);
    const prepared = prepareCreatorStylePng(input);
    const next = prepared.commands.reduce(applyMakerV8WorkspaceCommand, input.document);
    const transform = next.parts[0].items[0].styles[0].transform;
    assert.equal(transform.scale, expectedScale);
    assert.ok(width * transform.scale <= canvasWidth);
    assert.ok(height * transform.scale <= canvasHeight);
    assert.ok(width * (transform.scale + 0.000001) > canvasWidth
      || height * (transform.scale + 0.000001) > canvasHeight);
    assert.equal(transform.x, Math.round((canvasWidth - width * transform.scale) / 2));
    assert.equal(transform.y, Math.round((canvasHeight - height * transform.scale) / 2));
    assert.equal(transform.rotation, 0);
    assert.equal(prepared.assetUpserts[0].bytesBase64, Buffer.from(input.bytes).toString('base64'));
  }
});

test('PNG replacement clears only the replaced Style source binding before republication', () => {
  const input = fixture();
  const style = input.document.parts[0].items[0].styles[0];
  style.payload.animacraftSourceAsset = { sha256: 'ab'.repeat(32), mediaType: 'image/png', byteLength: 1 };
  style.payload.note = 'keep';
  const result = prepareCreatorStylePng(input);
  const next = result.commands.reduce(applyMakerV8WorkspaceCommand, input.document);
  assert.deepEqual(next.parts[0].items[0].styles[0].payload, { note: 'keep', animacraftEditor: { positionConfirmed: false } });
  assert.ok(style.payload.animacraftSourceAsset, 'input stays untouched');
});

test('position-locked exclusive replacement preserves document, coordinates and exact durable CAS shape', () => {
  const input = fixture();
  input.document.parts[0].items[0].styles[0].payload.animacraftEditor = { positionLocked: true, positionConfirmed: true };
  const before = structuredClone(input);
  const result = prepareCreatorStylePng(input);
  assert.equal(result.width, 24);
  assert.equal(result.height, 32);
  assert.equal(result.commands.length, 1);
  assert.deepEqual(result.assetUpserts, [{ assetId: 'base-default', expectedRevision: 4,
    kind: 'layer', mediaType: 'image/png', bytesBase64: Buffer.from(input.bytes).toString('base64') }]);
  const next = result.commands.reduce(applyMakerV8WorkspaceCommand, input.document);
  assert.deepEqual(next.parts, before.document.parts);
  assert.equal(next.assets[0].byteLength, input.bytes.length);
  assert.deepEqual(input, before);
  input.bytes.fill(0);
  assert.equal(Buffer.from(result.assetUpserts[0].bytesBase64, 'base64')[0], 137);
});

for (const reference of ['style', 'cover', 'rights', 'payload']) {
  test(`shared ${reference} asset gets a collision-free exclusive ID without changing other consumers`, () => {
    const input = fixture();
    const { document } = input;
    if (reference === 'style') {
      const other = structuredClone(document.parts[0].items[0].styles[0]);
      other.key = 'other';
      document.parts[0].items[0].styles.push(other);
    }
    if (reference === 'cover') document.metadata.coverAssetId = 'base-default';
    if (reference === 'rights') {
      document.commerce.rightsOrigin = 'LICENSE_WRAPPED';
      document.commerce.rightsEvidence = { licensor: 'Artist', evidenceAssetId: 'base-default' };
    }
    if (reference === 'payload') document.parts[0].items[0].payload.image = 'base-default';
    document.assets.push({ ...document.assets[0], id: 'base-default-style-1' });
    input.assets.push({ ...input.assets[0], assetId: 'base-default-style-2' });
    const before = structuredClone(input);
    const result = prepareCreatorStylePng(input);
    assert.equal(result.commands.length, 2);
    assert.equal(result.assetUpserts[0].assetId, 'base-default-style-3');
    assert.equal(result.assetUpserts[0].expectedRevision, null);
    const next = result.commands.reduce(applyMakerV8WorkspaceCommand, document);
    const expected = structuredClone(document);
    expected.assets.push({ id: 'base-default-style-3', kind: 'layer', mediaType: 'image/png', byteLength: 33 });
    expected.parts[0].items[0].styles[0].assetId = 'base-default-style-3';
    expected.parts[0].items[0].styles[0].transform = { x: 500, y: 496, scale: 1, rotation: 0 };
    expected.parts[0].items[0].styles[0].payload.animacraftEditor = { positionConfirmed: false };
    assert.deepEqual(next, expected);
    assert.deepEqual(input, before);
  });
}

test('Uint8Array views honor their offset and length', () => {
  const input = fixture();
  const padded = new Uint8Array(60);
  padded.set(input.bytes, 5);
  input.bytes = padded.subarray(5, 38);
  const result = prepareCreatorStylePng(input);
  assert.equal(result.width, 24);
  assert.equal(Buffer.from(result.assetUpserts[0].bytesBase64, 'base64').length, 33);
});

test('PNG boundaries reject oversized, truncated and wrong headers', () => {
  const cases = [new Uint8Array(32), new Uint8Array(33), png(1, 1, MAKER_V8_CREATOR_PNG_MAX_BYTES + 1),
    png(0, 1), png(1, 0), png(8193, 1), png(1, 8193), png(8192, 4097)];
  const wrongLength = png(); new DataView(wrongLength.buffer).setUint32(8, 12); cases.push(wrongLength);
  const wrongChunk = png(); wrongChunk[12] = 0; cases.push(wrongChunk);
  for (const bytes of cases) assert.throws(() => prepareCreatorStylePng({ ...fixture(), bytes }), /PNG/);
  assert.equal(prepareCreatorStylePng({ ...fixture(), bytes: png(8192, 4096) }).width, 8192);
  assert.throws(() => prepareCreatorStylePng({ ...fixture(), bytes: Array.from(png()) }), /PNG/);
});

test('missing selection, lock and missing or mismatched durable data fail without mutation', () => {
  const input = fixture();
  const before = structuredClone(input);
  assert.throws(() => prepareCreatorStylePng({ ...input, styleKey: 'missing' }), { code: 'MAKER_V8_CREATOR_STYLE_NOT_FOUND' });
  assert.throws(() => prepareCreatorStylePng({ ...input, styleLocked: true }), { code: 'MAKER_V8_CREATOR_STYLE_LOCKED' });
  for (const assets of [[], null, [...input.assets, ...input.assets], [{ ...input.assets[0], revision: 0 }],
    [{ ...input.assets[0], kind: 'other' }], [{ ...input.assets[0], byteLength: 7 }]]) {
    assert.throws(() => prepareCreatorStylePng({ ...input, assets }), { code: 'MAKER_V8_CREATOR_ASSET_UNAVAILABLE' });
  }
  assert.deepEqual(input, before);
});

test('first PNG creates an exclusive layer descriptor and byte upsert atomically with native placement', () => {
  const input = fixture();
  const structure = prepareCreatorStructure({ document: input.document, action: 'add-style', partKey: 'base', itemKey: 'default' });
  input.document = structure.document;
  Object.assign(input, structure.selection);
  const style = input.document.parts[0].items[0].styles.at(-1);
  style.transform = { x: 123, y: -64, scale: 0.75, rotation: 22 };
  style.opacity = 0.5;
  input.document.assets.push({ ...input.document.assets[0], id: `base-default-${style.key}-style-1` });
  input.assets.push({ ...input.assets[0], assetId: `base-default-${style.key}-style-2` });
  const before = structuredClone(input);
  const result = prepareCreatorStylePng(input);
  assert.equal(result.commands.length, 2);
  assert.equal(result.assetUpserts[0].expectedRevision, null);
  assert.equal(result.assetUpserts[0].kind, 'layer');
  assert.equal(result.assetUpserts[0].assetId, `base-default-${style.key}-style-3`);
  const next = result.commands.reduce(applyMakerV8WorkspaceCommand, input.document);
  const nextStyle = next.parts[0].items[0].styles.at(-1);
  assert.deepEqual(nextStyle, { ...style, assetId: result.assetUpserts[0].assetId,
    transform: { x: 500, y: 496, scale: 1, rotation: 0 },
    payload: { ...style.payload, animacraftEditor: { ...style.payload.animacraftEditor, positionConfirmed: false } } });
  assert.deepEqual(next.parts[0].items[0].styles[0], input.document.parts[0].items[0].styles[0]);
  assert.deepEqual(next.defaultRecipe, input.document.defaultRecipe);
  assert.deepEqual(input, before);
  assert.throws(() => prepareCreatorStylePng({ ...input, assets: null }), { code: 'MAKER_V8_CREATOR_ASSET_UNAVAILABLE' });
});

test('first PNG bundle CAS writes both document and bytes, while a failed revision writes neither', async () => {
  const structure = prepareCreatorStructure({ document: createMakerV8Document(), action: 'add-part' });
  const persistence = createMakerV8DraftPersistence(indexedDB, { databaseName: `first-png-${crypto.randomUUID()}` });
  try {
    await persistence.createBundle({ draftId: 'first-png', document: structure.document, assets: [], createdAt: 100 });
    const prepared = prepareCreatorStylePng({ document: structure.document, assets: [], ...structure.selection, bytes: png() });
    const document = prepared.commands.reduce(applyMakerV8WorkspaceCommand, structure.document);
    const input = { draftId: 'first-png', document, assetUpserts: prepared.assetUpserts, updatedAt: 101 };
    await assert.rejects(persistence.compareAndSwapBundle({ ...input, expectedRevision: 2 }), { code: 'MAKER_V8_DRAFT_CAS_MISMATCH' });
    assert.deepEqual((await persistence.export('first-png')).assets, []);
    assert.deepEqual((await persistence.load('first-png')).document, structure.document);
    const saved = await persistence.compareAndSwapBundle({ ...input, expectedRevision: 1 });
    assert.deepEqual(saved.draft.document, document);
    assert.equal(saved.assets.length, 1);
    assert.equal(saved.assets[0].bytesBase64, prepared.assetUpserts[0].bytesBase64);
    assert.equal((await persistence.load('first-png')).document.parts[0].items[0].styles[0].assetId, prepared.assetUpserts[0].assetId);
  } finally { persistence.close(); }
});
