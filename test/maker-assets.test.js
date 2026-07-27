import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_MAKER_ASSET_BYTES,
  MAX_MAKER_ASSET_CACHE_PIXELS,
  MAX_MAKER_ASSET_EDGE,
  MAX_MAKER_ASSET_PIXELS,
  buildAssetImportMapping,
  buildProjectAssetImportMapping,
  collectTrackAlignmentWarnings,
  createAssetId,
  createCachedAssetResolver,
  initialPngTransform,
  inspectPngAsset,
  reviveRuntimeAssetRecord,
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

test('maps a folder matrix to exactly one Part, Item, Style and Layer Track', () => {
  const document = {
    layerTracks: [{ id: 'hair-front', name: 'Hair Front' }],
    parts: [{
      id: 'hair',
      name: 'Hair',
      items: [{
        id: 'long',
        importKey: 'long-hair',
        name: 'Long Hair',
        styles: [{ id: 'default', name: 'Default' }],
      }],
    }],
  };
  const [mapping] = buildProjectAssetImportMapping([{
    name: 'hair-front.png',
    webkitRelativePath: 'maker/hair/long-hair/default/hair-front.png',
  }], document);
  assert.equal(mapping.targetDefinition, 'hair::long::default');
  assert.equal(mapping.trackId, 'hair-front');
  assert.equal(Object.hasOwn(mapping, 'colorDefinition'), false);
  assert.equal(mapping.confidence, 'matched');
});

test('creates readable, collision-resistant asset ids', () => {
  const first = createAssetId('Hair Front.PNG');
  const second = createAssetId('Hair Front.PNG');
  assert.match(first, /^hair-front-/);
  assert.notEqual(first, second);
});

test('centers the complete PNG bounds instead of shifting to transparent alpha content', () => {
  assert.deepEqual(
    initialPngTransform(1600, 800, { width: 1000, height: 1000 }),
    { x: 0, y: 250, scale: 0.625, rotation: 0 },
  );
  assert.deepEqual(
    initialPngTransform(400, 800, { width: 1000, height: 1000 }),
    { x: 300, y: 100, scale: 1, rotation: 0 },
  );
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
    assert.deepEqual(full.initialTransform, { x: 0, y: 0, scale: 1, rotation: 0 });

    const cropped = await inspectPngAsset({ name: 'crop.png', type: 'image/png', size: 100, width: 400, height: 800 }, { width: 1000, height: 1000 });
    assert.equal(cropped.fullCanvas, false);
    assert.deepEqual(cropped.initialTransform, { x: 300, y: 100, scale: 1, rotation: 0 });
    assert.match(cropped.warning, /confirm its position/i);
    assert.deepEqual(closed, ['full.png', 'crop.png']);
  } finally {
    globalThis.createImageBitmap = previous;
  }
});

test('distinguishes a fully transparent PNG from artwork with visible pixels', async () => {
  const previousBitmap = globalThis.createImageBitmap;
  const previousOffscreenCanvas = globalThis.OffscreenCanvas;
  let pixels = new Uint8ClampedArray(2 * 2 * 4);
  globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} });
  globalThis.OffscreenCanvas = class {
    getContext() {
      return {
        drawImage() {},
        getImageData() {
          return { data: pixels };
        },
      };
    }
  };
  try {
    const transparent = await inspectPngAsset(
      { name: 'none.png', type: 'image/png', size: 16 },
      { width: 2, height: 2 },
    );
    assert.equal(transparent.alphaAnalyzed, true);
    assert.equal(transparent.hasVisiblePixels, false);
    assert.equal(transparent.alphaBounds, null);

    pixels = new Uint8ClampedArray(2 * 2 * 4);
    pixels[3] = 255;
    const visible = await inspectPngAsset(
      { name: 'eye.png', type: 'image/png', size: 16 },
      { width: 2, height: 2 },
    );
    assert.equal(visible.hasVisiblePixels, true);
    assert.deepEqual(visible.alphaBounds, {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      centerX: 0.5,
      centerY: 0.5,
    });
  } finally {
    globalThis.createImageBitmap = previousBitmap;
    globalThis.OffscreenCanvas = previousOffscreenCanvas;
  }
});

test('rejects non-PNG, oversized and invalid-dimension artwork', async () => {
  await assert.rejects(() => inspectPngAsset({ name: 'photo.jpg', type: 'image/jpeg', size: 1 }, { width: 1024, height: 1024 }), /must be a PNG/);
  await assert.rejects(() => inspectPngAsset({ name: 'huge.png', type: 'image/png', size: MAX_MAKER_ASSET_BYTES + 1 }, { width: 1024, height: 1024 }), /larger than 20 MB/);
  const renamedJpeg = new Blob([
    Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]),
  ], { type: 'image/png' });
  Object.defineProperty(renamedJpeg, 'name', { value: 'renamed-photo.png' });
  await assert.rejects(
    () => inspectPngAsset(renamedJpeg, { width: 1024, height: 1024 }),
    /not a real PNG/,
  );
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
    return { source, width: 4, height: 4, close: () => { closeCount += 1; } };
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
  globalThis.createImageBitmap = async () => ({ width: 4, height: 4, close() {} });
  try {
    await assert.doesNotReject(() => resolver.resolve('broken'));
  } finally {
    resolver.clear();
    globalThis.createImageBitmap = previous;
  }
});

