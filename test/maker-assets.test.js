import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_MAKER_ASSET_BYTES,
  buildAssetImportMapping,
  createAssetId,
  createCachedAssetResolver,
  inspectPngAsset,
  revokeRuntimeAsset,
  runtimeAssetRecord,
} from '../maker-assets.js';

test('maps filenames to layer tracks by exact names, aliases and Chinese tokens', () => {
  const tracks = [
    { id: 'hair-back', name: 'Hair Back' },
    { id: 'hair-front', name: 'Hair Front' },
    { id: 'body-base', name: '素体' },
  ];
  const files = [
    { name: 'character_hair_front.PNG' },
    { name: '头发后层.png' },
    { name: '身体.png' },
  ];
  const mapping = buildAssetImportMapping(files, tracks);
  assert.deepEqual(mapping.map((entry) => entry.trackId), ['hair-front', 'hair-back', 'body-base']);
  assert.ok(mapping.every((entry) => entry.confidence === 'matched'));
});

test('never maps two files to the same track when ordered fallback follows a match', () => {
  const tracks = [
    { id: 'back', name: 'Back' },
    { id: 'front', name: 'Front' },
  ];
  const mapping = buildAssetImportMapping([
    { name: 'front.png' },
    { name: 'mystery.png' },
  ], tracks);
  assert.deepEqual(mapping.map((entry) => entry.trackId), ['front', 'back']);
  assert.deepEqual(mapping.map((entry) => entry.confidence), ['matched', 'ordered']);
});

test('suggests a new track when there are more unmatched files than tracks', () => {
  const mapping = buildAssetImportMapping([
    { name: 'base.png' },
    { name: 'sparkles.png' },
  ], [{ id: 'base', name: 'Base' }]);
  assert.equal(mapping[0].trackId, 'base');
  assert.equal(mapping[1].trackId, '');
  assert.equal(mapping[1].confidence, 'new-track');
  assert.equal(mapping[1].suggestedTrackName, 'sparkles');
});

test('creates readable, collision-resistant asset ids', () => {
  const first = createAssetId('Hair Front.PNG');
  const second = createAssetId('Hair Front.PNG');
  assert.match(first, /^hair-front-/);
  assert.notEqual(first, second);
});

test('inspects full-canvas and cropped PNG dimensions with deterministic initial transforms', async () => {
  const previous = globalThis.createImageBitmap;
  const closed = [];
  globalThis.createImageBitmap = async (file) => ({
    width: file.width,
    height: file.height,
    close: () => closed.push(file.name),
  });
  try {
    const full = await inspectPngAsset({ name: 'full.png', type: 'image/png', size: 100, width: 1024, height: 1024 }, { width: 1024, height: 1024 });
    assert.equal(full.fullCanvas, true);
    assert.deepEqual(full.initialTransform, { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 });

    const cropped = await inspectPngAsset({ name: 'crop.png', type: 'image/png', size: 100, width: 400, height: 800 }, { width: 1000, height: 1000 });
    assert.equal(cropped.fullCanvas, false);
    assert.deepEqual(cropped.initialTransform, { x: 300, y: 100, scaleX: 1, scaleY: 1, rotation: 0 });
    assert.match(cropped.warning, /confirm its position/i);
    assert.deepEqual(closed, ['full.png', 'crop.png']);
  } finally {
    globalThis.createImageBitmap = previous;
  }
});

test('rejects non-PNG, oversized and invalid-dimension artwork', async () => {
  await assert.rejects(() => inspectPngAsset({ name: 'photo.jpg', type: 'image/jpeg', size: 1 }, { width: 1024, height: 1024 }), /must be a PNG/);
  await assert.rejects(() => inspectPngAsset({ name: 'huge.png', type: 'image/png', size: MAX_MAKER_ASSET_BYTES + 1 }, { width: 1024, height: 1024 }), /larger than 20 MB/);
  const previous = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 9000, height: 20, close() {} });
  try {
    await assert.rejects(() => inspectPngAsset({ name: 'wide.png', type: 'image/png', size: 1 }, { width: 1024, height: 1024 }), /unsupported dimensions/);
  } finally {
    globalThis.createImageBitmap = previous;
  }
});

test('cached asset resolver deduplicates concurrent work, caches bitmaps and closes on clear', async () => {
  const previousBitmap = globalThis.createImageBitmap;
  let createCount = 0;
  let closeCount = 0;
  globalThis.createImageBitmap = async (source) => {
    createCount += 1;
    await Promise.resolve();
    return { source, close: () => { closeCount += 1; } };
  };
  try {
    const blob = new Blob(['image'], { type: 'image/png' });
    const resolver = createCachedAssetResolver(new Map([['asset', { blob }]]));
    const [first, second] = await Promise.all([resolver.resolve('asset'), resolver.resolve('asset')]);
    assert.equal(first, second);
    assert.equal(createCount, 1);
    assert.equal(await resolver.resolve('asset'), first);
    assert.equal(createCount, 1);
    assert.equal((await resolver.prefetch(['asset', 'asset']))[0].status, 'fulfilled');
    resolver.clear();
    assert.equal(closeCount, 1);
    await resolver.resolve('asset');
    assert.equal(createCount, 2);
  } finally {
    globalThis.createImageBitmap = previousBitmap;
  }
});

test('cached resolver clears failed pending requests so a corrected asset can retry', async () => {
  const records = { broken: {} };
  const resolver = createCachedAssetResolver(records);
  await assert.rejects(() => resolver.resolve('broken'), /no readable source/);
  records.broken.blob = new Blob(['fixed'], { type: 'image/png' });
  const previous = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ close() {} });
  try {
    await assert.doesNotReject(() => resolver.resolve('broken'));
  } finally {
    resolver.clear();
    globalThis.createImageBitmap = previous;
  }
});

test('runtime records create and revoke only owned object URLs', () => {
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked = [];
  let index = 0;
  URL.createObjectURL = () => `blob:test-${index += 1}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const record = runtimeAssetRecord({
      assetId: 'layer',
      blob: new Blob(['layer']),
      thumbnailBlob: new Blob(['thumb']),
      fileName: 'layer.png',
      width: 12,
      height: 24,
    });
    assert.equal(record.url, 'blob:test-1');
    assert.equal(record.thumbnailUrl, 'blob:test-2');
    revokeRuntimeAsset(record);
    revokeRuntimeAsset({ url: 'https://example.com/remote.png', thumbnailUrl: '' });
    assert.deepEqual(revoked, ['blob:test-1', 'blob:test-2']);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});
