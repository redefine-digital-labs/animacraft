import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BLEND_MODES,
  evaluateVisibleWhen,
  renderMakerToCanvas,
  resolveMakerScene,
} from '../maker-renderer.js';
import {
  MAX_MAKER_ASSET_BYTES,
  MAX_MAKER_ASSET_EDGE,
} from '../maker-assets.js';

function style(id, trackId, assetId, extra = {}) {
  return {
    id,
    name: id,
    displayOrder: 0,
    assetId,
    layerTrackId: trackId,
    colorChannelId: null,
    transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    opacity: 1,
    blendMode: 'normal',
    visibleWhen: null,
    requires: [],
    excludes: [],
    ...extra,
  };
}

function part(id, menuOrder, trackId, assetId, extraStyle = {}) {
  return {
    id,
    menuOrder,
    required: false,
    defaultItemId: 'default',
    items: [{
      id: 'default',
      defaultStyleId: 'default',
      styles: [style('default', trackId, assetId, extraStyle)],
    }],
  };
}

function makerFixture() {
  return {
    schemaVersion: 'animacraft.maker.v5',
    canvas: { width: 800, height: 600, pixelMode: 'pixelated' },
    layerTracks: [
      { id: 'fx', order: 30 },
      { id: 'front', order: 20 },
      { id: 'back', order: 10 },
      { id: 'same-b', order: 25 },
      { id: 'same-a', order: 25 },
    ],
    colorChannels: [{
      id: 'hair-color',
      name: 'Hair',
      defaultSwatchId: 'black',
      swatches: [
        { id: 'black', hintColor: '#111111' },
        { id: 'blue', hintColor: '#3366ff' },
      ],
    }],
    assets: [
      { id: 'body', width: 800, height: 600 },
      { id: 'hair-back-black', width: 400, height: 300 },
      { id: 'hair-back-blue', width: 400, height: 300 },
      { id: 'hair-front', width: 800, height: 600 },
      { id: 'sparkle', width: 100, height: 100 },
      { id: 'hidden', width: 100, height: 100 },
      { id: 'a', width: 10, height: 10 },
      { id: 'b', width: 10, height: 10 },
    ],
    parts: [
      part('hair-back', 2, 'back', 'hair-back-black', {
        colorChannelId: 'hair-color',
        transform: { x: 12, y: 8, scale: 1.25, rotation: 5, originX: 200, originY: 150 },
        opacity: 0.8,
        blendMode: 'multiply',
      }),
      part('hair-front', 3, 'front', 'hair-front', { blendMode: 'screen' }),
      part('sparkle', 4, 'fx', 'sparkle', {
        blendMode: 'linear-dodge',
        visibleWhen: { op: 'selected', partId: 'body', itemId: 'default', styleId: 'default' },
      }),
      part('hidden', 5, 'fx', 'hidden', {
        visibleWhen: { op: 'not', condition: { op: 'selected', partId: 'body', itemId: 'default' } },
      }),
      part('same-b', 6, 'same-b', 'b'),
      part('same-a', 7, 'same-a', 'a'),
      part('body', 1, 'back', 'body', { displayOrder: -1 }),
    ],
  };
}

function recipeFixture(reverse = false) {
  const selections = makerFixture().parts.map((entry) => ({
    partId: entry.id,
    itemId: 'default',
    styleId: 'default',
  }));
  return {
    selections: reverse ? selections.reverse() : selections,
    colors: [{ channelId: 'hair-color', swatchId: 'blue' }],
  };
}

test('resolves one selected Style to one deterministic back-to-front layer', () => {
  const first = resolveMakerScene(makerFixture(), recipeFixture());
  const reversed = resolveMakerScene(makerFixture(), recipeFixture(true));

  assert.deepEqual(first.layers.map((layer) => layer.key), [
    'body/default/default',
    'hair-back/default/default',
    'hair-front/default/default',
    'same-a/default/default',
    'same-b/default/default',
    'sparkle/default/default',
  ]);
  assert.deepEqual(
    first.layers.map((layer) => layer.key),
    reversed.layers.map((layer) => layer.key),
    'recipe array order must never become z-order',
  );
  assert.ok(first.layers.every((layer) => Object.hasOwn(layer, 'styleId')));
  const obsoleteIdentityField = ['binding', 'Id'].join('');
  assert.ok(first.layers.every((layer) => !Object.hasOwn(layer, obsoleteIdentityField)));
  assert.deepEqual(first.issues, []);
});