test('cached resolver rejects an oversized remote Content-Length before reading or decoding', async () => {
  const previousFetch = globalThis.fetch;
  const previousBitmap = globalThis.createImageBitmap;
  let requestSignal = null;
  let bodyRead = false;
  let bitmapCalls = 0;
  globalThis.fetch = async (_url, options = {}) => {
    requestSignal = options.signal;
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        'content-length': String(MAX_MAKER_ASSET_BYTES + 1),
        'content-type': 'image/png',
      }),
      body: {
        getReader() {
          bodyRead = true;
          throw new Error('body must not be read');
        },
      },
    };
  };
  globalThis.createImageBitmap = async () => {
    bitmapCalls += 1;
    return { width: 4, height: 4, close() {} };
  };
  const resolver = createCachedAssetResolver({
    remote: { url: 'https://aggregator.example/oversized.png' },
  });
  try {
    await assert.rejects(
      () => resolver.resolve('remote'),
      (error) => error?.code === 'MAKER_ASSET_LIMIT_EXCEEDED',
    );
    assert.equal(bodyRead, false);
    assert.equal(bitmapCalls, 0);
    assert.equal(requestSignal?.aborted, true);
  } finally {
    resolver.clear();
    globalThis.fetch = previousFetch;
    globalThis.createImageBitmap = previousBitmap;
  }
});

test('cached resolver enforces the actual streamed byte limit when Content-Length is absent or false', async () => {
  const previousFetch = globalThis.fetch;
  const previousBitmap = globalThis.createImageBitmap;
  let requestSignal = null;
  let canceled = false;
  let released = false;
  let readIndex = 0;
  let bitmapCalls = 0;
  const chunks = [
    new Uint8Array(MAX_MAKER_ASSET_BYTES),
    new Uint8Array(1),
  ];
  globalThis.fetch = async (_url, options = {}) => {
    requestSignal = options.signal;
    return {
      ok: true,
      status: 200,
      headers: new Headers({
        // Deliberately lies: the stream is larger than this declaration.
        'content-length': '8',
        'content-type': 'image/png',
      }),
      body: {
        getReader() {
          return {
            async read() {
              if (readIndex < chunks.length) return { done: false, value: chunks[readIndex++] };
              return { done: true, value: undefined };
            },
            async cancel() {
              canceled = true;
            },
            releaseLock() {
              released = true;
            },
          };
        },
      },
    };
  };
  globalThis.createImageBitmap = async () => {
    bitmapCalls += 1;
    return { width: 4, height: 4, close() {} };
  };
  const resolver = createCachedAssetResolver({
    remote: { url: 'https://aggregator.example/lying-length.png' },
  });
  try {
    await assert.rejects(
      () => resolver.resolve('remote'),
      (error) => error?.code === 'MAKER_ASSET_LIMIT_EXCEEDED',
    );
    assert.equal(readIndex, 2);
    assert.equal(canceled, true);
    assert.equal(released, true);
    assert.equal(bitmapCalls, 0);
    assert.equal(requestSignal?.aborted, true);
  } finally {
    resolver.clear();
    globalThis.fetch = previousFetch;
    globalThis.createImageBitmap = previousBitmap;
  }
});

test('cached resolver validates decoded dimensions and closes invalid or cleared bitmaps', async () => {
  const previousFetch = globalThis.fetch;
  const previousBitmap = globalThis.createImageBitmap;
  let closeCount = 0;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
  globalThis.createImageBitmap = async () => ({
    width: MAX_MAKER_ASSET_EDGE + 1,
    height: 32,
    close() {
      closeCount += 1;
    },
  });
  const invalidResolver = createCachedAssetResolver({
    remote: { url: 'https://aggregator.example/wide.png' },
  });
  try {
    await assert.rejects(
      () => invalidResolver.resolve('remote'),
      (error) => error?.code === 'MAKER_ASSET_LIMIT_EXCEEDED',
    );
    assert.equal(closeCount, 1);

    let releaseBitmap;
    let markDecodeStarted;
    const decodeStarted = new Promise((resolve) => {
      markDecodeStarted = resolve;
    });
    globalThis.createImageBitmap = async () => {
      markDecodeStarted();
      return new Promise((resolve) => {
        releaseBitmap = resolve;
      });
    };
    const clearedResolver = createCachedAssetResolver({
      local: { blob: new Blob(['png'], { type: 'image/png' }) },
    });
    const pending = clearedResolver.resolve('local');
    await decodeStarted;
    clearedResolver.clear();
    releaseBitmap({
      width: 32,
      height: 32,
      close() {
        closeCount += 1;
      },
    });
    await assert.rejects(pending, (error) => error?.name === 'AbortError');
    assert.equal(closeCount, 2);
    clearedResolver.clear();
  } finally {
    invalidResolver.clear();
    globalThis.fetch = previousFetch;
    globalThis.createImageBitmap = previousBitmap;
  }
});

