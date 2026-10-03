import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256 } from '@noble/hashes/sha2.js';
import { toBase64 } from '@mysten/sui/utils';
import {
  MakerV8PlayerJourneyError,
  MAKER_V8_BLEND_MODES,
  MAKER_V8_BLEND_CODES,
  MAKER_V8_CANVAS_BLEND_MODES,
  mapMakerV8SmartColorPixelsV8,
  colorizeMakerV8ImageSourceV8,
  renderResolvedMakerV8RecipePngV8,
  makerV8ExportSizes, exactMakerV8ExportOptions,
} from '../maker-v8-render-core.js';
import * as journey from '../maker-v8-player-journey.js';

const hash = bytes => [...sha256(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const content = new Uint8Array([1, 2, 3]);
const bytesBase64 = toBase64(content);
const swatch = (key, rgba) => ({ key, rgba, stops: [] });

test('native source extent and center rotation never stretch a layer to the document canvas', async () => {
  const h = harness([layer(0, { transform: { x: -10.5, y: 20.25, scale: 0.5, rotation: 90 } })]);
  const source = { width: 800, height: 400 };
  h.input.document.canvas = { width: 1080, height: 1920, pixelMode: 'smooth' };
  h.input.decodeImage = async () => ({ source, close() {} });
  await h.render();
  assert.deepEqual(h.calls.filter(row => ['translate', 'rotate', 'scale', 'draw'].includes(row[0])), [
    ['translate', 189.5, 120.25], ['rotate', Math.PI / 2], ['scale', 0.5, 0.5],
    ['translate', -400, -200], ['draw', source, 0, 0, 800, 400],
  ]);
});
const originalBlendModes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
  'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
  'hue', 'saturation', 'color', 'luminosity', 'linear-dodge'];
function layer(selectionIndex = 0, overrides = {}) {
  return {
    selectionIndex,
    selection: { source: 'BASE', partKey: 'body', itemKey: 'hat', styleKey: 'default', colorChannelKey: 'tint' },
    asset: { assetId: 'hat', blobId: 'exact-blob', byteLength: content.length, mediaType: 'image/png', sha256: hash(content) },
    transform: { x: 1, y: 2, scale: 1.5, rotation: 45 },
    opacity: 0.5, blendMode: 'multiply', trackOrder: 0, displayOrder: 0,
    protected: false, swatch: null, ...overrides,
    sourceAsset: overrides.sourceAsset === undefined
      ? { sha256: hash(content), mediaType: 'image/png', byteLength: content.length } : overrides.sourceAsset,
  };
}
function harness(layers = [layer()]) {
  const calls = [];
  const context = {
    clearRect(...args) { calls.push(['clear', ...args]); },
    save() { calls.push(['save']); }, restore() { calls.push(['restore']); },
    translate(...args) { calls.push(['translate', ...args]); },
    rotate(value) { calls.push(['rotate', value]); },
    scale(...args) { calls.push(['scale', ...args]); },
    drawImage(source, ...args) { calls.push(['draw', source.label ?? source, ...args]); },
  };
  const input = {
    document: { canvas: { width: 800, height: 600, pixelMode: 'pixelated' } }, layers,
    async loadAsset(asset) { calls.push(['load', asset.assetId]); return { ...asset, bytesBase64 }; },
    canvasFactory() {
      calls.push(['canvas']);
      return { getContext: () => context, async convertToBlob() { return new Blob([content], { type: 'image/png' }); } };
    },
    async decodeImage(bytes, mediaType) {
      calls.push(['decode', [...bytes], mediaType]);
      return { source: { label: 'decoded', width: 80, height: 40 }, close() { calls.push(['close-image']); } };
    },
    async colorizeImage({ source, swatch: chosen }) {
      calls.push(['color', chosen.key]);
      return { source: { ...source, label: `${source.label}:${chosen.key}` }, close() { calls.push(['close-color']); } };
    },
  };
  return { calls, context, input, render: () => renderResolvedMakerV8RecipePngV8(input) };
}

test('download sizes preserve original bounds, aspect ratio and small images', () => {
  for (const [width, height, expected] of [[800, 800, [800, 800]], [1080, 1920, [576, 1024]],
    [8192, 1, [1024, 1]], [1, 8192, [1, 1024]], [2048, 1537, [1024, 769]]]) {
    assert.deepEqual(Object.values(makerV8ExportSizes({ width, height }).standard), expected);
  }
  assert.equal(makerV8ExportSizes({ width: 4096, height: 2048 }).originalSafe, true);
  assert.equal(makerV8ExportSizes({ width: 4097, height: 2048 }).originalSafe, false);
  assert.throws(() => exactMakerV8ExportOptions({ width: 4097, height: 2048 }, { sizeMode: 'original' }), /safe pixel/);
  for (const value of [{}, { sizeMode: 'huge' }, { sizeMode: 'standard', transparent: 'true' },
    { sizeMode: 'standard', width: 99999 }, { get sizeMode() { throw new Error('getter ran'); } }]) {
    assert.throws(() => exactMakerV8ExportOptions({ width: 100, height: 100 }, value), TypeError);
  }
});

test('standard export scales the entire original scene before layer transforms and leaves source intact', async () => {
  const h = harness([layer(0, { swatch: swatch('red', '#ff0000ff') })]);
  h.input.document.canvas = { width: 2048, height: 1536, pixelMode: 'pixelated' };
  h.input.exportSizeMode = 'standard';
  const before = structuredClone({ document: h.input.document, layers: h.input.layers });
  const png = await h.render();
  assert.deepEqual([png.width, png.height], [1024, 768]);
  assert.deepEqual(h.calls.filter(row => ['scale', 'translate', 'rotate', 'draw'].includes(row[0])), [
    ['scale', .5, .5], ['translate', 61, 32], ['rotate', Math.PI / 4], ['scale', 1.5, 1.5],
    ['translate', -40, -20], ['draw', 'decoded:red', 0, 0, 80, 40],
  ]);
  assert.equal(h.context.imageSmoothingEnabled, false);
  assert.deepEqual({ document: h.input.document, layers: h.input.layers }, before);
  h.input.exportSizeMode = 'original';
  const original = await h.render();
  assert.deepEqual([original.width, original.height], [2048, 1536]);
  h.input.document.canvas = { width: 4097, height: 2048, pixelMode: 'smooth' };
  const calls = h.calls.length;
  await assert.rejects(h.render(), /safe pixel/);
  assert.equal(h.calls.length, calls, 'Oversized original is rejected before allocation or reads.');
});

test('Player keeps the same exported error class and color functions after extraction', () => {
  assert.equal(journey.MakerV8PlayerJourneyError, MakerV8PlayerJourneyError);
  assert.equal(journey.mapMakerV8SmartColorPixelsV8, mapMakerV8SmartColorPixelsV8);
  assert.equal(journey.colorizeMakerV8ImageSourceV8, colorizeMakerV8ImageSourceV8);
});

test('all 17 original blend modes retain protocol codes and exact Canvas operations', async () => {
  assert.deepEqual(MAKER_V8_BLEND_MODES, originalBlendModes);
  assert.equal(Object.isFrozen(MAKER_V8_BLEND_MODES), true);
  assert.equal(Object.isFrozen(MAKER_V8_BLEND_CODES), true);
  assert.equal(Object.isFrozen(MAKER_V8_CANVAS_BLEND_MODES), true);
  for (const [code, mode] of originalBlendModes.entries()) {
    assert.equal(MAKER_V8_BLEND_CODES[mode], code);
    const expected = mode === 'normal' ? 'source-over' : mode === 'linear-dodge' ? 'lighter' : mode;
    const f = harness([layer(0, { blendMode: mode })]);
    await f.render();
    assert.equal(f.context.globalCompositeOperation, expected, mode);
  }
});

test('unknown blend modes and historical aliases reject before rendering', async () => {
  for (const blendMode of ['add', 'lighter', 'linear_dodge', 'unknown', 'constructor', 17, null]) {
    const f = harness([layer(0, { blendMode })]);
    await assert.rejects(f.render(), { code: 'MAKER_V8_PLAYER_JOURNEY_RENDER_LAYER_INVALID' });
    assert.deepEqual(f.calls, []);
  }
});

test('exact core retains original transforms, native source geometry, opacity, blend and PNG evidence', async () => {
  const f = harness(); const result = await f.render();
  assert.deepEqual(f.calls, [['canvas'], ['clear', 0, 0, 800, 600], ['load', 'hat'], ['decode', [1, 2, 3], 'image/png'],
    ['save'], ['translate', 61, 32], ['rotate', Math.PI / 4], ['scale', 1.5, 1.5],
    ['translate', -40, -20], ['draw', 'decoded', 0, 0, 80, 40], ['restore'], ['close-image']]);
  assert.equal(f.context.imageSmoothingEnabled, false);
  assert.equal(f.context.globalAlpha, 0.5); assert.equal(f.context.globalCompositeOperation, 'multiply');
  assert.deepEqual(result, { schemaVersion: 'animacraft.maker-v8-player-render.v1', mediaType: 'image/png',
    width: 800, height: 600, bytesBase64, byteLength: 3, sha256: hash(content) });
  assert.equal(Object.isFrozen(result), true);
});

test('same color channel on two original slots retains different per-layer swatches', async () => {
  const f = harness([layer(3, { swatch: swatch('blue', '#0000ffff') }), layer(1, { swatch: swatch('red', '#ff0000ff') })]);
  await f.render();
  assert.deepEqual(f.calls.filter(call => call[0] === 'color'), [['color', 'red'], ['color', 'blue']]);
  assert.deepEqual(f.calls.filter(call => call[0] === 'draw').map(call => call[1]), ['decoded:red', 'decoded:blue']);
});

test('filtered null gaps and sort order never renumber exact protected decryption slots', async () => {
  const rawSlots = [null, layer(1, { protected: true, trackOrder: 2 }), null,
    layer(3, { protected: true, trackOrder: 1 })];
  for (const row of rawSlots.filter(Boolean)) row.sourceAsset = {
    sha256: hash(new Uint8Array([row.selectionIndex])), mediaType: 'image/png', byteLength: 1,
  };
  const f = harness(rawSlots.filter(Boolean)); const decrypted = [];
  f.input.decryptProtectedSelection = async ({ selectionIndex, ciphertext }) => {
    decrypted.push(selectionIndex); assert.equal(ciphertext.sha256, hash(content));
    return { selectionIndex, bytesBase64: toBase64(new Uint8Array([selectionIndex])), byteLength: 1 };
  };
  await f.render(); assert.deepEqual(decrypted, [3, 1]);
  assert.deepEqual(f.calls.filter(call => call[0] === 'decode').map(call => call[1]), [[3], [1]]);
});

test('core snapshots original slots, canvas, transform and swatch before asynchronous byte reads', async () => {
  const f = harness([layer(4, { protected: true, swatch: swatch('blue', '#0000ffff') })]);
  f.input.loadAsset = async asset => {
    f.input.document.canvas.width = 2;
    f.input.layers[0].selectionIndex = 0;
    f.input.layers[0].transform.x = 99;
    f.input.layers[0].swatch.key = 'red';
    return { ...asset, bytesBase64 };
  };
  f.input.decryptProtectedSelection = async ({ selectionIndex }) => {
    assert.equal(selectionIndex, 4); return { selectionIndex, bytesBase64, byteLength: 3 };
  };
  const result = await f.render(); assert.equal(result.width, 800);
  assert.deepEqual(f.calls.find(call => call[0] === 'translate'), ['translate', 61, 32]);
  assert.deepEqual(f.calls.find(call => call[0] === 'color'), ['color', 'blue']);
});

const invalidInputs = {
  'unknown canvas pixel policy': input => { input.document.canvas.pixelMode = 'guess'; },
  'oversized canvas': input => { input.document.canvas.width = 8193; },
  'fractional canvas': input => { input.document.canvas.height = 2.5; },
  'excess layer count': input => { input.layers = Array.from({ length: 501 }, (_, index) => layer(index)); },
  'undefined array gap': input => { input.layers.length = 2; },
  'duplicate original slot': input => { input.layers.push(layer()); },
  'negative original slot': input => { input.layers[0].selectionIndex = -1; },
  'fractional original slot': input => { input.layers[0].selectionIndex = 0.5; },
  'missing original slot': input => { delete input.layers[0].selectionIndex; },
  'unknown source': input => { input.layers[0].selection.source = 'FALLBACK'; },
  'missing exact swatch': input => { delete input.layers[0].swatch; },
  'invalid swatch': input => { input.layers[0].swatch = { key: 'x', rgba: 'red', stops: [] }; },
  'non-finite opacity': input => { input.layers[0].opacity = NaN; },
  'non-finite transform': input => { input.layers[0].transform.rotation = Infinity; },
  'unbounded transform': input => { input.layers[0].transform.scale = 101; },
  'invalid exact hash': input => { input.layers[0].asset.sha256 = 'guess'; },
  'unbounded asset': input => { input.layers[0].asset.byteLength = 8 * 1024 * 1024 + 1; },
};
for (const [name, change] of Object.entries(invalidInputs)) {
  test(`rejects ${name} before allocating canvas or reading bytes`, async () => {
    const f = harness(); change(f.input);
    await assert.rejects(f.render(), error => error instanceof MakerV8PlayerJourneyError);
    assert.deepEqual(f.calls, []);
  });
}

test('asset identity and SHA drift reject before decoding', async () => {
  for (const change of [value => { value.blobId = 'other'; }, value => { value.bytesBase64 = 'BAUG'; }]) {
    const f = harness(); f.input.loadAsset = async asset => { const value = { ...asset, bytesBase64 }; change(value); return value; };
    await assert.rejects(f.render(), { code: 'MAKER_V8_PLAYER_JOURNEY_RENDER_ASSET_DRIFT' });
    assert.equal(f.calls.some(call => call[0] === 'decode'), false);
  }
});

test('missing authority adapter, wrong protected slot and invalid plaintext preserve explicit errors', async () => {
  const f = harness([layer(7, { protected: true })]);
  await assert.rejects(f.render(), { code: 'MAKER_V8_PLAYER_PROTECTED_SELECTION_BLOCKED', layer: 'BLOCKED_EXTERNAL_SECRET' });
  for (const response of [{ selectionIndex: 0, bytesBase64, byteLength: 3 },
    { selectionIndex: 7, bytesBase64: '???', byteLength: 3 }, { selectionIndex: 7, bytesBase64, byteLength: -1 }]) {
    f.input.decryptProtectedSelection = async () => response;
    await assert.rejects(f.render(), { code: 'MAKER_V8_PLAYER_PROTECTED_PLAINTEXT_INVALID', layer: 'PROTECTION' });
  }
  assert.equal(f.calls.some(call => call[0] === 'decode'), false);
});

test('protected Base rejects substituted same-length plaintext before decoding', async () => {
  const f = harness([layer(0, { protected: true })]);
  f.input.decryptProtectedSelection = async () => ({ selectionIndex: 0,
    bytesBase64: toBase64(new Uint8Array([3, 2, 1])), byteLength: 3 });
  await assert.rejects(f.render(), { code: 'MAKER_V8_PLAYER_PROTECTED_SOURCE_MISMATCH' });
  assert.equal(f.calls.some(call => call[0] === 'decode'), false);
  f.input.layers[0].sourceAsset = null;
  await assert.rejects(f.render(), { code: 'MAKER_V8_PLAYER_PROTECTED_SOURCE_INVALID' });
});

test('drawing failure always restores canvas and closes decoded and tinted image resources', async () => {
  const f = harness([layer(0, { swatch: swatch('red', '#ff0000ff') })]);
  f.context.drawImage = () => { throw new Error('draw failure'); };
  await assert.rejects(f.render(), /draw failure/);
  assert.deepEqual(f.calls.slice(-3), [['restore'], ['close-color'], ['close-image']]);
});

test('bad decoded native dimensions fail before drawing and close acquired images', async () => {
  for (const source of [null, 'decoded', {}, { width: 0, height: 10 }, { width: '10', height: 10 },
    { width: 1.5, height: 10 }, { width: 8193, height: 1 }, { width: 8192, height: 8192 }]) {
    const h = harness(); let closed = 0;
    h.input.decodeImage = async () => ({ source, close() { closed++; } });
    await assert.rejects(h.render(), { code: 'MAKER_V8_PLAYER_JOURNEY_IMAGE_SOURCE_INVALID' });
    assert.equal(closed, 1);
    assert.equal(h.calls.some(row => row[0] === 'save' || row[0] === 'draw'), false);
  }
  const h = harness(); h.input.decodeImage = async () => null;
  await assert.rejects(h.render(), { code: 'MAKER_V8_PLAYER_JOURNEY_IMAGE_SOURCE_INVALID' });
});

test('Smart Color must preserve source extent, and both resources close on invalid output', async () => {
  const h = harness([layer(0, { swatch: swatch('red', '#ff0000ff') })]);
  h.input.colorizeImage = async () => ({ source: { width: 800, height: 600 }, close() { h.calls.push(['close-color']); } });
  await assert.rejects(h.render(), { code: 'MAKER_V8_PLAYER_JOURNEY_SMART_COLOR_PROCESSOR_INVALID' });
  assert.deepEqual(h.calls.slice(-2), [['close-color'], ['close-image']]);
  assert.equal(h.calls.some(row => row[0] === 'draw'), false);
});

test('Smart Color retains transparent margins and native dimensions instead of cropping to visible pixels', async () => {
  const data = new Uint8ClampedArray(4 * 3 * 4);
  data.set([100, 100, 100, 128], (1 * 4 + 2) * 4);
  const calls = [];
  const canvas = { getContext: () => ({ drawImage(...args) { calls.push(args); },
    getImageData: () => ({ width: 4, height: 3, data }), putImageData() {},
  }) };
  const source = { width: 40, height: 30, naturalWidth: 4, naturalHeight: 3 };
  const colored = await colorizeMakerV8ImageSourceV8({ source, swatch: swatch('red', '#ff0000ff'), canvasFactory: () => canvas });
  assert.deepEqual([colored.source.width, colored.source.height], [4, 3]);
  assert.deepEqual(calls, [[source, 0, 0, 4, 3]]);
  assert.equal(data[3], 0);
  assert.equal(data[(1 * 4 + 2) * 4 + 3], 128);
  const h = harness(); h.input.decodeImage = async () => ({ source, close() {} });
  await h.render();
  assert.deepEqual(h.calls.find(row => row[0] === 'draw'), ['draw', source, 0, 0, 4, 3]);
});