test('recolors the Style single PNG while preserving its transform, opacity and blend mode', () => {
  const scene = resolveMakerScene(makerFixture(), recipeFixture());
  const hair = scene.layers.find((layer) => layer.partId === 'hair-back');
  assert.equal(hair.assetId, 'hair-back-black');
  assert.deepEqual(hair.colorChannel && {
    id: hair.colorChannel.id,
    valueId: hair.colorChannel.valueId,
    value: hair.colorChannel.value,
  }, { id: 'hair-color', valueId: 'blue', value: '#3366ff' });
  assert.deepEqual(hair.transform, {
    x: 12,
    y: 8,
    width: 400,
    height: 300,
    scaleX: 1.25,
    scaleY: 1.25,
    rotation: 5,
    originX: 200,
    originY: 150,
  });
  assert.equal(hair.opacity, 0.8);
  assert.equal(hair.compositeOperation, BLEND_MODES.multiply);
  assert.equal(scene.layers.at(-1).blendMode, 'add');
  assert.equal(scene.layers.at(-1).compositeOperation, 'lighter');
  assert.equal(scene.pixelMode, 'nearest');
});

test('Layer Track transform never changes a Style placement', () => {
  const maker = makerFixture();
  maker.layerTracks.find((track) => track.id === 'back').transform = { x: 400, y: 500, scale: 0.1, rotation: -40 };
  const hair = resolveMakerScene(maker, recipeFixture()).layers.find((layer) => layer.partId === 'hair-back');
  assert.equal(hair.transform.x, 12);
  assert.equal(hair.transform.y, 8);
  assert.equal(hair.transform.scaleX, 1.25);
  assert.equal(hair.transformSource, 'style');
});

test('rotation defaults to the PNG center and Part menu order never changes layer order', () => {
  const maker = makerFixture();
  const hair = maker.parts.find((part) => part.id === 'hair-front');
  hair.items[0].styles[0].transform.rotation = 15;
  const before = resolveMakerScene(maker, recipeFixture());
  const hairLayer = before.layers.find((layer) => layer.partId === 'hair-front');
  assert.equal(hairLayer.transform.originX, 400);
  assert.equal(hairLayer.transform.originY, 300);

  maker.parts.find((part) => part.id === 'hair-back').items[0].styles[0].displayOrder = 0;
  maker.parts.find((part) => part.id === 'body').items[0].styles[0].displayOrder = 0;
  const sameTrackBefore = resolveMakerScene(maker, recipeFixture())
    .layers
    .filter((layer) => layer.trackId === 'back')
    .map((layer) => layer.partId);
  maker.parts.find((part) => part.id === 'hair-back').menuOrder = -100;
  maker.parts.find((part) => part.id === 'body').menuOrder = 100;
  const sameTrackAfter = resolveMakerScene(maker, recipeFixture())
    .layers
    .filter((layer) => layer.trackId === 'back')
    .map((layer) => layer.partId);
  assert.deepEqual(sameTrackAfter, sameTrackBefore);
});

test('does not treat obsolete style.visible=false as a render switch', () => {
  const maker = makerFixture();
  maker.parts.find((part) => part.id === 'hair-back').items[0].styles[0].visible = false;
  const scene = resolveMakerScene(maker, recipeFixture());
  assert.ok(scene.layers.some((layer) => layer.partId === 'hair-back'));
});

test('evaluates style-aware selected/all/any/not and color conditions', () => {
  const context = {
    selections: new Map([
      ['face', { itemId: 'smile', styleId: 'open' }],
      ['hat', { itemId: '' }],
    ]),
    colorChannels: new Map([['eyes', { valueId: 'violet', value: '#7755ff' }]]),
  };
  assert.equal(evaluateVisibleWhen({ all: [
    { partId: 'face', itemId: 'smile', styleId: 'open' },
    { colorChannelId: 'eyes', in: ['violet', 'green'] },
  ] }, context), true);
  assert.equal(evaluateVisibleWhen({ partId: 'hat', selected: false }, context), true);
  assert.equal(evaluateVisibleWhen({
    op: 'not',
    condition: { op: 'selected', partId: 'accessory', itemId: 'ring' },
  }, context), true);
  assert.equal(evaluateVisibleWhen({
    requires: [{ partId: 'face', itemIds: ['smile'], styleIds: ['open'] }],
    excludes: [{ colorChannelId: 'eyes', equals: '#7755ff' }],
  }, context), false);
});

test('does not silently replace explicit None, missing Items or missing Styles', () => {
  const maker = makerFixture();
  maker.parts[0].required = true;
  const none = resolveMakerScene(maker, { selections: [{ partId: 'hair-back', itemId: '' }] });
  assert.deepEqual(none.layers, []);

  const missingItem = resolveMakerScene(maker, {
    selections: [{ partId: 'hair-back', itemId: 'missing', styleId: 'default' }],
  });
  assert.equal(missingItem.issues[0].code, 'unknown-item');

  const missingStyle = resolveMakerScene(maker, {
    selections: [{ partId: 'hair-back', itemId: 'default', styleId: 'missing' }],
  });
  assert.equal(missingStyle.issues[0].code, 'unknown-style');
});

test('can opt into required defaults without overriding explicit None', () => {
  const maker = makerFixture();
  const body = maker.parts.find((entry) => entry.id === 'body');
  body.required = true;
  const omitted = resolveMakerScene(maker, { selections: [] }, { useRequiredDefaults: true });
  assert.deepEqual(omitted.layers.map((layer) => layer.key), ['body/default/default']);
  const explicitNone = resolveMakerScene(
    maker,
    { selections: [{ partId: 'body', itemId: '' }] },
    { useRequiredDefaults: true },
  );
  assert.deepEqual(explicitNone.layers, []);
});