test('decoded pixel limit rejects a compressed-image bomb even when both edges are permitted', async () => {
  const previousBitmap = globalThis.createImageBitmap;
  let closeCount = 0;
  globalThis.createImageBitmap = async () => ({
    width: MAX_MAKER_ASSET_EDGE,
    height: MAX_MAKER_ASSET_EDGE / 2,
    close() {
      closeCount += 1;
    },
  });
  const resolver = createCachedAssetResolver({
    bomb: { blob: new Blob(['small compressed PNG'], { type: 'image/png' }) },
  });
  try {
    assert.ok(MAX_MAKER_ASSET_EDGE * (MAX_MAKER_ASSET_EDGE / 2) > MAX_MAKER_ASSET_PIXELS);
    await assert.rejects(
      () => resolver.resolve('bomb'),
      (error) => error?.code === 'MAKER_ASSET_LIMIT_EXCEEDED',
    );
    assert.equal(closeCount, 1);
  } finally {
    resolver.clear();
    globalThis.createImageBitmap = previousBitmap;
  }
});

test('decoded bitmap cache uses a total pixel budget and LRU-closes consecutive Style assets', async () => {
  const previousBitmap = globalThis.createImageBitmap;
  const decodes = [];
  const closes = [];
  const stylePixels = 4096 * 4096;
  assert.equal(stylePixels, MAX_MAKER_ASSET_PIXELS);
  assert.equal(MAX_MAKER_ASSET_CACHE_PIXELS, stylePixels * 2);
  globalThis.createImageBitmap = async (source) => {
    decodes.push(source.name);
    return {
      name: source.name,
      width: 4096,
      height: 4096,
      close() {
        closes.push(source.name);
      },
    };
  };
  const resolver = createCachedAssetResolver({
    'style-a': { file: { name: 'style-a' } },
    'style-b': { file: { name: 'style-b' } },
    'style-c': { file: { name: 'style-c' } },
  });
  try {
    const firstA = await resolver.resolve('style-a');
    await resolver.resolve('style-b');
    assert.equal(await resolver.resolve('style-a'), firstA, 'cache hit must promote Style A to most-recent');
    await resolver.resolve('style-c');
    assert.deepEqual(closes, ['style-b'], 'third full-budget Style must evict the least-recent Style B');
    assert.deepEqual(decodes, ['style-a', 'style-b', 'style-c']);

    await resolver.resolve('style-b');
    assert.deepEqual(decodes, ['style-a', 'style-b', 'style-c', 'style-b']);
    assert.deepEqual(closes, ['style-b', 'style-a']);
  } finally {
    resolver.clear();
    globalThis.createImageBitmap = previousBitmap;
  }
  assert.deepEqual(closes, ['style-b', 'style-a', 'style-c', 'style-b']);
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

test('revived runtime records retain remote URLs but never stale object URLs', () => {
  const remote = reviveRuntimeAssetRecord({
    assetId: 'remote-layer',
    url: 'https://assets.example/remote-layer.png',
    thumbnailUrl: '/makers/remote-layer-thumb.png',
    source: 'remote',
  });
  assert.equal(remote.url, 'https://assets.example/remote-layer.png');
  assert.equal(remote.thumbnailUrl, '/makers/remote-layer-thumb.png');

  const stale = reviveRuntimeAssetRecord({
    assetId: 'stale-layer',
    url: 'blob:https://animacraft.example/stale-layer',
    thumbnailUrl: 'blob:https://animacraft.example/stale-thumb',
  });
  assert.equal(stale.url, '');
  assert.equal(stale.thumbnailUrl, '');
});

test('flags suspicious alpha-bound drift on a shared public Layer Track', () => {
  const document = {
    canvas: { width: 1000, height: 1000 },
    layerTracks: [{ id: 'base', name: 'Base', alignmentApproved: false }],
    parts: [{
      id: 'body',
      items: [
        { id: 'one', status: 'public', styles: [{ id: 'default', layerTrackId: 'base', assetId: 'one' }] },
        { id: 'two', status: 'public', styles: [{ id: 'default', layerTrackId: 'base', assetId: 'two' }] },
      ],
    }],
  };
  const assets = new Map([
    ['one', { alphaBounds: { centerX: 500, centerY: 500, width: 500, height: 800 } }],
    ['two', { alphaBounds: { centerX: 570, centerY: 540, width: 300, height: 600 } }],
  ]);
  const warnings = collectTrackAlignmentWarnings(document, assets);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].code, 'track_alignment_drift');
  document.layerTracks[0].alignmentApproved = true;
  assert.deepEqual(collectTrackAlignmentWarnings(document, assets), []);
});