function fakeCanvas() {
  const operations = [];
  const context = {
    canvas: null,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'low',
    save() { operations.push(['save']); },
    restore() { operations.push(['restore']); },
    setTransform(...args) { operations.push(['setTransform', ...args]); },
    clearRect(...args) { operations.push(['clearRect', ...args]); },
    fillRect(...args) { operations.push(['fillRect', ...args]); },
    translate(...args) { operations.push(['translate', ...args]); },
    rotate(...args) { operations.push(['rotate', ...args]); },
    scale(...args) { operations.push(['scale', ...args]); },
    drawImage(source, ...args) {
      operations.push([
        'drawImage',
        source.name,
        this.globalAlpha,
        this.globalCompositeOperation,
        this.imageSmoothingEnabled,
        ...args,
      ]);
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext(type) { return type === '2d' ? context : null; },
  };
  context.canvas = canvas;
  return { canvas, operations };
}

function remoteAssetMaker(url) {
  const maker = makerFixture();
  maker.parts = [maker.parts.find((entry) => entry.id === 'hair-back')];
  maker.assets = [{
    id: 'hair-back-black',
    width: 400,
    height: 300,
    url,
  }];
  return maker;
}

test('Canvas renderer rejects oversized remote metadata before decoding the response body', async () => {
  const previousFetch = globalThis.fetch;
  const previousBitmap = globalThis.createImageBitmap;
  let requestSignal = null;
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
          throw new Error('oversized response body must not be read');
        },
      },
    };
  };
  globalThis.createImageBitmap = async () => {
    bitmapCalls += 1;
    return { width: 4, height: 4, close() {} };
  };
  try {
    await assert.rejects(
      () => renderMakerToCanvas(
        remoteAssetMaker('https://aggregator.example/oversized.png'),
        { selections: [{ partId: 'hair-back', itemId: 'default', styleId: 'default' }] },
        fakeCanvas().canvas,
      ),
      (error) => error?.code === 'MAKER_ASSET_LIMIT_EXCEEDED',
    );
    assert.equal(bitmapCalls, 0);
    assert.equal(requestSignal?.aborted, true);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.createImageBitmap = previousBitmap;
  }
});

test('Canvas renderer closes a decoded remote bitmap that exceeds the dimension limit', async () => {
  const previousFetch = globalThis.fetch;
  const previousBitmap = globalThis.createImageBitmap;
  let closeCount = 0;
  globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
  globalThis.createImageBitmap = async () => ({
    width: 64,
    height: MAX_MAKER_ASSET_EDGE + 1,
    close() {
      closeCount += 1;
    },
  });
  try {
    await assert.rejects(
      () => renderMakerToCanvas(
        remoteAssetMaker('https://aggregator.example/tall.png'),
        { selections: [{ partId: 'hair-back', itemId: 'default', styleId: 'default' }] },
        fakeCanvas().canvas,
      ),
      (error) => error?.code === 'MAKER_ASSET_LIMIT_EXCEEDED',
    );
    assert.equal(closeCount, 1);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.createImageBitmap = previousBitmap;
  }
});

test('Canvas renderer applies direct Style transforms, blend, pixel mode and color hook', async () => {
  const maker = makerFixture();
  maker.parts = [maker.parts.find((entry) => entry.id === 'hair-back')];
  const { canvas, operations } = fakeCanvas();
  const colors = [];
  const result = await renderMakerToCanvas(maker, {
    selections: [{ partId: 'hair-back', itemId: 'default', styleId: 'default' }],
    colors: [{ channelId: 'hair-color', swatchId: 'blue' }],
  }, canvas, {
    resolveAsset(assetId) {
      return { width: 400, height: 300, name: assetId };
    },
    applyColorChannel({ source, channel }) {
      colors.push({ id: channel.id, valueId: channel.valueId });
      return { width: source.width, height: source.height, name: `${source.name}:colored` };
    },
  });

  assert.equal(canvas.width, 800);
  assert.equal(canvas.height, 600);
  assert.equal(result.drawn, 1);
  assert.deepEqual(colors, [{ id: 'hair-color', valueId: 'blue' }]);
  assert.ok(operations.some((operation) => operation[0] === 'translate' && operation[1] === 262 && operation[2] === 195.5));
  assert.ok(operations.some((operation) => operation[0] === 'rotate' && Math.abs(operation[1] - (5 * Math.PI / 180)) < 1e-12));
  assert.ok(operations.some((operation) => operation[0] === 'scale' && operation[1] === 1.25 && operation[2] === 1.25));
  assert.deepEqual(
    operations.find((operation) => operation[0] === 'drawImage'),
    ['drawImage', 'hair-back-black:colored', 0.8, 'multiply', false, 0, 0, 400, 300],
  );
});
